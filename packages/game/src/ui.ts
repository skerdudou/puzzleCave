import Phaser from 'phaser';
import type { Medal } from '@puzzlecave/core';
import { isTouchDevice } from './touch';

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

/**
 * Smallest button on a touch screen, CSS px on each side (Apple asks for 44 pt, Material for
 * 48 dp): a finger covers about that much.
 */
export const TOUCH_TARGET = 44;

/**
 * A text button. On a touch screen its box (drawn and hit) grows to at least TOUCH_TARGET on
 * each side, the label staying centred.
 */
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
    .setOrigin(0.5);
  if (isTouchDevice()) {
    const min = px(TOUCH_TARGET);
    const padX = px(8) + Math.max(0, Math.ceil((min - b.width) / 2));
    const padY = px(4) + Math.max(0, Math.ceil((min - b.height) / 2));
    b.setPadding(padX, padY, padX, padY);
  }
  b.setInteractive({ useHandCursor: true });
  b.on('pointerover', () => b.setColor(COLORS.accent));
  b.on('pointerout', () => b.setColor(COLORS.text));
  b.on('pointerup', onClick);
  return b;
}

/** A centered line "label ● ≤ a ● ≤ b ● ≤ c" (medal dot then its limit, for each medal). */
export function drawThresholdLine(
  scene: Phaser.Scene,
  g: Phaser.GameObjects.Graphics,
  cx: number,
  y: number,
  label: string,
  tiers: readonly { medal: Medal | 'platinum'; text: string }[],
  size = 11,
): void {
  const items = tiers.map((tier) => ({
    tier,
    text: scene.add.text(0, y, tier.text, textStyle(size, COLORS.dim)).setOrigin(0, 0.5),
  }));
  const head = scene.add.text(0, y, label, textStyle(size, COLORS.dim)).setOrigin(0, 0.5);
  const r = px(size / 2.5);
  const dot = 2 * r + px(4);
  // four medals (with platinum) on a narrow phone: the gaps shrink to keep the line on screen
  const content = head.width + items.reduce((w, i) => w + dot + i.text.width, 0);
  const room = scene.scale.width - px(16) - content;
  const gap = items.length ? Math.max(px(4), Math.min(px(12), room / items.length)) : px(12);
  const width = content + gap * items.length;
  let x = cx - width / 2;
  head.setX(x);
  x += head.width;
  for (const i of items) {
    x += gap;
    drawMedal(g, x + r, y, r, i.tier.medal);
    x += dot;
    i.text.setX(x);
    x += i.text.width;
  }
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
