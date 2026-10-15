import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, test } from 'vitest';
import { fromAscii, initialState, parseMoves, solve, step, type LevelData } from '@puzzlecave/core';
import { TILE_ORDER, writeTmx } from '@puzzlecave/tiled';
import {
  TRAP_PRIOR,
  difficultyCommand,
  difficultyParts,
  difficultyScore,
  measureDifficulty,
  parseDifficultyArgs,
  stateAsLevel,
  type DifficultyFeatures,
} from './difficulty';

// the exit is only reachable through the water; every push of the block but "right, right"
// strands it against a wall (the level is lost)
const TRAPS = fromAscii(['#######', '#....##', '#@B.~E#', '#....##', '#######'], { id: 'traps' });

test('features: pushes, fills, runs, commitments, decision points, branching, traps', () => {
  const f = measureDifficulty(TRAPS, parseMoves('RRRR'));
  expect(f).toMatchObject({
    moves: 4,
    interactions: 2,
    pushes: 2,
    fills: 1,
    keys: 0,
    doors: 0,
    actions: 1,
    episodes: 1,
    irreversible: 1,
    stages: 2,
    decisionPoints: 3,
    sampled: 3,
    // first point: up, down, left; second: up, down; all lost
    alternatives: 5,
    traps: 5,
    solverDone: true,
  });
  // 4 + 3 + 1 interactions available (the last point: the exit)
  expect(f.branching).toBeCloseTo(8 / 3);
  expect(f.trapRate).toBeCloseTo(5 / (5 + TRAP_PRIOR));
  expect(f.walkShare).toBeCloseTo(0.5);
});

test('features: a push the player can undo is not a commitment; keys and doors are episodes', () => {
  const open = fromAscii(['#######', '#.....#', '#@.B..#', '#.....E', '#######']);
  const f = measureDifficulty(open, parseMoves('RRDRRR'));
  expect(f).toMatchObject({ pushes: 1, actions: 1, episodes: 1, irreversible: 0 });

  const doors = fromAscii(['@kkDD.E']);
  const g = measureDifficulty(doors, parseMoves('RRRRRR'));
  // two keys and two doors: four episodes, the doors are commitments
  expect(g).toMatchObject({ keys: 2, doors: 2, actions: 4, episodes: 4, irreversible: 2 });
});

test('features: pushes of one block are one episode, whatever their direction', () => {
  // the block is pushed right, then the player goes round and pushes it down into the water
  const level = fromAscii(['######', '#....#', '#@B..#', '###~##', '###E##', '######']);
  const moves = parseMoves('RURDDD');
  const sol = solve(level);
  expect(sol.status === 'solved' && sol.moves.length).toBe(moves.length);
  const f = measureDifficulty(level, moves);
  // the first push can be pushed back (from the right): only the fill is a commitment
  expect(f).toMatchObject({ pushes: 2, fills: 1, actions: 2, episodes: 1, irreversible: 1 });
});

test('features: a losing or refused solution is an error', () => {
  expect(() => measureDifficulty(TRAPS, parseMoves('L'))).toThrow(/move 1 \(left\) is refused/);
  expect(() => measureDifficulty(TRAPS, parseMoves('R'))).toThrow(/does not win/);
});

test('a game state as a level: same start, objects and keys', () => {
  const level = fromAscii(['@kB.E'], { initialKeys: -1 });
  const s = step(initialState(level), 'right').state;
  const l = stateAsLevel(s);
  expect(l.start).toEqual({ x: 1, y: 0 });
  expect(l.initialKeys).toBe(0);
  expect(l.objects).toEqual([{ x: 2, y: 0, kind: 'block' }]);
  expect(initialState(l).terrain).toEqual(s.terrain);
});

const feat = (o: Partial<DifficultyFeatures>): DifficultyFeatures => ({
  moves: 10,
  interactions: 5,
  pushes: 5,
  fills: 0,
  keys: 0,
  doors: 0,
  actions: 3,
  episodes: 3,
  irreversible: 1,
  stages: 1,
  decisionPoints: 5,
  branching: 2,
  sampled: 5,
  alternatives: 5,
  traps: 0,
  trapRate: 0,
  solverStates: 100,
  solverDone: true,
  walkShare: 0.5,
  ...o,
});

test('score: the sum of its parts; decisions weigh far more than walking', () => {
  const base = feat({});
  const parts = difficultyParts(base);
  expect(difficultyScore(base)).toBeCloseTo(Object.values(parts).reduce((a, b) => a + b));
  expect(parts.episodes).toBeCloseTo(20);
  for (const more of [
    { episodes: 4 },
    { irreversible: 2 },
    { branching: 3 },
    { solverStates: 1000 },
    { trapRate: 0.5 },
    { moves: 20 },
  ])
    expect(difficultyScore(feat(more))).toBeGreaterThan(difficultyScore(base));
  // ten times the walk adds less than four more episodes
  const walk = difficultyScore(feat({ moves: 55 })) - difficultyScore(base);
  const think = difficultyScore(feat({ episodes: 7 })) - difficultyScore(base);
  expect(walk).toBeLessThan(think);
});

test('arguments', () => {
  expect(parseDifficultyArgs([])).toEqual({ ids: 'all' });
  expect(parseDifficultyArgs(['pc-01', '--trap-points', '10', '--solver-timeout', '5'])).toEqual({
    ids: ['pc-01'],
    trapPoints: 10,
    solverTimeoutMs: 5000,
  });
  expect(parseDifficultyArgs(['--trap-states'])).toHaveProperty('error');
  expect(parseDifficultyArgs(['--solver-states', '-3'])).toHaveProperty('error');
  expect(parseDifficultyArgs(['--bogus'])).toHaveProperty('error');
});

const TSX = `<tileset name="pc" tilewidth="16" tileheight="16">${TILE_ORDER.map((k, i) => `<tile id="${i}"><properties><property name="kind" value="${k}"/></properties></tile>`).join('')}</tileset>`;

function fixture(levels: LevelData[]): string {
  const dir = mkdtempSync(join(tmpdir(), 'pc-difficulty-'));
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

test('command: levels sorted by score with their chapter, missing solutions reported', () => {
  const dir = fixture([
    { ...TRAPS, id: 'hard', name: 'Hard one' },
    fromAscii(['@...E'], { id: 'walk', name: 'Walk' }),
    fromAscii(['@E'], { id: 'none' }),
  ]);
  writeFileSync(join(dir, 'solutions', 'hard.txt'), '# optimal (proven)\nRRRR\n');
  writeFileSync(join(dir, 'solutions', 'walk.txt'), 'RRRR\n');
  const r = difficultyCommand(dir, { ids: 'all' });
  expect(r.ok).toBe(true);
  const text = r.lines.join('\n');
  expect(text).toMatch(/none: no saved solution — skipped/);
  const ranked = r.lines.filter((l) => /^\s+\d+ /.test(l));
  expect(ranked).toHaveLength(2);
  expect(ranked[0]).toMatch(/^\s+1 walk\s+c\s/);
  expect(ranked[1]).toMatch(/^\s+2 hard\s+c\s.*Hard one$/);
  expect(difficultyCommand(dir, { ids: ['nope'] }).ok).toBe(false);
});
