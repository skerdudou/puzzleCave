import { describe, expect, test } from 'vitest';
import {
  boundsOf,
  centreOf,
  isTouchControl,
  nextTouchControl,
  zoneArea,
  zoneAt,
  zoneDir,
  zonePolygon,
} from './tapZones';

describe('zoneDir', () => {
  test('the four triangles of the X', () => {
    expect(zoneDir(0, -100)).toBe('up');
    expect(zoneDir(0, 100)).toBe('down');
    expect(zoneDir(-100, 0)).toBe('left');
    expect(zoneDir(100, 0)).toBe('right');
    // well inside a triangle, off its axis
    expect(zoneDir(100, -50)).toBe('right');
    expect(zoneDir(-30, 90)).toBe('down');
  });

  test('nothing on or near a diagonal (10° on each side), something just beyond', () => {
    for (const [sx, sy] of [
      [1, 1],
      [1, -1],
      [-1, 1],
      [-1, -1],
    ] as const) {
      expect(zoneDir(100 * sx, 100 * sy)).toBeNull();
      // 36° from the axis: 9° from the diagonal
      const a = (36 * Math.PI) / 180;
      expect(zoneDir(100 * Math.cos(a) * sx, 100 * Math.sin(a) * sy)).toBeNull();
      // 34° from the axis: 11° from the diagonal
      const b = (34 * Math.PI) / 180;
      expect(zoneDir(100 * Math.cos(b) * sx, 100 * Math.sin(b) * sy)).toBe(
        sx > 0 ? 'right' : 'left',
      );
      expect(zoneDir(100 * Math.sin(b) * sx, 100 * Math.cos(b) * sy)).toBe(sy > 0 ? 'down' : 'up');
    }
  });

  test('nothing in the dead circle at the centre', () => {
    expect(zoneDir(0, 0)).toBeNull();
    expect(zoneDir(15, 0)).toBeNull();
    expect(zoneDir(0, -15.9)).toBeNull();
    expect(zoneDir(16, 0)).toBe('right');
    expect(zoneDir(5, 5, 4)).toBeNull(); // diagonal, out of the circle
    expect(zoneDir(NaN, 3)).toBeNull();
  });

  test('modes', () => {
    expect(nextTouchControl('drag')).toBe('tap');
    expect(nextTouchControl('tap')).toBe('drag');
    expect(isTouchControl('tap')).toBe(true);
    expect(isTouchControl('drag')).toBe(true);
    expect(isTouchControl('player')).toBe(false);
    expect(isTouchControl(undefined)).toBe(false);
  });
});

describe('zoneArea: the play area without the header, the d-pad and their margins', () => {
  // a 360×740 phone in portrait: header down to y = 76, d-pad 168×168 at the bottom centre
  const portraitPad = { x: 96, y: 544, w: 168, h: 168 };

  test('portrait: below the header and above the d-pad, 24 px from both, full width', () => {
    expect(zoneArea(360, 740, 76, { box: portraitPad, side: false })).toEqual({
      x: 0,
      y: 100,
      w: 360,
      h: 544 - 24 - 100,
    });
  });

  test('landscape: below the header and left of the d-pad column, full height', () => {
    // 740×360: d-pad column at the right, vertically centred
    const pad = { x: 740 - 16 - 168, y: 96, w: 168, h: 168 };
    expect(zoneArea(740, 360, 48, { box: pad, side: true })).toEqual({
      x: 0,
      y: 72,
      w: 740 - 16 - 168 - 24,
      h: 360 - 72,
    });
  });

  test('without a d-pad: down to the given bottom; another margin', () => {
    expect(zoneArea(1000, 800, 52, null, 10, 776)).toEqual({ x: 0, y: 62, w: 1000, h: 714 });
  });

  test('no room left: null', () => {
    expect(zoneArea(360, 200, 76, { box: { x: 96, y: 90, w: 168, h: 100 }, side: false })).toBe(
      null,
    );
    expect(zoneArea(200, 360, 48, { box: { x: 10, y: 96, w: 168, h: 168 }, side: true })).toBe(
      null,
    );
  });

  test('boundsOf and centreOf', () => {
    const b = boundsOf([
      { x: 10, y: 20, w: 5, h: 5 },
      { x: 0, y: 30, w: 4, h: 10 },
    ]);
    expect(b).toEqual({ x: 0, y: 20, w: 15, h: 20 });
    expect(centreOf(b)).toEqual([7.5, 30]);
  });
});

describe('zoneAt: the X centred on the area, nothing outside it', () => {
  const area = { x: 0, y: 100, w: 360, h: 420 }; // centre (180, 310)

  test('the four triangles around the centre of the area', () => {
    expect(zoneAt(180, 150, area)).toBe('up');
    expect(zoneAt(180, 480, area)).toBe('down');
    expect(zoneAt(30, 310, area)).toBe('left');
    expect(zoneAt(330, 320, area)).toBe('right');
    expect(zoneAt(185, 305, area)).toBeNull(); // the dead circle
    expect(zoneAt(280, 410, area)).toBeNull(); // a diagonal
  });

  test('the header, the d-pad and their margins are outside: nothing', () => {
    expect(zoneAt(180, 99, area)).toBeNull(); // above the area (header margin)
    expect(zoneAt(180, 100, area)).toBe('up'); // its edge
    expect(zoneAt(180, 521, area)).toBeNull(); // below (d-pad margin)
    expect(zoneAt(180, 600, area)).toBeNull(); // on the d-pad
    expect(zoneAt(180, 300, null)).toBeNull(); // no area
  });
});

describe('zonePolygon: the triangle of a zone, clipped to the area', () => {
  const area = { x: 0, y: 100, w: 360, h: 420 }; // centre (180, 310)
  const within = (pts: [number, number][]) =>
    pts.every(
      ([x, y]) =>
        x >= area.x - 1e-9 &&
        x <= area.x + area.w + 1e-9 &&
        y >= area.y - 1e-9 &&
        y <= area.y + area.h + 1e-9,
    );
  const round = (pts: [number, number][]): [number, number][] =>
    pts.map(([x, y]) => [Math.round(x * 1000) / 1000, Math.round(y * 1000) / 1000]);

  test('every zone stays inside the area and starts at its centre', () => {
    for (const d of ['up', 'down', 'left', 'right'] as const) {
      const pts = zonePolygon(d, area);
      expect(within(pts), d).toBe(true);
      expect(round(pts)).toContainEqual([180, 310]);
    }
  });

  test('up: the centre and the top corners (the diagonals reach the top edge inside it)', () => {
    // from (180, 310), the diagonals meet the top edge (y = 100) at x = -30 and 390: clipped
    // to the sides, they leave the area at (0, 130) and (360, 130)
    expect(round(zonePolygon('up', area)).sort()).toEqual(
      [
        [180, 310],
        [0, 130],
        [0, 100],
        [360, 100],
        [360, 130],
      ].sort(),
    );
  });

  test('down: the bottom edge, never below it (the d-pad side)', () => {
    const pts = round(zonePolygon('down', area));
    expect(Math.max(...pts.map(([, y]) => y))).toBe(520);
    // 210 px from the centre to the bottom: the diagonals meet it at x = -30 and 390, so the
    // zone runs to the side edges
    expect(pts.sort()).toEqual(
      [
        [180, 310],
        [0, 490],
        [0, 520],
        [360, 520],
        [360, 490],
      ].sort(),
    );
  });

  test('left in a wide area: a plain triangle cut by the top and bottom edges', () => {
    const wide = { x: 0, y: 50, w: 600, h: 200 }; // centre (300, 150)
    expect(round(zonePolygon('left', wide)).sort()).toEqual(
      [
        [300, 150],
        [200, 50],
        [0, 50],
        [0, 250],
        [200, 250],
      ].sort(),
    );
  });
});
