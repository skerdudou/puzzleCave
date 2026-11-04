import Phaser from 'phaser';
import { KONAMI, KonamiCode } from '../achievements';
import { app } from '../app';
import { setDebug } from '../debug';
import { t } from '../i18n';
import { onSceneKeyDown } from '../input/sceneKeys';
import { showNotice } from '../notice';
import { runAcross } from '../render/konamiRunner';
import { KONAMI_TUNE, playTune } from '../sfx';
import { syncMusic } from '../music';
import { PREVIEW, PREVIEW_SHA } from '../preview';
import { COLORS, KeyFocus, dpr, makeButton, px, textStyle } from '../ui';

export class MenuScene extends Phaser.Scene {
  constructor() {
    super('Menu');
  }
  create(): void {
    const cx = this.scale.width / 2;
    const cy = this.scale.height / 2;
    this.add.text(cx, cy - px(90), 'puzzleCave', textStyle(36, COLORS.accent)).setOrigin(0.5);
    // the preview of main (src/preview.ts): which commit, and whether author mode (?dev) is on,
    // small and dim at the bottom
    if (PREVIEW)
      this.add
        .text(
          cx,
          this.scale.height - px(6),
          `preview · main · ${PREVIEW_SHA}${app.author ? ' · dev' : ''}`,
          textStyle(9, COLORS.dim),
        )
        .setOrigin(0.5, 1)
        .setAlpha(0.6);
    const play = () => this.scene.start('Select');
    const trophies = () => this.scene.start('Achievements');
    const options = () => this.scene.start('Options');
    const items = [
      { id: 'play', button: makeButton(this, cx, cy, t('play'), play, 20), press: play },
      {
        id: 'options',
        button: makeButton(this, cx, cy + px(56), t('options'), options, 16),
        press: options,
      },
      {
        id: 'achievements',
        button: makeButton(this, cx, cy + px(104), t('achievements'), trophies, 16),
        press: trophies,
      },
    ];
    const focus = new KeyFocus(items);
    const konami = new KonamiCode();
    // arrows or Tab, then Enter; Enter alone plays
    onSceneKeyDown(this, (e) => {
      if (!e.repeat && konami.key(e.key)) this.konami();
      if (focus.key(e)) return;
      if (e.key === 'Enter') play();
    });
    const onResize = () => this.scene.restart();
    this.scale.on('resize', onResize);
    this.events.once('shutdown', () => this.scale.off('resize', onResize));
    syncMusic(this, app.data.settings.sound, 'music-menu');
    // button centres in CSS pixels, for the e2e tests
    const buttons = Object.fromEntries(
      items.map(({ id, button: b }) => [id, [b.x / dpr(), b.y / dpr()]]),
    );
    setDebug({ scene: 'Menu', buttons });
  }

  /**
   * ↑ ↑ ↓ ↓ ← → ← → B A: a fanfare, the explorer running across, and every chapter open (the
   * effect plays each time; the achievement and the chapters, once).
   */
  private konami(): void {
    playTune(KONAMI_TUNE, app.data.settings.sfx);
    runAcross(this);
    if (app.earn([KONAMI]).length > 0) showNotice(t('konamiOpen'));
    setDebug({ konami: true });
  }
}
