import { solve } from '../solver';
import type { Dir, GameState, LevelData } from '../types';
import type { ExactEngine, WindowEngine, WindowResult } from './engine';
import { checkpoints, normalizeMoves, stateAsLevel } from './macro';
import { searchWindow } from './window';

export { searchWindow };

export interface ReoptimizeOptions {
  /** total duration of the reoptimization */
  timeoutMs: number;
  now?: () => number;
  /** macro-states per window (2,000,000 by default) */
  maxStatesPerWindow?: number;
  /** memory cap of each window (MB) */
  maxMemoryMb?: number;
  /** step of the window size, in interactions (8 by default: 8, 16, 24…) */
  windowStep?: number;
  /** exact engine of the final windows (up to victory); `solve` by default */
  exact?: ExactEngine;
  /** engine of the internal windows (towards an exact state); `searchWindow` by default */
  window?: WindowEngine;
}

export interface ReoptimizeResult {
  moves: Dir[];
  /** windows searched, replacements made */
  windows: number;
  improvements: number;
  /** largest window size (in interactions) run to the fixed point */
  largestWindow: number;
  /** replacements discarded because the resulting solution did not win (should never happen) */
  rejected: number;
  timedOut: boolean;
}

/**
 * Search of one window, shared by the window passes: towards an exact state with the window
 * engine, towards victory with the exact engine (on the start state seen as a level), within the
 * remaining time until `deadline`.
 */
export function windowSearch(
  level: LevelData,
  deadline: number,
  opts: Pick<ReoptimizeOptions, 'maxMemoryMb'> & {
    now: () => number;
    maxStatesPerWindow: number;
    exact: ExactEngine;
    window: WindowEngine;
  },
): (from: GameState, goal: GameState, limit: number) => WindowResult {
  const { now, exact, window } = opts;
  return (from, goal, limit) => {
    const wopts = {
      maxStates: opts.maxStatesPerWindow,
      ...(opts.maxMemoryMb !== undefined ? { maxMemoryMb: opts.maxMemoryMb } : {}),
      timeoutMs: Math.max(0, deadline - now()),
      now,
    };
    if (goal.status !== 'won') return window(from, goal, limit, wopts);
    const r = exact(stateAsLevel(level, from), { ...wopts, upperBound: limit });
    if (r.status === 'solved')
      return r.moves.length < limit ? { status: 'shorter', moves: r.moves } : { status: 'none' };
    return r.status === 'unsolvable' ? { status: 'none' } : { status: 'limit' };
  };
}

/**
 * Exact reoptimization by windows of a winning solution. The solution is split at interactions;
 * for windows of N interactions (N = 8, 16, 24… until the whole solution is covered), overlapping
 * by half, we look for a path from state s_i to the identical state s_j that is strictly shorter
 * than the current piece, and replace it. Each replacement is replayed: the returned solution
 * wins and is never longer than the input. Fixed point at each N.
 */
export function reoptimize(
  level: LevelData,
  initial: readonly Dir[],
  opts: ReoptimizeOptions,
): ReoptimizeResult {
  const now = opts.now ?? (() => performance.now());
  const deadline = now() + opts.timeoutMs;
  const maxStates = opts.maxStatesPerWindow ?? 2_000_000;
  const stepN = opts.windowStep ?? 8;
  const exact = opts.exact ?? solve;
  const window = opts.window ?? searchWindow;
  const start = normalizeMoves(level, initial);
  if (start.status !== 'won')
    throw new Error(`the starting solution does not win (${start.status})`);
  let moves = start.moves;
  const out = { windows: 0, improvements: 0, largestWindow: 0, rejected: 0, timedOut: false };
  const result = (): ReoptimizeResult => ({ moves, ...out });

  const search = windowSearch(level, deadline, {
    ...opts,
    now,
    maxStatesPerWindow: maxStates,
    exact,
    window,
  });

  for (let size = stepN; ; size += stepN) {
    let count = 0;
    for (let improved = true; improved;) {
      improved = false;
      let { idx, states } = checkpoints(level, moves);
      count = idx.length - 1;
      for (let a = 0; a < count;) {
        if (now() >= deadline) {
          out.timedOut = true;
          return result();
        }
        const b = Math.min(a + size, count);
        const limit = idx[b]! - idx[a]!;
        out.windows++;
        const r = search(states[a]!, states[b]!, limit);
        if (r.status === 'shorter') {
          const cand = normalizeMoves(level, [
            ...moves.slice(0, idx[a]!),
            ...r.moves,
            ...moves.slice(idx[b]!),
          ]);
          if (cand.status === 'won' && cand.moves.length < moves.length) {
            moves = cand.moves;
            out.improvements++;
            improved = true;
            ({ idx, states } = checkpoints(level, moves));
            count = idx.length - 1;
            continue; // same starting window
          }
          out.rejected++;
        }
        a += Math.max(1, Math.floor(size / 2));
      }
    }
    out.largestWindow = size;
    if (size >= count) return result();
  }
}
