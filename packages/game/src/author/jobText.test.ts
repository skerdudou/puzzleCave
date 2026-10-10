import { beforeEach, expect, test } from 'vitest';
import { setLang } from '../i18n';
import { describeJob, type JobInfo } from './jobText';

const base: JobInfo = {
  state: 'done',
  levelId: 'x',
  log: [],
  elapsedMs: 0,
  timeoutS: 120,
  warnings: [],
  tmxChanged: false,
};
beforeEach(() => setLang('fr'));

test('running: animated dots and elapsed time, no fixed duration assumed', () => {
  const j: JobInfo = { ...base, state: 'running', elapsedMs: 12_400 };
  expect(describeJob(j, 0).headline).toBe('Optimisation en cours (12 s écoulées)');
  expect(describeJob(j, 1).headline).toBe('Optimisation en cours. (12 s écoulées)');
  expect(describeJob(j, 3).headline).toBe('Optimisation en cours... (12 s écoulées)');
  expect(describeJob(j, 4).headline).toBe('Optimisation en cours (12 s écoulées)');
});

test('running: last stage line as detail', () => {
  const j: JobInfo = { ...base, state: 'running', log: ['  proof: 5 → 5 (1.0 s) — x'] };
  expect(describeJob(j, 0).detail).toBe('proof: 5 → 5 (1.0 s) — x');
});

test('done: improved, proven', () => {
  const r = describeJob({ ...base, before: 325, after: 300, proven: true, lowerBound: 300 }, 0);
  expect(r.headline).toBe('Optimisée : 325 → 300 coups (prouvée optimale)');
  expect(r.improved).toBe(true);
});

test('done: improved, best known with bound', () => {
  const r = describeJob({ ...base, before: 325, after: 300, proven: false, lowerBound: 157 }, 0);
  expect(r.headline).toBe('Optimisée : 325 → 300 coups (meilleure connue, borne ≥ 157)');
});

test('done: already optimal', () => {
  const r = describeJob({ ...base, before: 17, after: 17, proven: true, lowerBound: 17 }, 0);
  expect(r.headline).toBe('Déjà optimale : 17 coups (prouvée optimale)');
  expect(r.improved).toBe(false);
});

test('done: no improvement, unproven', () => {
  const r = describeJob({ ...base, before: 30, after: 30, proven: false, lowerBound: 20 }, 0);
  expect(r.headline).toBe('Aucune amélioration : 30 coups (meilleure connue, borne ≥ 20)');
});

test('failure', () => {
  expect(describeJob({ ...base, state: 'failed' }, 0).headline).toContain('a échoué');
});

test('English', () => {
  setLang('en');
  expect(
    describeJob({ ...base, before: 5, after: 3, proven: true, lowerBound: 3 }, 0).headline,
  ).toBe('Optimized: 5 → 3 moves (proven optimal)');
});

test('done with warnings: displayed', () => {
  const r = describeJob(
    {
      ...base,
      before: 3,
      after: 3,
      proven: true,
      lowerBound: 3,
      warnings: ['x: impossible threshold'],
    },
    0,
  );
  expect(r.detail).toContain('impossible threshold');
});

test('failure: last log lines and warnings', () => {
  const r = describeJob({ ...base, state: 'failed', log: ['a', 'b', 'c'], warnings: ['w'] }, 0);
  expect(r.detail).toContain('b c');
  expect(r.detail).toContain('w');
});

test('proof kept: dedicated message', () => {
  const r = describeJob(
    { ...base, before: 5, after: 3, proven: true, lowerBound: 3, proofKept: true },
    0,
  );
  expect(r.headline).toContain('conservée');
  expect(r.headline).toContain('3 coups');
  expect(r.improved).toBe(false);
});
