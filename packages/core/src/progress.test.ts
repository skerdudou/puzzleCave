import { expect, test } from 'vitest';
import {
  completedCount,
  isChapterUnlocked,
  isLevelUnlocked,
  recordRun,
  validateChapters,
  type Chapter,
  type Records,
} from './progress';

const chapters: Chapter[] = [
  { id: 'c1', name: { fr: 'Un', en: 'One' }, unlockAfter: 0, levels: ['a', 'b', 'c'] },
  { id: 'c2', name: { fr: 'Deux', en: 'Two' }, unlockAfter: 2, levels: ['d', 'e'] },
];
const done = (...ids: string[]): Records =>
  Object.fromEntries(ids.map((id) => [id, { completed: true, medals: {} }]));

test('first level of the first chapter is open, the next one after completion', () => {
  expect(isLevelUnlocked(chapters, 0, 0, {})).toBe(true);
  expect(isLevelUnlocked(chapters, 0, 1, {})).toBe(false);
  expect(isLevelUnlocked(chapters, 0, 1, done('a'))).toBe(true);
});

test('a chapter opens after unlockAfter levels of the previous one', () => {
  expect(completedCount(chapters[0]!, done('a', 'c'))).toBe(2);
  expect(isChapterUnlocked(chapters, 1, done('a'))).toBe(false);
  expect(isChapterUnlocked(chapters, 1, done('a', 'b'))).toBe(true);
  expect(isLevelUnlocked(chapters, 1, 0, done('a', 'b'))).toBe(true);
  expect(isLevelUnlocked(chapters, 1, 0, done('a'))).toBe(false);
});

test('recordRun keeps the best results', () => {
  const r1 = recordRun(
    undefined,
    { moves: 30, timeMs: 9000, mode: 'normal' },
    { moves: 'silver', platinum: false },
  );
  expect(r1).toEqual({
    completed: true,
    bestMoves: 30,
    bestTimeMs: 9000,
    medals: { moves: 'silver' },
  });
  const r2 = recordRun(
    r1,
    { moves: 40, timeMs: 5000, mode: 'platinum' },
    { moves: 'bronze', time: 'gold', platinum: true },
  );
  expect(r2).toEqual({
    completed: true,
    bestMoves: 30,
    bestTimeMs: 5000,
    medals: { moves: 'silver', time: 'gold', platinum: true },
  });
});

test('validateChapters : correct', () => {
  expect(validateChapters(chapters, new Set(['a', 'b', 'c', 'd', 'e']))).toEqual([]);
});

test.each<[string, unknown, string[], RegExp]>([
  ['not an array', {}, [], /array/],
  ['unknown level', chapters, ['a', 'b', 'c', 'd'], /unknown level "e"/],
  ['level missing from the chapters', chapters, ['a', 'b', 'c', 'd', 'e', 'f'], /"f" missing/],
  ['duplicate level', [{ ...chapters[0]!, levels: ['a', 'a'] }], ['a'], /"a" used twice/],
  [
    'unlockAfter too large',
    [chapters[0], { ...chapters[1]!, unlockAfter: 4 }],
    ['a', 'b', 'c', 'd', 'e'],
    /unlockAfter/,
  ],
  ['missing name', [{ id: 'x', unlockAfter: 0, levels: ['a'] }], ['a'], /name/],
])('validateChapters : %s', (_n, value, ids, re) => {
  expect(validateChapters(value, new Set(ids))).toContainEqual(expect.stringMatching(re));
});
