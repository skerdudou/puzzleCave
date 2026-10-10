import { expect, test, vi } from 'vitest';
import { fromAscii } from '../ascii';
import { replay } from '../replay';
import { solve } from '../solver';
import { solveNaive } from '../solverNaive';
import { initialState } from '../state';
import { step } from '../step';
import type { Dir, LevelData } from '../types';
import { findSolution } from './findSolution';
import { checkpoints } from './macro';
import { reoptimize, searchWindow } from './reoptimize';
import { sampleLevels } from '../testLevels';

const OPPOSITE: Record<Dir, Dir> = { up: 'down', down: 'up', left: 'right', right: 'left' };

function optimum(level: LevelData): number {
  const r = solveNaive(level, { maxStates: 10_000_000, timeoutMs: 60_000 });
  if (r.status !== 'solved') throw new Error(`${level.id} : ${r.status}`);
  return r.moves.length;
}

/** inserts back-and-forths at each step where they keep a winning solution */
function lengthen(level: LevelData, moves: Dir[], every = 2): Dir[] {
  let out = moves.slice();
  for (let i = out.length - 1; i >= 0; i -= every) {
    for (const d of ['up', 'left', 'down', 'right'] as Dir[]) {
      const cand = [...out.slice(0, i), d, OPPOSITE[d], ...out.slice(i)];
      const end = replay(level, cand);
      if (end.status === 'won' && end.moves > replay(level, out).moves) {
        out = cand;
        break;
      }
    }
  }
  return out;
}

const opts = { timeoutMs: 30_000 };

test('reoptimize brings a lengthened corridor (detours, back-and-forths) back to the optimum', () => {
  const level = fromAscii(['@....', '.###.', '....E']);
  const long: Dir[] = [
    'down',
    'down',
    'up',
    'right',
    'left',
    'down',
    'right',
    'right',
    'right',
    'right',
  ];
  expect(replay(level, long).status).toBe('won');
  const r = reoptimize(level, long, opts);
  expect(r.moves).toHaveLength(optimum(level));
  expect(replay(level, r.moves).status).toBe('won');
});

test('reoptimize shortens a solution with keys, doors, blocks and water down to the optimum', () => {
  const level = fromAscii(['@kB~E', '.D###', '.k...'], { initialKeys: 0 });
  const long = lengthen(level, ['right', 'right', 'right', 'right'], 1);
  expect(long.length).toBeGreaterThan(4);
  const r = reoptimize(level, long, opts);
  expect(r.moves).toHaveLength(4);
  expect(r.rejected).toBe(0);
});

test('searchWindow: shortest path to an exact state, strictly below the limit', () => {
  // detour via the bottom before pushing the block one cell: 4 moves, 2 suffice
  const level = fromAscii(['@.B..', '.....']);
  const moves: Dir[] = ['down', 'right', 'up', 'right'];
  let s = initialState(level);
  for (const m of moves) s = step(s, m).state;
  const from = initialState(level);
  const w = (limit: number) =>
    searchWindow(from, { ...s, moves: 0 }, limit, { maxStates: 1000, timeoutMs: 1000 });
  const r = w(moves.length);
  expect(r.status).toBe('shorter');
  if (r.status === 'shorter') {
    expect(r.moves).toEqual(['right', 'right']);
  }
  expect(w(2).status).toBe('none');
  expect(searchWindow(from, { ...s, moves: 0 }, 5, { maxStates: 1, timeoutMs: 1000 }).status).toBe(
    'limit',
  );
});

test('searchWindow: a limit beyond the heap’s exact order (2^16) answers "limit"', () => {
  const level = fromAscii(['@.B..', '.....']);
  let s = initialState(level);
  for (const m of ['down', 'right', 'up', 'right'] as Dir[]) s = step(s, m).state;
  const w = (limit: number) =>
    searchWindow(initialState(level), { ...s, moves: 0 }, limit, {
      maxStates: 1000,
      timeoutMs: 1000,
    }).status;
  expect(w(1 << 16)).toBe('shorter');
  expect(w((1 << 16) + 1)).toBe('limit');
});

test('reoptimize: the final windows go through the supplied exact engine', () => {
  const level = fromAscii(['@kB~E', '.D###', '.k...'], { initialKeys: 0 });
  const long = lengthen(level, ['right', 'right', 'right', 'right'], 1);
  const exact = vi.fn(solve);
  const r = reoptimize(level, long, { ...opts, exact });
  expect(exact).toHaveBeenCalled();
  expect(r.moves).toHaveLength(4);
  // engine that never finishes: only the internal windows are used, never longer
  const stuck = vi.fn(() => ({ status: 'timeout' as const, explored: 0, lowerBound: 0 }));
  const r2 = reoptimize(level, long, { ...opts, exact: stuck });
  expect(r2.moves.length).toBeLessThanOrEqual(long.length);
  expect(replay(level, r2.moves).status).toBe('won');
});

test('property: on the random sample, always winning, never longer, optimal if the window covers everything', () => {
  let checked = 0;
  for (const level of sampleLevels()) {
    const found = findSolution(level, { maxStates: 1_000_000, timeoutMs: 60_000 });
    if (found.status !== 'solved') continue;
    const long = lengthen(level, found.moves);
    const best = optimum(level);
    const r = reoptimize(level, long, opts);
    expect(replay(level, r.moves).status, level.id).toBe('won');
    expect(r.moves.length, level.id).toBeLessThanOrEqual(long.length);
    expect(r.rejected, level.id).toBe(0);
    expect(r.moves.length, level.id).toBe(best);
    // tiny budget per window: guarantees kept
    const tight = reoptimize(level, long, { ...opts, maxStatesPerWindow: 3 });
    expect(replay(level, tight.moves).status, level.id).toBe('won');
    expect(tight.moves.length, level.id).toBeLessThanOrEqual(long.length);
    checked++;
  }
  expect(checked).toBeGreaterThan(200);
});

test('reoptimize starts from a normalized solution (moves without effect removed)', () => {
  const level = fromAscii(['@..E', '####']);
  const r = reoptimize(level, ['down', 'right', 'up', 'right', 'right'], opts);
  expect(r.moves).toEqual(['right', 'right', 'right']);
  expect(checkpoints(level, r.moves).idx).toEqual([0, 3]);
});

test('property: searchWindow is exact on the windows of an optimal solution', () => {
  let windows = 0;
  for (const level of sampleLevels()) {
    const naive = solveNaive(level, { maxStates: 10_000_000, timeoutMs: 60_000 });
    if (naive.status !== 'solved') continue;
    const { idx, states } = checkpoints(level, naive.moves);
    for (let a = 0; a < idx.length - 1; a++)
      for (let b = a + 1; b < idx.length; b++) {
        const cost = idx[b]! - idx[a]!;
        const w = (limit: number) =>
          searchWindow(states[a]!, states[b]!, limit, { maxStates: 1_000_000, timeoutMs: 60_000 });
        // an optimal solution has no shortenable piece…
        expect(w(cost).status, `${level.id} ${a}-${b}`).toBe('none');
        // …and the piece itself (or another of the same length) is found
        const r = w(cost + 1);
        expect(r.status, `${level.id} ${a}-${b}`).toBe('shorter');
        if (r.status === 'shorter') {
          expect(r.moves).toHaveLength(cost);
          const spliced = [
            ...naive.moves.slice(0, idx[a]!),
            ...r.moves,
            ...naive.moves.slice(idx[b]!),
          ];
          expect(replay(level, spliced).status, `${level.id} ${a}-${b}`).toBe('won');
        }
        windows++;
      }
  }
  expect(windows).toBeGreaterThan(500);
});

test('property: internal windows only (step 1, exact engine without an answer)', () => {
  const stuck = () => ({ status: 'timeout' as const, explored: 0, lowerBound: 0 });
  let improved = 0;
  for (const level of sampleLevels()) {
    const found = findSolution(level, { maxStates: 1_000_000, timeoutMs: 60_000 });
    if (found.status !== 'solved') continue;
    const long = lengthen(level, found.moves);
    const r = reoptimize(level, long, { ...opts, windowStep: 1, exact: stuck });
    expect(replay(level, r.moves).status, level.id).toBe('won');
    expect(r.moves.length, level.id).toBeLessThanOrEqual(long.length);
    expect(r.rejected, level.id).toBe(0);
    if (r.moves.length < long.length) improved++;
    // with the exact engine, step 1 also reaches the optimum
    const full = reoptimize(level, long, { ...opts, windowStep: 1 });
    expect(full.moves.length, level.id).toBe(optimum(level));
  }
  expect(improved).toBeGreaterThan(50);
});
