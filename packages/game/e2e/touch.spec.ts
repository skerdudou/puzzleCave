import { expect, test, type CDPSession, type Page } from '@playwright/test';

// A phone: touch screen, portrait, 2 device pixels per CSS pixel (the drag is measured in CSS px).
test.use({ viewport: { width: 390, height: 740 }, hasTouch: true, deviceScaleFactor: 2 });

const debug = (page: Page) =>
  page.evaluate(() => (window as unknown as { __pc?: Record<string, unknown> }).__pc ?? {});
const field = async (page: Page, k: string) => (await debug(page))[k];
const vibrations = (page: Page) =>
  page.evaluate(() => (window as unknown as { __vib: number[][] }).__vib);

/** navigator.vibrate replaced by a recorder (window.__vib) */
async function recordVibrations(page: Page): Promise<void> {
  await page.addInitScript(() => {
    const w = window as unknown as { __vib: unknown[] };
    w.__vib = [];
    Object.defineProperty(Navigator.prototype, 'vibrate', {
      configurable: true,
      value: (p: unknown) => (w.__vib.push(p), true),
    });
  });
}

/** Real touch events (Chromium DevTools protocol): one finger, CSS pixels. */
class Finger {
  constructor(
    private readonly cdp: CDPSession,
    private x = 0,
    private y = 0,
  ) {}
  static async on(page: Page): Promise<Finger> {
    return new Finger(await page.context().newCDPSession(page));
  }
  async down(x: number, y: number): Promise<void> {
    this.x = x;
    this.y = y;
    await this.cdp.send('Input.dispatchTouchEvent', {
      type: 'touchStart',
      touchPoints: [{ x, y, id: 1 }],
    });
  }
  /** slides to (x, y) in small touchmove steps, like a real finger */
  async to(x: number, y: number, n = 12): Promise<void> {
    const [x0, y0] = [this.x, this.y];
    for (let i = 1; i <= n; i++) {
      this.x = x0 + ((x - x0) * i) / n;
      this.y = y0 + ((y - y0) * i) / n;
      await this.cdp.send('Input.dispatchTouchEvent', {
        type: 'touchMove',
        touchPoints: [{ x: this.x, y: this.y, id: 1 }],
      });
    }
  }
  async by(dx: number, dy: number, n?: number): Promise<void> {
    await this.to(this.x + dx, this.y + dy, n);
  }
  async up(): Promise<void> {
    await this.cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  }
  async cancel(): Promise<void> {
    await this.cdp.send('Input.dispatchTouchEvent', { type: 'touchCancel', touchPoints: [] });
  }
}

/** pc-01, first row: @ . B . ~ . k . . (the block sinks into the water when pushed twice) */
async function startPc01(page: Page): Promise<Finger> {
  await page.goto('/');
  await expect.poll(() => field(page, 'scene')).toBe('Menu');
  await page.keyboard.press('Enter');
  await expect.poll(() => field(page, 'scene')).toBe('Select');
  await page.keyboard.press('Enter');
  await expect.poll(() => field(page, 'scene')).toBe('Game');
  expect(await field(page, 'levelId')).toBe('pc-01');
  // the d-pad is shown: the page is seen as a touch device
  await expect.poll(() => field(page, 'dpad')).toBeTruthy();
  return Finger.on(page);
}

const STEP = 40; // default distance per move, CSS px
// a point on the play area, away from the buttons and the d-pad
const X0 = 150;
const Y0 = 300;

test('a drag of N steps makes N moves and pushes the block on its way', async ({ page }) => {
  await recordVibrations(page);
  const f = await startPc01(page);
  await f.down(X0, Y0);
  await f.by(STEP + 4, 0);
  await expect.poll(() => field(page, 'moves')).toBe(1);
  await f.by(STEP, 0); // into the block: pushed
  await expect.poll(() => field(page, 'moves')).toBe(2);
  expect(await field(page, 'player')).toEqual({ x: 3, y: 1 });
  await f.by(STEP, 0); // the block sinks into the water
  await f.up();
  await expect.poll(() => field(page, 'moves')).toBe(3);
  expect(await field(page, 'player')).toEqual({ x: 4, y: 1 });
  // the push and the filled water are seen on the board: no vibration
  expect(await vibrations(page)).toEqual([]);
});

test('a drag shorter than the default step (the old 24 px default) makes no move', async ({
  page,
}) => {
  const f = await startPc01(page);
  await f.down(X0, Y0);
  await f.by(STEP - 4, 0);
  await f.up();
  // a d-pad tap afterwards: only its own move
  const pad = (await field(page, 'dpad')) as Record<string, [number, number]>;
  await f.down(...pad.right!);
  await f.up();
  await expect.poll(() => field(page, 'moves')).toBe(1);
  expect(await field(page, 'player')).toEqual({ x: 2, y: 1 });
});

test('a drag with a turn moves both ways; a turn into a wall bumps', async ({ page }) => {
  await recordVibrations(page);
  const f = await startPc01(page);
  await f.down(X0, Y0);
  await f.by(STEP + 4, 0);
  await expect.poll(() => field(page, 'player')).toEqual({ x: 2, y: 1 });
  await f.by(-STEP - 8, 0); // back left, same gesture
  await expect.poll(() => field(page, 'player')).toEqual({ x: 1, y: 1 });
  expect(await field(page, 'moves')).toBe(2);
  await f.by(0, STEP + 8); // then down: a wall
  await expect.poll(() => vibrations(page)).toEqual([[10]]);
  await f.up();
  expect(await field(page, 'moves')).toBe(2);
});

test('a tap or a small wiggle makes no move', async ({ page }) => {
  await recordVibrations(page);
  const f = await startPc01(page);
  await f.down(X0, Y0);
  await f.up();
  await f.down(X0, Y0);
  await f.by(8, -6, 4);
  await f.by(-10, 9, 4);
  await f.up();
  await page.touchscreen.tap(X0 + 40, Y0 + 40);
  await page.waitForTimeout(300);
  expect(await field(page, 'moves')).toBe(0);
  expect(await vibrations(page)).toEqual([]);
});

test('d-pad: a tap moves once, holding repeats; sliding off, lifting or cancelling stops', async ({
  page,
}) => {
  await recordVibrations(page);
  const f = await startPc01(page);
  const pad = (await field(page, 'dpad')) as Record<string, [number, number]>;
  const [rx, ry] = pad.right!;
  const [lx, ly] = pad.left!;
  const moves = async () => (await field(page, 'moves')) as number;
  /** repeated attempts against the wall: move attempts that did not move */
  const bumps = async () => ((await field(page, 'attempts')) as number) - (await moves());
  const steady = async (count: () => Promise<number>) => {
    await page.waitForTimeout(150);
    const before = await count();
    await page.waitForTimeout(600);
    expect(await count()).toBe(before);
  };

  // a tap: one move, no repeat
  await f.down(rx, ry);
  await f.up();
  await page.waitForTimeout(400);
  expect(await moves()).toBe(1);
  await f.down(lx, ly);
  await f.up();
  await expect.poll(moves).toBe(2);

  // hold right: repeats (the corridor is free up to x = 9 once the block has sunk)…
  await f.down(rx, ry);
  await expect.poll(moves, { timeout: 2000 }).toBeGreaterThanOrEqual(5);
  // …until the finger slides off the button, still down
  await f.to(X0, Y0, 3);
  await steady(moves);
  expect(((await field(page, 'player')) as { x: number }).x).toBeLessThan(9);
  await f.up();

  // hold left: back to the start, then a bump against the wall at each repeat…
  await f.down(lx, ly);
  await expect.poll(() => field(page, 'player'), { timeout: 3000 }).toEqual({ x: 1, y: 1 });
  await expect.poll(bumps).toBeGreaterThanOrEqual(2);
  // …until lifted
  await f.up();
  await steady(bumps);
  // the repeated bumps of one press vibrate once
  expect(await vibrations(page)).toEqual([[10]]);

  // a cancelled touch stops it too
  const before = await bumps();
  await f.down(lx, ly);
  await expect.poll(bumps).toBeGreaterThanOrEqual(before + 2);
  await f.cancel();
  await steady(bumps);
  // a new press bumps (and vibrates) again
  expect(await vibrations(page)).toEqual([[10], [10]]);
});

test('options: drag distance and vibrations are saved and used', async ({ page }) => {
  await recordVibrations(page);
  await page.goto('/');
  await expect.poll(() => field(page, 'scene')).toBe('Menu');
  await page.touchscreen.tap(390 / 2, 740 / 2 + 56); // Options, under Play
  await expect.poll(() => field(page, 'scene')).toBe('Options');
  const button = async (id: string) =>
    ((await field(page, 'buttons')) as Record<string, [number, number]>)[id]!;
  const tap = async (id: string) => {
    const [x, y] = await button(id);
    await page.touchscreen.tap(x, y);
  };
  const saved = () =>
    page.evaluate(
      () =>
        JSON.parse(localStorage.getItem('puzzlecave.save.v1') ?? '{}').settings as {
          dragStep: number;
          vibration: boolean;
        },
    );
  // 40 → 48 → 56 → 64 px per move
  for (let i = 0; i < 3; i++) {
    await tap('drag-plus');
    await expect.poll(async () => (await saved()).dragStep).toBe([48, 56, 64][i]);
  }
  await tap('vibration');
  await expect.poll(async () => (await saved()).vibration).toBe(false);

  // after a reload: still there, and used by the game
  await page.reload();
  await expect.poll(() => field(page, 'scene')).toBe('Menu');
  expect(await saved()).toMatchObject({ dragStep: 64, vibration: false });
  await page.keyboard.press('Enter');
  await expect.poll(() => field(page, 'scene')).toBe('Select');
  await page.keyboard.press('Enter');
  await expect.poll(() => field(page, 'scene')).toBe('Game');
  const f = await Finger.on(page);
  await f.down(X0, Y0);
  await f.by(2 * 64 + 10, 0); // two moves at 64 px (it would be three at 40 px): a push
  await f.up();
  await expect.poll(() => field(page, 'moves')).toBe(2);
  await page.waitForTimeout(200);
  expect(await field(page, 'player')).toEqual({ x: 3, y: 1 });
  expect(await vibrations(page)).toEqual([]); // vibrations off
});
