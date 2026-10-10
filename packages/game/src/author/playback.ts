// Solution playback controller (pure logic, no Phaser).
export const MIN_SPEED = 1;
export const MAX_SPEED = 20;
export const DEFAULT_SPEED = 8;
/** a very long frame (background tab) does not trigger a burst of moves */
const MAX_FRAME_MS = 500;
const MAX_ANIM_MS = 100;

export class Playback {
  readonly total: number;
  index = 0;
  speed = DEFAULT_SPEED;
  playing = true;
  private acc = 0;

  constructor(total: number) {
    this.total = total;
    if (total === 0) this.playing = false;
  }

  get atEnd(): boolean {
    return this.index >= this.total;
  }

  /** Number of moves to play for `dtMs` ms elapsed (0 when paused). */
  tick(dtMs: number): number {
    if (!this.playing) return 0;
    this.acc += Math.min(Math.max(dtMs, 0), MAX_FRAME_MS);
    const interval = 1000 / this.speed;
    let n = 0;
    while (this.acc >= interval && this.index < this.total) {
      this.acc -= interval;
      this.index++;
      n++;
    }
    if (this.atEnd) {
      this.playing = false;
      this.acc = 0;
    }
    return n;
  }

  toggle(): void {
    if (this.playing) {
      this.playing = false;
      return;
    }
    if (this.total === 0) return;
    if (this.atEnd) this.index = 0;
    this.acc = 0;
    this.playing = true;
  }

  stepForward(): boolean {
    this.playing = false;
    if (this.atEnd) return false;
    this.index++;
    return true;
  }

  stepBack(): boolean {
    this.playing = false;
    if (this.index <= 0) return false;
    this.index--;
    return true;
  }

  restart(): void {
    this.index = 0;
    this.acc = 0;
    this.playing = false;
  }

  faster(): void {
    this.speed = Math.min(MAX_SPEED, this.speed + 1);
  }

  slower(): void {
    this.speed = Math.max(MIN_SPEED, this.speed - 1);
  }

  /** Animation duration of a move: at most 100 ms, shortened as playback speeds up. */
  animMs(): number {
    return Math.min(MAX_ANIM_MS, Math.round(800 / this.speed));
  }
}
