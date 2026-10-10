import { expect, test } from 'vitest';
import { fromAscii } from '../ascii';
import { initialState } from '../state';
import { CompactModel } from '../compactModel';
import { DEAD, Guide } from './guide';

test('guide: door on the only route and unreachable key → dead state (exactly DEAD)', () => {
  const s = initialState(fromAscii(['@.DE', '####', 'k...']));
  expect(new Guide(new CompactModel(s)).hOf(s)).toBe(DEAD);
});

test('guide: two doors, unreachable keys → exactly DEAD', () => {
  const s = initialState(fromAscii(['@DDE', '####', 'k.k.']));
  expect(new Guide(new CompactModel(s)).hOf(s)).toBe(DEAD);
});

test('guide: reachable key → finite estimate', () => {
  const s = initialState(fromAscii(['@.DE', 'k###']));
  expect(new Guide(new CompactModel(s)).hOf(s)).toBe(5);
});
