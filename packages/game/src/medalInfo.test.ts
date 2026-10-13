import { expect, test } from 'vitest';
import { resolveThresholds } from '@puzzlecave/core';
import { thresholdRows } from './medalInfo';

test('moves row: gold, silver, bronze limits derived from goldMoves', () => {
  const rows = thresholdRows(resolveThresholds({ goldMoves: 17 }));
  expect(rows).toEqual([
    {
      kind: 'moves',
      tiers: [
        { medal: 'gold', text: '≤ 17' },
        { medal: 'silver', text: '≤ 19' },
        { medal: 'bronze', text: '≤ 22' },
      ],
    },
  ]);
});

test('time row is formatted like the clock, after the moves row', () => {
  const rows = thresholdRows(resolveThresholds({ goldMoves: 52, goldTime: 12.5, bronzeTime: 30 }));
  expect(rows.map((r) => r.kind)).toEqual(['moves', 'time']);
  expect(rows[1]!.tiers.map((t) => t.text)).toEqual(['≤ 0:12.50', '≤ 0:15.63', '≤ 0:30.00']);
});

test('no gold threshold: no row', () => {
  expect(thresholdRows(resolveThresholds({}), true)).toEqual([]);
});

test('platinum limit first in the moves row, only where master mode exists', () => {
  const th = resolveThresholds({ goldMoves: 430, platinumMoves: 278 });
  expect(thresholdRows(th, true)[0]!.tiers).toEqual([
    { medal: 'platinum', text: '≤ 278' },
    { medal: 'gold', text: '≤ 430' },
    { medal: 'silver', text: '≤ 473' },
    { medal: 'bronze', text: '≤ 538' },
  ]);
  expect(thresholdRows(th, false)[0]!.tiers.map((t) => t.medal)).toEqual([
    'gold',
    'silver',
    'bronze',
  ]);
  // without platinumMoves, the platinum limit is the gold one
  const plain = thresholdRows(resolveThresholds({ goldMoves: 20 }), true)[0]!.tiers[0];
  expect(plain).toEqual({ medal: 'platinum', text: '≤ 20' });
});
