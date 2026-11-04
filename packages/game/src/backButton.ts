// The browser's Back (a phone's back button or gesture, Alt+←): inside the game it goes back a
// screen, like Escape, instead of leaving the page; on the menu, a second Back leaves.

/** What Back does on a screen: the one-screen-back of Escape, or leave the game (the menu). */
export type BackAction = 'escape' | 'leave';

/** The menu (and the loading screen) are the game's first screen: Back leaves from there. */
export function backAction(scene: string | undefined): BackAction {
  return scene === undefined || scene === 'Menu' || scene === 'Boot' ? 'leave' : 'escape';
}

/** How long after a first Back on the menu a second one leaves the game, ms. */
export const LEAVE_WINDOW_MS = 2500;

/** Back on the menu: the first press warns, a second one soon after leaves (true). */
export class LeaveGate {
  private last = -Infinity;
  press(now: number): boolean {
    const leave = now - this.last <= LEAVE_WINDOW_MS;
    this.last = leave ? -Infinity : now;
    return leave;
  }
}

/**
 * How many history entries the game keeps above the page's own: one per Back it answers in a
 * row without the player touching anything (Game → Select → Menu → the warning is 3; a replay
 * opened from the result screen adds one or two).
 */
export const RESERVE = 6;

const GUARD = 'puzzlecave-back';

/** What the game needs of `window.history`. */
export interface HistoryLike {
  readonly state: unknown;
  pushState(state: unknown, unused: string): void;
  go(delta: number): void;
}

/** What one Back did. */
export type BackResult = 'escape' | 'warn' | 'leave' | 'forward';

/**
 * The game's entries above the page's own, numbered 1 to RESERVE (the page's own entry is 0).
 *
 * Chrome skips, on Back, an entry that added another without the player doing anything on it:
 * an entry put back in the popstate of a Back is pushed without a user gesture, and the Back
 * after it then leaves the page at once. So a Back only takes an entry off; the entries are
 * topped up on a key or a touch (`topUp`), which are user gestures.
 */
export class BackHistory {
  private depth: number;
  private readonly gate = new LeaveGate();

  constructor(private readonly h: HistoryLike) {
    this.depth = this.current();
  }

  /** The depth of the entry the browser is on. */
  private current(): number {
    const s = this.h.state as { pc?: string; n?: number } | null;
    return s?.pc === GUARD && typeof s.n === 'number' ? s.n : 0;
  }

  /** Pushes the entries missing up to RESERVE (call it on a user gesture). */
  topUp(): void {
    this.depth = this.current();
    while (this.depth < RESERVE) {
      this.depth++;
      this.h.pushState({ pc: GUARD, n: this.depth }, '');
    }
  }

  /** The browser moved in the history (a popstate), on `scene`, at `now` ms. */
  popped(scene: string | undefined, now: number): BackResult {
    const was = this.depth;
    this.depth = this.current();
    if (this.depth > was) return 'forward';
    if (backAction(scene) === 'escape') return 'escape';
    if (!this.gate.press(now)) return 'warn';
    // the page before the game: past the page's own entry
    this.h.go(-(this.depth + 1));
    return 'leave';
  }
}

/**
 * Installs it on the page: Back on a screen gives it an Escape, on the menu `warn`s then leaves.
 * The entries are pushed on a key or a touch only, never at load or when a screen opens (which
 * may follow a Back): before the first one, Back leaves the page as usual.
 */
export function installBackButton(topScene: () => string | undefined, warn: () => void): void {
  const back = new BackHistory(history);
  // a real press only (an event the game sends itself is no user gesture)
  const topUp = (e: Event) => e.isTrusted && back.topUp();
  // pointerup (not pointerdown) is a user gesture on a touch screen
  window.addEventListener('pointerup', topUp, true);
  // not Escape: it is no user gesture
  window.addEventListener('keydown', (e) => e.key !== 'Escape' && topUp(e), true);
  window.addEventListener('popstate', () => {
    const r = back.popped(topScene(), performance.now());
    if (r === 'escape')
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', code: 'Escape' }));
    else if (r === 'warn') warn();
  });
}
