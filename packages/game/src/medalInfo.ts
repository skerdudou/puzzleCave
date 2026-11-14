// Medal thresholds shown to the player (pure, no Phaser).
import {
  isMasterUnlocked,
  type LevelRecord,
  type MasterMedal,
  type Medal,
  type Thresholds,
  type Tier,
} from '@puzzlecave/core';
import { formatTime } from './format';
import { t } from './i18n';

export type MedalKind = Medal | MasterMedal;

/** The name of master mode's medals ("Master", "Grand master"); empty for the others. */
export function masterMedalName(medal: MedalKind): string {
  return medal === 'master' ? t('masterMedal') : medal === 'grandMaster' ? t('grandMaster') : '';
}

export interface ThresholdRow {
  kind: 'moves' | 'time' | 'master';
  tiers: { medal: MedalKind; text: string }[];
}

const MEDALS: readonly Medal[] = ['gold', 'silver', 'bronze'];
const seconds = (s: number) => formatTime(Math.round(s * 1000));

/** `exact`: the value no run can beat (a proven optimum), "=" instead of "≤". */
function row(
  kind: ThresholdRow['kind'],
  tier: Tier,
  fmt: (v: number) => string,
  exact?: number,
): ThresholdRow {
  return {
    kind,
    tiers: MEDALS.map((medal) => ({
      medal,
      text: `${tier[medal] === exact ? '=' : '≤'} ${fmt(tier[medal])}`,
    })),
  };
}

/**
 * One row per criterion that has a gold threshold: moves first, then time. With `master` (the
 * level's chapter has master mode), a third row for master mode, a separate achievement drawn in
 * its own box (whose title gives the rules, the time limit among them): the master move limit
 * (gold), then the grand master move limit (platinumMoves), "≤ 610 moves", "≤ 538 moves". Where
 * the two are equal (no platinumMoves) only grand master is shown: such a finish earns it. A
 * move limit equal to the level's proven optimum (`optimum`: nobody does fewer) reads "=": the
 * gold of an easy level ("= 26"), its grand master ("= 401 moves").
 */
export function thresholdRows(th: Thresholds, master = false, optimum?: number): ThresholdRow[] {
  const rows: ThresholdRow[] = [];
  if (th.moves) rows.push(row('moves', th.moves, String, optimum));
  if (th.time) rows.push(row('time', th.time, seconds));
  if (master && th.masterMoves !== undefined && th.grandMasterMoves !== undefined) {
    const tiers: ThresholdRow['tiers'] = [];
    const text = (moves: number) =>
      t(moves === optimum ? 'masterMovesExact' : 'masterMovesLimit', { moves });
    if (th.masterMoves !== th.grandMasterMoves)
      tiers.push({ medal: 'master', text: text(th.masterMoves) });
    tiers.push({ medal: 'grandMaster', text: text(th.grandMasterMoves) });
    rows.push({ kind: 'master', tiers });
  }
  return rows;
}

/** The lines `rows` take on screen: one per row, but master mode's row has one per medal. */
export function thresholdLines(rows: readonly ThresholdRow[]): number {
  return rows.reduce((n, r) => n + (r.kind === 'master' ? r.tiers.length : 1), 0);
}

/** Where the player stands in master mode on a level, for its own line under the records. */
export type MasterStatus =
  | { kind: 'none' }
  | { kind: 'locked' }
  | { kind: 'notYet' }
  | { kind: 'best'; moves: number; timeMs: number; medal?: MasterMedal };

/**
 * `hasMaster`: the level's chapter has master mode; `open`: never locked (app.masterOpen: author
 * mode).
 */
export function masterStatus(
  rec: LevelRecord | undefined,
  hasMaster: boolean,
  open = false,
): MasterStatus {
  if (!hasMaster) return { kind: 'none' };
  if (!open && !isMasterUnlocked(rec)) return { kind: 'locked' };
  if (rec?.masterBestMoves === undefined || rec.masterBestTimeMs === undefined)
    return { kind: 'notYet' };
  const best: MasterStatus = {
    kind: 'best',
    moves: rec.masterBestMoves,
    timeMs: rec.masterBestTimeMs,
  };
  if (rec.medals.master) best.medal = rec.medals.master;
  return best;
}

/**
 * The text of master mode's record, at the bottom of its box (whose title names the mode): as the
 * record over all runs, "Best: 88 moves · 1:02.30" (the moves and the time are separate minima,
 * maybe of different runs; the medal held is drawn beside it), "Not finished yet", or empty
 * (locked, none).
 */
export function masterLineText(ms: MasterStatus): string {
  if (ms.kind === 'best') return t('recordLine', { moves: ms.moves, time: formatTime(ms.timeMs) });
  return ms.kind === 'notYet' ? t('masterNotYet') : '';
}
