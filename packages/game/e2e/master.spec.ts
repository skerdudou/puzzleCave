import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { expect, test, type Page } from '@playwright/test';
import { initialState, parseMoves, replay, step, type Dir } from '@puzzlecave/core';
import { parseTmx } from '@puzzlecave/tiled';

// pc-31, second level of the Medium chapter (master mode exists there, not on Easy)
const ID = 'pc-31';
const levelsDir = new URL('../../../levels/', import.meta.url);
const read = (name: string) => readFileSync(fileURLToPath(new URL(name, levelsDir)), 'utf8');
const level = parseTmx(read(`${ID}.tmx`), ID, (src) => read(src));
const solution = parseMoves(read(`solutions/${ID}.txt`));

/** a prefix of the solution then one move that walks into water (master mode: drowned) */
function drowning(): Dir[] {
  const dirs: Dir[] = ['up', 'down', 'left', 'right'];
  for (let k = 0; k <= solution.length; k++) {
    const prefix = solution.slice(0, k);
    const s = k === 0 ? initialState(level, 'master') : replay(level, prefix, 'master');
    const d = dirs.find((d) => step(s, d).state.status === 'drowned');
    if (d) return [...prefix, d];
  }
  throw new Error(`${ID}: no water next to the solution path`);
}

const KEY = { up: 'ArrowUp', down: 'ArrowDown', left: 'ArrowLeft', right: 'ArrowRight' } as const;
const debug = (page: Page) =>
  page.evaluate(() => (window as unknown as { __pc?: Record<string, unknown> }).__pc ?? {});
const field = async (page: Page, k: string) => (await debug(page))[k];
type Rows = { kind: string; tiers: { medal: string; text: string }[] }[];

async function play(page: Page, moves: readonly Dir[]): Promise<void> {
  for (const d of moves) await page.keyboard.press(KEY[d]);
}

test('master mode: locked before gold, no undo, water drowns, platinum', async ({ page }) => {
  const gold = level.thresholds.goldMoves!;
  expect(solution.length).toBeLessThanOrEqual(level.thresholds.platinumMoves ?? gold);
  await page.goto('/');
  await expect.poll(() => field(page, 'scene')).toBe('Menu');
  await page.keyboard.press('Enter');
  await expect.poll(() => field(page, 'scene')).toBe('Select');

  // Easy chapter: no master mode, no platinum limit, P does nothing
  expect(await field(page, 'master')).toBe('none');
  expect(((await field(page, 'thresholds')) as Rows)[0]!.tiers.map((t) => t.medal)).toEqual([
    'gold',
    'silver',
    'bronze',
  ]);

  // Medium chapter, pc-31: platinum limit shown, master mode locked until gold
  await page.keyboard.press('PageDown');
  await page.keyboard.press('ArrowRight');
  await expect.poll(() => field(page, 'levelId')).toBe(ID);
  expect(await field(page, 'master')).toBe('locked');
  const rows = (await field(page, 'thresholds')) as Rows;
  expect(rows[0]!.tiers[0]).toEqual({ medal: 'platinum', text: `≤ ${gold}` });
  await page.keyboard.press('KeyP');
  await page.waitForTimeout(300);
  expect(await field(page, 'scene')).toBe('Select');

  // gold in normal mode opens master mode
  await page.keyboard.press('Enter');
  await expect.poll(() => field(page, 'scene')).toBe('Game');
  expect(await field(page, 'mode')).toBe('normal');
  await play(page, solution);
  await expect.poll(() => field(page, 'scene')).toBe('Result');
  expect(((await field(page, 'lastAward')) as { moves?: string }).moves).toBe('gold');
  await page.keyboard.press('Escape');
  await expect.poll(() => field(page, 'scene')).toBe('Select');
  expect(await field(page, 'master')).toBe('open');

  // master mode: undo does nothing, not even after a restart
  await page.keyboard.press('KeyP');
  await expect.poll(() => field(page, 'scene')).toBe('Game');
  expect(await field(page, 'mode')).toBe('master');
  expect(await field(page, 'canUndo')).toBe(false);
  await play(page, solution.slice(0, 2));
  await expect.poll(() => field(page, 'moves')).toBe(2);
  await page.keyboard.press('KeyU');
  await page.waitForTimeout(200);
  expect(await field(page, 'moves')).toBe(2);
  await page.keyboard.press('KeyR');
  await expect.poll(() => field(page, 'moves')).toBe(0);
  await page.keyboard.press('KeyU');
  await page.waitForTimeout(200);
  expect(await field(page, 'moves')).toBe(0);

  // walking into water loses
  await play(page, drowning());
  await expect.poll(() => field(page, 'status')).toBe('drowned');
  await page.keyboard.press('KeyU');
  await page.waitForTimeout(200);
  expect(await field(page, 'status')).toBe('drowned');

  // a new attempt from scratch, finished within the limit: platinum
  await page.keyboard.press('KeyR');
  await expect.poll(() => field(page, 'moves')).toBe(0);
  await play(page, solution);
  await expect.poll(() => field(page, 'scene')).toBe('Result');
  // the scripted run is fast enough for a time medal too
  expect(await field(page, 'lastAward')).toMatchObject({ moves: 'gold', platinum: true });
  expect(((await field(page, 'lastResult')) as { mode: string }).mode).toBe('master');
});
