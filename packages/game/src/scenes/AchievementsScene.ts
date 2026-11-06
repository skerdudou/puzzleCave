import Phaser from 'phaser';
import { shownAchievements, viewOf } from '../achievements';
import { app } from '../app';
import { setDebug } from '../debug';
import { getLang, t } from '../i18n';
import { onSceneKeyDown } from '../input/sceneKeys';
import {
  clampScroll,
  inertiaStep,
  isDrag,
  maxScroll,
  releaseSpeed,
  scrollThumb,
} from '../input/scroll';
import { achievements as allAchievements } from '../levels';
import { isTouchDevice } from '../touch';
import { syncMusic } from '../music';
import {
  COLORS,
  HEADER_BAND,
  devicePx,
  dpr,
  drawMedal,
  headerBand,
  makeButton,
  px,
  shrinkToFit,
  textStyle,
} from '../ui';

/**
 * The achievements: one row each (a gold medal once earned, its name and what earns it, or
 * "???" for a secret not found yet, and how far the player is). The list scrolls like Options:
 * a finger (with a flick's inertia), the wheel or the keys.
 */
export class AchievementsScene extends Phaser.Scene {
  private scroll = 0;
  private contentH = 0;
  private velocity = 0;
  private drag: {
    id: number;
    x: number;
    y: number;
    scroll: number;
    samples: { t: number; y: number }[];
  } | null = null;
  private dragged = false;
  private thumb!: Phaser.GameObjects.Graphics;
  private back!: Phaser.GameObjects.Text;

  constructor() {
    super('Achievements');
  }

  create(): void {
    this.scroll = 0;
    this.velocity = 0;
    this.drag = null;
    const w = this.scale.width;
    const cx = w / 2;
    const rowW = Math.min(w - px(32), px(460));
    const left = cx - rowW / 2;
    // the count under the band at the top (back to the menu, the screen's name)
    let y = px(HEADER_BAND) + px(22);
    const achievements = shownAchievements(allAchievements, app.data.achievements, isTouchDevice());
    const earnedIds = achievements.filter((a) => app.data.achievements[a.id] !== undefined);
    this.add
      .text(
        cx,
        y,
        t('achCount', { n: earnedIds.length, total: achievements.length }),
        textStyle(11, COLORS.dim),
      )
      .setOrigin(0.5);
    y += px(26);

    const rows: Record<string, { earned: boolean; secret: boolean; progress?: string }> = {};
    const r = px(9);
    const textX = left + r * 2 + px(10);
    const textW = rowW - (textX - left);
    for (const a of achievements) {
      const v = viewOf(a, app.data.levels, app.data.achievements);
      const name = v.secret ? t('achHidden') : t(a.name);
      const vars: Record<string, string | number> = {};
      if (a.chapter) vars.chapter = a.chapter.name[getLang()] ?? a.chapter.name.en;
      if (a.n !== undefined) vars.n = a.n;
      const desc = v.secret ? t('achHiddenDesc') : t(a.desc, vars);
      const progress = v.progress ? t('achProgress', { ...v.progress }) : undefined;

      const title = this.add
        .text(textX, y, name, textStyle(13, v.earned ? COLORS.accent : COLORS.text))
        .setOrigin(0, 0);
      let titleW = textW;
      if (progress) {
        const p = this.add
          .text(left + rowW, y, progress, textStyle(11, COLORS.dim))
          .setOrigin(1, 0);
        titleW -= p.width + px(8);
      }
      shrinkToFit(title, 13, titleW);
      const d = this.add.text(textX, y + title.height + px(2), desc, {
        ...textStyle(10, COLORS.dim),
        wordWrap: { width: textW },
      });
      const rowH = Math.max(r * 2, title.height + px(2) + d.height);
      const g = this.add.graphics();
      drawMedal(g, left + r, y + rowH / 2, r, v.earned ? 'gold' : undefined);
      if (!v.earned) [title, d].forEach((o) => o.setAlpha(v.secret ? 0.6 : 0.85));
      y += rowH + px(14);
      rows[a.id] = { earned: v.earned, secret: v.secret, ...(progress ? { progress } : {}) };
    }

    this.contentH = y + px(10);
    // the band at the top, fixed: back to the menu (a drag that scrolled is not a press of it),
    // its left side lined up with the list, and the screen's name
    this.back = makeButton(
      this,
      0,
      0,
      `‹ ${t('menu')}`,
      () => {
        if (!this.dragged) this.scene.start('Menu');
      },
      12,
    );
    headerBand(this, t('achievements'), this.back, left);

    this.thumb = this.add.graphics().setScrollFactor(0).setDepth(5);
    this.setScroll(0, true);
    this.listenScroll();
    onSceneKeyDown(this, (e) => this.onKey(e));
    const onResize = () => this.scene.restart();
    this.scale.on('resize', onResize);
    this.events.once('shutdown', () => this.scale.off('resize', onResize));
    syncMusic(this, app.data.settings.sound, 'music-menu');
    setDebug({ scene: 'Achievements', achievementRows: rows });
  }

  override update(_time: number, delta: number): void {
    if (!this.velocity || this.drag) return;
    const step = inertiaStep(this.velocity, delta);
    const before = this.scroll;
    this.setScroll(this.scroll + step.dist);
    this.velocity = this.scroll === before ? 0 : step.v;
  }

  /** Moves the content (clamped) and the indicator; tells the tests where Back is. */
  private setScroll(y: number, force = false): void {
    const h = this.scale.height;
    const next = clampScroll(y, this.contentH, h);
    if (next === this.scroll && !force) return;
    this.scroll = next;
    this.cameras.main.setScroll(0, next);
    this.thumb.clear();
    const inset = px(4);
    // the track runs below the band at the top
    const top = px(HEADER_BAND) + inset;
    const track = h - top - inset;
    const thumb = scrollThumb(next, this.contentH, h, px(24));
    if (thumb) {
      const k = track / h;
      const w = Math.max(2, px(3));
      const x = this.scale.width - inset - w;
      this.thumb.fillStyle(0xffffff, 0.08).fillRoundedRect(x, top, w, track, w / 2);
      this.thumb
        .fillStyle(0x8a8597, 0.9)
        .fillRoundedRect(x, top + thumb.top * k, w, thumb.length * k, w / 2);
    }
    setDebug({
      scrollY: this.scroll / dpr(),
      buttons: { back: [this.back.getBounds().centerX / dpr(), this.back.y / dpr()] },
    });
  }

  private listenScroll(): void {
    const now = () => performance.now();
    this.input.on('pointerdown', (p: Phaser.Input.Pointer) => {
      this.dragged = false;
      this.velocity = 0;
      if (maxScroll(this.contentH, this.scale.height) <= 0) return;
      this.drag = {
        id: p.id,
        x: p.x,
        y: p.y,
        scroll: this.scroll,
        samples: [{ t: now(), y: p.y }],
      };
    });
    this.input.on('pointermove', (p: Phaser.Input.Pointer) => {
      const d = this.drag;
      if (!d || d.id !== p.id || !p.isDown) return;
      if (!this.dragged && !isDrag(p.x - d.x, p.y - d.y, devicePx(8))) return;
      this.dragged = true;
      d.samples.push({ t: now(), y: p.y });
      if (d.samples.length > 8) d.samples.shift();
      this.setScroll(d.scroll - (p.y - d.y));
    });
    const release = (p: Phaser.Input.Pointer) => {
      const d = this.drag;
      if (!d || d.id !== p.id) return;
      this.drag = null;
      if (this.dragged) this.velocity = -releaseSpeed(d.samples, now());
    };
    this.input.on('pointerup', release);
    this.input.on('pointerupoutside', release);
    this.input.on('wheel', (_p: unknown, _over: unknown, _dx: number, dy: number) => {
      this.velocity = 0;
      this.setScroll(this.scroll + dy * dpr());
    });
  }

  private onKey(e: KeyboardEvent): void {
    if (e.key === 'Escape' || e.key === 'Enter' || e.key === 'Backspace') {
      this.scene.start('Menu');
      return;
    }
    const line = px(48);
    const page = this.scale.height - px(44);
    const by: Record<string, number> = {
      ArrowDown: line,
      ArrowUp: -line,
      PageDown: page,
      PageUp: -page,
      ' ': page,
      Home: -this.contentH,
      End: this.contentH,
    };
    const d = by[e.key];
    if (d === undefined) return;
    e.preventDefault();
    this.velocity = 0;
    this.setScroll(this.scroll + d);
  }
}
