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
import { chapterTint } from '../render/ambience';
import { AnimClock } from '../render/animTiming';
import { AmbienceView, HUD_DEPTH } from '../render/AmbienceView';
import { BoardView } from '../render/BoardView';
import { boardLayout, fractionalZoom, type BoardLayout } from '../render/layout';
import { HapticFeed, vibrate } from '../haptics';
import { DragSteps } from '../input/drag';
import { HoldRepeat } from '../input/holdRepeat';
import { boundsOf, centreOf, zoneArea, zoneAt, zonePolygon, type Box } from '../input/tapZones';
import { DEEP_THOUGHT, Stillness } from '../achievements';
import { RunClock, countdown } from '../runClock';
import { showNotice } from '../notice';
import { SfxFeed, playSfx, type Sfx } from '../sfx';
import { dpadLayout, dpadLayoutSide, isLandscape, isTouchDevice } from '../touch';
import { arrowPixels, iconPixels } from '../render/frame';
import {
  COLORS,
  dpr,
  hex,
  paintFrame,
  makeButton,
  placeIconBefore,
  px,
  textIcon,
  textStyle,
  uiScale,
} from '../ui';

/** D-pad buttons on a touch screen, CSS px per side (above the 44 px minimum: the main control). */
const DPAD = 56;
/** Master mode colour, and the countdown's warning colour. */
const MASTER_COLOR = '#9be7ff';
const WARN_COLOR = '#ff6b5e';
/** The keys' counter, 3rd in the HUD: the key's art goes before it. */
const KEYS_COUNTER = 2;

/** The sound button: on while the music or the effects play, off when both are off. */
function muteIcon(): string {
  const s = app.data.settings;
  return s.sound || s.sfx ? '🔊' : '🔇';
}

export interface GameSceneData {
  levelId: string;
  mode: Mode;
}

export class GameScene extends Phaser.Scene {
  protected level!: LevelData;
  protected mode: Mode = 'normal';
  protected session!: Session;
  protected board!: BoardView;
  private ambience!: AmbienceView;
  protected hud: Phaser.GameObjects.GameObject[] = [];
  private controls!: InputController;
  /** hold to repeat on the on-screen d-pad */
  private hold!: HoldRepeat;
  /** continuous drags in progress, by pointer id */
  private readonly drags = new Map<number, DragSteps>();
  /** a drag has moved the player since the last press: its release is not a button click */
  private dragMoved = false;
  /** tap zones (touch control option): their area, CSS px (null: none, or no room left) */
  private zoneArea: Box | null = null;
  /** the finger holding a tap zone, and that zone */
  private zoneHeld: { id: number; dir: Dir } | null = null;
  /** the last press started on a tap zone: its release is not a button click either */
  private zonePress = false;
  private zoneFlash?: Phaser.GameObjects.Graphics;
  private zoneMoves = 0;
  private attempts = 0;
  private readonly anim = new AnimClock();
  private clock = new RunClock();
  /** normal mode: the time since the player last did something (Deep Thought) */
  private readonly stillness = new Stillness();
  /** master mode: the time limit (the level's bronze time), ms; none without goldTime */
  private timeLimitMs: number | undefined;
  /** master mode: the time limit is passed, the run has failed (like drowning) */
  private timedOut = false;
  private readonly haptics = new HapticFeed();
  private readonly sounds = new SfxFeed();
  private finished = false;
  private movesText?: Phaser.GameObjects.Text;
  private timeText?: Phaser.GameObjects.Text;
  private keysText?: Phaser.GameObjects.Text;
  private overlay?: Phaser.GameObjects.Text;
  private rulesNote?: Phaser.GameObjects.Text;
  private muteButton?: Phaser.GameObjects.Text;

  constructor() {
    super('Game');
  }

  init(data: GameSceneData): void {
    this.level = levelById(data.levelId);
    this.mode = data.mode;
    this.session = new Session(this.level, this.mode);
    this.clock = new RunClock();
    this.stillness.reset();
    this.timeLimitMs =
      this.mode === 'master'
        ? masterTimeLimitMs(resolveThresholds(this.level.thresholds))
        : undefined;
    this.timedOut = false;
    this.haptics.reset();
    this.sounds.reset();
    setDebug({ timeLeftMs: null, timeWarn: false, failedShown: false });
    this.finished = false;
    this.anim.reset();
    this.overlay = undefined;
    this.rulesNote = undefined;
    this.hud = [];
  }

  create(): void {
    // the cave first: the board and the HUD go over it
    const layout = this.computeLayout();
    this.ambience = new AmbienceView(this, {
      levelId: this.level.id,
      hudHeight: this.topReserve(),
    });
    this.ambience.layout(layout);
    this.board = new BoardView(this, this.session.state, layout);
    this.board.setTerrainTint(chapterTint(this.level.id));
    this.showLayout(layout);
    this.hold = new HoldRepeat(
      (dir) => this.handle({ type: 'move', dir }),
      () => app.data.settings.repeatRate,
    );
    this.buildHud();
    this.controls = new InputController((a) => this.handle(a), app.data.settings.repeatRate);
    const down = (e: KeyboardEvent) => {
      // a new press (not the key's own repeat): a bump vibrates (and sounds) again
      if (!e.repeat) {
        this.haptics.reset();
        this.sounds.reset();
      }
      if (e.key.toLowerCase() === 'm' && !e.ctrlKey && !e.metaKey && !e.altKey) {
        if (!e.repeat) this.toggleMute();
        return;
      }
      if (this.controls.keydown(e)) e.preventDefault();
    };
    const up = (e: KeyboardEvent) => this.controls.keyup(e);
    const blur = () => this.controls.reset();
    window.addEventListener('keydown', down);
    window.addEventListener('keyup', up);
    window.addEventListener('blur', blur);
    // Touch control (Options): a continuous drag anywhere but on a button, one move per
    // `dragStep` CSS pixels travelled; or tap zones, pressed like the d-pad. Phaser handles each
    // DOM pointer event as it comes (no queue replayed, unlike its keyboard).
    const tapMode = app.data.settings.touchControl === 'tap';
    this.drags.clear();
    this.zoneHeld = null;
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
        this.sounds.reset();
        if (over.length) {
          this.drags.delete(p.id);
          return;
        }
        const [x, y] = [p.x / dpr(), p.y / dpr()];
        if (tapMode) this.pressZone(p, x, y);
        else this.drags.set(p.id, new DragSteps(x, y, app.data.settings.dragStep));
      },
    );
    this.input.on('pointermove', (p: Phaser.Input.Pointer) => {
      // a finger that slides off its tap zone stops, like one sliding off a d-pad button
      if (this.zoneHeld?.id === p.id && (!p.isDown || this.zoneUnder(p) !== this.zoneHeld.dir))
        this.releaseZone(p.id);
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
      this.releaseZone(p.id);
    };
    this.input.on('pointerup', release);
    this.input.on('pointerupoutside', release);
    const onResize = () => {
      const next = this.computeLayout();
      this.ambience.layout(next, this.topReserve());
      this.board.setLayout(next);
      this.showLayout(next);
      this.buildHud();
      if (this.rulesNote) {
        this.rulesNote.destroy();
        this.showRules();
      }
      // the failed run's message too: centred, its size following the interface's
      const failed = this.overlay?.getData('message') as string | undefined;
      if (failed !== undefined) this.showFailed(failed);
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
      this.zoneHeld = null;
      this.ambience.destroy();
    });
    syncMusic(this, app.data.settings.sound, 'music-game');
    setDebug({
      scene: 'Game',
      levelId: this.level.id,
      mode: this.mode,
      canUndo: this.session.canUndo,
    });
  }

  override update(time: number): void {
    this.ambience.update(time, this.board.heroCentre());
    if (this.session.state.status !== 'playing' || this.finished || this.timedOut) return;
    if (!this.clock.started) return;
    const now = performance.now();
    if (this.checkTimeLimit(now)) return;
    this.showTime(now);
    // Deep Thought: a minute of the run clock (not the time hidden) without doing anything; not
    // in master mode, where the clock is a countdown
    if (this.mode === 'normal' && this.stillness.thinking(this.clock.elapsed(now))) {
      this.stillness.reset();
      app.earn([DEEP_THOUGHT]);
    }
  }

  /** For the e2e tests: the board's place and zoom, and the screen it was laid out for. */
  private showLayout(layout: BoardLayout): void {
    setDebug({ boardLayout: { ...layout, viewW: this.scale.width, viewH: this.scale.height } });
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
    this.releaseZone();
    this.drags.clear();
    this.timeText?.setText(`${t('timeLeft')} ${formatTime(0)}`).setColor(WARN_COLOR);
    vibrate('fail', app.data.settings.vibration);
    this.sfx('fail');
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
      fractionalZoom(window.devicePixelRatio || 1),
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
    const hudButtons: Record<string, [number, number]> = {};
    // sound on/off, like M: in the header with a keyboard; on a touch screen (no M key) by the
    // d-pad, so that the header keeps its room for the level's name
    const touch = isTouchDevice();
    const muteAt = (mx: number, my: number, originX: number) => {
      const b = makeButton(
        this,
        mx,
        my,
        muteIcon(),
        () => {
          if (!this.dragMoved && !this.zonePress) this.toggleMute();
        },
        16,
      ).setOrigin(originX, 0.5);
      hudButtons.mute = [b.getBounds().centerX / dpr(), my / dpr()];
      this.muteButton = b;
      return b;
    };
    const timeLabel = this.timeLimitMs === undefined ? t('time') : t('timeLeft');
    const counterTexts: [string, string][] = [
      [`${t('moves')} 999`, COLORS.text],
      [`${timeLabel} 0:00.00`, COLORS.text],
      [`${t('keys')} -9`, COLORS.text],
    ];
    if (this.mode === 'master' && !narrow) counterTexts.push([t('masterMode'), MASTER_COLOR]);

    /**
     * The header's row with Undo and Restart as words, or (`icons`) as pixel icons; the level's
     * name whole in the room left, or null (everything made then destroyed). `last`: the name is
     * cut with "…" rather than not shown.
     */
    const headerRow = (icons: boolean, last: boolean) => {
      const made: Phaser.GameObjects.GameObject[] = [];
      const buttonBoxes: Box[] = [];
      let x = w - px(8);
      let rowH = px(30);
      for (const [label, action] of buttons) {
        // a drag (or a press on a tap zone) that ends on a button is not a click on it
        const click = () => {
          if (!this.dragMoved && !this.zonePress) this.handle(action);
        };
        const icon = icons && (action.type === 'undo' || action.type === 'restart');
        const b = makeButton(this, x, y, icon ? ' ' : label, click, 13).setOrigin(1, 0.5);
        made.push(b);
        if (icon) made.push(this.iconOn(b, action.type as 'undo' | 'restart', label));
        hudButtons[action.type] = [(x - b.width / 2) / dpr(), y / dpr()];
        buttonBoxes.push(css(b.getBounds()));
        rowH = Math.max(rowH, b.height);
        x -= b.width + px(6);
      }
      if (!touch) {
        const mute = muteAt(x, y, 1);
        made.push(mute);
        buttonBoxes.push(css(mute.getBounds()));
        x -= mute.width + px(6);
      }
      const buttonsLeft = x + px(6);
      // counters, one after the other, each wide enough for its longest value (nothing jumps);
      // a smaller font where the words are too long for the screen (some languages)
      const counterRoom = (narrow ? w : buttonsLeft) - px(12);
      // the keys' counter shows the key's art before its word
      let counters: Phaser.GameObjects.Text[] = [];
      let keyIcon: Phaser.GameObjects.Image | undefined;
      for (let size = 14; size >= 9; size--) {
        for (const c of counters) c.destroy();
        keyIcon?.destroy();
        const gap = px(size);
        let cx = px(12);
        counters = [];
        for (const [i, [text, color]] of counterTexts.entries()) {
          const txt = this.add.text(cx, sy, text, textStyle(size, color)).setOrigin(0, 0.5);
          if (i === KEYS_COUNTER) {
            keyIcon = textIcon(this, 'KEY', size);
            placeIconBefore(keyIcon, txt, cx);
          }
          cx = txt.x + txt.width + gap;
          counters.push(txt);
        }
        if (cx - gap <= counterRoom) break;
      }
      made.push(...counters);
      if (keyIcon) made.push(keyIcon);
      const end = counters.at(-1)!.x + counters.at(-1)!.width;
      // the level's name, on the buttons' row in the room they leave: the largest size that
      // shows it whole, on one line or wrapped on two no taller than the buttons
      const nameX = narrow ? px(12) : end + px(24);
      const room = buttonsLeft - px(10) - nameX;
      let name: Phaser.GameObjects.Text | null = null;
      for (let size = 13; size >= 10 && !name; size--) {
        const txt = this.add
          .text(nameX, y, this.level.name, textStyle(size, COLORS.accent))
          .setOrigin(0, 0.5);
        if (txt.width > room && room > 0) txt.setWordWrapWidth(room);
        const wrapped = txt.getWrappedText().length;
        if (txt.width <= room && wrapped <= 2 && txt.height <= rowH) name = txt;
        else txt.destroy();
      }
      if (!name && last) {
        name = this.add.text(nameX, y, '', textStyle(10, COLORS.accent)).setOrigin(0, 0.5);
        const cut = name;
        cut.setText(ellipsize(this.level.name, (s) => cut.setText(s).width <= room));
      }
      if (!name) {
        for (const o of made) o.destroy();
        return null;
      }
      made.push(name);
      const iconWords = icons
        ? Object.fromEntries(
            buttons.filter(([, a]) => a.type !== 'menu').map(([label, a]) => [a.type, label]),
          )
        : null;
      return { made, name, counters, keyIcon, buttonBoxes, icons: iconWords };
    };
    // the words first; Undo and Restart as icons when the words leave the name too little room
    const row = headerRow(false, false) ?? headerRow(true, true)!;
    const { name: nameText, counters, keyIcon, buttonBoxes } = row;
    this.hud.push(...row.made);
    [this.movesText, this.timeText, this.keysText] = counters as [
      Phaser.GameObjects.Text,
      Phaser.GameObjects.Text,
      Phaser.GameObjects.Text,
    ];
    if (this.mode === 'master' && narrow) {
      // the MASTER label on a 3rd line
      this.hud.push(
        this.add
          .text(px(12), sy + px(22), t('masterMode'), textStyle(14, MASTER_COLOR))
          .setOrigin(0, 0.5),
      );
    }
    setDebug({
      hudName: nameText.text,
      hudNameLines: nameText.getWrappedText().length,
      // the size it was made with (textStyle), not its device px
      hudNameSize: parseInt(String(nameText.style.fontSize), 10) / dpr() / uiScale(),
      // Undo and Restart drawn as icons: their words, still their names
      hudIcons: row.icons,
      hudLayout: {
        name: css(nameText.getBounds()),
        buttons: buttonBoxes,
        counters: counters.map((c) => css(c.getBounds())),
        keyIcon: keyIcon && css(keyIcon.getBounds()),
      },
    });
    this.hold.reset();
    this.releaseZone();
    // the bottom of the header: every text drawn so far (buttons, counters, name, MASTER) and
    // the key's icon
    const header = boundsOf(
      this.hud
        .filter(
          (o): o is Phaser.GameObjects.Text | Phaser.GameObjects.Image =>
            o instanceof Phaser.GameObjects.Text || o instanceof Phaser.GameObjects.Image,
        )
        .map((o) => css(o.getBounds())),
    );
    const headerBottom = header.y + header.h;
    const viewW = w / dpr();
    const viewH = this.scale.height / dpr();
    this.zoneArea = zoneArea(viewW, viewH, headerBottom, null, undefined, viewH - px(24) / dpr());
    if (isTouchDevice()) {
      const side = this.sidePad();
      const pad = side
        ? dpadLayoutSide(w, this.scale.height, px(DPAD), px(16))
        : dpadLayout(w, this.scale.height, px(DPAD));
      const padBox = boundsOf(
        Object.values(pad).map((r) => ({
          x: r.x / dpr(),
          y: r.y / dpr(),
          w: r.w / dpr(),
          h: r.h / dpr(),
        })),
      );
      this.zoneArea = zoneArea(viewW, viewH, headerBottom, { box: padBox, side });
      for (const dir of ['up', 'down', 'left', 'right'] as const) {
        const r = pad[dir];
        const box = this.add
          .rectangle(r.x, r.y, r.w, r.h, hex(COLORS.panel), 0)
          .setOrigin(0)
          .setInteractive();
        // the frame is drawn apart: the invisible rectangle stays the hit area
        const frame = this.add.graphics().setPosition(r.x, r.y);
        let held = false;
        const paint = () => paintFrame(frame, Math.round(r.w), Math.round(r.h), held);
        paint();
        box.on('pointerdown', () => ((held = true), paint()));
        box.on('pointerout', () => ((held = false), paint()));
        box.on('pointerup', () => ((held = false), paint()));
        box.on('pointerupoutside', () => ((held = false), paint()));
        // hold to repeat; stops on release, when the finger slides off or the touch is cancelled
        const onBox = (p: Phaser.Input.Pointer) =>
          p.isDown && box.active && p.x >= r.x && p.x < r.x + r.w && p.y >= r.y && p.y < r.y + r.h;
        box.on('pointerdown', (p: Phaser.Input.Pointer) =>
          this.hold.press(p.id, dir, () => onBox(p)),
        );
        box.on('pointerout', (p: Phaser.Input.Pointer) => this.hold.release(p.id));
        box.on('pointerup', (p: Phaser.Input.Pointer) => this.hold.release(p.id));
        // a pixel arrow on a 7×7 grid, about 42 % of the button, centred
        const cell = Math.max(1, Math.round((0.42 * Math.min(r.w, r.h)) / 7 / px(2))) * px(2);
        const gx = r.x + (r.w - 7 * cell) / 2;
        const gy = r.y + (r.h - 7 * cell) / 2;
        const arrow = this.add.graphics().fillStyle(hex(COLORS.text), 1);
        for (const [c, row] of arrowPixels(dir))
          arrow.fillRect(Math.round(gx + c * cell), Math.round(gy + row * cell), cell, cell);
        this.hud.push(box, frame, arrow);
      }
      // the sound button: under the d-pad column (landscape), or at the left edge on the
      // d-pad's bottom row (portrait)
      if (side)
        this.hud.push(muteAt(pad.up.x + pad.up.w / 2, this.scale.height - px(16) - px(22), 0.5));
      else this.hud.push(muteAt(px(12), pad.down.y + pad.down.h / 2, 0));
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
    // above the cave's darkness, vignette and HUD band (a button's frame follows it, 1 below)
    for (const o of this.hud) (o as Phaser.GameObjects.Text).setDepth(HUD_DEPTH);
    setDebug({
      touchControl: app.data.settings.touchControl,
      zoneArea: this.zoneArea,
      zoneCentre: this.zoneArea && centreOf(this.zoneArea),
    });
    this.updateHud();
  }

  /**
   * Turns a HUD button with a blank label into a square one showing a pixel icon, drawn like the
   * d-pad's arrows (lit under the pointer like a word); the word stays the button's name.
   */
  private iconOn(
    b: Phaser.GameObjects.Text,
    icon: 'undo' | 'restart',
    word: string,
  ): Phaser.GameObjects.Graphics {
    const extra = Math.max(0, Math.ceil((b.height - b.width) / 2));
    const p = b.padding;
    b.setPadding(p.left! + extra, p.top!, p.right! + extra, p.bottom!).setName(word);
    const g = this.add.graphics();
    const paint = (color: string) => {
      const r = b.getBounds();
      const cell =
        Math.max(1, Math.round((0.42 * Math.min(r.width, r.height)) / 7 / px(2))) * px(2);
      const gx = r.x + (r.width - 7 * cell) / 2;
      const gy = r.y + (r.height - 7 * cell) / 2;
      g.clear().fillStyle(hex(color), 1);
      for (const [c, row] of iconPixels(icon))
        g.fillRect(Math.round(gx + c * cell), Math.round(gy + row * cell), cell, cell);
    };
    paint(COLORS.text);
    b.on('pointerover', () => paint(COLORS.accent));
    b.on('pointerout', () => paint(COLORS.text));
    return g;
  }

  private updateHud(): void {
    const s = this.session.state;
    this.movesText?.setText(`${t('moves')} ${s.moves}`);
    setDebug({ moves: s.moves, status: s.status, player: s.player });
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
          this.sfx('undo');
          if (restoring) this.clock.undoRestart();
          this.stillness.act(this.clock.elapsed(performance.now()));
          this.board.rebuild(this.session.state);
          this.anim.reset();
          this.updateHud();
        }
        return;
      }
      case 'restart':
        this.sfx('undo');
        this.session.restart();
        // The previous game stays recoverable via “Undo”: its clock is kept too.
        this.clock.restart(this.session.canUndoRestart);
        this.stillness.reset();
        this.timedOut = false;
        this.anim.reset();
        this.board.rebuild(this.session.state);
        this.overlay?.destroy();
        this.overlay = undefined;
        setDebug({ failedShown: false });
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
    this.stillness.act(this.clock.elapsed(performance.now()));
    vibrate(this.haptics.next(events), app.data.settings.vibration);
    playSfx(this.sounds.next(events), app.data.settings.sfx);
    if (events.length === 0) return;
    const after = this.session.state;
    const now = performance.now();
    const moved = after.moves > before.moves;
    if (moved) {
      this.clock.begin(now);
      this.stillness.act(this.clock.elapsed(now));
    }
    this.board.apply(after, events, moved ? this.anim.next(now) : 0);
    this.rulesNote?.destroy();
    this.rulesNote = undefined;
    this.updateHud();
    if (after.status === 'won') this.finish(now);
    else if (after.status === 'drowned') this.showFailed(t('drowned'));
  }

  private sfx(s: Sfx): void {
    playSfx(s, app.data.settings.sfx);
  }

  /** M: all sound off (music and effects), or back on when all is off. */
  private toggleMute(): void {
    const s = app.data.settings;
    const on = !(s.sound || s.sfx);
    s.sound = on;
    s.sfx = on;
    app.persist();
    syncMusic(this, on, 'music-game');
    this.muteButton?.setText(muteIcon());
    showNotice(t(on ? 'unmuted' : 'muted'));
    setDebug({ settings: { ...s } });
  }

  /** The tap zone under a pointer (none outside their area). */
  private zoneUnder(p: Phaser.Input.Pointer): Dir | null {
    return zoneAt(p.x / dpr(), p.y / dpr(), this.zoneArea);
  }

  /**
   * Tap mode: a finger went down off the buttons at (x, y) CSS px. On a zone it acts like a
   * d-pad button (the same hold to repeat): a move at once, then the repeat while it stays on
   * that zone. Off the zones (header, d-pad, their margins, diagonals, centre): nothing.
   */
  private pressZone(p: Phaser.Input.Pointer, x: number, y: number): void {
    if (this.finished) return;
    const dir = zoneAt(x, y, this.zoneArea);
    if (!dir) return;
    this.releaseZone();
    this.zonePress = true;
    this.zoneHeld = { id: p.id, dir };
    this.lightZone(dir);
    const emit = (d: Dir) => {
      this.zoneMoves++;
      setDebug({ zoneMoves: this.zoneMoves });
      this.handle({ type: 'move', dir: d });
    };
    const stillHeld = () =>
      p.isDown && this.zoneHeld?.id === p.id && this.zoneUnder(p) === this.zoneHeld.dir;
    this.hold.press(p.id, dir, stillHeld, emit);
  }

  /** The finger on a tap zone (`id`, or any) is lifted, cancelled or slid off: it stops. */
  private releaseZone(id?: number): void {
    const held = this.zoneHeld;
    if (!held || (id !== undefined && held.id !== id)) return;
    this.zoneHeld = null;
    this.hold.release(held.id);
    this.dimZone();
  }

  /** The pressed zone lightens faintly while it is held, inside the zones' area only. */
  private lightZone(dir: Dir): void {
    this.zoneFlash?.destroy();
    this.zoneFlash = undefined;
    if (!this.zoneArea) return;
    const points = zonePolygon(dir, this.zoneArea);
    const g = this.add.graphics().setDepth(HUD_DEPTH - 1);
    g.fillStyle(0xffffff, 0.09).fillPoints(
      points.map(([x, y]) => new Phaser.Math.Vector2(x * dpr(), y * dpr())),
      true,
    );
    this.zoneFlash = g;
    setDebug({ zoneFlash: dir, zoneFlashPoints: points });
  }

  /** The lit zone fades out once released (a quick tap still shows it briefly). */
  private dimZone(): void {
    const g = this.zoneFlash;
    if (!g) return;
    this.tweens.add({
      targets: g,
      alpha: 0,
      delay: 60,
      duration: 60,
      onComplete: () => {
        g.destroy();
        if (this.zoneFlash === g) {
          this.zoneFlash = undefined;
          setDebug({ zoneFlash: null, zoneFlashPoints: null });
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

  /**
   * Master mode: the run has failed (drowned, or out of time); R or Restart for a new one. On a
   * touch screen there is no R key: a tap on the message itself restarts.
   */
  private showFailed(message: string): void {
    this.overlay?.destroy();
    const touch = isTouchDevice();
    this.overlay = this.add
      .text(
        this.scale.width / 2,
        this.scale.height / 2,
        `${message}\n${t(touch ? 'drownedHintTouch' : 'drownedHint')}`,
        {
          ...textStyle(22, MASTER_COLOR),
          align: 'center',
          backgroundColor: '#000000aa',
          padding: { x: px(16), y: px(12) },
          // long words on a narrow phone (Silkscreen is wide): on two lines
          wordWrap: { width: this.scale.width - px(64) },
        },
      )
      .setOrigin(0.5)
      .setDepth(10)
      .setData('message', message);
    if (touch) {
      this.overlay.setInteractive();
      this.overlay.on('pointerup', () => {
        if (!this.dragMoved && !this.zonePress) this.handle({ type: 'restart' });
      });
    }
    // Phaser hit-tests the message only once its next pre-update has taken it in: the tests
    // learn that it is shown (and answers a tap) once it has been drawn
    setDebug({ failedShown: false });
    const overlay = this.overlay;
    this.events.once(Phaser.Scenes.Events.PRE_UPDATE, () =>
      this.events.once(Phaser.Scenes.Events.RENDER, () => {
        if (this.overlay === overlay) setDebug({ failedShown: true });
      }),
    );
  }

  private finish(now: number): void {
    this.finished = true;
    this.controls.reset();
    this.hold.reset();
    this.releaseZone();
    const result: RunResult = {
      moves: this.session.state.moves,
      timeMs: Math.round(this.clock.elapsed(now)),
      mode: this.mode,
    };
    const medals = award(this.level, result, hasMaster(this.level.id));
    const previous = app.data.levels[this.level.id];
    app.data.levels[this.level.id] = recordRun(previous, result, medals);
    app.persist();
    app.checkRecords();
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
