import Phaser from 'phaser';
import { app } from '../app';
import { setDebug } from '../debug';
import { LANGS, detectLang, getLang, messages, setLang, t, type Lang } from '../i18n';
import { canVibrate, vibrate } from '../haptics';
import { DRAG_NOTCHES, notchAt, notchOfStep, stepOfNotch } from '../input/drag';
import { FocusList, focusKey } from '../input/focusList';
import { saveContext } from '../levels';
import { showNotice } from '../notice';
import { exportSave, importSave } from '../save';
import { playSfx } from '../sfx';
import { onSceneKeyDown } from '../input/sceneKeys';
import { nextTouchControl } from '../input/tapZones';
import {
  clampScroll,
  dropDownTop,
  inertiaStep,
  isDrag,
  maxScroll,
  releaseSpeed,
  scrollThumb,
} from '../input/scroll';
import { syncMusic } from '../music';
import {
  COLORS,
  HEADER_BAND,
  KeyFocus,
  TOUCH_TARGET,
  devicePx,
  dpr,
  headerBand,
  hex,
  makeButton,
  px,
  textStyle,
  type Focusable,
} from '../ui';
import { isTouchDevice } from '../touch';

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

/** A pointer held on the screen, that scrolls the options once it has moved far enough. */
interface Drag {
  id: number;
  x: number;
  y: number;
  scroll: number;
  samples: { t: number; y: number }[];
}

/**
 * The options, one under the other. On a phone in landscape they are taller than the screen:
 * the whole screen (title included, to leave all the height to the options) then scrolls, with
 * a finger (and a flick's inertia), the mouse wheel or the keys, and shows a thin indicator.
 */
export class OptionsScene extends Phaser.Scene {
  /** button centres in content coordinates (device px), for the e2e tests */
  private buttons: Record<string, [number, number]> = {};
  /** drop-down list items, in screen coordinates (device px) */
  private menuButtons: Record<string, [number, number]> = {};
  /** buttons fixed on the screen (the band at the top): device px, not moved by the scroll */
  private fixedButtons: Record<string, [number, number]> = {};
  private langMenu: Phaser.GameObjects.GameObject[] = [];
  /** scroll offset, device px */
  private scroll = 0;
  private contentH = 0;
  private drag: Drag | null = null;
  /** the last pointer pressed has moved: its release is not a tap */
  private dragged = false;
  /** inertia after a flick, px/ms (positive: the content goes up) */
  private velocity = 0;
  private thumb!: Phaser.GameObjects.Graphics;
  /** the buttons in reading order, for the keyboard */
  private focusables: Focusable[] = [];
  private focus!: KeyFocus;
  /** the button focused before the scene restarted */
  private focusId: string | null = null;
  /** the drop-down list's languages, and the one the keyboard is on */
  private langItems: Phaser.GameObjects.Text[] = [];
  private langFocus = new FocusList(0);
  /** the finger moving the sensitivity gauge's knob (it scrolls nothing meanwhile) */
  private gaugePointer: number | null = null;
  /** the sensitivity gauge's knob, focused like a button: ← and → move it a notch */
  private static readonly GAUGE = 'drag';
  /** Import or Erase pressed once (the button now asks "Sure?"): its next press acts */
  /** moves the sensitivity gauge by `by` notches (set while it is shown) */
  private gaugeShift: ((by: number) => void) | null = null;
  private armed: { id: string; button: Phaser.GameObjects.Text; label: string } | null = null;

  constructor() {
    super('Options');
  }

  /**
   * `scroll` (device px) and the keyboard focus are kept when the scene restarts (option
   * changed, rotation). Phaser keeps the last data for a later start without any: they are used
   * once, so that coming back from the menu shows the top again.
   */
  init(data: { scroll?: number; focus?: string | null }): void {
    this.scroll = data?.scroll ?? 0;
    this.focusId = data?.focus ?? null;
    if (data) {
      delete data.scroll;
      delete data.focus;
    }
  }

  /**
   * Restarts the scene where it was (scroll and keyboard focus). The restart happens on the next
   * frame and keys can still reach this scene until then: the focus is taken when it stops, and
   * the tests see none in between, so they wait for the new scene's.
   */
  private rebuild(): void {
    const data: { scroll: number; focus: string | null } = { scroll: this.scroll, focus: null };
    this.events.once('shutdown', () => {
      data.scroll = this.scroll;
      data.focus = this.focus?.focused?.id ?? null;
    });
    setDebug({ focus: undefined });
    this.scene.restart(data);
  }

  create(): void {
    const s = app.data.settings;
    const cx = this.scale.width / 2;
    // labels can be long in some languages: each option takes two lines (label, then controls)
    const wrap = Math.min(this.scale.width - px(32), px(420));
    this.buttons = {};
    this.menuButtons = {};
    this.langMenu = [];
    this.langItems = [];
    this.focusables = [];
    this.armed = null;
    this.gaugeShift = null;
    this.drag = null;
    this.dragged = false;
    this.velocity = 0;
    // touch: taller buttons (TOUCH_TARGET), so more room between a label, its control and the
    // next label
    const touch = isTouchDevice();
    const labelGap = px(touch ? TOUCH_TARGET / 2 + 6 : 15);
    // with a mouse, a little tighter: everything fits a 1280×720 screen
    const rowStep = px(touch ? TOUCH_TARGET / 2 + 26 : 36);
    // the first label under the band at the top (back to the menu, the screen's name)
    let y = px(HEADER_BAND) + px(touch ? 34 : 22);
    const change = (fn: () => void) => {
      fn();
      app.persist();
      this.rebuild();
    };
    // a control answers a tap only: a finger that slid to scroll does not press it
    const button = (
      id: string,
      x: number,
      by: number,
      label: string,
      fn: () => void,
      size = 14,
    ) => {
      const b = makeButton(this, x, by, label, () => this.dragged || fn(), size);
      this.buttons[id] = [x, by];
      this.focusables.push({ id, button: b, press: fn });
      return b;
    };
    // buttons side by side, centred on the row; on a narrow screen a little smaller (`sizes`, the
    // first that fits), else one under the other as many per line as fit, at the first size
    const gap = px(12);
    const lineStep = px(touch ? TOUCH_TARGET + 6 : 30);
    const row = (items: [id: string, label: string, fn: () => void][], sizes = [14]) => {
      const room = this.scale.width - px(16);
      // a button's width: its label and padding, at least TOUCH_TARGET on a touch screen
      const widths = (size: number) =>
        items.map(([, text]) => {
          const m = this.add.text(0, 0, text, textStyle(size));
          const w = Math.max(m.width + 2 * px(8), touch ? px(TOUCH_TARGET) : 0);
          m.destroy();
          return w;
        });
      const total = (ws: number[]) => ws.reduce((a, w) => a + w, 0) + gap * (ws.length - 1);
      const size = sizes.find((s) => total(widths(s)) <= room) ?? sizes[0]!;
      const ws = widths(size);
      // the lines: as many buttons on each as fit
      const lines: number[][] = [[]];
      ws.forEach((w, i) => {
        const line = lines.at(-1)!;
        if (line.length && total([...line.map((j) => ws[j]!), w]) > room) lines.push([i]);
        else line.push(i);
      });
      const bs: Phaser.GameObjects.Text[] = [];
      lines.forEach((line, k) => {
        if (k) y += lineStep;
        let x = cx - total(line.map((i) => ws[i]!)) / 2;
        for (const i of line) {
          const [id, text, fn] = items[i]!;
          bs[i] = button(id, x + ws[i]! / 2, y, text, fn, size);
          x += ws[i]! + gap;
        }
      });
      y += rowStep;
      return bs;
    };
    const label = (text: string) => {
      const l = this.add
        .text(cx, y, text, {
          ...textStyle(13, COLORS.dim),
          align: 'center',
          wordWrap: { width: wrap },
        })
        .setOrigin(0.5, 0);
      y += l.height + labelGap;
    };
    const stepper = (id: string, value: string, onMinus: () => void, onPlus: () => void) => {
      button(`${id}-minus`, cx - px(80), y, '−', () => change(onMinus));
      this.add.text(cx, y, value, textStyle(14)).setOrigin(0.5);
      button(`${id}-plus`, cx + px(80), y, '+', () => change(onPlus));
      y += rowStep;
    };

    // The drag's sensitivity: a gauge with a notch per distance, from "less sensitive" (the
    // longest distance per move) to "very sensitive"; the knob is dragged (or a notch touched),
    // or focused with the keys and moved a notch by ← and →
    this.gaugePointer = null;
    const gauge = () => {
      const width = Math.min(wrap, px(280));
      const left = cx - width / 2;
      const xOf = (i: number) => left + (i * width) / (DRAG_NOTCHES - 1);
      let notch = notchOfStep(s.dragStep);
      const track = this.add.graphics();
      const draw = () => {
        const h = px(4);
        track.clear();
        track.fillStyle(0x15131c, 1).fillRect(left, y - h / 2, width, h);
        track.fillStyle(hex(COLORS.accent), 1).fillRect(left, y - h / 2, xOf(notch) - left, h);
        for (let i = 0; i < DRAG_NOTCHES; i++) {
          const on = i <= notch;
          track
            .fillStyle(on ? hex(COLORS.accent) : hex(COLORS.dim), 1)
            .fillRect(Math.round(xOf(i) - px(1)), y + px(6), px(2), px(6));
        }
      };
      const knob = makeButton(this, xOf(notch), y, ' ', () => {}, 14);
      const gy = y;
      const moveTo = (i: number) => {
        notch = i;
        knob.setX(xOf(i));
        this.buttons[OptionsScene.GAUGE] = [xOf(i), gy];
        draw();
        this.publishButtons();
      };
      const commit = () => {
        const step = stepOfNotch(notch);
        if (step !== s.dragStep) change(() => (s.dragStep = step));
      };
      draw();
      this.buttons[OptionsScene.GAUGE] = [xOf(notch), y];
      for (let i = 0; i < DRAG_NOTCHES; i++) this.buttons[`drag-${i}`] = [xOf(i), y];
      this.focusables.push({ id: OptionsScene.GAUGE, button: knob, press: () => {} });
      this.gaugeShift = (by) => {
        const i = Math.min(DRAG_NOTCHES - 1, Math.max(0, notch + by));
        if (i === notch) return;
        moveTo(i);
        commit();
      };
      // the touch area: the whole gauge, a finger tall
      const hitH = px(touch ? TOUCH_TARGET : 32);
      const zone = this.add
        .rectangle(left - hitH / 2, y - hitH / 2, width + hitH, hitH, 0, 0)
        .setOrigin(0)
        .setInteractive({ useHandCursor: true });
      knob.setDepth(1);
      const grab = (p: Phaser.Input.Pointer) => {
        this.gaugePointer = p.id;
        this.drag = null;
        moveTo(notchAt(p.x, left, width));
      };
      zone.on('pointerdown', grab);
      knob.on('pointerdown', grab);
      this.input.on('pointermove', (p: Phaser.Input.Pointer) => {
        if (p.id !== this.gaugePointer || !p.isDown) return;
        const i = notchAt(p.x, left, width);
        if (i !== notch) moveTo(i);
      });
      const release = (p: Phaser.Input.Pointer) => {
        if (p.id !== this.gaugePointer) return;
        this.gaugePointer = null;
        commit();
      };
      this.input.on('pointerup', release);
      this.input.on('pointerupoutside', release);
      // the ends: what each way means
      const ends = y + px(touch ? TOUCH_TARGET / 2 + 4 : 18);
      this.add.text(left, ends, t('dragLow'), textStyle(11, COLORS.dim)).setOrigin(0, 0);
      this.add.text(left + width, ends, t('dragHigh'), textStyle(11, COLORS.dim)).setOrigin(1, 0);
      y += rowStep + px(touch ? 30 : 22);
    };

    // The on/off switches ("Music: On"): one a line, all as wide as the longest of their words
    // either way, so that a switch pressed changes neither its width nor the lines.
    type Switch = 'music' | 'effects' | 'torchlight' | 'dust' | 'vignette' | 'smoothing';
    const onOff = (key: Switch, on: boolean) =>
      t('labelValue', { label: t(key), value: on ? t('on') : t('off') });
    const SWITCHES: Switch[] = ['music', 'effects', 'torchlight', 'dust', 'vignette', 'smoothing'];
    const switchW = Math.max(
      ...SWITCHES.flatMap((k) =>
        [true, false].map((on) => {
          const m = this.add.text(0, 0, onOff(k, on), textStyle(14));
          const w = Math.max(m.width + 2 * px(8), touch ? px(TOUCH_TARGET) : 0);
          m.destroy();
          return w;
        }),
      ),
    );
    const switches = (items: [id: string, key: Switch, on: boolean, fn: () => void][]) => {
      items.forEach(([id, key, on, fn], i) => {
        if (i) y += lineStep;
        const b = button(id, cx, y, onOff(key, on), fn);
        // the same width for all: the padding takes what the words leave
        const extra = Math.max(0, switchW - b.width);
        const p = b.padding;
        const left = Math.floor(extra / 2);
        b.setPadding(p.left! + left, p.top!, p.right! + extra - left, p.bottom!);
      });
      y += rowStep;
    };

    label(t('sound'));
    switches([
      [
        'sound',
        'music',
        s.sound,
        () =>
          change(() => {
            s.sound = !s.sound;
            syncMusic(this, s.sound, 'music-menu');
          }),
      ],
      [
        'sfx',
        'effects',
        s.sfx,
        () =>
          change(() => {
            s.sfx = !s.sfx;
            playSfx('key', s.sfx); // a sample when turned on
          }),
      ],
    ]);

    label(t('language'));
    const langY = y;
    button('lang', cx, y, `${t('langName')} ▾`, () => this.toggleLangMenu(cx, langY));
    y += rowStep;

    // touch control: drag or tap zones; the drag distance only matters to the drag
    label(t('touchControl'));
    const controls = { drag: t('touchDrag'), tap: t('touchTap') };
    button('touchControl', cx, y, controls[s.touchControl], () =>
      change(() => (s.touchControl = nextTouchControl(s.touchControl))),
    );
    y += rowStep;
    if (s.touchControl === 'drag') {
      label(t('drag'));
      gauge();
      const hold = t('labelValue', {
        label: t('dragHold'),
        value: s.dragHold ? t('on') : t('off'),
      });
      button('dragHold', cx, y, hold, () => change(() => (s.dragHold = !s.dragHold)));
      y += rowStep;
    }
    label(t('repeat'));
    stepper(
      'repeat',
      String(s.repeatRate),
      () => (s.repeatRate = clamp(s.repeatRate - 1, 4, 20)),
      () => (s.repeatRate = clamp(s.repeatRate + 1, 4, 20)),
    );
    // vibrations: only offered where the browser can vibrate (not iOS Safari)
    if (canVibrate()) {
      label(t('vibration'));
      button('vibration', cx, y, s.vibration ? t('on') : t('off'), () =>
        change(() => {
          s.vibration = !s.vibration;
          vibrate('bump', s.vibration); // a sample when turned on
        }),
      );
      y += rowStep;
    }

    // graphics: the cave ambience and the smoothing, one switch each, like music and effects
    label(t('graphics'));
    const graphic = (
      key: 'torchlight' | 'dust' | 'vignette' | 'smoothing',
    ): [string, Switch, boolean, () => void] => [
      key,
      key,
      s[key],
      () => change(() => (s[key] = !s[key])),
    ];
    switches([graphic('torchlight'), graphic('dust'), graphic('vignette'), graphic('smoothing')]);

    // the progress: kept in a file, brought back from one (it replaces the progress) or erased;
    // both of those ask first
    label(t('progress'));
    const progressRow = row(
      [
        ['export', t('exportSave'), () => this.exportProgress()],
        [
          'import',
          t('importSave'),
          () => this.confirmed('import', imp!, t('importSave')) && this.importProgress(),
        ],
        [
          'erase',
          t('resetProgress'),
          () => this.confirmed('erase', erase!, t('resetProgress')) && this.eraseProgress(),
        ],
      ],
      [14, 13, 12],
    );

    const [, imp, erase] = progressRow;
    this.contentH = Math.max(...progressRow.map((b) => b.getBounds().bottom)) + px(24);

    // the band at the top, fixed: back to the menu (last in the keyboard's order), its left side
    // lined up with the content's column, and the screen's name
    const back = button('back', 0, 0, `‹ ${t('menu')}`, () => this.scene.start('Menu'), 12);
    headerBand(this, t('options'), back, cx - Math.min(this.scale.width - px(32), px(460)) / 2);
    delete this.buttons.back;
    this.fixedButtons = { back: [back.getBounds().centerX, back.y] };

    this.thumb = this.add.graphics().setScrollFactor(0).setDepth(5);
    this.setScroll(this.scroll, true);
    this.focus = new KeyFocus(this.focusables, this.focusId, (item) => {
      this.reveal(item.button);
      setDebug({ focus: item.id });
    });
    this.listenScroll();
    onSceneKeyDown(this, (e) => this.onKey(e));
    const onResize = () => this.rebuild();
    this.scale.on('resize', onResize);
    this.events.once('shutdown', () => this.scale.off('resize', onResize));
    setDebug({ scene: 'Options', lang: getLang(), langMenuOpen: false, settings: { ...s } });
  }

  /** After an update's reload: where the options were scrolled to (pwa.ts). */
  resumeData(): object {
    return { scroll: this.scroll };
  }

  override update(_time: number, delta: number): void {
    if (!this.velocity || this.drag) return;
    const step = inertiaStep(this.velocity, delta);
    const before = this.scroll;
    this.setScroll(this.scroll + step.dist);
    // stopped by the top or the bottom
    this.velocity = this.scroll === before ? 0 : step.v;
  }

  private scrollable(): boolean {
    return maxScroll(this.contentH, this.scale.height) > 0;
  }

  /** Moves the content (clamped) and the indicator, and tells the tests where the controls are. */
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
    // the thumb runs along the track as the content runs along the viewport
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
    this.publishButtons();
  }

  private listenScroll(): void {
    const now = () => performance.now();
    this.input.on('pointerdown', (p: Phaser.Input.Pointer) => {
      this.dragged = false;
      this.velocity = 0;
      // a finger on the sensitivity gauge moves its knob, not the page
      if (this.langMenu.length || !this.scrollable() || p.id === this.gaugePointer) return;
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
      // a finger's slop: a physical size, not grown with the interface
      if (!this.dragged && !isDrag(p.x - d.x, p.y - d.y, devicePx(8))) return;
      this.dragged = true;
      d.samples.push({ t: now(), y: p.y });
      if (d.samples.length > 8) d.samples.shift();
      this.setScroll(d.scroll - (p.y - d.y));
    });
    // the controls hear the release before the scene: `dragged` still tells them it was a drag
    const release = (p: Phaser.Input.Pointer) => {
      const d = this.drag;
      if (!d || d.id !== p.id) return;
      this.drag = null;
      if (this.dragged) this.velocity = -releaseSpeed(d.samples, now());
    };
    this.input.on('pointerup', release);
    this.input.on('pointerupoutside', release);
    this.input.on('wheel', (_p: unknown, _over: unknown, _dx: number, dy: number) => {
      if (this.langMenu.length) return;
      this.velocity = 0;
      this.setScroll(this.scroll + dy * dpr());
    });
  }

  private onKey(e: KeyboardEvent): void {
    if (e.key === 'Escape') {
      if (this.langMenu.length) this.closeLangMenu();
      else this.scene.start('Menu');
      return;
    }
    if (this.langMenu.length) return this.langKey(e);
    // the sensitivity gauge focused: ← and → move its knob a notch
    if (
      this.focus.focused?.id === OptionsScene.GAUGE &&
      (e.key === 'ArrowLeft' || e.key === 'ArrowRight')
    ) {
      e.preventDefault();
      this.gaugeShift?.(e.key === 'ArrowRight' ? 1 : -1);
      return;
    }
    // arrows and Tab go from button to button (the screen follows), Enter or Space press it
    if (this.focus.key(e)) return;
    const page = this.scale.height - px(44);
    const by: Record<string, number> = {
      PageDown: page,
      PageUp: -page,
      ' ': page,
      Home: -this.contentH,
      End: this.contentH,
    };
    const d = by[e.key];
    if (d === undefined) return;
    this.velocity = 0;
    this.setScroll(this.scroll + d);
  }

  /**
   * Scrolls just enough for a focused button to be on the screen, below the band at the top (a
   * button in the band is always on it).
   */
  private reveal(b: Phaser.GameObjects.Text): void {
    if (b.scrollFactorY === 0) return;
    const margin = px(24);
    const top = b.y - b.height / 2 - margin - px(HEADER_BAND);
    const bottom = b.y + b.height / 2 + margin;
    this.velocity = 0;
    if (top < this.scroll) this.setScroll(top);
    else if (bottom > this.scroll + this.scale.height) this.setScroll(bottom - this.scale.height);
  }

  /** The language list open: arrows move along it, Enter or Space picks. */
  private langKey(e: KeyboardEvent): void {
    const action = focusKey(e);
    if (!action) return;
    e.preventDefault();
    if (action === 'activate') {
      const lang = LANGS[this.langFocus.index];
      if (lang) this.pickLang(lang);
      return;
    }
    this.langFocus.move(action === 'next' ? 1 : -1);
    this.showLangFocus();
  }

  private showLangFocus(): void {
    this.langItems.forEach((item, i) =>
      item.setBackgroundColor(i === this.langFocus.index ? COLORS.focus : 'transparent'),
    );
  }

  /** Options › Export: the save as a file the player keeps (to move it, or for safety). */
  private exportProgress(): void {
    const blob = new Blob([exportSave(app.data)], { type: 'application/octet-stream' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `puzzlecave-${new Date().toISOString().slice(0, 10)}.save`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 10_000);
    setDebug({ exported: a.download });
  }

  /**
   * A button that destroys something asks first: a first press turns it to "Sure?" (and puts back
   * another one that asked), a second one acts and puts it back. True on that second press.
   */
  private confirmed(id: string, button: Phaser.GameObjects.Text, label: string): boolean {
    const prev = this.armed;
    if (prev) prev.button.setText(prev.label).setColor(COLORS.text);
    this.armed = prev?.id === id ? null : { id, button, label };
    if (this.armed) button.setText(t('confirmReset')).setColor('#ff8080');
    setDebug({ armed: this.armed?.id ?? null });
    return !this.armed;
  }

  /** Options › Import: a file from Export replaces the progress and the settings. */
  private importProgress(): void {
    // in the page (hidden) while the file dialog is open: a detached input can be collected
    // before the browser hands it the file, and then nothing happens
    document.getElementById('import-save')?.remove();
    const input = document.createElement('input');
    input.id = 'import-save';
    input.type = 'file';
    // no file filter: mobile pickers map extensions to known types, and would grey out a .save
    // file; any other file is refused when read
    input.hidden = true;
    input.addEventListener('change', () => {
      input.remove();
      const file = input.files?.[0];
      if (file) void file.text().then((text) => this.applyImport(text));
    });
    document.body.append(input);
    input.click();
    this.imports++;
    setDebug({ importPicker: this.imports });
  }
  private imports = 0;

  /** Imports a save from its text. */
  private applyImport(text: string): void {
    let data;
    try {
      data = importSave(text, saveContext);
    } catch {
      showNotice(t('importFailed'), '#ff8080');
      return;
    }
    app.data = data;
    setLang(data.settings.lang ?? detectLang(navigator.languages ?? []));
    app.persist();
    // a file from before the achievements: what its records earn
    app.checkRecords(true);
    syncMusic(this, data.settings.sound, 'music-menu');
    showNotice(t('importDone'));
    this.rebuild();
  }

  /** Options › Erase (once confirmed). */
  private eraseProgress(): void {
    app.data.levels = {};
    app.data.achievements = {};
    app.persist();
    showNotice(t('progressReset'));
    this.rebuild();
  }

  /** Button centres on the screen, in CSS pixels (the content ones moved by the scroll). */
  private publishButtons(): void {
    const css = (x: number, y: number): [number, number] => [x / dpr(), y / dpr()];
    const buttons: Record<string, [number, number]> = {};
    for (const [id, [x, y]] of Object.entries(this.buttons)) buttons[id] = css(x, y - this.scroll);
    for (const [id, [x, y]] of Object.entries(this.menuButtons)) buttons[id] = css(x, y);
    for (const [id, [x, y]] of Object.entries(this.fixedButtons)) buttons[id] = css(x, y);
    setDebug({
      buttons,
      scrollY: this.scroll / dpr(),
      maxScrollY: maxScroll(this.contentH, this.scale.height) / dpr(),
    });
  }

  /**
   * Drop-down list of the languages, each written in its own language, under the button (or
   * above it, or moved up, so that it is entirely on the screen). It does not scroll.
   */
  private toggleLangMenu(cx: number, y: number): void {
    if (this.langMenu.length) return this.closeLangMenu();
    this.velocity = 0;
    const rowH = px(isTouchDevice() ? TOUCH_TARGET : 34);
    const width = px(180);
    const listH = rowH * LANGS.length + px(8);
    const top = dropDownTop(y - this.scroll, px(22), listH, this.scale.height, px(8));
    // dim the screen behind the list; a click outside closes it
    const backdrop = this.add
      .rectangle(0, 0, this.scale.width, this.scale.height, 0x000000, 0.6)
      .setOrigin(0)
      .setScrollFactor(0)
      .setDepth(9)
      .setInteractive();
    backdrop.on('pointerup', () => this.closeLangMenu());
    this.langMenu.push(backdrop);
    const bg = this.add
      .rectangle(cx, top, width, listH, 0x2c2838)
      .setOrigin(0.5, 0)
      .setStrokeStyle(Math.max(1, px(1)), 0xffd25e)
      .setScrollFactor(0)
      .setDepth(10);
    this.langMenu.push(bg);
    const items: Record<string, [number, number]> = {};
    LANGS.forEach((lang: Lang, i) => {
      const by = top + px(4) + rowH * i + rowH / 2;
      const current = lang === getLang();
      const item = this.add
        .text(cx, by, messages(lang).langName, textStyle(14, current ? COLORS.accent : COLORS.text))
        .setPadding(px(10), px(2), px(10), px(2))
        .setOrigin(0.5)
        .setScrollFactor(0)
        .setDepth(11);
      // the whole row answers, not only the word
      const hit = new Phaser.Geom.Rectangle(
        item.width / 2 - width / 2,
        item.height / 2 - rowH / 2,
        width,
        rowH,
      );
      item.setInteractive({
        hitArea: hit,
        hitAreaCallback: Phaser.Geom.Rectangle.Contains,
        useHandCursor: true,
      });
      item.on('pointerover', () => item.setColor(COLORS.accent));
      item.on('pointerout', () => item.setColor(current ? COLORS.accent : COLORS.text));
      item.on('pointerup', () => this.pickLang(lang));
      items[`lang-${lang}`] = [cx, by];
      this.langMenu.push(item);
      this.langItems.push(item);
    });
    // opened from the keyboard: the current language is focused
    this.langFocus = new FocusList(
      LANGS.length,
      this.focus.focused ? LANGS.indexOf(getLang()) : -1,
    );
    this.showLangFocus();
    // Phaser hit-tests these objects only once its next pre-update has taken them in, and
    // orders the hits by the last frame drawn: until then a click still lands on the screen
    // without the list. So the tests learn that the list is open once it has been drawn.
    const menu = this.langMenu;
    this.events.once(Phaser.Scenes.Events.PRE_UPDATE, () =>
      this.events.once(Phaser.Scenes.Events.RENDER, () => {
        if (this.langMenu !== menu) return;
        this.menuButtons = items;
        this.publishButtons();
        setDebug({ langMenuOpen: true });
      }),
    );
  }

  private closeLangMenu(): void {
    for (const o of this.langMenu) o.destroy();
    this.langMenu = [];
    this.langItems = [];
    this.menuButtons = {};
    this.publishButtons();
    setDebug({ langMenuOpen: false });
  }

  private pickLang(lang: Lang): void {
    app.data.settings.lang = lang;
    setLang(lang);
    app.persist();
    this.rebuild();
  }
}
