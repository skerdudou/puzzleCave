import Phaser from 'phaser';
import { isChapterUnlocked, isLevelUnlocked, resolveThresholds, type Mode } from '@puzzlecave/core';
import { KonamiCode } from '../achievements';
import { app } from '../app';
import { setDebug } from '../debug';
import { dragOffset, swipeStep } from '../input/swipe';
import { prefersReducedMotion } from '../medalReveal';
import { konamiEntered } from '../konami';
import { keysLine } from '../levelIntro';
import { formatTime } from '../format';
import { getLang, t } from '../i18n';
import { onSceneKeyDown } from '../input/sceneKeys';
import { chapters, hasMaster, levelById, locate, masterState } from '../levels';
import {
  masterLineText,
  masterMedalName,
  masterStatus,
  thresholdLines,
  thresholdRows,
  type MedalKind,
} from '../medalInfo';
import { syncMusic } from '../music';
import { arrowTarget } from '../selectNav';
import {
  COLORS,
  HEADER_BAND,
  dpr,
  drawMedal,
  drawThresholdLine,
  headerBand,
  makeButton,
  px,
  textStyle,
} from '../ui';
import { isTouchDevice } from '../touch';
import { savedSolution, savedSolutionsAvailable } from '../author/client';

/** Below the band at the top (back to the menu, the game's name), base px. */
const BAND = HEADER_BAND;

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
    // where the player's progress is: the chapters the Konami code opened are not a reason to
    // start at the last one
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
    // the scene is reused: a restart (resize) while the page was aside puts it back
    this.settle = undefined;
    this.sliding = false;
    this.pageShift = 0;
    this.grid = undefined;
    this.neighbours = {};
    this.draw();
    const konami = new KonamiCode();
    onSceneKeyDown(this, (e) => {
      // the arrows of the code also move the selection, as on the menu they move the focus
      if (!e.repeat && konami.key(e.key) && konamiEntered(this)) this.redraw();
      this.onKey(e);
    });
    // a horizontal swipe changes chapter (a tile's own release ignores it: see swiped)
    // while the finger moves, the grids of levels follow it, the next chapter's beside this
    // one's (a rubber band where there is no chapter that way)
    this.input.on('pointermove', (p: Phaser.Input.Pointer) => {
      if (!p.isDown || this.sliding || prefersReducedMotion()) return;
      const dx = (p.x - p.downX) / dpr();
      const dy = (p.y - p.downY) / dpr();
      this.shiftPage(dragOffset(dx, dy, this.canSwitch(dx < 0 ? 1 : -1), this.pageW));
    });
    const release = (p: Phaser.Input.Pointer) => {
      if (this.sliding) return;
      const step = this.swiped(p);
      if (step && this.canSwitch(step)) this.slide(step);
      else this.settlePage(this.pageShift, 150);
    };
    this.input.on('pointerup', release);
    this.input.on('pointerupoutside', release);
    const onResize = () => this.scene.restart({ levelId: this.currentId() });
    this.scale.on('resize', onResize);
    // The WebGL context lost then restored (a phone's browser back from the background), the
    // mask's texture comes back empty, hiding the whole strip: drawn again.
    const onRestore = () => {
      if (this.clipMask) this.clipMask.needsUpdate = true;
    };
    this.game.renderer.on(Phaser.Renderer.Events.RESTORE_WEBGL, onRestore);
    this.events.once('shutdown', () => {
      this.scale.off('resize', onResize);
      this.game.renderer.off(Phaser.Renderer.Events.RESTORE_WEBGL, onRestore);
      this.clip?.destroy();
      this.clip = undefined;
      this.clipMask = undefined;
    });
    syncMusic(this, app.data.settings.sound, 'music-menu');
    setDebug({ scene: 'Select', chapter: chapters[this.ci]?.id, levelId: this.currentId() });
  }

  /** After an update's reload: the level picked (pwa.ts). */
  resumeData(): object {
    return { levelId: this.currentId() };
  }

  /**
   * A chapter's items for the arrow keys: its levels, or one only when it is locked (its lock: an
   * arrow goes on to the chapter beside, no level picked behind it). undefined: no such chapter.
   */
  private keySize(ci: number): number | undefined {
    const ch = chapters[ci];
    if (!ch) return undefined;
    return this.chapterOpen(ci) ? ch.levels.length : 1;
  }

  private chapterOpen(ci: number): boolean {
    return app.author || isChapterUnlocked(chapters, ci, app.data.levels, app.allChaptersOpen);
  }
  private levelOpen(ci: number, li: number): boolean {
    return app.author || isLevelUnlocked(chapters, ci, li, app.data.levels, app.allChaptersOpen);
  }
  /** the current chapter has master mode (all its levels do) */
  private masterChapter(): boolean {
    return hasMaster(chapters[this.ci]!.levels[0]!);
  }
  /** master mode of the current level: absent from its chapter, locked (no gold yet) or open */
  private masterState(): 'none' | 'locked' | 'open' {
    const id = this.currentId();
    return masterState(id, app.data.levels[id]);
  }
  private currentId(): string {
    return chapters[this.ci]!.levels[this.li]!;
  }
  /**
   * A low screen (phone in landscape): the grid on the left, the level's details on the right,
   * instead of one under the other.
   */
  private side(): boolean {
    return this.scale.width > this.scale.height && this.scale.height < px(600);
  }
  /** Width of the grid's column (the whole screen, or its left part). */
  private gridAreaW(): number {
    return this.side() ? Math.round(this.scale.width * 0.55) : this.scale.width;
  }
  private cols(): number {
    return Math.min(6, Math.max(3, Math.floor((this.gridAreaW() - px(32)) / px(64))));
  }
  /**
   * The grid's rows, the same for every chapter (the tallest one's, at least 3): what is under it
   * stays in place from one chapter to the next.
   */
  private rows(): number {
    const cols = this.cols();
    return Math.max(3, ...chapters.map((ch) => Math.ceil(ch.levels.length / cols)));
  }

  /** the keys line's height for a wrap width, measured once (key: width + text) */
  private keysHeights = new Map<string, number>();
  private keysHeight(keys: string, width: number): number {
    const key = `${width}|${keys}`;
    let h = this.keysHeights.get(key);
    if (h === undefined) {
      const k = this.add.text(0, 0, keys, {
        ...textStyle(11, COLORS.accent),
        align: 'center',
        wordWrap: { width },
      });
      h = k.height;
      k.destroy();
      this.keysHeights.set(key, h);
    }
    return h;
  }

  /**
   * From a level's name to its Play button, px: the most any level of any chapter takes (keys
   * line, thresholds, master line), so that the buttons stay in place while browsing.
   */
  private detailsHeight(infoW: number): number {
    let most = 0;
    for (const ch of chapters)
      for (const id of ch.levels) {
        const level = levelById(id);
        const keys = keysLine(level.initialKeys);
        const master = hasMaster(id);
        const rows = thresholdRows(resolveThresholds(level.thresholds), master);
        const h =
          px(44) +
          (keys ? this.keysHeight(keys, infoW - px(32)) + px(8) : 0) +
          thresholdLines(rows) * px(18) +
          (rows.length ? px(4) : 0) +
          (master ? px(18) : 0) +
          px(40);
        most = Math.max(most, h);
      }
    return most;
  }

  private redraw(): void {
    // destroyed, not just removed: a button's frame and its listeners go with it
    // (the Konami runner, an effect over the screen, runs on)
    for (const child of [...this.children.list]) if (!child.getData('fx')) child.destroy();
    this.draw();
    setDebug({
      chapter: chapters[this.ci]?.id,
      levelId: this.currentId(),
      prerenderListeners: this.events.listenerCount(Phaser.Scenes.Events.PRE_RENDER),
    });
  }

  private draw(): void {
    const ch = chapters[this.ci]!;
    const cx = this.scale.width / 2;
    const cols = this.cols();
    const cell = px(56);
    const gap = px(8);
    const gridW = cols * cell + (cols - 1) * gap;
    const side = this.side();
    const x0 = (this.gridAreaW() - gridW) / 2;
    const y0 = px(BAND + 60);
    // the chapter's name over its grid (in the left column on a low screen), between the arrows,
    // which stand by the grid's sides (further out when the name is wider)
    const gcx = x0 + gridW / 2;
    const title = this.add
      .text(gcx, px(BAND + 28), ch.name[getLang()] ?? ch.name.en, textStyle(18, COLORS.accent))
      .setOrigin(0.5);
    const reach = Math.max(gridW / 2 + px(4), title.width / 2 + px(10));
    // an arrow's centre: by the grid, but at least EDGE from the screen's sides (as the band's
    // back button; a touch screen's arrows are wider, to the finger's size)
    const EDGE = px(12);
    const arrowX = (d: -1 | 1, w: number) =>
      Math.min(this.scale.width - EDGE - w / 2, Math.max(EDGE + w / 2, gcx + d * (reach + px(16))));
    const arrows: Partial<Record<-1 | 1, Phaser.GameObjects.Text>> = {};
    const rowY = px(BAND + 28);
    for (const d of [-1, 1] as const) {
      if (!this.canSwitch(d)) continue;
      const a = this.button(0, rowY, d < 0 ? '‹' : '›', () => this.slide(d), 18);
      arrows[d] = a.setX(arrowX(d, a.width));
    }
    // the band: back to the menu, its left side lined up with the previous chapter's arrow (where
    // that arrow is, or would be on the first chapter); the game's name in the middle (smaller
    // than on the menu)
    const arrowW = (arrows[-1] ?? arrows[1])?.width ?? 0;
    const back = this.button(0, 0, `‹ ${t('menu')}`, () => this.scene.start('Menu'), 12);
    const name = headerBand(this, 'puzzleCave', back, arrowX(-1, arrowW) - arrowW / 2);
    setDebug({ selectBack: this.box(back), selectGameName: this.box(name) });
    setDebug({
      selectTitle: this.box(title),
      selectArrows: [arrows[-1], arrows[1]].map((a) => (a ? this.box(a) : null)),
      selectGrid: { x: x0 / dpr(), y: y0 / dpr(), w: gridW / dpr() },
    });
    // Keyboard help (not on a touch screen). It can wrap to two lines on a small screen: it
    // stays anchored at the bottom.
    const help =
      this.chapterOpen(this.ci) && !isTouchDevice()
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

    // the chapters' grids (or locks), side by side in a strip seen through the grid's width: what
    // a swipe moves sideways, alone; the neighbours show only while it moves
    const margin = px(16);
    const pageW = gridW + 2 * margin;
    this.pageW = pageW / dpr();
    const strip = this.add.container(this.pageShift * dpr(), 0);
    this.grid = strip;
    strip.add(this.drawPage(this.ci, x0, y0, this.li, true));
    this.pageAt = { x0, y0, pageW };
    this.neighbours = {};
    for (const d of [-1, 1] as const) this.drawNeighbour(d, 0);
    this.clip?.destroy();
    this.clip = this.make.graphics({}, false);
    this.clip.fillStyle(0xffffff).fillRect(x0 - margin, 0, pageW, this.scale.height);
    // (WebGL: a Mask filter, in screen coordinates as the strip moves under it)
    const mask = strip
      .enableFilters()
      .filters?.external.addMask(this.clip, false, undefined, 'world');
    // the clip never changes: drawn into the mask once, not every frame
    if (mask) mask.autoUpdate = false;
    this.clipMask = mask;
    if (!this.chapterOpen(this.ci)) return;

    const level = levelById(this.currentId());
    const rec = app.data.levels[level.id];
    // the details: under the grid, or in the right column on a low screen
    const infoW = side ? this.scale.width - this.gridAreaW() : this.scale.width;
    const icx = side ? this.gridAreaW() + infoW / 2 : cx;
    let y = side ? y0 + px(8) : y0 + this.rows() * (cell + gap) + px(16);
    // the buttons' row: the same for every level
    const buttonsY = y + this.detailsHeight(infoW);
    this.add.text(icx, y, level.name, textStyle(16)).setOrigin(0.5);
    y += px(22);
    if (level.author)
      this.add
        .text(icx, y, t('by', { author: level.author }), textStyle(12, COLORS.dim))
        .setOrigin(0.5);
    y += px(22);
    // the keys at start, when not 0 (as the level's banner says them)
    const keys = keysLine(level.initialKeys);
    setDebug({ keysLine: keys });
    if (keys) {
      const k = this.add
        .text(icx, y - px(6), keys, {
          ...textStyle(11, COLORS.accent),
          align: 'center',
          wordWrap: { width: infoW - px(32) },
        })
        .setOrigin(0.5, 0);
      y += k.height + px(8);
    }
    const th = resolveThresholds(level.thresholds);
    const master = this.masterState();
    const rows = thresholdRows(th, master !== 'none');
    const tg = this.add.graphics();
    for (const r of rows) {
      if (r.kind === 'master') {
        // master mode: one line per medal, named when it has room ("Master ≤ 610 moves · time
        // ≤ 3:11.38", then "Grand master ≤ 538 moves · time ≤ 1:56.88"), else "♛ ≤ 610 moves · …"
        for (const tier of r.tiers) {
          drawThresholdLine(this, tg, icx, y, '', [tier], {
            maxWidth: infoW - px(16),
            named: masterMedalName,
          });
          y += px(18);
        }
        continue;
      }
      drawThresholdLine(this, tg, icx, y, t(r.kind), r.tiers, { maxWidth: infoW - px(16) });
      y += px(18);
    }
    setDebug({ thresholds: rows, master });
    if (rows.length) y += px(4);
    if (rec?.completed) {
      const time = rec.bestTimeMs !== undefined ? formatTime(rec.bestTimeMs) : '–';
      this.add
        .text(
          icx,
          y,
          t('recordLine', { moves: rec.bestMoves ?? '–', time }),
          textStyle(12, COLORS.dim),
        )
        .setOrigin(0.5);
    }
    // master mode on its own line: best master run (named after the medal held), not yet, or
    // locked (said under the buttons)
    const masterText = masterLineText(masterStatus(rec, master !== 'none'));
    if (masterText) {
      y += px(18);
      this.add.text(icx, y, masterText, textStyle(12, '#9be7ff')).setOrigin(0.5);
    }
    setDebug({ masterLine: masterText, masterMedal: rec?.medals.master ?? null });
    y = buttonsY;
    let playButton: Phaser.GameObjects.Text | undefined;
    if (this.levelOpen(this.ci, this.li)) {
      const open = master === 'open';
      const row = [
        this.button(open ? icx - px(80) : icx, y, t('play'), () => this.play('normal'), 16),
      ];
      if (open) row.push(this.button(icx + px(80), y, t('master'), () => this.play('master'), 14));
      playButton = row[0];
      const rowY = y;
      let bottom = row[0]!.getBounds().bottom;
      if (master === 'locked') {
        y += px(36);
        const locked = this.add
          .text(icx, y, `🔒 ${t('masterLocked')}`, {
            ...textStyle(11, COLORS.dim),
            align: 'center',
            wordWrap: { width: infoW - px(32) },
          })
          .setOrigin(0.5);
        bottom = Math.max(bottom, locked.getBounds().bottom);
      }
    }
    // for the e2e tests: the Play button's centre, CSS px (none on a locked level)
    setDebug({ playButton: playButton && [playButton.x / dpr(), playButton.y / dpr()] });
    if (savedSolutionsAvailable()) {
      // the button only appears if a solution is saved (asynchronous read)
      const id = level.id;
      const by = y + px(52);
      void savedSolution(id).then((sol) => {
        if (!sol || !this.sys.isActive() || this.currentId() !== id) return;
        const b = this.button(icx, by, t('replaySaved'), () => this.replaySaved(), 12);
        b.setName('replaySaved');
      });
    }
  }

  /**
   * The chapter `d` away in the strip, beside this one's grid, with level `li` picked (where a
   * swipe or an arrow lands there); shown only while the strip moves.
   */
  private drawNeighbour(d: -1 | 1, li: number): void {
    this.neighbours[d]?.destroy();
    delete this.neighbours[d];
    if (!this.canSwitch(d) || !this.grid || !this.pageAt) return;
    const { x0, y0, pageW } = this.pageAt;
    const page = this.drawPage(this.ci + d, x0 + d * pageW, y0, li, false);
    page.setVisible(this.pageShift !== 0);
    this.neighbours[d] = page;
    this.grid.add(page);
  }

  /**
   * A chapter's grid of levels at (x0, y0), or its lock, in a container, level `picked` lit;
   * `current`: the one shown, whose tiles can be pressed.
   */
  private drawPage(
    ci: number,
    x0: number,
    y0: number,
    picked: number,
    current: boolean,
  ): Phaser.GameObjects.Container {
    const ch = chapters[ci]!;
    const page = this.add.container(0, 0);
    const cols = this.cols();
    const cell = px(56);
    const gap = px(8);
    const gridW = cols * cell + (cols - 1) * gap;
    if (!this.chapterOpen(ci)) {
      page.add(
        this.add
          .text(
            x0 + gridW / 2,
            px(BAND + 116),
            `🔒 ${ch.unlockAfter === 1 ? t('lockedHintOne') : t('lockedHint', { n: ch.unlockAfter })}`,
            { ...textStyle(16, COLORS.locked), align: 'center', wordWrap: { width: gridW } },
          )
          .setOrigin(0.5),
      );
      return page;
    }
    // by the progression rule alone (author mode opens every tile): read by the e2e tests
    if (current)
      setDebug({
        unlocked: ch.levels.map((_, i) =>
          isLevelUnlocked(chapters, ci, i, app.data.levels, app.allChaptersOpen),
        ),
      });
    const g = this.add.graphics();
    page.add(g);
    ch.levels.forEach((id, i) => {
      const level = levelById(id);
      const rec = app.data.levels[id];
      const x = x0 + (i % cols) * (cell + gap);
      const y = y0 + Math.floor(i / cols) * (cell + gap);
      const open = this.levelOpen(ci, i);
      g.fillStyle(i === picked ? 0x4a4360 : 0x2c2838, 1).fillRect(x, y, cell, cell);
      if (i === picked) g.lineStyle(px(2), 0xffd25e, 1).strokeRect(x, y, cell, cell);
      page.add(
        this.add
          .text(
            x + cell / 2,
            y + cell * 0.35,
            open ? String(i + 1) : '🔒',
            textStyle(14, open ? COLORS.text : COLORS.locked),
          )
          .setOrigin(0.5),
      );
      const my = y + cell * 0.75;
      // Without a gold threshold for a criterion, no medal can be awarded: no slot.
      const th = resolveThresholds(level.thresholds);
      const slots: (MedalKind | undefined)[] = [];
      if (th.moves) slots.push(rec?.medals.moves);
      if (th.time) slots.push(rec?.medals.time);
      // master mode: one slot, its best medal (master or grand master)
      if (hasMaster(id) && th.grandMasterMoves !== undefined) slots.push(rec?.medals.master);
      slots.forEach((m, k) =>
        drawMedal(g, x + (cell * (k + 1)) / (slots.length + 1), my, px(5), m),
      );
      if (!current) return;
      const zone = this.add
        .zone(x, y, cell, cell)
        .setOrigin(0)
        .setInteractive({ useHandCursor: open });
      page.add(zone);
      zone.on('pointerup', (p: Phaser.Input.Pointer) => {
        if (!open || this.swiped(p)) return;
        if (this.li === i) this.play('normal');
        else {
          this.li = i;
          this.redraw();
        }
      });
    });
    return page;
  }

  /** A text's bounds, CSS px (for the e2e tests). */
  private box(o: Phaser.GameObjects.Text): { x: number; y: number; w: number; h: number } {
    const b = o.getBounds();
    return { x: b.x / dpr(), y: b.y / dpr(), w: b.width / dpr(), h: b.height / dpr() };
  }

  /** There is a chapter `delta` away from this one. */
  private canSwitch(delta: number): boolean {
    const ci = this.ci + delta;
    return ci >= 0 && ci < chapters.length;
  }

  /** How far the grid is moved sideways, CSS px (> 0: to the right). */
  private pageShift = 0;
  /** the strip of grids of levels (or locks), the one part of the page a swipe moves */
  private grid?: Phaser.GameObjects.Container;
  /** the chapters beside this one in the strip, shown while it moves */
  private neighbours: Partial<Record<-1 | 1, Phaser.GameObjects.Container>> = {};
  /** where this chapter's grid is (px), and from one grid to the next in the strip */
  private pageAt?: { x0: number; y0: number; pageW: number };
  /** the strip is seen through the grid's width */
  private clip?: Phaser.GameObjects.Graphics;
  /** the clip drawn into the strip's mask (WebGL) */
  private clipMask?: Phaser.Filters.Mask;
  /** from one grid to the next in the strip, CSS px */
  private pageW = 0;
  /** the strip is sliding to the next chapter: the finger does not move it meanwhile */
  private sliding = false;

  /** Moves the grid of levels sideways by `x` CSS px (the rest of the page stays). */
  private shiftPage(x: number): void {
    this.settle?.remove();
    this.settle = undefined;
    this.pageShift = x;
    this.grid?.setX(x * dpr());
    for (const n of Object.values(this.neighbours)) n.setVisible(x !== 0);
    setDebug({ pageShift: x });
  }

  private settle?: Phaser.Tweens.Tween;

  /** The page, from `from` CSS px aside, glides back into place in `ms` (at once: reduced motion). */
  private settlePage(from: number, ms: number): void {
    this.shiftPage(from);
    if (from === 0) return;
    if (prefersReducedMotion()) return this.shiftPage(0);
    const s = { x: from };
    this.settle = this.tweens.add({
      targets: s,
      x: 0,
      duration: ms,
      ease: 'Cubic.easeOut',
      onUpdate: () => {
        this.pageShift = s.x;
        this.grid?.setX(s.x * dpr());
      },
      onComplete: () => {
        this.settle = undefined;
        this.shiftPage(0);
      },
    });
  }

  /**
   * To the chapter `step` away: the strip slides from where it is until that chapter's grid is
   * in place (at once with reduced motion), then the page is drawn for it.
   */
  private slide(step: -1 | 1, li = 0): void {
    // a press during a slide: that one ends at once (its chapter drawn), this one starts
    if (this.sliding) this.settle?.complete();
    if (!this.canSwitch(step) || this.sliding) return;
    if (prefersReducedMotion()) return this.switchChapter(step, li);
    const to = -step * this.pageW;
    const from = this.pageShift;
    this.shiftPage(from);
    // the chapter it goes to shows from the start (still at 0, the strip hid it), with the level
    // it lands on picked (an arrow back: the last one, or the same column)
    if (li !== 0) this.drawNeighbour(step, li);
    for (const n of Object.values(this.neighbours)) n.setVisible(true);
    this.sliding = true;
    const s = { x: from };
    this.settle = this.tweens.add({
      targets: s,
      x: to,
      // the rest of the way: a quick finish for a long swipe
      duration: Math.max(120, (260 * Math.abs(to - from)) / Math.max(1, this.pageW)),
      ease: 'Cubic.easeOut',
      onUpdate: () => {
        this.pageShift = s.x;
        this.grid?.setX(s.x * dpr());
      },
      onComplete: () => {
        this.settle = undefined;
        this.sliding = false;
        this.switchChapter(step, li);
      },
    });
  }

  private switchChapter(delta: number, li = 0): void {
    const ci = this.ci + delta;
    if (ci < 0 || ci >= chapters.length) return;
    this.ci = ci;
    this.li = Math.min(li, this.keySize(ci)! - 1);
    this.settle?.remove();
    this.settle = undefined;
    this.sliding = false;
    this.pageShift = 0;
    setDebug({ pageShift: 0 });
    this.redraw();
  }

  private play(mode: Mode): void {
    if (!this.levelOpen(this.ci, this.li)) return;
    const level = levelById(this.currentId());
    if (mode === 'master' && this.masterState() !== 'open') return;
    this.scene.start('Game', { levelId: level.id, mode });
  }

  private async replaySaved(): Promise<void> {
    if (!savedSolutionsAvailable()) return;
    const id = this.currentId();
    const sol = await savedSolution(id);
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

  /** A button whose release ending a swipe is not a press (the swipe changes chapter). */
  private button(
    x: number,
    y: number,
    label: string,
    onClick: () => void,
    size: number,
  ): Phaser.GameObjects.Text {
    return makeButton(
      this,
      x,
      y,
      label,
      (p?: Phaser.Input.Pointer) => {
        if (!p || !this.swiped(p)) onClick();
      },
      size,
    );
  }

  /** The chapter a released pointer swiped to (+1, -1), or 0 for a tap. */
  private swiped(p: Phaser.Input.Pointer): -1 | 0 | 1 {
    return swipeStep((p.upX - p.downX) / dpr(), (p.upY - p.downY) / dpr());
  }

  private onKey(e: KeyboardEvent): void {
    if (e.key.startsWith('Arrow')) {
      // a chapter sliding in: it is there at once, the arrow moves in it
      if (this.sliding) this.settle?.complete();
      const to = arrowTarget(
        e.key,
        this.li,
        this.keySize(this.ci)!,
        this.cols(),
        this.keySize(this.ci - 1),
        this.keySize(this.ci + 1),
      );
      if (!to) return;
      if (to.chapter !== 0) return this.slide(to.chapter, to.li);
      this.li = to.li;
      this.redraw();
      return;
    }
    switch (e.key) {
      case 'PageUp':
        return this.slide(-1);
      case 'PageDown':
        return this.slide(1);
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
