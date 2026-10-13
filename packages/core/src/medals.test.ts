import { expect, test } from 'vitest';
import { fromAscii } from './ascii';
import { award, bestMedal, medalFor, resolveThresholds } from './medals';

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

test('without gold: no tier, no platinum limit', () => {
  expect(resolveThresholds({})).toEqual({});
});

test('platinum moves: platinumMoves, else goldMoves; silver and bronze still from gold', () => {
  expect(resolveThresholds({ goldMoves: 430 }).platinumMoves).toBe(430);
  const t = resolveThresholds({ goldMoves: 430, platinumMoves: 278 });
  expect(t.platinumMoves).toBe(278);
  expect(t.moves).toEqual({ gold: 430, silver: 473, bronze: 538 });
});

test('medalFor : value ≤ threshold', () => {
  const tier = { gold: 10, silver: 12, bronze: 15 };
  expect(medalFor(tier, 10)).toBe('gold');
  expect(medalFor(tier, 11)).toBe('silver');
  expect(medalFor(tier, 15)).toBe('bronze');
  expect(medalFor(tier, 16)).toBeUndefined();
  expect(medalFor(undefined, 1)).toBeUndefined();
});

test('award combines moves and time; platinum only in master mode', () => {
  const level = fromAscii(['@E'], { thresholds: { goldMoves: 10, goldTime: 20 } });
  expect(award(level, { moves: 11, timeMs: 20_000, mode: 'normal' })).toEqual({
    moves: 'silver',
    time: 'gold',
    platinum: false,
  });
  expect(award(level, { moves: 10, timeMs: 1_000, mode: 'normal' }).platinum).toBe(false);
  // master mode: the move medals it qualifies for, and platinum within the limit
  expect(award(level, { moves: 10, timeMs: 99_000, mode: 'master' })).toEqual({
    moves: 'gold',
    platinum: true,
  });
  expect(award(level, { moves: 11, timeMs: 1_000, mode: 'master' })).toEqual({
    moves: 'silver',
    time: 'gold',
    platinum: false,
  });
});

test('platinum uses platinumMoves when the level has one', () => {
  const level = fromAscii(['@E'], { thresholds: { goldMoves: 20, platinumMoves: 15 } });
  expect(award(level, { moves: 15, timeMs: 0, mode: 'master' }).platinum).toBe(true);
  const gold = award(level, { moves: 16, timeMs: 0, mode: 'master' });
  expect(gold).toEqual({ moves: 'gold', platinum: false });
});

test('no platinum without a move limit, nor where the chapter has no master mode', () => {
  const plain = fromAscii(['@E']);
  expect(award(plain, { moves: 1, timeMs: 0, mode: 'master' }).platinum).toBe(false);
  const level = fromAscii(['@E'], { thresholds: { goldMoves: 10 } });
  expect(award(level, { moves: 1, timeMs: 0, mode: 'master' }, false).platinum).toBe(false);
});

test('bestMedal keeps the best', () => {
  expect(bestMedal('bronze', 'gold')).toBe('gold');
  expect(bestMedal(undefined, 'silver')).toBe('silver');
  expect(bestMedal(undefined, undefined)).toBeUndefined();
});
