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

type Pad = { up: Rect; down: Rect; left: Rect; right: Rect };

/**
 * Room added around the d-pad's 3 × 3 square for its touch area, in button sizes: a thumb that
 * lands just beside a button, or in a corner between two, still counts. The buttons drawn keep
 * their size.
 */
export const DPAD_REACH = 0.2;
/** No direction within this fraction of a button from the d-pad's centre. */
export const DPAD_DEAD = 0.25;

/**
 * The d-pad's touch area: the square around its four buttons, `reach` button sizes bigger on
 * each side, kept on the screen (`viewW` × `viewH`).
 */
export function dpadHitBox(pad: Pad, viewW: number, viewH: number, reach = DPAD_REACH): Rect {
  const m = reach * pad.up.w;
  const x = Math.max(0, pad.left.x - m);
  const y = Math.max(0, pad.up.y - m);
  const r = Math.min(viewW, pad.right.x + pad.right.w + m);
  const b = Math.min(viewH, pad.down.y + pad.down.h + m);
  return { x, y, w: r - x, h: b - y };
}

/**
 * The d-pad direction under (x, y): the touch area is cut in an X from the d-pad's centre into
 * four triangles, so the corners between the buttons count too, and a finger slid from one
 * button to the next changes direction. Null near the centre (`dead` button sizes), undefined
 * off the area.
 */
export function dpadDirAt(
  pad: Pad,
  hit: Rect,
  x: number,
  y: number,
  dead = DPAD_DEAD,
): 'up' | 'down' | 'left' | 'right' | null | undefined {
  if (x < hit.x || x >= hit.x + hit.w || y < hit.y || y >= hit.y + hit.h) return undefined;
  const size = pad.up.w;
  const dx = x - (pad.up.x + size / 2);
  const dy = y - (pad.left.y + size / 2);
  if (Math.hypot(dx, dy) < dead * size) return null;
  if (Math.abs(dx) > Math.abs(dy)) return dx > 0 ? 'right' : 'left';
  return dy > 0 ? 'down' : 'up';
}
