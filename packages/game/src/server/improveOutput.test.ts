import { expect, test } from 'vitest';
import { parseImproveOutput } from './improveOutput';

const PROVEN = [
  '> improve',
  '> tsx packages/tools/src/cli.ts improve pc-01 --timeout 20',
  '',
  'pc-01: solution saved (17) → 17 moves — optimal (proven) (0.0 s)',
  '  windows: 17 → 17 (0.0 s) — 1 windows, 0 replacements, windows up to 8 interactions',
  '  proof: 17 → 17 (0.0 s) — exact search finished (3 states)',
];
const BEST = [
  'pc-10: solution saved (325) → 300 moves — best known, proven lower bound ≥ 157 (15.0 s)',
  '  proof: 325 → 300 (3.3 s) — limit reached (114424 states), lower bound 157',
];

test('real output: proven optimal', () => {
  expect(parseImproveOutput(PROVEN)).toMatchObject({
    before: 17,
    after: 17,
    proven: true,
    lowerBound: 17,
  });
});

test('real output: best known with bound', () => {
  expect(parseImproveOutput(BEST)).toMatchObject({
    before: 325,
    after: 300,
    proven: false,
    lowerBound: 157,
  });
});

test('solution found by the search (none saved)', () => {
  expect(
    parseImproveOutput(['x: solution found (40) → 38 moves — optimal (proven) (2.0 s)']),
  ).toMatchObject({ before: 40, after: 38, proven: true });
});

test('no solution: unsolvable or bound only', () => {
  expect(parseImproveOutput(['x: no solution — unsolvable (0.1 s)'])).toMatchObject({
    unsolvable: true,
  });
  expect(parseImproveOutput(['x: no solution — proven lower bound ≥ 12 (5.0 s)'])).toMatchObject({
    unsolvable: false,
    lowerBound: 12,
  });
});

test('incomplete or unknown output: nothing invented', () => {
  expect(parseImproveOutput(['  windows: 17 → 17 (0.0 s) — …'])).toEqual({});
  expect(parseImproveOutput([])).toEqual({});
});

test('warnings and impossible thresholds detected', () => {
  const r = parseImproveOutput([
    ...PROVEN,
    'pc-01: goldMoves (10) < proven optimum (17) — impossible threshold',
  ]);
  expect(r.warnings).toEqual([
    'pc-01: goldMoves (10) < proven optimum (17) — impossible threshold',
  ]);
});

test('goldTime written by the run (new level), not taken for a warning', () => {
  const s = parseImproveOutput([
    'lvl: solution saved (5) → 3 moves — optimal (proven) (0.1 s)',
    'lvl: goldTime = 12 s written (from the 3-move gold solution)',
  ]);
  expect(s).toMatchObject({ after: 3, goldTime: 12 });
  expect(s.warnings).toBeUndefined();
  // missing (not guessed): a warning
  const m = parseImproveOutput([
    'lvl: solution saved (5) → 3 moves — optimal (proven) (0.1 s)',
    'lvl: warning — goldTime missing: run npm run times -- lvl --apply [--from <folder of the 9-move gold solution>]',
  ]);
  expect(m.goldTime).toBeUndefined();
  expect(m.warnings).toHaveLength(1);
});
