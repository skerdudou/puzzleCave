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

/**
 * Checks for a new version besides the one at start-up, while the game stays open: the released
 * game once a day (on a phone it comes back to the screen all the time, and a new version is
 * rare), the preview once a minute (to get each deploy soon). Both on a timer and when the game
 * comes back to the screen, once that much time has passed since the last check.
 */
export const RELEASE_CHECK_MS = 24 * 60 * 60 * 1000;
export const PREVIEW_CHECK_MS = 60 * 1000;
export const checkInterval = (preview: boolean): number =>
  preview ? PREVIEW_CHECK_MS : RELEASE_CHECK_MS;

/** A check for a new version is due (`last`: the time of the previous one, ms). */
export const checkDue = (now: number, last: number, gap: number): boolean => now - last >= gap;

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
