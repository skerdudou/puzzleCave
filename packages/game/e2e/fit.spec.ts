import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { expect, test, type Page } from '@playwright/test';
import { parseMoves, type Dir } from '@puzzlecave/core';
import { loadPack } from '@puzzlecave/tiled';
import { goToLevel } from './select';
import { encodedSave } from './storedSave';

// Silkscreen is wide: every screen, in every language, on a small phone, a phone and a phone in
// landscape, keeps its texts on the screen and its buttons apart.

const levelsDir = new URL('../../../levels/', import.meta.url);
const read = (name: string) => readFileSync(fileURLToPath(new URL(name, levelsDir)), 'utf8');
const chapters = JSON.parse(read('chapters.json')) as { id: string; levels: string[] }[];
const names = Object.fromEntries(
  loadPack(fileURLToPath(levelsDir)).levels.map((l) => [l.id, l.name]),
);
// screenshots of every screen checked (PC_SHOTS=1), git-ignored
const shots = fileURLToPath(new URL('../.oneshot/shots/', import.meta.url));
const KEY = { up: 'ArrowUp', down: 'ArrowDown', left: 'ArrowLeft', right: 'ArrowRight' } as const;

type Box = { text: string; x: number; y: number; w: number; h: number; button: boolean };
const debug = (page: Page) =>
  page.evaluate(() => (window as unknown as { __pc?: Record<string, unknown> }).__pc ?? {});
const field = async (page: Page, k: string) => (await debug(page))[k];
const sceneIs = (page: Page, scene: string) => expect.poll(() => field(page, 'scene')).toBe(scene);

const overlap = (a: Box, b: Box) =>
  a.x < b.x + b.w - 0.5 && b.x < a.x + a.w - 0.5 && a.y < b.y + b.h - 0.5 && b.y < a.y + a.h - 0.5;

/** waits two frames, so that what the scene drew last is what the test reads */
const frames = (page: Page) =>
  page.evaluate(
    () => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(() => r(null)))),
  );

/**
 * A save in `lang`: the first level of every chapter but Easy done in gold (its record and
 * master lines shown, master mode open), pc-40 too; pc-01 not done (its result is a first finish).
 */
function save(lang: string): string {
  const levels: Record<string, unknown> = {};
  const gold = {
    completed: true,
    bestMoves: 999,
    bestTimeMs: 599_990,
    medals: { moves: 'gold', time: 'gold' },
  };
  for (const c of chapters.slice(1)) levels[c.levels[0]!] = gold;
  levels['pc-40'] = gold;
  levels['pc-35'] = {
    ...gold,
    masterBestMoves: 999,
    masterBestTimeMs: 599_990,
    medals: { ...gold.medals, master: 'master' },
  };
  return encodedSave({ version: 1, settings: { lang }, levels });
}

const LANGS = ['en', 'fr', 'de', 'es', 'it'] as const;
// phones (touch, every language), and PC screens where the interface grows with the screen
// (1.5×, 2×: the 1280×720 layout scaled; English, and German's long words)
const VIEWS = [
  { width: 320, height: 568, touch: true, langs: LANGS },
  { width: 360, height: 740, touch: true, langs: LANGS },
  { width: 740, height: 360, touch: true, langs: LANGS },
  { width: 1920, height: 1080, touch: false, langs: ['en', 'de'] },
  { width: 2560, height: 1440, touch: false, langs: ['en', 'de'] },
] as const;

for (const { width, height, touch, langs } of VIEWS) {
  test.describe(`${width}×${height}`, () => {
    test.use({
      viewport: { width, height },
      hasTouch: touch,
      deviceScaleFactor: touch ? 2 : 1,
    });
    for (const lang of langs) {
      test(`every screen fits (${lang})`, async ({ page }) => {
        test.setTimeout(90_000);
        await page.addInitScript((s) => localStorage.setItem('puzzlecave.save.v1', s), save(lang));
        const failures: string[] = [];
        /** the scene's texts: on the screen across, buttons apart (and, `hud`, off the texts) */
        const check = async (where: string, hud = false) => {
          await frames(page);
          if (process.env.PC_SHOTS)
            await page.screenshot({
              path: `${shots}fit-${width}x${height}-${lang}-${where.replaceAll(' ', '-')}.png`,
            });
          const boxes = (await page.evaluate(() =>
            (window as unknown as { __pcTexts: () => Box[] }).__pcTexts(),
          )) as Box[];
          expect(boxes.length, where).toBeGreaterThan(0);
          const name = (b: Box) => JSON.stringify(b.text.slice(0, 40));
          for (const b of boxes)
            if (b.x < -0.5 || b.x + b.w > width + 0.5)
              failures.push(`${where}: ${name(b)} x ${b.x.toFixed(1)}..${(b.x + b.w).toFixed(1)}`);
          for (let i = 0; i < boxes.length; i++)
            for (let j = i + 1; j < boxes.length; j++) {
              const [a, b] = [boxes[i]!, boxes[j]!];
              if ((a.button && b.button) || (hud && a.button !== b.button))
                if (overlap(a, b)) failures.push(`${where}: ${name(a)} overlaps ${name(b)}`);
            }
          return boxes;
        };

        await page.goto('/');
        await sceneIs(page, 'Menu');
        await check('menu');

        await page.keyboard.press('ArrowDown');
        await page.keyboard.press('ArrowDown');
        await page.keyboard.press('Enter');
        await sceneIs(page, 'Options');
        await check('options top');
        await page.keyboard.press('End');
        await check('options bottom');
        await page.keyboard.press('Escape');
        await sceneIs(page, 'Menu');

        // Achievements, the menu's third button
        for (let i = 0; i < 3; i++) await page.keyboard.press('ArrowDown');
        await page.keyboard.press('Enter');
        await sceneIs(page, 'Achievements');
        await check('achievements top');
        await page.keyboard.press('End');
        await check('achievements bottom');
        await page.keyboard.press('Escape');
        await sceneIs(page, 'Menu');

        await page.keyboard.press('Enter');
        for (const c of chapters) {
          await goToLevel(page, c.levels[0]!);
          await check(`select ${c.id}`);
          await page.keyboard.press('ArrowRight');
          await expect.poll(() => field(page, 'levelId')).toBe(c.levels[1]);
          await check(`select ${c.id} 2nd`);
        }

        const game = async (id: string, mode: 'normal' | 'master') => {
          await goToLevel(page, id);
          await page.keyboard.press(mode === 'master' ? 'KeyP' : 'Enter');
          await sceneIs(page, 'Game');
          await expect.poll(() => field(page, 'mode')).toBe(mode);
          await expect.poll(() => field(page, 'levelId')).toBe(id);
          // the HUD drawn (touch: once its buttons answer)
          await expect.poll(() => field(page, touch ? 'hudButtons' : 'hudLayout')).toBeTruthy();
          const where = `game ${id} ${mode}`;
          const boxes = await check(where, true);
          // the key's art before the keys' counter: on the screen, off every text
          const hud = (await field(page, 'hudLayout')) as { keyIcon: Box | null };
          const icon = hud.keyIcon;
          if (!icon) failures.push(`${where}: no key icon`);
          else {
            if (icon.x < -0.5 || icon.x + icon.w > width + 0.5)
              failures.push(`${where}: key icon x ${icon.x}..${icon.x + icon.w}`);
            for (const b of boxes)
              if (overlap(icon, b))
                failures.push(`${where}: key icon overlaps ${JSON.stringify(b.text.slice(0, 40))}`);
          }
          // the level's name shown whole (not cut with "…")
          const shown = await field(page, 'hudName');
          if (shown !== names[id]) failures.push(`game ${id} ${mode}: name shown as ${shown}`);
          await page.keyboard.press('Escape');
          await sceneIs(page, 'Select');
        };
        await game('pc-40', 'normal');
        await game('pc-40', 'master');
        await game('pc-47', 'normal');

        // pc-01 solved: a first finish, then again (its records shown)
        await goToLevel(page, 'pc-01');
        await page.keyboard.press('Enter');
        for (const again of [false, true]) {
          await sceneIs(page, 'Game');
          for (const d of parseMoves(read('solutions/pc-01.txt')) as Dir[])
            await page.keyboard.press(KEY[d]);
          await sceneIs(page, 'Result');
          await expect.poll(() => field(page, 'resultAnimDone'), { timeout: 10_000 }).toBe(true);
          await check(again ? 'result pc-01 again' : 'result pc-01');
          await page.keyboard.press('KeyR');
        }

        // pc-40 solved (gold held there): the result with the master mode button
        await page.keyboard.press('Escape');
        await sceneIs(page, 'Select');
        await goToLevel(page, 'pc-40');
        await page.keyboard.press('Enter');
        await sceneIs(page, 'Game');
        for (const d of parseMoves(read('solutions/pc-40.txt')) as Dir[])
          await page.keyboard.press(KEY[d]);
        await sceneIs(page, 'Result');
        await expect.poll(() => field(page, 'resultAnimDone'), { timeout: 10_000 }).toBe(true);
        expect(await field(page, 'resultMasterButton')).toBe(true);
        await check('result pc-40 master button');

        expect(failures).toEqual([]);
      });
    }
  });
}
