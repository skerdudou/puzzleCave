import type { GameEvent } from '@puzzlecave/core';

/** Vibration patterns (ms on, off, on…): short ticks, longer and distinct for the outcomes. */
export const HAPTICS = {
  bump: [12],
  push: [25],
  fill: [40],
  key: [15, 40, 15],
  door: [35],
  drowned: [120, 60, 220],
  won: [30, 50, 30, 50, 90],
} as const satisfies Record<string, readonly number[]>;
export type Haptic = keyof typeof HAPTICS;

/**
 * The vibration for the events of one move, or null (a plain step: none). One per move: the
 * outcome first, then the strongest effect (a block sinking is also a push: it says "fill").
 * A move attempt that did not move the player (wall, stuck block, door without a key) is a bump.
 */
export function hapticFor(events: readonly GameEvent[]): Haptic | null {
  const has = (type: GameEvent['type']) => events.some((e) => e.type === type);
  if (has('won')) return 'won';
  if (has('drowned')) return 'drowned';
  if (has('doorOpened')) return 'door';
  if (has('keyPicked')) return 'key';
  if (has('blockSank')) return 'fill';
  if (has('pushed')) return 'push';
  if (!has('moved')) return 'bump';
  return null;
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
