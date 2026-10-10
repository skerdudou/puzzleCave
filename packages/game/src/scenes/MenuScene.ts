import Phaser from 'phaser';
import { app } from '../app';
import { setDebug } from '../debug';
import { t } from '../i18n';
import { onSceneKeyDown } from '../input/sceneKeys';
import { syncMusic } from '../music';
import { COLORS, makeButton, px, textStyle } from '../ui';

export class MenuScene extends Phaser.Scene {
  constructor() {
    super('Menu');
  }
  create(): void {
    const cx = this.scale.width / 2;
    const cy = this.scale.height / 2;
    this.add.text(cx, cy - px(90), 'puzzleCave', textStyle(36, COLORS.accent)).setOrigin(0.5);
    makeButton(this, cx, cy, t('play'), () => this.scene.start('Select'), 20);
    makeButton(this, cx, cy + px(56), t('options'), () => this.scene.start('Options'), 16);
    onSceneKeyDown(this, (e) => {
      if (e.key === 'Enter') this.scene.start('Select');
    });
    const onResize = () => this.scene.restart();
    this.scale.on('resize', onResize);
    this.events.once('shutdown', () => this.scale.off('resize', onResize));
    syncMusic(this, app.data.settings.sound, 'music-menu');
    setDebug({ scene: 'Menu' });
  }
}
