import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, test } from 'vitest';
import { formatSolution, fromAscii, parseMoves, parseSolution } from '@puzzlecave/core';
import { TILE_ORDER, writeTmx } from '@puzzlecave/tiled';
import { solutionCommand } from './solutionCmd';

const TSX = `<tileset name="pc" tilewidth="16" tileheight="16">${TILE_ORDER.map((k, i) => `<tile id="${i}"><properties><property name="kind" value="${k}"/></properties></tile>`).join('')}</tileset>`;

function fixture(): string {
  const dir = mkdtempSync(join(tmpdir(), 'pc-solution-'));
  writeFileSync(join(dir, 'tileset.tsx'), TSX);
  writeFileSync(join(dir, 'a.tmx'), writeTmx(fromAscii(['@...E'], { id: 'a' })));
  writeFileSync(
    join(dir, 'chapters.json'),
    JSON.stringify([{ id: 'c', name: { fr: 'C', en: 'C' }, unlockAfter: 0, levels: ['a'] }]),
  );
  mkdirSync(join(dir, 'solutions'));
  return dir;
}
const saved = (dir: string) => readFileSync(join(dir, 'solutions', 'a.sol'), 'utf8');

test('show: the moves as letters, the header kept', () => {
  const dir = fixture();
  writeFileSync(
    join(dir, 'solutions', 'a.sol'),
    formatSolution(parseMoves('RRRR'), '# optimal (proven)'),
  );
  expect(solutionCommand(dir, ['show', 'a'])).toEqual({
    ok: true,
    lines: ['# optimal (proven)', 'RRRR'],
  });
  expect(solutionCommand(dir, ['show', 'nope']).ok).toBe(false);
});

test('set: letters given by hand saved encoded, shorter only (or --force), the header kept', () => {
  const dir = fixture();
  writeFileSync(
    join(dir, 'solutions', 'a.sol'),
    formatSolution(parseMoves('RLRRRR'), '# best known'),
  );
  const given = join(dir, 'given.txt');
  // does not win
  writeFileSync(given, 'RR\n');
  expect(solutionCommand(dir, ['set', 'a', given]).ok).toBe(false);
  // shorter: saved, encoded, with the old header
  writeFileSync(given, 'RRRR\n');
  expect(solutionCommand(dir, ['set', 'a', given])).toEqual({
    ok: true,
    lines: ['a: 4 moves written to solutions/a.sol (was 6); thresholds unchanged'],
  });
  expect(saved(dir).split('\n')[0]).toBe('# best known');
  expect(saved(dir)).toMatch(/\nv1:/);
  expect(parseSolution(saved(dir))).toEqual(parseMoves('RRRR'));
  // not shorter: refused, then forced
  writeFileSync(given, 'RLRRRR\n');
  expect(solutionCommand(dir, ['set', 'a', given]).ok).toBe(false);
  expect(solutionCommand(dir, ['set', 'a', given, '--force']).ok).toBe(true);
  expect(parseSolution(saved(dir))).toHaveLength(6);
});

test('set --force with a longer solution: a proven optimum header is not kept', () => {
  const dir = fixture();
  writeFileSync(
    join(dir, 'solutions', 'a.sol'),
    formatSolution(parseMoves('RRRR'), '# optimal (proven)'),
  );
  const given = join(dir, 'given.txt');
  writeFileSync(given, 'RLRRRR\n');
  expect(solutionCommand(dir, ['set', 'a', given, '--force']).ok).toBe(true);
  expect(saved(dir).split('\n')[0]).toBe('# best known — not proven optimal');
});
