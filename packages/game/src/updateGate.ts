/**
 * When a new version of the game (a new service worker) is ready, it is applied only at moments
 * when the player is not doing anything with the screen (the page reloads, then comes back to
 * the same screen: see pwa.ts):
 * - at start-up, before the first screen shows (pwa.ts, BootScene: the old version is never seen);
 * - on going to a menu screen from another screen (an "Updating…" box shows until that screen is
 *   drawn by the new version);
 * - when the game goes to the background (another app, the screen locked) on a menu screen.
 * Never in a level, a replay or a result screen, and never while a menu screen is in use.
 */

/** The screens a reload loses nothing on, and comes back to (with what they show). */
export const RESUME_SCENES: readonly string[] = ['Menu', 'Select', 'Options', 'Achievements'];

/** Checks for a new version while the game stays open: every 30 minutes… */
export const CHECK_INTERVAL_MS = 30 * 60 * 1000;
/** …and when it comes back to the screen, at most once a minute. */
export const MIN_CHECK_GAP_MS = 60 * 1000;

/** A check for a new version is due (`last`: the time of the previous one, ms). */
export const checkDue = (now: number, last: number, gap = MIN_CHECK_GAP_MS): boolean =>
  now - last >= gap;

export class UpdateGate {
  private scene: string | null = null;
  private waiting = false;
  private applied = false;

  /**
   * `apply(scene, shown)`: install the new version and reload (once), coming back to `scene`;
   * `shown`: the game is on the screen (an "Updating…" box is worth showing).
   */
  constructor(private readonly apply: (scene: string, shown: boolean) => void) {}

  /** A new version is ready: it waits for one of the moments above. */
  ready(): void {
    if (!this.applied) this.waiting = true;
  }

  /** The game shows the scene `key` (a scene restarted on itself, a resize, is no change). */
  enter(key: string): void {
    const from = this.scene;
    this.scene = key;
    if (this.waiting && from !== null && from !== key && RESUME_SCENES.includes(key))
      this.applyNow(key, true);
  }

  /** The game went to the background. */
  hidden(): void {
    if (this.waiting && this.scene !== null && RESUME_SCENES.includes(this.scene))
      this.applyNow(this.scene, false);
  }

  /** A new version waits. */
  get pending(): boolean {
    return this.waiting;
  }

  private applyNow(scene: string, shown: boolean): void {
    this.waiting = false;
    this.applied = true;
    this.apply(scene, shown);
  }
}
