import Phaser from 'phaser';
import type { GameEvent, GameState, ObjKind, Pos, Terrain } from '@puzzlecave/core';
import { shoreAt, shoreTexture } from './shore';
import { SUNK_STEPS, WATERLINE, shownTerrain, sunkCells, sunkKey } from './sunk';
import { SMOOTH_FACTOR, SPRITE_PAD, addPixels, smoothKey, texturePixels } from './smoothing';
import { cropClamped, type Rgba } from './upscale';
import { xbr, xbrPatch } from './xbr';
import { mixTowards } from './ambience';
import { wallMask, wallTexture } from './autotile';
import type { BoardLayout } from './layout';
import { setDebug } from '../debug';

const TILE = 16;
const TERRAIN_TEX: Record<Exclude<Terrain, 'wall'>, string> = {
  floor: 'FLOOR',
  gravel: 'GRAVEL',
  water: 'WATER',
  exit: 'EXIT',
};
const OBJ_TEX: Record<ObjKind, string> = { key: 'KEY', door: 'DOOR', block: 'BLOCK' };

/**
 * The terrain smoothed whole: the terrain it shows, its art assembled (`small`) and through xBR
 * (`big`). A change (a block sinking, an undo, a replay's jump) is patched into it in place.
 */
interface SmoothTerrain {
  terrain: Terrain[];
  small: Rgba;
  big: Rgba;
}
/** each texture's art pixels (assembling a terrain again around a changed cell) */
const tilePixels = new Map<string, Rgba>();
/**
 * The smoothed terrain is drawn one texture a cell: a change sends the GPU only the cells it
 * touches. Each texture has a border of BORDER texels taken from its neighbours, so that the
 * smooth drawing blends a cell's edge with its real neighbour (no seam); the frame CELL_FRAME is
 * the cell itself.
 */
const BORDER = 1;
const CELL_FRAME = 'cell';
/**
 * Around the art pixels that changed, how far the smoothed ones may change, art px: xBR's reach
 * (2), and the next cell's border texel (a quarter of an art px, so 1).
 */
const CELL_REACH = 3;
let cellSerial = 0;

/** A sunk barrel at rest: its last step. */
const SUNK_REST = SUNK_STEPS[SUNK_STEPS.length - 1]!;
/** Each step of a barrel sinking, ms. */
const SINK_STEP_MS = 110;
/** A sunk barrel stepped on stays down this long, ms. */
const DIP_MS = 280;
const SPLASH_MS = 480;
const RIPPLE_MS = 750;
const DROP_COLOR = 0xb4b9ff;
const RING_COLOR = 0x6c72d6;
/** A splash's drops (the same each time): where they start, how they fly (art px per ms). */
const DROPS = Array.from({ length: 7 }, (_, n) => {
  const a = Math.sin((n + 1) * 12.9898) * 43758.5453;
  const b = Math.sin((n + 1) * 78.233) * 12543.123;
  const r = a - Math.floor(a);
  const q = b - Math.floor(b);
  return { dx: (r - 0.5) * 9, vx: (r - 0.5) * 0.035, vy: -0.05 - q * 0.04 };
});

interface Pending {
  stop: () => void;
  finish: () => void;
  done: boolean;
}

export class BoardView {
  private readonly scene: Phaser.Scene;
  private layout: BoardLayout;
  private root: Phaser.GameObjects.Container | null = null;
  /** the keys, doors, blocks and the player: drawn anew by rebuild, the terrain staying */
  private items: Phaser.GameObjects.Container | null = null;
  private terrain: Phaser.GameObjects.Image[] = [];
  private objects: (Phaser.GameObjects.Image | null)[] = [];
  private player!: Phaser.GameObjects.Image;
  private pending: Pending[] = [];
  private width = 0;
  /** chapter colour of the terrain's gentle tint, kept across `rebuild` */
  private terrainTint: number | null = null;
  /** the art smoothed (smoothing.ts) */
  private smoothing: boolean;
  /** the smoothed terrain the cells' textures show */
  private smooth: SmoothTerrain | null = null;
  /** each cell's texture of the smoothed terrain */
  private cellKeys: string[] = [];
  /** the terrain that image shows (a block sinking changes it) */
  private terrainNow: Terrain[] = [];
  /** the smoothed terrain is to be drawn again before the next frame */
  private terrainQueued = false;
  /** the terrain the smoothed image shows (its description) */
  private shownTerrain: string | null = null;
  private height = 0;
  /**
   * The level's terrain at its start, when the barrels float (Options): a barrel pushed into the
   * water stays there, its cell drawn as water (the smoothed terrain never changes); null, the
   * cell is drawn as the floor it is.
   */
  private readonly start: readonly Terrain[] | null;
  /** the barrels sunk, by cell (over the water, under the other things) */
  private sunk: (Phaser.GameObjects.Image | null)[] = [];
  private sunkLayer: Phaser.GameObjects.Container | null = null;
  /** the splashes and ripples, over the sunk barrels */
  private fxLayer: Phaser.GameObjects.Container | null = null;
  /** the effects running (a splash, a ripple, a barrel stepped on): stopped with the things */
  private fx: { stop: () => void }[] = [];
  /** the sunk barrel's art (which of its pixels hide the water under a ripple) */
  private sunkArt: Rgba | null = null;

  constructor(
    scene: Phaser.Scene,
    state: GameState,
    layout: BoardLayout,
    smoothing = false,
    start: readonly Terrain[] | null = null,
  ) {
    this.scene = scene;
    this.layout = layout;
    this.smoothing = smoothing;
    this.start = start;
    this.rebuild(state);
  }

  /** The terrain drawn for `terrain`: a sunk barrel's cell still water when the barrels float. */
  private drawnTerrain(terrain: readonly Terrain[]): Terrain[] {
    return this.start ? shownTerrain(this.start, terrain) : terrain.slice();
  }

  /** A texture as drawn with the smoothing, and the scale that draws it 16 px a cell. */
  private tex(key: string): [string, number] {
    return [smoothKey(key, this.smoothing), this.smoothing ? 1 / SMOOTH_FACTOR : 1];
  }

  /**
   * The art `key` with its top-left at (x, y), or its row `up` there (art px; the player sticks out
   * upward). A smoothed sprite keeps a transparent border of SPRITE_PAD art px all round
   * (smoothSprite): the smooth drawing of a sprite moving between cells fades its edges out instead of
   * cutting them flat at the texture's edge; the origin steps over that border.
   */
  private image(x: number, y: number, key: string, up = 0): Phaser.GameObjects.Image {
    const [k, scale] = this.tex(key);
    const art = this.scene.textures.getFrame(key);
    const p = this.smoothing ? SPRITE_PAD : 0;
    return this.scene.add
      .image(x, y, k)
      .setOrigin(p / (art.width + 2 * p), (p + up) / (art.height + 2 * p))
      .setScale(scale);
  }

  rebuild(state: GameState): void {
    this.finishAll();
    // the same board (an undo, a restart, a replay's jump back): the terrain's images stay, only
    // the cells that change are drawn again; the things on it are drawn anew
    const same =
      !!this.root?.active &&
      state.width === this.width &&
      state.height === this.height &&
      this.terrain.length === state.terrain.length;
    this.width = state.width;
    this.height = state.height;
    this.terrainNow = this.drawnTerrain(state.terrain);
    this.terrainQueued = false;
    if (same) {
      this.stopFx();
      this.items?.destroy();
      if (this.smoothing) this.updateCells();
      else
        this.terrain.forEach((img, i) => {
          const key = this.tex(this.terrainKey(i))[0];
          if (img.texture.key !== key) img.setTexture(key);
        });
      this.drawItems(state);
      return;
    }
    this.stopFx();
    this.root?.destroy();
    const root = this.scene.add.container(this.layout.x, this.layout.y).setScale(this.layout.scale);
    this.root = root;
    this.terrain = [];
    if (this.smoothing) {
      // the terrain smoothed whole (walls, water and floor continue from one cell to the next),
      // drawn a texture a cell
      this.updateCells();
      this.terrain = state.terrain.map((_, i) => {
        const img = this.scene.add
          .image(
            (i % state.width) * TILE,
            Math.floor(i / state.width) * TILE,
            this.cellKeys[i]!,
            CELL_FRAME,
          )
          .setOrigin(0)
          .setScale(1 / SMOOTH_FACTOR);
        root.add(img);
        return img;
      });
    } else
      this.terrain = state.terrain.map((_, i) => {
        const img = this.image(
          (i % state.width) * TILE,
          Math.floor(i / state.width) * TILE,
          this.terrainKey(i),
        );
        root.add(img);
        return img;
      });
    this.applyTerrainTint();
    this.drawItems(state);
  }

  /** The keys, doors, blocks and the player, over the terrain (a layer of their own). */
  private drawItems(state: GameState): void {
    const items = this.scene.add.container(0, 0);
    this.items = items;
    this.root!.add(items);
    // the barrels sunk, then their splashes and ripples, under the other things
    this.sunkLayer = this.scene.add.container(0, 0);
    this.fxLayer = this.scene.add.container(0, 0);
    items.add([this.sunkLayer, this.fxLayer]);
    this.sunk = state.terrain.map(() => null);
    if (this.start)
      for (const i of sunkCells(this.start, state.terrain)) this.addSunk(i, SUNK_REST);
    this.objects = state.objects.map((o, i) => {
      if (!o) return null;
      const img = this.image(
        (i % state.width) * TILE,
        Math.floor(i / state.width) * TILE,
        OBJ_TEX[o],
      );
      items.add(img);
      return img;
    });
    // player.png is 16×18: it sticks out 2 px upward
    this.player = this.image(state.player.x * TILE, state.player.y * TILE, 'player', 2);
    this.player.setFlipX(state.facing === 'left');
    if (state.status === 'drowned') this.player.setAlpha(0.4);
    items.add(this.player);
    this.report();
  }

  setLayout(layout: BoardLayout): void {
    this.layout = layout;
    this.root?.setPosition(layout.x, layout.y).setScale(layout.scale);
  }

  /** Centre of cell `p` in world coordinates (device px). */
  cellCentre(p: Pos): [number, number] {
    const { x, y, scale } = this.layout;
    return [x + (p.x + 0.5) * TILE * scale, y + (p.y + 0.5) * TILE * scale];
  }

  /** Centre of the player sprite in world coordinates (device px), following its slide. */
  heroCentre(): [number, number] {
    const { x, y, scale } = this.layout;
    return [x + (this.player.x + TILE / 2) * scale, y + (this.player.y + TILE / 2) * scale];
  }

  /**
   * Multiply tint towards the chapter colour (~12 %) on the terrain only: keys, doors, blocks
   * and the hero keep their exact colours. `null` clears it.
   */
  setTerrainTint(color: number | null): void {
    this.terrainTint = color;
    this.applyTerrainTint();
  }

  /** Immediately finishes all running animations (final positions). */
  finishAll(): void {
    const list = this.pending;
    this.pending = [];
    for (const p of list) {
      if (p.done) continue;
      p.done = true;
      p.stop();
      p.finish();
    }
  }

  apply(_state: GameState, events: GameEvent[], durationMs: number): void {
    this.finishAll();
    for (const e of events) {
      switch (e.type) {
        case 'turned':
          if (e.facing === 'left' || e.facing === 'right')
            this.player.setFlipX(e.facing === 'left');
          break;
        case 'moved':
          this.slide(this.player, e.to, durationMs);
          if (this.sunk[this.at(e.to)]) this.stepOnSunk(this.at(e.to), durationMs);
          break;
        case 'pushed': {
          const from = this.at(e.from);
          const img = this.objects[from] ?? null;
          this.objects[from] = null;
          if (img) {
            this.objects[this.at(e.to)] = img;
            this.slide(img, e.to, durationMs);
          }
          break;
        }
        case 'blockSank': {
          const i = this.at(e.at);
          const img = this.objects[i] ?? null;
          this.objects[i] = null;
          if (this.start) {
            // the barrel stays in the water: the terrain drawn does not change
            this.later(durationMs, () => {
              img?.destroy();
              this.sink(i);
              this.report();
            });
            break;
          }
          this.terrainNow[i] = 'floor';
          this.later(durationMs, () => {
            img?.destroy();
            if (this.smoothing) return this.refreshTerrain();
            // the cell, and the banks of the water around it
            for (let dy = -1; dy <= 1; dy++)
              for (let dx = -1; dx <= 1; dx++) {
                const x = (i % this.width) + dx;
                const y = Math.floor(i / this.width) + dy;
                if (x < 0 || y < 0 || x >= this.width || y >= this.height) continue;
                const j = y * this.width + x;
                this.terrain[j]?.setTexture(this.tex(this.terrainKey(j))[0]);
              }
            this.report();
          });
          break;
        }
        case 'keyPicked':
        case 'doorOpened': {
          const i = this.at(e.at);
          const img = this.objects[i] ?? null;
          this.objects[i] = null;
          this.later(durationMs, () => img?.destroy());
          break;
        }
        case 'drowned':
          this.later(durationMs, () => this.player.setAlpha(0.4));
          break;
        case 'won':
          break;
      }
    }
  }

  /** The board gone, and the smoothed terrains it made (the level is left). */
  destroy(): void {
    this.finishAll();
    this.stopFx();
    this.root?.destroy();
    this.root = null;
    this.items = null;
    this.terrain = [];
    for (const key of this.cellKeys)
      if (this.scene.textures.exists(key)) this.scene.textures.remove(key);
    this.cellKeys = [];
    this.smooth = null;
  }

  /** The art of the terrain at cell `i` (a wall's after its neighbours). */
  private terrainKey(i: number): string {
    const w = this.width;
    const t = this.terrainNow[i]!;
    const is = (kind: Terrain) => (x: number, y: number) =>
      x >= 0 && y >= 0 && x < w && y < this.height && this.terrainNow[y * w + x] === kind;
    const [x, y] = [i % w, Math.floor(i / w)];
    // walls and water after their neighbours: the walls' joins, the water's banks
    if (t === 'wall') return wallTexture(wallMask(is('wall'), x, y));
    if (t === 'water') return shoreTexture(shoreAt(is('water'), x, y));
    return TERRAIN_TEX[t];
  }

  /**
   * The smoothed terrain drawn again once, before the next frame: blocks sinking in one batch of
   * moves (a replay's jump) cost one xBR, not one each.
   */
  private refreshTerrain(): void {
    if (this.terrainQueued) return;
    this.terrainQueued = true;
    this.scene.events.once(Phaser.Scenes.Events.PRE_RENDER, () => {
      this.terrainQueued = false;
      if (!this.root?.active) return;
      this.updateCells();
      this.report();
    });
  }

  /** For the e2e tests: the smoothed terrain shown (its description), else each cell's art. */
  private report(): void {
    setDebug({
      boardTerrain: this.smoothing ? this.shownTerrain : null,
      boardTiles: this.smoothing ? null : this.terrain.map((img) => img.texture.key),
      boardSunk: this.sunk.flatMap((img, i) => (img ? [i] : [])),
    });
  }

  /** A sunk barrel at cell `i`, sunk `by` art px. */
  private addSunk(i: number, by: number): Phaser.GameObjects.Image {
    const img = this.image((i % this.width) * TILE, Math.floor(i / this.width) * TILE, sunkKey(by));
    this.sunkLayer!.add(img);
    this.sunk[i] = img;
    return img;
  }

  /** The barrel arrived in the water at cell `i`: it sinks a step at a time, a splash, ripples. */
  private sink(i: number): void {
    const img = this.addSunk(i, SUNK_STEPS[0]);
    this.fxLater(SINK_STEP_MS, () => img.active && img.setTexture(this.tex(sunkKey(SUNK_REST))[0]));
    this.splash(i);
    this.ripple(i, 0, 1);
    this.ripple(i, 200, 0.7);
  }

  /** The player stepping onto the sunk barrel at cell `i`: it gives 1 px, a small ripple. */
  private stepOnSunk(i: number, durationMs: number): void {
    const img = this.sunk[i];
    if (!img) return;
    const y = Math.floor(i / this.width) * TILE;
    const land = Math.max(0, durationMs * 0.6);
    this.fxLater(land, () => img.active && img.setY(y + 1));
    this.fxLater(land + DIP_MS, () => img.active && img.setY(y));
    this.ripple(i, land, 0.55);
  }

  private fxLater(ms: number, fn: () => void): void {
    if (ms <= 0) return void fn();
    const timer = this.scene.time.delayedCall(ms, fn);
    this.fx.push({ stop: () => timer.remove(false) });
  }

  /** An effect drawn `ms` long from `delay`, `draw(g, 0..1)` each frame, then gone. */
  private effect(
    delay: number,
    ms: number,
    draw: (g: Phaser.GameObjects.Graphics, t: number) => void,
  ): void {
    const layer = this.fxLayer;
    if (!layer) return;
    const g = this.scene.add.graphics();
    layer.add(g);
    const tween = this.scene.tweens.addCounter({
      from: 0,
      to: 1,
      delay,
      duration: ms,
      onUpdate: (tw) => {
        if (!g.active) return;
        g.clear();
        draw(g, tw.getValue() ?? 0);
      },
      onComplete: () => g.destroy(),
    });
    this.fx.push({
      stop: () => {
        tween.stop();
        g.destroy();
      },
    });
  }

  private stopFx(): void {
    const list = this.fx;
    this.fx = [];
    for (const f of list) f.stop();
  }

  /** Drops thrown up from the water line of cell `i`, falling back. */
  private splash(i: number): void {
    const [cx, cy] = this.waterCentre(i);
    this.effect(0, SPLASH_MS, (g, t) => {
      const age = t * SPLASH_MS;
      g.fillStyle(DROP_COLOR, age > SPLASH_MS * 0.75 ? 0.5 : 1);
      for (const p of DROPS) {
        const x = Math.round(cx + p.dx + p.vx * age);
        const y = Math.round(cy + p.vy * age + 0.00032 * age * age);
        if (y <= cy + 1) g.fillRect(x, y, 1, 1);
      }
    });
  }

  /** A ring spreading over the water around cell `i`, on the open water's pixels only. */
  private ripple(i: number, delay: number, strength: number): void {
    const [cx, cy] = this.waterCentre(i);
    this.effect(delay, RIPPLE_MS, (g, t) => {
      const rx = 6 + t * 9;
      const ry = rx * 0.55;
      g.fillStyle(RING_COLOR, (1 - t) * strength);
      for (let y = Math.floor(cy - ry - 1); y <= cy + ry + 1; y++)
        for (let x = Math.floor(cx - rx - 1); x <= cx + rx + 1; x++) {
          const d = Math.hypot((x - cx) / rx, (y - cy) / ry);
          if (Math.abs(d - 1) < 0.9 / ry && this.openWater(x, y)) g.fillRect(x, y, 1, 1);
        }
    });
  }

  /** Where a sunk barrel's splash and ripples start: its middle, just above the water line. */
  private waterCentre(i: number): [number, number] {
    return [(i % this.width) * TILE + 7.5, Math.floor(i / this.width) * TILE + WATERLINE - 2];
  }

  /** Art pixel (x, y) of the board shows the open water (not a bank, not a sunk barrel's lid). */
  private openWater(x: number, y: number): boolean {
    const [cx, cy] = [Math.floor(x / TILE), Math.floor(y / TILE)];
    if (x < 0 || y < 0 || cx >= this.width || cy >= this.height) return false;
    const i = cy * this.width + cx;
    if (this.terrainNow[i] !== 'water') return false;
    const [ax, ay] = [x - cx * TILE, y - cy * TILE];
    const art = this.art(this.terrainKey(i));
    const water = this.art('WATER');
    const k = (ay * TILE + ax) * 4;
    for (let c = 0; c < 3; c++) if (art.data[k + c] !== water.data[c]) return false;
    if (this.sunk[i]) {
      this.sunkArt ??= texturePixels(this.scene.textures, sunkKey(SUNK_REST));
      if (this.sunkArt.data[k + 3]! > 0) return false;
    }
    return true;
  }

  /** A texture's art pixels (kept). */
  private art(key: string): Rgba {
    let art = tilePixels.get(key);
    if (!art) tilePixels.set(key, (art = texturePixels(this.scene.textures, key)));
    return art;
  }

  /**
   * The cells' textures brought to the terrain now. The smoothed terrain shown is patched in
   * place where the art changed (xbrPatch over the pixels that differ, not even whole cells), and
   * only the cells those pixels reach are sent to the GPU: a block sinking costs a few cells, an
   * undo as much the other way. The whole terrain is smoothed at first, for another level, or
   * when many cells change at once (a replay's long jump).
   */
  private updateCells(): void {
    const id = `${this.width}:${this.terrainNow.join(',')}`;
    const n = this.terrainNow.length;
    const prev = this.smooth;
    if (!prev || prev.terrain.length !== n || this.cellKeys.length !== n)
      return this.wholeCells(id);
    const changed = new Set<number>();
    this.terrainNow.forEach((t, i) => t !== prev.terrain[i] && changed.add(i));
    if (!changed.size) return void (this.shownTerrain = id);
    // many changes at once (a replay's long jump): smoothed whole, faster than patch by patch
    if (changed.size * 9 > n / 2) return this.wholeCells(id);
    // around each changed cell, apart (two blocks sunk far apart are two small patches, not one
    // box over the board between them): it and its neighbours (whose art follows it: the water's
    // banks) painted again, all first; then xBR again over the box of the pixels that really
    // differ there, and the cells it reaches sent, each once
    const around = (i: number) => {
      const [cx, cy] = [i % this.width, Math.floor(i / this.width)];
      const cells: number[] = [];
      for (let y = Math.max(0, cy - 1); y <= Math.min(this.height - 1, cy + 1); y++)
        for (let x = Math.max(0, cx - 1); x <= Math.min(this.width - 1, cx + 1); x++)
          cells.push(y * this.width + x);
      return cells;
    };
    prev.terrain = this.terrainNow.slice();
    this.shownTerrain = id;
    const boxes = new Map<number, ReturnType<BoardView['paintCell']>>();
    for (const i of changed)
      for (const j of around(i)) if (!boxes.has(j)) boxes.set(j, this.paintCell(prev.small, j));
    const toSend = new Set<number>();
    const cell = (v: number, max: number) => Math.min(max - 1, Math.max(0, Math.floor(v / TILE)));
    for (const i of changed) {
      let [x0, y0, x1, y1] = [Infinity, Infinity, -Infinity, -Infinity];
      for (const j of around(i)) {
        const box = boxes.get(j);
        if (box)
          [x0, y0, x1, y1] = [
            Math.min(x0, box.x0),
            Math.min(y0, box.y0),
            Math.max(x1, box.x1),
            Math.max(y1, box.y1),
          ];
      }
      if (x0 > x1) continue;
      xbrPatch(prev.small, prev.big, { x: x0, y: y0, w: x1 - x0 + 1, h: y1 - y0 + 1 });
      for (let y = cell(y0 - CELL_REACH, this.height); y <= cell(y1 + CELL_REACH, this.height); y++)
        for (let x = cell(x0 - CELL_REACH, this.width); x <= cell(x1 + CELL_REACH, this.width); x++)
          toSend.add(y * this.width + x);
    }
    for (const i of toSend) this.sendCell(i, prev.big);
  }

  /** The whole terrain assembled from the art, through xBR, and every cell sent. */
  private wholeCells(id: string): void {
    const w = this.width * TILE;
    const h = this.height * TILE;
    const small: Rgba = { w, h, data: new Uint8Array(w * h * 4) };
    this.terrainNow.forEach((_, i) => this.paintCell(small, i));
    const big = xbr(small);
    // the same board before (a replay's long jump): only the cells that differ are sent
    const old =
      this.smooth &&
      this.smooth.big.w === big.w &&
      this.smooth.big.h === big.h &&
      this.cellKeys.length === this.terrainNow.length
        ? this.smooth.big
        : null;
    this.smooth = { terrain: this.terrainNow.slice(), small, big };
    this.shownTerrain = id;
    for (let i = 0; i < this.terrainNow.length; i++)
      if (!old || this.cellDiffers(old, big, i)) this.sendCell(i, big);
  }

  /** Cell `i`'s smoothed pixels, its border included, differ between `a` and `b`. */
  private cellDiffers(a: Rgba, b: Rgba, i: number): boolean {
    const size = TILE * SMOOTH_FACTOR;
    const [cx, cy] = [i % this.width, Math.floor(i / this.width)];
    const x0 = Math.max(0, cx * size - BORDER);
    const x1 = Math.min(a.w, (cx + 1) * size + BORDER);
    for (
      let y = Math.max(0, cy * size - BORDER);
      y < Math.min(a.h, (cy + 1) * size + BORDER);
      y++
    ) {
      const from = (y * a.w + x0) * 4;
      const to = (y * a.w + x1) * 4;
      for (let k = from; k < to; k++) if (a.data[k] !== b.data[k]) return true;
    }
    return false;
  }

  /** Cell `i` of the smoothed terrain `big` as its texture, with its border; its image follows. */
  private sendCell(i: number, big: Rgba): void {
    const textures = this.scene.textures;
    const size = TILE * SMOOTH_FACTOR;
    const [cx, cy] = [i % this.width, Math.floor(i / this.width)];
    const key = `board-cell-${++cellSerial}`;
    addPixels(
      textures,
      key,
      cropClamped(
        big,
        cx * size - BORDER,
        cy * size - BORDER,
        size + 2 * BORDER,
        size + 2 * BORDER,
      ),
      true,
    );
    textures.get(key).add(CELL_FRAME, 0, BORDER, BORDER, size, size);
    this.terrain[i]?.setTexture(key, CELL_FRAME);
    const old = this.cellKeys[i];
    this.cellKeys[i] = key;
    if (old && textures.exists(old)) textures.remove(old);
  }

  /**
   * Cell `i`'s art into the assembled terrain `small`; the box of the pixels that changed (art
   * px, inclusive), or null.
   */
  private paintCell(
    small: Rgba,
    i: number,
  ): { x0: number; y0: number; x1: number; y1: number } | null {
    const key = this.terrainKey(i);
    let art = tilePixels.get(key);
    if (!art) tilePixels.set(key, (art = texturePixels(this.scene.textures, key)));
    const [ox, oy] = [(i % this.width) * TILE, Math.floor(i / this.width) * TILE];
    let box: { x0: number; y0: number; x1: number; y1: number } | null = null;
    for (let y = 0; y < TILE; y++)
      for (let x = 0; x < TILE; x++) {
        const a = (y * TILE + x) * 4;
        const b = ((oy + y) * small.w + ox + x) * 4;
        if (
          art.data[a] === small.data[b] &&
          art.data[a + 1] === small.data[b + 1] &&
          art.data[a + 2] === small.data[b + 2] &&
          art.data[a + 3] === small.data[b + 3]
        )
          continue;
        small.data.set(art.data.subarray(a, a + 4), b);
        box = box
          ? {
              x0: Math.min(box.x0, ox + x),
              y0: Math.min(box.y0, oy + y),
              x1: Math.max(box.x1, ox + x),
              y1: Math.max(box.y1, oy + y),
            }
          : { x0: ox + x, y0: oy + y, x1: ox + x, y1: oy + y };
      }
    return box;
  }

  private applyTerrainTint(): void {
    const c = this.terrainTint;
    for (const img of this.terrain) {
      if (c === null) img.clearTint();
      else img.setTint(mixTowards(c, 0.12));
    }
  }

  private at(p: Pos): number {
    return p.y * this.width + p.x;
  }

  private slide(img: Phaser.GameObjects.Image, to: Pos, durationMs: number): void {
    const x = to.x * TILE;
    const y = to.y * TILE;
    const finish = () => img.setPosition(x, y);
    if (durationMs <= 0) {
      finish();
      return;
    }
    const entry: Pending = { stop: () => {}, finish, done: false };
    const tween = this.scene.tweens.add({
      targets: img,
      x,
      y,
      duration: durationMs,
      ease: 'Linear',
      onComplete: () => {
        if (entry.done) return;
        entry.done = true;
        finish();
      },
    });
    entry.stop = () => tween.stop();
    this.pending.push(entry);
  }

  private later(durationMs: number, fn: () => void): void {
    if (durationMs <= 0) {
      fn();
      return;
    }
    const entry: Pending = { stop: () => {}, finish: fn, done: false };
    const timer = this.scene.time.delayedCall(durationMs, () => {
      if (entry.done) return;
      entry.done = true;
      fn();
    });
    entry.stop = () => timer.remove(false);
    this.pending.push(entry);
  }
}
