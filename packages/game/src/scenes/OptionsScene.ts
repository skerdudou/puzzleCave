import Phaser from 'phaser';
import { app } from '../app';
import { setDebug } from '../debug';
import { getLang, nextLang, setLang, t } from '../i18n';
import { syncMusic } from '../music';
import { COLORS, makeButton, px, textStyle } from '../ui';

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

export class OptionsScene extends Phaser.Scene {
  constructor() {
    super('Options');
  }
  create(): void {
    const s = app.data.settings;
    const cx = this.scale.width / 2;
    let y = px(60);
    this.add.text(cx, y, t('options'), textStyle(24, COLORS.accent)).setOrigin(0.5);
    y += px(60);
    const change = (fn: () => void) => {
      fn();
      app.persist();
      this.scene.restart();
    };
    const row = (
      label: string,
      value: string,
      onMinus: (() => void) | null,
      onPlus: () => void,
    ) => {
      this.add.text(cx - px(150), y, label, textStyle(14)).setOrigin(0, 0.5);
      if (onMinus) makeButton(this, cx + px(50), y, '−', () => change(onMinus), 14);
      this.add.text(cx + px(100), y, value, textStyle(14)).setOrigin(0.5);
      makeButton(this, cx + px(150), y, onMinus ? '+' : '⇄', () => change(onPlus), 14);
      y += px(48);
    };
    row(t('sound'), s.sound ? t('on') : t('off'), null, () => {
      s.sound = !s.sound;
      syncMusic(this, s.sound, 'music-menu');
    });
    row(t('language'), t('langName'), null, () => {
      const next = nextLang(getLang());
      s.lang = next;
      setLang(next);
    });
    row(
      t('swipe'),
      `${s.swipeThreshold} px`,
      () => (s.swipeThreshold = clamp(s.swipeThreshold - 5, 10, 80)),
      () => (s.swipeThreshold = clamp(s.swipeThreshold + 5, 10, 80)),
    );
    row(
      t('repeat'),
      String(s.repeatRate),
      () => (s.repeatRate = clamp(s.repeatRate - 1, 4, 20)),
      () => (s.repeatRate = clamp(s.repeatRate + 1, 4, 20)),
    );
    makeButton(this, cx, y + px(20), t('back'), () => this.scene.start('Menu'), 16);
    this.input.keyboard?.on('keydown-ESC', () => this.scene.start('Menu'));
    setDebug({ scene: 'Options' });
  }
}
