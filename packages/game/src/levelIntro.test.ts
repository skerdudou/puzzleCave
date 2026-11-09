import { beforeEach, expect, test } from 'vitest';
import { setLang } from './i18n';
import { introLines, keysLine } from './levelIntro';

beforeEach(() => setLang('en'));
const base = { initialKeys: 0 };

test('no banner in normal mode without keys at start', () => {
  expect(introLines(base)).toEqual([]);
  expect(keysLine(0)).toBeNull();
});

test('keys at start: a count, or a debt and how many keys open the first door', () => {
  expect(introLines({ ...base, initialKeys: 2 })).toEqual(['Keys at start: 2']);
  expect(keysLine(-12)).toBe('Keys at start: -12 · Pick up 13 keys before a door opens');
});
