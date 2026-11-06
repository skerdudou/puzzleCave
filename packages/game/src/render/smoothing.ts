// The board's smoothing (Options › Graphics): on (the default), the 16 px art drawn
// 4× larger through xBR — the terrain whole when a level is drawn (BoardView), the sprites that
// move once at start (BootScene); off, the art as it is.
import Phaser from 'phaser';
import type { Rgba } from './upscale';
export { SMOOTH_FACTOR, SPRITE_PAD, smoothSprite, xbr, xbrPatch } from './xbr';

/** The textures that move on the board: smoothed one by one at start. */
export const SMOOTH_SPRITES = ['KEY', 'DOOR', 'BLOCK', 'player'] as const;
/** The texture of `key` drawn smoothed or not (the art itself). */
export const smoothKey = (key: string, on: boolean): string => (on ? `smooth/${key}` : key);

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
