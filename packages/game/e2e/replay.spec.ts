import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { expect, test, type Page } from '@playwright/test';
import { initialState, parseMoves, step } from '@puzzlecave/core';
import { loadPack } from '@puzzlecave/tiled';

const levelsDir = fileURLToPath(new URL('../../../levels', import.meta.url));
// Keyring: starts with one key, picks up two more
const level = loadPack(levelsDir).levels.find((l) => l.id === 'pc-21')!;
const moves = parseMoves(readFileSync(`${levelsDir}/solutions/pc-21.txt`, 'utf8'));
const debug = (page: Page) =>
  page.evaluate(() => (window as unknown as { __pc?: Record<string, unknown> }).__pc ?? {});

test('the solution replay shows the keys in hand at each move', async ({ page }) => {
  // expected keys after each move, from the rules
  let s = initialState(level);
  const expected = [s.keys];
  for (const d of moves) {
    s = step(s, d).state;
    expected.push(s.keys);
  }
  expect(new Set(expected).size).toBeGreaterThan(1); // the count changes along the way

  await page.goto('/');
  await expect.poll(async () => (await debug(page)).scene).toBe('Menu');
  await page.keyboard.press('Enter');
  await expect.poll(async () => (await debug(page)).scene).toBe('Select');
  await page.keyboard.press('ArrowRight');
  await page.keyboard.press('ArrowRight');
  await expect.poll(async () => (await debug(page)).levelId).toBe('pc-21');
  await page.keyboard.press('KeyS');
  await expect.poll(async () => (await debug(page)).scene).toBe('Replay');
  // playback starts playing: wait until Home has really been applied (paused at 0)
  await page.keyboard.press('Home');
  await expect
    .poll(async () => {
      const d = await debug(page);
      return [d.replayIndex, d.replayPlaying];
    })
    .toEqual([0, false]);
  expect((await debug(page)).replayKeys).toBe(expected[0]);
  for (let i = 1; i <= moves.length; i++) {
    await page.keyboard.press('ArrowRight');
    await expect.poll(async () => (await debug(page)).replayIndex).toBe(i);
    expect((await debug(page)).replayKeys, `after move ${i}`).toBe(expected[i]);
  }
});
