// The board's smoothing (Options › Graphics): on (the default), the 16 px art drawn
// 4× larger through xBR — the terrain whole when a level is drawn (BoardView), the sprites that
// move once at start (BootScene); off, the art as it is.
import Phaser from 'phaser';
import { xbr4x } from 'xbr-js/src/index.js';
import { bleed, pad, type Rgba } from './upscale';

/** How many times larger than the art a smoothed texture is. */
export const SMOOTH_FACTOR = 4;
/** The textures that move on the board: smoothed one by one at start. */
export const SMOOTH_SPRITES = ['KEY', 'DOOR', 'BLOCK', 'player'] as const;
/** The transparent border around a smoothed sprite, art px (its texture: (w + 2 × it) × 4 wide). */
export const SPRITE_PAD = 2;

/** The texture of `key` drawn smoothed or not (the art itself). */
export const smoothKey = (key: string, on: boolean): string => (on ? `smooth/${key}` : key);

/** xBR 4× (SMOOTH_FACTOR); `alpha`: the transparency smoothed too (a sprite), else kept. */
export function xbr(img: Rgba, alpha = false): Rgba {
  const px = new Uint32Array(img.data.buffer, img.data.byteOffset, img.w * img.h);
  const out = xbr4x(px, img.w, img.h, { scaleAlpha: alpha });
  return { w: img.w * SMOOTH_FACTOR, h: img.h * SMOOTH_FACTOR, data: new Uint8Array(out.buffer) };
}

/**
 * A sprite smoothed: inside a transparent border of SPRITE_PAD px (kept), so that xBR rounds the
 * edges the art touches instead of taking them for a wall, and the smooth drawing of a sprite
 * between two cells fades them out instead of cutting them flat at the texture's edge; the
 * transparent pixels' colour bled from the visible ones first, so that xBR does not mix the
 * unseen colour under them into the edges (a pale fringe).
 */
export const smoothSprite = (img: Rgba): Rgba => xbr(bleed(pad(img, SPRITE_PAD)), true);

/** A loaded texture's pixels. */
export function texturePixels(textures: Phaser.Textures.TextureManager, key: string): Rgba {
  const src = textures.get(key).getSourceImage() as HTMLImageElement | HTMLCanvasElement;
  const canvas = document.createElement('canvas');
  canvas.width = src.width;
  canvas.height = src.height;
  const ctx = canvas.getContext('2d', { willReadFrequently: true })!;
  ctx.drawImage(src, 0, 0);
  const d = ctx.getImageData(0, 0, src.width, src.height);
  return { w: d.width, h: d.height, data: new Uint8Array(d.data.buffer) };
}

/**
 * Pixels as a texture `key`, drawn smoothly (mixed, not picked: it is drawn smaller than it is).
 * `opaque` (the terrain): with WebGL, straight from the pixels, without a canvas copy (Phaser
 * still keeps the pixel array, to restore the texture if the WebGL context is lost: what bounds
 * the memory is BoardView's small cache); with transparency, through a canvas, which stores the
 * colours as WebGL draws them (premultiplied by their alpha).
 */
export function addPixels(
  textures: Phaser.Textures.TextureManager,
  key: string,
  img: Rgba,
  opaque = false,
): void {
  if (opaque && textures.game.renderer.type === Phaser.WEBGL) {
    textures
      .addUint8Array(key, img.data, img.w, img.h)
      ?.setFilter(Phaser.Textures.FilterMode.LINEAR);
    return;
  }
  const canvas = document.createElement('canvas');
  canvas.width = img.w;
  canvas.height = img.h;
  const data = new Uint8ClampedArray(
    img.data.buffer as ArrayBuffer,
    img.data.byteOffset,
    img.data.length,
  );
  canvas.getContext('2d')!.putImageData(new ImageData(data, img.w, img.h), 0, 0);
  textures.addCanvas(key, canvas)?.setFilter(Phaser.Textures.FilterMode.LINEAR);
}
