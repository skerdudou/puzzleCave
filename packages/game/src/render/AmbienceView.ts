import Phaser from 'phaser';
import { app } from '../app';
import { setDebug } from '../debug';
import { prefersReducedMotion } from '../medalReveal';
import { COLORS } from '../ui';
import {
  BOARD_LIGHT_CUT,
  DARK_OUTSIDE,
  chapterTint,
  frostPosition,
  frostTwinkle,
  initMotes,
  lightRadius,
  moteAlpha,
  motePosition,
  rockStones,
  tensionAlpha,
  vignetteRadii,
  type Mote,
  type Rect,
} from './ambience';
import type { BoardLayout } from './layout';

/** Board stays at depth 0; HUD buttons and text go above `hudBand`. */
export const AMBIENCE_DEPTH = { rock: -20, overlay: 2, vignette: 3, hudBand: 4 } as const;
/** HUD texts and buttons, the d-pad: above the whole ambience (a button's frame sits 1 below). */
export const HUD_DEPTH = 7;

/** Torch radius without flicker (art px); the glow texture is sized for it. */
const BASE_RADIUS = 78;
/** The warm glow reaches 0.9 R, as in the mock-up. */
const GLOW_RADIUS = Math.ceil(BASE_RADIUS * 0.9);
/**
 * Strength of the glow. The mock-up uses a soft-light blend at 0.55, which a canvas cannot apply
 * over the WebGL scene. Soft light with an orange both lifts the red and lowers the blue: the same
 * glow texture is drawn twice, multiplied (it takes off blue and some green) and added (it brings
 * the red), so that the pool reads warm over every chapter's tint, not grey or greenish.
 */
const GLOW_ADD = 0.32;
const GLOW_MULTIPLY = 0.7;
const MOTE_RGB = '220,212,235';
/** master mode's frost motes */
const FROST_RGB = '200,240,255';
const GLOW_WARM_RGB = '255,170,80';
/** master mode's cold torch */
const GLOW_COLD_RGB = '110,200,255';

const css = (color: number): string => '#' + color.toString(16).padStart(6, '0');

let nextId = 0;

/**
 * The cave around the board: rock fading out from it, torchlight following the hero, dust motes,
 * a vignette and a band behind the HUD. Everything is drawn in art pixels (device px / board
 * zoom) on canvas textures shown with nearest filtering, aligned with the board's cells.
 */
export class AmbienceView {
  private readonly scene: Phaser.Scene;
  private hudHeight: number;
  /** the band's width, device px (the whole screen: a band across the top) */
  private hudWidth: number | undefined;
  private readonly tint: number | null;
  private readonly reducedMotion: boolean;
  private readonly keys: {
    rock: string;
    overlay: string;
    glow: string;
    vignette: string;
    tension: string;
  };
  /** master mode: a cold torch, frost instead of dust, a red vignette in the last seconds */
  private readonly master: boolean;
  /** master mode's countdown in its warning span (see setTension), else null */
  private tensionState: { leftMs: number; warnMs: number } | null = null;
  private tension: Phaser.GameObjects.Image | null = null;

  private rock: Phaser.GameObjects.Image | null = null;
  private overlay: Phaser.GameObjects.Image | null = null;
  private glow: Phaser.GameObjects.Image | null = null;
  /** the glow's multiplied half (see GLOW_MULTIPLY) */
  private warm: Phaser.GameObjects.Image | null = null;
  private vignette: Phaser.GameObjects.Image | null = null;
  private band: Phaser.GameObjects.Rectangle | null = null;
  private overlayTex: Phaser.Textures.CanvasTexture | null = null;

  /** art-pixel geometry from the last `layout` */
  private scale = 1;
  private originX = 0;
  private originY = 0;
  private artW = 0;
  private artH = 0;
  private board: Rect = { x: 0, y: 0, w: 0, h: 0 };
  private stoneCount = 0;
  private motes: Mote[] = [];
  /** the overlay texture is known to be empty (light and dust both off) */
  private overlayBlank = false;
  /** settings last reported to the debug state */
  private shown: { torchlight: boolean; dust: boolean; vignette: boolean } | null = null;

  constructor(scene: Phaser.Scene, opts: { levelId: string; hudHeight: number; master?: boolean }) {
    this.scene = scene;
    this.hudHeight = opts.hudHeight;
    this.tint = chapterTint(opts.levelId);
    this.reducedMotion = prefersReducedMotion();
    this.master = opts.master ?? false;
    const id = nextId++;
    this.keys = {
      rock: `ambience-rock-${id}`,
      overlay: `ambience-overlay-${id}`,
      glow: `ambience-glow-${id}`,
      vignette: `ambience-vignette-${id}`,
      tension: `ambience-tension-${id}`,
    };
    scene.game.renderer.on(Phaser.Renderer.Events.RESTORE_WEBGL, this.restore, this);
  }

  /**
   * The WebGL context lost then restored (a phone's browser back from the background): Phaser
   * uploads the textures again from their canvases, which the browser may have wiped meanwhile.
   * The layers drawn once per layout are drawn again; the light and the dust, at the next frame.
   */
  private restore(): void {
    if (!this.overlayTex) return;
    this.drawRock();
    this.drawGlow();
    this.drawVignette();
    this.overlayBlank = false;
  }

  /**
   * Rebuilds the rock, the vignette and the canvas sizes for a new board layout or screen size;
   * `hudHeight` (device px) when the HUD's height changed with it, `hudWidth` when the HUD is a
   * column on the left (undefined: a band across the top).
   */
  layout(board: BoardLayout, hudHeight = this.hudHeight, hudWidth?: number): void {
    this.hudHeight = hudHeight;
    this.hudWidth = hudWidth;
    const s = board.scale;
    const screenW = this.scene.scale.width;
    const screenH = this.scene.scale.height;
    // the textures start at most one art pixel left of / above the screen so that their pixel
    // grid matches the board's
    const bx = Math.ceil(board.x / s - 1e-6);
    const by = Math.ceil(board.y / s - 1e-6);
    this.scale = s;
    this.originX = board.x - bx * s;
    this.originY = board.y - by * s;
    this.artW = Math.ceil((screenW - this.originX) / s);
    this.artH = Math.ceil((screenH - this.originY) / s);
    this.board = { x: bx, y: by, w: Math.round(board.width / s), h: Math.round(board.height / s) };
    this.motes = initMotes(this.artW, this.artH);

    this.drawRock();
    this.overlayTex = this.canvas(this.keys.overlay, this.artW, this.artH);
    this.overlay = this.place(this.overlay, this.keys.overlay, AMBIENCE_DEPTH.overlay);
    this.drawGlow();
    this.drawVignette();

    this.band?.destroy();
    this.band = this.scene.add
      .rectangle(0, 0, this.hudWidth ?? screenW, this.hudHeight, COLORS.bg, 0.55)
      .setOrigin(0)
      .setDepth(AMBIENCE_DEPTH.hudBand);

    this.shown = null;
    this.overlayBlank = false;
    this.report();
  }

  /**
   * Master mode's countdown while it warns (`leftMs` left of the `warnMs` warning span): the red
   * vignette and its heartbeat; null outside it (and once the run is over).
   */
  setTension(state: { leftMs: number; warnMs: number } | null): void {
    this.tensionState = state;
  }

  /** Redraws the light and the dust; `hero` is the hero's centre in device px. */
  update(timeMs: number, hero: [number, number]): void {
    const tex = this.overlayTex;
    if (!tex || !this.glow) return;
    const { torchlight, dust, vignette } = app.data.settings;
    this.report();
    this.vignette?.setVisible(vignette);
    if (this.tension) {
      const ts = this.tensionState;
      const a = ts ? tensionAlpha(ts.leftMs, ts.warnMs, this.reducedMotion) : 0;
      this.tension.setVisible(a > 0).setAlpha(a);
    }
    const t = timeMs / 1000;
    const s = this.scale;
    const W = this.artW;
    const H = this.artH;
    const hx = (hero[0] - this.originX) / s;
    const hy = (hero[1] - this.originY) / s;
    // nothing to draw: the overlay is cleared once, then left alone
    if (!torchlight && !dust) {
      this.warm?.setVisible(false);
      this.glow.setVisible(false);
      if (!this.overlayBlank) {
        tex.context.clearRect(0, 0, W, H);
        tex.refresh();
        this.overlayBlank = true;
      }
      return;
    }
    this.overlayBlank = false;
    const g = tex.context;
    g.globalCompositeOperation = 'source-over';
    g.globalAlpha = 1;
    g.clearRect(0, 0, W, H);
    if (torchlight) {
      const R = lightRadius(t, this.reducedMotion);
      g.fillStyle = `rgba(6,5,12,${DARK_OUTSIDE})`;
      g.fillRect(0, 0, W, H);
      g.globalCompositeOperation = 'destination-out';
      // the board is never darker than about 30 %
      g.fillStyle = `rgba(0,0,0,${BOARD_LIGHT_CUT})`;
      const b = this.board;
      g.fillRect(b.x, b.y, b.w, b.h);
      const hole = g.createRadialGradient(hx, hy, 4, hx, hy, R);
      hole.addColorStop(0, 'rgba(0,0,0,1)');
      hole.addColorStop(1, 'rgba(0,0,0,0)');
      g.fillStyle = hole;
      g.fillRect(0, 0, W, H);
      g.globalCompositeOperation = 'source-over';
      // the glow follows the hero on the art pixel grid and breathes with the flicker
      const x = this.originX + (Math.floor(hx) - GLOW_RADIUS) * s;
      const y = this.originY + (Math.floor(hy) - GLOW_RADIUS) * s;
      const breath = R / BASE_RADIUS;
      this.warm
        ?.setVisible(true)
        .setPosition(x, y)
        .setAlpha(GLOW_MULTIPLY * breath);
      this.glow
        .setVisible(true)
        .setPosition(x, y)
        .setAlpha(GLOW_ADD * breath);
    } else {
      this.warm?.setVisible(false);
      this.glow.setVisible(false);
    }
    if (dust) {
      for (const m of this.motes) {
        const [x, y] = (this.master ? frostPosition : motePosition)(m, t, W, H, this.reducedMotion);
        let a = moteAlpha(Math.hypot(x - hx, y - hy), torchlight);
        if (this.master) a = frostTwinkle(a, m, t, this.reducedMotion);
        g.fillStyle = `rgba(${this.master ? FROST_RGB : MOTE_RGB},${a.toFixed(2)})`;
        g.fillRect(Math.round(x), Math.round(y), 1, 1);
      }
    }
    tex.refresh();
  }

  destroy(): void {
    this.scene.game.renderer.off(Phaser.Renderer.Events.RESTORE_WEBGL, this.restore, this);
    for (const o of [
      this.rock,
      this.overlay,
      this.warm,
      this.glow,
      this.vignette,
      this.tension,
      this.band,
    ])
      o?.destroy();
    this.rock = this.overlay = this.warm = this.glow = this.vignette = this.tension = null;
    this.band = null;
    this.overlayTex = null;
    const textures = this.scene.textures;
    for (const key of Object.values(this.keys)) if (textures.exists(key)) textures.remove(key);
  }

  private drawRock(): void {
    const tex = this.canvas(this.keys.rock, this.artW, this.artH);
    const g = tex.context;
    g.imageSmoothingEnabled = false;
    g.globalCompositeOperation = 'source-over';
    g.globalAlpha = 1;
    g.fillStyle = css(COLORS.bg);
    g.fillRect(0, 0, this.artW, this.artH);
    const stone = this.scene.textures.get('WALL').getSourceImage() as CanvasImageSource;
    // the stones' 16-px grid is laid on the board's cells: shifted by the board's offset
    const b = this.board;
    const ox = ((b.x % 16) + 16) % 16;
    const oy = ((b.y % 16) + 16) % 16;
    const stones = rockStones(
      { x: -ox, y: -oy, w: this.artW, h: this.artH },
      { ...b, x: b.x - ox, y: b.y - oy },
    );
    for (const st of stones) {
      g.globalAlpha = st.alpha;
      g.drawImage(stone, st.x + ox, st.y + oy);
    }
    g.globalAlpha = 1;
    if (this.tint !== null) {
      g.globalCompositeOperation = 'color';
      g.globalAlpha = 0.55;
      g.fillStyle = css(this.tint);
      g.fillRect(0, 0, this.artW, this.artH);
      g.globalCompositeOperation = 'source-over';
      g.globalAlpha = 1;
    }
    tex.refresh();
    this.stoneCount = stones.length;
    this.rock = this.place(this.rock, this.keys.rock, AMBIENCE_DEPTH.rock);
  }

  /** The warm pool of light, drawn once; `update` moves it and sets its strength. */
  private drawGlow(): void {
    const size = GLOW_RADIUS * 2 + 1;
    const tex = this.canvas(this.keys.glow, size, size);
    const g = tex.context;
    g.clearRect(0, 0, size, size);
    const c = GLOW_RADIUS + 0.5;
    const warm = g.createRadialGradient(c, c, 2, c, c, GLOW_RADIUS);
    // master mode's torch burns cold: icy blue instead of orange
    const rgb = this.master ? GLOW_COLD_RGB : GLOW_WARM_RGB;
    warm.addColorStop(0, `rgba(${rgb},0.55)`);
    warm.addColorStop(1, `rgba(${rgb},0)`);
    g.fillStyle = warm;
    g.fillRect(0, 0, size, size);
    tex.refresh();
    const image = (blend: Phaser.BlendModes) =>
      this.scene.add
        .image(0, 0, this.keys.glow)
        .setOrigin(0)
        .setScale(this.scale)
        .setDepth(AMBIENCE_DEPTH.overlay)
        .setBlendMode(blend)
        .setVisible(false);
    this.warm?.destroy();
    this.glow?.destroy();
    // multiplied first, then added (both over the darkness)
    this.warm = image(Phaser.BlendModes.MULTIPLY);
    this.glow = image(Phaser.BlendModes.ADD);
  }

  private drawVignette(): void {
    const W = this.artW;
    const H = this.artH;
    const tex = this.canvas(this.keys.vignette, W, H);
    const g = tex.context;
    g.clearRect(0, 0, W, H);
    // centred on the board (the HUD and the d-pad move it off the screen's centre), and clear
    // over all of it
    const b = this.board;
    const cx = b.x + b.w / 2;
    const cy = b.y + b.h / 2;
    const { inner, outer } = vignetteRadii(W, H, b);
    const v = g.createRadialGradient(cx, cy, inner, cx, cy, outer);
    v.addColorStop(0, 'rgba(0,0,0,0)');
    v.addColorStop(1, 'rgba(0,0,0,0.6)');
    g.fillStyle = v;
    g.fillRect(0, 0, W, H);
    tex.refresh();
    this.vignette = this.place(this.vignette, this.keys.vignette, AMBIENCE_DEPTH.vignette);
    if (!this.master) return;
    // master mode's last seconds: a tighter red vignette, its alpha set by `update`
    const tt = this.canvas(this.keys.tension, W, H);
    const tg = tt.context;
    tg.clearRect(0, 0, W, H);
    const red = tg.createRadialGradient(cx, cy, inner * 0.85, cx, cy, outer * 0.85);
    red.addColorStop(0, 'rgba(170,10,20,0)');
    red.addColorStop(1, 'rgba(170,10,20,0.8)');
    tg.fillStyle = red;
    tg.fillRect(0, 0, W, H);
    tt.refresh();
    this.tension = this.place(this.tension, this.keys.tension, AMBIENCE_DEPTH.vignette);
    this.tension.setVisible(false);
  }

  /** The canvas texture `key` at the given size (reused when the size did not change). */
  private canvas(key: string, w: number, h: number): Phaser.Textures.CanvasTexture {
    const textures = this.scene.textures;
    const old = textures.exists(key) ? (textures.get(key) as Phaser.Textures.CanvasTexture) : null;
    if (old && old.width === w && old.height === h) return old;
    // an image still showing the old texture is replaced right after by `place`
    if (old) textures.remove(key);
    const tex = textures.createCanvas(key, w, h);
    if (!tex) throw new Error(`cannot create canvas texture ${key}`);
    tex.setFilter(Phaser.Textures.FilterMode.NEAREST);
    return tex;
  }

  /** A full-screen image of texture `key` on the art pixel grid. */
  private place(
    img: Phaser.GameObjects.Image | null,
    key: string,
    depth: number,
  ): Phaser.GameObjects.Image {
    img?.destroy();
    return this.scene.add
      .image(this.originX, this.originY, key)
      .setOrigin(0)
      .setScale(this.scale)
      .setDepth(depth);
  }

  /** Publishes the ambience state for the e2e tests, once per layout and per settings change. */
  private report(): void {
    const { torchlight, dust, vignette } = app.data.settings;
    const s = this.shown;
    if (s && s.torchlight === torchlight && s.dust === dust && s.vignette === vignette) return;
    this.shown = { torchlight, dust, vignette };
    setDebug({
      ambience: {
        rock: this.stoneCount,
        torchlight,
        dust,
        vignette,
        tint: this.tint === null ? null : css(this.tint),
      },
    });
  }
}
