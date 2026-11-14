// Installing the game as an app (a PWA) from the main menu's "Install" button. Chrome and Edge
// offer the install on their own once, then stop for a long while after the player closes it;
// they hand the page that offer instead (beforeinstallprompt), for a button of its own. Safari
// (iPhone) has no such event: no button there.

/** Chrome's and Edge's install offer (not in TypeScript's DOM types). */
interface InstallPrompt extends Event {
  prompt(): Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
}

/** The offer kept for the button (null: none, or already used: it serves once). */
let offer: InstallPrompt | null = null;
const listeners = new Set<() => void>();
const changed = () => {
  for (const l of [...listeners]) l();
};

/**
 * Keeps the browser's install offer for the button (call at start-up, before the first await:
 * the offer may come early). `target`: window (another one for the tests).
 */
export function watchInstall(target: EventTarget = window): void {
  target.addEventListener('beforeinstallprompt', (e) => {
    // no install bar of the browser's own: the menu's button instead
    e.preventDefault();
    offer = e as InstallPrompt;
    changed();
  });
  target.addEventListener('appinstalled', () => {
    offer = null;
    changed();
  });
}

/** The browser can install the game now (and it is not installed): the button shows. */
export const canInstall = (): boolean => offer !== null;

/**
 * The browser's install box (in a tap or a key press). Accepted or not, the offer is used up: the
 * button goes; the browser may hand a new one later (beforeinstallprompt again).
 */
export async function promptInstall(): Promise<void> {
  const o = offer;
  if (!o) return;
  offer = null;
  try {
    await o.prompt();
    await o.userChoice;
  } catch {
    /* refused by the browser: nothing to do */
  }
  changed();
}

/** `l` runs when the button should show or go; the returned function stops it. */
export function onInstallChange(l: () => void): () => void {
  listeners.add(l);
  return () => listeners.delete(l);
}
