// Medal thresholds shown to the player (pure, no Phaser).
import type { Medal, Thresholds, Tier } from '@puzzlecave/core';
import { formatTime } from './format';

export interface ThresholdRow {
  kind: 'moves' | 'time';
  tiers: { medal: Medal; text: string }[];
}

const MEDALS: readonly Medal[] = ['gold', 'silver', 'bronze'];
const seconds = (s: number) => formatTime(Math.round(s * 1000));

function row(kind: ThresholdRow['kind'], tier: Tier, fmt: (v: number) => string): ThresholdRow {
  return { kind, tiers: MEDALS.map((medal) => ({ medal, text: `≤ ${fmt(tier[medal])}` })) };
}

/** One row per criterion that has a gold threshold: moves first, then time. */
export function thresholdRows(th: Thresholds): ThresholdRow[] {
  const rows: ThresholdRow[] = [];
  if (th.moves) rows.push(row('moves', th.moves, String));
  if (th.time) rows.push(row('time', th.time, seconds));
  return rows;
}

/** Time limit of the platinum challenge, if the level has one. */
export function platinumText(th: Thresholds): string | undefined {
  return th.platinumTime === undefined ? undefined : `≤ ${seconds(th.platinumTime)}`;
}
