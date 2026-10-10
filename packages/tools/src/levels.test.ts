import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { expect, test } from 'vitest';
import { loadPack } from '@puzzlecave/tiled';
import { validateCommand } from './commands';
import { LEVELS_DIR } from './paths';

test('all repository levels load and belong to a chapter', () => {
  const pack = loadPack(LEVELS_DIR);
  expect(pack.errors).toEqual([]);
  expect(pack.levels.length).toBe(19);
  expect(pack.chapters.map((c) => c.id)).toEqual(['easy', 'medium', 'hard']);
});

test('all reference solutions win', () => {
  expect(validateCommand(LEVELS_DIR).lines.at(-1)).toMatch(/OK$/);
});

test('pc-01 has a solution (used by the e2e test)', () => {
  expect(existsSync(join(LEVELS_DIR, 'solutions', 'pc-01.txt'))).toBe(true);
});
