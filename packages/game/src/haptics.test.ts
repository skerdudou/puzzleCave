import { afterEach, expect, test, vi } from 'vitest';
import { step, fromAscii, initialState, type Dir, type GameEvent } from '@puzzlecave/core';
import { HAPTICS, HapticFeed, canVibrate, hapticFor, vibrate } from './haptics';

afterEach(() => vi.unstubAllGlobals());

/** the haptic of one move from the start of a small map (normal or master mode) */
function after(rows: string[], dir: Dir, mode: 'normal' | 'master' = 'normal', keys = 0) {
  const level = fromAscii(rows, { initialKeys: keys });
  return hapticFor(step(initialState(level, mode), dir).events);
}

test('which move gives which vibration: bumps and outcomes only', () => {
  expect(after(['#####', '#@..#', '#####'], 'right')).toBeNull(); // a plain step
  expect(after(['#####', '#@..#', '#####'], 'left')).toBe('bump'); // wall
  expect(after(['#####', '#@..#', '#####'], 'up')).toBe('bump'); // turning into a wall
  expect(after(['######', '#@B..#', '######'], 'right')).toBeNull(); // push: seen on the board
  expect(after(['######', '#@B#.#', '######'], 'right')).toBe('bump'); // stuck block
  expect(after(['######', '#@B~.#', '######'], 'right')).toBeNull(); // fill
  expect(after(['#####', '#@k.#', '#####'], 'right')).toBeNull(); // key
  expect(after(['#####', '#@D.#', '#####'], 'right', 'normal', 1)).toBeNull(); // door
  expect(after(['#####', '#@D.#', '#####'], 'right')).toBe('bump'); // door, no key
  expect(after(['#####', '#@~.#', '#####'], 'right')).toBe('bump'); // water, normal mode
  expect(after(['#####', '#@~.#', '#####'], 'right', 'master')).toBe('fail');
  expect(after(['#####', '#@E.#', '#####'], 'right')).toBe('won');
});

test('the outcome wins over the effects of the same move', () => {
  const won: GameEvent[] = [
    { type: 'moved', from: { x: 0, y: 0 }, to: { x: 1, y: 0 } },
    { type: 'keyPicked', at: { x: 1, y: 0 } },
    { type: 'won' },
  ];
  expect(hapticFor(won)).toBe('won');
});

test('patterns: only bump, fail and won; a short tick, outcomes within 0.3 s', () => {
  expect(Object.keys(HAPTICS).sort()).toEqual(['bump', 'fail', 'won']);
  expect(HAPTICS.bump).toEqual([10]);
  const total = (h: keyof typeof HAPTICS) => HAPTICS[h].reduce((a, b) => a + b, 0);
  for (const h of ['fail', 'won'] as const) {
    expect(total(h), h).toBeGreaterThan(100);
    expect(total(h), h).toBeLessThanOrEqual(300);
  }
  expect(HAPTICS.fail).not.toEqual(HAPTICS.won);
});

test('HapticFeed: walking into the same obstacle again does not vibrate again', () => {
  const s0 = initialState(fromAscii(['#####', '#@..#', '#####']));
  const wall = step(s0, 'left').events;
  const walk = step(s0, 'right').events;
  const feed = new HapticFeed();
  expect(feed.next(wall)).toBe('bump');
  expect(feed.next(wall)).toBeNull(); // held: the repeated attempts are silent
  expect(feed.next(wall)).toBeNull();
  expect(feed.next(walk)).toBeNull();
  expect(feed.next(wall)).toBe('bump'); // a new bump after a step
  feed.reset(); // a new press
  expect(feed.next(wall)).toBe('bump');
});

test('vibrate: calls navigator.vibrate when on, nothing when off or unsupported', () => {
  const calls: unknown[] = [];
  vi.stubGlobal('navigator', { vibrate: (p: unknown) => (calls.push(p), true) });
  expect(canVibrate()).toBe(true);
  vibrate('bump', true);
  vibrate('bump', false);
  vibrate(null, true);
  expect(calls).toEqual([[10]]);

  vi.stubGlobal('navigator', {}); // iOS Safari
  expect(canVibrate()).toBe(false);
  expect(() => vibrate('won', true)).not.toThrow();

  vi.stubGlobal('navigator', {
    vibrate: () => {
      throw new Error('blocked');
    },
  });
  expect(() => vibrate('won', true)).not.toThrow();
});
