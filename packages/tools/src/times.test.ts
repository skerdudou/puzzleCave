import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, test } from 'vitest';
import { fromAscii, parseMoves, type LevelData } from '@puzzlecave/core';
import { TILE_ORDER, setMapProperty, writeTmx } from '@puzzlecave/tiled';
import {
  TIME_RULE,
  estimateTime,
  marginFor,
  fatigueFactor,
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
  heldRuns: 0,
  heldMoves: 0,
  pushes: 0,
  keys: 0,
  doors: 0,
  fills: 0,
  interactions: 0,
  ...o,
});

test('features: held runs, the straight runs of 6 moves or more', () => {
  const level = fromAscii(['@.......', '.######.', '.......E']);
  // 7 right (held), 2 down, 7 left (held)… a longer way: 7 right, 2 down
  const f = solutionFeatures(level, parseMoves('RRRRRRRDD'));
  expect(f).toMatchObject({ moves: 9, turns: 1, heldRuns: 1, heldMoves: 7 });
  const g = solutionFeatures(level, parseMoves('DDRRRRRRR'));
  expect(g).toMatchObject({ moves: 9, turns: 1, heldRuns: 1, heldMoves: 7 });
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

test('rule: per press plus per turn; a held run costs the repeat delay, then its interval', () => {
  const rule = { ...TIME_RULE, fatigue: 0 };
  expect(estimateTime(feat({ moves: 10, turns: 4 }), rule)).toBeCloseTo(
    10 * TIME_RULE.perMove + 4 * TIME_RULE.perTurn,
  );
  // a single held run of 10: its first move pressed, the repeat's delay, then 8 intervals
  expect(estimateTime(feat({ moves: 10, heldRuns: 1, heldMoves: 10 }), rule)).toBeCloseTo(
    TIME_RULE.perMove + TIME_RULE.holdDelay + 8 * TIME_RULE.holdInterval,
  );
  // holding is cheaper than pressing on a long run
  expect(estimateTime(feat({ moves: 10, heldRuns: 1, heldMoves: 10 }))).toBeLessThan(
    estimateTime(feat({ moves: 10 })),
  );
});

test('fatigue: none up to 300 moves, then +5 % each time the moves double, 5 % at most', () => {
  expect(fatigueFactor(0)).toBe(1);
  expect(fatigueFactor(300)).toBe(1);
  expect(fatigueFactor(450)).toBeCloseTo(1 + 0.05 * Math.log2(1.5));
  expect(fatigueFactor(600)).toBeCloseTo(1.05);
  expect(fatigueFactor(5000)).toBeCloseTo(1.05);
});

test('margins: shrinking chapter after chapter, none on Expert', () => {
  const chapters = ['easy', 'medium', 'hard', 'expert'].map((id) => ({
    id,
    name: { en: id, fr: id },
    unlockAfter: 0,
    levels: [`${id}-1`],
  }));
  const m = chapters.map((c) => marginFor(chapters, c.levels[0]!));
  expect(m).toEqual([...m].sort((x, y) => y - x));
  expect(m.at(-1)).toBe(1);
  expect(marginFor(chapters, 'elsewhere')).toBe(1);
  const f = feat({ moves: 100, turns: 40 });
  expect(goldTimeFor(f, undefined, 1.1)).toBe(niceSeconds(estimateTime(f) * 1.1));
});

test('rounding up: to the tenth below a minute, to the second above', () => {
  expect(niceSeconds(0.02)).toBe(0.1);
  expect(niceSeconds(4.86)).toBe(4.9);
  expect(niceSeconds(12.41)).toBe(12.5);
  // a float a hair above a tenth stays on it
  expect(niceSeconds(13.700000001)).toBe(13.7);
  expect(niceSeconds(1.1 * 3)).toBe(3.3);
  expect(niceSeconds(59.96)).toBe(60);
  expect(niceSeconds(60.2)).toBe(61);
  expect(niceSeconds(142)).toBe(142);
  expect(niceSeconds(142.4)).toBe(143);
});

test('a solution shorter than goldMoves: the time grows with the move ratio', () => {
  const f = feat({ moves: 100, turns: 40 });
  const est = estimateTime(f);
  expect(goldTimeFor(f)).toBe(niceSeconds(est));
  expect(goldTimeFor(f, 100)).toBe(niceSeconds(est));
  expect(goldTimeFor(f, 110)).toBe(niceSeconds(est * 1.1));
  // a longer solution (not the gold limit's) is never shortened
  expect(goldTimeFor(f, 90)).toBe(niceSeconds(est));
});

test('fitted rule: more moves, turns or interactions never lower the gold time', () => {
  const base = feat({ moves: 50, turns: 20, interactions: 10 });
  const g = goldTimeFor(base);
  expect(g).toBeGreaterThan(0);
  expect(goldTimeFor({ ...base, moves: 80 })).toBeGreaterThanOrEqual(g);
  expect(goldTimeFor({ ...base, turns: 40 })).toBeGreaterThanOrEqual(g);
  expect(goldTimeFor({ ...base, interactions: 30 })).toBeGreaterThanOrEqual(g);
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
    new RegExp(`name="goldTime" type="(int|float)" value="${expected}"`),
  );
  expect(readFileSync(tmxB, 'utf8')).toMatch(/value="999"/);

  timesCommand(dir, { ids: ['b'], apply: true, force: true });
  expect(readFileSync(tmxB, 'utf8')).not.toMatch(/value="999"/);
});

test('command: the gold reference solution first, else the saved one scaled to goldMoves', () => {
  const dir = fixture([
    fromAscii(['@.....E'], { id: 'g', thresholds: { goldMoves: 8 } }),
    fromAscii(['@.....E'], { id: 'p', thresholds: { goldMoves: 9 } }),
  ]);
  mkdirSync(join(dir, 'solutions', 'gold'));
  writeFileSync(join(dir, 'solutions', 'g.txt'), 'RRRRRR\n');
  writeFileSync(join(dir, 'solutions', 'gold', 'g.txt'), 'RRRLRRRR\n');
  writeFileSync(join(dir, 'solutions', 'p.txt'), 'RRRRRR\n');
  timesCommand(dir, { ids: 'all', apply: true, force: false });
  const gold = goldTimeFor(feat({ moves: 8, turns: 2 }));
  const scaled = niceSeconds(estimateTime(feat({ moves: 6, heldRuns: 1, heldMoves: 6 })) * 1.5);
  expect(readFileSync(join(dir, 'g.tmx'), 'utf8')).toMatch(
    `name="goldTime" type="float" value="${gold}"`,
  );
  expect(readFileSync(join(dir, 'p.tmx'), 'utf8')).toMatch(
    `name="goldTime" type="float" value="${scaled}"`,
  );
});
