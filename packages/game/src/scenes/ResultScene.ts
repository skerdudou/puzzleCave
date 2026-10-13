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
import { chapters, hasMaster, levelById, locate } from '../levels';
import { thresholdRows, type ThresholdRow } from '../medalInfo';
import { COLORS, drawMedal, drawThresholdLine, makeButton, px, textStyle } from '../ui';
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
}

export class ResultScene extends Phaser.Scene {
  private info!: ResultSceneData;
  private authorY = 0;
  private status?: Phaser.GameObjects.Text;
  private detail?: Phaser.GameObjects.Text;
  private extra: Phaser.GameObjects.GameObject[] = [];
  private alive = false;
  private tick = 0;
  constructor() {
    super('Result');
  }
  init(data: ResultSceneData): void {
    this.info = data;
    this.extra = [];
    this.alive = true;
  }
  create(): void {
    const { levelId, mode, result, award, previous, moveLog } = this.info;
    const level = levelById(levelId);
    const cx = this.scale.width / 2;
    let y = px(60);
    this.add.text(cx, y, t('won'), textStyle(26, COLORS.accent)).setOrigin(0.5);
    y += px(36);
    this.add.text(cx, y, level.name, textStyle(16)).setOrigin(0.5);
    if (mode === 'master')
      this.add.text(cx, y + px(22), t('masterMode'), textStyle(12, '#9be7ff')).setOrigin(0.5);
    y += px(48);

    const g = this.add.graphics();
    const th = resolveThresholds(level.thresholds);
    const master = hasMaster(levelId);
    const rows = thresholdRows(th, master);
    const line = (
      label: string,
      value: string,
      medal: Award['moves'],
      hasTier: boolean,
      best: string | undefined,
      isRecord: boolean,
      kind: ThresholdRow['kind'],
    ) => {
      if (hasTier) drawMedal(g, cx - px(130), y, px(10), medal);
      this.add.text(cx - px(110), y, `${label} : ${value}`, textStyle(16)).setOrigin(0, 0.5);
      if (best)
        this.add
          .text(cx + px(60), y, `${t('record')} ${best}`, textStyle(12, COLORS.dim))
          .setOrigin(0, 0.5);
      if (isRecord)
        this.add
          .text(cx + px(60), y + px(16), t('newRecord'), textStyle(11, COLORS.accent))
          .setOrigin(0, 0.5);
      const row = rows.find((r) => r.kind === kind);
      if (row) {
        drawThresholdLine(this, g, cx, y + px(32), '', row.tiers);
        y += px(18);
      }
      y += px(40);
    };
    line(
      t('moves'),
      String(result.moves),
      award.moves,
      th.moves !== undefined,
      previous?.bestMoves?.toString(),
      previous?.bestMoves === undefined || result.moves < previous.bestMoves,
      'moves',
    );
    line(
      t('time'),
      formatTime(result.timeMs),
      award.time,
      th.time !== undefined,
      previous?.bestTimeMs !== undefined ? formatTime(previous.bestTimeMs) : undefined,
      previous?.bestTimeMs === undefined || result.timeMs < previous.bestTimeMs,
      'time',
    );
    if (mode === 'master' && master && th.platinumMoves !== undefined) {
      drawMedal(g, cx - px(130), y, px(10), award.platinum ? 'platinum' : undefined);
      this.add
        .text(cx - px(110), y, `${t('platinum')} : ≤ ${th.platinumMoves}`, textStyle(14))
        .setOrigin(0, 0.5);
      y += px(40);
    }

    const next = this.nextLevel(levelId);
    y += px(16);
    makeButton(this, cx - px(80), y, t('replay'), () =>
      this.scene.start('Game', { levelId, mode }),
    );
    if (next)
      makeButton(this, cx + px(80), y, t('next'), () =>
        this.scene.start('Game', { levelId: next, mode: 'normal' }),
      );
    y += px(44);
    makeButton(this, cx, y, t('menu'), () => this.scene.start('Select', { levelId }), 13);

    if (app.author) {
      y += px(56);
      const props = `goldMoves = ${result.moves}\ngoldTime = ${(result.timeMs / 1000).toFixed(2)}`;
      const tiled = makeButton(this, cx, y, t('copyTiled'), () => void copy(props, tiled), 12);
      y += px(36);
      const sol = makeButton(
        this,
        cx,
        y,
        t('copySolution'),
        () => void copy(formatMoves(moveLog), sol),
        12,
      );
      if (authorServerAvailable()) {
        y += px(36);
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

    onSceneKeyDown(this, (e) => {
      if (e.key === 'Enter' && next) this.scene.start('Game', { levelId: next, mode: 'normal' });
      else if (e.key.toLowerCase() === 'r') this.scene.start('Game', { levelId, mode });
      else if (e.key === 'Escape') this.scene.start('Select', { levelId });
    });
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
      yy += px(34);
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
    this.clearExtra();
    button.disableInteractive();
    this.setStatus(t('optimizing', { dots: '' }), '', COLORS.dim);
    const outcome = await saveSolution(levelId, formatMoves(moveLog), force);
    if (!this.alive) return;
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
      if (!this.alive) return;
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
      if (!this.alive) return;
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
    if (this.alive) this.addButtons(y, buttons);
  }

  private nextLevel(id: string): string | undefined {
    const pos = locate(id);
    if (!pos) return undefined;
    const ch = chapters[pos.chapterIndex]!;
    if (pos.levelIndex + 1 < ch.levels.length) return ch.levels[pos.levelIndex + 1];
    const nextCi = pos.chapterIndex + 1;
    if (chapters[nextCi] && (app.author || isLevelUnlocked(chapters, nextCi, 0, app.data.levels))) {
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
    console.log(text);
  }
}
