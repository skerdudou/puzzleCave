import type { Dir } from '@puzzlecave/core';
import { repeatDelays } from './InputController';

/** Optional tap zones: off, around the centre of the play area, or around the player. */
export const TAP_ZONE_MODES = ['off', 'screen', 'player'] as const;
export type TapZoneMode = (typeof TAP_ZONE_MODES)[number];

export const isTapZoneMode = (v: unknown): v is TapZoneMode =>
  (TAP_ZONE_MODES as readonly unknown[]).includes(v);

/** The next mode, for a button that cycles through them. */
export function nextTapZoneMode(m: TapZoneMode): TapZoneMode {
  return TAP_ZONE_MODES[(TAP_ZONE_MODES.indexOf(m) + 1) % TAP_ZONE_MODES.length]!;
}

/** No direction this close to the centre (CSS px): too ambiguous. */
export const ZONE_DEAD_RADIUS = 16;
/** No direction this close to a diagonal (degrees, on each side of it). */
export const ZONE_DIAGONAL_BAND = 10;
/** A finger that travels more than this (CSS px) from where it went down is dragging. */
export const TAP_SLOP = 10;

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

export interface Timers {
  set(fn: () => void, ms: number): unknown;
  clear(handle: unknown): void;
}
const realTimers: Timers = {
  set: (fn, ms) => setTimeout(fn, ms),
  clear: (h) => clearTimeout(h as ReturnType<typeof setTimeout>),
};

/**
 * One finger on a tap zone, from touch-down to release: a tap, a hold or a drag.
 *
 * The move of a tap is emitted on RELEASE, not on touch-down: a finger that goes down could
 * still start a drag, and a move emitted at once could not be taken back (the drag would then
 * add its own moves). So:
 * - released without having travelled more than `slop` px: a tap, one move (latency: the time
 *   the finger stays on the glass, ~100 ms for a quick tap);
 * - still down and still after the hold delay (the d-pad's first repeat delay, `repeatDelays`):
 *   one move then, then one per repeat interval, until lifted, cancelled or moved away (more
 *   than `slop` px: the repeat stops, and the gesture makes nothing more, not even a drag);
 * - travelled more than `slop` px before that: a drag, the zone emits nothing (`move` returns
 *   true: the caller's DragSteps takes over; `slop` is below the drag step, so the drag has
 *   not moved yet).
 */
export class ZoneGesture {
  private state: 'pending' | 'holding' | 'drag' | 'over' = 'pending';
  private timer: unknown = null;

  constructor(
    readonly dir: Dir,
    private readonly x: number,
    private readonly y: number,
    private readonly emit: (d: Dir) => void,
    private readonly rate: () => number,
    private readonly slop = TAP_SLOP,
    private readonly timers: Timers = realTimers,
  ) {
    this.schedule(repeatDelays(rate()).initial);
  }

  /** The finger is at (x, y): true when the gesture is a drag (the caller drags). */
  move(x: number, y: number): boolean {
    if (this.state === 'drag') return true;
    if (this.state === 'over' || Math.hypot(x - this.x, y - this.y) <= this.slop) return false;
    const wasPending = this.state === 'pending';
    this.stop();
    this.state = wasPending ? 'drag' : 'over';
    return wasPending;
  }

  /** Lifted: a tap if nothing else happened. */
  release(): void {
    const tap = this.state === 'pending';
    this.stop();
    this.state = 'over';
    if (tap) this.emit(this.dir);
  }

  /** Cancelled (touchcancel, scene left, another finger): nothing more. */
  cancel(): void {
    this.stop();
    this.state = 'over';
  }

  get dragging(): boolean {
    return this.state === 'drag';
  }

  private stop(): void {
    if (this.timer !== null) this.timers.clear(this.timer);
    this.timer = null;
  }

  private schedule(ms: number): void {
    this.timer = this.timers.set(() => {
      this.timer = null;
      if (this.state !== 'pending' && this.state !== 'holding') return;
      this.state = 'holding';
      this.emit(this.dir);
      this.schedule(repeatDelays(this.rate()).interval);
    }, ms);
  }
}
