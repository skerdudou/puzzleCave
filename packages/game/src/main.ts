import Phaser from 'phaser';
import { BootScene } from './scenes/BootScene';
import { GameScene } from './scenes/GameScene';
import { MenuScene } from './scenes/MenuScene';
import { OptionsScene } from './scenes/OptionsScene';
import { SelectScene } from './scenes/SelectScene';
import { ResultScene } from './scenes/ResultScene';
import { ReplayScene } from './scenes/ReplayScene';
import { app } from './app';
import { startUpdates } from './pwa';
import { COLORS } from './ui';

const ratio = () => window.devicePixelRatio || 1;

app.init();

const game = new Phaser.Game({
  type: Phaser.AUTO,
  parent: 'app',
  backgroundColor: COLORS.bg,
  pixelArt: true,
  input: { activePointers: 3 },
  scale: {
    mode: Phaser.Scale.NONE,
    width: Math.round(window.innerWidth * ratio()),
    height: Math.round(window.innerHeight * ratio()),
    zoom: 1 / ratio(),
  },
  scene: [BootScene, MenuScene, OptionsScene, SelectScene, GameScene, ResultScene, ReplayScene],
});
startUpdates(game);

window.addEventListener('resize', () => {
  game.scale.resize(
    Math.round(window.innerWidth * ratio()),
    Math.round(window.innerHeight * ratio()),
  );
  game.scale.setZoom(1 / ratio());
});
