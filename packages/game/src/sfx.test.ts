import { expect, test } from 'vitest';
import type { GameEvent } from '@puzzlecave/core';
import { SfxFeed, sfxFor } from './sfx';

const at = { x: 0, y: 0 };
const moved: GameEvent = { type: 'moved', from: at, to: at };

test.each<[GameEvent[], string]>([
  [[], 'bump'],
  [[{ type: 'turned', facing: 'up' }], 'bump'],
  [[moved], 'step'],
  [[moved, { type: 'pushed', from: at, to: at }], 'push'],
  [[moved, { type: 'pushed', from: at, to: at }, { type: 'blockSank', at }], 'sink'],
  [[moved, { type: 'keyPicked', at }], 'key'],
  [[moved, { type: 'doorOpened', at }], 'door'],
  [[moved, { type: 'drowned', at }], 'drown'],
  [[moved, { type: 'won' }], 'win'],
])('%j sounds as %s', (events, sound) => {
  expect(sfxFor(events)).toBe(sound);
});

test('a bump sounds once while the player keeps walking into the wall', () => {
  const feed = new SfxFeed();
  expect(feed.next([])).toBe('bump');
  expect(feed.next([])).toBeNull();
  expect(feed.next([moved])).toBe('step');
  expect(feed.next([])).toBe('bump');
  feed.reset();
  expect(feed.next([])).toBe('bump');
});
