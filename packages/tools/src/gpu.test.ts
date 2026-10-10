import { afterEach, beforeEach, describe, expect, test } from 'vitest';
import { exactBackend, probeBackend } from './gpu';

describe('simulated fallback: no adapter', () => {
  let before: string | undefined;
  beforeEach(() => {
    before = process.env.PUZZLECAVE_GPU;
    process.env.PUZZLECAVE_GPU = 'none';
  });
  afterEach(() => {
    if (before === undefined) delete process.env.PUZZLECAVE_GPU;
    else process.env.PUZZLECAVE_GPU = before;
  });

  test('auto: compact engine, a single message per process', async () => {
    const lines: string[] = [];
    const log = (l: string) => lines.push(l);
    const a = await exactBackend('auto', { log });
    const b = await exactBackend('auto', { log });
    expect(a.engine).toBeUndefined();
    expect(b.engine).toBeUndefined();
    expect(a.label).toBe('CPU');
    expect(lines).toHaveLength(1);
    expect(lines[0]).toMatch(/GPU unavailable \(no WebGPU adapter.*\) — .*CPU/);
    expect((await probeBackend('auto', log)).gpu).toBe(false);
    expect(lines).toHaveLength(1);
  }, 60_000);

  test('on: clear error', async () => {
    await expect(exactBackend('on', { log: () => {} })).rejects.toThrow(
      /--gpu on: no WebGPU adapter/,
    );
    await expect(probeBackend('on', () => {})).rejects.toThrow(/--gpu on/);
  }, 60_000);
});

test('off: compact engine without loading the GPU', async () => {
  const lines: string[] = [];
  const r = await exactBackend('off', { log: (l) => lines.push(l) });
  expect(r.engine).toBeUndefined();
  expect(r.label).toBe('CPU');
  expect(lines).toEqual([]);
  expect(await probeBackend('off', () => {})).toEqual({ gpu: false, label: 'CPU' });
});
