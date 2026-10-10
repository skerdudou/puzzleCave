import Phaser from 'phaser';
import {
  Session,
  award,
  recordRun,
  type Dir,
  type LevelData,
  type Mode,
  type RunResult,
} from '@puzzlecave/core';
import { app } from '../app';
import { setDebug } from '../debug';
import { formatTime } from '../format';
import { t } from '../i18n';
import { InputController, type Action } from '../input/InputController';
import { directionLabels } from '../input/keyboardLabels';
import { levelById } from '../levels';
import { syncMusic } from '../music';
import { AnimClock } from '../render/animTiming';
import { BoardView } from '../render/BoardView';
import { boardLayout, type BoardLayout } from '../render/layout';
import { swipeDir } from '../input/swipe';
import { dpadLayout, dpadLayoutSide, isLandscape, isTouchDevice } from '../touch';
import { COLORS, makeButton, px, textStyle } from '../ui';

export interface GameSceneData {
  levelId: string;
  mode: Mode;
}

export class GameScene extends Phaser.Scene {
  protected level!: LevelData;
  protected mode: Mode = 'normal';
  protected session!: Session;
  protected board!: BoardView;
  protected hud: Phaser.GameObjects.GameObject[] = [];
  private controls!: InputController;
  private readonly anim = new AnimClock();
  private startTime: number | null = null;
  private startBeforeRestart: number | null = null;
  private finished = false;
  private movesText?: Phaser.GameObjects.Text;
  private timeText?: Phaser.GameObjects.Text;
  private keysText?: Phaser.GameObjects.Text;
  private overlay?: Phaser.GameObjects.Text;

  constructor() {
    super('Game');
  }

  init(data: GameSceneData): void {
    this.level = levelById(data.levelId);
    this.mode = data.mode;
    this.session = new Session(this.level, this.mode);
    this.startTime = null;
    this.startBeforeRestart = null;
    this.finished = false;
    this.anim.reset();
    this.overlay = undefined;
    this.hud = [];
  }

  create(): void {
    this.board = new BoardView(this, this.session.state, this.computeLayout());
    this.buildHud();
    this.controls = new InputController((a) => this.handle(a), app.data.settings.repeatRate);
    const down = (e: KeyboardEvent) => {
      if (this.controls.keydown(e)) e.preventDefault();
    };
    const up = (e: KeyboardEvent) => this.controls.keyup(e);
    const blur = () => this.controls.reset();
    window.addEventListener('keydown', down);
    window.addEventListener('keyup', up);
    window.addEventListener('blur', blur);
    const downAt = new Map<number, { x: number; y: number }>();
    this.input.on(
      'pointerdown',
      (p: Phaser.Input.Pointer, over: Phaser.GameObjects.GameObject[]) => {
        if (over.length) downAt.delete(p.id);
        else downAt.set(p.id, { x: p.x, y: p.y });
      },
    );
    this.input.on('pointerup', (p: Phaser.Input.Pointer) => {
      const start = downAt.get(p.id);
      if (!start) return;
      downAt.delete(p.id);
      const r = window.devicePixelRatio || 1;
      const dir = swipeDir(
        (p.x - start.x) / r,
        (p.y - start.y) / r,
        app.data.settings.swipeThreshold,
      );
      if (dir) this.handle({ type: 'move', dir });
    });
    const onResize = () => {
      this.board.setLayout(this.computeLayout());
      this.buildHud();
    };
    this.scale.on('resize', onResize);
    this.events.once('shutdown', () => {
      window.removeEventListener('keydown', down);
      window.removeEventListener('keyup', up);
      window.removeEventListener('blur', blur);
      this.scale.off('resize', onResize);
      this.controls.reset();
    });
    syncMusic(this, app.data.settings.sound, 'music-game');
    setDebug({ scene: 'Game', levelId: this.level.id, mode: this.mode });
  }

  override update(): void {
    if (this.startTime !== null && this.session.state.status === 'playing') {
      this.timeText?.setText(`${t('time')} ${formatTime(performance.now() - this.startTime)}`);
    }
  }

  /** Area reserved at the bottom of the screen (keyboard help; larger on touch, Task 15). */
  protected bottomReserve(): number {
    return this.sidePad() || !isTouchDevice() ? px(24) : px(48) * 3 + px(24) + px(24);
  }

  /** Narrow screen: the counters move to a 2nd line under the buttons. */
  private narrow(): boolean {
    return this.scale.width < px(640);
  }

  /** Touch in landscape: the d-pad is on the right, the board takes the rest. */
  private sidePad(): boolean {
    return isTouchDevice() && isLandscape(this.scale.width, this.scale.height);
  }

  private sideReserve(): number {
    return this.sidePad() ? px(48) * 3 + px(16) * 2 : 0;
  }

  /** Narrow screen: the PLATINE label moves to a 3rd line, so room must be reserved for it. */
  private topReserve(): number {
    if (!this.narrow()) return px(40);
    return this.mode === 'platinum' ? px(84) : px(64);
  }

  protected computeLayout(): BoardLayout {
    return boardLayout(
      this.scale.width - this.sideReserve(),
      this.scale.height,
      this.level.width,
      this.level.height,
      16,
      this.topReserve(),
      this.bottomReserve(),
    );
  }

  protected buildHud(): void {
    for (const o of this.hud) o.destroy();
    this.hud = [];
    const w = this.scale.width;
    const y = px(20);
    const sy = this.narrow() ? px(48) : y;
    this.movesText = this.add.text(px(12), sy, '', textStyle(14)).setOrigin(0, 0.5);
    this.timeText = this.add.text(px(120), sy, '', textStyle(14)).setOrigin(0, 0.5);
    this.keysText = this.add.text(px(250), sy, '', textStyle(14)).setOrigin(0, 0.5);
    this.hud.push(this.movesText, this.timeText, this.keysText);
    if (this.mode === 'platinum') {
      this.hud.push(
        this.add
          .text(
            this.narrow() ? px(12) : px(330),
            this.narrow() ? sy + px(20) : sy,
            t('platinumMode'),
            textStyle(14, '#9be7ff'),
          )
          .setOrigin(0, 0.5),
      );
    }
    const buttons: [string, Action][] = [
      [t('menu'), { type: 'menu' }],
      [t('restart'), { type: 'restart' }],
      [t('undo'), { type: 'undo' }],
    ];
    let x = w - px(12);
    for (const [label, action] of buttons) {
      const b = makeButton(this, x, y, label, () => this.handle(action), 13).setOrigin(1, 0.5);
      x -= b.width + px(8);
      this.hud.push(b);
    }
    if (isTouchDevice()) {
      const pad = this.sidePad()
        ? dpadLayoutSide(w, this.scale.height, px(48), px(16))
        : dpadLayout(w, this.scale.height, px(48));
      const glyphs: Record<Dir, string> = { up: '▲', down: '▼', left: '◀', right: '▶' };
      for (const dir of ['up', 'down', 'left', 'right'] as const) {
        const r = pad[dir];
        const box = this.add
          .rectangle(r.x, r.y, r.w, r.h, 0x2c2838, 0.8)
          .setOrigin(0)
          .setInteractive();
        box.on('pointerdown', () => this.handle({ type: 'move', dir }));
        const label = this.add
          .text(r.x + r.w / 2, r.y + r.h / 2, glyphs[dir], textStyle(20))
          .setOrigin(0.5);
        this.hud.push(box, label);
      }
    } else {
      const help = this.add
        .text(w / 2, this.scale.height - px(12), '', textStyle(11, COLORS.dim))
        .setOrigin(0.5);
      this.hud.push(help);
      void directionLabels().then((dirs) => {
        if (help.active) help.setText(t('help', { dirs }));
      });
    }
    this.updateHud();
  }

  private updateHud(): void {
    const s = this.session.state;
    this.movesText?.setText(`${t('moves')} ${s.moves}`);
    setDebug({ moves: s.moves });
    this.keysText?.setText(`${t('keys')} ${s.keys}`);
    if (this.startTime === null) this.timeText?.setText(`${t('time')} ${formatTime(0)}`);
  }

  protected handle(a: Action): void {
    if (this.finished) return;
    switch (a.type) {
      case 'move':
        this.move(a.dir);
        return;
      case 'undo': {
        const restoring = this.session.canUndoRestart;
        if (this.session.undo()) {
          if (restoring) this.startTime = this.startBeforeRestart;
          this.board.rebuild(this.session.state);
          this.anim.reset();
          this.updateHud();
        }
        return;
      }
      case 'restart':
        this.session.restart();
        // The previous game stays recoverable via “Undo”: its timer start is kept too.
        if (this.session.canUndoRestart && this.startTime !== null)
          this.startBeforeRestart = this.startTime;
        this.startTime = null;
        this.anim.reset();
        this.board.rebuild(this.session.state);
        this.overlay?.destroy();
        this.overlay = undefined;
        this.updateHud();
        return;
      case 'menu':
        this.finished = true;
        this.scene.start('Select', { levelId: this.level.id });
        return;
    }
  }

  private move(dir: Dir): void {
    const before = this.session.state;
    if (before.status !== 'playing') return;
    const events = this.session.move(dir);
    if (events.length === 0) return;
    const after = this.session.state;
    const now = performance.now();
    const moved = after.moves > before.moves;
    if (moved && this.startTime === null) this.startTime = now;
    this.board.apply(after, events, moved ? this.anim.next(now) : 0);
    this.updateHud();
    if (after.status === 'won') this.finish(now);
    else if (after.status === 'drowned') this.showDrowned();
  }

  private showDrowned(): void {
    this.overlay = this.add
      .text(this.scale.width / 2, this.scale.height / 2, `${t('drowned')}\n${t('drownedHint')}`, {
        ...textStyle(22, '#9be7ff'),
        align: 'center',
        backgroundColor: '#000000aa',
        padding: { x: px(16), y: px(12) },
      })
      .setOrigin(0.5)
      .setDepth(10);
  }

  private finish(now: number): void {
    this.finished = true;
    this.controls.reset();
    const result: RunResult = {
      moves: this.session.state.moves,
      timeMs: Math.round(now - (this.startTime ?? now)),
      mode: this.mode,
    };
    const medals = award(this.level, result);
    const previous = app.data.levels[this.level.id];
    app.data.levels[this.level.id] = recordRun(previous, result, medals);
    app.persist();
    setDebug({ lastResult: result });
    const moveLog = this.session.moveLog;
    this.time.delayedCall(250, () =>
      this.scene.start('Result', {
        levelId: this.level.id,
        mode: this.mode,
        result,
        award: medals,
        previous,
        moveLog,
      }),
    );
  }
}
