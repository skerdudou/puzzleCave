// The browser's Back (a phone's back button or gesture, Alt+←): inside the game it goes back a
// screen, like Escape, instead of leaving the page.

/** What Back does on a screen: the one-screen-back of Escape, or leave the game (the menu). */
export type BackAction = 'escape' | 'leave';

/** The menu (and the loading screen) are the game's first screen: Back leaves from there. */
export function backAction(scene: string | undefined): BackAction {
  return scene === undefined || scene === 'Menu' || scene === 'Boot' ? 'leave' : 'escape';
}

const GUARD = 'puzzlecave-back';
const guarded = () => (history.state as { pc?: string } | null)?.pc === GUARD;

/**
 * One history entry is kept above the page's own: Back takes it off (a popstate) without
 * leaving the page. The current screen then gets an Escape and the entry is put back; on the
 * menu, the game goes one entry further back instead and the page is left as usual (if there
 * is nothing to go back to, the game stays on its menu without the entry: `guard` puts it back
 * when another screen opens).
 */
export function installBackButton(topScene: () => string | undefined): { guard(): void } {
  const guard = () => {
    if (!guarded()) history.pushState({ pc: GUARD }, '');
  };
  guard();
  window.addEventListener('popstate', () => {
    if (guarded()) return;
    if (backAction(topScene()) === 'leave') {
      history.back();
      return;
    }
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', code: 'Escape' }));
    guard();
  });
  return { guard };
}
