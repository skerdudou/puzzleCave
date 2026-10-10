import { expect, test } from 'vitest';
import { fromAscii } from '../ascii';
import { replay } from '../replay';
import { solveNaive } from '../solverNaive';
import { findSolution } from './findSolution';
import { sampleLevels } from '../testLevels';

const LEVELS = {
  corridor: ['@..E'],
  keyDoorBlock: ['@kB~E', '#D###', '#.###'],
  detour: ['k....@.DE', '#####.###', '#####k###'],
  water: ['@B.B.B.~~E', 'B.B.B.B~~.', '.B.B.B.~~.', 'B.B.B.B...'],
};

test.each(Object.entries(LEVELS))('findSolution finds a solution that replays: %s', (_, rows) => {
  const level = fromAscii(rows);
  const r = findSolution(level, { maxStates: 100_000, timeoutMs: 10_000 });
  expect(r.status).toBe('solved');
  if (r.status === 'solved') expect(replay(level, r.moves).status).toBe('won');
});

test('findSolution: the novelty tables are taken from the memory budget', () => {
  // 40 × 40 cells: ~1.3 MB per atom-pair table; one block to push
  const rows = Array.from({ length: 40 }, () => '.'.repeat(40).split(''));
  rows[0]![0] = '@';
  rows[20]![20] = 'B';
  rows[39]![39] = 'E';
  const level = fromAscii(rows.map((r) => r.join('')));
  expect(findSolution(level, { maxStates: 1e6, timeoutMs: 10_000, maxMemoryMb: 1 })).toMatchObject({
    status: 'failed',
    reason: 'limit',
  });
  expect(findSolution(level, { maxStates: 1e6, timeoutMs: 10_000, maxMemoryMb: 64 }).status).toBe(
    'solved',
  );
});

test('findSolution fails cleanly on an unsolvable level or at the limit', () => {
  expect(findSolution(fromAscii(['@#E']), { maxStates: 1000, timeoutMs: 1000 })).toMatchObject({
    status: 'failed',
    reason: 'exhausted',
  });
  expect(findSolution(fromAscii(['@kkkkkkkkE']), { maxStates: 3, timeoutMs: 1000 })).toMatchObject({
    status: 'failed',
    reason: 'limit',
  });
  let t = 0;
  expect(
    findSolution(fromAscii(LEVELS.water), {
      maxStates: 1000,
      timeoutMs: 10,
      now: () => (t += 100),
    }),
  ).toMatchObject({ status: 'failed', reason: 'timeout' });
});

test('property: on the random sample, solves exactly the solvable levels', () => {
  let solved = 0;
  for (const level of sampleLevels()) {
    const naive = solveNaive(level, { maxStates: 10_000_000, timeoutMs: 60_000 });
    const r = findSolution(level, { maxStates: 1_000_000, timeoutMs: 60_000 });
    if (naive.status === 'solved') {
      expect(r.status, level.id).toBe('solved');
      if (r.status !== 'solved') continue;
      solved++;
      expect(replay(level, r.moves).status, level.id).toBe('won');
      expect(r.moves.length).toBeGreaterThanOrEqual(naive.moves.length);
    } else expect(r.status, level.id).toBe('failed');
  }
  expect(solved).toBeGreaterThan(200);
});
