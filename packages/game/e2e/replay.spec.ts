import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { expect, test, type Page } from '@playwright/test';
import { initialState, parseMoves, step } from '@puzzlecave/core';
import { loadPack } from '@puzzlecave/tiled';
import { goToLevel } from './select';

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
  await goToLevel(page, 'pc-21');
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

test('the solution replay opens paused at move 0, with Export as its action', async ({ page }) => {
  await page.goto('/');
  await expect.poll(async () => (await debug(page)).scene).toBe('Menu');
  await page.keyboard.press('Enter');
  await goToLevel(page, 'pc-21');
  await page.keyboard.press('KeyS');
  await expect.poll(async () => (await debug(page)).scene).toBe('Replay');
  await expect
    .poll(async () => {
      const d = await debug(page);
      return [d.replayIndex, d.replayPlaying, d.replayActions];
    })
    .toEqual([0, false, ['export']]);
  // still there a moment later: nothing plays by itself
  await page.waitForTimeout(500);
  expect((await debug(page)).replayIndex).toBe(0);
});

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

test('the progress bar: pressed halfway, the replay goes to the middle move', async ({ page }) => {
  await openReplayPaused(page);
  const bar = (await debug(page)).replayBar as { x: number; y: number; w: number };
  await page.mouse.click(bar.x + bar.w / 2, bar.y);
  await expect.poll(async () => (await debug(page)).replayIndex).toBe(Math.round(moves.length / 2));
  // dragged to the end: the last move
  await page.mouse.move(bar.x + bar.w / 2, bar.y);
  await page.mouse.down();
  await page.mouse.move(bar.x + bar.w + 30, bar.y, { steps: 5 });
  await page.mouse.up();
  await expect.poll(async () => (await debug(page)).replayIndex).toBe(moves.length);
});

test('▶ held down: several moves, until released', async ({ page }) => {
  await openReplayPaused(page);
  const [x, y] = ((await debug(page)).replayStepButtons as Record<string, [number, number]>)
    .forward!;
  await page.mouse.move(x, y);
  await page.mouse.down();
  await expect.poll(async () => (await debug(page)).replayIndex).toBeGreaterThanOrEqual(3);
  await page.mouse.up();
  // the debug state is written once a frame: a move made just before the release shows on the next
  await page.waitForTimeout(150);
  const stopped = (await debug(page)).replayIndex;
  await page.waitForTimeout(400);
  expect((await debug(page)).replayIndex).toBe(stopped);
  expect((await debug(page)).replayPlaying).toBe(false);
});
