import Phaser from 'phaser';
import { app } from '../app';
import { setDebug } from '../debug';
import { t } from '../i18n';
import { onSceneKeyDown } from '../input/sceneKeys';
import { syncMusic } from '../music';
import { COLORS, HEADER_BAND, headerBand, makeButton, px, textStyle } from '../ui';

/** The credits, one under the other (a key of i18n each). */
export const CREDITS = ['creditMusic', 'creditSfx', 'creditSmoothing', 'creditFont'] as const;

/**
 * The credits (main menu › Credits): the music's author asks for them in the game itself
 * (soundimage.org), the other works with them under their licenses. Escape, the browser's Back
 * and the band's button go back to the menu.
 */
export class CreditsScene extends Phaser.Scene {
  constructor() {
    super('Credits');
  }

  create(): void {
    const w = this.scale.width;
    const cx = w / 2;
    const wrap = Math.min(w - px(32), px(460));
    let y = px(HEADER_BAND) + px(24);
    for (const key of CREDITS) {
      const c = this.add
        .text(cx, y, t(key), { ...textStyle(12), align: 'center', wordWrap: { width: wrap } })
        .setOrigin(0.5, 0);
      y = c.getBounds().bottom + px(16);
    }
    const back = () => this.scene.start('Menu');
    headerBand(
      this,
      t('credits'),
      makeButton(this, 0, 0, `‹ ${t('menu')}`, back, 12),
      cx - wrap / 2,
    );
    onSceneKeyDown(this, (e) => {
      if (e.key === 'Escape') back();
    });
    const onResize = () => this.scene.restart();
    this.scale.on('resize', onResize);
    this.events.once('shutdown', () => this.scale.off('resize', onResize));
    syncMusic(this, app.data.settings.sound, 'music-menu');
    setDebug({ scene: 'Credits', creditsBottom: y });
  }
}
