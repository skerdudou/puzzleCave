import Phaser from 'phaser';
import { Session, type Dir, type LevelData } from '@puzzlecave/core';
import { app } from '../app';
import { setDebug } from '../debug';
import { ellipsize } from '../format';
import { t } from '../i18n';
import { levelById } from '../levels';
import { Playback } from '../author/playback';
import { HoldRepeat } from '../input/holdRepeat';
import { onSceneKeyDown } from '../input/sceneKeys';
import { chapterTint } from '../render/ambience';
import { AmbienceView, HUD_DEPTH } from '../render/AmbienceView';
import { BoardView } from '../render/BoardView';
import { boardLayout, fractionalZoom } from '../render/layout';
import { isTouchDevice } from '../touch';
import { COLORS, dpr, hex, makeButton, placeIconBefore, px, textIcon, textStyle } from '../ui';
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
}

/** The progress bar's height and the room it takes above the buttons, base px. */
const BAR_ROOM = 36;

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
  }

  create(): void {
    this.session = new Session(this.level);
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
    if (this.info.paused) this.playback.playing = false;
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

  private bottomReserve(): number {
    return px((this.narrow() ? 124 : 72) + BAR_ROOM);
  }

  /** Brings the board to the playback index (forward: moves replayed; backward: rebuilt). */
  private sync(animMs: number): void {
    const target = this.playback.index;
    if (this.shown > target) {
      this.session = new Session(this.level);
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
    const full = `${this.level.name} — ${this.info.label}`;
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
    let y = h - help.height - px(26) - (rows.length - 1) * px(48);
    const buttonsTop = y - px(22);
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
      y += px(48);
    }
    this.buildBar(buttonsTop - px(BAR_ROOM / 2));
    // above the cave's darkness, vignette and HUD band (a button's frame follows it, 1 below)
    for (const o of this.hud) (o as Phaser.GameObjects.Text).setDepth(HUD_DEPTH);
    setDebug({ replayStepButtons: stepButtons });
  }

  /** ◀ or ▶ held down: a move at once, then more after a delay until released or slid off. */
  private holdOn(b: Phaser.GameObjects.Text, step: 1 | -1): void {
    const dir: Dir = step > 0 ? 'right' : 'left';
    b.on('pointerdown', (p: Phaser.Input.Pointer) =>
      this.hold.press(p.id, dir, () => p.isDown && b.active && b.getBounds().contains(p.x, p.y)),
    );
    b.on('pointerout', (p: Phaser.Input.Pointer) => this.hold.release(p.id));
  }

  /** The progress bar across the screen at `y` (device px), with a zone a finger can drag. */
  private buildBar(y: number): void {
    const x = px(20);
    const w = this.scale.width - 2 * x;
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
