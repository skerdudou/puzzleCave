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

test('master time limit: the bronze time in ms, none without goldTime', () => {
  expect(masterTimeLimitMs(resolveThresholds({ goldTime: 20 }))).toBe(30_000);
  expect(masterTimeLimitMs(resolveThresholds({ goldTime: 9 }))).toBe(15_000); // gold + 6 s
  expect(masterTimeLimitMs(resolveThresholds({ goldTime: 20, bronzeTime: 42.5 }))).toBe(42_500);
  expect(masterTimeLimitMs(resolveThresholds({ goldMoves: 30 }))).toBeUndefined();
});

test.each([
  [40, 44, 50],
  [10, 12, 15],
  [200, 220, 250],
])('moves: gold %i → silver %i, bronze %i', (gold, silver, bronze) => {
  expect(resolveThresholds({ goldMoves: gold }).moves).toEqual({ gold, silver, bronze });
});

test.each([
  [20, 25, 30],
  [4, 7, 10],
])('time: gold %d s → silver %d s, bronze %d s', (gold, silver, bronze) => {
  expect(resolveThresholds({ goldTime: gold }).time).toEqual({ gold, silver, bronze });
});

test('overrides take precedence', () => {
  const t = resolveThresholds({ goldMoves: 40, silverMoves: 41, bronzeTime: 99, goldTime: 20 });
  expect(t.moves).toEqual({ gold: 40, silver: 41, bronze: 50 });
  expect(t.time).toEqual({ gold: 20, silver: 25, bronze: 99 });
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
  expect(masterMedalFor(th, 500)).toBe('grandMaster');
  expect(masterMedalFor(th, 538)).toBe('grandMaster');
  expect(masterMedalFor(th, 539)).toBe('master');
  expect(masterMedalFor(th, 610)).toBe('master');
  expect(masterMedalFor(th, 611)).toBeUndefined();
  expect(masterMedalFor(resolveThresholds({}), 1)).toBeUndefined();
});

test('without platinumMoves (or platinumMoves = goldMoves) the two limits coincide: grand master', () => {
  for (const th of [
    resolveThresholds({ goldMoves: 20 }),
    resolveThresholds({ goldMoves: 20, platinumMoves: 20 }),
  ]) {
    expect(masterMedalFor(th, 20)).toBe('grandMaster');
    expect(masterMedalFor(th, 21)).toBeUndefined();
  }
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
  // master mode: the move medals it qualifies for, and its own medal within the limits
  expect(award(level, { moves: 10, timeMs: 99_000, mode: 'master' })).toEqual({
    moves: 'gold',
    master: 'grandMaster',
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
