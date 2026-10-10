import { expect, test, vi } from 'vitest';
import { fromAscii } from '../ascii';
import { replay } from '../replay';
import { solve } from '../solver';
import { solveNaive } from '../solverNaive';
import type { Dir } from '../types';
import { freezeBlocks, freezeStage, liftSolution, movedBlocks } from './freeze';
import { mulberry32, sampleLevels } from '../testLevels';

test('movedBlocks: origin cells of the pushed blocks, tracked from push to push', () => {
  // block (1,0) pushed twice to the right then sunk at (4,0); block (1,2) never pushed
  const level = fromAscii(['@B..~E', '......', '.B....']);
  const moves: Dir[] = ['right', 'right', 'right', 'right', 'right'];
  expect(replay(level, moves).status).toBe('won');
  expect([...movedBlocks(level, moves)]).toEqual([1]);
  expect(movedBlocks(level, ['down', 'down']).size).toBe(0);
});

test('freezeBlocks: blocks outside the set become walls', () => {
  const level = fromAscii(['@B.B.E']);
  const frozen = freezeBlocks(level, new Set([1]));
  expect(frozen.terrain[3]).toBe('wall');
  expect(frozen.terrain[1]).toBe('floor');
  expect(frozen.objects).toEqual([{ x: 1, y: 0, kind: 'block' }]);
});

test('property: any solution of a restriction replays on the original level', () => {
  const rnd = mulberry32(7);
  let restricted = 0;
  let sameOptimum = 0;
  for (const level of sampleLevels()) {
    const naive = solveNaive(level, { maxStates: 10_000_000, timeoutMs: 60_000 });
    if (naive.status !== 'solved') continue;
    const blocks = level.objects.flatMap((o) =>
      o.kind === 'block' ? [o.y * level.width + o.x] : [],
    );
    // restriction to the blocks moved by an optimal solution: same optimum
    const used = freezeBlocks(level, movedBlocks(level, naive.moves));
    const r = solve(used, { timeoutMs: 60_000 });
    expect(r.status, level.id).toBe('solved');
    if (r.status === 'solved') {
      expect(r.moves.length, level.id).toBe(naive.moves.length);
      expect(replay(level, r.moves).status, level.id).toBe('won');
      sameOptimum++;
    }
    // random subsets: solution never shorter than the optimum, always winning
    for (let t = 0; t < 4; t++) {
      const keep = new Set(blocks.filter(() => rnd() < 0.5));
      const sub = freezeBlocks(level, keep);
      const rs = solveNaive(sub, { maxStates: 10_000_000, timeoutMs: 60_000 });
      if (rs.status !== 'solved') continue;
      restricted++;
      expect(replay(level, rs.moves).status, level.id).toBe('won');
      expect(rs.moves.length).toBeGreaterThanOrEqual(naive.moves.length);
      const lifted = liftSolution(level, sub, rs.moves);
      expect(lifted?.length, level.id).toBe(rs.moves.length);
    }
  }
  expect(sameOptimum).toBeGreaterThan(200);
  expect(restricted).toBeGreaterThan(300);
});

test('liftSolution: a move without effect against a frozen block is removed before replaying', () => {
  // on the restricted level, "right" bumps into the wall (ex-block); on the original it would push it
  const level = fromAscii(['@B.', '...', '.E.']);
  const sub = freezeBlocks(level, new Set());
  const moves: Dir[] = ['right', 'down', 'down', 'right'];
  expect(replay(sub, moves).status).toBe('won');
  expect(liftSolution(level, sub, moves)).toEqual(['down', 'down', 'right']);
});

const BIG = ['@B.B.B.~~E', 'B.B.B.B~~.', '.B.B.B.~~.', 'B.B.B.B...'];

/** optimal solution of BIG lengthened by a back-and-forth that pushes no other block */
function bigLong() {
  const level = fromAscii(BIG);
  const naive = solveNaive(level, { maxStates: 10_000_000, timeoutMs: 60_000 });
  if (naive.status !== 'solved') throw new Error('BIG unsolvable');
  const used = [...movedBlocks(level, naive.moves)].sort().join();
  const pairs: [Dir, Dir][] = [
    ['left', 'right'],
    ['right', 'left'],
    ['up', 'down'],
    ['down', 'up'],
  ];
  for (let i = 0; i <= naive.moves.length; i++)
    for (const [d, back] of pairs) {
      const long: Dir[] = [...naive.moves.slice(0, i), d, back, ...naive.moves.slice(i)];
      const end = replay(level, long);
      if (
        end.status === 'won' &&
        end.moves === naive.moves.length + 2 &&
        [...movedBlocks(level, long)].sort().join() === used
      )
        return { level, optimum: naive.moves.length, long };
    }
  throw new Error('no back-and-forth possible');
}

test('freezeStage: optimum for the used blocks, never longer, always winning', () => {
  const { level, optimum, long } = bigLong();
  const exact = vi.fn(solve);
  const r = freezeStage(level, long, { timeoutMs: 30_000, maxStates: 1_000_000, exact });
  expect(exact).toHaveBeenCalled();
  expect(r.restrictedOptimal).toBe(true);
  expect(r.keptBlocks).toBeLessThan(r.totalBlocks);
  expect(r.moves).toHaveLength(optimum);
  expect(replay(level, r.moves).status).toBe('won');
});

test('freezeStage: exact engine that does not finish → greedy removal, guarantees kept', () => {
  // the solution pushes a useless block: the greedy pass can freeze it
  const level = fromAscii(['@.B.', '....', '...E']);
  const long: Dir[] = ['right', 'right', 'down', 'down', 'right'];
  expect(replay(level, long).status).toBe('won');
  expect(movedBlocks(level, long).size).toBe(1);
  const stuck = vi.fn(() => ({ status: 'timeout' as const, explored: 0, lowerBound: 0 }));
  const r = freezeStage(level, long, { timeoutMs: 30_000, maxStates: 100_000, exact: stuck });
  expect(r.restrictedOptimal).toBe(false);
  expect(r.greedyFrozen).toBeGreaterThan(0);
  expect(r.moves.length).toBeLessThanOrEqual(long.length);
  expect(replay(level, r.moves).status).toBe('won');
  expect(r.rejected).toBe(0);
});

test('freezeStage: a restricted solution that does not win does not count as a restricted optimum', () => {
  const { level, long } = bigLong();
  const bad = vi.fn(() => ({ status: 'solved' as const, moves: ['up'] as Dir[], explored: 1 }));
  const r = freezeStage(level, long, { timeoutMs: 5_000, maxStates: 1000, exact: bad });
  expect(r.rejected).toBeGreaterThan(0);
  expect(r.restrictedOptimal).toBe(false);
  expect(r.moves).toEqual(long);
});
