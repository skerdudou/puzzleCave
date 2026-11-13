import type { Dir } from '@puzzlecave/core';

export interface FrameRect {
  x: number;
  y: number;
  w: number;
  h: number;
  tone: 'fill' | 'light' | 'dark';
}

/**
 * The rectangles of a stepped, bevelled button frame in local coordinates: a `w×h` box with a
 * `u×u` notch left empty at each corner, a `u`-wide light edge along the top and left, a dark
 * one along the bottom and right (swapped when `pressed`), the rest fill. No two overlap.
 */
export function steppedFrame(w: number, h: number, u: number, pressed = false): FrameRect[] {
  const top = pressed ? 'dark' : 'light';
  const bottom = pressed ? 'light' : 'dark';
  const iw = w - 2 * u;
  const ih = h - 2 * u;
  return [
    { x: u, y: 0, w: iw, h: u, tone: top },
    { x: 0, y: u, w: u, h: ih, tone: top },
    { x: u, y: h - u, w: iw, h: u, tone: bottom },
    { x: w - u, y: u, w: u, h: ih, tone: bottom },
    { x: u, y: u, w: iw, h: ih, tone: 'fill' },
  ];
}

/** The 7×7 pixel icons of the HUD's Undo and Restart, a row per line ('#': filled). */
const ICONS = {
  // a hooked arrow pointing back (left), its tail curling down and back under it
  undo: ['..#....', '.#####.', '..#...#', '......#', '......#', '.....#.', '.####..'],
  // a circle open at the top right, its arrow head there
  restart: ['..###.#', '.#...##', '#...###', '#......', '#.....#', '.#...#.', '..###..'],
  // full screen: four corners pointing out; leaving it: four corners pointing in
  fullscreen: ['###.###', '#.....#', '#.....#', '.......', '#.....#', '#.....#', '###.###'],
  fullscreenExit: ['.#...#.', '.#...#.', '##...##', '.......', '##...##', '.#...#.', '.#...#.'],
} as const;

/** The filled [column, row] cells of a 7×7 HUD icon. */
export function iconPixels(icon: keyof typeof ICONS): [number, number][] {
  const cells: [number, number][] = [];
  ICONS[icon].forEach((line, r) => {
    for (let c = 0; c < line.length; c++) if (line[c] === '#') cells.push([c, r]);
  });
  return cells;
}

/** Rows of the up arrow on the 7×7 grid: [row, first column, last column]. */
const UP_ROWS: [number, number, number][] = [
  [1, 3, 3],
  [2, 2, 4],
  [3, 1, 5],
  [4, 0, 6],
];

/** The filled [column, row] cells of a 7×7 pixel arrow (the mock-up's d-pad glyphs). */
export function arrowPixels(dir: Dir): [number, number][] {
  const up: [number, number][] = [];
  for (const [r, a, b] of UP_ROWS) for (let c = a; c <= b; c++) up.push([c, r]);
  switch (dir) {
    case 'up':
      return up;
    case 'down':
      return up.map(([c, r]) => [c, 6 - r]);
    case 'left':
      return up.map(([c, r]) => [r, c]);
    case 'right':
      return up.map(([c, r]) => [6 - r, c]);
  }
}
