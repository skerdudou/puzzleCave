import type { Dir } from '@puzzlecave/core';

export type Action =
  { type: 'move'; dir: Dir } | { type: 'undo' } | { type: 'restart' } | { type: 'menu' };
export interface KeyLike {
  code: string;
  key: string;
  repeat: boolean;
  ctrlKey?: boolean;
  metaKey?: boolean;
  altKey?: boolean;
}

const CODE_DIRS: Record<string, Dir> = {
  ArrowUp: 'up',
  ArrowDown: 'down',
  ArrowLeft: 'left',
  ArrowRight: 'right',
  KeyW: 'up',
  KeyS: 'down',
  KeyA: 'left',
  KeyD: 'right',
};

// clamped rate: a non-finite or out-of-range value must never produce a zero or negative delay
const RATE_MIN = 4;
const RATE_MAX = 20;
const RATE_DEFAULT = 10;
function clampRate(r: number): number {
  return Number.isFinite(r) ? Math.min(RATE_MAX, Math.max(RATE_MIN, r)) : RATE_DEFAULT;
}

/** Delay before the first repeat of a held direction (like a keyboard's), then between repeats. */
export function repeatDelays(rate: number): { initial: number; interval: number } {
  const r = clampRate(rate);
  return { initial: Math.max(200, 1000 / r), interval: 1000 / r };
}

export class InputController {
  private readonly emit: (a: Action) => void;
  private repeatRate: number;
  private readonly held = new Map<string, Dir>();
  private timer: ReturnType<typeof setTimeout> | null = null;

  constructor(emit: (a: Action) => void, repeatRate: number) {
    this.emit = emit;
    this.repeatRate = clampRate(repeatRate);
  }

  keydown(e: KeyLike): boolean {
    if (e.ctrlKey || e.metaKey || e.altKey) return false;
    const dir = CODE_DIRS[e.code];
    if (dir) {
      if (e.repeat || this.held.has(e.code)) return true;
      this.held.set(e.code, dir);
      this.emit({ type: 'move', dir });
      this.schedule(this.initialDelay());
      return true;
    }
    if (e.repeat) return false;
    const k = e.key.toLowerCase();
    if (k === 'u') this.emit({ type: 'undo' });
    else if (k === 'r') this.emit({ type: 'restart' });
    else if (e.key === 'Escape') this.emit({ type: 'menu' });
    else return false;
    return true;
  }

  keyup(e: KeyLike): void {
    const wasRepeating = [...this.held.keys()].at(-1) === e.code;
    if (!this.held.delete(e.code)) return;
    // only the repeated direction restarts the rate; other keys leave the timer alone
    if (!wasRepeating) return;
    this.clear();
    if (this.held.size) this.schedule(this.initialDelay());
  }

  reset(): void {
    this.held.clear();
    this.clear();
  }

  setRepeatRate(r: number): void {
    this.repeatRate = clampRate(r);
  }

  private initialDelay(): number {
    return repeatDelays(this.repeatRate).initial;
  }

  private schedule(delay: number): void {
    this.clear();
    this.timer = setTimeout(() => {
      const d = [...this.held.values()].at(-1);
      if (!d) return;
      this.emit({ type: 'move', dir: d });
      this.schedule(repeatDelays(this.repeatRate).interval);
    }, delay);
  }

  private clear(): void {
    if (this.timer !== null) clearTimeout(this.timer);
    this.timer = null;
  }
}
