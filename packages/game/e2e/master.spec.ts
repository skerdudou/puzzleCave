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
  // master mode has its own third row: platinum moves and the time limit (the bronze time)
  const rows = (await field(page, 'thresholds')) as Rows;
  expect(rows.map((r) => r.kind)).toEqual(['moves', 'time', 'master']);
  expect(rows[0]!.tiers.map((t) => t.medal)).toEqual(['gold', 'silver', 'bronze']);
  const platinum = level.thresholds.platinumMoves ?? gold;
  expect(rows[2]!.tiers).toEqual([{ medal: 'platinum', text: `≤ ${platinum} · ≤ 0:16.00` }]);
  expect(await field(page, 'masterLine')).toBe('');
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
  // the result's master line: where the player stands, not this run
  expect(await field(page, 'resultMasterLine')).toBe('Master: not finished yet');
  await page.keyboard.press('Escape');
  await expect.poll(() => field(page, 'scene')).toBe('Select');
  expect(await field(page, 'master')).toBe('open');
  expect(await field(page, 'masterLine')).toBe('Master: not finished yet');

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
  const last = (await field(page, 'lastResult')) as { mode: string; timeMs: number };
  expect(last.mode).toBe('master');
  // the master line of the result is this run, on its own line
  expect(await field(page, 'resultMasterLine')).toMatch(
    new RegExp(`^Master: ${solution.length} · 0:\\d\\d\\.\\d\\d$`),
  );
  await page.keyboard.press('Escape');
  await expect.poll(() => field(page, 'scene')).toBe('Select');
  expect(await field(page, 'masterLine')).toMatch(
    new RegExp(`^Master: ${solution.length} moves · 0:\\d\\d\\.\\d\\d$`),
  );
});

/** a save where pc-31 has gold (master mode open) and the Medium chapter is open */
async function withMasterOpen(page: Page): Promise<void> {
  const chapters = JSON.parse(read('chapters.json')) as { levels: string[] }[];
  const levels: Record<string, unknown> = {};
  for (const id of [...chapters[0]!.levels, 'pc-19', ID])
    levels[id] = { completed: true, medals: { moves: 'gold' } };
  await page.addInitScript(
    (save) => {
      if (!localStorage.getItem('puzzlecave.save.v1'))
        localStorage.setItem('puzzlecave.save.v1', save);
    },
    JSON.stringify({ version: 1, settings: {}, levels }),
  );
}

/** the page's visibility, as the browser reports it when the app is left (Phaser listens) */
async function setHidden(page: Page, hidden: boolean): Promise<void> {
  await page.evaluate((h) => {
    Object.defineProperty(document, 'hidden', { configurable: true, get: () => h });
    Object.defineProperty(document, 'visibilityState', {
      configurable: true,
      get: () => (h ? 'hidden' : 'visible'),
    });
    document.dispatchEvent(new Event('visibilitychange'));
  }, hidden);
}

test('master mode: a countdown to the bronze time, paused while hidden; past it the run fails', async ({
  page,
}) => {
  // pc-31: goldTime 10 s, so the bronze time is max(10 × 1.5, 10 + 6) = 16 s
  expect(level.thresholds.goldTime).toBe(10);
  const LIMIT = 16_000;
  await page.clock.install();
  await withMasterOpen(page);
  await page.goto('/');
  await expect.poll(() => field(page, 'scene')).toBe('Menu');
  await page.keyboard.press('Enter');
  await expect.poll(() => field(page, 'scene')).toBe('Select');
  await page.keyboard.press('ArrowLeft'); // the selection starts on the first unfinished level
  await expect.poll(() => field(page, 'levelId')).toBe(ID);
  await page.keyboard.press('KeyP');
  await expect.poll(() => field(page, 'scene')).toBe('Game');
  expect(await field(page, 'mode')).toBe('master');
  // before the first move, the whole limit
  expect(await field(page, 'timeLeftMs')).toBe(LIMIT);
  expect(await field(page, 'timeWarn')).toBe(false);

  // from here the page's time only moves when the test says so (a jump, then a few frames)
  await page.clock.pauseAt((await page.evaluate(() => Date.now())) + 1000);
  const after = async (ms: number) => {
    await page.clock.fastForward(ms);
    await page.clock.runFor(50);
  };
  /** the countdown shown: at most `target`, and at most a few frames (70 ms) above the truth */
  const left = async (target: number) => {
    const v = (await field(page, 'timeLeftMs')) as number;
    expect(v).toBeLessThanOrEqual(target + 70);
    expect(v).toBeGreaterThanOrEqual(target);
  };
  await play(page, solution.slice(0, 1));
  expect(await field(page, 'moves')).toBe(1);
  await after(11_500);
  await left(LIMIT - 11_550);
  expect(await field(page, 'timeWarn')).toBe(false);
  await after(1000);
  // the last quarter of a 16 s limit: the countdown warns
  await left(LIMIT - 12_600);
  expect(await field(page, 'timeWarn')).toBe(true);

  // a minute in another app: not counted
  await setHidden(page, true);
  await page.clock.fastForward(60_000);
  await setHidden(page, false);
  await page.clock.runFor(50);
  expect(await field(page, 'status')).toBe('playing');
  await left(LIMIT - 12_650);

  // past the limit: failed, like drowning; moves do nothing more
  await after(3500);
  expect(await field(page, 'status')).toBe('timeout');
  expect(await field(page, 'timeLeftMs')).toBe(0);
  await play(page, solution.slice(1, 2));
  await page.clock.runFor(200);
  expect(await field(page, 'moves')).toBe(1);
  expect(await field(page, 'scene')).toBe('Game');

  // R: a new attempt, a new clock
  await page.keyboard.press('KeyR');
  await page.clock.runFor(50);
  expect(await field(page, 'status')).toBe('playing');
  expect(await field(page, 'moves')).toBe(0);
  expect(await field(page, 'timeLeftMs')).toBe(LIMIT);
  await page.clock.resume();
});

test('normal mode: no time limit, the clock does not count while hidden', async ({ page }) => {
  await page.clock.install();
  await withMasterOpen(page);
  await page.goto('/');
  await expect.poll(() => field(page, 'scene')).toBe('Menu');
  await page.keyboard.press('Enter');
  await expect.poll(() => field(page, 'scene')).toBe('Select');
  await page.keyboard.press('ArrowLeft');
  await expect.poll(() => field(page, 'levelId')).toBe(ID);
  await page.keyboard.press('Enter');
  await expect.poll(() => field(page, 'scene')).toBe('Game');
  expect(await field(page, 'timeLeftMs')).toBeNull();
  await page.clock.pauseAt((await page.evaluate(() => Date.now())) + 1000);
  await play(page, solution.slice(0, 1));
  // past pc-31's bronze time (16 s): nothing happens in normal mode
  await page.clock.fastForward(20_000);
  await page.clock.runFor(50);
  await setHidden(page, true);
  await page.clock.fastForward(60_000);
  await setHidden(page, false);
  await page.clock.runFor(50);
  expect(await field(page, 'status')).toBe('playing');
  await play(page, solution.slice(1));
  await page.clock.runFor(500);
  await expect.poll(() => field(page, 'scene')).toBe('Result');
  // 20.1 s of play: the hidden minute is not in the time
  expect(((await field(page, 'lastResult')) as { timeMs: number }).timeMs).toBe(20_100);
  await page.clock.resume();
});
