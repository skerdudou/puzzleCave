/**
 * The clock of a run (pure, no Phaser): it starts with the first move and does not count while
 * the game is hidden (another app, screen locked, browser tab in the background), when the
 * board cannot be seen nor played. Leaving for the menu ends the run: nothing to pause there.
 *
 * A restart starts a new clock; in normal mode the game a restart replaced can come back with
 * undo, and its clock with it (`restart(true)`, then `undoRestart()`).
 */
export class RunClock {
  private start: number | null = null;
  /** the start of the game a restart replaced */
  private saved: number | null = null;
  private hiddenAt: number | null = null;

  get started(): boolean {
    return this.start !== null;
  }

  /** The first move: the clock starts (a later call does nothing). */
  begin(now: number): void {
    if (this.start === null) this.start = this.hiddenAt ?? now;
  }

  /** Time counted so far, ms (0 before the first move; frozen while hidden). */
  elapsed(now: number): number {
    return this.start === null ? 0 : (this.hiddenAt ?? now) - this.start;
  }

  /** A new game: its clock waits for its first move. `keep`: the old one can come back. */
  restart(keep: boolean): void {
    if (keep && this.start !== null) this.saved = this.start;
    this.start = null;
  }

  /** The game a restart replaced is back (undo right after the restart). */
  undoRestart(): void {
    this.start = this.saved;
  }

  /** The game is hidden: the clock stops. */
  pause(now: number): void {
    if (this.hiddenAt === null) this.hiddenAt = now;
  }

  /** Visible again: the hidden time is not counted. */
  resume(now: number): void {
    if (this.hiddenAt === null) return;
    const away = now - this.hiddenAt;
    if (this.start !== null) this.start += away;
    if (this.saved !== null) this.saved += away;
    this.hiddenAt = null;
  }
}

export interface Countdown {
  /** time left, ms (≥ 0) */
  leftMs: number;
  /** the last seconds: the countdown shows a warning */
  warn: boolean;
  /** the limit is passed: the run has failed */
  over: boolean;
}

/** The warning starts this long before the end (or at the last quarter of a short limit). */
export const COUNTDOWN_WARN_MS = 10_000;

/** Master mode's countdown to the time limit, after `elapsedMs` of play. */
export function countdown(limitMs: number, elapsedMs: number): Countdown {
  const left = limitMs - elapsedMs;
  return {
    leftMs: Math.max(0, left),
    warn: left <= Math.min(COUNTDOWN_WARN_MS, limitMs / 4),
    over: left < 0,
  };
}
