import Phaser from 'phaser';
import type { Medal } from '@puzzlecave/core';
import { FocusList, focusKey } from './input/focusList';
import { isTouchDevice } from './touch';

export const dpr = (): number => window.devicePixelRatio || 1;
export const px = (n: number): number => Math.round(n * dpr());

export const COLORS = {
  bg: 0x1d1b26,
  panel: '#2c2838',
  focus: '#4a4360',
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
  b.on('pointerout', () => b.setColor(b.getData('focused') ? COLORS.accent : COLORS.text));
  b.on('pointerup', onClick);
  return b;
}

/** Keyboard focus on a button: lit like under the mouse, on a lighter background. */
export function setButtonFocus(b: Phaser.GameObjects.Text, on: boolean): void {
  b.setData('focused', on);
  b.setColor(on ? COLORS.accent : COLORS.text);
  b.setBackgroundColor(on ? COLORS.focus : COLORS.panel);
}

export interface Focusable {
  id: string;
  button: Phaser.GameObjects.Text;
  press: () => void;
}

/**
 * Keyboard navigation among a screen's buttons (arrows or Tab, then Enter or Space). Nothing is
 * focused until the first arrow or Tab, so the mouse and touch players see no focus at all.
 */
export class KeyFocus {
  private readonly list: FocusList;

  /** `focusedId`: the button focused before the screen was rebuilt (an option changed). */
  constructor(
    private readonly items: readonly Focusable[],
    focusedId: string | null = null,
    private readonly onFocus: (item: Focusable) => void = () => {},
  ) {
    this.list = new FocusList(
      items.length,
      items.findIndex((i) => i.id === focusedId),
    );
    if (this.focused) this.show();
  }

  get focused(): Focusable | null {
    return this.items[this.list.index] ?? null;
  }

  /** Handles a key; true when it was for the focus (the screen ignores it then). */
  key(e: KeyboardEvent): boolean {
    const action = focusKey(e);
    if (!action) return false;
    if (action === 'activate') {
      const item = this.focused;
      if (!item) return false;
      e.preventDefault();
      item.press();
      return true;
    }
    e.preventDefault();
    for (const i of this.items) setButtonFocus(i.button, false);
    this.list.move(action === 'next' ? 1 : -1);
    this.show();
    return true;
  }

  private show(): void {
    const item = this.focused;
    if (!item) return;
    setButtonFocus(item.button, true);
    this.onFocus(item);
  }
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
  if (medal) paintMedal(g, x, y, r, medal);
  else g.lineStyle(Math.max(1, px(1)), MEDAL_COLORS.none, 1).strokeCircle(x, y, r);
}

/** A colour darkened by `k` (0: unchanged, 1: black). */
export function shade(color: number, k: number): number {
  const c = (shift: number) => Math.round(((color >> shift) & 0xff) * (1 - k));
  return (c(16) << 16) | (c(8) << 8) | c(0);
}

/** Points of a star of `n` branches around (x, y), the first one pointing up. */
export function starPoints(
  x: number,
  y: number,
  n: number,
  outer: number,
  inner: number,
): Phaser.Math.Vector2[] {
  const points: Phaser.Math.Vector2[] = [];
  for (let i = 0; i < 2 * n; i++) {
    const a = -Math.PI / 2 + (i * Math.PI) / n;
    const d = i % 2 ? inner : outer;
    points.push(new Phaser.Math.Vector2(x + Math.cos(a) * d, y + Math.sin(a) * d));
  }
  return points;
}

/**
 * A medal, a coin with a darker rim, told apart by its mark as well as by its colour (for the
 * colour-blind, and silver next to platinum): bronze plain, silver an inner ring, gold a star,
 * platinum a white four-pointed sparkle.
 */
export function paintMedal(
  g: Phaser.GameObjects.Graphics,
  x: number,
  y: number,
  r: number,
  medal: Medal | 'platinum',
): void {
  const color = MEDAL_COLORS[medal];
  const rim = Math.max(1, r / 6);
  g.fillStyle(color, 1).fillCircle(x, y, r);
  g.lineStyle(rim, shade(color, 0.35), 1).strokeCircle(x, y, r - rim / 2);
  const mark = shade(color, 0.4);
  switch (medal) {
    case 'silver':
      g.lineStyle(rim, mark, 1).strokeCircle(x, y, r * 0.5);
      break;
    case 'gold':
      g.fillStyle(mark, 1).fillPoints(starPoints(x, y, 5, r * 0.62, r * 0.26), true);
      break;
    case 'platinum':
      g.fillStyle(0xffffff, 1).fillPoints(starPoints(x, y, 4, r * 0.72, r * 0.3), true);
      break;
  }
}
