import { expect, test } from 'vitest';
import { xbr, xbrPatch } from './xbr';
import { blit, copyRgba, type Rgba } from './upscale';

/** A terrain-like image: 16 px cells of a few flat colours with some detail, opaque. */
function terrain(cols: number, rows: number, seed: number): Rgba {
  const w = cols * 16;
  const h = rows * 16;
  const data = new Uint8Array(w * h * 4);
  let r = seed;
  const rnd = () => ((r = (r * 1103515245 + 12345) >>> 0) >>> 16) / 65536;
  const cells = Array.from({ length: cols * rows }, () => Math.floor(rnd() * 3));
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      const kind = cells[Math.floor(y / 16) * cols + Math.floor(x / 16)]!;
      const dot = (x * 7 + y * 13) % 11 === 0 ? 40 : 0;
      const c = [
        [60, 64, 76],
        [61, 66, 172],
        [90, 110, 100],
      ][kind]!;
      data.set([c[0]! + dot, c[1]!, c[2]! - dot / 2, 255], (y * w + x) * 4);
    }
  return { w, h, data };
}

/** The cell (cx, cy) of `img` painted one flat colour (a block sunk: water turned floor). */
function repaint(img: Rgba, cx: number, cy: number): Rgba {
  const out = copyRgba(img);
  const cell: Rgba = { w: 16, h: 16, data: new Uint8Array(16 * 16 * 4) };
  for (let i = 0; i < 256; i++) cell.data.set([60, 64, 76, 255], i * 4);
  blit(out, cell, 0, 0, 16, 16, cx * 16, cy * 16);
  return out;
}

test.each([
  ['in the middle', 5, 4],
  ['at a corner (the image edge in the window)', 0, 0],
  ['at the far edge', 9, 7],
])('a cell changed %s: the patch equals xBR of the whole image', (_, cx, cy) => {
  const before = terrain(10, 8, 7);
  const after = repaint(before, cx, cy);
  const big = xbr(before);
  // the cell and its neighbours (their art follows it: the water's banks)
  const x = Math.max(0, cx - 1) * 16;
  const y = Math.max(0, cy - 1) * 16;
  const rect = {
    x,
    y,
    w: Math.min(10 * 16, (cx + 2) * 16) - x,
    h: Math.min(8 * 16, (cy + 2) * 16) - y,
  };
  xbrPatch(after, big, rect);
  // the first byte that differs (-1: none): a deep toEqual of 330 kB is slow
  const whole = xbr(after).data;
  expect(big.data.length).toBe(whole.length);
  expect(big.data.findIndex((v, i) => v !== whole[i])).toBe(-1);
});
