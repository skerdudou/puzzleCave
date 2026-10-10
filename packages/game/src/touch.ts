export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

export function isTouchDevice(): boolean {
  if (typeof window === 'undefined') return false;
  if (typeof window.matchMedia === 'function')
    return window.matchMedia('(pointer: coarse)').matches;
  return navigator.maxTouchPoints > 0 || 'ontouchstart' in window;
}

export function isLandscape(viewW: number, viewH: number): boolean {
  return viewW > viewH;
}

/** D-pad in landscape: anchored to the right edge, vertically centered. */
export function dpadLayoutSide(
  viewW: number,
  viewH: number,
  size: number,
  margin: number,
): { up: Rect; down: Rect; left: Rect; right: Rect } {
  const cx = viewW - margin - 2 * size;
  const sq = (x: number, y: number): Rect => ({ x, y, w: size, h: size });
  return {
    up: sq(cx, viewH / 2 - 1.5 * size),
    left: sq(cx - size, viewH / 2 - 0.5 * size),
    right: sq(cx + size, viewH / 2 - 0.5 * size),
    down: sq(cx, viewH / 2 + 0.5 * size),
  };
}

export function dpadLayout(
  viewW: number,
  viewH: number,
  size: number,
): { up: Rect; down: Rect; left: Rect; right: Rect } {
  const cx = viewW / 2 - size / 2;
  const bottom = viewH - size / 2;
  const sq = (x: number, y: number): Rect => ({ x, y, w: size, h: size });
  return {
    up: sq(cx, bottom - 3 * size),
    left: sq(cx - size, bottom - 2 * size),
    right: sq(cx + size, bottom - 2 * size),
    down: sq(cx, bottom - size),
  };
}
