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

test('guide: a block standing on gravel can still be pushed into water (vrnd-94, not DEAD)', () => {
  // vrnd-94 (validRandomLevel, seed 5): the only block stands on gravel and must fill the water
  const level = fromAscii([',..~##.', '#..E~.#', '~#~~BD.', ',~#.#.#', '~#~#..D', 'k.....@']);
  level.terrain[2 * level.width + 4] = 'gravel'; // under the block (no ASCII character for it)
  const s = initialState(level);
  // finite (door bound: fetch the key then go through the door = 17, the optimum here)
  expect(new Guide(new CompactModel(s)).hOf(s)).toBe(17);
});
