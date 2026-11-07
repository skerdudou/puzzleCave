import '@fontsource/silkscreen/400.css';
import Phaser from 'phaser';
import { AchievementsScene } from './scenes/AchievementsScene';
import { BootScene } from './scenes/BootScene';
import { GameScene } from './scenes/GameScene';
import { MenuScene } from './scenes/MenuScene';
import { OptionsScene } from './scenes/OptionsScene';
import { SelectScene } from './scenes/SelectScene';
import { ResultScene } from './scenes/ResultScene';
import { ReplayScene } from './scenes/ReplayScene';
import { app } from './app';
import { t } from './i18n';
import { showNotice } from './notice';
import { installBackButton } from './backButton';
import { textBoxes, type TextBox } from './debug';
import { showResumeBox, startUpdates } from './pwa';
import { redrawTextsOnRestore } from './render/restoreTexts';
import { initSfx } from './sfx';
import { COLORS } from './ui';

const ratio = () => window.devicePixelRatio || 1;
// e2e only (playwright.config.ts sets it): the most frames per second the game steps and draws.
// Unset in dev and in the build: no cap.
const e2eFps = Number(import.meta.env.VITE_E2E_FPS) || 0;

app.init();
// back from an update's reload: "Updating…" until the screen it was on shows again
showResumeBox();

// Phaser rasterises text with whatever font exists when the Text is created: wait for the pixel
// font (or 3 s) before creating the game
await Promise.race([
  document.fonts.load('16px Silkscreen').catch(() => []),
  new Promise((resolve) => setTimeout(resolve, 3000)),
]);

const game = new Phaser.Game({
  type: Phaser.AUTO,
  parent: 'app',
  backgroundColor: COLORS.bg,
  pixelArt: true,
  input: { activePointers: 3 },
  ...(e2eFps > 0 && { fps: { limit: e2eFps } }),
  scale: {
    mode: Phaser.Scale.NONE,
    width: Math.round(window.innerWidth * ratio()),
    height: Math.round(window.innerHeight * ratio()),
    zoom: 1 / ratio(),
  },
  scene: [
    BootScene,
    MenuScene,
    AchievementsScene,
    OptionsScene,
    SelectScene,
    GameScene,
    ResultScene,
    ReplayScene,
  ],
});
startUpdates(game);
redrawTextsOnRestore(game);
initSfx(game);
// for the e2e tests: the texts of the scene on top (see textBoxes)
(window as unknown as { __pcTexts: () => TextBox[] }).__pcTexts = () => {
  const top = game.scene.getScenes(true).at(-1);
  return top ? textBoxes(top) : [];
};

window.addEventListener('resize', () => {
  game.scale.resize(
    Math.round(window.innerWidth * ratio()),
    Math.round(window.innerHeight * ratio()),
  );
  game.scale.setZoom(1 / ratio());
});

// the phone's back button goes back a screen (backButton.ts)
installBackButton(
  () => game.scene.getScenes(true).at(-1)?.sys.settings.key,
  () => showNotice(t('backAgainToQuit')),
);
