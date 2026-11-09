import { expect, test } from 'vitest';
import { fromAscii } from './ascii';
import {
  award,
  bestMasterMedal,
  bestMedal,
  masterMedalFor,
  masterTimeLimitMs,
  medalFor,
  resolveThresholds,
} from './medals';

test('master time limit: the gold time in ms, none without goldTime', () => {
  expect(masterTimeLimitMs(resolveThresholds({ goldTime: 20 }))).toBe(20_000);
  expect(masterTimeLimitMs(resolveThresholds({ goldTime: 10.4 }))).toBe(10_400);
  expect(masterTimeLimitMs(resolveThresholds({ goldTime: 20, bronzeTime: 42.5 }))).toBe(20_000);
  expect(masterTimeLimitMs(resolveThresholds({ goldMoves: 30 }))).toBeUndefined();
});

test.each([
  [40, 44, 50],
  [10, 12, 15],
  [200, 220, 250],
])('moves: gold %i → silver %i, bronze %i', (gold, silver, bronze) => {
  expect(resolveThresholds({ goldMoves: gold }).moves).toEqual({ gold, silver, bronze });
});

// no goldMoves: no move ratio, silver g × 1.25 and bronze g × 1.5 (minimum gaps 3 s and 6 s)
test.each([
  [20, 25, 30],
  [4, 7, 10],
])('time without moves: gold %d s → silver %d s, bronze %d s', (gold, silver, bronze) => {
  expect(resolveThresholds({ goldTime: gold }).time).toEqual({ gold, silver, bronze });
});

test.each([
  // [goldMoves, goldTime, silver s, bronze s]: g × (moves ratio) × 1.25 / 1.8, minimum gaps 3 / 6 s, up to the next tenth
  [40, 20, 27.5, 45],
  [10, 4, 7, 10.8],
  [610, 85, 116.9, 191.4],
  [100, 10, 13.8, 22.5],
])(
  'time with moves: %i moves, gold %d s → silver %d s, bronze %d s',
  (gm, gold, silver, bronze) => {
    expect(resolveThresholds({ goldMoves: gm, goldTime: gold }).time).toEqual({
      gold,
      silver,
      bronze,
    });
  },
);

test('time follows a silverMoves override (Twins: 25 moves, silverMoves 29, goldTime 5)', () => {
  const t = resolveThresholds({ goldMoves: 25, silverMoves: 29, goldTime: 5 });
  expect(t.moves).toEqual({ gold: 25, silver: 29, bronze: 32 });
  // silver 5 × 29/25 × 1.25 = 7.25 < gold + 3: the minimum gap applies; bronze 5 × 32/25 × 1.8 = 11.52, up to 11.6
  expect(t.time).toEqual({ gold: 5, silver: 8, bronze: 11.6 });
});

test('explicit silverTime / bronzeTime are kept whatever the moves', () => {
  const t = resolveThresholds({ goldMoves: 40, goldTime: 20, silverTime: 21, bronzeTime: 22 });
  expect(t.time).toEqual({ gold: 20, silver: 21, bronze: 22 });
});

test('overrides take precedence', () => {
  const t = resolveThresholds({ goldMoves: 40, silverMoves: 41, bronzeTime: 99, goldTime: 20 });
  expect(t.moves).toEqual({ gold: 40, silver: 41, bronze: 50 });
  // silver time follows the silverMoves override: 20 × 41/40 × 1.25 = 25.625, up to 25.7
  expect(t.time).toEqual({ gold: 20, silver: 25.7, bronze: 99 });
});

test('without gold: no tier, no master limits', () => {
  expect(resolveThresholds({})).toEqual({});
  // platinumMoves alone (refused by validate) gives no master limit either
  expect(resolveThresholds({ platinumMoves: 10 })).toEqual({});
});

test('master limits: master = goldMoves, grand master = platinumMoves, else goldMoves', () => {
  const plain = resolveThresholds({ goldMoves: 430 });
  expect(plain.masterMoves).toBe(430);
  expect(plain.grandMasterMoves).toBe(430);
  const t = resolveThresholds({ goldMoves: 430, platinumMoves: 278 });
  expect(t.masterMoves).toBe(430);
  expect(t.grandMasterMoves).toBe(278);
  expect(t.moves).toEqual({ gold: 430, silver: 473, bronze: 538 });
});

test('masterMedalFor: grand master within platinumMoves, master within goldMoves', () => {
  const th = resolveThresholds({ goldMoves: 610, platinumMoves: 538 });
  // no goldTime: no time condition
  expect(masterMedalFor(th, 500, Infinity)).toBe('grandMaster');
  expect(masterMedalFor(th, 538, 0)).toBe('grandMaster');
  expect(masterMedalFor(th, 539, 0)).toBe('master');
  expect(masterMedalFor(th, 610, 0)).toBe('master');
  expect(masterMedalFor(th, 611, 0)).toBeUndefined();
  expect(masterMedalFor(resolveThresholds({}), 1, 0)).toBeUndefined();
});

test('masterMedalFor: both medals within the gold time, master mode limit', () => {
  const th = resolveThresholds({ goldMoves: 610, platinumMoves: 538, goldTime: 85 });
  expect(masterMedalFor(th, 538, 85_000)).toBe('grandMaster');
  expect(masterMedalFor(th, 610, 85_000)).toBe('master');
  expect(masterMedalFor(th, 538, 85_010)).toBeUndefined();
  expect(masterMedalFor(th, 538, Infinity)).toBeUndefined();
  expect(masterMedalFor(th, 611, 1_000)).toBeUndefined();
});

test('without platinumMoves (or platinumMoves = goldMoves) the two limits coincide: grand master', () => {
  for (const th of [
    resolveThresholds({ goldMoves: 20 }),
    resolveThresholds({ goldMoves: 20, platinumMoves: 20 }),
  ]) {
    expect(masterMedalFor(th, 20, 0)).toBe('grandMaster');
    expect(masterMedalFor(th, 21, 0)).toBeUndefined();
  }
  // with time medals, within the gold time
  const timed = resolveThresholds({ goldMoves: 20, goldTime: 10 });
  expect(masterMedalFor(timed, 20, 10_000)).toBe('grandMaster');
  expect(masterMedalFor(timed, 20, 10_010)).toBeUndefined();
});

test('medalFor : value ≤ threshold', () => {
  const tier = { gold: 10, silver: 12, bronze: 15 };
  expect(medalFor(tier, 10)).toBe('gold');
  expect(medalFor(tier, 11)).toBe('silver');
  expect(medalFor(tier, 15)).toBe('bronze');
  expect(medalFor(tier, 16)).toBeUndefined();
  expect(medalFor(undefined, 1)).toBeUndefined();
});

test('award combines moves and time; master medals only in master mode', () => {
  const level = fromAscii(['@E'], { thresholds: { goldMoves: 10, goldTime: 20 } });
  expect(award(level, { moves: 11, timeMs: 20_000, mode: 'normal' })).toEqual({
    moves: 'silver',
    time: 'gold',
  });
  expect(award(level, { moves: 10, timeMs: 1_000, mode: 'normal' }).master).toBeUndefined();
  // master mode: the move medals it qualifies for, and its own medal within the limits (the
  // gold time, 20 s)
  expect(award(level, { moves: 10, timeMs: 20_000, mode: 'master' })).toEqual({
    moves: 'gold',
    time: 'gold',
    master: 'grandMaster',
  });
  expect(award(level, { moves: 10, timeMs: 21_000, mode: 'master' })).toEqual({
    moves: 'gold',
    time: 'silver',
  });
  expect(award(level, { moves: 11, timeMs: 1_000, mode: 'master' })).toEqual({
    moves: 'silver',
    time: 'gold',
  });
});

test('master within goldMoves, grand master within platinumMoves', () => {
  const level = fromAscii(['@E'], { thresholds: { goldMoves: 20, platinumMoves: 15 } });
  expect(award(level, { moves: 15, timeMs: 0, mode: 'master' })).toEqual({
    moves: 'gold',
    master: 'grandMaster',
  });
  expect(award(level, { moves: 16, timeMs: 0, mode: 'master' })).toEqual({
    moves: 'gold',
    master: 'master',
  });
  expect(award(level, { moves: 20, timeMs: 0, mode: 'master' }).master).toBe('master');
  // above gold: silver, but no master medal
  expect(award(level, { moves: 21, timeMs: 0, mode: 'master' })).toEqual({ moves: 'silver' });
  // the same moves in normal mode: gold only
  expect(award(level, { moves: 15, timeMs: 0, mode: 'normal' })).toEqual({ moves: 'gold' });
});

test('no master medal without a move limit, nor where the chapter has no master mode', () => {
  const plain = fromAscii(['@E']);
  expect(award(plain, { moves: 1, timeMs: 0, mode: 'master' }).master).toBeUndefined();
  const level = fromAscii(['@E'], { thresholds: { goldMoves: 10 } });
  expect(award(level, { moves: 1, timeMs: 0, mode: 'master' }, false).master).toBeUndefined();
});

test('bestMedal keeps the best', () => {
  expect(bestMedal('bronze', 'gold')).toBe('gold');
  expect(bestMedal(undefined, 'silver')).toBe('silver');
  expect(bestMedal(undefined, undefined)).toBeUndefined();
});

test('bestMasterMedal keeps the best: grand master over master', () => {
  expect(bestMasterMedal('master', 'grandMaster')).toBe('grandMaster');
  expect(bestMasterMedal('grandMaster', 'master')).toBe('grandMaster');
  expect(bestMasterMedal(undefined, 'master')).toBe('master');
  expect(bestMasterMedal(undefined, undefined)).toBeUndefined();
});
