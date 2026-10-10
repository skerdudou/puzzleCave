// --gpu in the commands: injected engine, GPU lane of the parallel runner, fallback.
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { fromAscii, solve, type LevelData } from '@puzzlecave/core';
import { gpuUnsupported, probeGpu } from '@puzzlecave/gpu';
import { TILE_ORDER, writeTmx } from '@puzzlecave/tiled';
import { solveCommand } from './commands';
import { fitsGpu } from './gpu';
import { improveCommand, improveParallel } from './improve';
import { gpuOrder, solveParallel } from './parallel';

const TSX = `<tileset name="pc" tilewidth="16" tileheight="16">${TILE_ORDER.map((k, i) => `<tile id="${i}"><properties><property name="kind" value="${k}"/></properties></tile>`).join('')}</tileset>`;

const LEVELS = [
  fromAscii(['@..E'], { id: 'a' }),
  fromAscii(['@#E'], { id: 'z' }),
  fromAscii(['@kB~E', '.D###', '.k...'], { id: 'k' }),
];

function fixture(levels: LevelData[] = LEVELS): string {
  const dir = mkdtempSync(join(tmpdir(), 'pc-gpu-'));
  writeFileSync(join(dir, 'tileset.tsx'), TSX);
  for (const l of levels) writeFileSync(join(dir, `${l.id}.tmx`), writeTmx(l));
  writeFileSync(
    join(dir, 'chapters.json'),
    JSON.stringify([
      { id: 'c', name: { fr: 'C', en: 'C' }, unlockAfter: 0, levels: levels.map((l) => l.id) },
    ]),
  );
  return dir;
}
const opts = { timeoutMs: 20_000, maxStates: 100_000, apply: false, force: false };

test('solve: the injected exact engine (GPU) solves each level', () => {
  const exact = vi.fn(solve);
  const r = solveCommand(fixture(), ['a', 'z'], { ...opts, exact });
  expect(exact).toHaveBeenCalledTimes(2);
  expect(r.lines[0]).toMatch(/^a: 3 moves/);
  expect(r.lines[1]).toMatch(/^z: unsolvable/);
});

test('improve: the global engine (GPU) is used for frozen blocks and the proof', () => {
  const global = vi.fn(solve);
  const r = improveCommand(fixture(), ['k'], { ...opts, global });
  expect(global).toHaveBeenCalled();
  expect(r.lines[0]).toMatch(/k: .* 4 moves — optimal \(proven\)/);
});

test('GPU lane: the heaviest levels at the end of the queue (taken by the GPU lane)', () => {
  const big = fromAscii(['@B.B.B.~~E', 'B.B.B.B~~.', '.B.B.B.~~.', 'B.B.B.B...'], { id: 'big' });
  const wide = fromAscii(['@' + '.'.repeat(40) + 'E'], { id: 'wide' });
  const order = gpuOrder([big, LEVELS[0]!, wide, LEVELS[2]!]).map((l) => l.id);
  // too wide for the GPU: never at the end of the queue; then by increasing state size
  expect(order).toEqual(['wide', 'a', 'k', 'big']);
});

test('fitsGpu follows the GPU engine rule', () => {
  for (const [w, h] of [
    [32, 32],
    [33, 5],
    [5, 33],
    [1, 1],
  ] as const) {
    const level = { ...LEVELS[0]!, width: w, height: h };
    expect(fitsGpu(level)).toBe(gpuUnsupported(level) === undefined);
  }
});

describe('no adapter (simulated fallback)', () => {
  let before: string | undefined;
  beforeEach(() => {
    before = process.env.PUZZLECAVE_GPU;
    process.env.PUZZLECAVE_GPU = 'none';
  });
  afterEach(() => {
    if (before === undefined) delete process.env.PUZZLECAVE_GPU;
    else process.env.PUZZLECAVE_GPU = before;
  });

  test('parallel --gpu auto: a single message, everything on the CPU', async () => {
    const r = await solveParallel(fixture(), 'all', { ...opts, jobs: 2, gpu: 'auto' });
    expect(r.lines.filter((l) => /GPU unavailable/.test(l))).toHaveLength(1);
    expect(r.lines.some((l) => /GPU lane/.test(l))).toBe(false);
    expect(r.lines.some((l) => /^a: 3 moves/.test(l))).toBe(true);
  }, 120_000);

  test('parallel --gpu on: clear error before any computation', async () => {
    await expect(solveParallel(fixture(), 'all', { ...opts, jobs: 2, gpu: 'on' })).rejects.toThrow(
      /--gpu on: no WebGPU adapter/,
    );
  }, 120_000);
});

const present = process.env.PUZZLECAVE_GPU === 'none' ? false : probeGpu({ waitMs: 120_000 }).ok;

describe.skipIf(!present)('with a GPU', () => {
  test('parallel solve --gpu on: one GPU lane, same answers', async () => {
    const r = await solveParallel(fixture(), 'all', { ...opts, jobs: 2, gpu: 'on' });
    expect(r.lines.join('\n')).toMatch(/GPU lane/);
    expect(r.lines.some((l) => /^a: 3 moves/.test(l))).toBe(true);
    expect(r.lines.some((l) => /^z: unsolvable/.test(l))).toBe(true);
    expect(r.lines.some((l) => /^k: 4 moves/.test(l))).toBe(true);
  }, 180_000);

  test('parallel improve --gpu on, single process: everything goes through the GPU lane', async () => {
    const r = await improveParallel(fixture(), ['a', 'k'], { ...opts, jobs: 1, gpu: 'on' });
    expect(r.ok).toBe(true);
    expect(r.lines.join('\n')).toMatch(/GPU lane/);
    expect(r.lines.some((l) => /^k: .* 4 moves — optimal \(proven\)/.test(l))).toBe(true);
  }, 180_000);
});
