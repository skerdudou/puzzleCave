// A barrel pushed into the water (pure, no Phaser): it stays there, its lid above the surface,
// the cell still drawn as water. Its sprites are made at start from the barrel's art (BootScene),
// one a step of its sinking; BoardView draws them over the water.
import type { Terrain } from '@puzzlecave/core';
import type { Rgba } from './upscale';

const TILE = 16;
/** The water line, art px from the cell's top. */
export const WATERLINE = 12;
/** How far the barrel sinks, art px: one sprite a step (1, while sinking; 2, at rest). */
export const SUNK_STEPS = [1, 2] as const;
/** What shows of the barrel under the water line. */
const UNDER = 0.38;
/** The light rim on the water touching the barrel at the line. */
export const FOAM: readonly [number, number, number] = [0x5c, 0x62, 0xc4];

/** The texture of the barrel sunk `by` art px. */
export const sunkKey = (by: number): string => `BLOCK_SUNK_${by}`;
/** Every sunk barrel's texture (smoothed at start with the other sprites). */
export const SUNK_TEXTURES = SUNK_STEPS.map(sunkKey);

/**
 * The barrel's art sunk `by` art px into the water: above the line as it is, under it faint, out
 * of the cell's bottom cut; the rim on the water around it at the line.
 */
export function sunkBlock(block: Rgba, by: number): Rgba {
  const w = TILE;
  const h = TILE;
  const data = new Uint8Array(w * h * 4);
  const above = new Uint8Array(w * h);
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      const sy = y - by;
      if (sy < 0 || sy >= block.h || x >= block.w) continue;
      const s = (sy * block.w + x) * 4;
      const a = block.data[s + 3]!;
      if (!a) continue;
      const d = (y * w + x) * 4;
      data.set(block.data.subarray(s, s + 3), d);
      if (y < WATERLINE) {
        data[d + 3] = a;
        above[y * w + x] = 1;
      } else data[d + 3] = Math.round(a * UNDER);
    }
  const isAbove = (x: number, y: number) =>
    x >= 0 && y >= 0 && x < w && y < h && above[y * w + x] === 1;
  for (let y = WATERLINE - 2; y <= WATERLINE; y++)
    for (let x = 0; x < w; x++) {
      if (isAbove(x, y)) continue;
      const touches =
        isAbove(x - 1, y) ||
        isAbove(x + 1, y) ||
        isAbove(x, y - 1) ||
        (y < WATERLINE && isAbove(x, y + 1));
      if (!touches) continue;
      const d = (y * w + x) * 4;
      data.set(FOAM, d);
      data[d + 3] = 255;
    }
  return { w, h, data };
}

/** The cells where a barrel sank: water at the level's start, floor now. */
export function sunkCells(start: readonly Terrain[], now: readonly Terrain[]): number[] {
  const cells: number[] = [];
  now.forEach((t, i) => t === 'floor' && start[i] === 'water' && cells.push(i));
  return cells;
}

/** The terrain as drawn with the barrels floating: a sunk barrel's cell still water. */
export function shownTerrain(start: readonly Terrain[], now: readonly Terrain[]): Terrain[] {
  return now.map((t, i) => (t === 'floor' && start[i] === 'water' ? 'water' : t));
}
