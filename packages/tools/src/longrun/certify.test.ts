import { mkdtempSync, readFileSync, readdirSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { solve, type LevelData } from '@puzzlecave/core';
import { sampleLevels } from '../../../core/src/testLevels';
import { certify } from './certify';
import { LongRun } from './search';

const root = mkdtempSync(join(tmpdir(), 'pc-certify-'));
afterAll(() => rmSync(root, { recursive: true, force: true }));

/** sizes and modification times of every file under dir (read-only check) */
function snapshot(dir: string): string {
  const out: string[] = [];
  const walk = (d: string) => {
    for (const e of readdirSync(d, { withFileTypes: true })) {
      const p = join(d, e.name);
      if (e.isDirectory()) walk(p);
      else out.push(`${p}:${statSync(p).size}:${statSync(p).mtimeMs}`);
    }
  };
  walk(dir);
  return out.sort().join('\n');
}

describe('certify', () => {
  it.each(['keys', 'off'] as const)(
    'v5 checkpoint, dominance %s: certified bound ≥ the checkpoint bound, ≤ the optimum, checkpoint untouched',
    async (dominance) => {
      const levels: LevelData[] = sampleLevels(400).filter((l) => {
        const r = solve(l, { timeoutMs: 10_000 });
        return r.status === 'solved' && r.moves.length >= 8;
      });
      expect(levels.length).toBeGreaterThan(10);
      let raised = 0;
      let runs = 0;
      for (const level of levels.slice(0, 40)) {
        const opt = solve(level, { timeoutMs: 10_000 });
        if (opt.status !== 'solved') continue;
        const n = opt.moves.length;
        const workDir = join(root, `${dominance}-${runs++}`);
        const r = await new LongRun(level, {
          workDir,
          threads: 0,
          parts: 4,
          maxMemoryMb: 64,
          maxDiskGb: 1,
          upperBound: n + 5,
          maxLayers: 1 + (runs % Math.max(1, n - 4)),
          dominance,
        }).run();
        expect(JSON.parse(readFileSync(join(workDir, 'manifest.json'), 'utf8')).version).toBe(5);
        if (r.status !== 'stopped') continue;
        const before = snapshot(workDir);
        const c = await certify(level, { workDir, threads: 1 });
        expect(snapshot(workDir), level.id).toBe(before);
        expect(c.lowerBound, level.id).toBeGreaterThanOrEqual(r.lowerBound);
        expect(c.lowerBound, level.id).toBeLessThanOrEqual(n);
        if (c.lowerBound > r.lowerBound) raised++;
        // a target only caps the answer
        const t = await certify(level, { workDir, threads: 1, target: r.lowerBound + 1 });
        expect(t.lowerBound).toBe(Math.min(c.lowerBound, r.lowerBound + 1));
        // other medal thresholds: refused, then accepted on the start state (v5 root partition)
        const renamed = { ...level, thresholds: { goldMoves: 999 } };
        await expect(certify(renamed, { workDir, threads: 1 })).rejects.toThrow(/fingerprint/);
        const s = await certify(renamed, { workDir, threads: 1, skipFingerprint: true });
        expect(s.lowerBound).toBe(c.lowerBound);
      }
      expect(runs).toBeGreaterThan(10);
      expect(raised).toBeGreaterThan(0);
    },
    600_000,
  );
});
