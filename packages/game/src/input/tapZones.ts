import type { Dir } from '@puzzlecave/core';

/**
 * Touch control: a continuous drag anywhere on the play area, or tap zones (the play area cut
 * in an X into four triangles). The d-pad works with both.
 */
export const TOUCH_CONTROLS = ['drag', 'tap'] as const;
export type TouchControl = (typeof TOUCH_CONTROLS)[number];

export const isTouchControl = (v: unknown): v is TouchControl =>
  (TOUCH_CONTROLS as readonly unknown[]).includes(v);

/** The other mode, for the button that switches between them. */
export function nextTouchControl(m: TouchControl): TouchControl {
  return m === 'drag' ? 'tap' : 'drag';
}

/** No direction this close to the centre (CSS px): too ambiguous. */
export const ZONE_DEAD_RADIUS = 16;
/** No direction this close to a diagonal (degrees, on each side of it). */
export const ZONE_DIAGONAL_BAND = 10;
/**
 * Room kept between the tap zones and the header or the d-pad (CSS px): a finger that just
 * missed Undo or a d-pad button must do nothing rather than walk.
 */
export const ZONE_MARGIN = 24;

export interface Box {
  x: number;
  y: number;
  w: number;
  h: number;
}

/**
 * The area of the tap zones, CSS px: the screen below the header and away from the d-pad (under
 * it in portrait, a column on the right in landscape), `margin` px from both. `bottom` is the
 * lowest y it may reach without a d-pad (above the keyboard help). Null when nothing is left.
 */
export function zoneArea(
  viewW: number,
  viewH: number,
  headerBottom: number,
  dpad: { box: Box; side: boolean } | null,
  margin = ZONE_MARGIN,
  bottom = viewH,
): Box | null {
  const top = headerBottom + margin;
  let right = viewW;
  let low = bottom;
  if (dpad?.side) right = dpad.box.x - margin;
  else if (dpad) low = dpad.box.y - margin;
  if (right <= 0 || low <= top) return null;
  return { x: 0, y: top, w: right, h: low - top };
}

/** The centre of a box. */
export const centreOf = (b: Box): [number, number] => [b.x + b.w / 2, b.y + b.h / 2];

/** The smallest box around all of them. */
export function boundsOf(boxes: readonly Box[]): Box {
  const x = Math.min(...boxes.map((b) => b.x));
  const y = Math.min(...boxes.map((b) => b.y));
  const r = Math.max(...boxes.map((b) => b.x + b.w));
  const b = Math.max(...boxes.map((o) => o.y + o.h));
  return { x, y, w: r - x, h: b - y };
}

const inside = (x: number, y: number, b: Box) =>
  x >= b.x && x <= b.x + b.w && y >= b.y && y <= b.y + b.h;

/**
 * The direction of a point seen from the centre of the zones, (dx, dy) in CSS px (y down): the
 * play area is cut in an X into four triangles (up, down, left, right). Nothing within
 * `dead` px of the centre, nor within `band` degrees of a diagonal, where a finger could mean
 * either of two directions.
 */
export function zoneDir(
  dx: number,
  dy: number,
  dead = ZONE_DEAD_RADIUS,
  band = ZONE_DIAGONAL_BAND,
): Dir | null {
  if (!Number.isFinite(dx) || !Number.isFinite(dy) || Math.hypot(dx, dy) < dead) return null;
  const ax = Math.abs(dx);
  const ay = Math.abs(dy);
  // angle from the nearest axis, 0..45°: 45° is the diagonal
  const fromAxis = (Math.atan2(Math.min(ax, ay), Math.max(ax, ay)) * 180) / Math.PI;
  if (fromAxis > 45 - band) return null;
  if (ax > ay) return dx > 0 ? 'right' : 'left';
  return dy > 0 ? 'down' : 'up';
}

/** The zone under (x, y), CSS px: none outside the area (header, d-pad, their margins). */
export function zoneAt(x: number, y: number, area: Box | null): Dir | null {
  if (!area || !inside(x, y, area)) return null;
  const [cx, cy] = centreOf(area);
  return zoneDir(x - cx, y - cy);
}

type Pt = [number, number];
const FAR: Record<Dir, [Pt, Pt]> = {
  up: [
    [-1, -1],
    [1, -1],
  ],
  down: [
    [-1, 1],
    [1, 1],
  ],
  left: [
    [-1, -1],
    [-1, 1],
  ],
  right: [
    [1, -1],
    [1, 1],
  ],
};

/**
 * The triangle of `dir` (from the centre of the area, along the diagonals), clipped to the
 * area: the polygon to light up under a finger, never over the header or the d-pad.
 */
export function zonePolygon(dir: Dir, area: Box): Pt[] {
  const [cx, cy] = centreOf(area);
  const L = 2 * (area.w + area.h);
  const [a, b] = FAR[dir];
  let poly: Pt[] = [
    [cx, cy],
    [cx + L * a[0], cy + L * a[1]],
    [cx + L * b[0], cy + L * b[1]],
  ];
  // Sutherland–Hodgman against the four sides of the area
  const edges: [(p: Pt) => number, number][] = [
    [(p) => p[0], area.x],
    [(p) => -p[0], -(area.x + area.w)],
    [(p) => p[1], area.y],
    [(p) => -p[1], -(area.y + area.h)],
  ];
  for (const [f, lim] of edges) {
    const out: Pt[] = [];
    for (let i = 0; i < poly.length; i++) {
      const p = poly[i]!;
      const q = poly[(i + 1) % poly.length]!;
      const pin = f(p) >= lim;
      const qin = f(q) >= lim;
      if (pin) out.push(p);
      if (pin !== qin) {
        const t = (lim - f(p)) / (f(q) - f(p));
        out.push([p[0] + t * (q[0] - p[0]), p[1] + t * (q[1] - p[1])]);
      }
    }
    poly = out;
  }
  return poly;
}
