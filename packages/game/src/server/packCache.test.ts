import { mkdtempSync, rmSync, utimesSync, writeFileSync, unlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, expect, test } from 'vitest';
import type { LevelPack } from '@puzzlecave/tiled';
import { createPackCache } from './packCache';

let dir: string;
let loads: number;
const load = (d: string): LevelPack => {
  loads++;
  const files = ['a.tmx', 'b.tsx'].map((f) => join(d, f));
  return { levels: [], chapters: [], errors: [], files };
};

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'pc-packcache-'));
  writeFileSync(join(dir, 'a.tmx'), 'a');
  writeFileSync(join(dir, 'b.tsx'), 'b');
  loads = 0;
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

test('the pack is parsed once while no file changes', () => {
  const cache = createPackCache(dir, load);
  const first = cache.get();
  expect(cache.get()).toBe(first);
  expect(cache.get()).toBe(first);
  expect(loads).toBe(1);
});

test('a level or tileset written again is parsed again', () => {
  const cache = createPackCache(dir, load);
  cache.get();
  const later = new Date(Date.now() + 5000);
  utimesSync(join(dir, 'b.tsx'), later, later);
  cache.get();
  expect(loads).toBe(2);
  cache.get();
  expect(loads).toBe(2);
});

test('a level added or removed is seen', () => {
  const cache = createPackCache(dir, load);
  cache.get();
  writeFileSync(join(dir, 'c.tmx'), 'c');
  cache.get();
  expect(loads).toBe(2);
  unlinkSync(join(dir, 'c.tmx'));
  cache.get();
  expect(loads).toBe(3);
});

test('a file of the pack that disappeared is parsed again', () => {
  const cache = createPackCache(dir, load);
  cache.get();
  unlinkSync(join(dir, 'b.tsx'));
  cache.get();
  expect(loads).toBe(2);
});
