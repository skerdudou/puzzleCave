import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { expect, test } from 'vitest';
import {
  baseOrder,
  fromAscii,
  parseMoves,
  replay,
  segmentSolution,
  structuralPass,
  type Dir,
  type LevelData,
} from '@puzzlecave/core';
import { loadPack } from '@puzzlecave/tiled';
import {
  ExplorePool,
  KEEP_FREE_MB,
  WORKER_BASE_MB,
  defaultTotalMemoryMb,
  defaultWorkers,
  planWorkers,
} from './explorePool';
import { LEVELS_DIR } from './paths';

const pack = loadPack(LEVELS_DIR);
const levelOf = (id: string): LevelData => pack.levels.find((l) => l.id === id)!;
const savedOf = (id: string): Dir[] =>
  parseMoves(readFileSync(join(LEVELS_DIR, 'solutions', `${id}.txt`), 'utf8'));

test('worker count and memory plan', () => {
  expect(defaultWorkers(16)).toBe(14);
  expect(defaultWorkers(2)).toBe(1);
  expect(defaultWorkers(64)).toBe(16);
  expect(defaultTotalMemoryMb(32 * 1024 ** 3)).toBe(32 * 1024 - KEEP_FREE_MB);
  expect(defaultTotalMemoryMb(1024 ** 3)).toBe(1024);
  const per = 1024 + WORKER_BASE_MB;
  // the main thread keeps 256 + 512 MB, each worker 1,024 + 512
  expect(planWorkers(14, 28_000, 1024, 256)).toEqual({
    workers: 14,
    largeMemoryMb: 1024,
    perWorkerMb: per,
  });
  expect(planWorkers(14, 10_000, 1024, 256).workers).toBe(Math.floor((10_000 - 768) / per));
  // not even one worker: one, with smaller large searches
  expect(planWorkers(4, 2_000, 4096, 256)).toEqual({
    workers: 1,
    largeMemoryMb: 2000 - 768 - WORKER_BASE_MB,
    perWorkerMb: 2000 - 768,
  });
});

/** the saved solution with a detour (a step and back) after each of the first stages */
function detoured(level: LevelData, moves: Dir[]): Dir[] {
  const out: Dir[] = [];
  const back: Record<Dir, Dir> = { up: 'down', down: 'up', left: 'right', right: 'left' };
  for (let i = 0; i < moves.length; i++) {
    out.push(moves[i]!);
    if (i % 40 === 20)
      for (const d of ['up', 'down', 'left', 'right'] as Dir[]) {
        const t = [...out, d, back[d], ...moves.slice(i + 1)];
        if (replay(level, t).status === 'won') {
          out.push(d, back[d]);
          break;
        }
      }
  }
  return out;
}

test('the pass gives the same result on 1 and on 4 threads, and the pool stops', async () => {
  for (const [level, sol, extra] of [
    // a merged window that frees a neighbour block (from the core tests): one gain
    [
      fromAscii(['@...#..', '...B#..', '....~.E', '....#..', '...B#..', '....#..']),
      parseMoves('DDDDDRRRUULURRRR'),
      { window: 2, neighbours: 1 },
    ],
    // a real level with detours: several gains, many candidates
    [levelOf('pc-03'), detoured(levelOf('pc-03'), savedOf('pc-03')), { widen: 1 }],
  ] as const) {
    const opts = { timeoutMs: 120_000, mergeTimeoutMs: 600_000, stageTimeoutMs: 600_000 };
    const triedSeq = new Set<string>();
    const seq = await structuralPass(level, sol, { ...opts, ...extra, tried: triedSeq });
    const pool = new ExplorePool(level, opts, 4);
    const triedPar = new Set<string>();
    try {
      const par = await structuralPass(level, sol, {
        ...opts,
        ...extra,
        tried: triedPar,
        runner: pool,
      });
      expect(seq.gains.length).toBeGreaterThan(0);
      expect(par.moves).toEqual(seq.moves);
      expect(par.gains).toEqual(seq.gains);
      expect(par.tried).toBe(seq.tried);
      expect(par.exhausted).toBe(seq.exhausted);
      expect([...triedPar].sort()).toEqual([...triedSeq].sort());
      expect(par.searches).toBeGreaterThan(0);
    } finally {
      await pool.close();
    }
    expect(pool.alive()).toBe(0);
  }
}, 300_000);

test('a run is cancelled within moments and the worker goes on with the next one', async () => {
  // pc-18's plan rebuilt with stage retries takes minutes
  const level = levelOf('pc-18');
  const sol = savedOf('pc-18');
  const pool = new ExplorePool(level, { maxStates: 3_200_000, stageTimeoutMs: 600_000 }, 1);
  try {
    pool.reset(sol);
    const order = baseOrder(segmentSolution(level, sol));
    const run = pool.run(order, Infinity);
    // queued behind it, then cancelled before it starts
    const queued = pool.run(order, Infinity);
    queued.cancel();
    expect(await queued.result).toEqual({ failed: 'cancelled' });
    await new Promise((r) => setTimeout(r, 1500));
    const t0 = performance.now();
    run.cancel();
    expect(await run.result).toEqual({ failed: 'cancelled' });
    expect(performance.now() - t0).toBeLessThan(3000);
    // the same worker rebuilds a short prefix-free plan after a cancellation: nothing was memoised
    const first = pool.run(order.slice(0, 1), Infinity);
    const out = await first.result;
    expect(out).toHaveProperty('failed'); // the exit is missing: does not win
    expect((out as { failed: string }).failed).not.toBe('cancelled');
  } finally {
    await pool.close();
  }
  expect(pool.alive()).toBe(0);
}, 60_000);
