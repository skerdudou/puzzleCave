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
  /** platinum move limit (master mode): platinumMoves, else goldMoves */
  platinumMoves?: number;
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

export function resolveThresholds(o: ThresholdOverrides): Thresholds {
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
  const p = o.platinumMoves ?? o.goldMoves;
  if (p !== undefined) t.platinumMoves = p;
  return t;
}

export function medalFor(tier: Tier | undefined, value: number): Medal | undefined {
  if (!tier) return undefined;
  if (value <= tier.gold) return 'gold';
  if (value <= tier.silver) return 'silver';
  if (value <= tier.bronze) return 'bronze';
  return undefined;
}

/**
 * Medals of a finished run. The move and time medals do not depend on the mode (a master finish
 * within the gold limit is gold too); platinum needs master mode and at most the platinum moves.
 * `masterMode` is false for levels of a chapter without master mode: no platinum there.
 */
export function award(level: LevelData, r: RunResult, masterMode = true): Award {
  const th = resolveThresholds(level.thresholds);
  const seconds = r.timeMs / 1000;
  const a: Award = {
    platinum:
      masterMode &&
      r.mode === 'master' &&
      th.platinumMoves !== undefined &&
      r.moves <= th.platinumMoves,
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
