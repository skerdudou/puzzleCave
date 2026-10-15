import type Phaser from 'phaser';
import type { GameEvent } from '@puzzlecave/core';

/**
 * Sound effects, synthesised by ZzFX (no audio files). Each sound is a ZzFX parameter list:
 * paste it into the ZzFX designer (https://killedbyapixel.github.io/ZzFX/) to hear and tune it.
 * Order: volume, randomness, frequency, attack, sustain, release, shape (0 sine, 1 triangle,
 * 2 saw, 3 tan, 4 noise), shapeCurve, slide, deltaSlide, pitchJump, pitchJumpTime, repeatTime,
 * noise, modulation, bitCrush, delay, sustainVolume, decay, tremolo, filter.
 */
export const SOUNDS = {
  step: [0.15, 0.1, 260, 0, 0, 0.03, 1],
  bump: [0.4, 0.05, 90, 0, 0, 0.06, 2, 1, -5],
  push: [0.35, 0.2, 150, 0.01, 0.04, 0.08, 4, 0.5, -2],
  sink: [0.6, 0.3, 400, 0.01, 0.1, 0.3, 4, 1, -8, 0, 0, 0, 0, 0.5],
  key: [0.5, 0, 880, 0.01, 0.05, 0.2, 0, 1, 0, 0, 440, 0.06],
  door: [0.5, 0.05, 200, 0.01, 0.04, 0.15, 2, 1, 0, 0, -80, 0.05],
  undo: [0.25, 0, 600, 0, 0, 0.05, 0, 1, -20],
  drown: [0.7, 0.1, 500, 0.02, 0.2, 0.4, 0, 1, -12, 0, 0, 0, 0, 0.2],
  fail: [0.6, 0, 220, 0.02, 0.3, 0.4, 2, 1, -2, 0, 0, 0, 0, 0, 10],
  win: [0.8, 0, 523, 0.02, 0.25, 0.35, 1, 1, 0, 0, 262, 0.08, 0.16],
} as const satisfies Record<string, readonly number[]>;
export type Sfx = keyof typeof SOUNDS;

/**
 * The sound of one move attempt: the most telling of its events only (a key picked is heard,
 * not the step that reached it). No move at all is a bump.
 */
export function sfxFor(events: readonly GameEvent[]): Sfx {
  const has = (type: GameEvent['type']) => events.some((e) => e.type === type);
  if (has('won')) return 'win';
  if (has('drowned')) return 'drown';
  if (has('keyPicked')) return 'key';
  if (has('doorOpened')) return 'door';
  if (has('blockSank')) return 'sink';
  if (has('pushed')) return 'push';
  if (has('moved')) return 'step';
  return 'bump';
}

/**
 * The sounds of successive move attempts: a bump sounds only the first time, not again while
 * the player keeps walking into the same obstacle (a held key repeats it ten times a second).
 */
export class SfxFeed {
  private bumping = false;

  next(events: readonly GameEvent[]): Sfx | null {
    const s = sfxFor(events);
    const repeat = s === 'bump' && this.bumping;
    this.bumping = s === 'bump';
    return repeat ? null : s;
  }

  reset(): void {
    this.bumping = false;
  }
}

let zzfx: (typeof import('zzfx'))['ZZFX'] | null = null;
let context: AudioContext | null = null;

/**
 * Loads ZzFX and plays it through Phaser's audio context, which Phaser unlocks on the first
 * touch or key (mobile browsers keep audio silent until then). Without Web Audio: no effects.
 */
export function initSfx(game: Phaser.Game): void {
  const ctx = (game.sound as { context?: AudioContext }).context;
  if (!ctx) return;
  context = ctx;
  void import('zzfx').then(({ ZZFX }) => {
    const own = ZZFX.audioContext;
    ZZFX.audioContext = ctx;
    void own.close().catch(() => {});
    ZZFX.volume = 0.3;
    zzfx = ZZFX;
  });
}

/** Plays `s` when the effects are on and the audio unlocked; fails silently otherwise. */
export function playSfx(s: Sfx | null, enabled: boolean): void {
  if (!s || !enabled || !zzfx || context?.state !== 'running') return;
  try {
    zzfx.playSamples([zzfx.buildSamples(...SOUNDS[s])]);
  } catch {
    /* audio unusable: silence */
  }
}
