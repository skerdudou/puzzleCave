// xBR 4× on raw RGBA images (pure, no Phaser): the whole terrain, a patch of it after a block
// sank, the sprites (smoothing.ts and BoardView use them).
import { xbr4x } from 'xbr-js/src/index.js';
import { blit, bleed, crop, pad, type Rgba } from './upscale';

/** How many times larger than the art a smoothed texture is. */
export const SMOOTH_FACTOR = 4;
/** The transparent border around a smoothed sprite, art px (its texture: (w + 2 × it) × 4 wide). */
export const SPRITE_PAD = 2;

/** xBR 4× (SMOOTH_FACTOR); `alpha`: the transparency smoothed too (a sprite), else kept. */
export function xbr(img: Rgba, alpha = false): Rgba {
  const px = new Uint32Array(img.data.buffer, img.data.byteOffset, img.w * img.h);
  const out = xbr4x(px, img.w, img.h, { scaleAlpha: alpha });
  return { w: img.w * SMOOTH_FACTOR, h: img.h * SMOOTH_FACTOR, data: new Uint8Array(out.buffer) };
}

/**
 * Around what changed, art px: xBR reads 2 pixels around each one, so a changed pixel changes the
 * smoothed ones up to 2 px away (PATCH_REACH), and those read 2 more: the window recomputed
 * (PATCH_MARGIN) is just wide enough that its own edges never reach what is copied back.
 */
const PATCH_REACH = 2;
const PATCH_MARGIN = 4;

/**
 * `big` (xBR of `small` before it changed inside `rect`, art px) made equal to xBR of `small`
 * now, recomputing a window around `rect` only: a block sinking redraws a few cells, not the
 * whole terrain. Where the window meets the image's edge, xBR sees that edge as it does on the
 * whole image: the result is the same, pixel for pixel.
 */
export function xbrPatch(
  small: Rgba,
  big: Rgba,
  rect: { x: number; y: number; w: number; h: number },
): void {
  const clip = (m: number) => {
    const x0 = Math.max(0, rect.x - m);
    const y0 = Math.max(0, rect.y - m);
    const x1 = Math.min(small.w, rect.x + rect.w + m);
    const y1 = Math.min(small.h, rect.y + rect.h + m);
    return { x0, y0, x1, y1 };
  };
  const win = clip(PATCH_MARGIN);
  const part = xbr(crop(small, win.x0, win.y0, win.x1 - win.x0, win.y1 - win.y0));
  const out = clip(PATCH_REACH);
  const F = SMOOTH_FACTOR;
  blit(
    big,
    part,
    (out.x0 - win.x0) * F,
    (out.y0 - win.y0) * F,
    (out.x1 - out.x0) * F,
    (out.y1 - out.y0) * F,
    out.x0 * F,
    out.y0 * F,
  );
}

/**
 * A sprite smoothed: inside a transparent border of SPRITE_PAD px (kept), so that xBR rounds the
 * edges the art touches instead of taking them for a wall, and the smooth drawing of a sprite
 * between two cells fades them out instead of cutting them flat at the texture's edge; the
 * transparent pixels' colour bled from the visible ones first, so that xBR does not mix the
 * unseen colour under them into the edges (a pale fringe).
 */
export const smoothSprite = (img: Rgba): Rgba => xbr(bleed(pad(img, SPRITE_PAD)), true);
