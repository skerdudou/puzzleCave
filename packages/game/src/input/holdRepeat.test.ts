import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import type { Dir } from '@puzzlecave/core';
import { HoldRepeat } from './holdRepeat';

let moves: Dir[];
let rate: number;
let h: HoldRepeat;
beforeEach(() => {
  vi.useFakeTimers();
  moves = [];
  rate = 10;
  h = new HoldRepeat(
    (d) => moves.push(d),
    () => rate,
  );
});
afterEach(() => vi.useRealTimers());

test('a press moves at once; a short press moves only once', () => {
  h.press(1, 'left');
  expect(moves).toEqual(['left']);
  vi.advanceTimersByTime(150);
  h.release(1);
  vi.advanceTimersByTime(2000);
  expect(moves).toEqual(['left']);
});

test('holding repeats at the key repeat rate after the initial delay', () => {
  h.press(1, 'up');
  vi.advanceTimersByTime(199);
  expect(moves).toHaveLength(1); // initial delay 200 ms at 10 moves/s
  vi.advanceTimersByTime(1);
  expect(moves).toHaveLength(2);
  vi.advanceTimersByTime(1000); // then 10 per second
  expect(moves).toHaveLength(12);
  h.release(1);
  vi.advanceTimersByTime(1000);
  expect(moves).toHaveLength(12);
  expect(new Set(moves)).toEqual(new Set(['up']));
});

test('the rate follows the setting (4 moves/s: first repeat after 250 ms)', () => {
  rate = 4;
  h.press(1, 'down');
  vi.advanceTimersByTime(249);
  expect(moves).toHaveLength(1);
  vi.advanceTimersByTime(1 + 250 * 4);
  expect(moves).toHaveLength(6);
});

test('stops when the finger is no longer on the button, even unheard', () => {
  let on = true;
  h.press(1, 'right', () => on);
  vi.advanceTimersByTime(250);
  expect(moves).toHaveLength(2);
  on = false; // slid off / cancelled without an event reaching the button
  vi.advanceTimersByTime(1000);
  expect(moves).toHaveLength(2);
  expect(h.holding).toBe(false);
});

test("another finger's release does not stop the repeat; the latest press wins", () => {
  h.press(1, 'right');
  h.release(2);
  vi.advanceTimersByTime(200);
  expect(moves).toEqual(['right', 'right']);
  h.press(2, 'up');
  vi.advanceTimersByTime(200);
  expect(moves).toEqual(['right', 'right', 'up', 'up']);
  h.release(1);
  vi.advanceTimersByTime(100);
  expect(moves.at(-1)).toBe('up');
  expect(moves).toHaveLength(5);
  h.reset();
  vi.advanceTimersByTime(1000);
  expect(moves).toHaveLength(5);
});
