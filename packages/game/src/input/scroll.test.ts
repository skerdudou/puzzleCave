import { expect, test } from 'vitest';
import {
  clampScroll,
  dropDownTop,
  inertiaStep,
  INERTIA_TAU,
  isDrag,
  maxScroll,
  releaseSpeed,
  scrollThumb,
} from './scroll';

test('no scrolling when the content fits', () => {
  expect(maxScroll(400, 720)).toBe(0);
  expect(clampScroll(50, 400, 720)).toBe(0);
  expect(scrollThumb(0, 400, 720, 20)).toBeNull();
  expect(scrollThumb(0, 720, 720, 20)).toBeNull();
});

test('the offset stays between the top and the bottom of the content', () => {
  expect(maxScroll(440, 360)).toBe(80);
  expect(clampScroll(-10, 440, 360)).toBe(0);
  expect(clampScroll(30, 440, 360)).toBe(30);
  expect(clampScroll(500, 440, 360)).toBe(80);
  // the viewport grew (rotation): the offset shrinks with it
  expect(clampScroll(80, 440, 400)).toBe(40);
});

test('a small movement is still a tap', () => {
  expect(isDrag(3, 4, 5)).toBe(false); // exactly the threshold
  expect(isDrag(0, 6, 5)).toBe(true);
  expect(isDrag(-4, -4, 5)).toBe(true);
});

test('the scroll thumb shows the visible share and the position', () => {
  // half of the content visible: a thumb of half the height
  expect(scrollThumb(0, 800, 400, 20)).toEqual({ top: 0, length: 200 });
  expect(scrollThumb(200, 800, 400, 20)).toEqual({ top: 100, length: 200 });
  expect(scrollThumb(400, 800, 400, 20)).toEqual({ top: 200, length: 200 });
  // very long content: the thumb keeps a minimal length and still reaches the bottom
  expect(scrollThumb(9600, 10000, 400, 40)).toEqual({ top: 360, length: 40 });
});

test('inertia slows down exponentially and stops', () => {
  const a = inertiaStep(1, 16);
  expect(a.dist).toBeCloseTo(INERTIA_TAU * (1 - Math.exp(-16 / INERTIA_TAU)));
  expect(a.v).toBeCloseTo(Math.exp(-16 / INERTIA_TAU));
  // two half steps = one step
  const h1 = inertiaStep(1, 8);
  const h2 = inertiaStep(h1.v, 8);
  expect(h1.dist + h2.dist).toBeCloseTo(a.dist);
  // a flick until it stops
  let v = -2;
  let total = 0;
  for (let i = 0; i < 1000 && v !== 0; i++) {
    const s = inertiaStep(v, 16);
    total += s.dist;
    v = s.v;
  }
  expect(v).toBe(0);
  // the total travel of a flick is v·τ, less the tail cut once too slow (0.02 px/ms)
  expect(Math.abs(total + 2 * INERTIA_TAU)).toBeLessThan(0.02 * INERTIA_TAU + 1);
});

test('release speed from the last samples', () => {
  const samples = [
    { t: 0, y: 0 },
    { t: 200, y: 10 },
    { t: 250, y: 30 },
    { t: 300, y: 60 },
  ];
  expect(releaseSpeed(samples, 300)).toBeCloseTo((60 - 10) / 100);
  expect(releaseSpeed(samples, 1000)).toBe(0); // the finger rested before lifting
  expect(releaseSpeed([{ t: 0, y: 0 }], 0)).toBe(0);
});

test('the drop-down list opens below, else above, else clamped in the viewport', () => {
  // room below
  expect(dropDownTop(100, 20, 150, 360, 8)).toBe(120);
  // no room below, room above
  expect(dropDownTop(300, 20, 150, 360, 8)).toBe(130);
  // room neither below nor above: clamped at the bottom of the viewport
  expect(dropDownTop(180, 20, 300, 360, 8)).toBe(52);
  // list taller than the viewport: its top stays visible
  expect(dropDownTop(180, 20, 400, 360, 8)).toBe(8);
});
