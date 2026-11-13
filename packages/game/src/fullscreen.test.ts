import { expect, test } from 'vitest';
import { offersFullscreen } from './fullscreen';

test('full screen is offered on a touch screen, in a browser tab that may go full screen', () => {
  const tab = { enabled: true, installed: false, touch: true };
  expect(offersFullscreen(tab)).toBe(true);
  // an iPhone's Safari: no Fullscreen API for a page
  expect(offersFullscreen({ ...tab, enabled: false })).toBe(false);
  // the installed app: already without the browser's bars
  expect(offersFullscreen({ ...tab, installed: true })).toBe(false);
  // a computer: F11, and room enough
  expect(offersFullscreen({ ...tab, touch: false })).toBe(false);
});
