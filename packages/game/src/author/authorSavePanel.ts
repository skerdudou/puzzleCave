import Phaser from 'phaser';
import { formatMoves, type Dir } from '@puzzlecave/core';
import { t } from '../i18n';
import { COLORS, makeButton, px, textStyle } from '../ui';
import { fetchJob, fetchSolution, saveSolution, type SaveOutcome } from './client';
import { describeJob, type JobInfo } from './jobText';

/**
 * Author mode, the development server: a run saved as the level's solution, then the server's
 * optimisation of it followed (its status and detail lines, a timer), and what comes after
 * (replace a shorter solution anyway, watch the optimised one). Shown from `top` down, centred
 * on `cx`, over the scene at `depth`.
 */
export class AuthorSavePanel {
  private readonly status: Phaser.GameObjects.Text;
  private readonly detail: Phaser.GameObjects.Text;
  private extra: Phaser.GameObjects.GameObject[] = [];
  private alive = true;
  /** a newer save: an older one's answers are dropped */
  private run = 0;
  private tick = 0;

  constructor(
    private readonly scene: Phaser.Scene,
    private readonly o: {
      levelId: string;
      moves: Dir[];
      cx: number;
      top: number;
      width: number;
      depth: number;
      /** the optimised solution in the replay player */
      watch: (moves: Dir[], label: string) => void;
    },
  ) {
    const style = (size: number, color: string) => ({
      ...textStyle(size, color),
      align: 'center' as const,
      wordWrap: { width: o.width },
      backgroundColor: 'rgba(0, 0, 0, 0.7)',
      padding: { x: px(6), y: px(3) },
    });
    this.status = scene.add
      .text(o.cx, o.top, '', style(12, COLORS.text))
      .setOrigin(0.5, 0)
      .setDepth(o.depth)
      .setVisible(false);
    this.detail = scene.add
      .text(o.cx, o.top, '', style(10, COLORS.dim))
      .setOrigin(0.5, 0)
      .setDepth(o.depth)
      .setVisible(false);
    scene.events.once('shutdown', () => (this.alive = false));
  }

  /** Saves the run (`force`: even when not shorter than the saved one). */
  async save(button: Phaser.GameObjects.Text, force: boolean): Promise<void> {
    const run = ++this.run;
    this.clearExtra();
    button.disableInteractive();
    this.setStatus(t('optimizing', { dots: '' }), '', COLORS.dim);
    const outcome = await saveSolution(this.o.levelId, formatMoves(this.o.moves), force);
    if (!this.current(run)) return;
    button.setInteractive({ useHandCursor: true });
    this.afterSave(outcome, button);
  }

  private current(run: number): boolean {
    return this.alive && this.run === run;
  }

  private clearExtra(): void {
    for (const b of this.extra) b.destroy();
    this.extra = [];
  }

  /** Shows status and detail one under the other, returns the free y below. */
  private setStatus(text: string, detail = '', color: string = COLORS.text): number {
    this.status.setText(text).setColor(color).setY(this.o.top).setVisible(true);
    this.detail
      .setText(detail)
      .setY(this.o.top + this.status.height + px(2))
      .setVisible(detail !== '');
    return (
      (detail ? this.detail.y + this.detail.height : this.status.y + this.status.height) + px(8)
    );
  }

  private addButtons(y: number, items: [string, () => void][]): void {
    this.clearExtra();
    let yy = y;
    for (const [label, fn] of items) {
      const b = makeButton(this.scene, this.o.cx, yy + px(14), label, fn, 12);
      b.setDepth(this.o.depth);
      this.extra.push(b);
      yy += px(48);
    }
  }

  private afterSave(o: SaveOutcome, button: Phaser.GameObjects.Text): void {
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
        this.addButtons(y, [[t('replaceAnyway'), () => void this.save(button, true)]]);
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
      return this.setStatus(`${head}\n${d.headline}`, d.detail);
    };
    const anim = this.scene.time.addEvent({
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
      if (!this.current(run)) return anim.remove(false);
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
      if (!this.current(run)) return anim.remove(false);
    } while (!last || last.state === 'running');
    anim.remove(false);
    const d = describeJob(last, 0);
    const detail = [d.detail, last.tmxChanged ? t('tmxChanged') : ''].filter(Boolean).join('\n');
    const y = this.setStatus(
      `${head}\n${d.headline}`,
      detail,
      last.state === 'failed' ? '#ff8080' : COLORS.accent,
    );
    if (!d.improved) return;
    const sol = await fetchSolution(this.o.levelId);
    if (sol && this.current(run))
      this.addButtons(y, [
        [t('replayOptimized'), () => this.o.watch(sol.moves, t('labelOptimized'))],
      ]);
  }
}
