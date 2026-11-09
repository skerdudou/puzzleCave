import { expect, test } from 'vitest';
import { VOLUME_NOTCHES, channelOfNotch, cleanVolume, notchOfVolume } from './volume';

test('11 notches: off, then 10 % to 100 %', () => {
  expect(VOLUME_NOTCHES).toBe(11);
  expect(notchOfVolume({ on: true, volume: 100 })).toBe(10);
  expect(notchOfVolume({ on: true, volume: 10 })).toBe(1);
  // off: notch 0, whatever its volume
  expect(notchOfVolume({ on: false, volume: 70 })).toBe(0);
});

test('a notch let go: off on notch 0 (the volume kept for the mute button), else on', () => {
  expect(channelOfNotch(0, { on: true, volume: 70 })).toEqual({ on: false, volume: 70 });
  expect(channelOfNotch(4, { on: false, volume: 70 })).toEqual({ on: true, volume: 40 });
  expect(channelOfNotch(10, { on: true, volume: 30 })).toEqual({ on: true, volume: 100 });
});

test('a saved volume comes back on the steps, 100 when unreadable', () => {
  expect(cleanVolume(70)).toBe(70);
  expect(cleanVolume(64)).toBe(60);
  expect(cleanVolume(0)).toBe(10);
  expect(cleanVolume(250)).toBe(100);
  expect(cleanVolume('x')).toBe(100);
  expect(cleanVolume(undefined)).toBe(100);
});
