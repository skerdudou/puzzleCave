import { expect, test, type Page } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const chapters = JSON.parse(
  readFileSync(fileURLToPath(new URL('../../../levels/chapters.json', import.meta.url)), 'utf8'),
) as { levels: string[] }[];
const easy = chapters[0]!.levels;

type Pc = { scene?: string; levelId?: string; unlocked?: boolean[] };
const debug = (page: Page): Promise<Pc> =>
  page.evaluate(() => (window as unknown as { __pc?: Pc }).__pc ?? {});

test('fresh save: levels 1 and 2 of Easy are playable, level 3 is locked', async ({ page }) => {
  await page.goto('/');
  await expect.poll(async () => (await debug(page)).scene).toBe('Menu');
  await page.keyboard.press('Enter');
  await expect.poll(async () => (await debug(page)).scene).toBe('Select');
  expect((await debug(page)).levelId).toBe(easy[0]);

  // the dev server opens author mode (every tile playable): the progression rule is read from
  // the tiles' state instead
  const unlocked = (await debug(page)).unlocked!;
  expect(unlocked.slice(0, 4)).toEqual([true, true, false, false]);

  // playable although level 1 is not completed
  await page.keyboard.press('ArrowRight');
  await expect.poll(async () => (await debug(page)).levelId).toBe(easy[1]);
  await page.keyboard.press('Enter');
  await expect.poll(async () => (await debug(page)).scene).toBe('Game');
  expect((await debug(page)).levelId).toBe(easy[1]);
});
