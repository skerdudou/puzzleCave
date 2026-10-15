import type { LevelData, Mode, ThresholdOverrides } from './types';

export type Medal = 'gold' | 'silver' | 'bronze';
/**
 * Master mode's two medals: master (within goldMoves) and grand master (within platinumMoves and
 * the silver time).
 */
export type MasterMedal = 'master' | 'grandMaster';
export interface Tier {
  gold: number;
  silver: number;
  bronze: number;
}
export interface Thresholds {
  moves?: Tier;
  time?: Tier;
  /** master medal move limit (master mode): goldMoves */
  masterMoves?: number;
  /** grand master medal move limit (master mode): platinumMoves, else goldMoves */
  grandMasterMoves?: number;
}
export interface RunResult {
  moves: number;
  timeMs: number;
  mode: Mode;
}
export interface Award {
  moves?: Medal;
  time?: Medal;
  /** master mode's medal (grand master implies master) */
  master?: MasterMedal;
}

export const MEDAL_RANK: Record<Medal, number> = { gold: 3, silver: 2, bronze: 1 };
export const MASTER_RANK: Record<MasterMedal, number> = { grandMaster: 2, master: 1 };

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
  if (o.goldMoves !== undefined) {
    t.masterMoves = o.goldMoves;
    t.grandMasterMoves = o.platinumMoves ?? o.goldMoves;
  }
  return t;
}

/**
 * Master mode's time limit, in ms: the bronze time (a run still playing past it has failed).
 * None for a level without goldTime.
 */
export function masterTimeLimitMs(th: Thresholds): number | undefined {
  return th.time ? Math.round(th.time.bronze * 1000) : undefined;
}

export function medalFor(tier: Tier | undefined, value: number): Medal | undefined {
  if (!tier) return undefined;
  if (value <= tier.gold) return 'gold';
  if (value <= tier.silver) return 'silver';
  if (value <= tier.bronze) return 'bronze';
  return undefined;
}

/**
 * Grand master's time limit, in ms: the silver time (the same test as the silver time medal).
 * None for a level without goldTime: grand master then has no time condition.
 */
export function grandMasterTimeMs(th: Thresholds): number | undefined {
  return th.time ? Math.round(th.time.silver * 1000) : undefined;
}

/**
 * Master mode's medal for a master finish of `moves` moves in `timeMs`: grand master within the
 * grand master move limit (platinumMoves) and, on a level with time medals, within the silver
 * time; else master within the master move limit (goldMoves), whatever the time (a finished run
 * kept master mode's own limit, the bronze time). On a level without platinumMoves both move
 * limits are goldMoves: such a finish is grand master if fast enough (it implies master). An
 * unknown time (`Infinity`) is never grand master on a level with time medals.
 */
export function masterMedalFor(
  th: Thresholds,
  moves: number,
  timeMs: number,
): MasterMedal | undefined {
  const fastEnough = !th.time || timeMs / 1000 <= th.time.silver;
  if (th.grandMasterMoves !== undefined && moves <= th.grandMasterMoves && fastEnough)
    return 'grandMaster';
  if (th.masterMoves !== undefined && moves <= th.masterMoves) return 'master';
  return undefined;
}

/**
 * Medals of a finished run. The move and time medals do not depend on the mode (a master finish
 * within the gold limit is gold too); the master and grand master medals need master mode (whose
 * time limit a finished run has kept) and at most their move limits, and grand master the silver
 * time as well (`masterMedalFor`). `masterMode` is false for
 * levels of a chapter without master mode: no master medal there.
 */
export function award(level: LevelData, r: RunResult, masterMode = true): Award {
  const th = resolveThresholds(level.thresholds);
  const seconds = r.timeMs / 1000;
  const a: Award = {};
  const m = medalFor(th.moves, r.moves);
  if (m) a.moves = m;
  const t = medalFor(th.time, seconds);
  if (t) a.time = t;
  if (masterMode && r.mode === 'master') {
    const master = masterMedalFor(th, r.moves, r.timeMs);
    if (master) a.master = master;
  }
  return a;
}

export function bestMedal(a?: Medal, b?: Medal): Medal | undefined {
  if (!a) return b;
  if (!b) return a;
  return MEDAL_RANK[a] >= MEDAL_RANK[b] ? a : b;
}

export function bestMasterMedal(a?: MasterMedal, b?: MasterMedal): MasterMedal | undefined {
  if (!a) return b;
  if (!b) return a;
  return MASTER_RANK[a] >= MASTER_RANK[b] ? a : b;
}
