// Medal reveal on the result screen: which medals appear, in which order, and how strongly
// (pure, no Phaser).
import {
  MASTER_RANK,
  MEDAL_RANK,
  type Award,
  type LevelRecord,
  type Medal,
} from '@puzzlecave/core';
import type { MedalKind } from './medalInfo';

export type RevealSlot = 'moves' | 'time' | 'master';
/** new: medal not owned before (or an upgrade); record: owned, but a better score; owned: neither */
export type Emphasis = 'new' | 'record' | 'owned';

export interface RevealStep {
  slot: RevealSlot;
  medal: MedalKind;
  emphasis: Emphasis;
  /** start of the pop-in, in ms after the screen appears */
  delayMs: number;
}

export interface RevealPlan {
  steps: RevealStep[];
  /** when the last effect has finished (0 without any medal) */
  totalMs: number;
}

export const REVEAL = {
  /** pause before the first medal */
  leadMs: 200,
  /** between two medals */
  staggerMs: 200,
  /** extra pause before master mode's medal, which comes last */
  masterGapMs: 150,
  popMs: 320,
  /** sparkles/burst after the pop starts */
  effectMs: 520,
} as const;

export interface RevealInput {
  award: Award;
  previous?: LevelRecord;
  /** the run's moves and time, to tell a new record */
  moves: number;
  timeMs: number;
  /** which rows have medals on this level (a level without a time limit has no time medal) */
  hasMovesTier: boolean;
  hasTimeTier: boolean;
}

const isUpgrade = (now: Medal, before: Medal | undefined) =>
  before === undefined || MEDAL_RANK[now] > MEDAL_RANK[before];

/**
 * Earned move and time medals from the lowest to the highest (bronze, silver, gold; moves first
 * when equal), then master mode's medal (master or grand master). A medal that was not owned, or
 * better than the owned one, is 'new'; an owned medal with a better score than the saved record
 * (the master record for master mode's medal) is 'record'.
 */
export function planReveal(i: RevealInput): RevealPlan {
  const p = i.previous;
  const earned: Omit<RevealStep, 'delayMs'>[] = [];
  const add = (slot: 'moves' | 'time', medal: Medal | undefined, better: boolean) => {
    if (!medal) return;
    const before = p?.medals[slot];
    const emphasis: Emphasis = isUpgrade(medal, before) ? 'new' : better ? 'record' : 'owned';
    earned.push({ slot, medal, emphasis });
  };
  if (i.hasMovesTier)
    add('moves', i.award.moves, p?.bestMoves !== undefined && i.moves < p.bestMoves);
  if (i.hasTimeTier)
    add('time', i.award.time, p?.bestTimeMs !== undefined && i.timeMs < p.bestTimeMs);
  earned.sort((a, b) => MEDAL_RANK[a.medal as Medal] - MEDAL_RANK[b.medal as Medal]);

  const steps: RevealStep[] = earned.map((s, k) => ({
    ...s,
    delayMs: REVEAL.leadMs + k * REVEAL.staggerMs,
  }));
  const master = i.award.master;
  if (master) {
    const before = p?.medals.master;
    const better = p?.masterBestMoves !== undefined && i.moves < p.masterBestMoves;
    steps.push({
      slot: 'master',
      medal: master,
      emphasis:
        before === undefined || MASTER_RANK[master] > MASTER_RANK[before]
          ? 'new'
          : better
            ? 'record'
            : 'owned',
      delayMs: REVEAL.leadMs + earned.length * REVEAL.staggerMs + REVEAL.masterGapMs,
    });
  }
  const last = steps.at(-1);
  return { steps, totalMs: last ? last.delayMs + REVEAL.effectMs : 0 };
}

/** The browser asks for less motion (accessibility setting). */
export function prefersReducedMotion(): boolean {
  return (
    typeof window !== 'undefined' &&
    typeof window.matchMedia === 'function' &&
    window.matchMedia('(prefers-reduced-motion: reduce)').matches
  );
}
