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

/** Opens the pc-21 solution replay, rewound and paused at move 0. */
async function openReplayPaused(page: Page) {
  await page.goto('/');
  await expect.poll(async () => (await debug(page)).scene).toBe('Menu');
  await page.keyboard.press('Enter');
  await expect.poll(async () => (await debug(page)).scene).toBe('Select');
  await page.keyboard.press('ArrowRight');
  await page.keyboard.press('ArrowRight');
  await expect.poll(async () => (await debug(page)).levelId).toBe('pc-21');
  await page.keyboard.press('KeyS');
  await expect.poll(async () => (await debug(page)).scene).toBe('Replay');
  await page.keyboard.press('Home');
  // __pc is only refreshed by the scene's update(): wait for the first snapshot after Home
  await expect
    .poll(async () => {
      const d = await debug(page);
      return [d.replayIndex, d.replayPlaying];
    })
    .toEqual([0, false]);
}

test('the solution replay shows the keys in hand at each move', async ({ page }) => {
  // expected keys after each move, from the rules
  let s = initialState(level);
  const expected = [s.keys];
  for (const d of moves) {
    s = step(s, d).state;
    expected.push(s.keys);
  }
  expect(new Set(expected).size).toBeGreaterThan(1); // the count changes along the way

  await openReplayPaused(page);
  expect((await debug(page)).replayKeys).toBe(expected[0]);
  for (let i = 1; i <= moves.length; i++) {
    await page.keyboard.press('ArrowRight');
    await expect.poll(async () => (await debug(page)).replayIndex).toBe(i);
    expect((await debug(page)).replayKeys, `after move ${i}`).toBe(expected[i]);
  }
});

test('two ArrowRight presses arriving within one frame advance exactly two moves', async ({
  page,
}) => {
  await openReplayPaused(page);
  // A loaded machine: the main thread is busy while the user presses twice, so the four
  // trusted key events are delivered back to back before the next game step.
  const cdp = await page.context().newCDPSession(page);
  const key = (type: 'keyDown' | 'keyUp') =>
    cdp.send('Input.dispatchKeyEvent', {
      type,
      key: 'ArrowRight',
      code: 'ArrowRight',
      windowsVirtualKeyCode: 39,
      nativeVirtualKeyCode: 39,
    });
  await page.evaluate(() => {
    setTimeout(() => {
      const t = performance.now();
      while (performance.now() - t < 400);
    }, 0);
  });
  await page.waitForTimeout(50);
  await Promise.all([key('keyDown'), key('keyUp'), key('keyDown'), key('keyUp')]);
  // let several frames run after the burst
  await page.waitForTimeout(300);
  expect((await debug(page)).replayIndex).toBe(2);
});
