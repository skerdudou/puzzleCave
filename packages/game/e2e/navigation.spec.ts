import { expect, test, type Page } from '@playwright/test';
import { storedSave } from './storedSave';

type Pc = {
  scene?: string;
  chapter?: string;
  levelId?: string;
  konami?: boolean;
  notice?: string;
  playButton?: [number, number];
  pageShift?: number;
  buttonWidths?: Record<string, number>;
  achievementRows?: Record<string, unknown>;
};
const debug = (page: Page): Promise<Pc> =>
  page.evaluate(() => (window as unknown as { __pc?: Pc }).__pc ?? {});
const scene = async (page: Page) => (await debug(page)).scene;

const KONAMI = ['ArrowUp', 'ArrowUp', 'ArrowDown', 'ArrowDown'].concat([
  'ArrowLeft',
  'ArrowRight',
  'ArrowLeft',
  'ArrowRight',
  'b',
  'a',
]);

test.use({ locale: 'en-US' });

test('the menu: its three buttons are as wide as each other', async ({ page }) => {
  await page.goto('/');
  await expect.poll(() => scene(page)).toBe('Menu');
  const w = (await debug(page)).buttonWidths!;
  expect(w.options).toBe(w.play);
  expect(w.achievements).toBe(w.play);
});

test('the Konami code on the level selection', async ({ page }) => {
  await page.goto('/');
  await expect.poll(() => scene(page)).toBe('Menu');
  await page.keyboard.press('Enter');
  await expect.poll(() => scene(page)).toBe('Select');
  for (const k of KONAMI) await page.keyboard.press(k);
  await expect.poll(async () => (await debug(page)).konami).toBe(true);
  await expect
    .poll(async () => Object.keys((await storedSave(page))?.achievements ?? {}))
    .toContain('konami');
  expect(await scene(page)).toBe('Select');
});

test('Back in the browser goes back a screen; from the menu it leaves the game', async ({
  page,
}) => {
  await page.goto('about:blank');
  await page.goto('/');
  await expect.poll(() => scene(page)).toBe('Menu');
  await page.keyboard.press('Enter');
  await expect.poll(() => scene(page)).toBe('Select');
  await page.keyboard.press('Enter');
  await expect.poll(() => scene(page)).toBe('Game');
  await page.goBack({ waitUntil: 'commit' }).catch(() => undefined);
  await expect.poll(() => scene(page)).toBe('Select');
  await page.goBack({ waitUntil: 'commit' }).catch(() => undefined);
  await expect.poll(() => scene(page)).toBe('Menu');
  // and again, as many times as the player comes and goes
  await page.keyboard.press('Enter');
  await expect.poll(() => scene(page)).toBe('Select');
  await page.goBack({ waitUntil: 'commit' }).catch(() => undefined);
  await expect.poll(() => scene(page)).toBe('Menu');
  // the menu: a first Back warns and stays
  await page.goBack({ waitUntil: 'commit' }).catch(() => undefined);
  await expect.poll(async () => (await debug(page)).notice).toBe('Press back again to quit');
  expect(await scene(page)).toBe('Menu');
  expect(page.url()).not.toBe('about:blank');
  // a second one leaves for the page before the game
  await page.goBack({ waitUntil: 'commit' }).catch(() => undefined);
  await expect.poll(() => page.url()).toBe('about:blank');
});

test.describe('on a phone', () => {
  test.use({ viewport: { width: 390, height: 740 }, hasTouch: true, deviceScaleFactor: 2 });

  /** one finger sliding from (x, y) by dx, CSS px (Chromium DevTools protocol touch events) */
  async function swipe(page: Page, x: number, y: number, dx: number): Promise<void> {
    const cdp = await page.context().newCDPSession(page);
    const touch = (type: 'touchStart' | 'touchMove' | 'touchEnd', px: number) =>
      cdp.send('Input.dispatchTouchEvent', {
        type,
        touchPoints: type === 'touchEnd' ? [] : [{ x: px, y, id: 1 }],
      });
    await touch('touchStart', x);
    for (let i = 1; i <= 10; i++) await touch('touchMove', x + (dx * i) / 10);
    await touch('touchEnd', x + dx);
  }

  test('the page follows the finger a little, and goes back when it is lifted too soon', async ({
    page,
  }) => {
    await page.goto('/');
    await expect.poll(() => scene(page)).toBe('Menu');
    await page.keyboard.press('Enter');
    await expect.poll(() => scene(page)).toBe('Select');
    const first = (await debug(page)).chapter;
    const cdp = await page.context().newCDPSession(page);
    const touch = (type: 'touchStart' | 'touchMove' | 'touchEnd', x: number) =>
      cdp.send('Input.dispatchTouchEvent', {
        type,
        touchPoints: type === 'touchEnd' ? [] : [{ x, y: 400, id: 1 }],
      });
    // only the grid of levels moves: the tile "1" goes, Play stays
    const xs = () =>
      page.evaluate(() => {
        const texts = (
          window as unknown as { __pcTexts: () => { text: string; x: number }[] }
        ).__pcTexts();
        const at = (s: string) => texts.find((t) => t.text === s)!.x;
        return { tile: at('1'), play: at('Play') };
      });
    const before = await xs();
    await touch('touchStart', 300);
    for (const x of [295, 290, 285, 280, 275]) await touch('touchMove', x);
    // 25 px: the grid moves to the left, less than the finger, not enough for a swipe
    await expect.poll(async () => (await debug(page)).pageShift).toBeLessThan(0);
    expect((await debug(page)).pageShift).toBeGreaterThan(-25);
    const moved = await xs();
    expect(moved.tile).toBeLessThan(before.tile);
    expect(moved.play).toBe(before.play);
    await touch('touchEnd', 275);
    await expect.poll(async () => (await debug(page)).pageShift).toBe(0);
    expect((await debug(page)).chapter).toBe(first);
    // the first chapter has none before it: to the right, a rubber band
    await touch('touchStart', 100);
    for (let i = 1; i <= 10; i++) await touch('touchMove', 100 + i * 20);
    const shift = (await debug(page)).pageShift!;
    expect(shift).toBeGreaterThan(0);
    expect(shift).toBeLessThanOrEqual(18);
    await touch('touchEnd', 300);
    await expect.poll(async () => (await debug(page)).pageShift).toBe(0);
    expect((await debug(page)).chapter).toBe(first);
  });

  test('a swipe changes chapter; a tap still picks a level', async ({ page }) => {
    await page.goto('/');
    await expect.poll(() => scene(page)).toBe('Menu');
    await page.keyboard.press('Enter');
    await expect.poll(() => scene(page)).toBe('Select');
    const first = (await debug(page)).chapter;
    // starting on a tile: the swipe does not pick it
    const level = (await debug(page)).levelId;
    await swipe(page, 300, 120, -150);
    await expect.poll(async () => (await debug(page)).chapter).not.toBe(first);
    expect(await scene(page)).toBe('Select');
    await swipe(page, 90, 120, 150);
    await expect.poll(async () => (await debug(page)).chapter).toBe(first);
    expect((await debug(page)).levelId).toBe(level);
  });

  test('a swipe that ends on Play changes chapter, it does not start the level', async ({
    page,
  }) => {
    await page.goto('/');
    await expect.poll(() => scene(page)).toBe('Menu');
    await page.keyboard.press('Enter');
    await expect.poll(() => scene(page)).toBe('Select');
    const first = (await debug(page)).chapter;
    const [x, y] = (await debug(page)).playButton!;
    await swipe(page, x + 150, y, -150);
    await expect.poll(async () => (await debug(page)).chapter).not.toBe(first);
    // a few frames for a scene change that should not come
    await page.waitForTimeout(300);
    expect(await scene(page)).toBe('Select');
  });

  test('the Konami code is not listed among the achievements', async ({ page }) => {
    await page.goto('/');
    await expect.poll(() => scene(page)).toBe('Menu');
    const buttons = await page.evaluate(
      () => (window as unknown as { __pc: { buttons: Record<string, [number, number]> } }).__pc,
    );
    const [x, y] = buttons.buttons.achievements!;
    await page.touchscreen.tap(x, y);
    await expect.poll(() => scene(page)).toBe('Achievements');
    const rows = (await debug(page)).achievementRows!;
    expect(rows['konami']).toBeUndefined();
    expect(rows['deepThought']).toBeDefined();
  });
});
