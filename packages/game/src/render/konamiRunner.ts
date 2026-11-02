import type Phaser from 'phaser';
import { px } from '../ui';

/** How long the runner takes to cross the screen, ms. */
export const RUN_MS = 1700;

/**
 * The Konami code's effect: the cave explorer (the game's own player sprite) dashes across the
 * bottom of the screen, bobbing at each stride and kicking up dust behind.
 */
export function runAcross(scene: Phaser.Scene): void {
  const w = scene.scale.width;
  const size = px(56);
  const ground = scene.scale.height - px(70);
  const hero = scene.add
    .image(-size, ground, 'player')
    .setDisplaySize(size, size)
    .setOrigin(0.5, 1)
    .setDepth(20);
  // the strides
  const bob = scene.tweens.add({
    targets: hero,
    y: ground - px(7),
    duration: 85,
    yoyo: true,
    repeat: -1,
    ease: 'Sine.easeOut',
  });
  // a little dust where the feet touch the ground
  const dust = scene.time.addEvent({
    delay: 70,
    loop: true,
    callback: () => {
      const d = px(3 + Math.random() * 3);
      const puff = scene.add
        .rectangle(hero.x - size * 0.3, ground - px(2), d, d, 0xc9b38a, 0.8)
        .setDepth(19);
      scene.tweens.add({
        targets: puff,
        x: puff.x - px(10 + Math.random() * 14),
        y: puff.y - px(4 + Math.random() * 10),
        alpha: 0,
        duration: 450,
        onComplete: () => puff.destroy(),
      });
    },
  });
  scene.tweens.add({
    targets: hero,
    x: w + size,
    duration: RUN_MS,
    ease: 'Linear',
    onComplete: () => {
      bob.remove();
      dust.remove();
      hero.destroy();
    },
  });
}
