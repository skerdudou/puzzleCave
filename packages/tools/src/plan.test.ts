import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, test } from 'vitest';
import { fromAscii } from '@puzzlecave/core';
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

test('plan arguments', () => {
  expect(parsePlanArgs(['pc-11'])).toEqual({
    ids: ['pc-11'],
    opts: {
      timeoutMs: 300_000,
      keys: 'explicit',
      improveMs: 0,
      maxMemoryMb: undefined,
      apply: false,
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
    },
  });
  expect(parsePlanArgs([])).toHaveProperty('error');
  expect(parsePlanArgs(['pc-11', '--keys', 'some'])).toHaveProperty('error');
  expect(parsePlanArgs(['pc-11', '--timeout', '0'])).toHaveProperty('error');
});
