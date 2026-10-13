import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, test } from 'vitest';
import { fromAscii, parseMoves, type LevelData } from '@puzzlecave/core';
import { TILE_ORDER, setMapProperty, writeTmx } from '@puzzlecave/tiled';
import {
  TIME_RULE,
  estimateTime,
  goldTimeFor,
  niceSeconds,
  parseTimesArgs,
  solutionFeatures,
  timesCommand,
  type SolutionFeatures,
} from './times';

const feat = (o: Partial<SolutionFeatures>): SolutionFeatures => ({
  moves: 0,
  turns: 0,
  pushes: 0,
  keys: 0,
  doors: 0,
  fills: 0,
  interactions: 0,
  ...o,
});

test('features: moves, turns, pushes, keys, doors, fills', () => {
  // key, door, a block pushed into the water, then the exit
  const level = fromAscii(['@kD..', '###B#', '###~#', '###.E']);
  const f = solutionFeatures(level, parseMoves('RRRDDDR'));
  expect(f).toEqual(
    feat({ moves: 7, turns: 2, pushes: 1, keys: 1, doors: 1, fills: 1, interactions: 3 }),
  );
});

test('features: a refused move or a losing solution is an error', () => {
  const level = fromAscii(['@.E']);
  expect(() => solutionFeatures(level, parseMoves('LRR'))).toThrow(/move 1 \(left\) is refused/);
  expect(() => solutionFeatures(level, parseMoves('R'))).toThrow(/does not win/);
});

test('rule: per move plus per turn, never under the input-rate floor', () => {
  const rule = { perMove: 0.1, perTurn: 0.2, minPerMove: 0 };
  const f = feat({ moves: 10, turns: 4, interactions: 2 });
  expect(estimateTime(f, rule)).toBeCloseTo(0.1 * 10 + 0.2 * 4);
  // floor: 10 moves × 0.5 s
  expect(estimateTime(f, { ...rule, minPerMove: 0.5 })).toBe(5);
  // the fitted rule: a straight corridor is bounded by the input rate
  expect(estimateTime(feat({ moves: 100 }))).toBeCloseTo(100 * TIME_RULE.minPerMove);
  expect(estimateTime(feat({ moves: 100, turns: 40 }))).toBeCloseTo(
    100 * TIME_RULE.perMove + 40 * TIME_RULE.perTurn,
  );
});

test('rounding: whole seconds below a minute, 5 s steps above', () => {
  expect(niceSeconds(0.2)).toBe(1);
  expect(niceSeconds(12.4)).toBe(12);
  expect(niceSeconds(59.4)).toBe(59);
  expect(niceSeconds(61)).toBe(60);
  expect(niceSeconds(63)).toBe(65);
  expect(niceSeconds(142.4)).toBe(140);
});

test('fitted rule: more moves, turns or interactions never lower the gold time', () => {
  const base = feat({ moves: 50, turns: 20, interactions: 10 });
  const g = goldTimeFor(base);
  expect(g).toBeGreaterThan(0);
  expect(goldTimeFor({ ...base, moves: 80 })).toBeGreaterThanOrEqual(g);
  expect(goldTimeFor({ ...base, turns: 40 })).toBeGreaterThanOrEqual(g);
  expect(goldTimeFor({ ...base, interactions: 30 })).toBeGreaterThanOrEqual(g);
  // never faster than the observed input rate
  expect(estimateTime(base)).toBeGreaterThanOrEqual(TIME_RULE.minPerMove * base.moves);
});

test('arguments', () => {
  expect(parseTimesArgs([])).toEqual({ ids: 'all', apply: false, force: false, from: undefined });
  expect(parseTimesArgs(['pc-01', '--apply', '--force'])).toEqual({
    ids: ['pc-01'],
    apply: true,
    force: true,
    from: undefined,
  });
  expect(parseTimesArgs(['pc-04', '--from', 'old/solutions', '--apply'])).toEqual({
    ids: ['pc-04'],
    apply: true,
    force: false,
    from: 'old/solutions',
  });
  expect(parseTimesArgs(['--from'])).toHaveProperty('error');
  expect(parseTimesArgs(['--bogus'])).toHaveProperty('error');
});

const TSX = `<tileset name="pc" tilewidth="16" tileheight="16">${TILE_ORDER.map((k, i) => `<tile id="${i}"><properties><property name="kind" value="${k}"/></properties></tile>`).join('')}</tileset>`;

function fixture(levels: LevelData[]): string {
  const dir = mkdtempSync(join(tmpdir(), 'pc-times-'));
  writeFileSync(join(dir, 'tileset.tsx'), TSX);
  for (const l of levels) writeFileSync(join(dir, `${l.id}.tmx`), writeTmx(l));
  writeFileSync(
    join(dir, 'chapters.json'),
    JSON.stringify([
      { id: 'c', name: { fr: 'C', en: 'C' }, unlockAfter: 0, levels: levels.map((l) => l.id) },
    ]),
  );
  mkdirSync(join(dir, 'solutions'));
  return dir;
}

test('command: table, --apply writes a missing goldTime, --force replaces one', () => {
  const dir = fixture([
    fromAscii(['@...E'], { id: 'a' }),
    fromAscii(['@.E'], { id: 'b' }),
    fromAscii(['@E'], { id: 'c' }),
  ]);
  writeFileSync(join(dir, 'solutions', 'a.txt'), '# optimal (proven)\nRRRR\n');
  writeFileSync(join(dir, 'solutions', 'b.txt'), 'RR\n');
  const tmxB = join(dir, 'b.tmx');
  writeFileSync(tmxB, setMapProperty(readFileSync(tmxB, 'utf8'), 'goldTime', 999));
  const expected = goldTimeFor(feat({ moves: 4 }));

  const dry = timesCommand(dir, { ids: 'all', apply: false, force: false });
  expect(dry.ok).toBe(true);
  expect(dry.lines.join('\n')).toMatch(/c: no saved solution — skipped/);
  expect(readFileSync(join(dir, 'a.tmx'), 'utf8')).not.toMatch(/goldTime/);

  const r = timesCommand(dir, { ids: 'all', apply: true, force: false });
  expect(r.lines.join('\n')).toMatch(/kept \(--force to replace\)/);
  expect(readFileSync(join(dir, 'a.tmx'), 'utf8')).toMatch(
    new RegExp(`name="goldTime" type="int" value="${expected}"`),
  );
  expect(readFileSync(tmxB, 'utf8')).toMatch(/value="999"/);

  timesCommand(dir, { ids: ['b'], apply: true, force: true });
  expect(readFileSync(tmxB, 'utf8')).not.toMatch(/value="999"/);
});
