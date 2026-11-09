import Phaser from 'phaser';

/** The music's volume at 100 % in the options. */
const FULL = 0.5;

let current: Phaser.Sound.BaseSound | null = null;
let currentKey: string | null = null;
/** the options' music volume, 0–1 */
let level = 1;

/** The options' music volume (%), applied at once to the music playing. */
export function setMusicVolume(percent: number): void {
  level = percent / 100;
  (current as Phaser.Sound.WebAudioSound | Phaser.Sound.HTML5AudioSound | null)?.setVolume(
    FULL * level,
  );
}

export function syncMusic(
  scene: Phaser.Scene,
  enabled: boolean,
  key: 'music-menu' | 'music-game',
): void {
  if (!enabled) {
    current?.stop();
    return;
  }
  if (currentKey !== key) {
    current?.stop();
    current?.destroy();
    current = scene.sound.add(key, { loop: true, volume: FULL * level });
    currentKey = key;
  }
  if (current?.isPlaying) return;
  const start = () => current?.play();
  if (scene.sound.locked) scene.sound.once(Phaser.Sound.Events.UNLOCKED, start);
  else start();
}
