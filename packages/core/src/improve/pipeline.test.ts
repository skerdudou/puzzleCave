import { expect, test, vi } from 'vitest';
import { fromAscii } from '../ascii';
import { replay } from '../replay';
import { solve } from '../solver';
import type { Dir } from '../types';
import { planSolution } from '../planner/plan';
import { findSolution } from './findSolution';
import { improveLevel } from './pipeline';
import { searchWindow } from './window';

// optimum 4: key, block into the water, exit
const LEVEL = fromAscii(['@kB~E', '.D###', '.k...'], { initialKeys: 0 });
const LONG: Dir[] = [
  'down',
  'down',
  'up',
  'up',
  'right',
  'left',
  'right',
  'right',
  'right',
  'right',
];
const opts = { timeoutMs: 20_000, maxStates: 100_000 };
const timeout = (lowerBound: number) =>
  vi.fn(() => ({ status: 'timeout' as const, explored: 0, lowerBound }));

test('designer solution preferred, reoptimized and proven optimal', () => {
  expect(replay(LEVEL, LONG).status).toBe('won');
  const find = vi.fn(findSolution);
  const exact = vi.fn(solve);
  const r = improveLevel(LEVEL, { ...opts, initial: LONG, find, exact });
  expect(find).not.toHaveBeenCalled();
  expect(exact).toHaveBeenCalled();
  expect(r.start).toBe('designer');
  expect(r.initialLength).toBe(LONG.length);
  expect(r.moves).toHaveLength(4);
  expect(r.proven).toBe(true);
  expect(r.lowerBound).toBe(4);
  expect(replay(LEVEL, r.moves!).status).toBe('won');
  expect(r.stages.map((s) => s.stage)).toEqual(['reoptimize', 'spareKeys', 'freeze', 'proof']);
});

test('global engine (GPU): frozen blocks and proof only, never the windows', () => {
  const exact = vi.fn(solve);
  const global = vi.fn(solve);
  const r = improveLevel(LEVEL, { ...opts, initial: LONG, exact, global });
  expect(r.proven).toBe(true);
  expect(r.moves).toHaveLength(4);
  // final windows: ordinary exact engine, without auto mode
  expect(exact).toHaveBeenCalled();
  for (const [, o] of exact.mock.calls) expect(o?.partialExpansion).toBeUndefined();
  // frozen blocks and proof (auto mode): global engine; the proof covers the whole level
  expect(global.mock.calls.length).toBeGreaterThanOrEqual(2);
  for (const [, o] of global.mock.calls) expect(o?.partialExpansion).toBe('auto');
  expect(global.mock.calls.at(-1)![0]).toBe(LEVEL);
});

test('memory budget: passed to each search; auto mode for the proof and frozen blocks, not for the final windows; no state limit', () => {
  const calls: {
    maxMemoryMb?: number;
    partialExpansion?: unknown;
    maxStates?: number;
    upperBound?: number;
  }[] = [];
  const exact = vi.fn((l: Parameters<typeof solve>[0], o: Parameters<typeof solve>[1]) => {
    calls.push({ ...o });
    return solve(l, o);
  });
  const find = vi.fn(findSolution);
  const window = vi.fn((...a: Parameters<typeof searchWindow>) => searchWindow(...a));
  const r = improveLevel(LEVEL, { timeoutMs: 20_000, maxMemoryMb: 64, exact, find, window });
  expect(r.proven).toBe(true);
  expect(find.mock.calls[0]![1]).toMatchObject({ maxMemoryMb: 64 });
  expect(find.mock.calls[0]![1].maxStates).toBe(Infinity);
  expect(calls.length).toBeGreaterThan(1);
  for (const c of calls) expect(c.maxMemoryMb).toBe(64);
  // last call: the proof (no state limit, auto mode)
  expect(calls.at(-1)).toMatchObject({ partialExpansion: 'auto' });
  expect(calls.at(-1)!.maxStates).toBeUndefined();
  // final windows: state limit per window, without partial expansion
  const finals = calls.filter((c) => c.partialExpansion !== 'auto');
  expect(finals.length).toBeGreaterThan(0);
  for (const c of finals) expect(c.maxStates).toBe(2_000_000);
  for (const [, , , wo] of window.mock.calls) expect(wo).toMatchObject({ maxMemoryMb: 64 });
});

test('spare keys stage: a useless key pickup the windows cannot drop is removed', () => {
  // one key in hand opens the door; the key at (1,0) is a detour of 2 moves
  const level = fromAscii(['#k######', '@.....DE'], { initialKeys: 1 });
  const initial: Dir[] = ['right', 'up', 'down', ...Array<Dir>(6).fill('right')];
  // exact engine without an answer: only the windows towards an exact state work
  const r = improveLevel(level, { ...opts, initial, exact: timeout(0) });
  const spare = r.stages.find((s) => s.stage === 'spareKeys')!;
  expect(r.stages.find((s) => s.stage === 'reoptimize')!.after).toBe(9);
  expect(spare).toMatchObject({ before: 9, after: 7 });
  expect(spare.note).toMatch(/^1 key pickups removed/);
  expect(r.moves).toHaveLength(7);
  expect(replay(level, r.moves!).status).toBe('won');
});

test('without a designer solution: a solution is searched for', () => {
  const find = vi.fn(findSolution);
  const r = improveLevel(LEVEL, { ...opts, find });
  expect(find).toHaveBeenCalled();
  expect(r.start).toBe('found');
  expect(r.stages[0]!.stage).toBe('find');
  expect(r.moves).toHaveLength(4);
  expect(r.proven).toBe(true);
});

test('designer solution that does not win: flagged, then search', () => {
  const r = improveLevel(LEVEL, { ...opts, initial: ['down'] });
  expect(r.designerInvalid).toBe('playing');
  expect(r.start).toBe('found');
  expect(replay(LEVEL, r.moves!).status).toBe('won');
});

test('exact search that does not finish: best known, proven lower bound', () => {
  const r = improveLevel(LEVEL, { ...opts, initial: LONG, exact: timeout(3) });
  expect(r.proven).toBe(false);
  expect(r.lowerBound).toBe(3);
  expect(r.moves!.length).toBeLessThanOrEqual(LONG.length);
  expect(replay(LEVEL, r.moves!).status).toBe('won');
});

test('lower bound equal to the length: proven without the search finishing', () => {
  const r = improveLevel(LEVEL, {
    ...opts,
    initial: ['right', 'right', 'right', 'right'],
    exact: timeout(4),
  });
  expect(r.moves).toHaveLength(4);
  expect(r.proven).toBe(true);
});

test('engine answering "nothing shorter" (upperBound): the solution is proven', () => {
  const exact = vi.fn((_l, o: { upperBound?: number }) =>
    o.upperBound !== undefined
      ? { status: 'unsolvable' as const, explored: 0 }
      : { status: 'timeout' as const, explored: 0, lowerBound: 0 },
  );
  const r = improveLevel(LEVEL, { ...opts, initial: ['right', 'right', 'right', 'right'], exact });
  expect(r.proven).toBe(true);
  expect(r.lowerBound).toBe(4);
});

test.each([
  ['that does not win', ['down'] as Dir[]],
  ['longer than the current solution', ['down', 'up', ...LONG] as Dir[]],
])('proof: an exact engine solution %s proves nothing', (_, bad) => {
  // the engine only answers the proof (no final window nor useful restriction)
  const exact = vi.fn((_l, o: { maxStates?: number }) =>
    o.maxStates === 100_000
      ? { status: 'solved' as const, moves: bad, explored: 1 }
      : { status: 'timeout' as const, explored: 0, lowerBound: 0 },
  );
  const r = improveLevel(LEVEL, { ...opts, maxStatesPerWindow: 50, initial: LONG, exact });
  expect(r.proven).toBe(false);
  expect(r.lowerBound).toBe(0);
  expect(r.moves!.length).toBeLessThanOrEqual(LONG.length);
  expect(replay(LEVEL, r.moves!).status).toBe('won');
  expect(r.stages.at(-1)!.note).toMatch(/inconsistent/);
});

test('proof: an exact engine solution of the same length proves optimality', () => {
  const exact = vi.fn(() => ({
    status: 'solved' as const,
    moves: ['right', 'right', 'right', 'right'] as Dir[],
    explored: 1,
  }));
  const r = improveLevel(LEVEL, { ...opts, initial: ['right', 'right', 'right', 'right'], exact });
  expect(r.proven).toBe(true);
  expect(r.lowerBound).toBe(4);
});

test('unsolvable level: nothing to do, reported as such', () => {
  const r = improveLevel(fromAscii(['@#E']), opts);
  expect(r.start).toBe('none');
  expect(r.moves).toBeUndefined();
  expect(r.unsolvable).toBe(true);
  expect(r.proven).toBe(false);
});

test('no solution found within the limits: lower bound of the exact search', () => {
  const r = improveLevel(LEVEL, {
    ...opts,
    find: () => ({ status: 'failed', reason: 'limit', explored: 1 }),
    exact: timeout(2),
    planFallback: false,
  });
  expect(r.start).toBe('none');
  expect(r.moves).toBeUndefined();
  expect(r.lowerBound).toBe(2);
  expect(r.stages.map((s) => s.stage)).toEqual(['find', 'proof']);
});

test('planner fallback: no search solution, the plan is the starting point', () => {
  const planner = vi.fn(planSolution);
  const r = improveLevel(LEVEL, {
    ...opts,
    find: () => ({ status: 'failed', reason: 'limit', explored: 1 }),
    exact: timeout(2),
    planner,
  });
  expect(planner).toHaveBeenCalledOnce();
  // its share: 30 % of the duration after the search's 30 %
  expect(planner.mock.calls[0]![1].timeoutMs).toBeGreaterThan(0.55 * opts.timeoutMs);
  expect(planner.mock.calls[0]![1].timeoutMs).toBeLessThanOrEqual(0.6 * opts.timeoutMs);
  expect(r.start).toBe('planned');
  expect(r.stages.map((s) => s.stage)).toEqual([
    'find',
    'plan',
    'reoptimize',
    'spareKeys',
    'freeze',
    'proof',
  ]);
  expect(replay(LEVEL, r.moves!).status).toBe('won');
  // the windows bring the plan down to the optimum
  expect(r.moves).toHaveLength(4);
});

test('planner fallback: not run when the search succeeds or with a designer solution', () => {
  const planner = vi.fn(planSolution);
  improveLevel(LEVEL, { ...opts, planner });
  improveLevel(LEVEL, { ...opts, initial: LONG, planner });
  expect(planner).not.toHaveBeenCalled();
});

test('planner fallback: a failed plan leaves no starting point', () => {
  const r = improveLevel(LEVEL, {
    ...opts,
    find: () => ({ status: 'failed', reason: 'timeout', explored: 1 }),
    exact: timeout(2),
    // a planner that fails: the one of an unsolvable level
    planner: (_, o) => planSolution(fromAscii(['@#E']), o),
  });
  expect(r.start).toBe('none');
  expect(r.moves).toBeUndefined();
  expect(r.stages[1]).toMatchObject({ stage: 'plan', note: expect.stringMatching(/^no plan/) });
});

test('planner fallback, real limits: the search stops at its state limit, the planner does not', () => {
  // the planner's restricted searches are not bound by maxStates
  const level = fromAscii(['@B.B.B.~~E', 'B.B.B.B~~.', '.B.B.B.~~.', 'B.B.B.B...']);
  const r = improveLevel(level, { timeoutMs: 20_000, maxStates: 3 });
  expect(r.stages[0]).toMatchObject({ stage: 'find', note: expect.stringMatching(/limit/) });
  expect(r.start).toBe('planned');
  expect(replay(level, r.moves!).status).toBe('won');
});
