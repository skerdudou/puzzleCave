/** Undo held (its key or its button): undos a second, past the initial delay. */
export const UNDO_RATE = 8;

/**
 * A press held that repeats an action: `start` waits `initial` ms, then calls `fire` every
 * 1/`rate` s until `stop`. The press's own first action is the caller's (at once on a key, on
 * release for a button: `stop` says whether it repeated, so that the release adds none).
 */
export class PressRepeat {
  private timer: ReturnType<typeof setTimeout> | null = null;
  private repeated = false;

  constructor(
    private readonly fire: () => void,
    private readonly rate = UNDO_RATE,
  ) {}

  start(initial: number): void {
    this.stop();
    const tick = (delay: number) => {
      this.timer = setTimeout(() => {
        this.repeated = true;
        this.fire();
        tick(1000 / this.rate);
      }, delay);
    };
    tick(initial);
  }

  /** Stops the repeat; true if it fired at least once since `start`. */
  stop(): boolean {
    if (this.timer !== null) clearTimeout(this.timer);
    this.timer = null;
    const r = this.repeated;
    this.repeated = false;
    return r;
  }

  get active(): boolean {
    return this.timer !== null;
  }
}
