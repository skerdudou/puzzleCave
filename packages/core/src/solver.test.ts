import { expect, test } from 'vitest';
import { fromAscii } from './ascii';
import { replay } from './replay';
import { solve } from './solver';
import { solveNaive } from './solverNaive';
import { mulberry32, randomLevel, sampleLevels, validRandomLevel } from './testLevels';
import { validateLevel } from './validate';

test('solves a corridor', () => {
  expect(solve(fromAscii(['@..E']))).toMatchObject({
    status: 'solved',
    moves: ['right', 'right', 'right'],
  });
});

test('finds the shortest solution', () => {
  const level = fromAscii(['@...', '.##.', '...E']);
  const r = solve(level);
  expect(r.status).toBe('solved');
  if (r.status === 'solved') {
    expect(r.moves).toHaveLength(5);
    expect(replay(level, r.moves).status).toBe('won');
  }
});

test('uses keys, doors and blocks', () => {
  // key at (1,0), door at (1,1); the block at (2,0) must fill the water (3,0) to reach E
  const level = fromAscii(['@kB~E', '#D###', '#.###']);
  const r = solve(level);
  expect(r.status).toBe('solved');
  if (r.status === 'solved') expect(replay(level, r.moves).status).toBe('won');
});

test('takes the shortest detour to get a key before the door', () => {
  // near key at (5,2): down, down, up, up, then right ×3 (door at (7,0), exit at (8,0)) = 7;
  // the far key at (0,0) would cost 5 + 5 + 3 = 13
  const level = fromAscii(['k....@.DE', '#####.###', '#####k###']);
  const r = solve(level);
  expect(r.status).toBe('solved');
  if (r.status === 'solved') {
    expect(r.moves).toEqual(['down', 'down', 'up', 'up', 'right', 'right', 'right']);
    expect(replay(level, r.moves).status).toBe('won');
  }
});

test('detects an unsolvable level', () => {
  expect(solve(fromAscii(['@#E'])).status).toBe('unsolvable');
  // exit reachable on the relaxed map, but no key for the door
  expect(solve(fromAscii(['@.DE'])).status).toBe('unsolvable');
});

test('stops on the state limit', () => {
  // each key picked up gives a new macro-state
  expect(solve(fromAscii(['@kkkkkkkkE']), { maxStates: 5 }).status).toBe('timeout');
});

test('stops on the time limit', () => {
  let t = 0;
  expect(
    solve(fromAscii(['@' + '.'.repeat(30) + 'E']), { timeoutMs: 10, now: () => (t += 100) }).status,
  ).toBe('timeout');
});

// blocks to push into water; optimum computed by the naive BFS
const BOUNDED = ['@B.B.B.~~E', 'B.B.B.B~~.', '.B.B.B.~~.', 'B.B.B.B...'];

test('stops cleanly on the memory limit, with a lower bound', () => {
  const level = fromAscii(BOUNDED);
  const full = solve(level);
  expect(full.status).toBe('solved');
  expect(full.memoryBytes).toBeGreaterThan(0);
  // half the memory needed: the search stops before the end, without exceeding it
  const limitMb = full.memoryBytes! / 2 / 2 ** 20;
  const r = solve(level, { maxMemoryMb: limitMb });
  expect(r.status).toBe('timeout');
  expect(r.memoryBytes!).toBeLessThanOrEqual(limitMb * 2 ** 20);
  if (r.status === 'timeout' && full.status === 'solved') {
    expect(r.explored).toBeLessThan(full.explored);
    expect(r.lowerBound).toBeLessThanOrEqual(full.moves.length);
  }
});

test.each([false, true, 'auto'] as const)(
  'equivalence with the naive BFS on 1000 valid random levels (partial expansion: %s)',
  (partialExpansion) => {
    const rnd = mulberry32(20261011);
    let solved = 0;
    let unsolvable = 0;
    let onWater = 0;
    let negative = 0;
    let withDoors = 0;
    for (let n = 0; n < 1000; n++) {
      const level = validRandomLevel(rnd, n);
      expect(validateLevel(level), level.id).toEqual([]);
      const naive = solveNaive(level, { maxStates: 10_000_000, timeoutMs: 60_000 });
      // 'auto': a small state limit forces the switch to partial expansion
      const fast = solve(level, {
        timeoutMs: 60_000,
        partialExpansion,
        ...(partialExpansion === 'auto' ? { maxStates: 30 } : {}),
      });
      if (partialExpansion === 'auto' && fast.status === 'timeout') {
        if (naive.status === 'solved')
          expect(fast.lowerBound, level.id).toBeLessThanOrEqual(naive.moves.length);
        continue;
      }
      expect(naive.status).not.toBe('timeout');
      expect(fast.status, level.id).toBe(naive.status);
      if (naive.status === 'solved' && fast.status === 'solved') {
        solved++;
        expect(fast.moves.length, level.id).toBe(naive.moves.length);
        expect(replay(level, fast.moves).status, level.id).toBe('won');
        if (level.terrain[level.start.y * level.width + level.start.x] === 'water') onWater++;
        if (level.initialKeys < 0) negative++;
        if (level.objects.some((o) => o.kind === 'door')) withDoors++;
      } else unsolvable++;
    }
    expect(solved).toBeGreaterThan(partialExpansion === 'auto' ? 150 : 300);
    expect(unsolvable).toBeGreaterThan(50);
    expect(onWater).toBeGreaterThan(10);
    expect(negative).toBeGreaterThan(50);
    expect(withDoors).toBeGreaterThan(50);
  },
);

test('partial expansion: at equal state limit, bound at least as good and ≤ optimum', () => {
  const level = fromAscii(BOUNDED);
  const naive = solveNaive(level);
  expect(naive.status).toBe('solved');
  if (naive.status !== 'solved') return;
  let deeper = 0;
  for (const maxStates of [20, 40, 80, 160]) {
    const plain = solve(level, { maxStates });
    const pea = solve(level, { maxStates, partialExpansion: true });
    const auto = solve(level, { maxStates, partialExpansion: 'auto' });
    expect(plain.status).toBe('timeout');
    for (const r of [pea, auto]) {
      if (r.status === 'solved') expect(r.moves.length).toBe(naive.moves.length);
      if (r.status === 'timeout') expect(r.lowerBound).toBeLessThanOrEqual(naive.moves.length);
    }
    if (plain.status !== 'timeout' || auto.status !== 'timeout') continue;
    expect(auto.lowerBound).toBeGreaterThanOrEqual(plain.lowerBound);
    if (pea.status === 'timeout' && pea.lowerBound > plain.lowerBound) deeper++;
  }
  expect(deeper).toBeGreaterThan(0);
});

test('property: partial expansion bound ≤ optimum (random levels)', () => {
  const rnd = mulberry32(5);
  let checked = 0;
  for (let n = 0; n < 2000; n++) {
    const level = validRandomLevel(rnd, n);
    const naive = solveNaive(level);
    if (naive.status !== 'solved') continue;
    for (let maxStates = 1; maxStates < 200; maxStates++) {
      const r = solve(level, { maxStates, partialExpansion: true });
      if (r.status === 'solved') {
        expect(r.moves.length, level.id).toBe(naive.moves.length);
        break;
      }
      checked++;
      expect(r.status === 'timeout' && r.lowerBound, level.id).toBeLessThanOrEqual(
        naive.moves.length,
      );
    }
  }
  expect(checked).toBeGreaterThan(300);
});

test('equivalence with the naive BFS on the stage 1 random levels', () => {
  const rnd = mulberry32(20261010);
  let solved = 0;
  for (let n = 0; n < 1000; n++) {
    const level = randomLevel(rnd, n);
    if (validateLevel(level).length > 0) continue;
    const naive = solveNaive(level, { maxStates: 10_000_000, timeoutMs: 60_000 });
    const fast = solve(level, { timeoutMs: 60_000 });
    expect(fast.status, level.id).toBe(naive.status);
    if (naive.status === 'solved' && fast.status === 'solved') {
      solved++;
      expect(fast.moves.length, level.id).toBe(naive.moves.length);
      expect(replay(level, fast.moves).status, level.id).toBe('won');
    }
  }
  expect(solved).toBeGreaterThan(200);
});

test('on timeout, the lower bound does not exceed the optimum', () => {
  const level = fromAscii(BOUNDED);
  const naive = solveNaive(level, { maxStates: 10_000_000, timeoutMs: 60_000 });
  expect(naive.status).toBe('solved');
  if (naive.status !== 'solved') return;
  const r = solve(level, { maxStates: 20 });
  expect(r.status).toBe('timeout');
  if (r.status === 'timeout') {
    expect(r.lowerBound).toBeGreaterThan(0);
    expect(r.lowerBound).toBeLessThanOrEqual(naive.moves.length);
  }
});

test('the lower bound grows with the state limit', () => {
  const level = fromAscii(BOUNDED);
  let previous = 0;
  let timeouts = 0;
  for (let maxStates = 1; maxStates < 5000; maxStates = Math.ceil(maxStates * 1.3)) {
    const r = solve(level, { maxStates });
    if (r.status !== 'timeout') break;
    timeouts++;
    expect(r.lowerBound, `maxStates=${maxStates}`).toBeGreaterThanOrEqual(previous);
    previous = r.lowerBound;
  }
  expect(timeouts).toBeGreaterThan(5);
});

test('property: the bound on timeout never exceeds the optimum (random levels)', () => {
  const rnd = mulberry32(20261010);
  let checked = 0;
  let tight = 0;
  for (let n = 0; n < 1000; n++) {
    const level = randomLevel(rnd, n);
    if (validateLevel(level).length > 0) continue;
    const naive = solveNaive(level, { maxStates: 10_000_000, timeoutMs: 60_000 });
    if (naive.status !== 'solved') continue;
    const optimum = naive.moves.length;
    const full = solve(level, { timeoutMs: 60_000 });
    let previous = 0;
    for (let maxStates = 1; maxStates < full.explored; maxStates++) {
      const r = solve(level, { maxStates, timeoutMs: 60_000 });
      if (r.status !== 'timeout') continue;
      checked++;
      expect(r.lowerBound, `${level.id} maxStates=${maxStates}`).toBeLessThanOrEqual(optimum);
      expect(r.lowerBound, `${level.id} maxStates=${maxStates}`).toBeGreaterThanOrEqual(previous);
      previous = r.lowerBound;
      if (r.lowerBound === optimum) tight++;
    }
  }
  expect(checked).toBeGreaterThan(300);
  expect(tight).toBeGreaterThan(0);
});

test.each([false, true, 'auto'] as const)(
  'upperBound on the sample (partial expansion: %s): = optimum → unsolvable, optimum + 1 → optimum, bound ≤ optimum',
  (partialExpansion) => {
    let checked = 0;
    let bounded = 0;
    for (const level of sampleLevels()) {
      const naive = solveNaive(level, { maxStates: 10_000_000, timeoutMs: 60_000 });
      if (naive.status === 'unsolvable')
        expect(solve(level, { upperBound: 50, partialExpansion }).status, level.id).toBe(
          'unsolvable',
        );
      if (naive.status !== 'solved') continue;
      const opt = naive.moves.length;
      checked++;
      expect(solve(level, { upperBound: opt, partialExpansion }).status, level.id).toBe(
        'unsolvable',
      );
      const r = solve(level, { upperBound: opt + 1, partialExpansion });
      expect(r.status, level.id).toBe('solved');
      if (r.status === 'solved') {
        expect(r.moves.length, level.id).toBe(opt);
        expect(replay(level, r.moves).status, level.id).toBe('won');
      }
      // stop on the state limit under an upper bound: the lower bound stays ≤ optimum
      for (const maxStates of [1, 3, 10, 30])
        for (const upperBound of [opt, opt + 1, opt + 10]) {
          const t = solve(level, { maxStates, upperBound, partialExpansion });
          if (t.status === 'timeout') {
            bounded++;
            expect(t.lowerBound, level.id).toBeLessThanOrEqual(opt);
          } else if (t.status === 'solved') expect(t.moves.length, level.id).toBe(opt);
          else expect(upperBound, level.id).toBe(opt);
        }
    }
    expect(checked).toBeGreaterThan(150);
    expect(bounded).toBeGreaterThan(200);
  },
);
