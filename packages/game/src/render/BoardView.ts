import Phaser from 'phaser';
import type { GameEvent, GameState, ObjKind, Pos, Terrain } from '@puzzlecave/core';
import { shoreAt, shoreTexture } from './shore';
import { SMOOTH_FACTOR, SPRITE_PAD, addPixels, smoothKey, texturePixels } from './smoothing';
import { blit, copyRgba, type Rgba } from './upscale';
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
 * A terrain smoothed whole: its texture, and the pixels it was made from and of (`small` the art
 * assembled, `big` through xBR), from which the next one is patched when a block sinks.
 */
interface SmoothTerrain {
  key: string;
  small: Rgba;
  big: Rgba;
}
/** terrain smoothed whole: its description → it, the most recent last */
const terrainCache = new Map<string, SmoothTerrain>();
/** each texture's art pixels (assembling a terrain again around a sunk block) */
const tilePixels = new Map<string, Rgba>();
/**
 * At most this many kept (one of the largest levels is 1536 × 1408 texels, 8.6 MB): the terrain
 * of a block sunk then undone, or restarted, comes back at once.
 */
const TERRAIN_CACHE = 3;
let terrainSerial = 0;

/** The smoothed terrains forgotten, their textures freed (the level is left). */
export function clearTerrainCache(textures: Phaser.Textures.TextureManager): void {
  for (const { key } of terrainCache.values()) if (textures.exists(key)) textures.remove(key);
  terrainCache.clear();
}

interface Pending {
  stop: () => void;
  finish: () => void;
  done: boolean;
}

export class BoardView {
  private readonly scene: Phaser.Scene;
  private layout: BoardLayout;
  private root: Phaser.GameObjects.Container | null = null;
  private terrain: Phaser.GameObjects.Image[] = [];
  private objects: (Phaser.GameObjects.Image | null)[] = [];
  private player!: Phaser.GameObjects.Image;
  private pending: Pending[] = [];
  private width = 0;
  /** chapter colour of the terrain's gentle tint, kept across `rebuild` */
  private terrainTint: number | null = null;
  /** the art smoothed (smoothing.ts) */
  private smoothing: boolean;
  /** the terrain as one image, smoothed whole (xBR), instead of one image a cell */
  private terrainImage: Phaser.GameObjects.Image | null = null;
  /** the terrain that image shows (a block sinking changes it) */
  private terrainNow: Terrain[] = [];
  /** the smoothed terrain is to be drawn again before the next frame */
  private terrainQueued = false;
  /** the terrain the smoothed image shows (its description) */
  private shownTerrain: string | null = null;
  /** the cells changed since (blocks sunk) */
  private changedCells = new Set<number>();
  private height = 0;

  constructor(scene: Phaser.Scene, state: GameState, layout: BoardLayout, smoothing = false) {
    this.scene = scene;
    this.layout = layout;
    this.smoothing = smoothing;
    this.rebuild(state);
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
    this.root?.destroy();
    this.width = state.width;
    this.height = state.height;
    this.terrainNow = state.terrain.slice();
    this.terrainQueued = false;
    this.changedCells.clear();
    const root = this.scene.add.container(this.layout.x, this.layout.y).setScale(this.layout.scale);
    this.root = root;
    this.terrain = [];
    this.terrainImage = null;
    if (this.smoothing) {
      // the terrain smoothed whole: walls, water and floor continue from one cell to the next
      this.terrainImage = this.scene.add
        .image(0, 0, this.terrainTexture())
        .setOrigin(0)
        .setScale(1 / SMOOTH_FACTOR);
      root.add(this.terrainImage);
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
    this.objects = state.objects.map((o, i) => {
      if (!o) return null;
      const img = this.image(
        (i % state.width) * TILE,
        Math.floor(i / state.width) * TILE,
        OBJ_TEX[o],
      );
      root.add(img);
      return img;
    });
    // player.png is 16×18: it sticks out 2 px upward
    this.player = this.image(state.player.x * TILE, state.player.y * TILE, 'player', 2);
    this.player.setFlipX(state.facing === 'left');
    if (state.status === 'drowned') this.player.setAlpha(0.4);
    root.add(this.player);
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
          this.terrainNow[i] = 'floor';
          this.changedCells.add(i);
          this.later(durationMs, () => {
            img?.destroy();
            if (this.terrainImage) return this.refreshTerrain();
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
    this.root?.destroy();
    this.root = null;
    this.terrainImage = null;
    clearTerrainCache(this.scene.textures);
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
      if (!this.root?.active || !this.terrainImage?.active) return;
      this.terrainImage.setTexture(this.terrainTexture());
      this.report();
    });
  }

  /** For the e2e tests: the terrain's texture when smoothed, else each cell's. */
  private report(): void {
    setDebug({
      boardTerrain: this.terrainImage?.texture.key ?? null,
      boardTiles: this.terrainImage ? null : this.terrain.map((img) => img.texture.key),
    });
  }

  /**
   * The whole terrain, assembled from the art, through xBR: a texture made once for each terrain
   * met (the same again after an undo or a restart).
   */
  private terrainTexture(): string {
    const id = `${this.width}:${this.terrainNow.join(',')}`;
    const textures = this.scene.textures;
    const known = terrainCache.get(id);
    const changed = this.changedCells;
    this.changedCells = new Set();
    if (known && textures.exists(known.key)) {
      terrainCache.delete(id);
      terrainCache.set(id, known);
      this.shownTerrain = id;
      return known.key;
    }
    const shown = this.shownTerrain === null ? undefined : terrainCache.get(this.shownTerrain);
    const made = shown && changed.size ? this.patchTerrain(shown, changed) : this.wholeTerrain();
    const key = `board-terrain-${++terrainSerial}`;
    addPixels(textures, key, made.big, true);
    terrainCache.set(id, { key, ...made });
    this.shownTerrain = id;
    // the oldest go, never the one shown nor the one just made
    const keep = new Set([key, this.terrainImage?.texture.key]);
    for (const [oldId, old] of terrainCache) {
      if (terrainCache.size <= TERRAIN_CACHE) break;
      if (keep.has(old.key)) continue;
      terrainCache.delete(oldId);
      if (textures.exists(old.key)) textures.remove(old.key);
    }
    return key;
  }

  /** The whole terrain assembled from the art, and through xBR. */
  private wholeTerrain(): { small: Rgba; big: Rgba } {
    const w = this.width * TILE;
    const h = this.height * TILE;
    const small: Rgba = { w, h, data: new Uint8Array(w * h * 4) };
    this.terrainNow.forEach((_, i) => this.paintCell(small, i));
    return { small, big: xbr(small) };
  }

  /**
   * The terrain shown, with `changed` cells and their neighbours (whose art follows them: the
   * water's banks) painted again, and xBR run again around them only (xbrPatch): a block sinking
   * costs a few cells' xBR, not the whole board's.
   */
  private patchTerrain(shown: SmoothTerrain, changed: Set<number>): { small: Rgba; big: Rgba } {
    const small = copyRgba(shown.small);
    const big = copyRgba(shown.big);
    let [x0, y0, x1, y1] = [Infinity, Infinity, -Infinity, -Infinity];
    for (const i of changed) {
      const cx = i % this.width;
      const cy = Math.floor(i / this.width);
      for (let y = Math.max(0, cy - 1); y <= Math.min(this.height - 1, cy + 1); y++)
        for (let x = Math.max(0, cx - 1); x <= Math.min(this.width - 1, cx + 1); x++) {
          this.paintCell(small, y * this.width + x);
          [x0, y0, x1, y1] = [Math.min(x0, x), Math.min(y0, y), Math.max(x1, x), Math.max(y1, y)];
        }
    }
    xbrPatch(small, big, {
      x: x0 * TILE,
      y: y0 * TILE,
      w: (x1 - x0 + 1) * TILE,
      h: (y1 - y0 + 1) * TILE,
    });
    return { small, big };
  }

  /** Cell `i`'s art into the assembled terrain `small`. */
  private paintCell(small: Rgba, i: number): void {
    const key = this.terrainKey(i);
    let art = tilePixels.get(key);
    if (!art) tilePixels.set(key, (art = texturePixels(this.scene.textures, key)));
    blit(small, art, 0, 0, TILE, TILE, (i % this.width) * TILE, Math.floor(i / this.width) * TILE);
  }

  private applyTerrainTint(): void {
    const c = this.terrainTint;
    if (this.terrainImage) {
      if (c === null) this.terrainImage.clearTint();
      else this.terrainImage.setTint(mixTowards(c, 0.12));
    }
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
