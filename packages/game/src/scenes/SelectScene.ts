import Phaser from 'phaser';
import {
  isChapterUnlocked,
  isLevelUnlocked,
  isMasterUnlocked,
  resolveThresholds,
  type Mode,
} from '@puzzlecave/core';
import { app } from '../app';
import { setDebug } from '../debug';
import { formatTime } from '../format';
import { getLang, t } from '../i18n';
import { onSceneKeyDown } from '../input/sceneKeys';
import { chapters, hasMaster, levelById, locate } from '../levels';
import { thresholdRows, type MedalKind } from '../medalInfo';
import { syncMusic } from '../music';
import { COLORS, drawMedal, drawThresholdLine, makeButton, px, textStyle } from '../ui';
import { authorServerAvailable, fetchSolution } from '../author/client';

export class SelectScene extends Phaser.Scene {
  private ci = 0;
  private li = 0;
  constructor() {
    super('Select');
  }

  init(data: { levelId?: string }): void {
    const pos = data.levelId ? locate(data.levelId) : null;
    if (pos) {
      this.ci = pos.chapterIndex;
      this.li = pos.levelIndex;
      return;
    }
    this.ci = 0;
    this.li = 0;
    for (let ci = chapters.length - 1; ci >= 0; ci--) {
      if (!isChapterUnlocked(chapters, ci, app.data.levels)) continue;
      const ch = chapters[ci]!;
      const li = ch.levels.findIndex(
        (id, i) =>
          isLevelUnlocked(chapters, ci, i, app.data.levels) && !app.data.levels[id]?.completed,
      );
      this.ci = ci;
      this.li = li >= 0 ? li : 0;
      return;
    }
  }

  create(): void {
    this.draw();
    onSceneKeyDown(this, (e) => this.onKey(e));
    const onResize = () => this.scene.restart({ levelId: this.currentId() });
    this.scale.on('resize', onResize);
    this.events.once('shutdown', () => this.scale.off('resize', onResize));
    syncMusic(this, app.data.settings.sound, 'music-menu');
    setDebug({ scene: 'Select', chapter: chapters[this.ci]?.id, levelId: this.currentId() });
  }

  private chapterOpen(ci: number): boolean {
    return app.author || isChapterUnlocked(chapters, ci, app.data.levels);
  }
  private levelOpen(ci: number, li: number): boolean {
    return app.author || isLevelUnlocked(chapters, ci, li, app.data.levels);
  }
  /** the current chapter has master mode (all its levels do) */
  private masterChapter(): boolean {
    return hasMaster(chapters[this.ci]!.levels[0]!);
  }
  /** master mode of the current level: absent from its chapter, locked (no gold yet) or open */
  private masterState(): 'none' | 'locked' | 'open' {
    const id = this.currentId();
    if (!hasMaster(id)) return 'none';
    return isMasterUnlocked(app.data.levels[id]) ? 'open' : 'locked';
  }
  private currentId(): string {
    return chapters[this.ci]!.levels[this.li]!;
  }
  private cols(): number {
    return Math.min(6, Math.max(3, Math.floor((this.scale.width - px(32)) / px(64))));
  }

  private redraw(): void {
    this.children.removeAll(true);
    this.draw();
    setDebug({ chapter: chapters[this.ci]?.id, levelId: this.currentId() });
  }

  private draw(): void {
    const ch = chapters[this.ci]!;
    const cx = this.scale.width / 2;
    this.add
      .text(cx, px(30), ch.name[getLang()] ?? ch.name.en, textStyle(18, COLORS.accent))
      .setOrigin(0.5);
    if (this.ci > 0) makeButton(this, px(30), px(30), '‹', () => this.switchChapter(-1), 18);
    if (this.ci < chapters.length - 1)
      makeButton(this, this.scale.width - px(30), px(30), '›', () => this.switchChapter(1), 18);
    // The help can wrap to two lines on a small screen: it stays anchored at the bottom.
    const help = this.chapterOpen(this.ci)
      ? this.add
          .text(
            cx,
            this.scale.height - px(14),
            t(this.masterChapter() ? 'selectHelp' : 'selectHelpBasic'),
            {
              ...textStyle(11, COLORS.dim),
              align: 'center',
              wordWrap: { width: this.scale.width - px(32) },
            },
          )
          .setOrigin(0.5, 1)
      : undefined;
    const menu = makeButton(
      this,
      px(40),
      this.scale.height - px(40),
      t('menu'),
      () => this.scene.start('Menu'),
      12,
    );
    if (help) {
      // The Menu button moves up just enough not to overlap the help.
      const overlap = menu.y + menu.height / 2 - (help.y - help.height);
      if (overlap > 0) menu.y -= overlap + px(4);
    }

    if (!this.chapterOpen(this.ci)) {
      this.add
        .text(
          cx,
          px(120),
          `🔒 ${ch.unlockAfter === 1 ? t('lockedHintOne') : t('lockedHint', { n: ch.unlockAfter })}`,
          textStyle(16, COLORS.locked),
        )
        .setOrigin(0.5);
      return;
    }

    const cols = this.cols();
    const cell = px(56);
    const gap = px(8);
    const gridW = cols * cell + (cols - 1) * gap;
    const x0 = (this.scale.width - gridW) / 2;
    const y0 = px(64);
    const g = this.add.graphics();
    ch.levels.forEach((id, i) => {
      const level = levelById(id);
      const rec = app.data.levels[id];
      const x = x0 + (i % cols) * (cell + gap);
      const y = y0 + Math.floor(i / cols) * (cell + gap);
      const open = this.levelOpen(this.ci, i);
      g.fillStyle(i === this.li ? 0x4a4360 : 0x2c2838, 1).fillRect(x, y, cell, cell);
      if (i === this.li) g.lineStyle(px(2), 0xffd25e, 1).strokeRect(x, y, cell, cell);
      this.add
        .text(
          x + cell / 2,
          y + cell * 0.35,
          open ? String(i + 1) : '🔒',
          textStyle(14, open ? COLORS.text : COLORS.locked),
        )
        .setOrigin(0.5);
      const my = y + cell * 0.75;
      // Without a gold threshold for a criterion, no medal can be awarded: no slot.
      const th = resolveThresholds(level.thresholds);
      const slots: (MedalKind | undefined)[] = [];
      if (th.moves) slots.push(rec?.medals.moves);
      if (th.time) slots.push(rec?.medals.time);
      if (hasMaster(id) && th.platinumMoves !== undefined)
        slots.push(rec?.medals.platinum ? 'platinum' : undefined);
      slots.forEach((m, k) =>
        drawMedal(g, x + (cell * (k + 1)) / (slots.length + 1), my, px(5), m),
      );
      const zone = this.add
        .zone(x, y, cell, cell)
        .setOrigin(0)
        .setInteractive({ useHandCursor: open });
      zone.on('pointerup', () => {
        if (!open) return;
        if (this.li === i) this.play('normal');
        else {
          this.li = i;
          this.redraw();
        }
      });
    });

    const level = levelById(this.currentId());
    const rec = app.data.levels[level.id];
    let y = y0 + Math.ceil(ch.levels.length / cols) * (cell + gap) + px(16);
    this.add.text(cx, y, level.name, textStyle(16)).setOrigin(0.5);
    y += px(22);
    if (level.author)
      this.add
        .text(cx, y, t('by', { author: level.author }), textStyle(12, COLORS.dim))
        .setOrigin(0.5);
    y += px(22);
    const th = resolveThresholds(level.thresholds);
    const master = this.masterState();
    const rows = thresholdRows(th, master !== 'none');
    const tg = this.add.graphics();
    for (const r of rows) {
      drawThresholdLine(this, tg, cx, y, t(r.kind), r.tiers);
      y += px(18);
    }
    setDebug({ thresholds: rows, master });
    if (rows.length) y += px(4);
    if (rec?.completed) {
      const time = rec.bestTimeMs !== undefined ? formatTime(rec.bestTimeMs) : '–';
      this.add
        .text(
          cx,
          y,
          t('recordLine', { moves: rec.bestMoves ?? '–', time }),
          textStyle(12, COLORS.dim),
        )
        .setOrigin(0.5);
    }
    y += px(36);
    if (this.levelOpen(this.ci, this.li)) {
      const open = master === 'open';
      makeButton(this, open ? cx - px(80) : cx, y, t('play'), () => this.play('normal'), 16);
      if (open) makeButton(this, cx + px(80), y, t('master'), () => this.play('master'), 14);
      else if (master === 'locked') {
        y += px(30);
        this.add
          .text(cx, y, `🔒 ${t('masterLocked')}`, {
            ...textStyle(11, COLORS.dim),
            align: 'center',
            wordWrap: { width: this.scale.width - px(32) },
          })
          .setOrigin(0.5);
      }
    }
    if (authorServerAvailable()) {
      // the button only appears if a solution is saved (asynchronous read)
      const id = level.id;
      const by = y + px(44);
      void fetchSolution(id).then((sol) => {
        if (!sol || !this.sys.isActive() || this.currentId() !== id) return;
        const b = makeButton(this, cx, by, t('replaySaved'), () => this.replaySaved(), 12);
        b.setName('replaySaved');
      });
    }
  }

  private switchChapter(delta: number): void {
    const ci = this.ci + delta;
    if (ci < 0 || ci >= chapters.length) return;
    this.ci = ci;
    this.li = 0;
    this.redraw();
  }

  private play(mode: Mode): void {
    if (!this.levelOpen(this.ci, this.li)) return;
    const level = levelById(this.currentId());
    if (mode === 'master' && this.masterState() !== 'open') return;
    this.scene.start('Game', { levelId: level.id, mode });
  }

  private async replaySaved(): Promise<void> {
    if (!authorServerAvailable()) return;
    const id = this.currentId();
    const sol = await fetchSolution(id);
    if (!this.sys.isActive() || this.currentId() !== id) return;
    if (!sol) {
      this.add
        .text(
          this.scale.width / 2,
          this.scale.height - px(64),
          t('noSavedSolution'),
          textStyle(12, COLORS.accent),
        )
        .setOrigin(0.5);
      return;
    }
    this.scene.start('Replay', {
      levelId: id,
      moves: sol.moves,
      label: t('labelSaved'),
      back: { scene: 'Select', data: { levelId: id } },
    });
  }

  private onKey(e: KeyboardEvent): void {
    const n = chapters[this.ci]!.levels.length;
    const cols = this.cols();
    const moveTo = (li: number) => {
      if (li >= 0 && li < n) {
        this.li = li;
        this.redraw();
      }
    };
    switch (e.key) {
      case 'ArrowLeft':
        return moveTo(this.li - 1);
      case 'ArrowRight':
        return moveTo(this.li + 1);
      case 'ArrowUp':
        return moveTo(this.li - cols);
      case 'ArrowDown':
        return moveTo(this.li + cols);
      case 'PageUp':
        return this.switchChapter(-1);
      case 'PageDown':
        return this.switchChapter(1);
      case 'Enter':
        return this.play('normal');
      case 'Escape':
        this.scene.start('Menu');
        return;
      default:
        if (e.key.toLowerCase() === 'p') this.play('master');
        else if (e.key.toLowerCase() === 's') void this.replaySaved();
    }
  }
}
