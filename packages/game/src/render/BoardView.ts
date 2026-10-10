import Phaser from 'phaser';
import type { GameEvent, GameState, ObjKind, Pos, Terrain } from '@puzzlecave/core';
import { wallMask, wallTexture } from './autotile';
import type { BoardLayout } from './layout';

const TILE = 16;
const TERRAIN_TEX: Record<Exclude<Terrain, 'wall'>, string> = {
  floor: 'FLOOR',
  gravel: 'GRAVEL',
  water: 'WATER',
  exit: 'EXIT',
};
const OBJ_TEX: Record<ObjKind, string> = { key: 'KEY', door: 'DOOR', block: 'BLOCK' };

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

  constructor(scene: Phaser.Scene, state: GameState, layout: BoardLayout) {
    this.scene = scene;
    this.layout = layout;
    this.rebuild(state);
  }

  rebuild(state: GameState): void {
    this.finishAll();
    this.root?.destroy();
    this.width = state.width;
    const root = this.scene.add.container(this.layout.x, this.layout.y).setScale(this.layout.scale);
    this.root = root;
    const isWall = (x: number, y: number) =>
      x >= 0 &&
      y >= 0 &&
      x < state.width &&
      y < state.height &&
      state.terrain[y * state.width + x] === 'wall';
    this.terrain = state.terrain.map((t, i) => {
      const x = i % state.width;
      const y = Math.floor(i / state.width);
      const tex = t === 'wall' ? wallTexture(wallMask(isWall, x, y)) : TERRAIN_TEX[t];
      const img = this.scene.add.image(x * TILE, y * TILE, tex).setOrigin(0);
      root.add(img);
      return img;
    });
    this.objects = state.objects.map((o, i) => {
      if (!o) return null;
      const img = this.scene.add
        .image((i % state.width) * TILE, Math.floor(i / state.width) * TILE, OBJ_TEX[o])
        .setOrigin(0);
      root.add(img);
      return img;
    });
    // player.png is 16×18: it sticks out 2 px upward
    this.player = this.scene.add
      .image(state.player.x * TILE, state.player.y * TILE, 'player')
      .setOrigin(0, 2 / 18);
    this.player.setFlipX(state.facing === 'left');
    if (state.status === 'drowned') this.player.setAlpha(0.4);
    root.add(this.player);
  }

  setLayout(layout: BoardLayout): void {
    this.layout = layout;
    this.root?.setPosition(layout.x, layout.y).setScale(layout.scale);
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
          this.later(durationMs, () => {
            img?.destroy();
            this.terrain[i]?.setTexture(TERRAIN_TEX.floor);
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

  destroy(): void {
    this.finishAll();
    this.root?.destroy();
    this.root = null;
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
