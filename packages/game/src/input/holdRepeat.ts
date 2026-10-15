import type { Dir } from '@puzzlecave/core';
import { repeatDelays } from './InputController';

interface Held {
  id: number;
  dir: Dir;
  stillHeld: () => boolean;
  emit: (d: Dir) => void;
}

/**
 * Hold to repeat on an on-screen direction button or a tap zone: one move at once, then after an
 * initial delay one move per 1/rate s (the key repeat setting), until the finger is lifted.
 *
 * `stillHeld` is asked before every repeat, so a release the button never heard of (finger
 * slid off, touch cancelled, pointer lost) stops the repeat at the next tick anyway.
 */
export class HoldRepeat {
  private readonly emit: (d: Dir) => void;
  private readonly rate: () => number;
  private held: Held | null = null;
  private timer: ReturnType<typeof setTimeout> | null = null;

  constructor(emit: (d: Dir) => void, rate: () => number) {
    this.emit = emit;
    this.rate = rate;
  }

  /**
   * Finger `id` pressed the button of `dir`: the latest press wins, like held keys. `emit`
   * replaces the constructor's for this press (a tap zone also lights up).
   */
  press(
    id: number,
    dir: Dir,
    stillHeld: () => boolean = () => true,
    emit: (d: Dir) => void = this.emit,
  ): void {
    this.held = { id, dir, stillHeld, emit };
    emit(dir);
    this.schedule(repeatDelays(this.rate()).initial);
  }

  /** Finger `id` lifted, slid off the button or was cancelled (other fingers: no effect). */
  release(id: number): void {
    if (this.held?.id === id) this.reset();
  }

  reset(): void {
    this.held = null;
    if (this.timer !== null) clearTimeout(this.timer);
    this.timer = null;
  }

  get holding(): boolean {
    return this.held !== null;
  }

  private schedule(delay: number): void {
    if (this.timer !== null) clearTimeout(this.timer);
    this.timer = setTimeout(() => {
      this.timer = null;
      const h = this.held;
      if (!h) return;
      if (!h.stillHeld()) return this.reset();
      h.emit(h.dir);
      this.schedule(repeatDelays(this.rate()).interval);
    }, delay);
  }
}
