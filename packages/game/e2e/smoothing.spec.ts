import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { expect, test, type Page } from '@playwright/test';
import { initialState, parseMoves, step, type Dir, type GameState } from '@puzzlecave/core';
import { loadPack } from '@puzzlecave/tiled';
import { wallMask, wallTexture } from '../src/render/autotile';
import { shoreAt, shoreTexture } from '../src/render/shore';
import { SAVE_KEY } from '../src/save';
import { encodedSave } from './storedSave';
import { goToLevel } from './select';

type Pc = {
  scene?: string;
  boardTerrain?: string | null;
  boardTiles?: string[] | null;
  replayBar?: { x: number; y: number; w: number };
  replayIndex?: number;
  replayTotal?: number;
};
const debug = (page: Page): Promise<Pc> =>
  page.evaluate(() => (window as unknown as { __pc?: Pc }).__pc ?? {});
const KEY = { up: 'ArrowUp', down: 'ArrowDown', left: 'ArrowLeft', right: 'ArrowRight' } as const;

// The saved solution whose first block sinks soonest: the level, and its moves up to that sink
const levelsDir = fileURLToPath(new URL('../../../levels', import.meta.url));
const sinking = (() => {
  let best: { id: string; moves: Dir[]; after: GameState } | null = null;
  for (const level of loadPack(levelsDir).levels) {
    const file = `${levelsDir}/solutions/${level.id}.txt`;
    if (!existsSync(file)) continue;
    let s = initialState(level);
    const moves = parseMoves(readFileSync(file, 'utf8'));
    for (let i = 0; i < moves.length && (!best || i < best.moves.length); i++) {
      const r = step(s, moves[i]!);
      s = r.state;
      if (r.events.some((e) => e.type === 'blockSank')) {
        best = { id: level.id, moves: moves.slice(0, i + 1), after: s };
        break;
      }
    }
  }
  if (!best) throw new Error('no saved solution sinks a block: e2e/smoothing.spec.ts needs one');
  return best;
})();

/** Each cell's texture for a state, as the board draws it unsmoothed (walls' joins, water's banks). */
function tilesOf(s: GameState): string[] {
  const is = (kind: string) => (x: number, y: number) =>
    x >= 0 && y >= 0 && x < s.width && y < s.height && s.terrain[y * s.width + x] === kind;
  return s.terrain.map((t, i) => {
    const [x, y] = [i % s.width, Math.floor(i / s.width)];
    if (t === 'wall') return wallTexture(wallMask(is('wall'), x, y));
    if (t === 'water') return shoreTexture(shoreAt(is('water'), x, y));
    return t.toUpperCase();
  });
}

async function open(page: Page, smoothing: boolean, errors: string[]): Promise<void> {
  page.on('pageerror', (e) => errors.push(e.message));
  await page.addInitScript(
    ([k, v]) => localStorage.setItem(k!, v!),
    [SAVE_KEY, encodedSave({ version: 2, settings: { smoothing }, levels: {}, achievements: {} })],
  );
  await page.goto('/');
  await expect.poll(async () => (await debug(page)).scene).toBe('Menu');
  await page.keyboard.press('Enter');
  await goToLevel(page, sinking.id);
}

test('smoothing on: a block sinks, the terrain is smoothed again; undone, it is back as it was', async ({
  page,
}) => {
  const errors: string[] = [];
  await open(page, true, errors);
  await page.keyboard.press('Enter');
  await expect.poll(async () => (await debug(page)).scene).toBe('Game');
  const start = (await debug(page)).boardTerrain;
  expect(start).toBeTruthy();
  for (const d of sinking.moves) await page.keyboard.press(KEY[d]);
  await expect.poll(async () => (await debug(page)).boardTerrain).not.toBe(start);
  await page.keyboard.press('KeyU');
  await expect.poll(async () => (await debug(page)).boardTerrain).toBe(start);
  expect(errors).toEqual([]);
});

test("smoothing off: a block sinks, the cell and the water's banks around it change", async ({
  page,
}) => {
  const errors: string[] = [];
  await open(page, false, errors);
  await page.keyboard.press('Enter');
  await expect.poll(async () => (await debug(page)).scene).toBe('Game');
  expect((await debug(page)).boardTerrain).toBeNull();
  for (const d of sinking.moves) await page.keyboard.press(KEY[d]);
  await expect.poll(async () => (await debug(page)).boardTiles).toEqual(tilesOf(sinking.after));
  expect(errors).toEqual([]);
});

test('smoothing on: the replay bar jumps over a block sinking, back and forth', async ({
  page,
}) => {
  const errors: string[] = [];
  await open(page, true, errors);
  await page.keyboard.press('KeyS');
  await expect.poll(async () => (await debug(page)).scene).toBe('Replay');
  await page.keyboard.press('Home');
  await expect.poll(async () => (await debug(page)).replayIndex).toBe(0);
  const start = (await debug(page)).boardTerrain;
  const bar = (await debug(page)).replayBar!;
  await page.mouse.click(bar.x + bar.w, bar.y);
  await expect.poll(async () => (await debug(page)).boardTerrain).not.toBe(start);
  await page.mouse.click(bar.x, bar.y);
  await expect.poll(async () => (await debug(page)).replayIndex).toBe(0);
  await expect.poll(async () => (await debug(page)).boardTerrain).toBe(start);
  expect(errors).toEqual([]);
});
