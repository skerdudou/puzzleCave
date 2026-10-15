// Medal thresholds shown to the player (pure, no Phaser).
import {
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
 * master move limit (gold), the grand master one (platinumMoves), then master mode's time limit
 * (the bronze time) once, when the level has one. Where the two move limits are equal (no
 * platinumMoves), only grand master is shown: such a finish earns it.
 */
export function thresholdRows(th: Thresholds, master = false): ThresholdRow[] {
  const rows: ThresholdRow[] = [];
  if (th.moves) rows.push(row('moves', th.moves, String));
  if (th.time) rows.push(row('time', th.time, seconds));
  if (master && th.masterMoves !== undefined && th.grandMasterMoves !== undefined) {
    const limit = masterTimeLimitMs(th);
    const time = limit !== undefined ? ` · ≤ ${formatTime(limit)}` : '';
    const tiers: ThresholdRow['tiers'] = [];
    if (th.masterMoves !== th.grandMasterMoves)
      tiers.push({ medal: 'master', text: `≤ ${th.masterMoves}` });
    tiers.push({ medal: 'grandMaster', text: `≤ ${th.grandMasterMoves}${time}` });
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
