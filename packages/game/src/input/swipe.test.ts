import { expect, test } from 'vitest';
import { swipeDir } from './swipe';

test.each([
  [40, 5, 'right'],
  [-40, 10, 'left'],
  [3, 50, 'down'],
  [0, -31, 'up'],
  [20, 20, null],
  [40, 40, null],
])('swipe (%i,%i) → %s', (dx, dy, dir) => {
  expect(swipeDir(dx, dy, 30)).toBe(dir);
});
