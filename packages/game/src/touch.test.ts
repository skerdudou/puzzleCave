import { expect, test } from 'vitest';
import { dpadDirAt, dpadHitBox, dpadLayout, dpadLayoutSide, isLandscape } from './touch';

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

test('d-pad touch area: the 3 × 3 square, a fifth of a button bigger, kept on the screen', () => {
  const d = dpadLayout(1000, 2000, 100);
  expect(dpadHitBox(d, 1000, 2000)).toEqual({ x: 330, y: 1630, w: 340, h: 340 });
  // at the screen's bottom edge: clipped
  expect(dpadHitBox(d, 1000, 1960)).toEqual({ x: 330, y: 1630, w: 340, h: 330 });
});

test('d-pad direction: an X from the centre, corners included; none at the centre or off', () => {
  const d = dpadLayout(1000, 2000, 100);
  const hit = dpadHitBox(d, 1000, 2000);
  // centre of the pad: (500, 1800)
  expect(dpadDirAt(d, hit, 500, 1660)).toBe('up');
  expect(dpadDirAt(d, hit, 640, 1800)).toBe('right');
  expect(dpadDirAt(d, hit, 360, 1800)).toBe('left');
  expect(dpadDirAt(d, hit, 500, 1940)).toBe('down');
  // the corners between two buttons: the nearest axis
  expect(dpadDirAt(d, hit, 620, 1690)).toBe('right');
  expect(dpadDirAt(d, hit, 590, 1680)).toBe('up');
  expect(dpadDirAt(d, hit, 510, 1805)).toBeNull();
  expect(dpadDirAt(d, hit, 200, 1800)).toBeUndefined();
});
