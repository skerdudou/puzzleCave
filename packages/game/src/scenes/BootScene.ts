import Phaser from 'phaser';
import { levels } from '../levels';
import { textStyle } from '../ui';

export const TEXTURES = [
  'FLOOR',
  'GRAVEL',
  'WATER',
  'EXIT',
  'KEY',
  'DOOR',
  'BLOCK',
  'player',
  'WALL',
  'WALL_N',
  'WALL_W',
  'WALL_E',
  'WALL_S',
  'WALL_NW',
  'WALL_NE',
  'WALL_NS',
  'WALL_WE',
  'WALL_WS',
  'WALL_ES',
  'WALL_NWE',
  'WALL_NWS',
  'WALL_NES',
  'WALL_WES',
  'WALL_NWES',
] as const;

export class BootScene extends Phaser.Scene {
  private failed: string[] = [];
  constructor() {
    super('Boot');
  }
  preload(): void {
    for (const t of TEXTURES) this.load.image(t, `textures/${t}.png`);
    this.load.audio('music-menu', 'music/RPG-Battle-Climax.mp3');
    this.load.audio('music-game', 'music/Self-Destruct-Sequence.mp3');
    this.load.on('loaderror', (file: Phaser.Loader.File) => this.failed.push(file.key));
  }
  create(): void {
    if (this.failed.length || levels.length === 0) {
      this.add.text(
        16,
        16,
        `Loading error: ${this.failed.join(', ') || 'no levels'}`,
        textStyle(14, '#ff8080'),
      );
      return;
    }
    this.scene.start('Menu');
  }
}
