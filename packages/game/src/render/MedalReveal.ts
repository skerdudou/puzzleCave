// Result screen: earned medals pop in one after another, with a glint and sparkles (stronger for
// a new medal or a record, rings for master mode's medals). Any key or click jumps to the final
// state.
import Phaser from 'phaser';
import { t } from '../i18n';
import type { MedalKind } from '../medalInfo';
import { REVEAL, type RevealPlan, type RevealSlot, type RevealStep } from '../medalReveal';
import { MEDAL_COLORS, paintMedal, px, textStyle } from '../ui';

export interface MedalSpot {
  x: number;
  y: number;
  r: number;
}

const WHITE = 0xffffff;
/** "New!" in master mode's medals' colours (gold for the others) */
const TAG_COLORS: Partial<Record<MedalKind, string>> = {
  master: '#c9b3ff',
  grandMaster: '#9be7ff',
};

export class MedalReveal {
  private readonly tweens: Phaser.Tweens.Tween[] = [];
  /** sparkles, glints and rings: gone in the final state */
  private readonly transient: Phaser.GameObjects.GameObject[] = [];
  private readonly finals: (Phaser.GameObjects.Graphics | Phaser.GameObjects.Text)[] = [];
  private timer?: Phaser.Time.TimerEvent;
  done = false;

  constructor(
    private readonly scene: Phaser.Scene,
    private readonly plan: RevealPlan,
    spots: Partial<Record<RevealSlot, MedalSpot>>,
    animate: boolean,
    private readonly onDone: (reveal: MedalReveal) => void,
  ) {
    for (const step of plan.steps) {
      const spot = spots[step.slot];
      if (spot) this.medal(step, spot, animate);
    }
    if (animate && plan.steps.length) {
      this.timer = scene.time.delayedCall(plan.totalMs, () => this.finish());
    } else this.finish();
  }

  /** Jumps to the final state (idempotent). */
  finish(): void {
    if (this.done) return;
    this.done = true;
    this.timer?.remove(false);
    for (const tw of this.tweens) tw.remove();
    this.tweens.length = 0;
    for (const o of this.transient) o.destroy();
    this.transient.length = 0;
    for (const o of this.finals) o.setScale(1).setAlpha(1);
    this.onDone(this);
  }

  /** Scale of each medal and tag (1 once finished), for the e2e tests. */
  scales(): number[] {
    return this.finals.map((o) => o.scale);
  }

  private medal(step: RevealStep, spot: MedalSpot, animate: boolean): void {
    const s = this.scene;
    const color = MEDAL_COLORS[step.medal];
    const m = s.add.graphics({ x: spot.x, y: spot.y });
    paintMedal(m, 0, 0, spot.r, step.medal);
    this.finals.push(m);
    const tag = step.emphasis === 'new' ? this.newTag(step, spot) : undefined;
    if (tag) this.finals.push(tag);
    if (!animate) return;

    const strong = step.emphasis !== 'owned';
    m.setScale(0);
    this.tween({
      targets: m,
      scale: 1,
      delay: step.delayMs,
      duration: REVEAL.popMs,
      ease: 'Back.easeOut',
      easeParams: [strong ? 2.4 : 1.2],
    });
    const fx = step.delayMs + REVEAL.popMs * 0.5;
    this.glint(spot, fx, strong);
    if (step.medal === 'grandMaster') {
      this.ring(spot, fx, color, 0);
      this.ring(spot, fx, WHITE, 120);
      this.sparkles(spot, fx, [color, WHITE], 10, 3.2);
    } else if (step.medal === 'master' && strong) {
      // lighter than grand master: one ring, fewer sparkles
      this.ring(spot, fx, color, 0);
      this.sparkles(spot, fx, [color, WHITE], 8, 2.8);
    } else if (step.emphasis === 'new') this.sparkles(spot, fx, [color, WHITE], 8, 2.8);
    else if (step.emphasis === 'record') this.sparkles(spot, fx, [color], 5, 2.2);
    if (tag) {
      tag.setScale(0);
      this.tween({
        targets: tag,
        scale: 1,
        delay: step.delayMs + REVEAL.popMs * 0.6,
        duration: 220,
        ease: 'Back.easeOut',
      });
    }
  }

  /** "New!" left of the medal, or above it when the screen is too narrow. */
  private newTag(step: RevealStep, spot: MedalSpot): Phaser.GameObjects.Text {
    const color = TAG_COLORS[step.medal] ?? '#ffd25e';
    const tag = this.scene.add.text(0, 0, t('newMedal'), textStyle(10, color));
    const gap = px(6);
    if (spot.x - spot.r - gap - tag.width >= px(4))
      tag.setOrigin(1, 0.5).setPosition(spot.x - spot.r - gap, spot.y);
    else tag.setOrigin(0.5, 1).setPosition(spot.x, spot.y - spot.r - px(2));
    return tag;
  }

  /** A pixel four-point star crossing the medal's upper right edge, turning as it fades. */
  private glint(spot: MedalSpot, delay: number, strong: boolean): void {
    const u = Math.max(1, px(1));
    const len = Math.round(spot.r * (strong ? 0.9 : 0.6));
    const g = this.scene.add.graphics({ x: spot.x + spot.r * 0.55, y: spot.y - spot.r * 0.55 });
    g.fillStyle(WHITE, 1)
      .fillRect(-len, -u, 2 * len, 2 * u)
      .fillRect(-u, -len, 2 * u, 2 * len)
      .fillRect(-2 * u, -2 * u, 4 * u, 4 * u);
    g.setScale(0).setAngle(0);
    this.transient.push(g);
    this.tween({
      targets: g,
      scale: { from: 0, to: 1 },
      angle: 90,
      delay,
      duration: (REVEAL.effectMs - REVEAL.popMs * 0.5 - 40) / 2,
      yoyo: true,
      hold: 40,
      ease: 'Sine.easeInOut',
    });
  }

  /** Small square sparkles flying out of the medal and fading. */
  private sparkles(
    spot: MedalSpot,
    delay: number,
    colors: number[],
    count: number,
    reach: number,
  ): void {
    const size = Math.max(3, px(3));
    for (let k = 0; k < count; k++) {
      const a = (k / count) * Math.PI * 2 + (k % 2 ? 0.3 : 0);
      const dist = spot.r * reach * (k % 2 ? 0.8 : 1);
      const p = this.scene.add.rectangle(spot.x, spot.y, size, size, colors[k % colors.length]!);
      p.setAlpha(0);
      this.transient.push(p);
      this.tween({
        targets: p,
        x: spot.x + Math.cos(a) * dist,
        y: spot.y + Math.sin(a) * dist,
        alpha: { from: 1, to: 0 },
        delay,
        duration: REVEAL.effectMs - REVEAL.popMs * 0.5,
        ease: 'Cubic.easeOut',
      });
    }
  }

  /** A light ring growing around the medal (master mode's medals). */
  private ring(spot: MedalSpot, delay: number, color: number, lag: number): void {
    const g = this.scene.add.graphics({ x: spot.x, y: spot.y });
    g.lineStyle(Math.max(1, px(2)), color, 1).strokeCircle(0, 0, spot.r);
    g.setAlpha(0);
    this.transient.push(g);
    this.tween({
      targets: g,
      scale: { from: 1, to: 2.6 },
      alpha: { from: 0.9, to: 0 },
      delay: delay + lag,
      duration: REVEAL.effectMs - REVEAL.popMs * 0.5 - lag,
      ease: 'Quad.easeOut',
    });
  }

  private tween(config: Phaser.Types.Tweens.TweenBuilderConfig): void {
    this.tweens.push(this.scene.tweens.add(config));
  }
}
