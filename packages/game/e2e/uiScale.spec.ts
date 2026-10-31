import { expect, test, type Page } from '@playwright/test';

// The interface grows with the screen past 1280×720 (2560×1440: twice), and follows a resize.

type Box = { text: string; x: number; y: number; w: number; h: number; button: boolean };
const debug = (page: Page) =>
  page.evaluate(() => (window as unknown as { __pc?: Record<string, unknown> }).__pc ?? {});

/** CSS height of the menu's Play button (its box, frame included). */
const playHeight = async (page: Page): Promise<number> => {
  const boxes = (await page.evaluate(() =>
    (window as unknown as { __pcTexts: () => Box[] }).__pcTexts(),
  )) as Box[];
  const play = boxes.find((b) => b.button && b.text === 'Play');
  return play ? play.h : NaN;
};

const toMenu = async (page: Page) => {
  await page.goto('/');
  await expect.poll(async () => (await debug(page)).scene).toBe('Menu');
};

test.use({ viewport: { width: 1280, height: 720 }, deviceScaleFactor: 1, locale: 'en-US' });

test('a menu button is twice as tall on 2560×1440 as on 1280×720', async ({ page }) => {
  await toMenu(page);
  const base = await playHeight(page);
  expect(base).toBeGreaterThan(10);

  await page.setViewportSize({ width: 2560, height: 1440 });
  await page.reload();
  await expect.poll(async () => (await debug(page)).scene).toBe('Menu');
  const big = await playHeight(page);
  expect(big / base).toBeGreaterThan(1.9);
  expect(big / base).toBeLessThan(2.1);
});

test('the interface follows a resize of the window', async ({ page }) => {
  await toMenu(page);
  const base = await playHeight(page);
  await page.setViewportSize({ width: 1920, height: 1080 });
  // the menu is laid out again at 1.5×
  await expect.poll(async () => (await playHeight(page)) / base).toBeGreaterThan(1.4);
  expect((await playHeight(page)) / base).toBeLessThan(1.6);
  await page.setViewportSize({ width: 1280, height: 720 });
  await expect.poll(() => playHeight(page)).toBe(base);
});
