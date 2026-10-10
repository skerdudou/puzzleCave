import { expect, test } from 'vitest';
import { fromAscii } from './ascii';
import { award, bestMedal, medalFor, resolveThresholds } from './medals';

test.each([
  [40, 44, 50],
  [10, 12, 15],
  [200, 220, 250],
])('moves: gold %i → silver %i, bronze %i', (gold, silver, bronze) => {
  expect(resolveThresholds({ goldMoves: gold }, false).moves).toEqual({ gold, silver, bronze });
});

test.each([
  [20, 25, 30],
  [4, 7, 10],
])('time: gold %d s → silver %d s, bronze %d s', (gold, silver, bronze) => {
  expect(resolveThresholds({ goldTime: gold }, false).time).toEqual({ gold, silver, bronze });
});

test('overrides take precedence', () => {
  const t = resolveThresholds(
    { goldMoves: 40, silverMoves: 41, bronzeTime: 99, goldTime: 20 },
    false,
  );
  expect(t.moves).toEqual({ gold: 40, silver: 41, bronze: 50 });
  expect(t.time).toEqual({ gold: 20, silver: 25, bronze: 99 });
});

test('without gold: no tier', () => {
  expect(resolveThresholds({}, true)).toEqual({});
});

test('platinum: defaults to goldTime, overridable, absent if not platinum', () => {
  expect(resolveThresholds({ goldTime: 20 }, true).platinumTime).toBe(20);
  expect(resolveThresholds({ goldTime: 20, platinumTime: 18 }, true).platinumTime).toBe(18);
  expect(resolveThresholds({ goldTime: 20 }, false).platinumTime).toBeUndefined();
});

test('medalFor : value ≤ threshold', () => {
  const tier = { gold: 10, silver: 12, bronze: 15 };
  expect(medalFor(tier, 10)).toBe('gold');
  expect(medalFor(tier, 11)).toBe('silver');
  expect(medalFor(tier, 15)).toBe('bronze');
  expect(medalFor(tier, 16)).toBeUndefined();
  expect(medalFor(undefined, 1)).toBeUndefined();
});

test('award combines moves, time and platinum', () => {
  const level = fromAscii(['@E'], { platinum: true, thresholds: { goldMoves: 10, goldTime: 20 } });
  expect(award(level, { moves: 11, timeMs: 20_000, mode: 'normal' })).toEqual({
    moves: 'silver',
    time: 'gold',
    platinum: false,
  });
  expect(award(level, { moves: 10, timeMs: 19_990, mode: 'platinum' }).platinum).toBe(true);
  expect(award(level, { moves: 10, timeMs: 20_010, mode: 'platinum' }).platinum).toBe(false);
});

test('platinum without a time threshold: finishing without drowning is enough', () => {
  const level = fromAscii(['@E'], { platinum: true, thresholds: { goldMoves: 10 } });
  expect(award(level, { moves: 40, timeMs: 999_000, mode: 'platinum' }).platinum).toBe(true);
  expect(award(level, { moves: 40, timeMs: 999_000, mode: 'normal' }).platinum).toBe(false);
  const plain = fromAscii(['@E'], { thresholds: { goldMoves: 10 } });
  expect(award(plain, { moves: 1, timeMs: 1_000, mode: 'platinum' }).platinum).toBe(false);
});

test('bestMedal keeps the best', () => {
  expect(bestMedal('bronze', 'gold')).toBe('gold');
  expect(bestMedal(undefined, 'silver')).toBe('silver');
  expect(bestMedal(undefined, undefined)).toBeUndefined();
});
