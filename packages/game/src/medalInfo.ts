// Medal thresholds shown to the player (pure, no Phaser).
import type { Medal, Thresholds, Tier } from '@puzzlecave/core';
import { formatTime } from './format';

export type MedalKind = Medal | 'platinum';

export interface ThresholdRow {
  kind: 'moves' | 'time';
  tiers: { medal: MedalKind; text: string }[];
}

const MEDALS: readonly Medal[] = ['gold', 'silver', 'bronze'];
const seconds = (s: number) => formatTime(Math.round(s * 1000));

function row(kind: ThresholdRow['kind'], tier: Tier, fmt: (v: number) => string): ThresholdRow {
  return { kind, tiers: MEDALS.map((medal) => ({ medal, text: `≤ ${fmt(tier[medal])}` })) };
}

/**
 * One row per criterion that has a gold threshold: moves first, then time. With `platinum` (the
 * level's chapter has master mode), the moves row starts with the platinum limit.
 */
export function thresholdRows(th: Thresholds, platinum = false): ThresholdRow[] {
  const rows: ThresholdRow[] = [];
  if (th.moves) {
    const moves = row('moves', th.moves, String);
    if (platinum && th.platinumMoves !== undefined)
      moves.tiers.unshift({ medal: 'platinum', text: `≤ ${th.platinumMoves}` });
    rows.push(moves);
  }
  if (th.time) rows.push(row('time', th.time, seconds));
  return rows;
}
