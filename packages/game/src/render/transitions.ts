import Phaser from 'phaser';
import { prefersReducedMotion } from '../medalReveal';

/** From one screen to another: the one left fades to black, then the new one from black, ms. */
export const FADE_OUT_MS = 120;
export const FADE_IN_MS = 180;

/** A screen's own restart (a resize, a language changed) is no change of screen: no fade. */
export function fades(from: string | undefined, to: string | undefined): boolean {
  return from !== undefined && to !== undefined && from !== to;
}

type Start = Phaser.Scenes.ScenePlugin['start'];

/**
 * Fades between the screens, for every `scene.start` of the game: the screen left fades out (its
 * keys and touches still heard meanwhile; a second start during the fade goes at once), then the
 * new one fades in. None with reduced motion.
 */
export function installTransitions(game: Phaser.Game): void {
  const proto = Phaser.Scenes.ScenePlugin.prototype;
  const start: Start = proto.start;
  /** the fade under way, per screen left: a newer start replaces it */
  const leaving = new WeakMap<Phaser.Scene, object>();
  proto.start = function (this: Phaser.Scenes.ScenePlugin, key, data) {
    const from = (this as unknown as { scene: Phaser.Scene }).scene;
    const fromKey = from.sys.settings.key;
    const toKey = typeof key === 'string' ? key : key?.sys.settings.key;
    if (!fades(fromKey, toKey ?? fromKey) || prefersReducedMotion() || leaving.has(from)) {
      leaving.delete(from);
      return start.call(this, key, data);
    }
    const token = {};
    leaving.set(from, token);
    const cam = from.cameras.main;
    cam.once(Phaser.Cameras.Scene2D.Events.FADE_OUT_COMPLETE, () => {
      if (leaving.get(from) !== token) return;
      leaving.delete(from);
      start.call(this, key, data);
    });
    cam.fadeOut(FADE_OUT_MS, 0, 0, 0);
    return this;
  };

  // the fade in, on the new screen once made
  let shown: string | undefined;
  for (const scene of game.scene.getScenes(false)) {
    scene.events.on(Phaser.Scenes.Events.CREATE, () => {
      const key = scene.sys.settings.key;
      const from = shown;
      shown = key;
      if (!fades(from, key) || prefersReducedMotion()) return;
      scene.cameras.main.fadeIn(FADE_IN_MS, 0, 0, 0);
    });
  }
}
