import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { replay, solve, type LevelData } from '@puzzlecave/core';
import { closeGpu, openGpu } from '@puzzlecave/gpu';
import { sampleLevels } from '../../../core/src/testLevels';
import { compress, decompress } from './layout';
import { LongRun, type LongRunOptions } from './search';

const root = mkdtempSync(join(tmpdir(), 'pc-longrun-'));
let runs = 0;
afterAll(() => rmSync(root, { recursive: true, force: true }));

function opts(extra: Partial<LongRunOptions> = {}): LongRunOptions {
  return {
    workDir: join(root, `r${runs++}`),
    threads: 0,
    parts: 4,
    maxMemoryMb: 64,
    maxDiskGb: 1,
    cacheEntries: 4096,
    ...extra,
  };
}

const levels = sampleLevels(400);

describe('long run block packing', () => {
  it('compress/decompress round trip (packed, raw, empty)', () => {
    let seed = 7;
    const rnd = () => (seed = (Math.imul(seed, 1103515245) + 12345) >>> 0);
    const R = 13;
    for (const count of [0, 1, 5, 300]) {
      const recs = new Uint32Array(count * R);
      for (let i = 0; i < recs.length; i++)
        // shared high bits, a few random low ones (like the keys of one partition)
        recs[i] = (i % R) * 0x01010101 + (rnd() % 7 === 0 ? rnd() & 0xff : 0);
      const bytes = new Uint8Array(recs.buffer);
      const stored = compress(bytes, R).slice();
      if (count >= 5) expect(stored.length).toBeLessThan(bytes.length);
      expect([...decompress(stored, bytes.length, R)]).toEqual([...recs]);
    }
    const noise = new Uint32Array(64 * R).map(() => rnd());
    const stored = compress(new Uint8Array(noise.buffer), R).slice();
    expect(stored.length).toBe(noise.length * 4);
    expect([...decompress(stored, noise.length * 4, R)]).toEqual([...noise]);
  });
});

describe('long run (external search)', () => {
  it('same status and optimal length as solve on the sample, solutions replay', async () => {
    let solved = 0;
    for (const level of levels.slice(0, 120)) {
      const ref = solve(level, { timeoutMs: 20_000 });
      const r = await new LongRun(level, opts()).run();
      if (ref.status === 'solved') {
        solved++;
        expect(r.status, level.id).toBe('solved');
        if (r.status !== 'solved') continue;
        expect(r.moves.length, level.id).toBe(ref.moves.length);
        expect(replay(level, r.moves).status, level.id).toBe('won');
      } else {
        expect(ref.status, level.id).toBe('unsolvable');
        expect(r.status, level.id).toBe('exhausted');
      }
    }
    expect(solved).toBeGreaterThan(30);
  }, 60_000);

  it('dominance (player, keys) prunes states and keeps the optimal lengths', async () => {
    const pruned = { player: 0, keys: 0 };
    let checked = 0;
    for (const level of levels.slice(0, 160)) {
      const ref = solve(level, { timeoutMs: 20_000 });
      const off = await new LongRun(level, opts({ dominance: 'off' })).run();
      expect(off.stats.dominated).toBe(0);
      for (const mode of ['player', 'keys'] as const) {
        const r = await new LongRun(level, opts({ dominance: mode })).run();
        pruned[mode] += r.stats.dominated;
        expect(r.stats.expanded, level.id).toBeLessThanOrEqual(off.stats.expanded);
        if (ref.status === 'solved') {
          expect(r.status, level.id).toBe('solved');
          if (r.status !== 'solved') continue;
          expect(r.moves.length, level.id).toBe(ref.moves.length);
          expect(replay(level, r.moves).status, level.id).toBe('won');
          // proof at the optimum: nothing shorter
          const at = await new LongRun(
            level,
            opts({ dominance: mode, upperBound: ref.moves.length }),
          ).run();
          expect(at.status, level.id).toBe('exhausted');
          checked++;
        } else expect(r.status, level.id).toBe('exhausted');
      }
    }
    expect(checked).toBeGreaterThan(20);
    expect(pruned.player).toBeGreaterThan(0);
    expect(pruned.keys).toBeGreaterThan(pruned.player);
  }, 120_000);

  it('upper bound: = optimum → exhausted, optimum + 1 → same length', async () => {
    let checked = 0;
    for (const level of levels.slice(120, 220)) {
      const ref = solve(level, { timeoutMs: 20_000 });
      if (ref.status !== 'solved') continue;
      const n = ref.moves.length;
      const at = await new LongRun(level, opts({ upperBound: n })).run();
      expect(at.status, level.id).toBe('exhausted');
      const above = await new LongRun(level, opts({ upperBound: n + 1 })).run();
      expect(above.status, level.id).toBe('solved');
      if (above.status === 'solved') expect(above.moves.length).toBe(n);
      checked++;
    }
    expect(checked).toBeGreaterThan(20);
  }, 60_000);

  /** a sample level with the longest optimum (several layers) */
  const deepest = (): { level: LevelData; n: number } => {
    let best = { level: levels[0]!, n: -1 };
    for (const level of levels.slice(0, 120)) {
      const r = solve(level, { timeoutMs: 20_000 });
      if (r.status === 'solved' && r.moves.length > best.n) best = { level, n: r.moves.length };
    }
    return best;
  };

  it('resumes after an interruption with the same result', async () => {
    const { level, n } = deepest();
    const o = opts();
    const first = await new LongRun(level, { ...o, maxLayers: 3 }).run();
    expect(first.status).toBe('stopped');
    if (first.status === 'stopped') expect(first.lowerBound).toBeLessThanOrEqual(n);
    const second = await new LongRun(level, { ...o, resume: true, maxLayers: 2 }).run();
    expect(second.status).toBe('stopped');
    const end = await new LongRun(level, { ...o, resume: true }).run();
    expect(end.status).toBe('solved');
    if (end.status === 'solved') {
      expect(end.moves.length).toBe(n);
      expect(replay(level, end.moves).status).toBe('won');
    }
    expect(end.stats.layers).toBeGreaterThan(5);
  });

  it('stops at the disk limit with a valid lower bound', async () => {
    const { level, n } = deepest();
    const o = opts({ maxDiskGb: 2000 / 1024 ** 3 });
    const r = await new LongRun(level, o).run();
    expect(r.status).toBe('stopped');
    if (r.status === 'stopped') {
      expect(r.reason).toBe('disk');
      expect(r.lowerBound).toBeLessThanOrEqual(n);
    }
    // the interrupted layer is dropped: resuming with more disk gives the optimum
    const end = await new LongRun(level, { ...o, maxDiskGb: 1, resume: true }).run();
    expect(end.status).toBe('solved');
    if (end.status === 'solved') expect(end.moves.length).toBe(n);
  });

  it('lowers the upper bound from a source between layers', async () => {
    const { level, n } = deepest();
    let calls = 0;
    const r = await new LongRun(
      level,
      opts({ boundSource: () => (++calls > 2 ? n : undefined) }),
    ).run();
    expect(r.status).toBe('exhausted');
    expect(r.upperBound).toBe(n);
  });

  it('worker threads give the same result', async () => {
    const { level, n } = deepest();
    const r = await new LongRun(level, opts({ threads: 2, parts: 8 })).run();
    expect(r.status).toBe('solved');
    if (r.status === 'solved') {
      expect(r.moves.length).toBe(n);
      expect(replay(level, r.moves).status).toBe('won');
    }
  }, 30_000);

  it('one process per work dir: a live owner refuses, a dead one is taken over', async () => {
    const { level } = deepest();
    const o = opts();
    mkdirSync(o.workDir, { recursive: true });
    writeFileSync(join(o.workDir, 'lock'), String(process.ppid)); // alive: the test runner's parent
    await expect(new LongRun(level, o).run()).rejects.toThrow(/used by the running process/);
    writeFileSync(join(o.workDir, 'lock'), '2147483646'); // no such process
    expect((await new LongRun(level, o).run()).status).toBe('solved');
    expect(existsSync(join(o.workDir, 'lock'))).toBe(false);
  }, 30_000);
});

// GPU batch expansion: only with a compatible adapter
const adapter = process.env.PUZZLECAVE_GPU === 'none' ? undefined : await openGpu();
if (adapter?.ok) closeGpu(adapter.gpu);

describe.skipIf(!adapter?.ok)('long run with GPU expansion', () => {
  it('same results as solve on the sample (threads 0 and 2)', async () => {
    const lockFile = join(root, 'gpu.lock');
    let solved = 0;
    for (const [i, level] of levels.slice(0, 12).entries()) {
      const ref = solve(level, { timeoutMs: 20_000 });
      const lines: string[] = [];
      const r = await new LongRun(
        level,
        opts({
          gpu: 'on',
          gpuLockFile: lockFile,
          threads: i < 2 ? 2 : 0,
          log: (l) => lines.push(l),
        }),
      ).run();
      expect(lines.some((l) => l.includes('batch expansion'))).toBe(true);
      if (ref.status === 'solved') {
        solved++;
        expect(r.status, level.id).toBe('solved');
        if (r.status === 'solved') {
          expect(r.moves.length, level.id).toBe(ref.moves.length);
          expect(replay(level, r.moves).status, level.id).toBe('won');
        }
      } else expect(r.status, level.id).toBe('exhausted');
    }
    expect(solved).toBeGreaterThan(2);
  }, 180_000);
});
