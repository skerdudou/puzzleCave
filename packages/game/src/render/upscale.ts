// Raw RGBA images (pure) and what prepares a sprite for smoothing: a transparent border, and the
// colour bleed that keeps a filter from fringing its edges. Used by smoothing.ts.

export interface Rgba {
  w: number;
  h: number;
  /** w × h × 4 bytes, rows top to bottom */
  data: Uint8Array;
}

/**
 * The colour of each fully transparent pixel replaced by the mean of the visible pixels around
 * it, spreading outward until every pixel has one (alpha unchanged). A filter that mixes pixels
 * (xBR) then blends a sprite's edge with its own colours, not with the unseen black or
 * white under the transparency (a pale fringe).
 */
export function bleed(img: Rgba): Rgba {
  const { w, h } = img;
  const data = Uint8Array.from(img.data);
  const known = new Uint8Array(w * h);
  for (let i = 0; i < w * h; i++) known[i] = data[i * 4 + 3]! > 0 ? 1 : 0;
  if (!known.includes(1)) return { w, h, data };
  for (;;) {
    const next: [number, number, number, number][] = [];
    for (let y = 0; y < h; y++)
      for (let x = 0; x < w; x++) {
        if (known[y * w + x]) continue;
        let r = 0;
        let g = 0;
        let b = 0;
        let n = 0;
        for (let dy = -1; dy <= 1; dy++)
          for (let dx = -1; dx <= 1; dx++) {
            const nx = x + dx;
            const ny = y + dy;
            if (nx < 0 || ny < 0 || nx >= w || ny >= h || !known[ny * w + nx]) continue;
            const j = (ny * w + nx) * 4;
            r += data[j]!;
            g += data[j + 1]!;
            b += data[j + 2]!;
            n++;
          }
        if (n) next.push([y * w + x, r / n, g / n, b / n]);
      }
    if (!next.length) return { w, h, data };
    for (const [i, r, g, b] of next) {
      data[i * 4] = Math.round(r);
      data[i * 4 + 1] = Math.round(g);
      data[i * 4 + 2] = Math.round(b);
      known[i] = 1;
    }
  }
}

/** The image inside a transparent border `n` px wide. */
export function pad(img: Rgba, n: number): Rgba {
  const w = img.w + 2 * n;
  const h = img.h + 2 * n;
  const data = new Uint8Array(w * h * 4);
  for (let y = 0; y < img.h; y++)
    data.set(img.data.subarray(y * img.w * 4, (y + 1) * img.w * 4), ((y + n) * w + n) * 4);
  return { w, h, data };
}
