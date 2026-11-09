import Phaser from 'phaser';
import {
  formatMoves,
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
import { t } from '../i18n';
import { onSceneKeyDown } from '../input/sceneKeys';
import { chapters, hasMaster, levelById, levelTitle, locate, masterState } from '../levels';
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
  makeButton,
  px,
  shrinkToFit,
  textStyle,
} from '../ui';
import {
  authorServerAvailable,
  fetchJob,
  fetchSolution,
  saveSolution,
  type SaveOutcome,
} from '../author/client';
import { describeJob, type JobInfo } from '../author/jobText';

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
  private authorY = 0;
  private status?: Phaser.GameObjects.Text;
  private detail?: Phaser.GameObjects.Text;
  private extra: Phaser.GameObjects.GameObject[] = [];
  private alive = false;
  /** this run of the scene (a resize restarts it): an older run's request is dropped */
  private run = 0;
  private tick = 0;
  private reveal?: MedalReveal;
  constructor() {
    super('Result');
  }
  init(data: ResultSceneData): void {
    this.info = data;
    this.extra = [];
    this.alive = true;
    this.run++;
  }

  /** The scene still shows the run `run` started a request in. */
  private current(run: number): boolean {
    return this.alive && this.run === run;
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
    let y = low ? px(36) : px(60);
    const title = this.add.text(cx, y, t('won'), textStyle(26, COLORS.accent)).setOrigin(0.5);
    shrinkToFit(title, 26, lineWidth, 16);
    y += px(36);
    shrinkToFit(
      this.add.text(cx, y, levelTitle(level), textStyle(16)).setOrigin(0.5),
      16,
      lineWidth,
    );
    // the mode, "Master mode" (not "MASTER", the name of a medal too, above the medal won)
    if (mode === 'master')
      this.add.text(cx, y + px(22), t('masterModeName'), textStyle(12, '#9be7ff')).setOrigin(0.5);
    y += px(48);

    const g = this.add.graphics();
    const th = resolveThresholds(level.thresholds);
    const master = hasMaster(levelId);
    const rows = thresholdRows(th, master);
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
    const medalAt = (slot: RevealSlot) => {
      const spot = { x: cx - px(130), y, r: px(10) };
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
      this.add
        .text(cx - px(110), y, t('labelValue', { label, value }), textStyle(16))
        .setOrigin(0, 0.5);
      // the record and "New record!" on the right, moved left on a narrow phone to stay on it
      const onRight = (ty: number, text: string, size: number, color: string) => {
        const txt = this.add.text(cx + px(60), ty, text, textStyle(size, color)).setOrigin(0, 0.5);
        txt.setX(Math.min(txt.x, right - txt.width));
      };
      if (best) onRight(y, `${t('record')} ${best}`, 12, COLORS.dim);
      if (isRecord) onRight(y + px(16), t('newRecord'), 10, COLORS.accent);
      const row = rows.find((r) => r.kind === kind);
      if (row) {
        drawThresholdLine(this, g, cx, y + px(32), '', row.tiers, { maxWidth: lineWidth });
        y += px(18);
      }
      y += px(40);
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
      const ms = masterStatus(app.data.levels[levelId], true);
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
        for (const tier of row?.tiers ?? []) {
          drawThresholdLine(this, g, cx, ly, '', [tier], {
            maxWidth: boxW - 2 * px(MASTER_BOX.pad),
            named: masterMedalName,
          });
          ly += line;
        }
        y = ly + px(10);
        if (mode === 'master') {
          // this run: moves · time, under the name of its medal (revealed with the others), or
          // of the mode without a medal ("Master mode", not "Master", the first medal's name);
          // its "New!" stays in the box
          medalAt('master');
          const spot = spots.master;
          if (spot) spot.minX = cx - boxW / 2 + px(MASTER_BOX.pad);
          text = t('labelValue', {
            label: award.master ? masterMedalName(award.master) : t('masterModeName'),
            value: `${result.moves} · ${formatTime(result.timeMs)}`,
          });
        } else {
          // a normal run: the master record (its medal, if any), as the other records
          drawMedal(g, cx - px(130), y, px(10), ms.kind === 'best' ? ms.medal : undefined);
          text = masterLineText(ms);
        }
        const runText = this.add
          .text(cx - px(110), y, text, {
            ...(mode === 'master' ? textStyle(14, COLORS.master) : textStyle(12, COLORS.dim)),
            wordWrap: { width: Math.min(px(250), cx + boxW / 2 - (cx - px(110)) - px(8)) },
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
      mode !== 'master' && masterState(levelId, app.data.levels[levelId]) === 'open';
    const playMaster = () => this.scene.start('Game', { levelId, mode: 'master' });
    setDebug({ resultMasterButton: masterBtn });
    if (low) {
      // the buttons in a column on the right
      const bx = this.scale.width - px(100);
      const gap = masterBtn ? px(48) : px(56);
      let by = this.scale.height / 2 - (masterBtn ? gap / 2 : 0);
      makeButton(this, bx, by - gap, t('replay'), replay);
      if (next) makeButton(this, bx, by, t('next'), goNext);
      if (masterBtn) makeButton(this, bx, (by += gap), t('master'), playMaster, 14);
      makeButton(this, bx, by + gap, t('menu'), menu, 13);
      y = Math.max(y, by + gap);
    } else {
      y += px(16);
      makeButton(this, cx - px(80), y, t('replay'), replay);
      if (next) makeButton(this, cx + px(80), y, t('next'), goNext);
      y += px(52);
      if (masterBtn) {
        // Menu and master mode share the second row
        makeButton(this, cx - px(80), y, t('master'), playMaster, 14);
        makeButton(this, cx + px(80), y, t('menu'), menu, 13);
      } else makeButton(this, cx, y, t('menu'), menu, 13);
    }

    if (app.author) {
      y += px(56);
      const props = `goldMoves = ${result.moves}\ngoldTime = ${(result.timeMs / 1000).toFixed(2)}`;
      const tiled = makeButton(this, cx, y, t('copyTiled'), () => void copy(props, tiled), 12);
      y += px(48);
      const sol = makeButton(
        this,
        cx,
        y,
        t('copySolution'),
        () => void copy(formatMoves(moveLog), sol),
        12,
      );
      if (!authorServerAvailable()) {
        // no development server (the preview of main): no saving, the run replays at once (on
        // `vite dev` it is offered after saving)
        y += px(48);
        makeButton(this, cx, y, t('replayMine'), () => this.replay(moveLog, t('labelMine')), 12);
      } else {
        y += px(48);
        const save = makeButton(
          this,
          cx,
          y,
          t('saveSolution'),
          () => void this.save(save, false),
          12,
        );
        this.authorY = y + px(30);
        this.status = this.add
          .text(cx, this.authorY, '', {
            ...textStyle(12),
            align: 'center',
            wordWrap: { width: this.scale.width - px(24) },
          })
          .setOrigin(0.5, 0);
        this.detail = this.add
          .text(cx, this.authorY, '', {
            ...textStyle(10, COLORS.dim),
            align: 'center',
            wordWrap: { width: this.scale.width - px(24) },
          })
          .setOrigin(0.5, 0);
        this.events.once('shutdown', () => (this.alive = false));
      }
    }

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
      if (e.key === 'Enter' && next) this.scene.start('Game', { levelId: next, mode: 'normal' });
      else if (e.key.toLowerCase() === 'r') this.scene.start('Game', { levelId, mode });
      else if (e.key.toLowerCase() === 'p' && masterBtn) playMaster();
      else if (e.key === 'Escape') this.scene.start('Select', { levelId });
    });
    // the layout (and the interface's size) follows the screen
    const onResize = () => this.scene.restart({ ...this.info, instant: true });
    this.scale.on('resize', onResize);
    this.events.once('shutdown', () => this.scale.off('resize', onResize));
    setDebug({ scene: 'Result' });
  }

  private clearExtra(): void {
    for (const o of this.extra) o.destroy();
    this.extra = [];
  }

  /** Shows status and detail one under the other, returns the free y below. */
  private setStatus(text: string, detail = '', color: string = COLORS.text): number {
    const status = this.status!;
    const det = this.detail!;
    status.setText(text).setColor(color).setY(this.authorY);
    det.setText(detail).setY(this.authorY + status.height + px(4));
    return det.y + (detail ? det.height : 0) + px(10);
  }

  private addButtons(y: number, items: [string, () => void][]): void {
    this.clearExtra();
    const cx = this.scale.width / 2;
    let yy = y;
    for (const [label, fn] of items) {
      const b = makeButton(this, cx, yy + px(14), label, fn, 12);
      this.extra.push(b);
      yy += px(48);
    }
  }

  private replay(moves: Dir[], label: string): void {
    this.scene.start('Replay', {
      levelId: this.info.levelId,
      moves,
      label,
      back: { scene: 'Result', data: this.info },
    });
  }

  private async save(button: Phaser.GameObjects.Text, force: boolean): Promise<void> {
    const { levelId, moveLog } = this.info;
    const run = this.run;
    this.clearExtra();
    button.disableInteractive();
    this.setStatus(t('optimizing', { dots: '' }), '', COLORS.dim);
    const outcome = await saveSolution(levelId, formatMoves(moveLog), force);
    if (!this.current(run)) return;
    button.setInteractive({ useHandCursor: true });
    this.afterSave(outcome, button);
  }

  private afterSave(o: SaveOutcome, button: Phaser.GameObjects.Text): void {
    const { moveLog } = this.info;
    const mine: [string, () => void] = [
      t('replayMine'),
      () => this.replay(moveLog, t('labelMine')),
    ];
    switch (o.kind) {
      case 'saved':
        void this.poll(o.jobId, o.moves);
        return;
      case 'not-shorter': {
        const y = this.setStatus(
          t(o.proven ? 'notShorterProven' : 'notShorter', { n: o.existing }),
          '',
          COLORS.accent,
        );
        this.addButtons(y, [[t('replaceAnyway'), () => void this.save(button, true)], mine]);
        return;
      }
      case 'not-winning':
        this.setStatus(t('notWinning'), '', '#ff8080');
        return;
      case 'job-running':
        this.setStatus(t('jobRunning'), '', COLORS.accent);
        return;
      case 'error':
        this.setStatus(t('networkError', { msg: o.message }), '', '#ff8080');
    }
  }

  /** Polls the job every second; the dots and the timer animate between two polls. */
  private async poll(jobId: string, savedMoves: number): Promise<void> {
    const run = this.run;
    const head = t('solutionSaved', { n: savedMoves });
    let last: JobInfo | null = null;
    let lastAt = performance.now();
    const show = () => {
      if (!last) return this.setStatus(head, '', COLORS.dim);
      const elapsedMs =
        last.elapsedMs + (last.state === 'running' ? performance.now() - lastAt : 0);
      const d = describeJob({ ...last, elapsedMs }, this.tick);
      return this.setStatus(
        `${head}
${d.headline}`,
        d.detail,
      );
    };
    const anim = this.time.addEvent({
      delay: 400,
      loop: true,
      callback: () => {
        this.tick++;
        show();
      },
    });
    let failures = 0;
    do {
      const j = await fetchJob(jobId);
      if (!this.current(run)) return;
      if (j) {
        last = j;
        lastAt = performance.now();
        failures = 0;
      } else if (++failures > 5) {
        anim.remove(false);
        this.setStatus(head, t('networkError', { msg: jobId }), '#ff8080');
        return;
      }
      show();
      if (last?.state === 'running' || !last) await new Promise((r) => setTimeout(r, 1000));
      if (!this.current(run)) return;
    } while (!last || last.state === 'running');
    anim.remove(false);
    const d = describeJob(last, 0);
    const detail = [d.detail, last.tmxChanged ? t('tmxChanged') : ''].filter(Boolean).join('\n');
    const y = this.setStatus(
      `${head}
${d.headline}`,
      detail,
      last.state === 'failed' ? '#ff8080' : COLORS.accent,
    );
    const { moveLog } = this.info;
    const buttons: [string, () => void][] = [
      [t('replayMine'), () => this.replay(moveLog, t('labelMine'))],
    ];
    if (d.improved) {
      const sol = await fetchSolution(this.info.levelId);
      if (sol)
        buttons.push([t('replayOptimized'), () => this.replay(sol.moves, t('labelOptimized'))]);
    }
    if (this.current(run)) this.addButtons(y, buttons);
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

async function copy(text: string, button: Phaser.GameObjects.Text): Promise<void> {
  try {
    await navigator.clipboard.writeText(text);
    button.setText(t('copied'));
  } catch {
    // clipboard refused (no focus, permission): said on the button, the text left in the console
    button.setText(t('copyFailed'));
    console.log(text);
  }
}
