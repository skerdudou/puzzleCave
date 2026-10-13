import { afterEach, expect, test, vi } from 'vitest';
import { step, fromAscii, initialState, type Dir, type GameEvent } from '@puzzlecave/core';
import { HAPTICS, canVibrate, hapticFor, vibrate } from './haptics';

afterEach(() => vi.unstubAllGlobals());

/** the haptic of one move from the start of a small map (normal or master mode) */
function after(rows: string[], dir: Dir, mode: 'normal' | 'master' = 'normal', keys = 0) {
  const level = fromAscii(rows, { initialKeys: keys });
  return hapticFor(step(initialState(level, mode), dir).events);
}

test('which move gives which vibration', () => {
  expect(after(['#####', '#@..#', '#####'], 'right')).toBeNull(); // a plain step
  expect(after(['#####', '#@..#', '#####'], 'left')).toBe('bump'); // wall
  expect(after(['#####', '#@..#', '#####'], 'up')).toBe('bump'); // turning into a wall
  expect(after(['######', '#@B..#', '######'], 'right')).toBe('push');
  expect(after(['######', '#@B#.#', '######'], 'right')).toBe('bump'); // stuck block
  expect(after(['######', '#@B~.#', '######'], 'right')).toBe('fill');
  expect(after(['#####', '#@k.#', '#####'], 'right')).toBe('key');
  expect(after(['#####', '#@D.#', '#####'], 'right', 'normal', 1)).toBe('door');
  expect(after(['#####', '#@D.#', '#####'], 'right')).toBe('bump'); // door, no key
  expect(after(['#####', '#@~.#', '#####'], 'right')).toBe('bump'); // water, normal mode
  expect(after(['#####', '#@~.#', '#####'], 'right', 'master')).toBe('drowned');
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

test('patterns: short ticks, longer outcomes', () => {
  for (const h of ['bump', 'push', 'fill', 'key', 'door'] as const) {
    for (const ms of HAPTICS[h]) {
      expect(ms, h).toBeGreaterThanOrEqual(10);
      expect(ms, h).toBeLessThanOrEqual(40);
    }
  }
  const total = (h: keyof typeof HAPTICS) => HAPTICS[h].reduce((a, b) => a + b, 0);
  expect(total('drowned')).toBeGreaterThan(200);
  expect(total('won')).toBeGreaterThan(200);
  expect(HAPTICS.drowned).not.toEqual(HAPTICS.won);
});

test('vibrate: calls navigator.vibrate when on, nothing when off or unsupported', () => {
  const calls: unknown[] = [];
  vi.stubGlobal('navigator', { vibrate: (p: unknown) => (calls.push(p), true) });
  expect(canVibrate()).toBe(true);
  vibrate('push', true);
  vibrate('push', false);
  vibrate(null, true);
  expect(calls).toEqual([[25]]);

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
