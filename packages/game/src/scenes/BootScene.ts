import Phaser from 'phaser';
import { levels } from '../levels';
import { afterStartCheck, hideUpdatingAfter, startScreen } from '../pwa';
import { SHORE_TEXTURES } from '../render/shore';
import {
  SMOOTH_SPRITES,
  addPixels,
  smoothKey,
  smoothSprite,
  texturePixels,
} from '../render/smoothing';
import { t } from '../i18n';
import { makeButton, px, textStyle } from '../ui';

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
  // the water's banks (render/shore.ts)
  ...SHORE_TEXTURES.filter((n) => n !== 'WATER'),
];

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
    // the sprites that move, smoothed once (the board smooths its terrain itself)
    for (const key of SMOOTH_SPRITES)
      if (this.textures.exists(key))
        addPixels(
          this.textures,
          smoothKey(key, true),
          smoothSprite(texturePixels(this.textures, key)),
        );
    if (this.failed.length || levels.length === 0) {
      // often a network hiccup on the first visit (later ones play from the offline cache)
      const cx = this.scale.width / 2;
      const cy = this.scale.height / 2;
      this.add
        .text(cx, cy - px(30), t('loadError', { what: this.failed.join(', ') || t('noLevels') }), {
          ...textStyle(14, '#ff8080'),
          align: 'center',
          wordWrap: { width: this.scale.width - px(32) },
        })
        .setOrigin(0.5, 1);
      makeButton(this, cx, cy + px(10), t('retry'), () => location.reload());
      return;
    }
    // a new version found at start-up is applied before any screen shows (the page reloads);
    // else the screen the game was on before an update, or the main menu
    void afterStartCheck().then((applying) => {
      if (applying) return;
      const { scene, data } = startScreen();
      hideUpdatingAfter(this.scene.get(scene));
      this.scene.start(scene, data);
    });
  }
}
