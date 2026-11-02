import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { expect, test, type Page } from '@playwright/test';
import { FRAME_MS } from './fps';
import { goToLevel } from './select';
import { encodedSave, storedSave } from './storedSave';

const chapters = JSON.parse(
  readFileSync(fileURLToPath(new URL('../../../levels/chapters.json', import.meta.url)), 'utf8'),
) as { id: string; levels: string[] }[];
const easy = chapters.find((c) => c.id === 'easy')!.levels;
const expert = chapters.find((c) => c.id === 'expert')!.levels;

type Row = { earned: boolean; secret: boolean; progress?: string };
type Pc = {
  scene?: string;
  unlocked?: boolean[];
  konami?: boolean;
  toast?: string;
  moves?: number;
  buttons?: Record<string, [number, number]>;
  achievementRows?: Record<string, Row>;
};
const debug = (page: Page): Promise<Pc> =>
  page.evaluate(() => (window as unknown as { __pc?: Pc }).__pc ?? {});
const earned = async (page: Page) => Object.keys((await storedSave(page))?.achievements ?? {});

const KONAMI = [
  'ArrowUp',
  'ArrowUp',
  'ArrowDown',
  'ArrowDown',
  'ArrowLeft',
  'ArrowRight',
  'ArrowLeft',
  'ArrowRight',
  'b',
  'a',
];

test.use({ locale: 'en-US' });

test('the Konami code on the menu: the achievement, and every chapter opens', async ({ page }) => {
  await page.goto('/');
  await expect.poll(async () => (await debug(page)).scene).toBe('Menu');
  // the dev server opens author mode (every tile playable): the rule is read from the tiles' state
  await page.keyboard.press('Enter');
  await goToLevel(page, expert[0]!);
  expect((await debug(page)).unlocked!.slice(0, 2)).toEqual([false, false]);
  await page.keyboard.press('Escape');
  await expect.poll(async () => (await debug(page)).scene).toBe('Menu');

  for (const k of KONAMI) await page.keyboard.press(k);
  await expect.poll(async () => (await debug(page)).konami).toBe(true);
  await expect.poll(() => earned(page)).toContain('konami');
  expect((await debug(page)).toast).toBe('Achievement unlocked: Old School');

  // kept: after a reload too
  await page.reload();
  await expect.poll(async () => (await debug(page)).scene).toBe('Menu');
  await page.keyboard.press('Enter');
  await expect.poll(async () => (await debug(page)).scene).toBe('Select');
  // the selection still opens where the player's progress is
  expect((await debug(page)).unlocked!.slice(0, 3)).toEqual([true, true, false]);
  await goToLevel(page, expert[0]!);
  // open like a chapter reached by playing: its first two levels
  expect((await debug(page)).unlocked!.slice(0, 3)).toEqual([true, true, false]);
});

test('a save from before the achievements: what its records earn, on the achievements screen', async ({
  page,
}) => {
  const levels = Object.fromEntries(
    easy.map((id) => [id, { completed: true, bestMoves: 1, medals: { moves: 'gold' } }]),
  );
  await page.addInitScript(
    (save) => {
      if (!localStorage.getItem('puzzlecave.save.v1'))
        localStorage.setItem('puzzlecave.save.v1', save);
    },
    encodedSave({ version: 2, settings: {}, levels }),
  );
  await page.goto('/');
  await expect.poll(async () => (await debug(page)).scene).toBe('Menu');
  await expect
    .poll(() => earned(page))
    .toEqual(expect.arrayContaining(['done:easy', 'gold:easy', 'gold1', 'gold10']));
  // earned at start, without a toast for each
  expect((await debug(page)).toast).toBeUndefined();

  const [x, y] = (await debug(page)).buttons!.achievements!;
  await page.mouse.click(x, y);
  await expect.poll(async () => (await debug(page)).scene).toBe('Achievements');
  const rows = (await debug(page)).achievementRows!;
  expect(rows['gold:easy']).toEqual({ earned: true, secret: false });
  expect(rows['gold:medium']!.earned).toBe(false);
  expect(rows['gold:medium']!.progress).toMatch(/^0 \/ \d+$/);
  expect(rows['gold25']!.progress).toBe(`${easy.length} / 25`);
  expect(rows['konami']).toEqual({ earned: false, secret: true });
  expect(rows['deepThought']).toEqual({ earned: false, secret: true });
  await page.keyboard.press('Escape');
  await expect.poll(async () => (await debug(page)).scene).toBe('Menu');
});

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

test('Deep Thought: a minute of play without a move; the time away does not count', async ({
  page,
}) => {
  await page.clock.install();
  await page.goto('/');
  await expect.poll(async () => (await debug(page)).scene).toBe('Menu');
  await page.keyboard.press('Enter');
  await goToLevel(page, easy[0]!);
  await page.keyboard.press('Enter');
  await expect.poll(async () => (await debug(page)).scene).toBe('Game');

  const RUN = Math.max(50, Math.ceil(2 * FRAME_MS));
  await page.clock.pauseAt((await page.evaluate(() => Date.now())) + 1000);
  // before the first move: no clock, nothing counts
  await page.clock.fastForward(90_000);
  await page.clock.runFor(RUN);
  expect(await earned(page)).not.toContain('deepThought');

  const before = (await debug(page)).moves ?? 0;
  for (const k of ['ArrowRight', 'ArrowLeft', 'ArrowUp', 'ArrowDown']) {
    await page.keyboard.press(k);
    await page.clock.runFor(RUN);
    if (((await debug(page)).moves ?? 0) > before) break;
  }
  expect((await debug(page)).moves).toBeGreaterThan(before);

  // two minutes in another app: not thinking
  await setHidden(page, true);
  await page.clock.fastForward(120_000);
  await setHidden(page, false);
  await page.clock.runFor(RUN);
  expect(await earned(page)).not.toContain('deepThought');

  await page.clock.fastForward(61_000);
  await page.clock.runFor(RUN);
  await expect.poll(() => earned(page)).toContain('deepThought');
  expect((await debug(page)).toast).toBe('Achievement unlocked: Deep Thought');
});
