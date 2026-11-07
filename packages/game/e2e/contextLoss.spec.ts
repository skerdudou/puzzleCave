import { expect, test, type Page } from '@playwright/test';
import { SAVE_KEY } from '../src/save';
import { encodedSave } from './storedSave';

// Back from the background on a phone, the browser may have dropped the GPU's memory: the WebGL
// context is lost then restored, and a 2D canvas drawn once may come back blank. The smoothed
// sprites (player, blocks, keys, doors) were drawn once at start: they came back invisible.

type Pc = { scene?: string };
const debug = (page: Page): Promise<Pc> =>
  page.evaluate(() => (window as unknown as { __pc?: Pc }).__pc ?? {});

test('the WebGL context lost and restored, the 2D canvases wiped meanwhile: the board is drawn as before', async ({
  page,
}) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.addInitScript(
    ([k, v]) => {
      localStorage.setItem(k!, v!);
      // the canvases drawn from pixels, to wipe them as the browser would
      const painted = new Set<HTMLCanvasElement>();
      (window as unknown as { __painted: Set<HTMLCanvasElement> }).__painted = painted;
      const put = CanvasRenderingContext2D.prototype.putImageData;
      CanvasRenderingContext2D.prototype.putImageData = function (
        this: CanvasRenderingContext2D,
        ...args: Parameters<typeof put>
      ) {
        painted.add(this.canvas);
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
  await expect.poll(async () => (await debug(page)).scene).toBe('Menu');
  await page.keyboard.press('Enter');
  await expect.poll(async () => (await debug(page)).scene).toBe('Select');
  await page.keyboard.press('Enter');
  await expect.poll(async () => (await debug(page)).scene).toBe('Game');
  const canvas = page.locator('#app canvas');
  // the level's intro gone, the screen still
  await expect
    .poll(async () => {
      const a = await canvas.screenshot();
      await page.waitForTimeout(300);
      return a.equals(await canvas.screenshot());
    })
    .toBe(true);
  const before = await canvas.screenshot();

  await page.evaluate(() => {
    const c = document.querySelector('#app canvas') as HTMLCanvasElement;
    const gl = (c.getContext('webgl2') ?? c.getContext('webgl'))!;
    const ext = gl.getExtension('WEBGL_lose_context')!;
    (window as unknown as { __lose: WEBGL_lose_context }).__lose = ext;
    ext.loseContext();
  });
  await page.evaluate(() => {
    for (const c of (window as unknown as { __painted: Set<HTMLCanvasElement> }).__painted)
      c.getContext('2d')!.clearRect(0, 0, c.width, c.height);
  });
  await page.evaluate(() =>
    (window as unknown as { __lose: WEBGL_lose_context }).__lose.restoreContext(),
  );
  // the same picture as before, to a rounding (the sprites missing: thousands of pixels)
  await expect.poll(async () => differing(page, before, await canvas.screenshot())).toBe(0);
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
