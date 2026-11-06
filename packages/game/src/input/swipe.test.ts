import { expect, test } from 'vitest';
import { DRAG_DEADZONE, SWIPE_MIN, dragOffset, swipeStep } from './swipe';

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

test('the page follows the finger: not in the dead zone, all of it past it, up to a page', () => {
  expect(dragOffset(DRAG_DEADZONE, 0, true, 200)).toBe(0);
  expect(dragOffset(DRAG_DEADZONE + 20, 0, true, 200)).toBe(20);
  expect(dragOffset(-(DRAG_DEADZONE + 20), 0, true, 200)).toBe(-20);
  expect(dragOffset(1000, 0, true, 200)).toBe(200);
  expect(dragOffset(-1000, 0, true, 200)).toBe(-200);
  expect(dragOffset(30, 40, true, 200)).toBe(0);
});

test('no chapter that way: the page barely moves (a rubber band)', () => {
  expect(dragOffset(DRAG_DEADZONE + 80, 0, false)).toBe(10);
  expect(dragOffset(1000, 0, false)).toBe(0.375 * SWIPE_MIN);
});
