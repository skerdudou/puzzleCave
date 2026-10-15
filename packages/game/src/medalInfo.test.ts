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
  // master within gold, grand master within platinumMoves and the silver time; then master
  // mode's time limit (bronze time)
  expect(rows[2]!.tiers).toEqual([
    { medal: 'master', text: '≤ 430' },
    { medal: 'grandMaster', text: '≤ 278 & ≤ 1:15.00 · limit ≤ 1:30.00' },
  ]);
  expect(thresholdRows(th, false).map((r) => r.kind)).toEqual(['moves', 'time']);
  // without platinumMoves nor goldTime both limits are gold, no time: grand master alone
  const plain = thresholdRows(resolveThresholds({ goldMoves: 20 }), true);
  expect(plain.map((r) => r.kind)).toEqual(['moves', 'master']);
  expect(plain[1]!.tiers).toEqual([{ medal: 'grandMaster', text: '≤ 20' }]);
  // the same move limits with goldTime: a slower finish is master only, so both are shown
  const timed = thresholdRows(resolveThresholds({ goldMoves: 20, goldTime: 10 }), true);
  expect(timed[2]!.tiers).toEqual([
    { medal: 'master', text: '≤ 20' },
    { medal: 'grandMaster', text: '≤ 20 & ≤ 0:13.00 · limit ≤ 0:16.00' },
  ]);
});

test('master row in French: the limit word is translated', () => {
  setLang('fr');
  try {
    const th = resolveThresholds({ goldMoves: 430, platinumMoves: 278, goldTime: 60 });
    expect(thresholdRows(th, true)[2]!.tiers[1]!.text).toBe('≤ 278 & ≤ 1:15.00 · limite ≤ 1:30.00');
  } finally {
    setLang('en');
  }
});

test('master line: named after the medal held, else after the mode, in every language', () => {
  const best = { kind: 'best', moves: 88, timeMs: 62_300 } as const;
  const lines = (lang: Lang) => {
    setLang(lang);
    return [
      masterLineText({ ...best, medal: 'grandMaster' }),
      masterLineText({ ...best, medal: 'master' }),
      masterLineText(best),
      masterLineText({ kind: 'notYet' }),
      masterLineText({ kind: 'locked' }),
      masterLineText({ kind: 'none' }),
    ];
  };
  try {
    expect(lines('fr')).toEqual([
      'Grand maître : 88 coups · 1:02.30',
      'Maître : 88 coups · 1:02.30',
      'Mode maître : 88 coups · 1:02.30',
      'Mode maître : pas encore réussi',
      '',
      '',
    ]);
    expect(lines('en').slice(0, 4)).toEqual([
      'Grand master: 88 moves · 1:02.30',
      'Master: 88 moves · 1:02.30',
      'Master mode: 88 moves · 1:02.30',
      'Master mode: not finished yet',
    ]);
    expect(lines('de').slice(0, 4)).toEqual([
      'Großmeister: 88 Züge · 1:02.30',
      'Meister: 88 Züge · 1:02.30',
      'Meistermodus: 88 Züge · 1:02.30',
      'Meistermodus: noch nicht geschafft',
    ]);
    expect(lines('es').slice(0, 4)).toEqual([
      'Gran maestro: 88 movimientos · 1:02.30',
      'Maestro: 88 movimientos · 1:02.30',
      'Modo maestro: 88 movimientos · 1:02.30',
      'Modo maestro: aún no superado',
    ]);
    expect(lines('it').slice(0, 4)).toEqual([
      'Gran maestro: 88 mosse · 1:02.30',
      'Maestro: 88 mosse · 1:02.30',
      'Modalità maestro: 88 mosse · 1:02.30',
      'Modalità maestro: non ancora superato',
    ]);
  } finally {
    setLang('en');
  }
});

test('no line or notice starts with the bare mode name, which is also a medal name', () => {
  // "Master: …" would read as the master medal: lines about the mode say "Master mode"
  for (const lang of LANGS) {
    const m = messages(lang);
    for (const key of ['masterNotYet', 'masterRules'] as const)
      expect(m[key].startsWith(m.masterModeName), `${lang} ${key}`).toBe(true);
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
