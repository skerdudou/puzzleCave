import { expect, test } from 'vitest';
import { bleed, cropClamped, pad, type Rgba } from './upscale';

const O = [0, 0, 0, 255]; // black
const W = [255, 255, 255, 255]; // white
const T = [9, 9, 9, 0]; // transparent

const image = (rows: number[][][]): Rgba => ({
  w: rows[0]!.length,
  h: rows.length,
  data: Uint8Array.from(rows.flat(2)),
});
const at = (img: Rgba, x: number, y: number) =>
  Array.from(img.data.slice((y * img.w + x) * 4, (y * img.w + x) * 4 + 4));

test('bleed: transparent pixels take the colour of the visible ones near them, alpha kept', () => {
  const img = bleed(
    image([
      [T, T, T],
      [T, [200, 100, 50, 255], T],
      [T, T, T],
    ]),
  );
  expect(at(img, 0, 0)).toEqual([200, 100, 50, 0]);
  expect(at(img, 1, 1)).toEqual([200, 100, 50, 255]);
  const far = bleed(image([[O, T, T, T]]));
  expect(at(far, 3, 0)).toEqual([0, 0, 0, 0]);
});

test('pad: the image inside a transparent border', () => {
  const padded = pad(
    image([
      [O, W],
      [T, O],
    ]),
    2,
  );
  expect(padded.w).toBe(6);
  expect(at(padded, 0, 0)[3]).toBe(0);
  expect(at(padded, 2, 2)).toEqual(O);
  expect(at(padded, 3, 2)).toEqual(W);
  expect(at(padded, 3, 3)).toEqual(O);
});

test('cropClamped: inside, a crop; past the edges, the edge pixels repeated', () => {
  const img = image([
    [O, W],
    [W, O],
  ]);
  const c = cropClamped(img, -1, -1, 4, 4);
  expect(at(c, 0, 0)).toEqual(O); // the corner repeated
  expect(at(c, 1, 1)).toEqual(O);
  expect(at(c, 2, 1)).toEqual(W);
  expect(at(c, 3, 1)).toEqual(W); // the right edge repeated
  expect(at(c, 3, 3)).toEqual(O);
});
