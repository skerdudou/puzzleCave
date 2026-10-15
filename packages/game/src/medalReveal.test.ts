import { expect, test } from 'vitest';
import type { LevelRecord } from '@puzzlecave/core';
import { planReveal, REVEAL, type RevealInput } from './medalReveal';

const base: RevealInput = {
  award: {},
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

test('first finish: every earned medal is new, lowest first, the master medal last', () => {
  const plan = planReveal({
    ...base,
    award: { moves: 'gold', time: 'bronze', master: 'grandMaster' },
  });
  expect(plan.steps.map((s) => `${s.slot}:${s.medal}:${s.emphasis}`)).toEqual([
    'time:bronze:new',
    'moves:gold:new',
    'master:grandMaster:new',
  ]);
  expect(plan.steps.map((s) => s.delayMs)).toEqual([
    REVEAL.leadMs,
    REVEAL.leadMs + REVEAL.staggerMs,
    REVEAL.leadMs + 2 * REVEAL.staggerMs + REVEAL.masterGapMs,
  ]);
  expect(plan.totalMs).toBe(plan.steps[2]!.delayMs + REVEAL.effectMs);
  expect(plan.totalMs).toBeLessThanOrEqual(1500);
});

test('same medal on both rows: moves first', () => {
  expect(brief({ ...base, award: { moves: 'silver', time: 'silver' } })).toEqual([
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
  expect(brief({ ...base, previous, award: { moves: 'gold', time: 'gold' } })).toEqual([
    'moves:gold:new',
    'time:gold:owned',
  ]);
  // moves: silver kept, 30 < 32 is a record; time: gold kept, 14 s < 15 s is a record
  expect(
    brief({
      ...base,
      previous,
      timeMs: 14_000,
      award: { moves: 'silver', time: 'gold' },
    }),
  ).toEqual(['moves:silver:record', 'time:gold:record']);
  // a lower medal than the owned one is just owned
  expect(brief({ ...base, previous, moves: 40, award: { moves: 'bronze' } })).toEqual([
    'moves:bronze:owned',
  ]);
});

test('grand master already owned is not new', () => {
  const previous = rec({ bestMoves: 30, medals: { moves: 'gold', master: 'grandMaster' } });
  expect(brief({ ...base, previous, award: { moves: 'gold', master: 'grandMaster' } })).toEqual([
    'moves:gold:owned',
    'master:grandMaster:owned',
  ]);
});

test('master then grand master: an upgrade is new, a shorter master run is a record', () => {
  const previous = rec({
    bestMoves: 30,
    masterBestMoves: 35,
    medals: { moves: 'gold', master: 'master' },
  });
  const award = { moves: 'gold' as const, master: 'grandMaster' as const };
  expect(brief({ ...base, previous, award })).toEqual([
    'moves:gold:owned',
    'master:grandMaster:new',
  ]);
  // master again, in fewer moves than the master record: a record
  expect(brief({ ...base, previous, moves: 34, award: { master: 'master' } })).toEqual([
    'master:master:record',
  ]);
  // master after a grand master: owned (the save keeps the grand master)
  const gm = rec({ masterBestMoves: 20, medals: { master: 'grandMaster' } });
  expect(brief({ ...base, previous: gm, award: { master: 'master' } })).toEqual([
    'master:master:owned',
  ]);
});

test('a first master medal is new and comes last', () => {
  const plan = planReveal({ ...base, award: { moves: 'gold', master: 'master' } });
  expect(plan.steps.map((s) => `${s.slot}:${s.medal}:${s.emphasis}`)).toEqual([
    'moves:gold:new',
    'master:master:new',
  ]);
  expect(plan.steps[1]!.delayMs).toBe(REVEAL.leadMs + REVEAL.staggerMs + REVEAL.masterGapMs);
});

test('rows without a tier on the level show no medal', () => {
  expect(brief({ ...base, hasTimeTier: false, award: { moves: 'gold', time: 'gold' } })).toEqual([
    'moves:gold:new',
  ]);
});
