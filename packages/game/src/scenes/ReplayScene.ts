import Phaser from 'phaser';
import { Session, type Dir, type LevelData } from '@puzzlecave/core';
import { setDebug } from '../debug';
import { t } from '../i18n';
import { levelById } from '../levels';
import { Playback } from '../author/playback';
import { onSceneKeyDown } from '../input/sceneKeys';
import { chapterTint } from '../render/ambience';
import { AmbienceView, HUD_DEPTH } from '../render/AmbienceView';
import { BoardView } from '../render/BoardView';
import { boardLayout, fractionalZoom } from '../render/layout';
import { isTouchDevice } from '../touch';
import { COLORS, makeButton, placeIconBefore, px, textIcon, textStyle } from '../ui';

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
  private playBtn?: Phaser.GameObjects.Text;

  constructor() {
    super('Replay');
  }

  init(data: ReplaySceneData): void {
    this.info = data;
    this.level = levelById(data.levelId);
    this.playback = new Playback(data.moves.length);
    this.hud = [];
    this.shown = 0;
  }

  create(): void {
    this.session = new Session(this.level);
    // the cave first: the board and the HUD go over it (a resize restarts the scene)
    const layout = this.layoutNow();
    this.ambience = new AmbienceView(this, {
      levelId: this.level.id,
      hudHeight: this.topReserve(),
    });
    this.ambience.layout(layout);
    this.board = new BoardView(this, this.session.state, layout);
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
    const onResize = () =>
      this.scene.restart({
        ...this.info,
        startIndex: this.playback.index,
        paused: !this.playback.playing,
      });
    this.scale.on('resize', onResize);
    this.events.once('shutdown', () => {
      this.scale.off('resize', onResize);
      this.ambience.destroy();
    });
    setDebug({ scene: 'Replay', levelId: this.level.id, replayTotal: this.info.moves.length });
  }

  override update(time: number, delta: number): void {
    this.ambience.update(time, this.board.heroCentre());
    const n = this.playback.tick(delta);
    if (n > 0) this.sync(this.playback.animMs());
    this.refreshHud();
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

  /** The title and the move counter above the board. */
  private topReserve(): number {
    return px(64);
  }

  private narrow(): boolean {
    return this.scale.width < px(560);
  }

  private bottomReserve(): number {
    return px(this.narrow() ? 124 : 72);
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
    while (this.shown < target) {
      const events = this.session.move(this.info.moves[this.shown]!);
      this.shown++;
      // only the last move of a batch is animated
      this.board.apply(this.session.state, events, this.shown === target ? animMs : 0);
    }
  }

  private buildHud(): void {
    for (const o of this.hud) o.destroy();
    this.playBtn = undefined;
    this.hud = [];
    const w = this.scale.width;
    const h = this.scale.height;
    this.hud.push(
      this.add
        .text(
          px(12),
          px(14),
          `${this.level.name} — ${this.info.label}`,
          textStyle(14, COLORS.accent),
        )
        .setOrigin(0, 0),
    );
    // "Move 3/12 · ", then the key's art and "Keys 1" (placed again as the move count grows)
    this.moveText = this.add.text(px(12), px(38), '', textStyle(14)).setOrigin(0, 0);
    this.keysText = this.add.text(px(12), px(38), '', textStyle(14)).setOrigin(0, 0);
    this.keyIcon = textIcon(this, 'KEY');
    this.speedText = this.add.text(w - px(12), px(38), '', textStyle(14)).setOrigin(1, 0);
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

    const rows: [string, () => void][][] = [
      [
        [t('toStart'), () => this.toStart()],
        ['◀', () => this.stepBy(-1)],
        [t('pause'), () => this.togglePlay()],
        ['▶', () => this.stepBy(1)],
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
    for (const row of rows) {
      const buttons = row.map(([label, fn]) => makeButton(this, 0, y, label, fn, 13));
      const gap = px(8);
      const total = buttons.reduce((s, b) => s + b.width, 0) + gap * (buttons.length - 1);
      let x = (w - total) / 2;
      for (const b of buttons) {
        b.setOrigin(0, 0.5).setX(x);
        x += b.width + gap;
        this.hud.push(b);
      }
      const pi = playIndex - flat;
      flat += row.length;
      if (pi >= 0 && pi < buttons.length) this.playBtn = buttons[pi];
      y += px(48);
    }
    // above the cave's darkness, vignette and HUD band (a button's frame follows it, 1 below)
    for (const o of this.hud) (o as Phaser.GameObjects.Text).setDepth(HUD_DEPTH);
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
    this.playBtn?.setText(p.playing ? t('pause') : t('playBtn'));
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
