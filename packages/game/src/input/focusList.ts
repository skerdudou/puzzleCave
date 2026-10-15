/** What a key does to the keyboard focus of a list of buttons. */
export type FocusKey = 'prev' | 'next' | 'activate' | null;

/** Arrows and Tab move the focus, Enter and Space press the focused button. */
export function focusKey(e: { key: string; shiftKey?: boolean }): FocusKey {
  switch (e.key) {
    case 'ArrowUp':
    case 'ArrowLeft':
      return 'prev';
    case 'ArrowDown':
    case 'ArrowRight':
      return 'next';
    case 'Tab':
      return e.shiftKey ? 'prev' : 'next';
    case 'Enter':
    case ' ':
      return 'activate';
    default:
      return null;
  }
}

/**
 * The focused button among `count`, in reading order: none (-1) until the first arrow or Tab,
 * which focuses the first one (or the last one, going back); then it wraps around.
 */
export class FocusList {
  constructor(
    readonly count: number,
    public index = -1,
  ) {}

  move(delta: 1 | -1): number {
    if (this.count === 0) return (this.index = -1);
    if (this.index < 0) return (this.index = delta > 0 ? 0 : this.count - 1);
    return (this.index = (this.index + delta + this.count) % this.count);
  }
}
