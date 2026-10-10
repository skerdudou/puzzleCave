import Phaser from 'phaser';
import type { Medal } from '@puzzlecave/core';

export const dpr = (): number => window.devicePixelRatio || 1;
export const px = (n: number): number => Math.round(n * dpr());

export const COLORS = {
  bg: 0x1d1b26,
  panel: '#2c2838',
  text: '#f2efe6',
  dim: '#8a8597',
  accent: '#ffd25e',
  locked: '#55505f',
};
export const MEDAL_COLORS = {
  gold: 0xf5c518,
  silver: 0xc0c0c8,
  bronze: 0xcd7f32,
  platinum: 0x9be7ff,
  none: 0x3a3646,
} as const;

export function textStyle(
  size: number,
  color: string = COLORS.text,
): Phaser.Types.GameObjects.Text.TextStyle {
  return { fontFamily: 'monospace', fontSize: `${px(size)}px`, color };
}

export function makeButton(
  scene: Phaser.Scene,
  x: number,
  y: number,
  label: string,
  onClick: () => void,
  size = 16,
): Phaser.GameObjects.Text {
  const b = scene.add
    .text(x, y, label, {
      ...textStyle(size),
      backgroundColor: COLORS.panel,
      padding: { x: px(8), y: px(4) },
    })
    .setOrigin(0.5)
    .setInteractive({ useHandCursor: true });
  b.on('pointerover', () => b.setColor(COLORS.accent));
  b.on('pointerout', () => b.setColor(COLORS.text));
  b.on('pointerup', onClick);
  return b;
}

export function drawMedal(
  g: Phaser.GameObjects.Graphics,
  x: number,
  y: number,
  r: number,
  medal: Medal | 'platinum' | undefined,
): void {
  if (medal) g.fillStyle(MEDAL_COLORS[medal], 1).fillCircle(x, y, r);
  else g.lineStyle(Math.max(1, px(1)), MEDAL_COLORS.none, 1).strokeCircle(x, y, r);
}
