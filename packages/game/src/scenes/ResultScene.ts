import Phaser from 'phaser';
import {
  isLevelUnlocked,
  resolveThresholds,
  type Award,
  type Dir,
  type LevelRecord,
  type Mode,
  type RunResult,
} from '@puzzlecave/core';
import { app } from '../app';
import { setDebug } from '../debug';
import { formatTime } from '../format';
import { t, type MessageKey } from '../i18n';
import { isTouchDevice } from '../touch';
import { onSceneKeyDown } from '../input/sceneKeys';
import {
  chapters,
  hasMaster,
  levelById,
  levelTitle,
  locate,
  masterState,
  provenOptimum,
} from '../levels';
import {
  masterLineText,
  masterMedalName,
  masterStatus,
  thresholdRows,
  type ThresholdRow,
} from '../medalInfo';
import { planReveal, prefersReducedMotion, type RevealSlot } from '../medalReveal';
import { MedalReveal, type MedalSpot } from '../render/MedalReveal';
import {
  COLORS,
  drawMedal,
  MASTER_BOX,
  drawThresholdLine,
  masterBoxTitle,
  strokeMasterBox,
  KeyFocus,
  makeButton,
  sameWidth,
  px,
  shrinkToFit,
  textStyle,
} from '../ui';

export interface ResultSceneData {
  levelId: string;
  mode: Mode;
  result: RunResult;
  award: Award;
  previous?: LevelRecord;
  moveLog: Dir[];
  /** laid out again (a resize): the medals shown at once, not revealed a second time */
  instant?: boolean;
}

export class ResultScene extends Phaser.Scene {
  private info!: ResultSceneData;
  private reveal?: MedalReveal;
  constructor() {
    super('Result');
  }
  init(data: ResultSceneData): void {
    this.info = data;
  }

  create(): void {
    const { levelId, mode, result, award, previous, moveLog } = this.info;
    const level = levelById(levelId);
    // a low screen (phone in landscape): the results on the left, the buttons on the right
    const low = this.scale.width > this.scale.height && this.scale.height < px(600);
    const cx = low ? Math.max(px(170), this.scale.width * 0.4) : this.scale.width / 2;
    // the width centred on cx that is clear of the screen's edges and of the buttons' column
    const lineWidth =
      (low ? 2 * Math.min(cx, this.scale.width - px(170) - cx) : this.scale.width) - px(16);
    // the right end of the records' column
    const right = low ? this.scale.width - px(170) : this.scale.width - px(8);
    // a vertical gap of `n` base px: on a low screen, the gaps (not the texts) shrink with its
    // height, so that master mode's box stays on a phone in landscape under its browser's bars
    // (~260–340 CSS px high); 340 high and more: as they are
    const squeeze = low ? Math.min(1, this.scale.height / px(340)) : 1;
    const gap = (n: number) => Math.round(px(n) * squeeze);
    let y = low ? gap(36) : px(60);
    const title = this.add.text(cx, y, t('won'), textStyle(26, COLORS.accent)).setOrigin(0.5);
    shrinkToFit(title, 26, lineWidth, 16);
    y += gap(36);
    shrinkToFit(
      this.add.text(cx, y, levelTitle(level), textStyle(16)).setOrigin(0.5),
      16,
      lineWidth,
    );
    // the mode, "Master mode" (not "MASTER", the name of a medal too, above the medal won)
    if (mode === 'master')
      this.add.text(cx, y + gap(22), t('masterModeName'), textStyle(12, '#9be7ff')).setOrigin(0.5);
    // (a low screen: a little closer, master mode's box below has its medals on one line)
    y += low ? gap(42) : px(48);

    const g = this.add.graphics();
    const th = resolveThresholds(level.thresholds);
    const master = hasMaster(levelId);
    const rows = thresholdRows(th, master, provenOptimum(levelId));
    // each row's best medal held: this run's, or the saved one when the run did worse
    const plan = planReveal({
      award,
      previous,
      moves: result.moves,
      timeMs: result.timeMs,
      hasMovesTier: th.moves !== undefined,
      hasTimeTier: th.time !== undefined,
      masterRun: mode === 'master',
    });
    const shown = new Set(plan.steps.map((s) => s.slot));
    // the threshold lines: centred on cx, in lineWidth
    // held medals are drawn by the reveal animation, missing ones (outlines) here
    const spots: Partial<Record<RevealSlot, MedalSpot>> = {};
    const medalAt = (slot: RevealSlot, x = cx - px(130)) => {
      const spot = { x, y, r: px(10) };
      if (shown.has(slot)) spots[slot] = spot;
      else drawMedal(g, spot.x, spot.y, spot.r, undefined);
    };
    const line = (
      label: string,
      value: string,
      hasTier: boolean,
      best: string | undefined,
      isRecord: boolean,
      kind: ThresholdRow['kind'],
    ) => {
      const slot: RevealSlot = kind;
      if (hasTier) medalAt(slot);
      const valueText = this.add
        .text(cx - px(110), y, t('labelValue', { label, value }), textStyle(16))
        .setOrigin(0, 0.5);
      // the record and "New record!" on the right, moved left on a narrow phone to stay on it;
      // smaller where even then they would run into the value
      const onRight = (ty: number, text: string, size: number, color: string) => {
        const txt = this.add.text(cx + px(60), ty, text, textStyle(size, color)).setOrigin(0, 0.5);
        const from = valueText.x + valueText.width + px(8);
        if (ty === y) shrinkToFit(txt, size, right - from, 8);
        txt.setX(Math.min(txt.x, right - txt.width));
      };
      if (best) onRight(y, `${t('record')} ${best}`, 12, COLORS.dim);
      if (isRecord) onRight(y + gap(16), t('newRecord'), 10, COLORS.accent);
      const row = rows.find((r) => r.kind === kind);
      if (row) {
        drawThresholdLine(this, g, cx, y + gap(32), '', row.tiers, { maxWidth: lineWidth });
        y += gap(18);
      }
      y += gap(40);
    };
    line(
      t('moves'),
      String(result.moves),
      th.moves !== undefined,
      previous?.bestMoves?.toString(),
      previous?.bestMoves === undefined || result.moves < previous.bestMoves,
      'moves',
    );
    line(
      t('time'),
      formatTime(result.timeMs),
      th.time !== undefined,
      previous?.bestTimeMs !== undefined ? formatTime(previous.bestTimeMs) : undefined,
      previous?.bestTimeMs === undefined || result.timeMs < previous.bestTimeMs,
      'time',
    );
    // master mode, a separate achievement, on its own line: this master run (master or grand
    // master medal), or after a normal run where the player stands in master mode
    if (master && th.grandMasterMoves !== undefined) {
      const ms = masterStatus(app.data.levels[levelId], true, app.masterOpen);
      let text: string;
      if (mode !== 'master' && ms.kind === 'locked') {
        // master mode still locked: how to unlock it, in place of its box
        text = t('masterLocked');
        this.add
          .text(cx, y, `🔒 ${text}`, {
            ...textStyle(11, COLORS.dim),
            align: 'center',
            wordWrap: { width: lineWidth - px(16) },
          })
          .setOrigin(0.5);
        y += px(40);
      } else {
        // master mode's box: its rules, one line per medal ("Master ≤ 610 moves", then "Grand
        // master ≤ 538 moves"), then this master run or where the player stands in master mode
        const boxW = Math.min(lineWidth, px(340));
        const top = y - px(12);
        const rulesBottom = masterBoxTitle(
          this,
          cx,
          top,
          boxW,
          t('masterModeName'),
          t(th.time ? 'masterRules' : 'masterRulesUntimed'),
        );
        const line = px(MASTER_BOX.line);
        let ly = rulesBottom + px(4) + line / 2;
        const row = rows.find((r) => r.kind === 'master');
        // one line a medal, named; a low screen (no height to spare): all on one line, the
        // marks saying which
        const tiers = row?.tiers ?? [];
        for (const lineTiers of low ? [tiers] : tiers.map((tier) => [tier])) {
          drawThresholdLine(this, g, cx, ly, '', lineTiers, {
            maxWidth: boxW - 2 * px(MASTER_BOX.pad),
            named: low ? undefined : masterMedalName,
          });
          ly += line;
        }
        y = ly + px(10);
        // the medal and its line as the other rows', but inside the box on a narrow screen
        const medalX = Math.max(cx - px(130), cx - boxW / 2 + px(MASTER_BOX.pad + 16));
        const textX = medalX + px(20);
        if (mode === 'master') {
          // this run: moves · time, under the name of its medal (revealed with the others), or
          // of the mode without a medal ("Master mode", not "Master", the first medal's name);
          // its "New!" stays in the box
          medalAt('master', medalX);
          const spot = spots.master;
          if (spot) spot.minX = cx - boxW / 2 + px(MASTER_BOX.pad);
          text = t('labelValue', {
            label: award.master ? masterMedalName(award.master) : t('masterModeName'),
            value: `${result.moves} · ${formatTime(result.timeMs)}`,
          });
        } else {
          // a normal run: the master record (its medal, if any), as the other records
          drawMedal(g, medalX, y, px(10), ms.kind === 'best' ? ms.medal : undefined);
          text = masterLineText(ms);
        }
        const runText = this.add
          .text(textX, y, text, {
            ...(mode === 'master' ? textStyle(14, COLORS.master) : textStyle(12, COLORS.dim)),
            wordWrap: { width: Math.min(px(250), cx + boxW / 2 - textX - px(8)) },
          })
          .setOrigin(0, 0.5);
        const bottom = Math.max(y + px(12), runText.getBounds().bottom) + px(MASTER_BOX.pad);
        strokeMasterBox(g, cx, top, boxW, bottom);
        y = bottom + px(28);
      }
      setDebug({ resultMasterLine: text });
    }

    const next = this.nextLevel(levelId);
    const replay = () => this.scene.start('Game', { levelId, mode });
    const goNext = () => next && this.scene.start('Game', { levelId: next, mode: 'normal' });
    const menu = () => this.scene.start('Select', { levelId });
    // master mode, as on the select screen (chapter with master mode, gold held), right from the
    // result; after a master run Replay already starts it again, so the button would duplicate it
    const masterBtn =
      mode !== 'master' &&
      masterState(levelId, app.data.levels[levelId], app.masterOpen) === 'open';
    const playMaster = () => this.scene.start('Game', { levelId, mode: 'master' });
    // the run just played, in the replay player (with Save and Export); Escape comes back here
    const watch = () =>
      this.scene.start('Replay', {
        levelId,
        moves: moveLog,
        mode,
        label: t('labelMine'),
        saving: 'unsaved',
        back: { scene: 'Result', data: { ...this.info, instant: true } },
        // author mode: the run's tools (its Tiled properties, saved as the level's solution)
        ...(app.author && { authorRun: { timeMs: result.timeMs } }),
      });
    setDebug({ resultMasterButton: masterBtn });
    // the buttons in reading order: Replay, Master (when open), Watch, then Menu, Next (when there is
    // one); all of one size and one width. The keyboard goes from one to the next (arrows, Tab)
    // and presses the focused one (Enter, Space); unfocused, the keys of the help line act.
    type Item = { id: string; label: string; press: () => void; key: MessageKey };
    const first: Item[] = [
      { id: 'replay', label: t('replay'), press: replay, key: 'resultKeyReplay' },
    ];
    if (masterBtn)
      first.push({ id: 'master', label: t('master'), press: playMaster, key: 'resultKeyMaster' });
    const second: Item[] = [{ id: 'menu', label: t('menu'), press: menu, key: 'resultKeyMenu' }];
    if (next) second.push({ id: 'next', label: t('next'), press: goNext, key: 'resultKeyNext' });
    first.push({ id: 'watch', label: t('watchReplay'), press: watch, key: 'resultKeyWatch' });
    const items = [...first, ...second];
    const made = new Map<string, Phaser.GameObjects.Text>();
    const make = (item: Item, x: number, by: number) =>
      made.set(item.id, makeButton(this, x, by, item.label, item.press));
    if (low) {
      // a column on the right, in the same order
      const bx = this.scale.width - px(100);
      const gap = px(48);
      let by = this.scale.height / 2 - ((items.length - 1) * gap) / 2;
      for (const item of items) {
        make(item, bx, by);
        by += gap;
      }
      y = Math.max(y, by - gap);
    } else {
      // two rows of buttons, centred: two side by side at +-80 as before, three when the screen
      // is wide enough; a row that does not fit wraps (a phone in portrait: Watch on its own row)
      for (const item of items) make(item, cx, y);
      sameWidth([...made.values()]);
      const buttonW = made.get('replay')!.width;
      const step = Math.max(px(160), buttonW + px(8));
      const perRow = Math.max(1, Math.floor((this.scale.width - px(16) - buttonW) / step) + 1);
      y += px(16);
      for (const rowItems of [first, second]) {
        for (let from = 0; from < rowItems.length; from += perRow) {
          const row = rowItems.slice(from, from + perRow);
          row.forEach((item, i) =>
            made.get(item.id)!.setPosition(cx + (i - (row.length - 1) / 2) * step, y),
          );
          y += px(52);
        }
      }
      y -= px(52);
    }
    if (low) sameWidth([...made.values()]);
    const focus = new KeyFocus(
      items.map((item) => ({ id: item.id, button: made.get(item.id)!, press: item.press })),
    );
    // the keys, under everything (not on a touch screen)
    if (!isTouchDevice())
      this.add
        .text(cx, this.scale.height - px(14), items.map((item) => t(item.key)).join(' · '), {
          ...textStyle(11, COLORS.dim),
          align: 'center',
          wordWrap: { width: this.scale.width - px(32) },
        })
        .setOrigin(0.5, 1);

    setDebug({
      resultAnimDone: false,
      resultReveal: plan.steps.map((s) => `${s.slot}:${s.medal}:${s.emphasis}`),
    });
    const animate = !prefersReducedMotion() && !this.info.instant;
    this.reveal = new MedalReveal(this, plan, spots, animate, (r) =>
      setDebug({ resultAnimDone: true, resultMedalScales: r.scales() }),
    );
    // any key or click shows the final state at once; buttons and keys still work right away
    this.input.on('pointerdown', () => this.reveal?.finish());

    onSceneKeyDown(this, (e) => {
      this.reveal?.finish();
      // a focused button first (arrows, Tab, Enter on it)
      if (focus.key(e)) return;
      if (e.key === 'Enter' && next) this.scene.start('Game', { levelId: next, mode: 'normal' });
      else if (e.key.toLowerCase() === 'r') this.scene.start('Game', { levelId, mode });
      else if (e.key.toLowerCase() === 'p' && masterBtn) playMaster();
      else if (e.key.toLowerCase() === 'v') watch();
      else if (e.key === 'Escape') this.scene.start('Select', { levelId });
    });
    // the layout (and the interface's size) follows the screen
    const onResize = () => this.scene.restart({ ...this.info, instant: true });
    this.scale.on('resize', onResize);
    this.events.once('shutdown', () => this.scale.off('resize', onResize));
    setDebug({ scene: 'Result' });
  }

  private nextLevel(id: string): string | undefined {
    const pos = locate(id);
    if (!pos) return undefined;
    const ch = chapters[pos.chapterIndex]!;
    if (pos.levelIndex + 1 < ch.levels.length) return ch.levels[pos.levelIndex + 1];
    const nextCi = pos.chapterIndex + 1;
    if (
      chapters[nextCi] &&
      (app.author || isLevelUnlocked(chapters, nextCi, 0, app.data.levels, app.allChaptersOpen))
    ) {
      return chapters[nextCi]!.levels[0];
    }
    return undefined;
  }
}
