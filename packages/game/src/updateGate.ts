/**
 * When a new version of the game (a new service worker) is ready: reload at once on a screen
 * where nothing is lost (menus, options, the result screen: progress and settings are saved as
 * they change), or wait for the player to leave the level in progress for a menu.
 */

/** Scenes where a new version is applied as soon as it is ready. */
export const RELOAD_SCENES: readonly string[] = ['Boot', 'Menu', 'Options', 'Select', 'Result'];
/**
 * Scenes where an update that had to wait is applied on arrival. Not the result screen: a level
 * just finished shows its medals there (and its Next button leads to the next level, not to a
 * menu); the update waits for the next menu, as the notice says.
 */
export const APPLY_SCENES: readonly string[] = ['Boot', 'Menu', 'Options', 'Select'];

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
   * `apply`: install the new version and reload (once); `notify`: tell the player that it will
   * come at the next menu.
   */
  constructor(
    private readonly apply: () => void,
    private readonly notify: () => void,
  ) {}

  /** A new version is ready. */
  ready(): void {
    if (this.applied || this.waiting) return;
    // before the first scene: nothing to lose either
    if (this.scene === null || RELOAD_SCENES.includes(this.scene)) return this.applyNow();
    this.waiting = true;
    this.notify();
  }

  /** The game shows the scene `key`. */
  enter(key: string): void {
    this.scene = key;
    if (this.waiting && APPLY_SCENES.includes(key)) this.applyNow();
  }

  /** A new version waits for a menu. */
  get pending(): boolean {
    return this.waiting;
  }

  private applyNow(): void {
    this.waiting = false;
    this.applied = true;
    this.apply();
  }
}
