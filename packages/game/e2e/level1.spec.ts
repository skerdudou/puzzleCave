import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { expect, test, type Page } from '@playwright/test';
import { parseMoves } from '@puzzlecave/core';

const solution = parseMoves(
  readFileSync(
    fileURLToPath(new URL('../../../levels/solutions/pc-01.txt', import.meta.url)),
    'utf8',
  ),
);
const KEY = { up: 'ArrowUp', down: 'ArrowDown', left: 'ArrowLeft', right: 'ArrowRight' } as const;
const LETTER = { up: 'KeyW', down: 'KeyS', left: 'KeyA', right: 'KeyD' } as const;
const debug = (page: Page) =>
  page.evaluate(() => (window as unknown as { __pc?: Record<string, unknown> }).__pc ?? {});
const scene = async (page: Page) => (await debug(page)).scene;

async function startPc01(page: Page): Promise<void> {
  await page.goto('/');
  await expect.poll(() => scene(page)).toBe('Menu');
  await page.keyboard.press('Enter');
  await expect.poll(() => scene(page)).toBe('Select');
  await page.keyboard.press('Enter');
  await expect.poll(() => scene(page)).toBe('Game');
  expect((await debug(page)).levelId).toBe('pc-01');
}

test('finish pc-01 with the keyboard, at full speed', async ({ page }) => {
  await startPc01(page);
  for (const d of solution) await page.keyboard.press(KEY[d]);
  await expect.poll(() => scene(page)).toBe('Result');
  expect(((await debug(page)).lastResult as { moves: number }).moves).toBe(solution.length);
});

test('physical keys KeyW/KeyA/KeyS/KeyD accepted', async ({ page }) => {
  await startPc01(page);
  for (const d of solution) await page.keyboard.press(LETTER[d]);
  await expect.poll(() => scene(page)).toBe('Result');
  expect(((await debug(page)).lastResult as { moves: number }).moves).toBe(solution.length);
});

test('U undoes the last move', async ({ page }) => {
  await startPc01(page);
  await page.keyboard.press(KEY[solution[0]!]);
  await page.keyboard.press('KeyU');
  for (const d of solution) await page.keyboard.press(KEY[d]);
  await expect.poll(() => scene(page)).toBe('Result');
  expect(((await debug(page)).lastResult as { moves: number }).moves).toBe(solution.length);
});
