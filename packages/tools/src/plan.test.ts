import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, test } from 'vitest';
import { fromAscii } from '@puzzlecave/core';
import { writeTmx } from '@puzzlecave/tiled';
import { applySolution, parsePlanArgs } from './plan';

test('applySolution keeps the lower bound proven for the replaced solution', () => {
  const dir = mkdtempSync(join(tmpdir(), 'plan-'));
  try {
    const base = fromAscii(['@....E']);
    // gold already below: the .tmx is never touched
    const level = { ...base, thresholds: { ...base.thresholds, goldMoves: 1 } };
    mkdirSync(join(dir, 'solutions'));
    const file = join(dir, 'solutions', `${level.id}.txt`);
    writeFileSync(file, '# best known — not proven optimal (proven lower bound ≥ 4)\nRRRRRLR\n');
    expect(applySolution(dir, level, ['right', 'right', 'right', 'right', 'right'], 0)).toEqual([
      `${level.id}: solution written (5 moves)`,
    ]);
    expect(readFileSync(file, 'utf8').split('\n')[0]).toBe(
      '# best known — not proven optimal (proven lower bound ≥ 4)',
    );
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('applySolution: a level with a goldMoves gets platinumMoves, goldMoves stays', () => {
  const dir = mkdtempSync(join(tmpdir(), 'plan-'));
  try {
    const level = fromAscii(['@....E'], { id: 'p', thresholds: { goldMoves: 9 } });
    writeFileSync(join(dir, 'p.tmx'), writeTmx(level));
    const five = ['right', 'right', 'right', 'right', 'right'] as const;
    expect(applySolution(dir, level, [...five], 0)).toEqual(['p: solution written (5 moves)']);
    const tmx = readFileSync(join(dir, 'p.tmx'), 'utf8');
    expect(tmx).toMatch(/name="goldMoves" type="int" value="9"/);
    expect(tmx).toMatch(/name="platinumMoves" type="int" value="5"/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('plan arguments', () => {
  expect(parsePlanArgs(['pc-11'])).toEqual({
    ids: ['pc-11'],
    opts: {
      timeoutMs: 300_000,
      keys: 'explicit',
      improveMs: 0,
      maxMemoryMb: undefined,
      apply: false,
      planner: {},
    },
  });
  expect(
    parsePlanArgs([
      'pc-11',
      'pc-09',
      '--timeout',
      '60',
      '--keys',
      'auto',
      '--improve',
      '120',
      '--apply',
    ]),
  ).toEqual({
    ids: ['pc-11', 'pc-09'],
    opts: {
      timeoutMs: 60_000,
      keys: 'auto',
      improveMs: 120_000,
      maxMemoryMb: undefined,
      apply: true,
      planner: {},
    },
  });
  const limits = parsePlanArgs([
    'pc-09',
    '--max-free',
    '5',
    '--fill-free',
    '3',
    '--exit-free',
    '2',
    '--tries',
    '200',
    '--sub-states',
    '20000',
    '--alternatives',
    '2',
    '--widen',
    '1',
    '--side-keys',
    'on',
    '--all-doors',
    '0',
  ]);
  expect(limits).toMatchObject({
    ids: ['pc-09'],
    opts: {
      planner: {
        maxFree: 5,
        fillFree: 3,
        exitFree: 2,
        maxTries: 200,
        maxSubStates: 20_000,
        alternatives: 2,
        widen: 1,
        sideKeys: true,
        allDoorsLevel: 0,
      },
    },
  });
  expect(parsePlanArgs(['pc-11', '--widen', '1.5'])).toHaveProperty('error');
  expect(parsePlanArgs(['pc-11', '--side-keys', 'yes'])).toHaveProperty('error');
  expect(parsePlanArgs([])).toHaveProperty('error');
  expect(parsePlanArgs(['pc-11', '--keys', 'some'])).toHaveProperty('error');
  expect(parsePlanArgs(['pc-11', '--timeout', '0'])).toHaveProperty('error');
});
