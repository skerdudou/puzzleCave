import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { expect, test, type Page } from '@playwright/test';
import { initialState, parseMoves, replay, step, type Dir } from '@puzzlecave/core';
import { parseTmx } from '@puzzlecave/tiled';
import { exportSave, importSave } from '../src/save';
import { goToLevel } from './select';
import { encodedSave, storedSave } from './storedSave';

const SAVE_KEY = 'puzzlecave.save.v1';
const debug = (page: Page) =>
  page.evaluate(() => (window as unknown as { __pc?: Record<string, unknown> }).__pc ?? {});
const field = async (page: Page, k: string) => (await debug(page))[k];
const button = async (page: Page, id: string) =>
  ((await field(page, 'buttons')) as Record<string, [number, number]>)[id]!;
// typed loosely, like the JSON the storage held before
const stored = async (page: Page): Promise<any> => storedSave(page);
const press = async (page: Page, ...keys: string[]) => {
  for (const k of keys) await page.keyboard.press(k);
};

/** a save with pc-01 done in gold, written before the game starts */
async function withProgress(page: Page): Promise<void> {
  await page.addInitScript(
    ({ key, save }) => {
      if (!localStorage.getItem(key)) localStorage.setItem(key, save);
    },
    {
      key: SAVE_KEY,
      save: encodedSave({
        version: 1,
        settings: {},
        levels: { 'pc-01': { completed: true, bestMoves: 26, medals: { moves: 'gold' } } },
      }),
    },
  );
}

async function openOptionsByKeyboard(page: Page): Promise<void> {
  await page.goto('/');
  await expect.poll(() => field(page, 'scene')).toBe('Menu');
  // the arrows go from Play to Options, Enter presses it
  await press(page, 'ArrowDown', 'ArrowDown', 'Enter');
  await expect.poll(() => field(page, 'scene')).toBe('Options');
}

test('menu and options from the keyboard: focus, toggles, language', async ({ page }) => {
  await openOptionsByKeyboard(page);
  expect(await field(page, 'focus')).toBeUndefined();
  // Tab: the language first, then the music volume's gauge, then the effects'; ← moves its knob
  // a notch down, the focus stays on it
  await press(page, 'Tab');
  await expect.poll(() => field(page, 'focus')).toBe('lang');
  await press(page, 'Tab', 'Tab');
  await expect.poll(() => field(page, 'focus')).toBe('sfx');
  await press(page, 'ArrowLeft');
  await expect.poll(async () => (await stored(page))?.settings.sfxVolume).toBe(90);
  await expect.poll(() => field(page, 'focus')).toBe('sfx');
  // back to the language list, opened on the current language; the arrows pick another one
  await press(page, 'Shift+Tab', 'Shift+Tab');
  await expect.poll(() => field(page, 'focus')).toBe('lang');
  await press(page, 'Enter');
  await expect.poll(() => field(page, 'langMenuOpen')).toBe(true);
  await press(page, 'ArrowDown', 'Enter'); // en → fr
  await expect.poll(() => field(page, 'lang')).toBe('fr');
  expect(await page.evaluate(() => document.documentElement.lang)).toBe('fr');
  // Escape leaves for the menu, where Enter alone still plays
  await press(page, 'Escape');
  await expect.poll(() => field(page, 'scene')).toBe('Menu');
  await press(page, 'Enter');
  await expect.poll(() => field(page, 'scene')).toBe('Select');
});

test('progress: erased only on a second press', async ({ page }) => {
  await withProgress(page);
  await page.setViewportSize({ width: 1280, height: 900 });
  await openOptionsByKeyboard(page);
  const [ex, ey] = await button(page, 'erase');
  const [ix, iy] = await button(page, 'import');
  await page.mouse.click(ex, ey);
  await expect.poll(() => field(page, 'armed')).toBe('erase');
  // another button that asks takes over: Erase asks again from the start
  await page.mouse.click(ix, iy);
  await expect.poll(() => field(page, 'armed')).toBe('import');
  await page.mouse.click(ex, ey);
  await expect.poll(() => field(page, 'armed')).toBe('erase');
  expect((await stored(page)).levels['pc-01'].completed).toBe(true);
  await page.mouse.click(ex, ey);
  await expect.poll(async () => (await stored(page)).levels).toEqual({});
  expect(await field(page, 'notice')).toBe('Progress erased');
});

test('progress: exported to an encoded file, imported back after a confirmation; an unreadable or altered file changes nothing', async ({
  page,
}) => {
  await withProgress(page);
  await page.setViewportSize({ width: 1280, height: 900 });
  await openOptionsByKeyboard(page);

  const download = page.waitForEvent('download');
  const [xx, xy] = await button(page, 'export');
  await page.mouse.click(xx, xy);
  const file = await download;
  expect(file.suggestedFilename()).toMatch(/^puzzlecave-\d{4}-\d\d-\d\d\.save$/);
  const text = readFileSync(await file.path(), 'utf8');
  expect(text).not.toContain('bestMoves');
  const exported = importSave(text);
  expect(exported.levels['pc-01']!.bestMoves).toBe(26);

  const [ix, iy] = await button(page, 'import');
  // a first press only asks
  await page.mouse.click(ix, iy);
  await expect.poll(() => field(page, 'armed')).toBe('import');
  expect(await field(page, 'importPicker')).toBeUndefined();
  // Import opens the file dialog of a hidden input; the file is handed to that input directly
  // (Playwright's interception of the dialog itself proved unreliable on a loaded machine)
  let n = 0;
  const choose = async (text: string, confirmed = false) => {
    if (!confirmed) {
      await page.mouse.click(ix, iy);
      await expect.poll(() => field(page, 'armed')).toBe('import');
    }
    await page.mouse.click(ix, iy);
    await expect.poll(() => field(page, 'importPicker')).toBe(++n);
    expect(await field(page, 'armed')).toBeNull();
    await page.setInputFiles('#import-save', {
      name: 'save.save',
      mimeType: 'application/octet-stream',
      buffer: Buffer.from(text),
    });
  };
  await choose('{ not json', true);
  await expect.poll(() => field(page, 'notice')).toBe('Unreadable file: nothing changed');
  expect((await stored(page)).levels['pc-01'].bestMoves).toBe(26);

  // a byte changed in the encoded file: refused by the hash
  const [head, body] = text.split('\n') as [string, string];
  const altered = `${head}\n${body[0] === 'A' ? 'B' : 'A'}${body.slice(1)}\n`;
  await choose(altered);
  await expect.poll(() => field(page, 'notice')).toBe('Unreadable file: nothing changed');
  expect((await stored(page)).levels['pc-01'].bestMoves).toBe(26);

  exported.levels['pc-01']!.bestMoves = 20;
  exported.settings.lang = 'de';
  await choose(exportSave(exported));
  await expect.poll(() => field(page, 'lang')).toBe('de');
  expect((await stored(page)).levels['pc-01'].bestMoves).toBe(20);
  expect(await field(page, 'notice')).toBe('Fortschritt importiert');
});

test('a save that cannot be written is told once', async ({ page }) => {
  await page.addInitScript((key) => {
    const set = Storage.prototype.setItem;
    Storage.prototype.setItem = function (k: string, v: string) {
      if (k === key) throw new DOMException('full', 'QuotaExceededError');
      return set.call(this, k, v);
    };
  }, SAVE_KEY);
  await page.setViewportSize({ width: 1280, height: 900 });
  await openOptionsByKeyboard(page);
  await press(page, 'Tab', 'Tab', 'ArrowLeft'); // the music a notch down: saved, or not
  await expect.poll(() => field(page, 'saveFailed')).toBe(true);
  expect(await field(page, 'notice')).toMatch(/^Cannot save on this device/);
});

// pc-31: master mode exists there (Medium chapter)
const ID = 'pc-31';
const levelsDir = new URL('../../../levels/', import.meta.url);
const read = (name: string) => readFileSync(fileURLToPath(new URL(name, levelsDir)), 'utf8');

/** a prefix of the solution then one move that walks into water (master mode: drowned) */
function drowning(): Dir[] {
  const level = parseTmx(read(`${ID}.tmx`), ID, (src) => read(src));
  const solution = parseMoves(read(`solutions/${ID}.txt`));
  const dirs: Dir[] = ['up', 'down', 'left', 'right'];
  for (let k = 0; k <= solution.length; k++) {
    const prefix = solution.slice(0, k);
    const s = k === 0 ? initialState(level, 'master') : replay(level, prefix, 'master');
    const d = dirs.find((d) => step(s, d).state.status === 'drowned');
    if (d) return [...prefix, d];
  }
  throw new Error(`${ID}: no water next to the solution path`);
}

test.describe('touch screen', () => {
  test.use({ viewport: { width: 400, height: 740 }, hasTouch: true });

  test('the sound button in a level mutes everything, then brings it back (saved)', async ({
    page,
  }) => {
    await page.goto('/');
    await expect.poll(() => field(page, 'scene')).toBe('Menu');
    await press(page, 'Enter');
    await expect.poll(() => field(page, 'scene')).toBe('Select');
    await press(page, 'Enter');
    await expect.poll(() => field(page, 'scene')).toBe('Game');
    await expect.poll(() => field(page, 'hudButtons')).toBeTruthy();
    const [mx, my] = ((await field(page, 'hudButtons')) as Record<string, [number, number]>).mute!;
    await page.touchscreen.tap(mx, my);
    await expect
      .poll(async () => {
        const s = (await stored(page))?.settings;
        return s && [s.sound, s.sfx];
      })
      .toEqual([false, false]);
    expect(await field(page, 'notice')).toBe('Sound off (M)');
    expect(await field(page, 'moves')).toBe(0); // the tap moved nothing
    await page.touchscreen.tap(mx, my);
    await expect
      .poll(async () => {
        const s = (await stored(page))?.settings;
        return [s.sound, s.sfx];
      })
      .toEqual([true, true]);
  });

  test('drowned in master mode: the message says to tap it, and a tap restarts', async ({
    page,
  }) => {
    const chapters = JSON.parse(read('chapters.json')) as { levels: string[] }[];
    const levels: Record<string, unknown> = {};
    for (const id of [...chapters[0]!.levels, 'pc-19', ID])
      levels[id] = { completed: true, medals: { moves: 'gold' } };
    await page.addInitScript(
      ({ key, save }) => {
        if (!localStorage.getItem(key)) localStorage.setItem(key, save);
      },
      { key: SAVE_KEY, save: encodedSave({ version: 1, settings: {}, levels }) },
    );
    await page.goto('/');
    await expect.poll(() => field(page, 'scene')).toBe('Menu');
    await press(page, 'Enter');
    await goToLevel(page, ID);
    await press(page, 'KeyP');
    await expect.poll(() => field(page, 'mode')).toBe('master');
    const key = { up: 'ArrowUp', down: 'ArrowDown', left: 'ArrowLeft', right: 'ArrowRight' };
    for (const d of drowning()) await press(page, key[d]);
    await expect.poll(() => field(page, 'status')).toBe('drowned');
    // a tap before the message is drawn would not reach it (Phaser takes it in on a frame)
    await expect.poll(() => field(page, 'failedShown')).toBe(true);
    await page.touchscreen.tap(200, 370);
    await expect.poll(() => field(page, 'status')).toBe('playing');
    expect(await field(page, 'moves')).toBe(0);
  });
});
