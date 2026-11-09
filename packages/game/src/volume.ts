// The music's and the sound effects' volume gauges (pure, no Phaser): 11 notches, "off" then
// 10 % to 100 %.

/** A channel: on or off (the game's mute button switches both), and its volume when on (%). */
export interface Channel {
  on: boolean;
  volume: number;
}

export const VOLUME_STEP = 10;
export const VOLUME_MIN = 10;
export const VOLUME_MAX = 100;
/** the gauge's notches: off, then a notch per step up to 100 % */
export const VOLUME_NOTCHES = VOLUME_MAX / VOLUME_STEP + 1;

/** A saved volume brought back to the gauge's steps (100 when unreadable). */
export function cleanVolume(v: unknown): number {
  if (typeof v !== 'number' || !Number.isFinite(v)) return VOLUME_MAX;
  const stepped = Math.round(v / VOLUME_STEP) * VOLUME_STEP;
  return Math.min(VOLUME_MAX, Math.max(VOLUME_MIN, stepped));
}

/** The notch a channel is on: 0 when off. */
export function notchOfVolume(c: Channel): number {
  return c.on ? c.volume / VOLUME_STEP : 0;
}

/** The channel the knob let go on notch `i` gives: off on notch 0 (its volume kept), else on. */
export function channelOfNotch(i: number, c: Channel): Channel {
  return i === 0 ? { on: false, volume: c.volume } : { on: true, volume: i * VOLUME_STEP };
}
