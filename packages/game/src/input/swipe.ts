/** The shortest swipe, CSS px: shorter, it is a tap (a finger always moves a little). */
export const SWIPE_MIN = 48;

/**
 * A finger lifted (dx, dy) from where it went down, CSS px: a horizontal swipe gives the
 * chapter to go to, +1 (swiped to the left: the next one, like turning a page) or -1 (to the
 * right: the previous one); 0 for a tap, or a slide mostly vertical.
 */
export function swipeStep(dx: number, dy: number, min = SWIPE_MIN): -1 | 0 | 1 {
  if (Math.abs(dx) < min || Math.abs(dx) < 1.5 * Math.abs(dy)) return 0;
  return dx < 0 ? 1 : -1;
}
