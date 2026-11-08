import { expect, test, type Page } from '@playwright/test';
import { goToLevel } from './select';
import { encodedSave } from './storedSave';

type Pc = {
  scene?: string;
  levelId?: string;
  moves?: number;
  banner?: string[] | null;
  bannerAt?: [number, number];
  keysLine?: string | null;
  boardLayout?: { y: number };
};
const debug = (page: Page): Promise<Pc> =>
  page.evaluate(() => (window as unknown as { __pc?: Pc }).__pc ?? {});
const scene = async (page: Page) => (await debug(page)).scene;

test.use({ locale: 'en-US' });

/** the selection screen with `levels` as the save's records */
async function select(page: Page, levels: Record<string, unknown> = {}): Promise<void> {
  await page.addInitScript(
    (save) => {
      if (!localStorage.getItem('puzzlecave.save.v1'))
        localStorage.setItem('puzzlecave.save.v1', save);
    },
    encodedSave({ version: 2, settings: {}, levels }),
  );
  await page.goto('/');
  await expect.poll(() => scene(page)).toBe('Menu');
  await page.keyboard.press('Enter');
  await expect.poll(() => scene(page)).toBe('Select');
}

test('keys at start: said on the selection and in a banner over the board; Space hides it', async ({
  page,
}) => {
  await select(page);
  await goToLevel(page, 'pc-04');
  expect((await debug(page)).keysLine).toBe('Keys at start: 2');
  await page.keyboard.press('Enter');
  await expect.poll(() => scene(page)).toBe('Game');
  await expect.poll(async () => (await debug(page)).banner).toEqual(['Keys at start: 2']);
  // over the board: the board keeps its place and zoom, with or without it
  const withBanner = (await debug(page)).boardLayout;
  await page.keyboard.press(' ');
  await expect.poll(async () => (await debug(page)).banner).toBeNull();
  expect((await debug(page)).moves).toBe(0);
  expect((await debug(page)).boardLayout).toEqual(withBanner);
});

test('a level without keys at start, in normal mode: no banner', async ({ page }) => {
  await select(page);
  expect((await debug(page)).keysLine).toBeNull();
  await page.keyboard.press('Enter');
  await expect.poll(() => scene(page)).toBe('Game');
  expect((await debug(page)).banner).toBeNull();
});

test('master mode: the whole rules (and the key of pc-31), hidden by a click', async ({ page }) => {
  await select(page, { 'pc-31': { completed: true, bestMoves: 1, medals: { moves: 'gold' } } });
  await goToLevel(page, 'pc-31');
  await page.keyboard.press('KeyP');
  await expect.poll(() => scene(page)).toBe('Game');
  await expect
    .poll(async () => (await debug(page)).banner)
    .toEqual([
      'Master mode: no undo, water is deadly',
      'Finish within 0:27.20 (bronze time)',
      'Keys at start: 1',
    ]);
  const [x, y] = (await debug(page)).bannerAt!;
  await page.mouse.click(x, y);
  await expect.poll(async () => (await debug(page)).banner).toBeNull();
  expect((await debug(page)).moves).toBe(0);
});

test('master mode, for a player who has won a master run: the rules on one short line', async ({
  page,
}) => {
  await select(page, {
    'pc-31': { completed: true, bestMoves: 1, medals: { moves: 'gold', master: 'master' } },
  });
  await goToLevel(page, 'pc-31');
  await page.keyboard.press('KeyP');
  await expect.poll(() => scene(page)).toBe('Game');
  await expect
    .poll(async () => (await debug(page)).banner)
    .toEqual(['♛ No undo · deadly water · ≤ 0:27.20', 'Keys at start: 1']);
  // the first move hides it too
  await page.keyboard.press('ArrowRight');
  await expect.poll(async () => (await debug(page)).banner).toBeNull();
});
