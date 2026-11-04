import { expect, test } from 'vitest';
import { SWIPE_MIN, swipeStep } from './swipe';

test('a swipe to the left goes to the next chapter, to the right to the previous one', () => {
  expect(swipeStep(-80, 5)).toBe(1);
  expect(swipeStep(80, -5)).toBe(-1);
});

test('a tap, a short slide or a mostly vertical one: no swipe', () => {
  expect(swipeStep(0, 0)).toBe(0);
  expect(swipeStep(SWIPE_MIN - 1, 0)).toBe(0);
  expect(swipeStep(-SWIPE_MIN, 0)).toBe(1);
  expect(swipeStep(-80, 60)).toBe(0);
  expect(swipeStep(90, 59)).toBe(-1);
});
