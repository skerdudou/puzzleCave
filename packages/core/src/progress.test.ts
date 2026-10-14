import { expect, test } from 'vitest';
import {
  completedCount,
  hasMasterMode,
  isChapterUnlocked,
  isLevelUnlocked,
  isMasterUnlocked,
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
    { moves: 40, timeMs: 5000, mode: 'master' },
    { moves: 'bronze', time: 'gold', platinum: true },
  );
  expect(r2).toEqual({
    completed: true,
    bestMoves: 30,
    bestTimeMs: 5000,
    masterBestMoves: 40,
    masterBestTimeMs: 5000,
    medals: { moves: 'silver', time: 'gold', platinum: true },
  });
});

test('recordRun keeps the best master moves and time apart, from master runs only', () => {
  const normal = recordRun(
    undefined,
    { moves: 30, timeMs: 9000, mode: 'normal' },
    { moves: 'gold', platinum: false },
  );
  expect(normal.masterBestMoves).toBeUndefined();
  expect(normal.masterBestTimeMs).toBeUndefined();
  const m1 = recordRun(
    normal,
    { moves: 34, timeMs: 12_000, mode: 'master' },
    { moves: 'silver', platinum: false },
  );
  expect(m1).toMatchObject({ bestMoves: 30, masterBestMoves: 34, masterBestTimeMs: 12_000 });
  const m2 = recordRun(
    m1,
    { moves: 31, timeMs: 15_000, mode: 'master' },
    { moves: 'gold', platinum: true },
  );
  expect(m2).toMatchObject({ masterBestMoves: 31, masterBestTimeMs: 12_000 });
  // a later normal run keeps them
  const n2 = recordRun(m2, { moves: 50, timeMs: 1000, mode: 'normal' }, { platinum: false });
  expect(n2).toMatchObject({ masterBestMoves: 31, masterBestTimeMs: 12_000, bestTimeMs: 1000 });
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
  [
    'masterMode not a boolean',
    [{ ...chapters[0]!, masterMode: 'no' }, chapters[1]],
    ['a', 'b', 'c', 'd', 'e'],
    /masterMode must be true or false/,
  ],
])('validateChapters : %s', (_n, value, ids, re) => {
  expect(validateChapters(value, new Set(ids))).toContainEqual(expect.stringMatching(re));
});

test('masterMode: allowed as a boolean, on by default', () => {
  const easy = { ...chapters[0]!, masterMode: false };
  expect(validateChapters([easy, chapters[1]], new Set(['a', 'b', 'c', 'd', 'e']))).toEqual([]);
  expect(hasMasterMode(easy)).toBe(false);
  expect(hasMasterMode(chapters[1])).toBe(true);
  expect(hasMasterMode({ ...chapters[1]!, masterMode: true })).toBe(true);
});

test('master mode opens with gold on the level (or a platinum from an older save)', () => {
  expect(isMasterUnlocked(undefined)).toBe(false);
  expect(isMasterUnlocked({ completed: true, medals: { moves: 'silver', time: 'gold' } })).toBe(
    false,
  );
  expect(isMasterUnlocked({ completed: true, medals: { moves: 'gold' } })).toBe(true);
  expect(isMasterUnlocked({ completed: true, medals: { platinum: true } })).toBe(true);
  // a gold earned in master mode counts too: recordRun keeps it
  const r = recordRun(
    undefined,
    { moves: 9, timeMs: 1, mode: 'master' },
    { moves: 'gold', platinum: false },
  );
  expect(isMasterUnlocked(r)).toBe(true);
});
