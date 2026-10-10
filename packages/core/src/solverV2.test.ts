import { expect, test } from 'vitest';
import { fromAscii } from './ascii';
import { replay } from './replay';
import { solveV2 as solve } from './solverV2';
import { mulberry32, randomLevel } from './testLevels';
import { solveNaive } from './solverNaive';
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

test('equivalence with the naive BFS on random levels', () => {
  const rnd = mulberry32(20261010);
  let valid = 0;
  let solved = 0;
  for (let n = 0; n < 1000; n++) {
    const level = randomLevel(rnd, n);
    if (validateLevel(level).length > 0) continue;
    valid++;
    const naive = solveNaive(level, { maxStates: 10_000_000, timeoutMs: 60_000 });
    const macro = solve(level, { timeoutMs: 60_000 });
    expect(naive.status).not.toBe('timeout');
    expect(macro.status, level.id).toBe(naive.status);
    if (naive.status === 'solved' && macro.status === 'solved') {
      solved++;
      expect(macro.moves.length, level.id).toBe(naive.moves.length);
      expect(replay(level, macro.moves).status, level.id).toBe('won');
    }
  }
  expect(valid).toBeGreaterThanOrEqual(150);
  expect(solved).toBeGreaterThan(200);
});

// blocks to push into water; optimum computed by the naive BFS (~200 macro-states)
const BOUNDED = ['@B.B.B.~~E', 'B.B.B.B~~.', '.B.B.B.~~.', 'B.B.B.B...'];

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
