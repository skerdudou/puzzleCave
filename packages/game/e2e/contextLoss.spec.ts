import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { expect, test, type Page } from '@playwright/test';
import { parseMoves } from '@puzzlecave/core';
import { SAVE_KEY } from '../src/save';
import { encodedSave } from './storedSave';

// Back from the background on a phone, the browser may have dropped the GPU's memory: the WebGL
// context is lost then restored, and a 2D canvas drawn once may come back blank (Chrome keeps the
// 2D canvases on the GPU, unless read often). Phaser uploads its textures again from their
// canvases: whatever was drawn once (the smoothed sprites, the texts) came back invisible.

type Pc = { scene?: string; buttons?: Record<string, [number, number]>; replayPlaying?: boolean };
const debug = (page: Page): Promise<Pc> =>
  page.evaluate(() => (window as unknown as { __pc?: Pc }).__pc ?? {});

/** Which 2D canvases the browser wipes: none, those on the GPU, or even those drawn from pixels. */
type Wipe = 'none' | 'gpu' | 'painted';
type Canvases = Record<Exclude<Wipe, 'none'>, Set<HTMLCanvasElement>>;

async function open(page: Page, scene: Scene, errors: string[]): Promise<void> {
  page.on('pageerror', (e) => errors.push(e.message));
  await page.addInitScript(
    ([k, v]) => {
      localStorage.setItem(k!, v!);
      const canvases: Canvases = { gpu: new Set(), painted: new Set() };
      (window as unknown as { __canvases: Canvases }).__canvases = canvases;
      const get = HTMLCanvasElement.prototype.getContext;
      HTMLCanvasElement.prototype.getContext = function (
        this: HTMLCanvasElement,
        type: string,
        options?: { willReadFrequently?: boolean },
      ) {
        // the attributes of a canvas's first 2D context are its own
        if (type === '2d' && !options?.willReadFrequently && !canvases.painted.has(this))
          canvases.gpu.add(this);
        return (get as (this: HTMLCanvasElement, ...a: unknown[]) => unknown).call(
          this,
          type,
          options,
        );
      } as typeof get;
      const put = CanvasRenderingContext2D.prototype.putImageData;
      CanvasRenderingContext2D.prototype.putImageData = function (
        this: CanvasRenderingContext2D,
        ...args: Parameters<typeof put>
      ) {
        canvases.painted.add(this.canvas);
        return put.apply(this, args);
      } as typeof put;
    },
    [
      SAVE_KEY,
      // a still screen: no flame, no dust
      encodedSave({
        version: 2,
        settings: { smoothing: true, torchlight: false, dust: false },
        levels: {},
        achievements: {},
      }),
    ],
  );
  await page.goto('/');
  await sceneIs(page, 'Menu');
  await REACH[scene](page);
  await sceneIs(page, scene);
}

const sceneIs = (page: Page, scene: string) =>
  expect.poll(async () => (await debug(page)).scene).toBe(scene);
const click = async (page: Page, button: string) => {
  const [x, y] = (await debug(page)).buttons![button]!;
  await page.mouse.click(x, y);
};
const KEY = { up: 'ArrowUp', down: 'ArrowDown', left: 'ArrowLeft', right: 'ArrowRight' } as const;
const pc01 = parseMoves(
  readFileSync(
    fileURLToPath(new URL('../../../levels/solutions/pc-01.txt', import.meta.url)),
    'utf8',
  ),
);

/** From the menu to each screen. */
const REACH = {
  Menu: async () => {},
  Options: (page: Page) => click(page, 'options'),
  Achievements: (page: Page) => click(page, 'achievements'),
  Select: (page: Page) => page.keyboard.press('Enter'),
  Game: async (page: Page) => {
    await page.keyboard.press('Enter');
    await sceneIs(page, 'Select');
    await page.keyboard.press('Enter');
  },
  Result: async (page: Page) => {
    await REACH.Game(page);
    await sceneIs(page, 'Game');
    for (const d of pc01) await page.keyboard.press(KEY[d]);
  },
  Replay: async (page: Page) => {
    await page.keyboard.press('Enter');
    await sceneIs(page, 'Select');
    await page.keyboard.press('KeyS');
    await sceneIs(page, 'Replay');
    // paused, for a still screen
    await expect.poll(async () => (await debug(page)).replayPlaying).toBe(true);
    await page.keyboard.press('Space');
    await expect.poll(async () => (await debug(page)).replayPlaying).toBe(false);
  },
} as const;
type Scene = keyof typeof REACH;

/** The screen once still (a level's intro gone, a button's glow settled). */
async function still(page: Page): Promise<Buffer> {
  const canvas = page.locator('#app canvas');
  let shot = await canvas.screenshot();
  await expect
    .poll(async () => {
      const a = shot;
      await page.waitForTimeout(300);
      shot = await canvas.screenshot();
      return differing(page, a, shot);
    })
    .toBe(0);
  return shot;
}

/** The WebGL context lost, those 2D canvases wiped meanwhile, the context restored. */
async function loseAndRestore(page: Page, wipe: Wipe): Promise<void> {
  await page.evaluate((wipe) => {
    const w = window as unknown as { __canvases: Canvases; __lose: WEBGL_lose_context };
    const c = document.querySelector('#app canvas') as HTMLCanvasElement;
    const gl = (c.getContext('webgl2') ?? c.getContext('webgl'))!;
    w.__lose = gl.getExtension('WEBGL_lose_context')!;
    w.__lose.loseContext();
    if (wipe === 'none') return;
    for (const canvas of w.__canvases[wipe])
      canvas.getContext('2d')!.clearRect(0, 0, canvas.width, canvas.height);
  }, wipe);
  await page.evaluate(() =>
    (window as unknown as { __lose: WEBGL_lose_context }).__lose.restoreContext(),
  );
}

for (const [scene, wipe] of [
  ['Menu', 'gpu'],
  ['Options', 'gpu'],
  ['Achievements', 'gpu'],
  ['Select', 'none'],
  ['Select', 'gpu'],
  ['Game', 'gpu'],
  ['Game', 'painted'],
  ['Result', 'gpu'],
  ['Replay', 'gpu'],
] as const)
  test(`${scene}: the WebGL context lost and restored, the ${wipe} 2D canvases wiped meanwhile: drawn as before`, async ({
    page,
  }) => {
    const errors: string[] = [];
    await open(page, scene, errors);
    const before = await still(page);
    await loseAndRestore(page, wipe);
    // the same picture as before, to a rounding (sprites or texts missing: thousands of pixels)
    await expect
      .poll(async () => differing(page, before, await page.locator('#app canvas').screenshot()))
      .toBe(0);
    expect(errors).toEqual([]);
  });

/** Pixels of two PNGs (same size) whose colour differs by more than a rounding. */
function differing(page: Page, a: Buffer, b: Buffer): Promise<number> {
  return page.evaluate(
    async ([a, b]) => {
      const pixels = async (b64: string) => {
        const bmp = await createImageBitmap(
          await (await fetch(`data:image/png;base64,${b64}`)).blob(),
        );
        const c = new OffscreenCanvas(bmp.width, bmp.height);
        const g = c.getContext('2d')!;
        g.drawImage(bmp, 0, 0);
        return g.getImageData(0, 0, bmp.width, bmp.height).data;
      };
      const [p, q] = [await pixels(a!), await pixels(b!)];
      let n = 0;
      for (let i = 0; i < p.length; i += 4)
        if (Math.max(...[0, 1, 2].map((k) => Math.abs(p[i + k]! - q[i + k]!))) > 2) n++;
      return n;
    },
    [a.toString('base64'), b.toString('base64')],
  );
}
