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
import { hasMaster, levelById } from '../levels';
import { syncMusic } from '../music';
import { AnimClock } from '../render/animTiming';
import { BoardView } from '../render/BoardView';
import { boardLayout, type BoardLayout } from '../render/layout';
import { hapticFor, vibrate } from '../haptics';
import { DragSteps } from '../input/drag';
import { HoldRepeat } from '../input/holdRepeat';
import { dpadLayout, dpadLayoutSide, isLandscape, isTouchDevice } from '../touch';
import { COLORS, dpr, makeButton, px, textStyle } from '../ui';

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
  /** hold to repeat on the on-screen d-pad */
  private hold!: HoldRepeat;
  /** continuous drags in progress, by pointer id */
  private readonly drags = new Map<number, DragSteps>();
  /** a drag has moved the player since the last press: its release is not a button click */
  private dragMoved = false;
  private readonly anim = new AnimClock();
  private startTime: number | null = null;
  private startBeforeRestart: number | null = null;
  private finished = false;
  private movesText?: Phaser.GameObjects.Text;
  private timeText?: Phaser.GameObjects.Text;
  private keysText?: Phaser.GameObjects.Text;
  private overlay?: Phaser.GameObjects.Text;
  private rulesNote?: Phaser.GameObjects.Text;

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
    this.rulesNote = undefined;
    this.hud = [];
  }

  create(): void {
    this.board = new BoardView(this, this.session.state, this.computeLayout());
    this.hold = new HoldRepeat(
      (dir) => this.handle({ type: 'move', dir }),
      () => app.data.settings.repeatRate,
    );
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
    // Continuous drag anywhere but on a button: one move per `dragStep` CSS pixels travelled.
    // Phaser handles each DOM pointer event as it comes (no queue replayed, unlike its keyboard).
    this.drags.clear();
    this.input.on(
      'pointerdown',
      (p: Phaser.Input.Pointer, over: Phaser.GameObjects.GameObject[]) => {
        this.dragMoved = false;
        if (over.length) this.drags.delete(p.id);
        else
          this.drags.set(p.id, new DragSteps(p.x / dpr(), p.y / dpr(), app.data.settings.dragStep));
      },
    );
    this.input.on('pointermove', (p: Phaser.Input.Pointer) => {
      const drag = this.drags.get(p.id);
      if (!drag) return;
      if (!p.isDown) {
        this.drags.delete(p.id);
        return;
      }
      for (const dir of drag.move(p.x / dpr(), p.y / dpr())) {
        this.dragMoved = true;
        this.handle({ type: 'move', dir });
      }
    });
    // touchend and touchcancel both come as a pointer up (outside: released off the canvas)
    const release = (p: Phaser.Input.Pointer) => {
      this.drags.delete(p.id);
      this.hold.release(p.id);
    };
    this.input.on('pointerup', release);
    this.input.on('pointerupoutside', release);
    const onResize = () => {
      this.board.setLayout(this.computeLayout());
      this.buildHud();
      if (this.rulesNote) {
        this.rulesNote.destroy();
        this.showRules();
      }
    };
    if (this.mode === 'master') this.showRules();
    this.scale.on('resize', onResize);
    this.events.once('shutdown', () => {
      window.removeEventListener('keydown', down);
      window.removeEventListener('keyup', up);
      window.removeEventListener('blur', blur);
      this.scale.off('resize', onResize);
      this.controls.reset();
      this.hold.reset();
      this.drags.clear();
    });
    syncMusic(this, app.data.settings.sound, 'music-game');
    setDebug({
      scene: 'Game',
      levelId: this.level.id,
      mode: this.mode,
      canUndo: this.session.canUndo,
    });
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

  /** Narrow screen: the MASTER label moves to a 3rd line, so room must be reserved for it. */
  private topReserve(): number {
    if (!this.narrow()) return px(40);
    return this.mode === 'master' ? px(84) : px(64);
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
    if (this.mode === 'master') {
      this.hud.push(
        this.add
          .text(
            this.narrow() ? px(12) : px(330),
            this.narrow() ? sy + px(20) : sy,
            t('masterMode'),
            textStyle(14, '#9be7ff'),
          )
          .setOrigin(0, 0.5),
      );
    }
    const buttons: [string, Action][] = [
      [t('menu'), { type: 'menu' }],
      [t('restart'), { type: 'restart' }],
    ];
    // master mode: no undo, so no button for it
    if (this.session.canUndo) buttons.push([t('undo'), { type: 'undo' }]);
    let x = w - px(12);
    for (const [label, action] of buttons) {
      // a drag that ends on a button is not a click on it
      const click = () => {
        if (!this.dragMoved) this.handle(action);
      };
      const b = makeButton(this, x, y, label, click, 13).setOrigin(1, 0.5);
      x -= b.width + px(8);
      this.hud.push(b);
    }
    this.hold.reset();
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
        // hold to repeat; stops on release, when the finger slides off or the touch is cancelled
        const onBox = (p: Phaser.Input.Pointer) =>
          p.isDown && box.active && p.x >= r.x && p.x < r.x + r.w && p.y >= r.y && p.y < r.y + r.h;
        box.on('pointerdown', (p: Phaser.Input.Pointer) =>
          this.hold.press(p.id, dir, () => onBox(p)),
        );
        box.on('pointerout', (p: Phaser.Input.Pointer) => this.hold.release(p.id));
        box.on('pointerup', (p: Phaser.Input.Pointer) => this.hold.release(p.id));
        const label = this.add
          .text(r.x + r.w / 2, r.y + r.h / 2, glyphs[dir], textStyle(20))
          .setOrigin(0.5);
        this.hud.push(box, label);
      }
      // for the e2e tests: button centres in CSS pixels, once drawn (Phaser hit-tests a new
      // interactive object only from its next pre-update on)
      const dpad = Object.fromEntries(
        Object.entries(pad).map(([d, r]) => [
          d,
          [(r.x + r.w / 2) / dpr(), (r.y + r.h / 2) / dpr()],
        ]),
      );
      const hud = this.hud;
      setDebug({ dpad: null });
      this.events.once(Phaser.Scenes.Events.PRE_UPDATE, () =>
        this.events.once(Phaser.Scenes.Events.RENDER, () => {
          if (this.hud === hud) setDebug({ dpad });
        }),
      );
    } else {
      const help = this.add
        .text(w / 2, this.scale.height - px(12), '', textStyle(11, COLORS.dim))
        .setOrigin(0.5);
      this.hud.push(help);
      void directionLabels().then((dirs) => {
        if (help.active) help.setText(t(this.session.canUndo ? 'help' : 'helpMaster', { dirs }));
      });
    }
    this.updateHud();
  }

  private updateHud(): void {
    const s = this.session.state;
    this.movesText?.setText(`${t('moves')} ${s.moves}`);
    setDebug({ moves: s.moves, status: s.status, player: s.player });
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
    vibrate(hapticFor(events), app.data.settings.vibration);
    if (events.length === 0) return;
    const after = this.session.state;
    const now = performance.now();
    const moved = after.moves > before.moves;
    if (moved && this.startTime === null) this.startTime = now;
    this.board.apply(after, events, moved ? this.anim.next(now) : 0);
    this.rulesNote?.destroy();
    this.rulesNote = undefined;
    this.updateHud();
    if (after.status === 'won') this.finish(now);
    else if (after.status === 'drowned') this.showDrowned();
  }

  /** Master mode: its rules over the board until the first move. */
  private showRules(): void {
    this.rulesNote = this.add
      .text(this.scale.width / 2, this.scale.height / 2, t('masterRules'), {
        ...textStyle(16, '#9be7ff'),
        align: 'center',
        backgroundColor: '#000000cc',
        padding: { x: px(14), y: px(10) },
        wordWrap: { width: this.scale.width - px(64) },
      })
      .setOrigin(0.5)
      .setDepth(10);
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
    this.hold.reset();
    const result: RunResult = {
      moves: this.session.state.moves,
      timeMs: Math.round(now - (this.startTime ?? now)),
      mode: this.mode,
    };
    const medals = award(this.level, result, hasMaster(this.level.id));
    const previous = app.data.levels[this.level.id];
    app.data.levels[this.level.id] = recordRun(previous, result, medals);
    app.persist();
    setDebug({ lastResult: result, lastAward: medals });
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
