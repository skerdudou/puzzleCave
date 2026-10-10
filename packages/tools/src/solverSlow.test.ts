// Slow tests (several minutes): `npm run test:slow`. Compact engine against the v2 engine on the
// repository levels that are already solved.
import { describe, expect, test } from 'vitest';
import { replay, solve, solveV2 } from '@puzzlecave/core';
import { loadPack } from '@puzzlecave/tiled';
import { LEVELS_DIR } from './paths';

describe.skipIf(!process.env.SLOW)('compact engine against v2 (repository levels)', () => {
  const pack = loadPack(LEVELS_DIR);
  const level = (id: string) => pack.levels.find((l) => l.id === id)!;

  test.each(['pc-01', 'pc-02', 'pc-03', 'pc-06', 'pc-10'])(
    '%s: same optimal length as v2',
    (id) => {
      const l = level(id);
      const fast = solve(l, { timeoutMs: 600_000, maxMemoryMb: 2048 });
      const v2 = solveV2(l, { timeoutMs: 600_000, maxStates: 6_000_000 });
      expect(fast.status).toBe('solved');
      expect(v2.status).toBe('solved');
      if (fast.status !== 'solved' || v2.status !== 'solved') return;
      expect(fast.moves.length).toBe(v2.moves.length);
      expect(replay(l, fast.moves).status).toBe('won');
      expect(fast.moves.length).toBe(l.thresholds.goldMoves);
    },
    600_000,
  );

  test('pc-04: at equal state budget, lower bound ≥ v2’s (or solution ≤ 902 moves)', () => {
    const l = level('pc-04');
    const budget = { timeoutMs: 600_000, maxStates: 2_000_000 };
    const fast = solve(l, { ...budget, maxMemoryMb: 2048 });
    const v2 = solveV2(l, budget);
    expect(v2.status).toBe('timeout');
    if (fast.status === 'solved') {
      expect(fast.moves.length).toBeLessThanOrEqual(902);
      expect(replay(l, fast.moves).status).toBe('won');
      return;
    }
    expect(fast.status).toBe('timeout');
    if (fast.status === 'timeout' && v2.status === 'timeout')
      expect(fast.lowerBound).toBeGreaterThanOrEqual(v2.lowerBound);
  }, 600_000);
});
