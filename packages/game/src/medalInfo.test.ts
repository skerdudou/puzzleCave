import { expect, test } from 'vitest';
import { resolveThresholds } from '@puzzlecave/core';
import { masterStatus, thresholdRows } from './medalInfo';

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

test('master mode: its own third row (master, grand master, time limit), only where it exists', () => {
  const th = resolveThresholds({ goldMoves: 430, platinumMoves: 278, goldTime: 60 });
  const rows = thresholdRows(th, true);
  expect(rows.map((r) => r.kind)).toEqual(['moves', 'time', 'master']);
  expect(rows[0]!.tiers.map((t) => t.medal)).toEqual(['gold', 'silver', 'bronze']);
  // master within gold, grand master within platinumMoves; the time limit (bronze time) once
  expect(rows[2]!.tiers).toEqual([
    { medal: 'master', text: '≤ 430' },
    { medal: 'grandMaster', text: '≤ 278 · ≤ 1:30.00' },
  ]);
  expect(thresholdRows(th, false).map((r) => r.kind)).toEqual(['moves', 'time']);
  // without platinumMoves both limits are gold: grand master alone; without goldTime, no time
  const plain = thresholdRows(resolveThresholds({ goldMoves: 20 }), true);
  expect(plain.map((r) => r.kind)).toEqual(['moves', 'master']);
  expect(plain[1]!.tiers).toEqual([{ medal: 'grandMaster', text: '≤ 20' }]);
});

test('masterStatus: none, locked, not yet, best master run', () => {
  const gold = { completed: true, medals: { moves: 'gold' as const } };
  expect(masterStatus(gold, false)).toEqual({ kind: 'none' });
  expect(masterStatus(undefined, true)).toEqual({ kind: 'locked' });
  expect(masterStatus({ completed: true, medals: { moves: 'silver' } }, true)).toEqual({
    kind: 'locked',
  });
  expect(masterStatus(gold, true)).toEqual({ kind: 'notYet' });
  const run = { ...gold, masterBestMoves: 41, masterBestTimeMs: 12_340 };
  expect(masterStatus({ ...run, medals: { master: 'grandMaster' } }, true)).toEqual({
    kind: 'best',
    moves: 41,
    timeMs: 12_340,
    medal: 'grandMaster',
  });
  expect(masterStatus({ ...run, medals: { moves: 'gold', master: 'master' } }, true)).toEqual({
    kind: 'best',
    moves: 41,
    timeMs: 12_340,
    medal: 'master',
  });
  // a master run above gold: best run, no medal
  expect(masterStatus(run, true)).toEqual({ kind: 'best', moves: 41, timeMs: 12_340 });
});
