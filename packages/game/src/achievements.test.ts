import { expect, test } from 'vitest';
import type { Chapter, LevelRecord, Records } from '@puzzlecave/core';
import {
  DEEP_THOUGHT_MS,
  KonamiCode,
  Stillness,
  achievementList,
  grant,
  newlyEarned,
  shownAchievements,
  viewOf,
  type AchievementLevels,
} from './achievements';

const chapter = (id: string, levels: string[], masterMode?: boolean): Chapter => ({
  id,
  name: { en: id, fr: id },
  unlockAfter: 0,
  levels,
  ...(masterMode === undefined ? {} : { masterMode }),
});
const chapters = [
  chapter('easy', ['e1', 'e2'], false),
  chapter('medium', ['m1', 'm2']),
  chapter('custom', ['c1']),
];
const lv: AchievementLevels = {
  chapters,
  hasMaster: (id) => !id.startsWith('e'),
  // m2 has no time medals
  hasTime: (id) => id !== 'm2',
};
const rec = (medals: LevelRecord['medals'] = {}): LevelRecord => ({ completed: true, medals });
const ids = () => achievementList(lv).map((a) => a.id);

test('the list: per known chapter, then global medals, then the secrets', () => {
  expect(ids()).toEqual([
    'done:easy',
    'gold:easy',
    'timeGold:easy',
    'done:medium',
    'gold:medium',
    'timeGold:medium',
    'grandMaster:medium',
    'gold1',
    'goldAll',
    'master1',
    'grandMaster1',
    'completionist',
    'deepThought',
    'konami',
  ]);
  // 10 and 25 golds: only with that many levels
  const many = Array.from({ length: 25 }, (_, i) => `m${i}`);
  const big = achievementList({
    chapters: [chapter('medium', many)],
    hasMaster: () => true,
    hasTime: () => true,
  });
  expect(big.map((a) => a.id)).toContain('gold25');
  expect(big.find((a) => a.id === 'gold10')?.n).toBe(10);
});

test('the secrets are hidden and earned by an action only', () => {
  const secrets = achievementList(lv).filter((a) => a.hidden);
  expect(secrets.map((a) => a.id)).toEqual(['deepThought', 'konami']);
  expect(secrets.every((a) => a.progress === undefined)).toBe(true);
});

test('earned from the records: chapter done, all gold, grand master, firsts', () => {
  const list = achievementList(lv);
  expect(newlyEarned(list, {}, {})).toEqual([]);
  const r: Records = {
    e1: rec({ moves: 'gold' }),
    e2: rec({ moves: 'silver' }),
    m1: rec({ moves: 'gold', master: 'grandMaster' }),
    m2: rec({ moves: 'gold', master: 'master' }),
  };
  expect(newlyEarned(list, r, {})).toEqual([
    'done:easy',
    'done:medium',
    'gold:medium',
    'gold1',
    'master1',
    'grandMaster1',
  ]);
  // already earned ones are not given again
  expect(newlyEarned(list, r, { 'done:easy': 1, gold1: 1 })).not.toContain('gold1');
});

test('progress: how far the player is', () => {
  const byId = new Map(achievementList(lv).map((a) => [a.id, a]));
  const r: Records = { m1: rec({ moves: 'gold', master: 'grandMaster' }), e1: rec() };
  expect(byId.get('gold:medium')!.progress!(r)).toEqual({ got: 1, goal: 2 });
  expect(byId.get('goldAll')!.progress!(r)).toEqual({ got: 1, goal: 5 });
  // all gold on the 5 levels and grand master on the 3 with master mode
  expect(byId.get('completionist')!.progress!(r)).toEqual({ got: 2, goal: 8 });
});

test('completionist: gold everywhere and grand master wherever master mode exists', () => {
  const list = achievementList(lv);
  const r: Records = {
    e1: rec({ moves: 'gold' }),
    e2: rec({ moves: 'gold' }),
    m1: rec({ moves: 'gold', master: 'grandMaster' }),
    m2: rec({ moves: 'gold', master: 'grandMaster' }),
    c1: rec({ moves: 'gold', master: 'grandMaster' }),
  };
  expect(newlyEarned(list, r, {})).toContain('completionist');
});

test('grant: records when, and returns only the new ones', () => {
  const earned: Record<string, number> = { gold1: 5 };
  expect(grant(earned, ['gold1', 'konami'], 9)).toEqual(['konami']);
  expect(earned).toEqual({ gold1: 5, konami: 9 });
});

test('stillness: a minute of the run clock without doing anything', () => {
  const s = new Stillness();
  expect(s.thinking(10 * DEEP_THOUGHT_MS)).toBe(false); // nothing done yet
  s.act(1000);
  expect(s.thinking(1000 + DEEP_THOUGHT_MS - 1)).toBe(false);
  expect(s.thinking(1000 + DEEP_THOUGHT_MS)).toBe(true);
  s.act(5000);
  expect(s.thinking(1000 + DEEP_THOUGHT_MS)).toBe(false);
  s.reset();
  expect(s.thinking(10 * DEEP_THOUGHT_MS)).toBe(false);
});

const CODE = ['ArrowUp', 'ArrowUp', 'ArrowDown', 'ArrowDown', 'ArrowLeft', 'ArrowRight'];
const TAIL = ['ArrowLeft', 'ArrowRight', 'B', 'a'];

test('the Konami code: the whole sequence, letters in any case', () => {
  const k = new KonamiCode();
  const keys = [...CODE, ...TAIL];
  expect(keys.map((key) => k.key(key))).toEqual([...keys.slice(1).map(() => false), true]);
  // again from scratch: the keys of the first one do not count
  expect(k.key('a')).toBe(false);
});

test('the Konami code: extra keys before it, a mistake restarts it', () => {
  const k = new KonamiCode();
  for (const key of ['ArrowUp', 'ArrowUp', 'ArrowUp', ...CODE, ...TAIL.slice(0, 3)])
    expect(k.key(key)).toBe(false);
  expect(k.key('a')).toBe(true);
  for (const key of [...CODE, 'x', ...TAIL]) expect(k.key(key)).toBe(false);
});

test('the view: earned, secret until earned, progress of the multi-step ones', () => {
  const byId = new Map(achievementList(lv).map((a) => [a.id, a]));
  const r: Records = { m1: rec({ moves: 'gold' }) };
  expect(viewOf(byId.get('gold:medium')!, r, {})).toEqual({
    earned: false,
    secret: false,
    progress: { got: 1, goal: 2 },
  });
  expect(viewOf(byId.get('gold:medium')!, r, { 'gold:medium': 1 })).toEqual({
    earned: true,
    secret: false,
  });
  // one step: no "0 / 1"
  expect(viewOf(byId.get('gold1')!, {}, {})).toEqual({ earned: false, secret: false });
  expect(viewOf(byId.get('konami')!, {}, {})).toEqual({ earned: false, secret: true });
  expect(viewOf(byId.get('konami')!, {}, { konami: 1 })).toEqual({ earned: true, secret: false });
});

test('time gold per chapter: the levels with time medals only', () => {
  const list = achievementList(lv);
  const byId = new Map(list.map((a) => [a.id, a]));
  expect(byId.get('timeGold:medium')!.desc).toBe('achDescTimeGold');
  // m2 has no time medals: m1 alone counts
  expect(byId.get('timeGold:medium')!.progress!({})).toEqual({ got: 0, goal: 1 });
  const r: Records = {
    m1: rec({ time: 'gold' }),
    e1: rec({ time: 'gold' }),
    e2: rec({ time: 'silver' }),
  };
  expect(newlyEarned(list, r, {})).toContain('timeGold:medium');
  expect(newlyEarned(list, r, {})).not.toContain('timeGold:easy');
  // gold in time is not gold in moves
  expect(newlyEarned(list, r, {})).not.toContain('gold:medium');
  // a chapter without any time medals has no time gold achievement
  const untimed = achievementList({ ...lv, hasTime: () => false }).map((a) => a.id);
  expect(untimed.some((id) => id.startsWith('timeGold:'))).toBe(false);
});

test('on a touch screen the Konami code is not listed, unless already earned', () => {
  const list = achievementList(lv);
  const ids = (touch: boolean, earned: Record<string, number> = {}) =>
    shownAchievements(list, earned, touch).map((a) => a.id);
  expect(ids(false)).toContain('konami');
  expect(ids(true)).not.toContain('konami');
  expect(ids(true)).toHaveLength(list.length - 1);
  expect(ids(true, { konami: 1 })).toContain('konami');
});
