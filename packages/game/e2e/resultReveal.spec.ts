import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { expect, test, type Page } from '@playwright/test';
import { parseMoves, type Dir } from '@puzzlecave/core';

const levelsDir = new URL('../../../levels/', import.meta.url);
const solutionOf = (id: string) =>
  parseMoves(readFileSync(fileURLToPath(new URL(`solutions/${id}.txt`, levelsDir)), 'utf8'));
const KEY = { up: 'ArrowUp', down: 'ArrowDown', left: 'ArrowLeft', right: 'ArrowRight' } as const;
const debug = (page: Page) =>
  page.evaluate(() => (window as unknown as { __pc?: Record<string, unknown> }).__pc ?? {});
const field = async (page: Page, k: string) => (await debug(page))[k];

async function play(page: Page, moves: readonly Dir[]): Promise<void> {
  for (const d of moves) await page.keyboard.press(KEY[d]);
}

/** Menu → Select → pc-01 → solved: the result screen, first finish (every medal is new). */
async function finishPc01(page: Page): Promise<void> {
  await page.goto('/');
  await expect.poll(() => field(page, 'scene')).toBe('Menu');
  await page.keyboard.press('Enter');
  await expect.poll(() => field(page, 'scene')).toBe('Select');
  await page.keyboard.press('Enter');
  await expect.poll(() => field(page, 'scene')).toBe('Game');
  await play(page, solutionOf('pc-01'));
  await expect.poll(() => field(page, 'scene')).toBe('Result');
}

test('result screen: medals pop in, then reach their final state', async ({ page }) => {
  await finishPc01(page);
  expect(await field(page, 'resultAnimDone')).toBe(false);
  expect(await field(page, 'resultReveal')).toContain('moves:gold:new');
  await expect.poll(() => field(page, 'resultAnimDone')).toBe(true);
  const scales = (await field(page, 'resultMedalScales')) as number[];
  expect(scales.length).toBeGreaterThan(0);
  expect(scales.every((s) => s === 1)).toBe(true);
});

test('result screen: a key press skips the medal animation', async ({ page }) => {
  await finishPc01(page);
  expect(await field(page, 'resultAnimDone')).toBe(false);
  await page.keyboard.press('Space');
  // synchronous: done right after the key, long before the animation's own end
  expect(await field(page, 'resultAnimDone')).toBe(true);
  expect(await field(page, 'scene')).toBe('Result');
  const scales = (await field(page, 'resultMedalScales')) as number[];
  expect(scales.every((s) => s === 1)).toBe(true);
});

test('result screen: a click skips the medal animation, Enter still goes on', async ({ page }) => {
  await finishPc01(page);
  expect(await field(page, 'resultAnimDone')).toBe(false);
  await page.mouse.click(5, 5);
  await expect.poll(() => field(page, 'resultAnimDone'), { timeout: 1000 }).toBe(true);
  await page.keyboard.press('Enter');
  await expect.poll(() => field(page, 'scene')).toBe('Game');
});

test.describe('reduced motion', () => {
  test.use({ reducedMotion: 'reduce' });
  test('result screen: final state at once', async ({ page }) => {
    await finishPc01(page);
    expect(await field(page, 'resultAnimDone')).toBe(true);
    const scales = (await field(page, 'resultMedalScales')) as number[];
    expect(scales.length).toBeGreaterThan(0);
    expect(scales.every((s) => s === 1)).toBe(true);
  });
});

// Screenshots for a visual check (PC_SHOTS=1): mid-animation and final, desktop and phone, plus a
// platinum finish in master mode. Written under .oneshot/shots/ (git-ignored).
const shots = fileURLToPath(new URL('../../../.oneshot/shots/', import.meta.url));
const SIZES = {
  desktop: { viewport: { width: 1280, height: 720 }, deviceScaleFactor: 1 },
  phone: { viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, hasTouch: true },
} as const;

for (const [name, size] of Object.entries(SIZES)) {
  test.describe(`shots ${name}`, () => {
    test.skip(!process.env.PC_SHOTS, 'screenshots only with PC_SHOTS=1');
    test.use(size);
    test('first finish of pc-01', async ({ page }) => {
      await finishPc01(page);
      await page.waitForTimeout(380);
      await page.screenshot({ path: `${shots}reveal-${name}-mid.png` });
      await expect.poll(() => field(page, 'resultAnimDone')).toBe(true);
      await page.screenshot({ path: `${shots}reveal-${name}-final.png` });
    });
    test('platinum in master mode (pc-31)', async ({ page }) => {
      const solution = solutionOf('pc-31');
      await page.goto('/');
      await expect.poll(() => field(page, 'scene')).toBe('Menu');
      await page.keyboard.press('Enter');
      await expect.poll(() => field(page, 'scene')).toBe('Select');
      await page.keyboard.press('PageDown');
      await page.keyboard.press('ArrowRight');
      await expect.poll(() => field(page, 'levelId')).toBe('pc-31');
      await page.keyboard.press('Enter');
      await expect.poll(() => field(page, 'scene')).toBe('Game');
      await play(page, solution);
      await expect.poll(() => field(page, 'scene')).toBe('Result');
      await page.keyboard.press('Escape');
      await expect.poll(() => field(page, 'scene')).toBe('Select');
      await page.keyboard.press('KeyP');
      await expect.poll(() => field(page, 'mode')).toBe('master');
      await play(page, solution);
      await expect.poll(() => field(page, 'scene')).toBe('Result');
      expect(await field(page, 'resultReveal')).toContain('platinum:platinum:new');
      await page.waitForTimeout(700);
      await page.screenshot({ path: `${shots}reveal-${name}-platinum-mid.png` });
      await expect.poll(() => field(page, 'resultAnimDone')).toBe(true);
      await page.screenshot({ path: `${shots}reveal-${name}-platinum-final.png` });
    });
  });
}
