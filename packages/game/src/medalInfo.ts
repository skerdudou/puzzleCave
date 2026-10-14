// Medal thresholds shown to the player (pure, no Phaser).
import {
  isMasterUnlocked,
  masterTimeLimitMs,
  type LevelRecord,
  type Medal,
  type Thresholds,
  type Tier,
} from '@puzzlecave/core';
import { formatTime } from './format';

export type MedalKind = Medal | 'platinum';

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
 * One row per criterion that has a gold threshold: moves first, then time. With `platinum` (the
 * level's chapter has master mode), a third row for master mode, a separate achievement: the
 * platinum move limit, then master mode's time limit (the bronze time) when the level has one.
 */
export function thresholdRows(th: Thresholds, platinum = false): ThresholdRow[] {
  const rows: ThresholdRow[] = [];
  if (th.moves) rows.push(row('moves', th.moves, String));
  if (th.time) rows.push(row('time', th.time, seconds));
  if (platinum && th.platinumMoves !== undefined) {
    const limit = masterTimeLimitMs(th);
    const time = limit !== undefined ? ` · ≤ ${formatTime(limit)}` : '';
    rows.push({
      kind: 'master',
      tiers: [{ medal: 'platinum', text: `≤ ${th.platinumMoves}${time}` }],
    });
  }
  return rows;
}

/** Where the player stands in master mode on a level, for its own line under the records. */
export type MasterStatus =
  | { kind: 'none' }
  | { kind: 'locked' }
  | { kind: 'notYet' }
  | { kind: 'best'; moves: number; timeMs: number; platinum: boolean };

/** `hasMaster`: the level's chapter has master mode. */
export function masterStatus(rec: LevelRecord | undefined, hasMaster: boolean): MasterStatus {
  if (!hasMaster) return { kind: 'none' };
  if (!isMasterUnlocked(rec)) return { kind: 'locked' };
  if (rec?.masterBestMoves === undefined || rec.masterBestTimeMs === undefined)
    return { kind: 'notYet' };
  return {
    kind: 'best',
    moves: rec.masterBestMoves,
    timeMs: rec.masterBestTimeMs,
    platinum: rec.medals.platinum === true,
  };
}
