import { expect, test } from 'vitest';
import { resolveThresholds } from '@puzzlecave/core';
import { LANGS, messages, setLang, type Lang } from './i18n';
import { masterLineText, masterStatus, thresholdRows } from './medalInfo';

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
  expect(rows[1]!.tiers.map((t) => t.text)).toEqual(['≤ 0:12.50', '≤ 0:17.50', '≤ 0:30.00']);
});

test('no gold threshold: no row', () => {
  expect(thresholdRows(resolveThresholds({}), true)).toEqual([]);
});

test('master mode: its own third row (master, grand master moves), only where it exists', () => {
  const th = resolveThresholds({ goldMoves: 430, platinumMoves: 278, goldTime: 60 });
  const rows = thresholdRows(th, true);
  expect(rows.map((r) => r.kind)).toEqual(['moves', 'time', 'master']);
  expect(rows[0]!.tiers.map((t) => t.medal)).toEqual(['gold', 'silver', 'bronze']);
  // master within gold, grand master within platinumMoves (the time limit, the gold time, is in
  // the box's rules)
  expect(rows[2]!.tiers).toEqual([
    { medal: 'master', text: '≤ 430 moves' },
    { medal: 'grandMaster', text: '≤ 278 moves' },
  ]);
  expect(thresholdRows(th, false).map((r) => r.kind)).toEqual(['moves', 'time']);
  // without platinumMoves both limits are gold: grand master alone, with or without goldTime
  for (const o of [{ goldMoves: 20 }, { goldMoves: 20, goldTime: 10 }]) {
    const rows = thresholdRows(resolveThresholds(o), true);
    expect(rows.at(-1)!.tiers).toEqual([{ medal: 'grandMaster', text: '≤ 20 moves' }]);
  }
});

test('master row: a limit equal to the proven optimum reads "=", the others "≤"', () => {
  const th = resolveThresholds({ goldMoves: 442, platinumMoves: 401, goldTime: 60 });
  expect(thresholdRows(th, true, 401)[2]!.tiers).toEqual([
    { medal: 'master', text: '≤ 442 moves' },
    { medal: 'grandMaster', text: '= 401 moves' },
  ]);
  // not proven (no optimum) or a limit above it: "≤"
  expect(thresholdRows(th, true)[2]!.tiers[1]!.text).toBe('≤ 401 moves');
  expect(thresholdRows(th, true, 399)[2]!.tiers[1]!.text).toBe('≤ 401 moves');
  // the moves row: gold above the optimum, "≤"
  expect(thresholdRows(th, true, 401)[0]!.tiers.map((t) => t.text)).toEqual([
    '≤ 442',
    '≤ 487',
    '≤ 553',
  ]);
  // an easy level (no platinumMoves): gold is the optimum, "=" for gold and grand master alone
  const gold = resolveThresholds({ goldMoves: 26 });
  const easy = thresholdRows(gold, true, 26);
  expect(easy[0]!.tiers.map((t) => t.text)).toEqual(['= 26', '≤ 29', '≤ 33']);
  expect(easy.at(-1)!.tiers).toEqual([{ medal: 'grandMaster', text: '= 26 moves' }]);
});

test('master row in French: the moves word is translated', () => {
  setLang('fr');
  try {
    const th = resolveThresholds({ goldMoves: 430, platinumMoves: 278, goldTime: 60 });
    expect(thresholdRows(th, true)[2]!.tiers[1]!.text).toBe('≤ 278 coups');
    expect(thresholdRows(th, true, 278)[2]!.tiers[1]!.text).toBe('= 278 coups');
  } finally {
    setLang('en');
  }
});

test('master record: as the record over all runs, whatever the medal, in every language', () => {
  const best = { kind: 'best', moves: 88, timeMs: 62_300 } as const;
  const lines = (lang: Lang) => {
    setLang(lang);
    return [
      masterLineText({ ...best, medal: 'grandMaster' }),
      masterLineText(best),
      masterLineText({ kind: 'notYet' }),
      masterLineText({ kind: 'locked' }),
      masterLineText({ kind: 'none' }),
    ];
  };
  try {
    expect(lines('fr')).toEqual([
      'Record : 88 coups · 1:02.30',
      'Record : 88 coups · 1:02.30',
      'Pas encore réussi',
      '',
      '',
    ]);
    expect(lines('en').slice(0, 3)).toEqual([
      'Best: 88 moves · 1:02.30',
      'Best: 88 moves · 1:02.30',
      'Not finished yet',
    ]);
  } finally {
    setLang('en');
  }
});

test('the mode name is not a medal name', () => {
  for (const lang of LANGS) {
    const m = messages(lang);
    expect(m.masterModeName).not.toBe(m.masterMedal);
  }
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

test('masterStatus in author mode: never locked, still none where the chapter has no master mode', () => {
  expect(masterStatus(undefined, true, true)).toEqual({ kind: 'notYet' });
  expect(masterStatus({ completed: true, medals: { moves: 'silver' } }, true, true)).toEqual({
    kind: 'notYet',
  });
  expect(masterStatus(undefined, false, true)).toEqual({ kind: 'none' });
});
