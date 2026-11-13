import Phaser from 'phaser';
import type { MedalKind } from './medalInfo';
import { FocusList, focusKey } from './input/focusList';
import { isTouchDevice } from './touch';
import { steppedFrame } from './render/frame';
import { t } from './i18n';

/** The pixel font (bundled, see main.ts); monospace while it loads or if it is missing. */
export const FONT = 'Silkscreen, monospace';

/** Device pixels per CSS pixel: converts between the two (hit boxes, debug coordinates). */
export const dpr = (): number => window.devicePixelRatio || 1;

/**
 * How much bigger than its base the interface is drawn on a screen of `cssW×cssH` CSS px: 1 up
 * to 1280×720 (phones, small windows), then with the screen (1920×1080: 1.5, 2560×1440: 2), by
 * the smaller of the two ratios so that the 1280×720 layout always fits.
 */
export function uiScaleFor(cssW: number, cssH: number): number {
  const s = Math.min(cssW / 1280, cssH / 720);
  return s > 1 ? s : 1;
}
export const uiScale = (): number => uiScaleFor(window.innerWidth, window.innerHeight);

/** An interface size (text, padding, margin, HUD…), `n` base px, in device px. */
export const px = (n: number): number => Math.round(n * dpr() * uiScale());
/**
 * A physical size, `n` CSS px, in device px, not grown with the interface (a finger's drag
 * threshold).
 */
export const devicePx = (n: number): number => Math.round(n * dpr());

export const COLORS = {
  bg: 0x1d1b26,
  panel: '#2c2838',
  focus: '#4a4360',
  text: '#f2efe6',
  dim: '#8a8597',
  accent: '#ffd25e',
  locked: '#55505f',
  /** master mode's texts and box */
  master: '#9be7ff',
  /** master mode's rules, muted */
  masterDim: '#6f98aa',
};
export const MEDAL_COLORS = {
  gold: 0xf5c518,
  silver: 0xc0c0c8,
  bronze: 0xcd7f32,
  master: 0xb48cff,
  grandMaster: 0x9be7ff,
  none: 0x3a3646,
} as const;

export function textStyle(
  size: number,
  color: string = COLORS.text,
): Phaser.Types.GameObjects.Text.TextStyle {
  return { fontFamily: FONT, fontSize: `${px(size)}px`, color };
}

/**
 * Lowers a text's size, from `size` (CSS px, the one it was made with) down to `min` at most,
 * until it is no wider than `maxWidth` (device px): long words in some languages, a narrow
 * phone.
 */
export function shrinkToFit(
  text: Phaser.GameObjects.Text,
  size: number,
  maxWidth: number,
  min = 10,
): Phaser.GameObjects.Text {
  while (text.width > maxWidth && size > min) text.setFontSize(`${px(--size)}px`);
  return text;
}

/**
 * Zoom of a 16×16 art drawn 16 base px tall, `scale` device px per base px (dpr × uiScale): the
 * nearest whole one (crisp pixels), at least 1. The icon keeps the same size beside a text on
 * every screen, as the text grows with the interface.
 */
export const iconZoom = (scale: number): number => Math.max(1, Math.round(scale));

const capHeights = new Map<string, number>();
/** Height of the capitals of a CSS font (`"28px Silkscreen, monospace"`), px, measured once. */
function capHeight(font: string): number {
  let h = capHeights.get(font);
  if (h === undefined) {
    const ctx = document.createElement('canvas').getContext('2d');
    if (ctx) ctx.font = font;
    const m = ctx?.measureText('K');
    h = m ? m.actualBoundingBoxAscent : parseInt(font, 10) * 0.7;
    capHeights.set(font, h);
  }
  return h;
}

/**
 * A 16×16 art (`key`, a loaded texture) as an icon beside a text of `size` (textStyle's): 16
 * base px beside the HUD's 14, crisp; smaller with a text shrunk to fit a narrow phone.
 */
export function textIcon(scene: Phaser.Scene, key: string, size = 14): Phaser.GameObjects.Image {
  return scene.add
    .image(0, 0, key)
    .setOrigin(0)
    .setScale(iconZoom((dpr() * uiScale() * size) / 14));
}

/**
 * Puts `icon` at `x` and `text` (origin x 0) right after it, the icon vertically centred on the
 * text's capitals, on whole pixels.
 */
export function placeIconBefore(
  icon: Phaser.GameObjects.Image,
  text: Phaser.GameObjects.Text,
  x: number,
  gap = px(4),
): void {
  const left = Math.round(x);
  icon.setX(left);
  text.setX(left + icon.displayWidth + gap);
  const top = text.y - text.displayHeight * text.originY + (text.padding.top ?? 0);
  const baseline = top + text.getTextMetrics().ascent;
  const cap = capHeight(`${text.style.fontSize} ${FONT}`);
  icon.setY(Math.round(baseline - cap / 2 - icon.displayHeight / 2));
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
      padding: { x: px(8), y: px(4) },
    })
    .setOrigin(0.5);
  if (isTouchDevice()) {
    const min = px(TOUCH_TARGET);
    const padX = px(8) + Math.max(0, Math.ceil((min - b.width) / 2));
    const padY = px(4) + Math.max(0, Math.ceil((min - b.height) / 2));
    b.setPadding(padX, padY, padX, padY);
  }
  attachFrame(b);
  b.setInteractive({ useHandCursor: true });
  b.on('pointerover', () => b.setColor(COLORS.accent));
  b.on('pointerout', () => b.setColor(b.getData('focused') ? COLORS.accent : COLORS.text));
  b.on('pointerup', onClick);
  return b;
}

/**
 * Widens buttons (their side padding, evenly) to the widest of them: a column of buttons of one
 * width. Their origin stays where it was.
 */
export function sameWidth(buttons: readonly Phaser.GameObjects.Text[]): void {
  const widest = Math.max(...buttons.map((b) => b.width));
  for (const b of buttons) {
    const extra = widest - b.width;
    if (extra <= 0) continue;
    const p = b.padding;
    const left = Math.floor(extra / 2);
    b.setPadding(p.left! + left, p.top!, p.right! + extra - left, p.bottom!);
  }
}

/** Keyboard focus on a button: lit like under the mouse, on a lighter background. */
export function setButtonFocus(b: Phaser.GameObjects.Text, on: boolean): void {
  b.setData('focused', on);
  b.setColor(on ? COLORS.accent : COLORS.text);
  // the frame behind the button (see attachFrame) reads 'focused' on its next sync
}

/** A CSS colour string as a Phaser number. */
export const hex = (css: string): number => Phaser.Display.Color.HexStringToColor(css).color;
const FRAME_DARK = 0x15131c;
const FRAME_LIGHT_FOCUS = '#6a6084';

/**
 * Draws a stepped, bevelled button frame of `w×h` at the Graphics' origin. Focus lights the
 * fill and the top-left edge but keeps the bevel visible.
 */
export function paintFrame(
  g: Phaser.GameObjects.Graphics,
  w: number,
  h: number,
  pressed: boolean,
  focused = false,
): void {
  g.clear();
  const light = hex(focused ? FRAME_LIGHT_FOCUS : COLORS.focus);
  const fill = hex(focused ? COLORS.focus : COLORS.panel);
  for (const r of steppedFrame(w, h, px(2), pressed)) {
    const color = r.tone === 'dark' ? FRAME_DARK : r.tone === 'light' ? light : fill;
    g.fillStyle(color, 1).fillRect(r.x, r.y, r.w, r.h);
  }
}

/**
 * The stepped, bevelled frame behind a button's Text: a Graphics that follows the Text (box,
 * visibility, alpha, depth, scroll factor) on each PRE_RENDER, so that scenes keep moving,
 * re-padding, hiding and destroying the Text alone. Pressed while the pointer holds it.
 */
function attachFrame(b: Phaser.GameObjects.Text): void {
  const scene = b.scene;
  const g = scene.add.graphics();
  let pressed = false;
  let drawn = '';
  const sync = () => {
    const bounds = b.getBounds();
    const w = Math.round(bounds.width);
    const h = Math.round(bounds.height);
    const focused = !!b.getData('focused');
    g.setPosition(Math.round(bounds.x), Math.round(bounds.y))
      .setVisible(b.visible)
      .setAlpha(b.alpha)
      .setScrollFactor(b.scrollFactorX, b.scrollFactorY);
    if (g.depth !== b.depth - 1) {
      g.setDepth(b.depth - 1);
      // the scene sorts by depth before PRE_RENDER: sorted now, else for one frame the frame is
      // drawn at its old depth (a button over a band: the band hid it, a flicker)
      scene.sys.displayList.depthSort();
    }
    const key = `${w}x${h}${pressed}${focused}`;
    if (key === drawn) return;
    drawn = key;
    paintFrame(g, w, h, pressed, focused);
  };
  sync();
  scene.events.on(Phaser.Scenes.Events.PRE_RENDER, sync);
  b.on('pointerdown', () => (pressed = true));
  b.on('pointerup', () => (pressed = false));
  b.on('pointerout', () => (pressed = false));
  // Gone with the Text: destroyed, taken off the display list (a scene that clears its children
  // without destroying them), or the scene shutting down.
  const cleanup = () => {
    scene.events.off(Phaser.Scenes.Events.PRE_RENDER, sync);
    scene.events.off(Phaser.Scenes.Events.SHUTDOWN, cleanup);
    b.off(Phaser.GameObjects.Events.DESTROY, cleanup);
    b.off(Phaser.GameObjects.Events.REMOVED_FROM_SCENE, cleanup);
    g.destroy();
  };
  b.once(Phaser.GameObjects.Events.DESTROY, cleanup);
  b.once(Phaser.GameObjects.Events.REMOVED_FROM_SCENE, cleanup);
  scene.events.once(Phaser.Scenes.Events.SHUTDOWN, cleanup);
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

export interface ThresholdLineOptions {
  size?: number;
  /** the width the line must fit in (default: the screen less 8 px on each side) */
  maxWidth?: number;
  /**
   * The medals' names: each limit is then written "● name ≤ x", without the label, when that
   * fits in `maxWidth`; otherwise the line falls back to "label ● ≤ x ● ≤ y", then (still too
   * wide) to "● ≤ x ● ≤ y".
   */
  named?: (medal: MedalKind) => string;
}

/** A centered line "label ● ≤ a ● ≤ b ● ≤ c" (medal dot then its limit, for each medal). */
export function drawThresholdLine(
  scene: Phaser.Scene,
  g: Phaser.GameObjects.Graphics,
  cx: number,
  y: number,
  label: string,
  tiers: readonly { medal: MedalKind; text: string }[],
  opts: ThresholdLineOptions = {},
): void {
  const size = opts.size ?? 11;
  const maxWidth = opts.maxWidth ?? scene.scale.width - px(16);
  const r = px(size / 2.5);
  const dot = 2 * r + px(4);
  const layout = (head: string, texts: string[]) => {
    const items = tiers.map((tier, k) => ({
      tier,
      text: scene.add.text(0, y, texts[k]!, textStyle(size, COLORS.dim)).setOrigin(0, 0.5),
    }));
    const headText = scene.add.text(0, y, head, textStyle(size, COLORS.dim)).setOrigin(0, 0.5);
    const content = headText.width + items.reduce((w, i) => w + dot + i.text.width, 0);
    return { items, head: headText, content };
  };
  // the first of these that fits: the medals named (with `named`), the label then the limits,
  // the limits alone (the medal marks say which they are)
  const named = opts.named;
  const plain = tiers.map((tier) => tier.text);
  const candidates: [string, string[]][] = [];
  if (named) candidates.push(['', tiers.map((tier) => `${named(tier.medal)} ${tier.text}`)]);
  candidates.push([label, plain]);
  if (label) candidates.push(['', plain]);
  let line = layout(...candidates[0]!);
  for (const next of candidates.slice(1)) {
    if (line.content + px(4) * tiers.length <= maxWidth) break;
    for (const o of [line.head, ...line.items.map((i) => i.text)]) o.destroy();
    line = layout(...next);
  }
  const { items, head, content } = line;
  // four medals on a narrow phone: the gaps shrink to keep the line on screen
  const room = maxWidth - content;
  const gap = items.length ? Math.max(px(4), Math.min(px(12), room / items.length)) : px(12);
  // no label: no gap before the first medal
  const lead = head.width ? 0 : gap;
  const width = content + gap * items.length - lead;
  let x = cx - width / 2 - lead;
  head.setX(x + lead);
  x += head.width;
  for (const i of items) {
    x += gap;
    drawMedal(g, x + r, y, r, i.tier.medal);
    x += dot;
    i.text.setX(x);
    x += i.text.width;
  }
}

/** Master mode's box: inner margin and line height, base px. */
export const MASTER_BOX = { pad: 6, line: 18 } as const;

/** Master mode's box title (the mode's name) line height, base px, above its rules. */
export const MASTER_BOX_NAME = 16;

/** The style of master mode's rules, under the box's title, wrapped in `width` (device px). */
export function masterRulesStyle(width: number): Phaser.Types.GameObjects.Text.TextStyle {
  return { ...textStyle(10, COLORS.masterDim), align: 'center', wordWrap: { width } };
}

/**
 * Master mode's box, from its top: the mode's name, then its rules under it, muted (wrapped in
 * the box less its margins); returns the bottom of the rules, where the box's lines start.
 */
export function masterBoxTitle(
  scene: Phaser.Scene,
  cx: number,
  top: number,
  width: number,
  name: string,
  rules: string,
): number {
  const y = top + px(MASTER_BOX.pad);
  scene.add.text(cx, y, name, textStyle(12, COLORS.master)).setOrigin(0.5, 0);
  return scene.add
    .text(cx, y + px(MASTER_BOX_NAME), rules, masterRulesStyle(width - 2 * px(MASTER_BOX.pad)))
    .setOrigin(0.5, 0)
    .getBounds().bottom;
}

/** The outline of master mode's box, centred on cx. */
export function strokeMasterBox(
  g: Phaser.GameObjects.Graphics,
  cx: number,
  top: number,
  width: number,
  bottom: number,
): void {
  g.lineStyle(Math.max(1, px(1)), MEDAL_COLORS.grandMaster, 0.7);
  g.strokeRoundedRect(cx - width / 2, top, width, bottom - top, px(6));
}

export function drawMedal(
  g: Phaser.GameObjects.Graphics,
  x: number,
  y: number,
  r: number,
  medal: MedalKind | undefined,
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

/** Points of a three-pointed crown centred on (x, y), `r` the medal's radius. */
function crownPoints(x: number, y: number, r: number): Phaser.Math.Vector2[] {
  const p = (dx: number, dy: number) => new Phaser.Math.Vector2(x + dx * r, y + dy * r);
  return [
    p(-0.58, 0.36),
    p(-0.58, -0.3),
    p(-0.29, 0.02),
    p(0, -0.46),
    p(0.29, 0.02),
    p(0.58, -0.3),
    p(0.58, 0.36),
  ];
}

/**
 * A medal, a coin with a darker rim, told apart by its mark as well as by its colour (for the
 * colour-blind, and silver next to grand master): bronze plain, silver an inner ring, gold a
 * star; master mode's medals: master a crown on violet, grand master (the former platinum) a
 * white four-pointed sparkle on ice blue.
 */
export function paintMedal(
  g: Phaser.GameObjects.Graphics,
  x: number,
  y: number,
  r: number,
  medal: MedalKind,
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
    case 'master':
      g.fillStyle(mark, 1).fillPoints(crownPoints(x, y, r), true);
      break;
    case 'grandMaster':
      g.fillStyle(0xffffff, 1).fillPoints(starPoints(x, y, 4, r * 0.72, r * 0.3), true);
      break;
  }
}

/** The band at the top of the menu screens (level selection, options, achievements), base px. */
export const HEADER_BAND = 48;

/**
 * The band at the top of a menu screen, fixed on it while the content scrolls under it: `back`
 * (made by the caller: its own focus and drag rules) at its left, its left side at `backLeft`
 * (device px), and `title` in the middle (pushed right where the screen is too narrow for both).
 * It catches the presses on it: a control scrolled under it is not pressed through it.
 */
export function headerBand(
  scene: Phaser.Scene,
  title: string,
  back: Phaser.GameObjects.Text,
  backLeft: number,
): Phaser.GameObjects.Text {
  const h = px(HEADER_BAND);
  scene.add
    .rectangle(0, 0, scene.scale.width, h, hex(COLORS.panel))
    .setOrigin(0)
    .setScrollFactor(0)
    .setDepth(10)
    .setInteractive();
  // above the band (a button's frame sits one below the button)
  back
    .setOrigin(0, 0.5)
    .setPosition(Math.max(px(12), backLeft), h / 2)
    .setScrollFactor(0)
    .setDepth(12);
  const cx = scene.scale.width / 2;
  const name = scene.add
    .text(cx, h / 2, title, textStyle(16, COLORS.accent))
    .setOrigin(0.5)
    .setScrollFactor(0)
    .setDepth(12);
  name.setX(Math.max(cx, back.getBounds().right + px(12) + name.width / 2));
  return name;
}

/** Copies `text`, and says on `button` whether it worked. */
export async function copyToClipboard(
  text: string,
  button: Phaser.GameObjects.Text,
): Promise<void> {
  try {
    await navigator.clipboard.writeText(text);
    button.setText(t('copied'));
  } catch {
    // clipboard refused (no focus, permission): said on the button, the text left in the console
    button.setText(t('copyFailed'));
    console.log(text);
  }
}
