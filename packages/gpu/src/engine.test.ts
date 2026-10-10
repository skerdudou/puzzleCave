import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { existsSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, test } from 'vitest';
import { fromAscii, replay, solve, type LevelData } from '@puzzlecave/core';
import { sampleLevels } from '../../core/src/testLevels';
import { GpuLock, GpuWorker, gpuExactEngine, type GpuSolver } from './engine';
import type { GpuSolveResult } from './gpuSolve';

const stats = {
  stored: 0,
  expanded: 0,
  candidates: 0,
  attempts: 1,
  submits: 1,
  encodeMs: 0,
  waitMs: 0,
  vramBytes: 0,
  compileMs: 0,
  ms: 0,
};
/** fake GPU engine: fixed reply, calls counted */
function fake(answer: (level: LevelData) => GpuSolveResult | Error): GpuSolver & { calls: number } {
  return {
    calls: 0,
    solve(level) {
      this.calls++;
      const a = answer(level);
      if (a instanceof Error) throw a;
      return a;
    },
  };
}

const level = fromAscii(['@...', '.##.', '...E']);

describe('safe exact GPU engine (no card)', () => {
  test('GPU solution that does not win: discarded, message, compact engine for this level', () => {
    const lines: string[] = [];
    const gpu = fake(() => ({ status: 'solved', moves: ['up'], explored: 3, gpu: stats }));
    const engine = gpuExactEngine(gpu, { log: (l) => lines.push(l) });
    const r = engine(level, { timeoutMs: 10_000 });
    expect(r.status).toBe('solved');
    if (r.status === 'solved') expect(replay(level, r.moves).status).toBe('won');
    expect(r.status === 'solved' && r.moves.length).toBe(5);
    expect(lines.join('\n')).toMatch(/ascii: inconsistent GPU solution .*discarded.*CPU/);
    // the GPU stays in use for the following levels
    engine(level, { timeoutMs: 10_000 });
    expect(gpu.calls).toBe(2);
  });

  test('GPU solution that wins but is not shorter than upperBound: discarded', () => {
    const lines: string[] = [];
    const moves = ['right', 'right', 'right', 'down', 'down'] as const;
    const gpu = fake(() => ({ status: 'solved', moves: [...moves], explored: 3, gpu: stats }));
    const r = gpuExactEngine(gpu, { log: (l) => lines.push(l) })(level, { upperBound: 5 });
    expect(r.status).toBe('unsolvable');
    expect(lines).toHaveLength(1);
  });

  test('valid GPU solution: accepted as is', () => {
    const moves = ['down', 'down', 'right', 'right', 'right'] as const;
    const gpu = fake(() => ({ status: 'solved', moves: [...moves], explored: 7, gpu: stats }));
    const lines: string[] = [];
    const r = gpuExactEngine(gpu, { log: (l) => lines.push(l) })(level, {});
    expect(r).toMatchObject({ status: 'solved', moves, explored: 7 });
    expect(lines).toEqual([]);
  });

  test('GPU failure: message, compact engine, then no more GPU for this process', () => {
    const lines: string[] = [];
    const gpu = fake(() => new Error('device lost'));
    const engine = gpuExactEngine(gpu, { log: (l) => lines.push(l) });
    expect(engine(level, {}).status).toBe('solved');
    expect(engine(level, {}).status).toBe('solved');
    expect(gpu.calls).toBe(1);
    expect(lines).toHaveLength(1);
    expect(lines[0]).toMatch(/device lost.*CPU/);
  });

  test('level beyond the GPU limits: compact engine, with a message', () => {
    const lines: string[] = [];
    const gpu = fake(() => new Error('never called'));
    const wide = fromAscii(['@' + '.'.repeat(40) + 'E']);
    const r = gpuExactEngine(gpu, { log: (l) => lines.push(l) })(wide, {});
    expect(r.status === 'solved' && r.moves.length).toBe(41);
    expect(gpu.calls).toBe(0);
    expect(lines[0]).toMatch(/width 42 > 32.*CPU/);
  });

  test('VRAM: the search maxMemoryMb (RAM) is ignored, the engine cap is passed on', () => {
    let seen: number | undefined;
    const gpu: GpuSolver = {
      solve(_l, o) {
        seen = o.maxMemoryMb;
        return { status: 'unsolvable', explored: 1, gpu: stats };
      },
    };
    gpuExactEngine(gpu, { maxVramMb: 1234 })(level, { maxMemoryMb: 10 });
    expect(seen).toBe(1234);
  });
});

describe('machine lock: a single process on the card', () => {
  const dir = mkdtempSync(join(tmpdir(), 'pc-lock-'));
  const file = join(dir, 'gpu.lock');

  test('taken, refused while held, released', () => {
    const a = GpuLock.acquire(file, 0);
    expect(a.ok).toBe(true);
    const b = GpuLock.acquire(file, 0);
    expect(b.ok).toBe(false);
    if (!b.ok)
      expect(b.reason).toMatch(new RegExp(`GPU already in use \\(process ${process.pid}\\)`));
    if (a.ok) a.lock.release();
    const c = GpuLock.acquire(file, 0);
    expect(c.ok).toBe(true);
    if (c.ok) c.lock.release();
  });

  test('GPU thread: refused without waiting if the card is taken', () => {
    // the lock is checked before any adapter access: valid even without a GPU
    const simulated = process.env.PUZZLECAVE_GPU;
    delete process.env.PUZZLECAVE_GPU;
    const held = GpuLock.acquire(file, 0);
    try {
      expect(held.ok).toBe(true);
      const r = GpuWorker.open({ lockFile: file });
      expect(r).toMatchObject({ ok: false, busy: true });
    } finally {
      if (held.ok) held.lock.release();
      if (simulated !== undefined) process.env.PUZZLECAVE_GPU = simulated;
    }
  });

  test('stale lock (process gone): taken over', () => {
    writeFileSync(file, '999999999');
    const r = GpuLock.acquire(file, 0);
    expect(r.ok).toBe(true);
    if (r.ok) r.lock.release();
  });

  test('wait: acquired as soon as the other process releases it', async () => {
    const f = JSON.stringify(file);
    const child = spawn(process.execPath, [
      '-e',
      `const fs = require('fs'); fs.writeFileSync(${f}, String(process.pid)); setTimeout(() => fs.unlinkSync(${f}), 800);`,
    ]);
    while (!existsSync(file)) await new Promise((r) => setTimeout(r, 20));
    const t0 = performance.now();
    const r = GpuLock.acquire(file, 20_000);
    expect(r.ok).toBe(true);
    expect(performance.now() - t0).toBeGreaterThan(200);
    if (r.ok) r.lock.release();
    await once(child, 'exit');
  }, 30_000);
});

describe('GPU thread absent (simulated fallback)', () => {
  test('PUZZLECAVE_GPU=none: no adapter', () => {
    const before = process.env.PUZZLECAVE_GPU;
    process.env.PUZZLECAVE_GPU = 'none';
    try {
      const r = GpuWorker.open();
      expect(r.ok).toBe(false);
      if (!r.ok) expect(r.reason).toMatch(/no WebGPU adapter/);
    } finally {
      if (before === undefined) delete process.env.PUZZLECAVE_GPU;
      else process.env.PUZZLECAVE_GPU = before;
    }
  }, 60_000);
});

const opened =
  process.env.PUZZLECAVE_GPU === 'none' ? undefined : GpuWorker.open({ waitMs: 120_000 });
const worker = opened?.ok ? opened.worker : undefined;
afterAll(() => worker?.close());

describe.skipIf(!worker)('GPU thread (synchronous)', () => {
  test('same answers as solve, synchronous calls', () => {
    const engine = gpuExactEngine(worker!, { log: () => {} });
    for (const l of sampleLevels(400).slice(0, 60)) {
      const cpu = solve(l);
      const g = engine(l, { timeoutMs: 30_000 });
      expect(g.status, l.id).toBe(cpu.status);
      if (g.status === 'solved' && cpu.status === 'solved')
        expect(g.moves.length, l.id).toBe(cpu.moves.length);
    }
    expect(worker!.name).toMatch(/\S/);
  }, 120_000);
});
