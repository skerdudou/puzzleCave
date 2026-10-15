import Phaser from 'phaser';
import { app } from '../app';
import { setDebug } from '../debug';
import { t } from '../i18n';
import { onSceneKeyDown } from '../input/sceneKeys';
import { syncMusic } from '../music';
import { COLORS, KeyFocus, makeButton, px, textStyle } from '../ui';

export class MenuScene extends Phaser.Scene {
  constructor() {
    super('Menu');
  }
  create(): void {
    const cx = this.scale.width / 2;
    const cy = this.scale.height / 2;
    this.add.text(cx, cy - px(90), 'puzzleCave', textStyle(36, COLORS.accent)).setOrigin(0.5);
    const play = () => this.scene.start('Select');
    const options = () => this.scene.start('Options');
    const focus = new KeyFocus([
      { id: 'play', button: makeButton(this, cx, cy, t('play'), play, 20), press: play },
      {
        id: 'options',
        button: makeButton(this, cx, cy + px(56), t('options'), options, 16),
        press: options,
      },
    ]);
    // arrows or Tab, then Enter; Enter alone plays
    onSceneKeyDown(this, (e) => {
      if (focus.key(e)) return;
      if (e.key === 'Enter') play();
    });
    const onResize = () => this.scene.restart();
    this.scale.on('resize', onResize);
    this.events.once('shutdown', () => this.scale.off('resize', onResize));
    syncMusic(this, app.data.settings.sound, 'music-menu');
    setDebug({ scene: 'Menu' });
  }
}
