import { expect, test } from 'vitest';
import { arrowPixels, iconPixels, steppedFrame } from './frame';

test('steppedFrame: corners empty, every other pixel covered once', () => {
  const w = 20;
  const h = 10;
  const u = 2;
  const count = new Map<string, number>();
  for (const r of steppedFrame(w, h, u))
    for (let x = r.x; x < r.x + r.w; x++)
      for (let y = r.y; y < r.y + r.h; y++)
        count.set(`${x},${y}`, (count.get(`${x},${y}`) ?? 0) + 1);
  const corner = (x: number, y: number) => (x < u || x >= w - u) && (y < u || y >= h - u);
  for (let x = 0; x < w; x++)
    for (let y = 0; y < h; y++) expect(count.get(`${x},${y}`) ?? 0).toBe(corner(x, y) ? 0 : 1);
});

test('steppedFrame: light on top/left, dark on bottom/right, swapped when pressed', () => {
  const tones = (pressed: boolean) => {
    const rs = steppedFrame(20, 10, 2, pressed);
    return {
      top: rs.filter((r) => r.y === 0).map((r) => r.tone),
      bottom: rs.filter((r) => r.y + r.h === 10).map((r) => r.tone),
      left: rs.filter((r) => r.x === 0).map((r) => r.tone),
      right: rs.filter((r) => r.x + r.w === 20).map((r) => r.tone),
    };
  };
  expect(tones(false)).toEqual({
    top: ['light'],
    bottom: ['dark'],
    left: ['light'],
    right: ['dark'],
  });
  expect(tones(true)).toEqual({
    top: ['dark'],
    bottom: ['light'],
    left: ['dark'],
    right: ['light'],
  });
});

test('arrowPixels: up arrow, mirrors and transposes', () => {
  const up = arrowPixels('up');
  const key = (c: [number, number][]) => c.map((p) => p.join()).sort();
  expect(up).toHaveLength(16);
  expect(up).toContainEqual([3, 1]);
  expect(key(up)).toEqual(key(up.map(([c, r]) => [6 - c, r])));
  expect(key(arrowPixels('down'))).toEqual(key(up.map(([c, r]) => [c, 6 - r])));
  expect(key(arrowPixels('left'))).toEqual(key(up.map(([c, r]) => [r, c])));
  expect(key(arrowPixels('right'))).toEqual(key(arrowPixels('down').map(([c, r]) => [r, c])));
});

test('iconPixels: undo and restart on the 7×7 grid, two different shapes', () => {
  const key = (c: [number, number][]) => c.map((p) => p.join()).sort();
  for (const icon of ['undo', 'restart'] as const) {
    const cells = iconPixels(icon);
    expect(cells.length).toBeGreaterThan(10);
    for (const [c, r] of cells) {
      expect(c).toBeGreaterThanOrEqual(0);
      expect(c).toBeLessThan(7);
      expect(r).toBeGreaterThanOrEqual(0);
      expect(r).toBeLessThan(7);
    }
  }
  expect(key(iconPixels('undo'))).not.toEqual(key(iconPixels('restart')));
});
