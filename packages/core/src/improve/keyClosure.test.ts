import { expect, test } from 'vitest';
import { fromAscii } from '../ascii';
import { CompactModel } from '../compactModel';
import { replay } from '../replay';
import { solve } from '../solver';
import { solveNaive } from '../solverNaive';
import { DIRS, initialState } from '../state';
import { step } from '../step';
import { mulberry32, sampleLevels, validRandomLevel } from '../testLevels';
import { findSolution } from './findSolution';
import { closeKeys } from './keyClosure';

/** closure of the start of `rows`: cost, moves, and the real state after those moves */
function closeStart(rows: string[]) {
  const level = fromAscii(rows);
  const model = new CompactModel(level);
  const key = model.encode(model.start);
  const dirs: number[] = [];
  const cost = closeKeys(new CompactModel(level), key, dirs);
  let s = initialState(level);
  for (const d of dirs) s = step(s, DIRS[d]!).state;
  return { cost, dirs, key, model, s };
}

test('closeKeys picks up every key reachable by walking, nearest first', () => {
  const { cost, dirs, key, model, s } = closeStart(['k.@..k', '###.##', '..k...']);
  expect(cost).toBe(dirs.length);
  // left key (2 moves), then the right one (5, nearer than the bottom one: 6), then the bottom one
  expect(cost).toBe(2 + 5 + 5);
  expect(s.keys).toBe(3);
  expect(s.objects.filter((o) => o === 'key')).toHaveLength(0);
  // the macro-state key is the encoding of the real state reached by those moves
  expect([...key]).toEqual([...model.encode(s)]);
});

test('closeKeys neither pushes, opens nor wins', () => {
  const { cost, s } = closeStart(['@kD.k', 'B####', 'k####']);
  expect(cost).toBe(1);
  expect(s.keys).toBe(1);
  expect(s.objects.filter((o) => o === 'key')).toHaveLength(2);
  const none = closeStart(['@.D.k', '#####']);
  expect(none.cost).toBe(0);
  expect(none.dirs).toEqual([]);
});

test('closeKeys leaves a player standing on water (start on water: no way back)', () => {
  // random level rnd-202: the exit is next to the start, the key's dead end has no way out
  const level = fromAscii(['@E', 'k#']);
  level.terrain[0] = 'water';
  const model = new CompactModel(level);
  const key = model.encode(model.start);
  expect(closeKeys(new CompactModel(level), key)).toBe(0);
  const r = findSolution(level, { maxStates: 1000, timeoutMs: 1000, keyClosure: true });
  expect(r).toMatchObject({ status: 'solved', moves: ['right'] });
});

test('closeKeys clamps the pocket to the remaining doors, like encode', () => {
  // two keys, one door: the second key adds nothing
  const { key, model, s } = closeStart(['@kk.D.E']);
  expect([...key]).toEqual([...model.encode(s)]);
});

test('findSolution with keyClosure: solutions replay', () => {
  for (const rows of [
    ['@kB~E', '#D###', '#.###'],
    ['k....@.DE', '#####.###', '#####k###'],
    ['k.@..k', '###D##', '..k.DE'],
  ]) {
    const level = fromAscii(rows);
    const r = findSolution(level, { maxStates: 100_000, timeoutMs: 10_000, keyClosure: true });
    expect(r.status).toBe('solved');
    if (r.status === 'solved') expect(replay(level, r.moves).status).toBe('won');
  }
});

test('property: the key closure filter changes nothing (same states, same solution)', () => {
  const rnd = mulberry32(11);
  let compared = 0;
  const levels = [...sampleLevels()];
  for (let n = 0; n < 200; n++) levels.push(validRandomLevel(rnd, n));
  for (const level of levels) {
    const run = (keyClosureFilter: boolean) =>
      findSolution(level, {
        maxStates: 200_000,
        timeoutMs: 60_000,
        keyClosure: true,
        keyClosureFilter,
      });
    const a = run(true);
    expect(a, level.id).toEqual(run(false));
    if (a.status === 'solved') compared++;
  }
  expect(compared).toBeGreaterThan(300);
});

test('property: with keyClosure, solves what solve() solves (random samples), solutions replay', () => {
  let solved = 0;
  const check = (level: ReturnType<typeof fromAscii>, solvable: boolean) => {
    const r = findSolution(level, { maxStates: 1_000_000, timeoutMs: 60_000, keyClosure: true });
    if (!solvable) return expect(r.status, level.id).toBe('failed');
    expect(r.status, level.id).toBe('solved');
    if (r.status === 'solved') expect(replay(level, r.moves).status, level.id).toBe('won');
    solved++;
  };
  for (const level of sampleLevels())
    check(
      level,
      solveNaive(level, { maxStates: 10_000_000, timeoutMs: 60_000 }).status === 'solved',
    );
  const rnd = mulberry32(5);
  for (let n = 0; n < 300; n++) {
    const level = validRandomLevel(rnd, n);
    if (solve(level, { timeoutMs: 60_000 }).status === 'solved') check(level, true);
  }
  expect(solved).toBeGreaterThan(300);
});
