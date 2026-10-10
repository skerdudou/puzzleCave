// On-card tests: only run if a compatible WebGPU adapter is present.
import { afterAll, describe, expect, test } from 'vitest';
import { fromAscii, replay, solve, type LevelData } from '@puzzlecave/core';
import { loadPack } from '@puzzlecave/tiled';
import { fileURLToPath } from 'node:url';
import { sampleLevels } from '../../core/src/testLevels';
import { closeGpu, openGpu } from './device';
import { gpuSolveOn, type GpuSolveOptions } from './gpuSolve';

const opened = process.env.PUZZLECAVE_GPU === 'none' ? undefined : await openGpu();
const gpu = opened?.ok ? opened.gpu : undefined;
afterAll(() => {
  if (gpu) closeGpu(gpu);
});
const run = (level: LevelData, opts: GpuSolveOptions = {}) =>
  gpuSolveOn(gpu!, level, { timeoutMs: 60_000, maxMemoryMb: 1024, ...opts });

/** compact engine optimum on the sample levels (computed once) */
const sample = sampleLevels();
const optimum = new Map<string, number | 'unsolvable'>();
for (const level of sample) {
  const r = solve(level, { timeoutMs: 60_000 });
  if (r.status === 'timeout') throw new Error(`${level.id}: solve did not finish`);
  optimum.set(level.id, r.status === 'solved' ? r.moves.length : 'unsolvable');
}
const solvedSample = sample.filter((l) => optimum.get(l.id) !== 'unsolvable');
const pack = loadPack(fileURLToPath(new URL('../../../levels', import.meta.url)));
const repo = (id: string) => pack.levels.find((l) => l.id === id)!;

describe.skipIf(!gpu)('GPU engine', () => {
  test('small levels: corridor, key and door, blocks and water, unsolvable', async () => {
    const corridor = await run(fromAscii(['@..E']));
    expect(corridor).toMatchObject({ status: 'solved', moves: ['right', 'right', 'right'] });
    const detour = await run(fromAscii(['k....@.DE', '#####.###', '#####k###']));
    expect(detour.status === 'solved' && detour.moves).toEqual([
      'down',
      'down',
      'up',
      'up',
      'right',
      'right',
      'right',
    ]);
    const blocks = fromAscii(['@kB~E', '#D###', '#.###']);
    const r = await run(blocks);
    expect(r.status).toBe('solved');
    if (r.status === 'solved') expect(replay(blocks, r.moves).status).toBe('won');
    expect((await run(fromAscii(['@#E']))).status).toBe('unsolvable');
    expect((await run(fromAscii(['@.DE']))).status).toBe('unsolvable');
  });

  test('equivalence with solve on the shared sample (≥ 300 levels)', async () => {
    expect(sample.length).toBeGreaterThanOrEqual(300);
    for (const level of sample) {
      const g = await run(level);
      const opt = optimum.get(level.id)!;
      expect(g.status, level.id).toBe(opt === 'unsolvable' ? 'unsolvable' : 'solved');
      if (g.status === 'solved') {
        expect(g.moves.length, level.id).toBe(opt);
        expect(replay(level, g.moves).status, level.id).toBe('won');
      }
    }
    expect(solvedSample.length).toBeGreaterThan(100);
  }, 600_000);

  test('variants: full expansion, Δ = 8 windows, host-driven slices', async () => {
    for (const level of solvedSample.slice(0, 120)) {
      const opt = optimum.get(level.id);
      for (const opts of [{ partial: false }, { delta: 8 }, { delta: 8, partial: false }]) {
        const g = await run(level, opts);
        expect(g.status === 'solved' && g.moves.length, `${level.id} ${JSON.stringify(opts)}`).toBe(
          opt,
        );
      }
    }
  }, 600_000);

  test('tiny candidate buffer: large frontiers expanded in host slices', async () => {
    const level = repo('pc-03');
    const full = await run(level);
    const sliced = await run(level, { maxCandidates: 256 });
    expect(sliced.status === 'solved' && sliced.moves.length).toBe(401); // pc-03's proven optimum
    // many more round trips with the card: the slices were indeed used
    expect(sliced.gpu.submits).toBeGreaterThan(full.gpu.submits * 5);
  }, 120_000);

  test('upperBound: nothing strictly shorter → unsolvable', async () => {
    for (const level of solvedSample.slice(0, 150)) {
      const opt = optimum.get(level.id) as number;
      expect((await run(level, { upperBound: opt })).status, level.id).toBe('unsolvable');
      const above = await run(level, { upperBound: opt + 1 });
      expect(above.status === 'solved' && above.moves.length, level.id).toBe(opt);
    }
  }, 600_000);

  test.each([
    ['pc-01', 17],
    ['pc-19', 88],
    ['pc-03', 401],
    ['pc-06', 176],
    ['pc-10', 325],
  ])(
    '%s: %i moves, like the compact engine',
    async (id, moves) => {
      const level = repo(id);
      const g = await run(level, { maxMemoryMb: 2048 });
      expect(g.status).toBe('solved');
      if (g.status !== 'solved') return;
      expect(g.moves.length).toBe(moves);
      expect(replay(level, g.moves).status).toBe('won');
    },
    120_000,
  );

  test('lower bound ≤ optimum when exceeded (states, memory, time)', async () => {
    const level = repo('pc-03');
    const states = await run(level, { maxStates: 100_000 });
    const memory = await run(level, { maxMemoryMb: 24, initialMemoryMb: 24 });
    const time = await run(level, { timeoutMs: 1 });
    for (const r of [states, memory, time]) {
      expect(r.status).toBe('timeout');
      if (r.status === 'timeout') expect(r.lowerBound).toBeLessThanOrEqual(401);
    }
    if (states.status === 'timeout') expect(states.lowerBound).toBeGreaterThan(60);
    expect(states.explored).toBeLessThanOrEqual(100_000);
    expect(memory.memoryBytes!).toBeLessThanOrEqual(24 * 1024 ** 2);
  }, 120_000);
});
