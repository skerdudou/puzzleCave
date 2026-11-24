import { expect, test } from 'vitest';
import type { Terrain } from '@puzzlecave/core';
import { FOAM, SUNK_TEXTURES, WATERLINE, shownTerrain, sunkBlock, sunkCells } from './sunk';
import type { Rgba } from './upscale';

/** A 16×16 art: an opaque square from (x0, y0) to (x1, y1), inclusive, colour (10, 20, 30). */
function square(x0: number, y0: number, x1: number, y1: number): Rgba {
  const data = new Uint8Array(16 * 16 * 4);
  for (let y = y0; y <= y1; y++)
    for (let x = x0; x <= x1; x++) data.set([10, 20, 30, 255], (y * 16 + x) * 4);
  return { w: 16, h: 16, data };
}
const px = (img: Rgba, x: number, y: number) =>
  Array.from(img.data.subarray((y * 16 + x) * 4, (y * 16 + x) * 4 + 4));

test('the barrel sinks: moved down, opaque above the line, faint under it, cut at the bottom', () => {
  const out = sunkBlock(square(4, 0, 11, 15), 2);
  expect(px(out, 6, 0)[3]).toBe(0);
  expect(px(out, 6, 2)).toEqual([10, 20, 30, 255]);
  expect(px(out, 6, WATERLINE - 1)).toEqual([10, 20, 30, 255]);
  // the line itself, under the lid: the rim
  expect(px(out, 6, WATERLINE)).toEqual([...FOAM, 255]);
  const under = px(out, 6, WATERLINE + 1)[3]!;
  expect(under).toBeGreaterThan(0);
  expect(under).toBeLessThan(255);
  expect(px(out, 6, 15)[3]).toBe(under);
});

test('a light rim on the water touching the barrel at the line, nowhere else', () => {
  const out = sunkBlock(square(4, 0, 11, 15), 2);
  expect(px(out, 3, WATERLINE - 1)).toEqual([...FOAM, 255]);
  expect(px(out, 12, WATERLINE - 2)).toEqual([...FOAM, 255]);
  expect(px(out, 3, WATERLINE - 4)[3]).toBe(0);
  expect(px(out, 0, WATERLINE)[3]).toBe(0);
});

test('a sunk barrel shows as water; other cells as they are', () => {
  const start: Terrain[] = ['water', 'water', 'floor', 'wall'];
  const now: Terrain[] = ['floor', 'water', 'floor', 'wall'];
  expect(sunkCells(start, now)).toEqual([0]);
  expect(shownTerrain(start, now)).toEqual(['water', 'water', 'floor', 'wall']);
});

test('one texture a step, each name its own', () => {
  expect(SUNK_TEXTURES).toEqual(['BLOCK_SUNK_1', 'BLOCK_SUNK_2']);
});
