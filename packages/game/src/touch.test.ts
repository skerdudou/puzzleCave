import { expect, test } from 'vitest';
import { dpadLayout, dpadLayoutSide, isLandscape } from './touch';

test('d-pad centered at the bottom of the screen', () => {
  // bottom of the d-pad = 2000 − 50 = 1950; center column x = 500 − 50 = 450
  const d = dpadLayout(1000, 2000, 100);
  expect(d.up).toEqual({ x: 450, y: 1650, w: 100, h: 100 });
  expect(d.left).toEqual({ x: 350, y: 1750, w: 100, h: 100 });
  expect(d.right).toEqual({ x: 550, y: 1750, w: 100, h: 100 });
  expect(d.down).toEqual({ x: 450, y: 1850, w: 100, h: 100 });
});

test('side d-pad anchored right, vertically centered', () => {
  const d = dpadLayoutSide(2000, 1000, 100, 50);
  expect(d.right).toEqual({ x: 1850, y: 450, w: 100, h: 100 });
  expect(d.up).toEqual({ x: 1750, y: 350, w: 100, h: 100 });
  expect(d.left).toEqual({ x: 1650, y: 450, w: 100, h: 100 });
  expect(d.down).toEqual({ x: 1750, y: 550, w: 100, h: 100 });
});

test('isLandscape : width strictly greater than height', () => {
  expect(isLandscape(2000, 1000)).toBe(true);
  expect(isLandscape(1000, 1000)).toBe(false);
  expect(isLandscape(1000, 2000)).toBe(false);
});
