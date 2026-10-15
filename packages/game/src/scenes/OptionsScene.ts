import Phaser from 'phaser';
import { app } from '../app';
import { setDebug } from '../debug';
import { LANGS, detectLang, getLang, messages, setLang, t, type Lang } from '../i18n';
import { canVibrate, vibrate } from '../haptics';
import { shiftDragStep } from '../input/drag';
import { FocusList, focusKey } from '../input/focusList';
import { showNotice } from '../notice';
import { exportSave, parseSave } from '../save';
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
  KeyFocus,
  TOUCH_TARGET,
  dpr,
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
  /** Erase was pressed once: the next press erases the progress */
  private eraseArmed = false;

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

  /** Restarts the scene where it was (scroll and keyboard focus). */
  private rebuild(): void {
    this.scene.restart({ scroll: this.scroll, focus: this.focus?.focused?.id ?? null });
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
    this.eraseArmed = false;
    this.drag = null;
    this.dragged = false;
    this.velocity = 0;
    // touch: taller buttons (TOUCH_TARGET), so more room between a label, its control and the
    // next label
    const touch = isTouchDevice();
    const labelGap = px(touch ? TOUCH_TARGET / 2 + 6 : 16);
    const rowStep = px(touch ? TOUCH_TARGET / 2 + 26 : 44);
    let y = px(50);
    this.add.text(cx, y, t('options'), textStyle(24, COLORS.accent)).setOrigin(0.5);
    y += px(56);
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
    // buttons side by side, centred on the row
    const row = (items: [id: string, label: string, fn: () => void][]) => {
      const bs = items.map(([id, text, fn]) => button(id, 0, y, text, fn));
      const gap = px(12);
      let x = cx - (bs.reduce((w, b) => w + b.width, 0) + gap * (bs.length - 1)) / 2;
      bs.forEach((b, i) => {
        b.setX(x + b.width / 2);
        this.buttons[items[i]![0]] = [b.x, y];
        x += b.width + gap;
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

    // the music and the sound effects, one under the other
    label(t('sound'));
    const onOff = (key: 'music' | 'effects', on: boolean) =>
      t('labelValue', { label: t(key), value: on ? t('on') : t('off') });
    button('sound', cx, y, onOff('music', s.sound), () =>
      change(() => {
        s.sound = !s.sound;
        syncMusic(this, s.sound, 'music-menu');
      }),
    );
    y += px(touch ? TOUCH_TARGET + 6 : 34);
    button('sfx', cx, y, onOff('effects', s.sfx), () =>
      change(() => {
        s.sfx = !s.sfx;
        playSfx('key', s.sfx); // a sample when turned on
      }),
    );
    y += rowStep;

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
      stepper(
        'drag',
        `${s.dragStep} px`,
        () => (s.dragStep = shiftDragStep(s.dragStep, -1)),
        () => (s.dragStep = shiftDragStep(s.dragStep, 1)),
      );
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

    // the progress: kept in a file, brought back from one, or erased (pressed twice)
    label(t('progress'));
    const [, , erase] = row([
      ['export', t('exportSave'), () => this.exportProgress()],
      ['import', t('importSave'), () => this.importProgress()],
      ['erase', t('resetProgress'), () => this.eraseProgress(erase!)],
    ]);

    const back = button(
      'back',
      cx,
      y + labelGap - px(4),
      t('back'),
      () => this.scene.start('Menu'),
      16,
    );
    this.contentH = back.y + back.height / 2 + px(24);

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
    const track = h - 2 * inset;
    // the thumb runs along the track as the content runs along the viewport
    const thumb = scrollThumb(next, this.contentH, h, px(24));
    if (thumb) {
      const k = track / h;
      const w = Math.max(2, px(3));
      const x = this.scale.width - inset - w;
      this.thumb.fillStyle(0xffffff, 0.08).fillRoundedRect(x, inset, w, track, w / 2);
      this.thumb
        .fillStyle(0x8a8597, 0.9)
        .fillRoundedRect(x, inset + thumb.top * k, w, thumb.length * k, w / 2);
    }
    this.publishButtons();
  }

  private listenScroll(): void {
    const now = () => performance.now();
    this.input.on('pointerdown', (p: Phaser.Input.Pointer) => {
      this.dragged = false;
      this.velocity = 0;
      if (this.langMenu.length || !this.scrollable()) return;
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
      if (!this.dragged && !isDrag(p.x - d.x, p.y - d.y, px(8))) return;
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

  /** Scrolls just enough for a focused button to be on the screen (Back: to the very bottom). */
  private reveal(b: Phaser.GameObjects.Text): void {
    const margin = px(24);
    const top = b.y - b.height / 2 - margin;
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
    const blob = new Blob([exportSave(app.data)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `puzzlecave-${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 10_000);
    setDebug({ exported: a.download });
  }

  /** Options › Import: a file from Export replaces the progress and the settings. */
  private importProgress(): void {
    // in the page (hidden) while the file dialog is open: a detached input can be collected
    // before the browser hands it the file, and then nothing happens
    document.getElementById('import-save')?.remove();
    const input = document.createElement('input');
    input.id = 'import-save';
    input.type = 'file';
    input.accept = '.json,application/json';
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
      data = parseSave(text);
    } catch {
      showNotice(t('importFailed'), '#ff8080');
      return;
    }
    app.data = data;
    setLang(data.settings.lang ?? detectLang(navigator.languages ?? []));
    app.persist();
    syncMusic(this, data.settings.sound, 'music-menu');
    showNotice(t('importDone'));
    this.rebuild();
  }

  /** Options › Erase: a first press asks (the button turns to "Sure?"), a second one erases. */
  private eraseProgress(button: Phaser.GameObjects.Text): void {
    if (!this.eraseArmed) {
      this.eraseArmed = true;
      button.setText(t('confirmReset')).setColor('#ff8080');
      setDebug({ eraseArmed: true });
      return;
    }
    app.data.levels = {};
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
