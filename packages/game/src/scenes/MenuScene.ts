import Phaser from 'phaser';
import { KonamiCode } from '../achievements';
import { app } from '../app';
import { setDebug } from '../debug';
import { fullscreenEnv, isFullscreen, offersFullscreen, toggleFullscreen } from '../fullscreen';
import { t } from '../i18n';
import { canInstall, onInstallChange, promptInstall } from '../install';
import { isTouchDevice } from '../touch';
import { onSceneKeyDown } from '../input/sceneKeys';
import { konamiEntered } from '../konami';
import { syncMusic } from '../music';
import { PREVIEW, PREVIEW_SHA } from '../preview';
import { COLORS, KeyFocus, dpr, makeButton, px, sameWidth, textStyle } from '../ui';
import { version } from '../../package.json';

export class MenuScene extends Phaser.Scene {
  constructor() {
    super('Menu');
  }
  create(): void {
    const cx = this.scale.width / 2;
    const cy = this.scale.height / 2;
    this.add.text(cx, cy - px(90), 'puzzleCave', textStyle(36, COLORS.accent)).setOrigin(0.5);
    // the version (package.json), small and dim at the bottom; on the preview of main
    // (src/preview.ts), which commit too, and whether author mode (?dev) is on
    const where = PREVIEW ? ` · preview · main · ${PREVIEW_SHA}${app.author ? ' · dev' : ''}` : '';
    const versionLine = this.add
      .text(cx, this.scale.height - px(6), `v${version}${where}`, textStyle(9, COLORS.dim))
      .setOrigin(0.5, 1)
      .setAlpha(0.6);
    const play = () => this.scene.start('Select');
    const trophies = () => this.scene.start('Achievements');
    const options = () => this.scene.start('Options');
    const journal = () => this.scene.start('Journal');
    const items: { id: string; button: Phaser.GameObjects.Text; press: () => void }[] = [
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
    // one column of buttons as wide as the widest
    sameWidth(items.map((i) => i.button));
    // the credits: small, in the bottom left corner (off the menu's column)
    const credits = () => this.scene.start('Credits');
    items.push({
      id: 'credits',
      button: makeButton(
        this,
        px(12),
        this.scale.height - px(12),
        t('credits'),
        credits,
        11,
      ).setOrigin(0, 1),
      press: credits,
    });
    // the preview only: its update journal (updateLog.ts), on a page of its own, behind a small
    // icon in the bottom right corner (off the menu's column)
    if (PREVIEW)
      items.push({
        id: 'journal',
        button: makeButton(
          this,
          this.scale.width - px(12),
          this.scale.height - px(12),
          '📜',
          journal,
          14,
        ).setOrigin(1, 1),
        press: journal,
      });
    // full screen (a phone's browser tab only, where the page may go full screen: not the
    // installed app, nor an iPhone's Safari), small, in the top right corner (off the menu's
    // column); the menu is drawn again on the resize that follows, with the other label
    const fullscreen = offersFullscreen(fullscreenEnv(isTouchDevice()));
    if (fullscreen)
      items.push({
        id: 'fullscreen',
        button: makeButton(
          this,
          this.scale.width - px(12),
          px(12),
          t(isFullscreen() ? 'fullscreenExit' : 'fullscreen'),
          toggleFullscreen,
          11,
        ).setOrigin(1, 0),
        press: toggleFullscreen,
      });
    // install as an app (only where the browser offers it: Chrome, Edge; not once installed),
    // small, in the top left corner (off the menu's column); drawn again when that changes
    const install = canInstall();
    if (install) {
      const press = () => void promptInstall();
      items.push({
        id: 'install',
        button: makeButton(this, px(12), px(12), t('install'), press, 11).setOrigin(0, 0),
        press,
      });
    }
    this.events.once(
      'shutdown',
      onInstallChange(() => this.scene.restart()),
    );
    const focus = new KeyFocus(items);
    const konami = new KonamiCode();
    // arrows or Tab, then Enter; Enter alone plays
    onSceneKeyDown(this, (e) => {
      if (!e.repeat && konami.key(e.key)) konamiEntered(this);
      if (focus.key(e)) return;
      if (e.key === 'Enter') play();
    });
    const onResize = () => this.scene.restart();
    this.scale.on('resize', onResize);
    this.events.once('shutdown', () => this.scale.off('resize', onResize));
    syncMusic(this, app.data.settings.sound, 'music-menu');
    // button centres and widths in CSS pixels, for the e2e tests
    const buttons = Object.fromEntries(
      items.map(({ id, button: b }) => {
        const c = b.getBounds();
        return [id, [c.centerX / dpr(), c.centerY / dpr()]];
      }),
    );
    const buttonWidths = Object.fromEntries(
      items.map(({ id, button: b }) => [id, b.width / dpr()]),
    );
    setDebug({
      scene: 'Menu',
      buttons,
      buttonWidths,
      versionLine: versionLine.text,
      fullscreenOffered: fullscreen,
      installOffered: install,
    });
  }
}
