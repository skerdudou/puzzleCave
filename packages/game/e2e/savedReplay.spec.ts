import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { expect, test, type Page } from '@playwright/test';
import { initialState, parseMoves, replay, step, type Dir } from '@puzzlecave/core';
import { parseTmx } from '@puzzlecave/tiled';
import { goToLevel } from './select';
import { encodedSave, storedSave } from './storedSave';

const levelsDir = new URL('../../../levels/', import.meta.url);
const read = (name: string) => readFileSync(fileURLToPath(new URL(name, levelsDir)), 'utf8');
const letters = (moves: readonly Dir[]) => moves.map((d) => d[0]!.toUpperCase()).join('');
const solution = parseMoves(read('solutions/pc-01.txt'));
const solutionLetters = letters(solution);
const KEY = { up: 'ArrowUp', down: 'ArrowDown', left: 'ArrowLeft', right: 'ArrowRight' } as const;

type Pc = Record<string, unknown>;
const debug = (page: Page): Promise<Pc> =>
  page.evaluate(() => (window as unknown as { __pc?: Pc }).__pc ?? {});
const field = async (page: Page, k: string) => (await debug(page))[k];
/** The replay's actions for the player (the author's tools, shown in author mode, left out). */
const playerActions = async (page: Page) =>
  ((await field(page, 'replayActions')) as string[]).filter(
    (a) => a !== 'tiled' && a !== 'solution',
  );
// a scene change goes through a fade: always polled
const waitScene = (page: Page, name: string) => expect.poll(() => field(page, 'scene')).toBe(name);
const click = (page: Page, [x, y]: [number, number]) => page.mouse.click(x, y);
const chapters = JSON.parse(read('chapters.json')) as { levels: string[] }[];

test.use({ locale: 'en-US' });

/** Writes a save in the storage before the page loads (only the first time: a reload keeps it). */
async function preload(page: Page, save: unknown): Promise<void> {
  await page.addInitScript((encoded) => {
    if (!localStorage.getItem('puzzlecave.save.v1'))
      localStorage.setItem('puzzlecave.save.v1', encoded);
  }, encodedSave(save));
}

async function toSelect(page: Page): Promise<void> {
  await page.goto('/');
  await waitScene(page, 'Menu');
  await page.keyboard.press('Enter');
  await waitScene(page, 'Select');
}

async function actionButton(page: Page, id: string): Promise<[number, number]> {
  const centres = (await field(page, 'replayActionButtons')) as Record<string, [number, number]>;
  return centres[id]!;
}

test('finish a level, watch the run, save it: the save keeps the moves', async ({ page }) => {
  await toSelect(page);
  await page.keyboard.press('Enter');
  await waitScene(page, 'Game');
  for (const d of solution) await page.keyboard.press(KEY[d]);
  await waitScene(page, 'Result');
  await page.keyboard.press('KeyV');
  await waitScene(page, 'Replay');
  await expect.poll(() => playerActions(page)).toEqual(['save', 'export']);
  // author mode (the development server): the run's tools beside them, none on the result screen
  expect(await field(page, 'replayActions')).toEqual(expect.arrayContaining(['tiled', 'solution']));
  expect((await storedSave(page))?.replays['pc-01']).toBeUndefined();

  await click(page, await actionButton(page, 'save'));
  // the same buttons, Save shown done ("Saved", greyed): no Import or Delete appearing
  await expect.poll(() => field(page, 'replaySaveDone')).toBe(true);
  expect(await playerActions(page)).toEqual(['save', 'export']);
  expect((await storedSave(page))?.replays['pc-01']).toEqual({
    mode: 'normal',
    moves: solutionLetters,
  });
  // pressed again: nothing (it does not ask to replace the replay just saved)
  await click(page, await actionButton(page, 'save'));
  await page.waitForTimeout(300);
  expect(await field(page, 'armed')).toBeNull();
  expect(await field(page, 'replaySaveDone')).toBe(true);
});

test('import a replay for a level without one, then the camera shows it', async ({ page }) => {
  await toSelect(page);
  await expect.poll(() => field(page, 'cameraHasReplay')).toBe(false);
  // the button may still be moving into place: read its position again until the click lands
  await expect(async () => {
    await click(page, (await field(page, 'cameraButton')) as [number, number]);
    // the scene change goes through a fade
    await expect.poll(() => field(page, 'scene'), { timeout: 1500 }).toBe('ImportReplay');
  }).toPass();
  await page.locator('#import-replay-text').fill(solutionLetters);
  await page.getByRole('button', { name: 'Import' }).click();
  await waitScene(page, 'Replay');
  expect((await storedSave(page))?.replays['pc-01']).toEqual({
    mode: 'normal',
    moves: solutionLetters,
  });
  await expect.poll(() => playerActions(page)).toEqual(['export', 'import', 'delete']);

  await page.keyboard.press('Escape');
  await waitScene(page, 'Select');
  await expect.poll(() => field(page, 'cameraHasReplay')).toBe(true);
});

test('importing text that is not a replay: a notice, the page stays open', async ({ page }) => {
  await toSelect(page);
  await page.keyboard.press('KeyV');
  await waitScene(page, 'ImportReplay');
  await page.locator('#import-replay-text').fill('hello');
  await page.getByRole('button', { name: 'Import' }).click();
  await expect.poll(() => field(page, 'notice')).toBe('This text is not a replay');
  expect(await field(page, 'scene')).toBe('ImportReplay');
  await expect(page.locator('#import-replay')).toBeVisible();
  expect((await storedSave(page))?.replays['pc-01']).toBeUndefined();
});

test('Delete asks twice, then the replay is gone', async ({ page }) => {
  await preload(page, {
    version: 2,
    settings: {},
    levels: {},
    replays: { 'pc-01': { mode: 'normal', moves: solutionLetters } },
  });
  await toSelect(page);
  await expect.poll(() => field(page, 'cameraHasReplay')).toBe(true);
  await page.keyboard.press('KeyV');
  await waitScene(page, 'Replay');
  await expect.poll(() => playerActions(page)).toEqual(['export', 'import', 'delete']);

  await click(page, await actionButton(page, 'delete'));
  await expect.poll(() => field(page, 'armed')).toBe('delete');
  expect((await storedSave(page))?.replays['pc-01']).toBeDefined();

  await click(page, await actionButton(page, 'delete'));
  await waitScene(page, 'Select');
  await expect.poll(async () => (await storedSave(page))?.replays['pc-01']).toBeUndefined();
  await expect.poll(() => field(page, 'cameraHasReplay')).toBe(false);
});

// pc-31 (Medium chapter): a prefix of its solution, then a move into water
const WATER_ID = 'pc-31';
const waterLevel = parseTmx(read(`${WATER_ID}.tmx`), WATER_ID, (src) => read(src));
const waterSolution = parseMoves(read(`solutions/${WATER_ID}.txt`));

function drowningMoves(): Dir[] {
  const dirs: Dir[] = ['up', 'down', 'left', 'right'];
  for (let k = 0; k <= waterSolution.length; k++) {
    const prefix = waterSolution.slice(0, k);
    const s = k === 0 ? initialState(waterLevel, 'master') : replay(waterLevel, prefix, 'master');
    const d = dirs.find((d) => step(s, d).state.status === 'drowned');
    if (d) return [...prefix, d];
  }
  throw new Error(`${WATER_ID}: no water next to the solution path`);
}

/** Records that open the Medium chapter (gold on the Easy chapter's levels and on pc-19). */
function mediumOpenLevels(): Record<string, unknown> {
  const levels: Record<string, unknown> = {};
  for (const id of [...chapters[0]!.levels, 'pc-19'])
    levels[id] = { completed: true, medals: { moves: 'gold' } };
  return levels;
}

for (const mode of ['master', 'normal'] as const) {
  test(`a stored ${mode} replay walking into water is replayed under ${mode} rules`, async ({
    page,
  }) => {
    const moves = drowningMoves();
    await preload(page, {
      version: 2,
      settings: {},
      levels: mediumOpenLevels(),
      replays: { [WATER_ID]: { mode, moves: letters(moves) } },
    });
    await toSelect(page);
    await goToLevel(page, WATER_ID);
    await expect.poll(() => field(page, 'cameraHasReplay')).toBe(true);
    await page.keyboard.press('KeyV');
    await waitScene(page, 'Replay');
    // it opens paused; played, it goes to the end by itself
    await expect.poll(() => field(page, 'replayPlaying')).toBe(false);
    await page.keyboard.press('Space');
    await expect.poll(() => field(page, 'replayIndex'), { timeout: 30_000 }).toBe(moves.length);
    // water drowns the hero in master mode; in normal mode the move is only blocked
    await expect
      .poll(() => field(page, 'replayStatus'))
      .toBe(mode === 'master' ? 'drowned' : 'playing');
  });
}
