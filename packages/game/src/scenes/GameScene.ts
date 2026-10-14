import Phaser from 'phaser';
import {
  Session,
  award,
  masterTimeLimitMs,
  recordRun,
  resolveThresholds,
  type Dir,
  type LevelData,
  type Mode,
  type RunResult,
} from '@puzzlecave/core';
import { app } from '../app';
import { setDebug } from '../debug';
import { ellipsize, formatTime } from '../format';
import { t } from '../i18n';
import { InputController, type Action } from '../input/InputController';
import { directionLabels } from '../input/keyboardLabels';
import { hasMaster, levelById } from '../levels';
import { syncMusic } from '../music';
import { AnimClock } from '../render/animTiming';
import { BoardView } from '../render/BoardView';
import { boardLayout, type BoardLayout } from '../render/layout';
import { HapticFeed, vibrate } from '../haptics';
import { DragSteps } from '../input/drag';
import { HoldRepeat } from '../input/holdRepeat';
import {
  TAP_SLOP,
  ZONE_BUTTON_MARGIN,
  ZoneGesture,
  nearAny,
  zoneDir,
  type Box,
  type TapZoneMode,
} from '../input/tapZones';
import { RunClock, countdown } from '../runClock';
import { dpadLayout, dpadLayoutSide, isLandscape, isTouchDevice } from '../touch';
import { COLORS, dpr, makeButton, px, textStyle } from '../ui';

/** D-pad buttons on a touch screen, CSS px per side (above the 44 px minimum: the main control). */
const DPAD = 56;
/** Master mode colour, and the countdown's warning colour. */
const MASTER_COLOR = '#9be7ff';
const WARN_COLOR = '#ff6b5e';

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
  /** tap zones (option): the gesture of each finger that went down on one */
  private readonly zones = new Map<number, ZoneGesture>();
  /** the last press started on a tap zone: its release is not a button click either */
  private zonePress = false;
  private zoneFlash?: Phaser.GameObjects.Graphics;
  private zoneMoves = 0;
  private attempts = 0;
  private readonly anim = new AnimClock();
  private clock = new RunClock();
  /** master mode: the time limit (the level's bronze time), ms; none without goldTime */
  private timeLimitMs: number | undefined;
  /** master mode: the time limit is passed, the run has failed (like drowning) */
  private timedOut = false;
  private readonly haptics = new HapticFeed();
  /** CSS px boxes around which a press is never a tap zone (HUD buttons, d-pad) */
  private noZone: Box[] = [];
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
    this.clock = new RunClock();
    this.timeLimitMs =
      this.mode === 'master'
        ? masterTimeLimitMs(resolveThresholds(this.level.thresholds))
        : undefined;
    this.timedOut = false;
    this.haptics.reset();
    setDebug({ timeLeftMs: null, timeWarn: false });
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
      // a new press (not the key's own repeat): a bump vibrates again
      if (!e.repeat) this.haptics.reset();
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
    this.zoneMoves = 0;
    this.attempts = 0;
    this.zoneFlash = undefined;
    setDebug({ zoneMoves: 0, zoneFlash: null, attempts: 0 });
    this.input.on(
      'pointerdown',
      (p: Phaser.Input.Pointer, over: Phaser.GameObjects.GameObject[]) => {
        this.dragMoved = false;
        this.zonePress = false;
        this.haptics.reset();
        if (over.length) {
          this.drags.delete(p.id);
          return;
        }
        const [x, y] = [p.x / dpr(), p.y / dpr()];
        this.drags.set(p.id, new DragSteps(x, y, app.data.settings.dragStep));
        this.startZone(p.id, x, y);
      },
    );
    this.input.on('pointermove', (p: Phaser.Input.Pointer) => {
      const drag = this.drags.get(p.id);
      if (!drag) return;
      if (!p.isDown) {
        this.drags.delete(p.id);
        this.zones.get(p.id)?.cancel();
        this.zones.delete(p.id);
        return;
      }
      // on a tap zone, the gesture is a drag only once the finger has travelled far enough
      const zone = this.zones.get(p.id);
      if (zone && !zone.move(p.x / dpr(), p.y / dpr())) return;
      for (const dir of drag.move(p.x / dpr(), p.y / dpr())) {
        this.dragMoved = true;
        this.handle({ type: 'move', dir });
      }
    });
    // touchend and touchcancel both come as a pointer up (outside: released off the canvas)
    const release = (p: Phaser.Input.Pointer) => {
      this.drags.delete(p.id);
      this.hold.release(p.id);
      const zone = this.zones.get(p.id);
      this.zones.delete(p.id);
      // a lifted finger that neither dragged nor held: a tap (a cancelled touch is none)
      if (p.wasCanceled) zone?.cancel();
      else zone?.release();
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
    // the clock does not count while the game is hidden (another app, screen locked…)
    const hidden = () => this.clock.pause(performance.now());
    const visible = () => this.clock.resume(performance.now());
    this.game.events.on(Phaser.Core.Events.HIDDEN, hidden);
    this.game.events.on(Phaser.Core.Events.VISIBLE, visible);
    this.events.once('shutdown', () => {
      window.removeEventListener('keydown', down);
      window.removeEventListener('keyup', up);
      window.removeEventListener('blur', blur);
      this.game.events.off(Phaser.Core.Events.HIDDEN, hidden);
      this.game.events.off(Phaser.Core.Events.VISIBLE, visible);
      this.scale.off('resize', onResize);
      this.controls.reset();
      this.hold.reset();
      this.drags.clear();
      this.cancelZones();
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
    if (this.session.state.status !== 'playing' || this.finished || this.timedOut) return;
    if (!this.clock.started) return;
    const now = performance.now();
    if (this.checkTimeLimit(now)) return;
    this.showTime(now);
  }

  /** The clock (elapsed time, or master mode's countdown) in the HUD. */
  private showTime(now: number): void {
    const elapsed = this.clock.elapsed(now);
    if (this.timeLimitMs === undefined) {
      this.timeText?.setText(`${t('time')} ${formatTime(elapsed)}`);
      return;
    }
    const c = countdown(this.timeLimitMs, elapsed);
    this.timeText
      ?.setText(`${t('timeLeft')} ${formatTime(c.leftMs)}`)
      .setColor(c.warn ? WARN_COLOR : COLORS.text);
    setDebug({ timeLeftMs: c.leftMs, timeWarn: c.warn });
  }

  /** Master mode: past the time limit, the run fails (true). */
  private checkTimeLimit(now: number): boolean {
    if (this.timeLimitMs === undefined || this.timedOut || this.finished) return false;
    if (this.session.state.status !== 'playing') return false;
    if (!countdown(this.timeLimitMs, this.clock.elapsed(now)).over) return false;
    this.timedOut = true;
    this.hold.reset();
    this.cancelZones();
    this.drags.clear();
    this.timeText?.setText(`${t('timeLeft')} ${formatTime(0)}`).setColor(WARN_COLOR);
    vibrate('fail', app.data.settings.vibration);
    this.showFailed(t('timeUp'));
    setDebug({ status: 'timeout', timeLeftMs: 0, timeWarn: true });
    return true;
  }

  /** Area reserved at the bottom of the screen (keyboard help; the d-pad on touch). */
  protected bottomReserve(): number {
    return this.sidePad() || !isTouchDevice() ? px(24) : px(DPAD) * 3 + px(24) + px(24);
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
    return this.sidePad() ? px(DPAD) * 3 + px(16) * 2 : 0;
  }

  /**
   * The HUD at the top: one row on a wide screen; on a narrow one the counters move to a 2nd
   * line under the buttons and the MASTER label to a 3rd.
   */
  private topReserve(): number {
    if (!this.narrow()) return px(52);
    return this.mode === 'master' ? px(100) : px(80);
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
    const narrow = this.narrow();
    const y = px(26);
    const sy = narrow ? px(66) : y;
    const css = (b: Phaser.Geom.Rectangle): Box => ({
      x: b.x / dpr(),
      y: b.y / dpr(),
      w: b.width / dpr(),
      h: b.height / dpr(),
    });
    // the buttons first, from the right: the counters and the level name take what is left
    const buttons: [string, Action][] = [
      [t('menu'), { type: 'menu' }],
      [t('restart'), { type: 'restart' }],
    ];
    // master mode: no undo, so no button for it
    if (this.session.canUndo) buttons.push([t('undo'), { type: 'undo' }]);
    let x = w - px(8);
    const hudButtons: Record<string, [number, number]> = {};
    const buttonBoxes: Box[] = [];
    for (const [label, action] of buttons) {
      // a drag (or a press on a tap zone) that ends on a button is not a click on it
      const click = () => {
        if (!this.dragMoved && !this.zonePress) this.handle(action);
      };
      const b = makeButton(this, x, y, label, click, 13).setOrigin(1, 0.5);
      hudButtons[action.type] = [(x - b.width / 2) / dpr(), y / dpr()];
      buttonBoxes.push(css(b.getBounds()));
      x -= b.width + px(6);
      this.hud.push(b);
    }
    const buttonsLeft = x + px(6);
    // counters, one after the other, each wide enough for its longest value (nothing jumps);
    // a smaller font where the words are too long for the screen (some languages)
    const timeLabel = this.timeLimitMs === undefined ? t('time') : t('timeLeft');
    const counterTexts: [string, string][] = [
      [`${t('moves')} 999`, COLORS.text],
      [`${timeLabel} 0:00.00`, COLORS.text],
      [`${t('keys')} -9`, COLORS.text],
    ];
    if (this.mode === 'master' && !narrow) counterTexts.push([t('masterMode'), MASTER_COLOR]);
    const counterRoom = (narrow ? w : buttonsLeft) - px(12);
    let counters: Phaser.GameObjects.Text[] = [];
    for (let size = 14; size >= 9; size--) {
      for (const c of counters) c.destroy();
      const gap = px(size);
      let cx = px(12);
      counters = counterTexts.map(([text, color]) => {
        const txt = this.add.text(cx, sy, text, textStyle(size, color)).setOrigin(0, 0.5);
        cx += txt.width + gap;
        return txt;
      });
      if (cx - gap <= counterRoom) break;
    }
    this.hud.push(...counters);
    [this.movesText, this.timeText, this.keysText] = counters as [
      Phaser.GameObjects.Text,
      Phaser.GameObjects.Text,
      Phaser.GameObjects.Text,
    ];
    const last = counters.at(-1)!;
    const end = last.x + last.width;
    if (this.mode === 'master' && narrow) {
      // the MASTER label on a 3rd line
      this.hud.push(
        this.add
          .text(px(12), sy + px(22), t('masterMode'), textStyle(14, MASTER_COLOR))
          .setOrigin(0, 0.5),
      );
    }
    // the level's name: on the buttons' row, in the room they leave (cut with "…" if needed)
    const nameX = narrow ? px(12) : end + px(24);
    const nameText = this.add.text(nameX, y, '', textStyle(13, COLORS.accent)).setOrigin(0, 0.5);
    const room = buttonsLeft - px(10) - nameX;
    nameText.setText(ellipsize(this.level.name, (s) => nameText.setText(s).width <= room));
    this.hud.push(nameText);
    setDebug({
      hudName: nameText.text,
      hudLayout: {
        name: css(nameText.getBounds()),
        buttons: buttonBoxes,
        counters: counters.map((c) => css(c.getBounds())),
      },
    });
    this.hold.reset();
    this.cancelZones();
    this.noZone = [...buttonBoxes];
    if (isTouchDevice()) {
      const pad = this.sidePad()
        ? dpadLayoutSide(w, this.scale.height, px(DPAD), px(16))
        : dpadLayout(w, this.scale.height, px(DPAD));
      for (const r of Object.values(pad))
        this.noZone.push({ x: r.x / dpr(), y: r.y / dpr(), w: r.w / dpr(), h: r.h / dpr() });
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
      setDebug({ dpad: null, hudButtons: null });
      this.events.once(Phaser.Scenes.Events.PRE_UPDATE, () =>
        this.events.once(Phaser.Scenes.Events.RENDER, () => {
          if (this.hud === hud) setDebug({ dpad, hudButtons });
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
    const mode = app.data.settings.tapZones;
    setDebug({
      tapZones: mode,
      zoneCentres: { screen: this.zoneCentre('screen'), player: this.zoneCentre('player') },
    });
    this.keysText?.setText(`${t('keys')} ${s.keys}`);
    // the clock stands still: before the first move, or once the run has failed
    if (this.timedOut)
      this.timeText?.setText(`${t('timeLeft')} ${formatTime(0)}`).setColor(WARN_COLOR);
    else this.showTime(performance.now());
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
          if (restoring) this.clock.undoRestart();
          this.board.rebuild(this.session.state);
          this.anim.reset();
          this.updateHud();
        }
        return;
      }
      case 'restart':
        this.session.restart();
        // The previous game stays recoverable via “Undo”: its clock is kept too.
        this.clock.restart(this.session.canUndoRestart);
        this.timedOut = false;
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
    if (before.status !== 'playing' || this.timedOut) return;
    // a move after the time limit (between two frames) is too late: the run has failed
    if (this.checkTimeLimit(performance.now())) return;
    // for the e2e tests: move attempts, bumps included (they no longer all vibrate)
    this.attempts++;
    setDebug({ attempts: this.attempts });
    const events = this.session.move(dir);
    vibrate(this.haptics.next(events), app.data.settings.vibration);
    if (events.length === 0) return;
    const after = this.session.state;
    const now = performance.now();
    const moved = after.moves > before.moves;
    if (moved) this.clock.begin(now);
    this.board.apply(after, events, moved ? this.anim.next(now) : 0);
    this.rulesNote?.destroy();
    this.rulesNote = undefined;
    this.updateHud();
    if (after.status === 'won') this.finish(now);
    else if (after.status === 'drowned') this.showFailed(t('drowned'));
  }

  /**
   * Centre of the tap zones, in CSS px: the middle of the play area (the screen without the HUD
   * and the d-pad), or the centre of the player's cell (where the sprite is, or is sliding to:
   * a quick tap right after a move is measured from the player's new cell).
   */
  private zoneCentre(mode: Exclude<TapZoneMode, 'off'>): [number, number] {
    let x: number;
    let y: number;
    if (mode === 'player') {
      [x, y] = this.board.cellCentre(this.session.state.player);
      const cam = this.cameras.main;
      // world → screen (the game camera does not scroll or zoom today, but it could)
      x = (x - cam.worldView.x) * cam.zoom + cam.x;
      y = (y - cam.worldView.y) * cam.zoom + cam.y;
    } else {
      const top = this.topReserve();
      x = (this.scale.width - this.sideReserve()) / 2;
      y = top + (this.scale.height - top - this.bottomReserve()) / 2;
    }
    return [x / dpr(), y / dpr()];
  }

  /** A finger went down off the buttons at (x, y) CSS px: on a tap zone, if they are on. */
  private startZone(id: number, x: number, y: number): void {
    const mode = app.data.settings.tapZones;
    if (mode === 'off' || this.finished) return;
    // not in the HUD band, nor just beside a button or the d-pad: a finger that missed one
    // must do nothing rather than walk
    if (y * dpr() < this.topReserve() || nearAny(x, y, this.noZone, ZONE_BUTTON_MARGIN)) return;
    const [cx, cy] = this.zoneCentre(mode);
    const dir = zoneDir(x - cx, y - cy);
    if (!dir) return;
    // the latest finger wins, like the d-pad
    this.cancelZones();
    this.zonePress = true;
    const emit = (d: Dir) => {
      this.zoneMoves++;
      setDebug({ zoneMoves: this.zoneMoves });
      this.flashZone(d, cx, cy);
      this.handle({ type: 'move', dir: d });
    };
    // below the drag step: a drag stops being a tap before it makes its first move
    const slop = Math.min(TAP_SLOP, app.data.settings.dragStep - 1);
    this.zones.set(id, new ZoneGesture(dir, x, y, emit, () => app.data.settings.repeatRate, slop));
  }

  private cancelZones(): void {
    for (const g of this.zones.values()) g.cancel();
    this.zones.clear();
  }

  /** The triangle of `dir` around (cx, cy) CSS px lightens faintly for ~120 ms. */
  private flashZone(dir: Dir, cx: number, cy: number): void {
    this.zoneFlash?.destroy();
    const c = { x: cx * dpr(), y: cy * dpr() };
    const L = 2 * Math.max(this.scale.width, this.scale.height);
    const corners: Record<Dir, [number, number][]> = {
      up: [
        [-L, -L],
        [L, -L],
      ],
      down: [
        [-L, L],
        [L, L],
      ],
      left: [
        [-L, -L],
        [-L, L],
      ],
      right: [
        [L, -L],
        [L, L],
      ],
    };
    const [[ax, ay], [bx, by]] = corners[dir] as [[number, number], [number, number]];
    const g = this.add.graphics().setDepth(5);
    g.fillStyle(0xffffff, 0.09).fillTriangle(c.x, c.y, c.x + ax, c.y + ay, c.x + bx, c.y + by);
    this.zoneFlash = g;
    setDebug({ zoneFlash: dir });
    this.tweens.add({
      targets: g,
      alpha: 0,
      delay: 60,
      duration: 60,
      onComplete: () => {
        g.destroy();
        if (this.zoneFlash === g) {
          this.zoneFlash = undefined;
          setDebug({ zoneFlash: null });
        }
      },
    });
  }

  /** Master mode: its rules over the board until the first move. */
  private showRules(): void {
    const limit = this.timeLimitMs;
    const rules =
      limit === undefined
        ? t('masterRules')
        : `${t('masterRules')}\n${t('masterTimeRule', { time: formatTime(limit) })}`;
    this.rulesNote = this.add
      .text(this.scale.width / 2, this.scale.height / 2, rules, {
        ...textStyle(16, MASTER_COLOR),
        align: 'center',
        backgroundColor: '#000000cc',
        padding: { x: px(14), y: px(10) },
        wordWrap: { width: this.scale.width - px(64) },
      })
      .setOrigin(0.5)
      .setDepth(10);
  }

  /** Master mode: the run has failed (drowned, or out of time); R or Restart for a new one. */
  private showFailed(message: string): void {
    this.overlay?.destroy();
    this.overlay = this.add
      .text(this.scale.width / 2, this.scale.height / 2, `${message}\n${t('drownedHint')}`, {
        ...textStyle(22, MASTER_COLOR),
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
    this.cancelZones();
    const result: RunResult = {
      moves: this.session.state.moves,
      timeMs: Math.round(this.clock.elapsed(now)),
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
