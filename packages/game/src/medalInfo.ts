// Medal thresholds shown to the player (pure, no Phaser).
import {
  grandMasterTimeMs,
  isMasterUnlocked,
  masterTimeLimitMs,
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

function row(kind: ThresholdRow['kind'], tier: Tier, fmt: (v: number) => string): ThresholdRow {
  return { kind, tiers: MEDALS.map((medal) => ({ medal, text: `≤ ${fmt(tier[medal])}` })) };
}

/**
 * One row per criterion that has a gold threshold: moves first, then time. With `master` (the
 * level's chapter has master mode), a third row for master mode, a separate achievement: the
 * master move limit (gold), the grand master one (platinumMoves) and its time (the silver time),
 * then master mode's time limit (the bronze time), when the level has time medals: "≤ 610",
 * "≤ 538 & ≤ 1:46.25 · limit ≤ 2:07.50". Where the two move limits are equal (no platinumMoves)
 * and the level has no time medals, only grand master is shown: such a finish earns it.
 */
export function thresholdRows(th: Thresholds, master = false): ThresholdRow[] {
  const rows: ThresholdRow[] = [];
  if (th.moves) rows.push(row('moves', th.moves, String));
  if (th.time) rows.push(row('time', th.time, seconds));
  if (master && th.masterMoves !== undefined && th.grandMasterMoves !== undefined) {
    const gmTime = grandMasterTimeMs(th);
    const limit = masterTimeLimitMs(th);
    const tiers: ThresholdRow['tiers'] = [];
    if (th.masterMoves !== th.grandMasterMoves || gmTime !== undefined)
      tiers.push({ medal: 'master', text: `≤ ${th.masterMoves}` });
    let gm = `≤ ${th.grandMasterMoves}`;
    if (gmTime !== undefined) gm += ` & ≤ ${formatTime(gmTime)}`;
    if (limit !== undefined) gm += ` · ${t('masterLimit', { time: formatTime(limit) })}`;
    tiers.push({ medal: 'grandMaster', text: gm });
    rows.push({ kind: 'master', tiers });
  }
  return rows;
}

/** Where the player stands in master mode on a level, for its own line under the records. */
export type MasterStatus =
  | { kind: 'none' }
  | { kind: 'locked' }
  | { kind: 'notYet' }
  | { kind: 'best'; moves: number; timeMs: number; medal?: MasterMedal };

/** `hasMaster`: the level's chapter has master mode. */
export function masterStatus(rec: LevelRecord | undefined, hasMaster: boolean): MasterStatus {
  if (!hasMaster) return { kind: 'none' };
  if (!isMasterUnlocked(rec)) return { kind: 'locked' };
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
 * The text of master mode's line under the records: the best master run under the name of the
 * master medal held ("Grand master: 88 moves · 1:02.30"), or under the mode's name when no medal
 * is held ("Master mode: …", never the bare mode name, which is also the first medal's). The
 * moves and the time are separate minima, maybe of different runs: the name is the medal saved,
 * never one worked out from them. "Master mode: not finished yet", or empty (locked, none).
 */
export function masterLineText(ms: MasterStatus): string {
  if (ms.kind === 'best')
    return t('masterBest', {
      name: ms.medal ? masterMedalName(ms.medal) : t('masterModeName'),
      moves: ms.moves,
      time: formatTime(ms.timeMs),
    });
  return ms.kind === 'notYet' ? t('masterNotYet') : '';
}
