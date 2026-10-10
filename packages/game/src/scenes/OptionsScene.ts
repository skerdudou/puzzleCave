import Phaser from 'phaser';
import { app } from '../app';
import { setDebug } from '../debug';
import { LANGS, getLang, messages, setLang, t, type Lang } from '../i18n';
import { onSceneKeyDown } from '../input/sceneKeys';
import { syncMusic } from '../music';
import { COLORS, dpr, makeButton, px, textStyle } from '../ui';

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

export class OptionsScene extends Phaser.Scene {
  /** button centres in CSS pixels, for the e2e tests */
  private buttons: Record<string, [number, number]> = {};
  private langMenu: Phaser.GameObjects.GameObject[] = [];

  constructor() {
    super('Options');
  }

  create(): void {
    const s = app.data.settings;
    const cx = this.scale.width / 2;
    // labels can be long in some languages: each option takes two lines (label, then controls)
    const wrap = Math.min(this.scale.width - px(32), px(420));
    this.buttons = {};
    this.langMenu = [];
    let y = px(50);
    this.add.text(cx, y, t('options'), textStyle(24, COLORS.accent)).setOrigin(0.5);
    y += px(56);
    const change = (fn: () => void) => {
      fn();
      app.persist();
      this.scene.restart();
    };
    const button = (
      id: string,
      x: number,
      by: number,
      label: string,
      fn: () => void,
      size = 14,
    ) => {
      const b = makeButton(this, x, by, label, fn, size);
      this.buttons[id] = [x / dpr(), by / dpr()];
      return b;
    };
    const label = (text: string) => {
      const l = this.add
        .text(cx, y, text, {
          ...textStyle(13, COLORS.dim),
          align: 'center',
          wordWrap: { width: wrap },
        })
        .setOrigin(0.5, 0);
      y += l.height + px(16);
    };
    const stepper = (id: string, value: string, onMinus: () => void, onPlus: () => void) => {
      button(`${id}-minus`, cx - px(80), y, '−', () => change(onMinus));
      this.add.text(cx, y, value, textStyle(14)).setOrigin(0.5);
      button(`${id}-plus`, cx + px(80), y, '+', () => change(onPlus));
      y += px(44);
    };

    label(t('sound'));
    button('sound', cx, y, s.sound ? t('on') : t('off'), () =>
      change(() => {
        s.sound = !s.sound;
        syncMusic(this, s.sound, 'music-menu');
      }),
    );
    y += px(44);

    label(t('language'));
    const langY = y;
    button('lang', cx, y, `${t('langName')} ▾`, () => this.toggleLangMenu(cx, langY));
    y += px(44);

    label(t('swipe'));
    stepper(
      'swipe',
      `${s.swipeThreshold} px`,
      () => (s.swipeThreshold = clamp(s.swipeThreshold - 5, 10, 80)),
      () => (s.swipeThreshold = clamp(s.swipeThreshold + 5, 10, 80)),
    );
    label(t('repeat'));
    stepper(
      'repeat',
      String(s.repeatRate),
      () => (s.repeatRate = clamp(s.repeatRate - 1, 4, 20)),
      () => (s.repeatRate = clamp(s.repeatRate + 1, 4, 20)),
    );

    button('back', cx, y + px(12), t('back'), () => this.scene.start('Menu'), 16);
    onSceneKeyDown(this, (e) => {
      if (e.key !== 'Escape') return;
      if (this.langMenu.length) this.closeLangMenu();
      else this.scene.start('Menu');
    });
    setDebug({ scene: 'Options', lang: getLang(), langMenuOpen: false, buttons: this.buttons });
  }

  /** Drop-down list of the languages, each written in its own language, under the button. */
  private toggleLangMenu(cx: number, y: number): void {
    if (this.langMenu.length) return this.closeLangMenu();
    const rowH = px(34);
    const width = px(180);
    const top = y + px(22);
    // dim the screen behind the list; a click outside closes it
    const backdrop = this.add
      .rectangle(0, 0, this.scale.width, this.scale.height, 0x000000, 0.6)
      .setOrigin(0)
      .setDepth(9)
      .setInteractive();
    backdrop.on('pointerup', () => this.closeLangMenu());
    this.langMenu.push(backdrop);
    const bg = this.add
      .rectangle(cx, top, width, rowH * LANGS.length + px(8), 0x2c2838)
      .setOrigin(0.5, 0)
      .setStrokeStyle(Math.max(1, px(1)), 0xffd25e)
      .setDepth(10);
    this.langMenu.push(bg);
    LANGS.forEach((lang: Lang, i) => {
      const by = top + px(4) + rowH * i + rowH / 2;
      const current = lang === getLang();
      const item = this.add
        .text(cx, by, messages(lang).langName, textStyle(14, current ? COLORS.accent : COLORS.text))
        .setOrigin(0.5)
        .setDepth(11)
        .setInteractive({ useHandCursor: true });
      item.on('pointerover', () => item.setColor(COLORS.accent));
      item.on('pointerout', () => item.setColor(current ? COLORS.accent : COLORS.text));
      item.on('pointerup', () => this.pickLang(lang));
      this.buttons[`lang-${lang}`] = [cx / dpr(), by / dpr()];
      this.langMenu.push(item);
    });
    setDebug({ langMenuOpen: true, buttons: this.buttons });
  }

  private closeLangMenu(): void {
    for (const o of this.langMenu) o.destroy();
    this.langMenu = [];
    setDebug({ langMenuOpen: false });
  }

  private pickLang(lang: Lang): void {
    app.data.settings.lang = lang;
    setLang(lang);
    app.persist();
    this.scene.restart();
  }
}
