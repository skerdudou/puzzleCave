import type { GameEvent } from '@puzzlecave/core';

/**
 * Vibration patterns (ms on, off, on…). Only what the player may have missed: a move that did
 * not happen (bump), and the end of a run (won, or failed: drowned or out of time). Steps,
 * pushes, keys, doors and filled water are seen on the board and do not vibrate.
 */
export const HAPTICS = {
  bump: [10],
  fail: [80, 50, 120],
  won: [20, 40, 20, 40, 60],
} as const satisfies Record<string, readonly number[]>;
export type Haptic = keyof typeof HAPTICS;

/**
 * The vibration for the events of one move, or null (none). A move attempt that did not move
 * the player (wall, stuck block, door without a key, water in normal mode) is a bump.
 */
export function hapticFor(events: readonly GameEvent[]): Haptic | null {
  const has = (type: GameEvent['type']) => events.some((e) => e.type === type);
  if (has('won')) return 'won';
  if (has('drowned')) return 'fail';
  if (!has('moved')) return 'bump';
  return null;
}

/**
 * The haptics of successive move attempts: a bump vibrates only the first time, not again while
 * the player keeps walking into the same obstacle (a held key, d-pad or tap zone repeats it
 * ten times a second).
 */
export class HapticFeed {
  private bumping = false;

  next(events: readonly GameEvent[]): Haptic | null {
    const h = hapticFor(events);
    const repeat = h === 'bump' && this.bumping;
    this.bumping = h === 'bump';
    return repeat ? null : h;
  }

  reset(): void {
    this.bumping = false;
  }
}

type Vibrate = (pattern: number | number[]) => boolean;

/** navigator.vibrate when the browser has it (not iOS Safari, not most desktops' effect). */
function vibrateFn(): Vibrate | null {
  const nav = typeof navigator === 'undefined' ? undefined : navigator;
  const fn = (nav as { vibrate?: Vibrate } | undefined)?.vibrate;
  return typeof fn === 'function' ? fn.bind(nav) : null;
}

export function canVibrate(): boolean {
  return vibrateFn() !== null;
}

/** Plays `h` if vibrations are supported and on; fails silently otherwise. */
export function vibrate(h: Haptic | null, enabled: boolean): void {
  if (!h || !enabled) return;
  try {
    vibrateFn()?.([...HAPTICS[h]]);
  } catch {
    /* refused (no user activation yet, policy…): no vibration */
  }
}
