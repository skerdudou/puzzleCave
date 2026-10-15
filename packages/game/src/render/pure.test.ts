import { expect, test } from 'vitest';
import { AnimClock } from './animTiming';
import { wallMask, wallTexture } from './autotile';
import { boardLayout, fractionalZoom } from './layout';

test('AnimClock : min(100 ms, intervalle)', () => {
  const a = new AnimClock();
  expect(a.next(1000)).toBe(100);
  expect(a.next(1040)).toBe(40);
  expect(a.next(1300)).toBe(100);
  a.reset();
  expect(a.next(1301)).toBe(100);
});

test('wallTexture : ordre N, O, E, S', () => {
  expect(wallTexture(0)).toBe('WALL');
  expect(wallTexture(1 | 4)).toBe('WALL_NE');
  expect(wallTexture(15)).toBe('WALL_NWES');
  expect(wallTexture(2 | 8)).toBe('WALL_WS');
});

test('wallMask : voisins murs', () => {
  const grid = ['##.', '#..'];
  const isWall = (x: number, y: number) => grid[y]?.[x] === '#';
  expect(wallMask(isWall, 0, 0)).toBe(4 | 8);
  expect(wallMask(isWall, 1, 0)).toBe(2);
});

test('boardLayout: small levels are not zoomed beyond a 12×12 board', () => {
  // a 12×12 board fits 1080/192 = 5.6 → 5; a 6×5 board alone would fit 11 → capped at 5
  expect(boardLayout(1080, 2000, 6, 5, 16, 100, 100).scale).toBe(5);
  // big levels are unaffected: 18×18 still gets 3
  expect(boardLayout(1080, 2000, 18, 18, 16, 100, 100).scale).toBe(3);
  // the cap never drops below 1
  expect(boardLayout(100, 100, 6, 5, 16, 0, 0).scale).toBe(1);
});

test('boardLayout: integer factor, centered, at least 1', () => {
  // available height 1800; min(1080/288, 1800/288) = 3.75 → 3; 864 px; x = 108; y = 100 + 468
  expect(boardLayout(1080, 2000, 18, 18, 16, 100, 100)).toEqual({
    scale: 3,
    x: 108,
    y: 568,
    width: 864,
    height: 864,
  });
  expect(boardLayout(100, 100, 18, 18, 16, 0, 0).scale).toBe(1);
});

test('boardLayout fractional: fills the space, whole device pixels per cell', () => {
  // 1080/18 = 60 px per cell (zoom 3.75) instead of 48: the board takes the whole width
  expect(boardLayout(1080, 2000, 18, 18, 16, 100, 100, true)).toEqual({
    scale: 3.75,
    x: 0,
    y: 460,
    width: 1080,
    height: 1080,
  });
  // 1080/17 = 63.5 → 63 px per cell: never a fraction of a device pixel
  const l = boardLayout(1080, 2000, 17, 17, 16, 100, 100, true);
  expect(l.width).toBe(17 * 63);
  expect(l.scale * 16).toBe(63);
  // the 12-cell cap still holds: 1080/12 = 90 px per cell for a small level
  expect(boardLayout(1080, 2000, 6, 5, 16, 100, 100, true).scale * 16).toBe(90);
  // limited by the height: (1000 - 200)/20 = 40 px per cell
  expect(boardLayout(1080, 1000, 10, 20, 16, 100, 100, true).scale * 16).toBe(40);
});

test('fractionalZoom: from 2 device pixels per CSS pixel', () => {
  expect(fractionalZoom(1)).toBe(false);
  expect(fractionalZoom(1.5)).toBe(false);
  expect(fractionalZoom(2)).toBe(true);
  expect(fractionalZoom(3)).toBe(true);
});
