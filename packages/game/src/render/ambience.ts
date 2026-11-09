import { chapters, locate } from '../levels';

// Pure maths for the cave ambience (rock around the board, torchlight, dust, chapter tint).
// Coordinates are art pixels of the screen (device px / scale). Drawing lives elsewhere.

export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}
/** Top-left of a 16x16 WALL stone. */
export interface Stone {
  x: number;
  y: number;
  alpha: number;
}

/** Small deterministic integer hash, used for every "random" decoration. */
export function hash(x: number, y: number): number {
  let h = (x * 374761393 + y * 668265263) ^ 0x5bd1e995;
  h = (h ^ (h >>> 13)) * 1274126177;
  return (h ^ (h >>> 16)) >>> 0;
}

/** Wall stones fading out with the distance to the board (<= 150 px). */
export function rockStones(screen: Rect, board: Rect): Stone[] {
  const out: Stone[] = [];
  const x0 = Math.floor(screen.x / 16) - 1,
    x1 = Math.ceil((screen.x + screen.w) / 16) + 1;
  const y0 = Math.floor(screen.y / 16) - 1,
    y1 = Math.ceil((screen.y + screen.h) / 16) + 1;
  for (let y = y0; y < y1; y++) {
    for (let x = x0; x < x1; x++) {
      const cx = x * 16 + 8,
        cy = y * 16 + 8;
      const dx = Math.max(board.x - cx, 0, cx - (board.x + board.w));
      const dy = Math.max(board.y - cy, 0, cy - (board.y + board.h));
      const d = Math.hypot(dx, dy);
      if (d < 1) continue;
      const alpha = Math.max(0, 1 - d / 150) * (0.75 + (hash(x, y) % 25) / 100);
      if (alpha <= 0.02) continue;
      const sx = cx - 8 + ((hash(x, y) % 5) - 2),
        sy = cy - 8 + ((hash(y, x) % 5) - 2);
      out.push({ x: sx, y: sy, alpha });
      if (hash(x * 3, y) % 3 === 0) out.push({ x: sx + 6, y: sy + 7, alpha });
    }
  }
  return out;
}

/** Torch radius with a slight flicker; steady when motion is reduced. */
export function lightRadius(tSeconds: number, reducedMotion: boolean): number {
  if (reducedMotion) return 78;
  return 78 + Math.sin(tSeconds * 9.1) * 1.5 + Math.sin(tSeconds * 23.7) * 1;
}

/**
 * The vignette's radial gradient, centred on the board: clear up to `inner`, darkest at `outer`.
 * The spec's 0.35·min(W,H) and 0.72·max(W,H), except that it never starts inside the board (its
 * half-diagonal): the board's own darkness is the most it gets (about 30 %).
 */
export function vignetteRadii(
  W: number,
  H: number,
  board: { w: number; h: number },
): { inner: number; outer: number } {
  const inner = Math.max(Math.min(W, H) * 0.35, Math.hypot(board.w / 2, board.h / 2));
  return { inner, outer: Math.max(Math.max(W, H) * 0.72, inner * 1.5) };
}

export const DARK_OUTSIDE = 0.72;
export const BOARD_LIGHT_CUT = 0.6;

export interface Mote {
  x: number;
  y: number;
  speed: number;
  phase: number;
}

export function initMotes(w: number, h: number, n = 46): Mote[] {
  return Array.from({ length: n }, (_, i) => ({
    x: hash(i, 1) % Math.max(1, Math.floor(w)),
    y: hash(i, 2) % Math.max(1, Math.floor(h)),
    speed: 0.08 + (hash(i, 3) % 100) / 900,
    phase: (hash(i, 4) % 628) / 100,
  }));
}

const wrap = (v: number, n: number) => ((v % n) + n) % n;

export function motePosition(
  m: Mote,
  tSeconds: number,
  w: number,
  h: number,
  reducedMotion: boolean,
): [number, number] {
  if (reducedMotion) return [m.x, m.y];
  return [
    wrap(m.x + Math.sin(tSeconds * 0.6 + m.phase) * 6, w),
    wrap(m.y - tSeconds * 60 * m.speed, h),
  ];
}

/**
 * Master mode's frost: the motes fall slowly (dust rises), swaying; still when motion is
 * reduced.
 */
export function frostPosition(
  m: Mote,
  tSeconds: number,
  w: number,
  h: number,
  reducedMotion: boolean,
): [number, number] {
  if (reducedMotion) return [m.x, m.y];
  return [
    wrap(m.x + Math.sin(tSeconds * 0.8 + m.phase) * 8, w),
    wrap(m.y + tSeconds * 30 * m.speed, h),
  ];
}

/** Master mode's frost twinkles: the mote's alpha `a` scaled between 0.35 and 1. */
export function frostTwinkle(a: number, m: Mote, tSeconds: number, reducedMotion: boolean): number {
  if (reducedMotion) return a;
  return a * (0.675 + 0.325 * Math.sin(tSeconds * 2.6 + m.phase * 3));
}

/**
 * Master mode's last seconds (`leftMs` of `warnMs`, the countdown's warning span): the strength
 * of the red vignette, growing to the end, with a heartbeat on each whole second of the countdown
 * (when the heartbeat sounds); steady, growing, when motion is reduced. 0 outside the warning.
 */
export function tensionAlpha(leftMs: number, warnMs: number, reducedMotion: boolean): number {
  if (warnMs <= 0 || leftMs > warnMs || leftMs <= 0) return 0;
  const k = 1 - leftMs / warnMs;
  if (reducedMotion) return 0.3 + 0.4 * k;
  // seconds since the countdown passed its last whole second
  const since = (1000 - (leftMs % 1000 || 1000)) / 1000;
  const beat = Math.exp(-since * 6) + 0.5 * Math.exp(-Math.abs(since - 0.2) * 12);
  return Math.min(1, 0.2 + 0.3 * k + 0.35 * beat);
}

/** `dist`: distance to the torch; `torchlight` off means a flat brightness. */
export function moteAlpha(dist: number, torchlight: boolean): number {
  return 0.25 + 0.5 * (torchlight ? Math.max(0.15, 1 - dist / 110) : 0.5);
}

const TINTS: Record<string, number> = {
  easy: 0x4f9a5a,
  medium: 0x4a6fa5,
  hard: 0xc8643c,
  expert: 0x8a6ee0,
};

export function chapterTint(levelId: string): number | null {
  const loc = locate(levelId);
  if (!loc) return null;
  return TINTS[chapters[loc.chapterIndex]!.id] ?? null;
}

/** White blended towards `color` by `amount` (0..1): a gentle multiply tint. */
export function mixTowards(color: number, amount: number): number {
  const ch = (shift: number) => Math.round(255 + (((color >> shift) & 0xff) - 255) * amount);
  return (ch(16) << 16) | (ch(8) << 8) | ch(0);
}
