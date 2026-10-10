import { expect, test } from 'vitest';
import { resolveThresholds } from '@puzzlecave/core';
import { platinumText, thresholdRows } from './medalInfo';

test('moves row: gold, silver, bronze limits derived from goldMoves', () => {
  const rows = thresholdRows(resolveThresholds({ goldMoves: 17 }, false));
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
  const rows = thresholdRows(
    resolveThresholds({ goldMoves: 52, goldTime: 12.5, bronzeTime: 30 }, false),
  );
  expect(rows.map((r) => r.kind)).toEqual(['moves', 'time']);
  expect(rows[1]!.tiers.map((t) => t.text)).toEqual(['≤ 0:12.50', '≤ 0:15.63', '≤ 0:30.00']);
});

test('no gold threshold: no row', () => {
  expect(thresholdRows(resolveThresholds({}, true))).toEqual([]);
});

test('platinum limit: the time if any, else "without drowning", nothing if not platinum', () => {
  const survive = 'without drowning';
  expect(platinumText(resolveThresholds({ goldTime: 20 }, true), true, survive)).toBe('≤ 0:20.00');
  expect(platinumText(resolveThresholds({ goldMoves: 20 }, true), true, survive)).toBe(survive);
  expect(platinumText(resolveThresholds({ goldTime: 20 }, false), false, survive)).toBeUndefined();
});
