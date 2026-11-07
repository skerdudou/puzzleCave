import { expect, test } from 'vitest';
import { LOG_KEY, appendLog, formatLine, readLog, type LogLine } from './updateLog';

const mem = () => {
  const m = new Map<string, string>();
  return {
    getItem: (k: string) => m.get(k) ?? null,
    setItem: (k: string, v: string) => void m.set(k, v),
  };
};
const line = (what: string, t = 0): LogLine => ({
  t,
  tab: 'abc',
  v: 'd15be5a',
  scene: 'Menu',
  what,
});

test('the journal keeps the latest lines, oldest first, across reads', () => {
  const s = mem();
  for (let i = 0; i < 5; i++) appendLog(s, line(`n${i}`), 3);
  expect(readLog(s).map((l) => l.what)).toEqual(['n2', 'n3', 'n4']);
});

test('an unreadable journal reads as empty, and is started again', () => {
  const s = mem();
  s.setItem(LOG_KEY, '{oops');
  expect(readLog(s)).toEqual([]);
  appendLog(s, line('again'));
  expect(readLog(s).map((l) => l.what)).toEqual(['again']);
  expect(readLog(null)).toEqual([]);
});

test('a line as text: local date and time to the millisecond, tab, version, screen, what', () => {
  const t = new Date(2026, 10, 7, 21, 4, 9, 7).getTime();
  expect(formatLine(line('new version downloaded', t))).toBe(
    '2026-11-07 21:04:09.007 [tab abc] d15be5a Menu — new version downloaded',
  );
  expect(formatLine({ ...line('page loaded', t), scene: '' })).toMatch(/d15be5a - — page loaded$/);
});
