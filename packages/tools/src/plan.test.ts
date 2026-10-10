import { expect, test } from 'vitest';
import { parsePlanArgs } from './plan';

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
