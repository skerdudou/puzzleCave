import { fileURLToPath } from 'node:url';
import { expect, test, type Page } from '@playwright/test';
import { loadPack } from '@puzzlecave/tiled';
import { boardLayout } from '../src/render/layout';
import { buttonAt, clickScrolled } from './options';
import { goToLevel } from './select';

const levelsDir = fileURLToPath(new URL('../../../levels', import.meta.url));
const levels = loadPack(levelsDir).levels;

type Ambience = { rock: number; torchlight: boolean; dust: boolean; tint: string | null };
type Layout = { scale: number; x: number; y: number; width: number; height: number };
type Pc = {
  scene?: string;
  levelId?: string;
  ambience?: Ambience;
  boardLayout?: Layout & { viewW: number; viewH: number };
  buttons?: Record<string, [number, number]>;
};
const debug = (page: Page) =>
  page.evaluate(() => (window as unknown as { __pc?: Pc }).__pc ?? ({} as Pc));
const sceneIs = (page: Page, scene: string) =>
  expect.poll(async () => (await debug(page)).scene).toBe(scene);

/** From the start page to level `id`, in normal mode. */
async function openLevel(page: Page, id: string): Promise<void> {
  await page.goto('/');
  await sceneIs(page, 'Menu');
  await page.keyboard.press('Enter');
  await goToLevel(page, id);
  await page.keyboard.press('Enter');
  await sceneIs(page, 'Game');
}

/** From the menu: both graphics switches flipped, back to the menu. */
async function flipGraphics(page: Page, on: boolean): Promise<void> {
  const [ox, oy] = await buttonAt(page, 'options');
  await page.mouse.click(ox, oy);
  await sceneIs(page, 'Options');
  for (const id of ['torchlight', 'dust'] as const) {
    await clickScrolled(page, id);
    await expect
      .poll(
        async () => ((await debug(page)) as { settings?: Record<string, boolean> }).settings?.[id],
      )
      .toBe(on);
  }
  await page.keyboard.press('Escape');
  await sceneIs(page, 'Menu');
}

/** Forgets the reported ambience, so that the next scene's own report is read. */
const forgetAmbience = (page: Page) =>
  page.evaluate(() => {
    const pc = (window as unknown as { __pc?: Pc }).__pc;
    if (pc) delete pc.ambience;
  });
const reported = async (page: Page): Promise<Ambience> => {
  await expect.poll(async () => (await debug(page)).ambience).toBeDefined();
  return (await debug(page)).ambience!;
};

/** From the menu: level `id`, then its saved solution's replay; the ambience of each. */
async function ambienceInGameAndReplay(page: Page, id: string): Promise<Ambience[]> {
  await page.keyboard.press('Enter');
  await goToLevel(page, id);
  await forgetAmbience(page);
  await page.keyboard.press('Enter');
  await sceneIs(page, 'Game');
  const game = await reported(page);
  await page.keyboard.press('Escape');
  await sceneIs(page, 'Select');
  await forgetAmbience(page);
  await page.keyboard.press('KeyS');
  await sceneIs(page, 'Replay');
  const replay = await reported(page);
  await page.keyboard.press('Escape');
  await sceneIs(page, 'Select');
  await page.keyboard.press('Escape');
  await sceneIs(page, 'Menu');
  return [game, replay];
}

test('a Medium level has the rock, torchlight, dust and the blue tint', async ({ page }) => {
  await openLevel(page, 'pc-40');
  await expect
    .poll(async () => (await debug(page)).ambience)
    .toMatchObject({ torchlight: true, dust: true, tint: '#4a6fa5' });
  expect((await debug(page)).ambience!.rock).toBeGreaterThan(0);
});

test('the ambience follows a resize', async ({ page }) => {
  await openLevel(page, 'pc-40');
  await expect.poll(async () => (await debug(page)).ambience?.rock ?? 0).toBeGreaterThan(0);
  const before = (await debug(page)).ambience!.rock;
  await page.setViewportSize({ width: 900, height: 560 });
  await expect.poll(async () => (await debug(page)).boardLayout?.viewW).toBe(900);
  await expect.poll(async () => (await debug(page)).ambience!.rock).not.toBe(before);
  // the board is laid out for the new size (a wide screen with a keyboard at 1×)
  const level = levels.find((l) => l.id === 'pc-40')!;
  const { viewW, viewH, ...board } = (await debug(page)).boardLayout!;
  expect([viewW, viewH]).toEqual([900, 560]);
  expect(board).toEqual(boardLayout(900, 560, level.width, level.height, 16, 52, 24, false));
});

test('torchlight and dust switched off in Options, then back on', async ({ page }) => {
  await page.goto('/');
  await sceneIs(page, 'Menu');
  await flipGraphics(page, false);
  for (const a of await ambienceInGameAndReplay(page, 'pc-21'))
    expect(a).toMatchObject({ torchlight: false, dust: false });
  // back on: no reload needed
  await flipGraphics(page, true);
  for (const a of await ambienceInGameAndReplay(page, 'pc-21'))
    expect(a).toMatchObject({ torchlight: true, dust: true });
});

test('pc-47 opens with its rock and no console error', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => {
    if (m.type() === 'error') errors.push(m.text());
  });
  await openLevel(page, 'pc-47');
  await expect.poll(async () => (await debug(page)).ambience?.rock ?? 0).toBeGreaterThan(0);
  await page.waitForTimeout(300);
  expect(errors).toEqual([]);
});

test('redrawing the level select does not pile up button-frame listeners', async ({ page }) => {
  await page.goto('/');
  await sceneIs(page, 'Menu');
  await page.keyboard.press('Enter');
  await sceneIs(page, 'Select');
  const count = async () =>
    ((await debug(page)) as { prerenderListeners?: number }).prerenderListeners;
  await page.keyboard.press('ArrowRight');
  await expect.poll(count).toBeGreaterThan(0);
  const base = (await count())!;
  for (let i = 0; i < 10; i++) {
    await page.keyboard.press('ArrowRight');
    await page.keyboard.press('ArrowLeft');
  }
  // a scene restart must not leave the old listeners either
  await page.keyboard.press('Escape');
  await sceneIs(page, 'Menu');
  await page.keyboard.press('Enter');
  await sceneIs(page, 'Select');
  await page.keyboard.press('ArrowRight');
  await expect.poll(count).toBeLessThanOrEqual(base + 1);
  expect(await count()).toBeGreaterThan(0);
});
