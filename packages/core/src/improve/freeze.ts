import { solve } from '../solver';
import { initialState } from '../state';
import { step } from '../step';
import type { Dir, LevelData } from '../types';
import type { ExactEngine } from './engine';
import { findSolution, type FindOptions, type FindResult } from './findSolution';
import { normalizeMoves } from './macro';

/** number of pushes of each block, indexed by its origin cell (blocks tracked from cell to cell) */
export function pushCounts(level: LevelData, moves: readonly Dir[]): Map<number, number> {
  let s = initialState(level, 'normal');
  const origin = new Map<number, number>();
  s.objects.forEach((o, i) => o === 'block' && origin.set(i, i));
  const counts = new Map<number, number>();
  for (const m of moves) {
    const r = step(s, m);
    for (const e of r.events) {
      if (e.type !== 'pushed') continue;
      const from = e.from.y * level.width + e.from.x;
      const b = origin.get(from)!;
      origin.delete(from);
      origin.set(e.to.y * level.width + e.to.x, b);
      counts.set(b, (counts.get(b) ?? 0) + 1);
    }
    s = r.state;
  }
  return counts;
}

/** origin cells of the blocks pushed at least once */
export function movedBlocks(level: LevelData, moves: readonly Dir[]): Set<number> {
  return new Set(pushCounts(level, moves).keys());
}

/**
 * Restricted level: blocks whose cell is not in `keep` become walls. Exact restriction: a wall and
 * a block that is never pushed stop the player and the other blocks in the same way, so any move
 * with an effect on the restricted level has the same effect on the original (see liftSolution
 * for moves without effect).
 */
export function freezeBlocks(level: LevelData, keep: ReadonlySet<number>): LevelData {
  const terrain = level.terrain.slice();
  const objects = level.objects.filter((o) => {
    const i = o.y * level.width + o.x;
    if (o.kind !== 'block' || keep.has(i)) return true;
    terrain[i] = 'wall';
    return false;
  });
  return { ...level, terrain, objects };
}

/**
 * Solution of the restricted level brought back to the original level: moves without effect
 * removed (a move against a frozen block does nothing on the restricted level but would push it on
 * the original), then replayed on the original. null if it does not win there with the same
 * length (should not happen).
 */
export function liftSolution(
  level: LevelData,
  restricted: LevelData,
  moves: readonly Dir[],
): Dir[] | null {
  const sub = normalizeMoves(restricted, moves);
  if (sub.status !== 'won') return null;
  const orig = normalizeMoves(level, sub.moves);
  return orig.status === 'won' && orig.moves.length === sub.moves.length ? orig.moves : null;
}

export interface FreezeOptions {
  timeoutMs: number;
  now?: () => number;
  /** macro-states of each search (unlimited by default) */
  maxStates?: number | undefined;
  /** memory cap of each search (MB) */
  maxMemoryMb?: number | undefined;
  exact?: ExactEngine;
  find?: (level: LevelData, opts: FindOptions) => FindResult;
}

export interface FreezeResult {
  moves: Dir[];
  /** blocks kept pushable in the last restriction tried, out of the total */
  keptBlocks: number;
  totalBlocks: number;
  /** the exact search on this restriction finished: no shorter solution with these blocks */
  restrictedOptimal: boolean;
  /** used blocks additionally frozen by the greedy removal */
  greedyFrozen: number;
  /** restricted solutions discarded because they did not win on the original */
  rejected: number;
}

/**
 * Frozen blocks: the blocks the solution never pushes are frozen into walls, then an exact search
 * (bounded by the current length) runs on this restricted level, with half the time. If it does
 * not finish, greedy removal: each used block (least pushed first) is frozen in turn if a
 * solution remains (findSolution), then a new exact search runs on the resulting restricted
 * level. A restricted solution is only kept if it is shorter and wins on the original level. A
 * restricted optimum is not a global proof.
 */
export function freezeStage(
  level: LevelData,
  initial: readonly Dir[],
  opts: FreezeOptions,
): FreezeResult {
  const now = opts.now ?? (() => performance.now());
  const deadline = now() + opts.timeoutMs;
  const exact = opts.exact ?? solve;
  const find = opts.find ?? findSolution;
  const start = normalizeMoves(level, initial);
  if (start.status !== 'won')
    throw new Error(`the starting solution does not win (${start.status})`);
  let moves = start.moves;
  const totalBlocks = level.objects.filter((o) => o.kind === 'block').length;
  const counts = pushCounts(level, moves);
  const keep = new Set(counts.keys());
  const out = { restrictedOptimal: false, greedyFrozen: 0, rejected: 0 };
  const left = () => Math.max(0, deadline - now());
  const offer = (restricted: LevelData, cand: Dir[]) => {
    const lifted = liftSolution(level, restricted, cand);
    if (!lifted) out.rejected++;
    else if (lifted.length < moves.length) moves = lifted;
  };
  /**
   * true if the exact search finished on this restriction with a verified answer: no solution
   * there is shorter than the current one (taken into account if it was)
   */
  const exactOn = (keepSet: ReadonlySet<number>, timeoutMs: number): boolean => {
    const restricted = freezeBlocks(level, keepSet);
    const r = exact(restricted, {
      ...(opts.maxStates !== undefined ? { maxStates: opts.maxStates } : {}),
      ...(opts.maxMemoryMb !== undefined ? { maxMemoryMb: opts.maxMemoryMb } : {}),
      partialExpansion: 'auto',
      timeoutMs,
      now,
      upperBound: moves.length,
    });
    if (r.status === 'solved') {
      const rejected = out.rejected;
      offer(restricted, r.moves);
      return out.rejected === rejected;
    }
    return r.status === 'unsolvable';
  };
  const result = (): FreezeResult => ({ moves, keptBlocks: keep.size, totalBlocks, ...out });

  out.restrictedOptimal = exactOn(keep, left() / 2);
  if (out.restrictedOptimal) return result();

  const candidates = [...keep].sort((a, b) => counts.get(a)! - counts.get(b)! || a - b);
  for (let i = 0; i < candidates.length && left() > 0; i++) {
    const trial = new Set(keep);
    trial.delete(candidates[i]!);
    const restricted = freezeBlocks(level, trial);
    // at most half the remaining time for the greedy pass, shared among the remaining blocks
    const share = left() / 2 / (candidates.length - i);
    const f = find(restricted, {
      maxStates: opts.maxStates ?? Infinity,
      ...(opts.maxMemoryMb !== undefined ? { maxMemoryMb: opts.maxMemoryMb } : {}),
      timeoutMs: share,
      now,
    });
    if (f.status !== 'solved') continue;
    keep.delete(candidates[i]!);
    out.greedyFrozen++;
    offer(restricted, f.moves);
  }
  if (out.greedyFrozen > 0 && left() > 0) out.restrictedOptimal = exactOn(keep, left());
  return result();
}
