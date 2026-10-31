import { expect, test, vi } from 'vitest';

vi.mock('phaser', () => ({ default: {} }));
vi.stubGlobal('window', { devicePixelRatio: 1 });

import { iconZoom, textStyle, uiScaleFor } from './ui';

test('text uses the pixel font with a monospace fallback', () => {
  expect(textStyle(14).fontFamily).toBe('Silkscreen, monospace');
});

test('the interface grows with the screen past 1280×720, never shrinks', () => {
  expect(uiScaleFor(1280, 720)).toBe(1);
  expect(uiScaleFor(1920, 1080)).toBe(1.5);
  expect(uiScaleFor(2560, 1440)).toBe(2);
  // the smaller ratio: a wide screen grows with its height
  expect(uiScaleFor(2560, 1080)).toBe(1.5);
  expect(uiScaleFor(800, 600)).toBe(1);
  expect(uiScaleFor(390, 844)).toBe(1);
});

test('a 16-px icon follows the interface: the whole zoom nearest device px per base px', () => {
  // dpr × uiScale: a phone (2 × 1), 1280×720 (1 × 1), 1920×1080 (1 × 1.5), 2560×1440 (1 × 2)
  expect(iconZoom(2)).toBe(2);
  expect(iconZoom(1)).toBe(1);
  expect(iconZoom(1.5)).toBe(2);
  expect(iconZoom(3)).toBe(3);
  // never below one art pixel per device pixel
  expect(iconZoom(0.75)).toBe(1);
});
