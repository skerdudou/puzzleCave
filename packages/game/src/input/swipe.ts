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

/** A finger's travel under this, CSS px, does not move the page (a tap stays still). */
export const DRAG_DEADZONE = 8;

/**
 * How far the page follows a finger dragged (dx, dy) from where it went down, CSS px: half the
 * finger's travel past the dead zone, up to 1.5 × SWIPE_MIN, so that the page shows it can be
 * swiped without leaving; where there is no chapter that way (`canGo` false), a quarter of that,
 * a rubber band. 0 for a slide mostly vertical.
 */
export function dragOffset(dx: number, dy: number, canGo: boolean): number {
  const travel = Math.abs(dx) - DRAG_DEADZONE;
  if (travel <= 0 || Math.abs(dx) < 1.5 * Math.abs(dy)) return 0;
  const max = canGo ? 1.5 * SWIPE_MIN : 0.375 * SWIPE_MIN;
  const follow = canGo ? 0.5 : 0.125;
  return Math.sign(dx) * Math.min(max, travel * follow);
}
