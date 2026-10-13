/**
 * Vertical scrolling of a screen whose content can be taller than the viewport (Options in
 * landscape on a phone). Pure functions: all lengths in the same unit (device pixels in game).
 */

/** Largest scroll offset: 0 when the content fits. */
export function maxScroll(contentH: number, viewportH: number): number {
  return Math.max(0, contentH - viewportH);
}

/** Scroll offset kept inside [0, max]. */
export function clampScroll(y: number, contentH: number, viewportH: number): number {
  return Math.min(maxScroll(contentH, viewportH), Math.max(0, y));
}

/** A pointer that moved farther than `threshold` since it went down is a drag, not a tap. */
export function isDrag(dx: number, dy: number, threshold: number): boolean {
  return dx * dx + dy * dy > threshold * threshold;
}

/**
 * The scroll indicator: a thumb whose length is the visible share of the content and whose
 * position follows the offset. null when everything fits (no indicator).
 */
export function scrollThumb(
  y: number,
  contentH: number,
  viewportH: number,
  minLength: number,
): { top: number; length: number } | null {
  const max = maxScroll(contentH, viewportH);
  if (max <= 0) return null;
  const length = Math.min(viewportH, Math.max(minLength, (viewportH * viewportH) / contentH));
  const top = ((viewportH - length) * clampScroll(y, contentH, viewportH)) / max;
  return { top, length };
}

/** Time constant of the inertia after a flick, ms (the speed falls by e every TAU ms). */
export const INERTIA_TAU = 325;

/**
 * One frame of inertia: the distance travelled in `dt` ms at a speed `v` (px/ms) decaying
 * exponentially, and the speed left (0 once too slow to be seen).
 */
export function inertiaStep(v: number, dt: number, minSpeed = 0.02): { dist: number; v: number } {
  const k = Math.exp(-dt / INERTIA_TAU);
  const dist = v * INERTIA_TAU * (1 - k);
  const left = v * k;
  return { dist, v: Math.abs(left) < minSpeed ? 0 : left };
}

/** Release speed (px/ms) from the recent pointer samples, over the last `window` ms. */
export function releaseSpeed(
  samples: readonly { t: number; y: number }[],
  now: number,
  window = 100,
): number {
  const recent = samples.filter((s) => now - s.t <= window);
  if (recent.length < 2) return 0;
  const a = recent[0]!;
  const b = recent[recent.length - 1]!;
  return b.t > a.t ? (b.y - a.y) / (b.t - a.t) : 0;
}

/**
 * Where a drop-down list of height `listH` opens, in viewport coordinates: under its button
 * (centre `anchorY`, half height `gap`) if it fits, else above it, else clamped inside the
 * viewport (margin `margin` on both sides) so that it is always fully visible.
 */
export function dropDownTop(
  anchorY: number,
  gap: number,
  listH: number,
  viewportH: number,
  margin: number,
): number {
  const below = anchorY + gap;
  if (below + listH <= viewportH - margin) return below;
  const above = anchorY - gap - listH;
  if (above >= margin) return above;
  return Math.max(margin, Math.min(viewportH - margin - listH, below));
}
