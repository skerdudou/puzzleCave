import type { Dir } from '@puzzlecave/core';

/** Distances per step offered in Options (CSS pixels), from very sensitive to slow. */
export const DRAG_STEPS = [16, 20, 24, 32, 40, 48, 56, 64, 80] as const;
/**
 * 40 px (about 6 mm on a phone, a fingertip's width): a finger resting or rolling on the glass
 * does not walk, and a full-width swipe on a 360 px phone still walks 9 cells. 24 px (the old
 * default) proved too sensitive in play: short corrections took an extra step.
 */
export const DRAG_STEP_DEFAULT = 40;
/** The default of saves written before `dragStepDefault` existed. */
export const OLD_DRAG_STEP_DEFAULT = 24;

/** The offered distance closest to `v`. */
export function nearestDragStep(v: number): number {
  return DRAG_STEPS.reduce((best, s) => (Math.abs(s - v) < Math.abs(best - v) ? s : best));
}

/** One offered distance more (+1) or less (−1) than `v`, kept within the offered ones. */
export function shiftDragStep(v: number, by: 1 | -1): number {
  const i = DRAG_STEPS.indexOf(nearestDragStep(v) as (typeof DRAG_STEPS)[number]);
  return DRAG_STEPS[Math.min(DRAG_STEPS.length - 1, Math.max(0, i + by))]!;
}

const OPPOSITE: Record<Dir, Dir> = { up: 'down', down: 'up', left: 'right', right: 'left' };
const horizontal = (d: Dir) => d === 'left' || d === 'right';
/** +1 for right/down (growing coordinates), −1 for left/up */
const sign = (d: Dir) => (d === 'right' || d === 'down' ? 1 : -1);
const dirOf = (axisX: boolean, s: number): Dir =>
  axisX ? (s > 0 ? 'right' : 'left') : s > 0 ? 'down' : 'up';

/**
 * Continuous drag: the finger stays on the screen and every `step` pixels travelled along an
 * axis emit one move in that direction, so a long drag walks several cells and the player can
 * steer (drag right, then up…).
 *
 * Measured from an anchor: along the axis of the last move, the anchor is where that step was
 * reached (the remainder is kept, so a fast drag loses no step); across it, the anchor follows
 * the finger at each step, so a slightly slanted drag never drifts into a perpendicular move.
 * Hysteresis: turning needs the perpendicular travel to clearly beat the travel along the
 * current axis (× `hysteresis`), so diagonal jitter does not alternate directions. Going back
 * is measured from the farthest point reached, so reversing costs one step, not two.
 */
export class DragSteps {
  private readonly step: number;
  private readonly hysteresis: number;
  private ax: number;
  private ay: number;
  private last: Dir | null = null;
  /** farthest progress beyond the anchor in the direction of the last move (≥ 0) */
  private peak = 0;

  constructor(x: number, y: number, step: number, hysteresis = 1.3) {
    this.ax = x;
    this.ay = y;
    this.step = Math.max(1, step);
    this.hysteresis = hysteresis;
  }

  /** The moves the finger has earned by reaching (x, y), in order (often none). */
  move(x: number, y: number): Dir[] {
    const out: Dir[] = [];
    for (let guard = 0; guard < 1000; guard++) {
      const d = this.next(x, y);
      if (!d) break;
      out.push(d);
    }
    return out;
  }

  private next(x: number, y: number): Dir | null {
    const step = this.step;
    const dx = x - this.ax;
    const dy = y - this.ay;
    const last = this.last;
    if (!last) {
      const ax = Math.abs(dx);
      const ay = Math.abs(dy);
      if (Math.max(ax, ay) < step || ax === ay) return null;
      const axisX = ax > ay;
      const d = dirOf(axisX, axisX ? dx : dy);
      this.emit(d, x, y, Math.max(ax, ay) - step);
      return d;
    }
    const axisX = horizontal(last);
    const along = axisX ? dx : dy;
    const across = axisX ? dy : dx;
    const progress = sign(last) * along;
    this.peak = Math.max(this.peak, progress);
    const forward = Math.max(0, progress);
    const back = this.peak - progress;
    const side = Math.abs(across);
    if (side >= step && side > this.hysteresis * Math.max(forward, back)) {
      const d = dirOf(!axisX, across);
      this.emit(d, x, y, side - step);
      return d;
    }
    if (forward >= step) {
      // same direction: the anchor moves one step on, the remainder stays
      if (axisX) this.ax += sign(last) * step;
      else this.ay += sign(last) * step;
      this.peak -= step;
      if (axisX) this.ay = y;
      else this.ax = x;
      return last;
    }
    if (back >= step) {
      // reversal: measured from the farthest point reached
      const d = OPPOSITE[last];
      const at = sign(last) * (this.peak - step);
      if (axisX) this.ax += at;
      else this.ay += at;
      this.last = d;
      this.peak = back - step;
      if (axisX) this.ay = y;
      else this.ax = x;
      return d;
    }
    return null;
  }

  /** a move along a new axis: anchored one step on along it, at the finger across it */
  private emit(d: Dir, x: number, y: number, rest: number): void {
    if (horizontal(d)) {
      this.ax += sign(d) * this.step;
      this.ay = y;
    } else {
      this.ay += sign(d) * this.step;
      this.ax = x;
    }
    this.last = d;
    this.peak = rest;
  }
}
