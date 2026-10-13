import { expect, test } from 'vitest';
import type { LevelRecord } from '@puzzlecave/core';
import { planReveal, REVEAL, type RevealInput } from './medalReveal';

const base: RevealInput = {
  award: { platinum: false },
  moves: 30,
  timeMs: 20_000,
  hasMovesTier: true,
  hasTimeTier: true,
};
const rec = (r: Partial<LevelRecord>): LevelRecord => ({ completed: true, medals: {}, ...r });
const brief = (i: RevealInput) =>
  planReveal(i).steps.map((s) => `${s.slot}:${s.medal}:${s.emphasis}`);

test('no medal: nothing to animate', () => {
  expect(planReveal(base)).toEqual({ steps: [], totalMs: 0 });
});

test('first finish: every earned medal is new, lowest first, platinum last', () => {
  const plan = planReveal({ ...base, award: { moves: 'gold', time: 'bronze', platinum: true } });
  expect(plan.steps.map((s) => `${s.slot}:${s.medal}:${s.emphasis}`)).toEqual([
    'time:bronze:new',
    'moves:gold:new',
    'platinum:platinum:new',
  ]);
  expect(plan.steps.map((s) => s.delayMs)).toEqual([
    REVEAL.leadMs,
    REVEAL.leadMs + REVEAL.staggerMs,
    REVEAL.leadMs + 2 * REVEAL.staggerMs + REVEAL.platinumGapMs,
  ]);
  expect(plan.totalMs).toBe(plan.steps[2]!.delayMs + REVEAL.effectMs);
  expect(plan.totalMs).toBeLessThanOrEqual(1500);
});

test('same medal on both rows: moves first', () => {
  expect(brief({ ...base, award: { moves: 'silver', time: 'silver', platinum: false } })).toEqual([
    'moves:silver:new',
    'time:silver:new',
  ]);
});

test('an upgrade is new, an owned medal with a better score is a record, else owned', () => {
  const previous = rec({
    bestMoves: 32,
    bestTimeMs: 15_000,
    medals: { moves: 'silver', time: 'gold' },
  });
  // moves: silver -> gold (upgrade); time: gold kept, slower than the record
  expect(
    brief({ ...base, previous, award: { moves: 'gold', time: 'gold', platinum: false } }),
  ).toEqual(['moves:gold:new', 'time:gold:owned']);
  // moves: silver kept, 30 < 32 is a record; time: gold kept, 14 s < 15 s is a record
  expect(
    brief({
      ...base,
      previous,
      timeMs: 14_000,
      award: { moves: 'silver', time: 'gold', platinum: false },
    }),
  ).toEqual(['moves:silver:record', 'time:gold:record']);
  // a lower medal than the owned one is just owned
  expect(
    brief({ ...base, previous, moves: 40, award: { moves: 'bronze', platinum: false } }),
  ).toEqual(['moves:bronze:owned']);
});

test('platinum already owned is not new', () => {
  const previous = rec({ bestMoves: 30, medals: { moves: 'gold', platinum: true } });
  expect(brief({ ...base, previous, award: { moves: 'gold', platinum: true } })).toEqual([
    'moves:gold:owned',
    'platinum:platinum:owned',
  ]);
});

test('rows without a tier on the level show no medal', () => {
  expect(
    brief({ ...base, hasTimeTier: false, award: { moves: 'gold', time: 'gold', platinum: false } }),
  ).toEqual(['moves:gold:new']);
});
