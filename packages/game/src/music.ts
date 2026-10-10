import Phaser from 'phaser';

let current: Phaser.Sound.BaseSound | null = null;
let currentKey: string | null = null;

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
    current = scene.sound.add(key, { loop: true, volume: 0.5 });
    currentKey = key;
  }
  if (current?.isPlaying) return;
  const start = () => current?.play();
  if (scene.sound.locked) scene.sound.once(Phaser.Sound.Events.UNLOCKED, start);
  else start();
}
