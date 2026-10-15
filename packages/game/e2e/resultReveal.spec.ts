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

// Screenshots for a visual check (PC_SHOTS=1): mid-animation and final, desktop and phones, plus
// master mode (the selection screen's third line, a master then a grand master finish). Written
// under .oneshot/shots/ (git-ignored).
const shots = fileURLToPath(new URL('../../../.oneshot/shots/', import.meta.url));
const phone = (width: number, height: number) =>
  ({ viewport: { width, height }, deviceScaleFactor: 2, hasTouch: true }) as const;
const SIZES = {
  desktop: { viewport: { width: 1280, height: 720 }, deviceScaleFactor: 1 },
  phone: phone(390, 844),
  'phone-360': phone(360, 740),
  'phone-320': phone(320, 740),
  'phone-landscape': phone(740, 360),
} as const;

/**
 * A save where every level is finished with gold (every chapter and master mode open), pc-14
 * with a master medal and a best master run.
 */
async function withAllGold(page: Page): Promise<void> {
  const chapters = JSON.parse(
    readFileSync(fileURLToPath(new URL('chapters.json', levelsDir)), 'utf8'),
  ) as { levels: string[] }[];
  const levels: Record<string, unknown> = {};
  for (const id of chapters.flatMap((c) => c.levels))
    levels[id] = { completed: true, medals: { moves: 'gold' } };
  levels['pc-14'] = {
    completed: true,
    bestMoves: 600,
    bestTimeMs: 80_000,
    masterBestMoves: 590,
    masterBestTimeMs: 118_000,
    medals: { moves: 'gold', master: 'master' },
  };
  await page.addInitScript(
    (save) => localStorage.setItem('puzzlecave.save.v1', save),
    JSON.stringify({ version: 2, settings: {}, levels }),
  );
}

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
    test('master mode: selection screen, master then grand master (pc-14, pc-31)', async ({
      page,
    }) => {
      await withAllGold(page);
      await page.goto('/');
      await expect.poll(() => field(page, 'scene')).toBe('Menu');
      await page.keyboard.press('Enter');
      // everything finished: the selection starts on the last chapter's first level
      await expect.poll(() => field(page, 'levelId')).toBe('pc-07');
      for (let k = 0; k < 4; k++) await page.keyboard.press('ArrowRight');
      await expect.poll(() => field(page, 'levelId')).toBe('pc-14');
      await page.screenshot({ path: `${shots}master-${name}-select-pc14.png` });
      await page.keyboard.press('PageUp');
      await page.keyboard.press('PageUp');
      await page.keyboard.press('ArrowRight');
      await expect.poll(() => field(page, 'levelId')).toBe('pc-31');
      await page.screenshot({ path: `${shots}master-${name}-select-pc31.png` });

      // master: the gold reference route (above platinumMoves)
      const goldRoute = parseMoves(
        readFileSync(fileURLToPath(new URL('solutions/gold/pc-31.txt', levelsDir)), 'utf8'),
      );
      await page.keyboard.press('KeyP');
      await expect.poll(() => field(page, 'scene')).toBe('Game');
      expect(await field(page, 'mode')).toBe('master');
      await play(page, goldRoute);
      await expect.poll(() => field(page, 'scene')).toBe('Result');
      expect(await field(page, 'resultReveal')).toContain('master:master:new');
      await page.waitForTimeout(700);
      await page.screenshot({ path: `${shots}master-${name}-result-master-mid.png` });
      await expect.poll(() => field(page, 'resultAnimDone')).toBe(true);
      await page.screenshot({ path: `${shots}master-${name}-result-master-final.png` });

      // grand master: the best known solution
      await page.keyboard.press('Escape');
      await expect.poll(() => field(page, 'scene')).toBe('Select');
      await page.keyboard.press('KeyP');
      await expect.poll(() => field(page, 'scene')).toBe('Game');
      expect(await field(page, 'mode')).toBe('master');
      await play(page, solutionOf('pc-31'));
      await expect.poll(() => field(page, 'scene')).toBe('Result');
      expect(await field(page, 'resultReveal')).toContain('master:grandMaster:new');
      await page.waitForTimeout(700);
      await page.screenshot({ path: `${shots}master-${name}-result-grandmaster-mid.png` });
      await expect.poll(() => field(page, 'resultAnimDone')).toBe(true);
      await page.screenshot({ path: `${shots}master-${name}-result-grandmaster-final.png` });
      await page.keyboard.press('Escape');
      await expect.poll(() => field(page, 'scene')).toBe('Select');
      await page.screenshot({ path: `${shots}master-${name}-select-pc31-after.png` });
    });
  });
}
