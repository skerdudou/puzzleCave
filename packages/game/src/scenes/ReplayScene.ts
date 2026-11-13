import Phaser from 'phaser';
import { Session, type Dir, type LevelData, type Mode } from '@puzzlecave/core';
import { app } from '../app';
import { setDebug } from '../debug';
import { ellipsize } from '../format';
import { t, type MessageKey } from '../i18n';
import { levelById, levelTitle } from '../levels';
import { showNotice } from '../notice';
import { deleteReplay, getReplay, replayText, setReplay, toSaved } from '../replays';
import { TwoPress } from '../twoPress';
import { Playback } from '../author/playback';
import { AuthorSavePanel } from '../author/authorSavePanel';
import { authorServerAvailable } from '../author/client';
import { HoldRepeat } from '../input/holdRepeat';
import { onSceneKeyDown } from '../input/sceneKeys';
import { chapterTint } from '../render/ambience';
import { AmbienceView, HUD_DEPTH } from '../render/AmbienceView';
import { BoardView } from '../render/BoardView';
import { boardLayout, fractionalZoom } from '../render/layout';
import { isTouchDevice } from '../touch';
import {
  COLORS,
  copyToClipboard,
  dpr,
  hex,
  makeButton,
  placeIconBefore,
  px,
  textIcon,
  textStyle,
  TOUCH_TARGET,
} from '../ui';
import { keepAwake } from '../wakeLock';

export interface ReplaySceneData {
  levelId: string;
  moves: Dir[];
  /** “my solution”, “optimized solution”… */
  label: string;
  /** scene to reopen with Escape */
  back?: { scene: string; data?: object };
  /** resume after a resize */
  startIndex?: number;
  paused?: boolean;
  /** the rules the moves were played under (master mode lets water through) */
  mode?: Mode;
  /**
   * the player's own run, with a row to keep it: not kept yet, or the level's saved replay.
   * Absent (the author's solutions): Export alone.
   */
  saving?: 'unsaved' | 'saved';
  /**
   * Author mode, the run just played (from the result screen): its tools beside the others, its
   * Tiled properties (goldMoves, goldTime) and, with the development server, saved as the level's
   * solution.
   */
  authorRun?: { timeMs: number };
}

/** The progress bar's height and the room it takes above the buttons, base px. */
const BAR_ROOM = 36;

/** A row of buttons, base px from one to the next. */
const ROW = 48;

/** The shortest the bar gets with the run's actions beside it, base px. */
const MIN_BAR = 200;

type ReplayAction = 'save' | 'export' | 'import' | 'delete' | 'tiled' | 'solution';

const ACTION_LABELS: Record<ReplayAction, MessageKey> = {
  save: 'replaySave',
  export: 'replayExport',
  import: 'replayImport',
  delete: 'replayDelete',
  tiled: 'copyTiled',
  solution: 'saveSolution',
};

/** Solution replay: all rules come from Session, display from BoardView. */
export class ReplayScene extends Phaser.Scene {
  private info!: ReplaySceneData;
  private level!: LevelData;
  private session!: Session;
  private board!: BoardView;
  private ambience!: AmbienceView;
  private playback!: Playback;
  /** number of moves currently applied to the board */
  private shown = 0;
  private hud: Phaser.GameObjects.GameObject[] = [];
  private moveText?: Phaser.GameObjects.Text;
  private keysText?: Phaser.GameObjects.Text;
  private keyIcon?: Phaser.GameObjects.Image;
  private speedText?: Phaser.GameObjects.Text;
  /** sets the Pause/Play button's word, its width unchanged */
  private playLabel?: (label: string) => void;
  /** the progress bar: its track (device px) and its drawing */
  private bar?: { x: number; y: number; w: number; g: Phaser.GameObjects.Graphics };
  /** the bar is being dragged: playing again once released if it was */
  private seeking: { wasPlaying: boolean; id: number } | null = null;
  /** ◀ and ▶ held: one move, then more while the finger stays */
  private hold!: HoldRepeat;
  /** the screen kept on (while the replay plays) */
  private awake: { release(): void } | null = null;
  /**
   * the bar moved while dragged: the board follows it once a frame (a finger can move several
   * times between two), in update()
   */
  private seekPending = false;
  /** Save over a saved replay and Delete ask first */
  private confirm!: TwoPress;
  /** author mode: the run saved as the level's solution, the server's answer */
  private authorPanel?: AuthorSavePanel;

  constructor() {
    super('Replay');
  }

  init(data: ReplaySceneData): void {
    this.info = data;
    this.level = levelById(data.levelId);
    this.playback = new Playback(data.moves.length);
    this.hud = [];
    this.shown = 0;
    this.seeking = null;
    this.awake = null;
    this.seekPending = false;
    // the last screen's question stops, its expiry with it
    this.confirm?.reset();
    this.confirm = new TwoPress(COLORS.text);
    this.authorPanel = undefined;
    // a button left asking before a restart (a resize) is drawn again at rest
    setDebug({ armed: null });
  }

  private get mode(): Mode {
    return this.info.mode ?? 'normal';
  }

  create(): void {
    this.session = new Session(this.level, this.mode);
    this.hold = new HoldRepeat(
      (d) => this.stepBy(d === 'right' ? 1 : -1),
      () => app.data.settings.repeatRate,
    );
    // the cave first: the board and the HUD go over it (a resize restarts the scene)
    const layout = this.layoutNow();
    this.ambience = new AmbienceView(this, {
      levelId: this.level.id,
      hudHeight: this.topReserve(),
    });
    this.ambience.layout(layout);
    this.board = new BoardView(this, this.session.state, layout, app.data.settings.smoothing);
    this.board.setTerrainTint(chapterTint(this.level.id));
    this.buildHud();
    const start = this.info.startIndex ?? 0;
    if (start > 0) {
      this.playback.index = start;
      this.sync(0);
    }
    // a replay opens paused (the board seen first, Play when ready); a restart (a resize, a save)
    // keeps it playing if it was
    if (this.info.paused !== false) this.playback.playing = false;
    this.refreshHud();

    onSceneKeyDown(this, (e) => this.onKey(e));
    // the bar: pressed, then dragged, it moves the replay to that point
    this.input.on('pointermove', (p: Phaser.Input.Pointer) => {
      if (this.seeking?.id === p.id && p.isDown) this.seekTo(p.x);
    });
    const release = (p: Phaser.Input.Pointer) => {
      this.hold.release(p.id);
      if (this.seeking?.id !== p.id) return;
      // where the finger was lifted (its last move may not have been seen)
      this.seekTo(p.x);
      if (this.seeking.wasPlaying && !this.playback.atEnd) this.playback.playing = true;
      this.seeking = null;
      if (this.seekPending) this.syncSeek();
    };
    this.input.on('pointerup', release);
    this.input.on('pointerupoutside', release);
    const onResize = () =>
      this.scene.restart({
        ...this.info,
        startIndex: this.playback.index,
        paused: !this.playback.playing,
      });
    this.scale.on('resize', onResize);
    this.events.once('shutdown', () => {
      this.awake?.release();
      this.awake = null;
      this.hold.reset();
      this.scale.off('resize', onResize);
      this.ambience.destroy();
      this.board.destroy();
    });
    setDebug({ scene: 'Replay', levelId: this.level.id, replayTotal: this.info.moves.length });
  }

  override update(time: number, delta: number): void {
    this.ambience.update(time, this.board.heroCentre());
    const n = this.playback.tick(delta);
    if (n > 0) this.sync(this.playback.animMs());
    if (this.seekPending) this.syncSeek();
    this.refreshHud();
  }

  /** The board brought to the bar's move. */
  private syncSeek(): void {
    this.seekPending = false;
    this.sync(0);
  }

  private layoutNow() {
    return boardLayout(
      this.scale.width,
      this.scale.height,
      this.level.width,
      this.level.height,
      16,
      this.topReserve(),
      this.bottomReserve(),
      fractionalZoom(window.devicePixelRatio || 1),
    );
  }

  /** The title, the move counter and the speed above the board (the speed on a 3rd line). */
  private topReserve(): number {
    return px(this.speedBelow() ? 88 : 64);
  }

  /**
   * The counters' line is too short for "Move 999 / 999 · Keys -9 · End" and the speed beside
   * it (a phone): the speed goes on a line of its own.
   */
  private speedBelow(): boolean {
    const total = this.info.moves.length;
    const probe = (s: string) => {
      const o = this.add.text(0, 0, s, textStyle(14));
      const w = o.width;
      o.destroy();
      return w;
    };
    const counters =
      probe(`${t('replayMove', { i: total, n: total })} · ${t('keys')} -99 · ${t('replayEnd')}`) +
      px(20);
    const speed = probe(t('replaySpeed', { v: 20 }));
    return counters + speed + px(36) > this.scale.width;
  }

  private narrow(): boolean {
    return this.scale.width < px(560);
  }

  /**
   * The controls, the bar and the run's actions under the board. Narrow: two rows of controls,
   * the actions on a row of their own above them, then the bar. Wide (a phone in landscape, short
   * of height): one row of controls, the actions on the bar's line at its right, in a row as tall
   * as a button in place of the bar's room.
   */
  private bottomReserve(): number {
    const n = this.actionRows().length;
    if (this.narrow()) return px(124 + BAR_ROOM + n * ROW);
    if (this.actionsBesideBar()) return px(72 + ROW);
    return px(72 + BAR_ROOM + n * ROW);
  }

  /**
   * The actions beside the bar rather than on rows of their own (see bottomReserve): a wide
   * screen, all of them on one row.
   */
  private actionsBesideBar(): boolean {
    return this.actionRows().length === 1 && !this.narrow();
  }

  /** Room for one row of actions, device px: beside the bar, or the screen's width. */
  private actionsRoom(besideBar: boolean): number {
    const w = this.scale.width;
    return besideBar ? w - px(20 + MIN_BAR + 16 + 12) : w - px(16);
  }

  /** A row of actions' width at their smallest letters, device px. */
  private actionsMinWidth(ids: ReplayAction[]): number {
    const minW = isTouchDevice() ? px(TOUCH_TARGET) : 0;
    return ids.reduce((sum, id, i) => {
      const m = this.add.text(0, 0, t(ACTION_LABELS[id]), textStyle(9));
      const bw = Math.max(m.width + 2 * px(8), minW);
      m.destroy();
      return sum + bw + (i ? px(8) : 0);
    }, 0);
  }

  /**
   * The actions in rows, the lowest last: one row, or (author mode, not enough room for all on
   * one) the author's tools on a row above the player's. None: no row.
   */
  private actionRows(): ReplayAction[][] {
    const all = this.actions();
    if (!all.length) return [];
    const isAuthor = (id: ReplayAction) => id === 'tiled' || id === 'solution';
    const author = all.filter(isAuthor);
    if (!author.length) return [all];
    const oneRow = this.actionsMinWidth(all) <= this.actionsRoom(!this.narrow());
    return oneRow ? [all] : [author, all.filter((id) => !isAuthor(id))];
  }

  /** The buttons above the controls: what the player can do with this run. */
  private actions(): ReplayAction[] {
    const player = ((): ReplayAction[] => {
      switch (this.info.saving) {
        case 'unsaved':
          return ['save', 'export'];
        case 'saved':
          return ['export', 'import', 'delete'];
        default:
          // the author's solutions: copied as text, to be imported as a replay
          return ['export'];
      }
    })();
    if (!this.info.authorRun) return player;
    return [...player, 'tiled', ...(authorServerAvailable() ? ['solution' as const] : [])];
  }

  /** Brings the board to the playback index (forward: moves replayed; backward: rebuilt). */
  private sync(animMs: number): void {
    const target = this.playback.index;
    if (this.shown > target) {
      this.session = new Session(this.level, this.mode);
      this.shown = 0;
      for (; this.shown < target; this.shown++) this.session.move(this.info.moves[this.shown]!);
      this.board.rebuild(this.session.state);
      return;
    }
    // a long jump forward (the bar): played without animation, the last one too
    if (target - this.shown > 1) animMs = 0;
    while (this.shown < target) {
      const events = this.session.move(this.info.moves[this.shown]!);
      this.shown++;
      // only the last move of a batch is animated
      this.board.apply(this.session.state, events, this.shown === target ? animMs : 0);
    }
  }

  private buildHud(): void {
    for (const o of this.hud) o.destroy();
    this.playLabel = undefined;
    this.hud = [];
    const w = this.scale.width;
    const h = this.scale.height;
    // the title on one line, cut with "…" when too long for the screen
    const title = this.add.text(px(12), px(14), '', textStyle(14, COLORS.accent)).setOrigin(0, 0);
    const full = `${levelTitle(this.level)} — ${this.info.label}`;
    title.setText(ellipsize(full, (s) => title.setText(s).width <= w - px(24)));
    this.hud.push(title);
    // "Move 3/12 · ", then the key's art and "Keys 1" (placed again as the move count grows)
    this.moveText = this.add.text(px(12), px(38), '', textStyle(14)).setOrigin(0, 0);
    this.keysText = this.add.text(px(12), px(38), '', textStyle(14)).setOrigin(0, 0);
    this.keyIcon = textIcon(this, 'KEY');
    // the speed at the right of the counters, or under them on a phone
    this.speedText = this.speedBelow()
      ? this.add.text(px(12), px(62), '', textStyle(14)).setOrigin(0, 0)
      : this.add.text(w - px(12), px(38), '', textStyle(14)).setOrigin(1, 0);
    this.hud.push(this.moveText, this.keyIcon, this.keysText, this.speedText);
    // the keys only: a touch screen has the buttons
    const help = this.add
      .text(w / 2, h - px(10), isTouchDevice() ? '' : t('replayHelp'), {
        ...textStyle(10, COLORS.dim),
        align: 'center',
        wordWrap: { width: w - px(16) },
      })
      .setOrigin(0.5, 1);
    this.hud.push(help);

    // ◀ and ▶ step on the press, and again while held (the key repeat setting)
    const held = () => {};
    const rows: [string, () => void, (1 | -1)?][][] = [
      [
        [t('toStart'), () => this.toStart()],
        ['◀', held, -1],
        [t('pause'), () => this.togglePlay()],
        ['▶', held, 1],
        ['−', () => this.faster(-1)],
        ['+', () => this.faster(1)],
        [t('back'), () => this.leave()],
      ],
    ];
    if (this.narrow()) {
      const all = rows[0]!;
      rows.length = 0;
      rows.push(all.slice(0, 4), all.slice(4));
    }
    const playIndex = 2; // 3rd button of the full row: Start, ◀, Pause/Play…
    let flat = 0;
    let y = h - help.height - px(26) - (rows.length - 1) * px(ROW);
    // the controls' first row (y moves down through them below)
    const controlsY = y;
    // the run's actions a row above the controls: on rows of their own, or on the bar's line
    const actionsY = y - px(ROW);
    const besideBar = this.actionsBesideBar();
    const actionRows = this.actionRows();
    const centres: Record<string, [number, number]> = {};
    let actionsLeft = w;
    actionRows.forEach((ids, i) => {
      const ry = actionsY - (actionRows.length - 1 - i) * px(ROW);
      actionsLeft = this.buildActions(ry, besideBar, ids, centres);
    });
    setDebug({ replayActions: actionRows.flat(), replayActionButtons: centres });
    // the top of the actions' rows, the bar over them
    const actionsTop = actionsY - Math.max(0, actionRows.length - 1) * px(ROW);
    const stepButtons: Record<string, [number, number]> = {};
    for (const row of rows) {
      const buttons = row.map(([label, fn]) => makeButton(this, 0, y, label, fn, 13));
      const pi = playIndex - flat;
      // Pause and Play take turns on one button: as wide as the longer, nothing moves
      if (pi >= 0 && pi < buttons.length)
        this.playLabel = fixedWidth(buttons[pi]!, [t('pause'), t('playBtn')]);
      const gap = px(8);
      const total = buttons.reduce((s, b) => s + b.width, 0) + gap * (buttons.length - 1);
      let x = (w - total) / 2;
      for (const [i, b] of buttons.entries()) {
        b.setOrigin(0, 0.5).setX(x);
        x += b.width + gap;
        this.hud.push(b);
        const step = row[i]![2];
        if (step) {
          this.holdOn(b, step);
          stepButtons[step > 0 ? 'forward' : 'back'] = [b.getBounds().centerX / dpr(), y / dpr()];
        }
      }
      flat += row.length;
      y += px(ROW);
    }
    if (besideBar) this.buildBar(actionsY, actionsLeft - px(16));
    else {
      const buttonsTop = (actionRows.length ? actionsTop : controlsY) - px(22);
      this.buildBar(buttonsTop - px(BAR_ROOM / 2), w - px(20));
    }
    // above the cave's darkness, vignette and HUD band (a button's frame follows it, 1 below)
    for (const o of this.hud) (o as Phaser.GameObjects.Text).setDepth(HUD_DEPTH);
    setDebug({ replayStepButtons: stepButtons });
  }

  /**
   * The run's actions (Export alone for the author's solutions) on `y`: centred, or at the screen's
   * right beside the bar. Returns their left edge (device px).
   */
  private buildActions(
    y: number,
    besideBar: boolean,
    ids: ReplayAction[],
    centres: Record<string, [number, number]>,
  ): number {
    const buttons = ids.map((id) => {
      const label = t(ACTION_LABELS[id]);
      const b: Phaser.GameObjects.Text = makeButton(
        this,
        0,
        y,
        label,
        () => this.act(id, b, label),
        12,
      );
      return b;
    });
    const w = this.scale.width;
    const gap = px(8);
    const width = () => buttons.reduce((s, b) => s + b.width, 0) + gap * (buttons.length - 1);
    // long words (German) on a phone: smaller letters rather than past the room they have
    const room = this.actionsRoom(besideBar);
    let size = 12;
    while (width() > room && size > 9) {
      size--;
      for (const b of buttons) b.setFontSize(`${px(size)}px`);
    }
    const left = besideBar ? w - px(12) - width() : (w - width()) / 2;
    let x = left;
    for (const [i, b] of buttons.entries()) {
      b.setOrigin(0, 0.5).setX(x);
      x += b.width + gap;
      this.hud.push(b);
      centres[ids[i]!] = [b.getBounds().centerX / dpr(), y / dpr()];
    }
    return left;
  }

  private act(id: ReplayAction, button: Phaser.GameObjects.Text, label: string): void {
    const levelId = this.level.id;
    const saved = () => toSaved(this.info.moves, this.mode);
    // another button pressed: the one asking is put back
    if (id !== 'save' && id !== 'delete') this.confirm.reset();
    switch (id) {
      case 'save':
        // over the level's saved replay: asked first
        if (getReplay(levelId) && !this.confirm.arm('save', button, label)) return;
        if (!setReplay(levelId, saved())) {
          showNotice(t('saveFailed'), '#ff8080');
          return;
        }
        showNotice(t('replaySavedNotice'));
        this.scene.restart({
          ...this.info,
          saving: 'saved',
          startIndex: this.playback.index,
          paused: !this.playback.playing,
        });
        return;
      case 'export':
        void copyToClipboard(replayText(saved()), button);
        return;
      case 'import':
        this.scene.start('ImportReplay', {
          levelId,
          back: { scene: 'Replay', data: { ...this.info, startIndex: 0, paused: true } },
        });
        return;
      case 'delete':
        if (!this.confirm.arm('delete', button, label)) return;
        deleteReplay(levelId);
        showNotice(t('replayDeletedNotice'));
        this.scene.start('Select', { levelId });
        return;
      case 'tiled': {
        const timeMs = this.info.authorRun?.timeMs ?? 0;
        const props = `goldMoves = ${this.info.moves.length}\ngoldTime = ${(timeMs / 1000).toFixed(2)}`;
        void copyToClipboard(props, button);
        return;
      }
      case 'solution':
        // the server's answer and its optimisation shown under the counters, over the board
        this.authorPanel ??= new AuthorSavePanel(this, {
          levelId,
          moves: this.info.moves,
          cx: this.scale.width / 2,
          top: px(this.speedBelow() ? 90 : 66),
          width: this.scale.width - px(32),
          depth: HUD_DEPTH + 2,
          watch: (moves, label) =>
            this.scene.start('Replay', {
              levelId,
              moves,
              label,
              back: { scene: 'Replay', data: { ...this.info, startIndex: 0, paused: true } },
            }),
        });
        void this.authorPanel.save(button, false);
        return;
    }
  }

  /** ◀ or ▶ held down: a move at once, then more after a delay until released or slid off. */
  private holdOn(b: Phaser.GameObjects.Text, step: 1 | -1): void {
    const dir: Dir = step > 0 ? 'right' : 'left';
    b.on('pointerdown', (p: Phaser.Input.Pointer) =>
      this.hold.press(p.id, dir, () => p.isDown && b.active && b.getBounds().contains(p.x, p.y)),
    );
    b.on('pointerout', (p: Phaser.Input.Pointer) => this.hold.release(p.id));
  }

  /** The progress bar at `y`, from the screen's left to `right` (device px), with a zone a finger can drag. */
  private buildBar(y: number, right: number): void {
    const x = px(20);
    const w = right - x;
    const g = this.add.graphics();
    this.bar = { x, y, w, g };
    const zone = this.add
      .zone(x - px(10), y - px(BAR_ROOM / 2), w + px(20), px(BAR_ROOM))
      .setOrigin(0)
      .setInteractive({ useHandCursor: true });
    zone.on('pointerdown', (p: Phaser.Input.Pointer) => {
      this.seeking = { wasPlaying: this.playback.playing, id: p.id };
      this.playback.playing = false;
      this.seekTo(p.x);
    });
    this.hud.push(g, zone);
    setDebug({ replayBar: { x: x / dpr(), y: y / dpr(), w: w / dpr() } });
  }

  /** The replay at the move under `x` (device px) on the bar. */
  private seekTo(x: number): void {
    const bar = this.bar;
    if (!bar || this.playback.total === 0) return;
    const frac = Math.max(0, Math.min(1, (x - bar.x) / bar.w));
    const target = Math.round(frac * this.playback.total);
    if (target === this.playback.index) return;
    this.playback.seek(target);
    // dragged: once a frame; pressed: at once
    if (this.seeking) this.seekPending = true;
    else this.syncSeek();
    this.refreshHud();
  }

  private drawBar(): void {
    const bar = this.bar;
    if (!bar) return;
    const p = this.playback;
    const frac = p.total ? p.index / p.total : 0;
    const th = px(6);
    const knob = px(this.seeking ? 9 : 7);
    bar.g
      .clear()
      .fillStyle(0x2c2838, 1)
      .fillRect(bar.x, bar.y - th / 2, bar.w, th)
      .fillStyle(hex(COLORS.accent), 1)
      .fillRect(bar.x, bar.y - th / 2, bar.w * frac, th)
      .fillStyle(hex(COLORS.text), 1)
      .fillCircle(bar.x + bar.w * frac, bar.y, knob);
  }

  private refreshHud(): void {
    const p = this.playback;
    const keys = this.session.state.keys;
    if (this.moveText && this.keysText && this.keyIcon) {
      this.moveText.setText(`${t('replayMove', { i: p.index, n: p.total })} · `);
      this.keysText.setText(
        `${t('keys')} ${keys}${p.atEnd && p.total > 0 ? ` · ${t('replayEnd')}` : ''}`,
      );
      placeIconBefore(this.keyIcon, this.keysText, this.moveText.x + this.moveText.width);
    }
    this.speedText?.setText(t('replaySpeed', { v: p.speed }));
    this.playLabel?.(p.playing ? t('pause') : t('playBtn'));
    // the screen stays on while the replay plays (a drag on the bar pauses it for a moment)
    const watching = p.playing || !!this.seeking?.wasPlaying;
    if (watching && !this.awake) this.awake = keepAwake();
    else if (!watching && this.awake) {
      this.awake.release();
      this.awake = null;
    }
    this.drawBar();
    setDebug({
      replayIndex: p.index,
      replaySpeed: p.speed,
      replayPlaying: p.playing,
      replayKeys: keys,
      replayStatus: this.session.state.status,
    });
  }

  private toStart(): void {
    this.playback.restart();
    this.sync(0);
  }
  private stepBy(d: 1 | -1): void {
    const moved = d > 0 ? this.playback.stepForward() : this.playback.stepBack();
    if (moved) this.sync(this.playback.animMs());
  }
  private togglePlay(): void {
    this.playback.toggle();
    // replay from the end: back to the start
    this.sync(0);
  }
  private faster(d: 1 | -1): void {
    if (d > 0) this.playback.faster();
    else this.playback.slower();
  }
  private leave(): void {
    const back = this.info.back;
    if (back) this.scene.start(back.scene, back.data);
    else this.scene.start('Select', { levelId: this.level.id });
  }

  private onKey(e: KeyboardEvent): void {
    switch (e.key) {
      case ' ':
        return this.togglePlay();
      case 'ArrowLeft':
        return this.stepBy(-1);
      case 'ArrowRight':
        return this.stepBy(1);
      case '+':
      case '=':
        return this.faster(1);
      case '-':
        return this.faster(-1);
      case 'Home':
        return this.toStart();
      case 'Escape':
        return this.leave();
    }
  }
}

/**
 * Gives a button the width of the widest of `labels` (its side padding, evenly) and returns how
 * to change its word without changing its width.
 */
function fixedWidth(b: Phaser.GameObjects.Text, labels: string[]): (label: string) => void {
  const p = { ...b.padding } as Required<Phaser.Types.GameObjects.Text.TextPadding>;
  const initial = b.text;
  const widest = Math.max(
    ...labels.map((l) => b.setPadding(p.left, p.top, p.right, p.bottom).setText(l).width),
  );
  const set = (label: string) => {
    b.setPadding(p.left, p.top, p.right, p.bottom).setText(label);
    const extra = widest - b.width;
    const left = Math.floor(extra / 2);
    b.setPadding(p.left + left, p.top, p.right + extra - left, p.bottom);
  };
  set(initial);
  return set;
}
