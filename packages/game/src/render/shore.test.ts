import { expect, test } from 'vitest';
import { SHORE_TEXTURES, shoreAt, shoreTexture, type Shore } from './shore';

const none: Shore = { n: false, w: false, e: false, s: false, nw: false, ne: false };

test('no bank: the water as it is', () => {
  expect(shoreTexture(none)).toBe('WATER');
});

test('the shore from the neighbours: the corners count only between two water sides', () => {
  const pool = new Set(['1,1', '2,1', '1,2', '2,2']);
  const isWater = (x: number, y: number) => pool.has(`${x},${y}`);
  expect(shoreTexture(shoreAt(isWater, 1, 1))).toBe('WATER_NW');
  expect(shoreTexture(shoreAt(isWater, 2, 2))).toBe('WATER_ES');
  pool.add('1,0');
  pool.add('0,1');
  pool.add('2,0');
  expect(shoreTexture(shoreAt(isWater, 1, 1))).toBe('WATER_cNW');
});

test('every texture name differs, even ignoring case (a Windows checkout)', () => {
  expect(new Set(SHORE_TEXTURES.map((n) => n.toLowerCase())).size).toBe(SHORE_TEXTURES.length);
  expect(SHORE_TEXTURES).toContain('WATER');
});

test('every texture name is a file of the art', async () => {
  const { existsSync } = await import('node:fs');
  for (const n of SHORE_TEXTURES)
    expect(existsSync(new URL(`../../public/textures/${n}.png`, import.meta.url)), n).toBe(true);
});
