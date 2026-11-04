import { beforeEach, expect, test } from 'vitest';
import { setLang } from './i18n';
import { introLines, keysLine } from './levelIntro';

beforeEach(() => setLang('en'));
const base = { master: false, masterVeteran: false, initialKeys: 0 };

test('no banner in normal mode without keys at start', () => {
  expect(introLines(base)).toEqual([]);
  expect(keysLine(0)).toBeNull();
});

test('keys at start: a count, or a debt and how many keys open the first door', () => {
  expect(introLines({ ...base, initialKeys: 2 })).toEqual(['Keys at start: 2']);
  expect(keysLine(-12)).toBe('Keys at start: -12 · Pick up 13 keys before a door opens');
});

test('master mode: the whole rules, then one short line once a master run is won', () => {
  const master = { ...base, master: true, timeLimitMs: 83_000 };
  expect(introLines(master)).toEqual([
    'Master mode: no undo, water is deadly',
    'Finish within 1:23.00 (bronze time)',
  ]);
  expect(introLines({ ...master, masterVeteran: true, initialKeys: 1 })).toEqual([
    '♛ No undo · deadly water · ≤ 1:23.00',
    'Keys at start: 1',
  ]);
  expect(introLines({ ...base, master: true, masterVeteran: true })).toEqual([
    '♛ No undo · deadly water',
  ]);
});
