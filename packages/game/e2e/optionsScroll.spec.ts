import { expect, test, type CDPSession, type Page } from '@playwright/test';

// A phone in landscape: the options are taller than the screen and scroll.
const PHONE = { viewport: { width: 740, height: 360 }, hasTouch: true, deviceScaleFactor: 2 };

type Pc = {
  scene?: string;
  lang?: string;
  langMenuOpen?: boolean;
  scrollY?: number;
  maxScrollY?: number;
  settings?: Record<string, unknown>;
  buttons?: Record<string, [number, number]>;
};
const debug = (page: Page): Promise<Pc> =>
  page.evaluate(() => (window as unknown as { __pc?: Pc }).__pc ?? {});
const button = async (page: Page, id: string) => (await debug(page)).buttons![id]!;
const saved = (page: Page) => page.evaluate(() => localStorage.getItem('puzzlecave.save.v1'));

/** Real touch events (Chromium DevTools protocol): one finger, CSS pixels. */
class Finger {
  private x = 0;
  private y = 0;
  constructor(private readonly cdp: CDPSession) {}
  static async on(page: Page): Promise<Finger> {
    return new Finger(await page.context().newCDPSession(page));
  }
  private send(type: 'touchStart' | 'touchMove' | 'touchEnd', points: { x: number; y: number }[]) {
    return this.cdp.send('Input.dispatchTouchEvent', {
      type,
      touchPoints: points.map((p) => ({ ...p, id: 1 })),
    });
  }
  async down(x: number, y: number): Promise<void> {
    [this.x, this.y] = [x, y];
    await this.send('touchStart', [{ x, y }]);
  }
  /** slides by (0, dy) in small steps, like a real finger */
  async by(dy: number, n = 12): Promise<void> {
    const y0 = this.y;
    for (let i = 1; i <= n; i++) {
      this.y = y0 + (dy * i) / n;
      await this.send('touchMove', [{ x: this.x, y: this.y }]);
    }
  }
  async up(): Promise<void> {
    await this.send('touchEnd', []);
  }
  async tap(x: number, y: number): Promise<void> {
    await this.down(x, y);
    await this.up();
  }
}

async function openOptions(page: Page): Promise<void> {
  await page.goto('/');
  await expect.poll(async () => (await debug(page)).scene).toBe('Menu');
  const { width, height } = page.viewportSize()!;
  await page.mouse.click(width / 2, height / 2 + 56); // Options, under Play
  await expect.poll(async () => (await debug(page)).scene).toBe('Options');
}

/** waits for the scroll to rest (end of a flick's inertia) and returns it */
async function restingScroll(page: Page): Promise<number> {
  let last = NaN;
  await expect
    .poll(async () => {
      const y = (await debug(page)).scrollY!;
      const still = y === last;
      last = y;
      return still;
    })
    .toBe(true);
  return last;
}

/** a slow drag (no flick) of the content, from a point on the screen */
async function dragFrom(page: Page, x: number, y: number, dy: number): Promise<void> {
  const f = await Finger.on(page);
  await f.down(x, y);
  await f.by(dy, 20);
  await page.waitForTimeout(150); // the finger rests: no inertia
  await f.up();
}

test.describe('phone in landscape', () => {
  test.use(PHONE);

  test('the options scroll with a finger, without pressing the control under it', async ({
    page,
  }) => {
    await openOptions(page);
    const pc = await debug(page);
    expect(pc.maxScrollY).toBeGreaterThan(40);
    expect(pc.scrollY).toBe(0);
    expect((await button(page, 'back'))[1]).toBeGreaterThan(360); // Back is below the screen
    const settings = pc.settings;
    const before = await saved(page);
    const [sx, sy] = await button(page, 'sound');

    // a drag starting on the Sound button scrolls, and Sound is not toggled
    await dragFrom(page, sx, sy, -60);
    const y = await restingScroll(page);
    expect(y).toBeGreaterThan(40);
    const after = await debug(page);
    expect(after.scene).toBe('Options');
    expect(after.settings).toEqual(settings);
    expect(await saved(page)).toBe(before);
    // the reported positions follow the scroll
    expect((await button(page, 'sound'))[1]).toBeCloseTo(sy - y, 0);

    // a drag starting on a stepper button does not change it either (and comes back up)
    const [px_, py] = await button(page, 'drag-plus');
    await dragFrom(page, px_, py, 300);
    expect(await restingScroll(page)).toBe(0);
    expect((await debug(page)).settings).toEqual(settings);
    expect(await saved(page)).toBe(before);
  });

  test('after scrolling, Vibration and Back answer a tap', async ({ page }) => {
    await openOptions(page);
    const f = await Finger.on(page);
    await dragFrom(page, 600, 300, -400);
    const y = await restingScroll(page);
    expect(y).toBe((await debug(page)).maxScrollY);

    const vibration = (await debug(page)).settings!.vibration;
    const [vx, vy] = await button(page, 'vibration');
    expect(vy).toBeGreaterThan(0);
    expect(vy).toBeLessThan(360);
    await f.tap(vx, vy);
    await expect.poll(async () => (await debug(page)).settings!.vibration).toBe(!vibration);
    // the scene was redrawn where it was
    expect((await debug(page)).scrollY).toBe(y);

    const [bx, by] = await button(page, 'back');
    expect(by).toBeLessThan(360);
    await f.tap(bx, by);
    await expect.poll(async () => (await debug(page)).scene).toBe('Menu');
    // coming back: the top again
    await page.mouse.click(370, 180 + 56);
    await expect.poll(async () => (await debug(page)).scene).toBe('Options');
    expect((await debug(page)).scrollY).toBe(0);
  });

  test('the language drop-down opens entirely on the screen after scrolling', async ({ page }) => {
    await openOptions(page);
    const f = await Finger.on(page);
    await dragFrom(page, 600, 300, -400);
    const y = await restingScroll(page);
    expect(y).toBeGreaterThan(0);

    const [lx, ly] = await button(page, 'lang');
    await f.tap(lx, ly);
    await expect.poll(async () => (await debug(page)).langMenuOpen).toBe(true);
    for (const lang of ['en', 'fr', 'de', 'es', 'it']) {
      const [, iy] = await button(page, `lang-${lang}`);
      expect(iy).toBeGreaterThan(10);
      expect(iy).toBeLessThan(350);
    }
    // the content does not scroll under an open list
    await dragFrom(page, 700, 200, 100);
    expect((await debug(page)).scrollY).toBe(y);
    expect((await debug(page)).langMenuOpen).toBe(false); // that touch closed it (backdrop)

    await f.tap(lx, ly);
    await expect.poll(async () => (await debug(page)).langMenuOpen).toBe(true);
    const [dx, dy] = await button(page, 'lang-de');
    await f.tap(dx, dy);
    await expect.poll(async () => (await debug(page)).lang).toBe('de');
    expect((await debug(page)).langMenuOpen).toBe(false);
    expect((await debug(page)).scrollY).toBe(y);
  });

  test('wheel and keys scroll too; a rotation clamps the scroll', async ({ page }) => {
    await openOptions(page);
    const max = (await debug(page)).maxScrollY!;
    // the wheel moves the content by its delta (CSS px)
    await page.evaluate(() => {
      const w = window as unknown as { __wheel: number };
      w.__wheel = 0;
      window.addEventListener('wheel', (e) => (w.__wheel += e.deltaY), { capture: true });
    });
    await page.mouse.move(370, 180);
    await page.mouse.wheel(0, 30);
    const wheel = () => page.evaluate(() => (window as unknown as { __wheel: number }).__wheel);
    await expect.poll(wheel).toBeGreaterThan(0);
    await expect.poll(async () => (await debug(page)).scrollY).toBe(await wheel());
    await page.keyboard.press('Home');
    await expect.poll(async () => (await debug(page)).scrollY).toBe(0);
    await page.keyboard.press('ArrowDown');
    await expect.poll(async () => (await debug(page)).scrollY).toBe(44);
    await page.keyboard.press('End');
    await expect.poll(async () => (await debug(page)).scrollY).toBe(max);

    // taller screen: less to scroll, the offset follows
    await page.setViewportSize({ width: 740, height: 400 });
    await expect.poll(async () => (await debug(page)).maxScrollY).toBe(max - 40);
    expect((await debug(page)).scrollY).toBe(max - 40);
    // portrait: everything fits
    await page.setViewportSize({ width: 360, height: 740 });
    await expect.poll(async () => (await debug(page)).maxScrollY).toBe(0);
    expect((await debug(page)).scrollY).toBe(0);
    expect((await button(page, 'back'))[1]).toBeLessThan(740);
  });
});

test('desktop: everything fits, nothing scrolls', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 720 });
  await openOptions(page);
  expect((await debug(page)).maxScrollY).toBe(0);
  const [, by] = await button(page, 'back');
  await page.mouse.move(640, 360);
  await page.mouse.wheel(0, 200);
  await page.keyboard.press('End');
  await page.waitForTimeout(100);
  expect((await debug(page)).scrollY).toBe(0);
  expect((await button(page, 'back'))[1]).toBe(by);
});
