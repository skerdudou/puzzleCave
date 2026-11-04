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

const GUARD = 'puzzlecave-back';
const guarded = () => (history.state as { pc?: string } | null)?.pc === GUARD;

/**
 * One history entry is kept above the page's own: Back takes it off (a popstate) without
 * leaving the page. The current screen then gets an Escape and the entry is put back. On the
 * menu, the first Back puts the entry back too and `warn`s; a second one within
 * LEAVE_WINDOW_MS goes one entry further back and the page is left as usual (if there is
 * nothing to go back to, the game stays on its menu without the entry: `guard` puts it back
 * when another screen opens).
 */
export function installBackButton(
  topScene: () => string | undefined,
  warn: () => void,
): { guard(): void } {
  const gate = new LeaveGate();
  const guard = () => {
    if (!guarded()) history.pushState({ pc: GUARD }, '');
  };
  guard();
  window.addEventListener('popstate', () => {
    if (guarded()) return;
    if (backAction(topScene()) === 'leave') {
      if (gate.press(performance.now())) {
        history.back();
        return;
      }
      warn();
    } else window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', code: 'Escape' }));
    guard();
  });
  return { guard };
}
