import type { LevelData, Mode, ThresholdOverrides } from './types';

export type Medal = 'gold' | 'silver' | 'bronze';
export interface Tier {
  gold: number;
  silver: number;
  bronze: number;
}
export interface Thresholds {
  moves?: Tier;
  time?: Tier;
  platinumTime?: number;
}
export interface RunResult {
  moves: number;
  timeMs: number;
  mode: Mode;
}
export interface Award {
  moves?: Medal;
  time?: Medal;
  platinum: boolean;
}

export const MEDAL_RANK: Record<Medal, number> = { gold: 3, silver: 2, bronze: 1 };

const centi = (x: number) => Math.round(x * 100) / 100;

export function resolveThresholds(o: ThresholdOverrides, platinum: boolean): Thresholds {
  const t: Thresholds = {};
  if (o.goldMoves !== undefined) {
    const g = o.goldMoves;
    t.moves = {
      gold: g,
      // Integer ratios (g*11/10) avoid floating-point rounding errors (200*1.1 is not exactly 220).
      silver: o.silverMoves ?? Math.max(Math.ceil((g * 11) / 10), g + 2),
      bronze: o.bronzeMoves ?? Math.max(Math.ceil((g * 5) / 4), g + 5),
    };
  }
  if (o.goldTime !== undefined) {
    const g = o.goldTime;
    t.time = {
      gold: g,
      silver: o.silverTime ?? centi(Math.max(g * 1.25, g + 3)),
      bronze: o.bronzeTime ?? centi(Math.max(g * 1.5, g + 6)),
    };
  }
  if (platinum) {
    const p = o.platinumTime ?? o.goldTime;
    if (p !== undefined) t.platinumTime = p;
  }
  return t;
}

export function medalFor(tier: Tier | undefined, value: number): Medal | undefined {
  if (!tier) return undefined;
  if (value <= tier.gold) return 'gold';
  if (value <= tier.silver) return 'silver';
  if (value <= tier.bronze) return 'bronze';
  return undefined;
}

export function award(level: LevelData, r: RunResult): Award {
  const th = resolveThresholds(level.thresholds, level.platinum);
  const seconds = r.timeMs / 1000;
  const a: Award = {
    platinum: r.mode === 'platinum' && th.platinumTime !== undefined && seconds <= th.platinumTime,
  };
  const m = medalFor(th.moves, r.moves);
  if (m) a.moves = m;
  const t = medalFor(th.time, seconds);
  if (t) a.time = t;
  return a;
}

export function bestMedal(a?: Medal, b?: Medal): Medal | undefined {
  if (!a) return b;
  if (!b) return a;
  return MEDAL_RANK[a] >= MEDAL_RANK[b] ? a : b;
}
