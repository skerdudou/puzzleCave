import type { SolveOptions, SolveResult } from '../solver';
import type { Dir, GameState, LevelData } from '../types';

/**
 * Options of an exact engine. upperBound (length of an already known solution): an engine may
 * ignore any solution of length ≥ upperBound and answer 'unsolvable' if no shorter one exists
 * (`solve` does so); an engine that ignores it remains correct.
 */
export type ExactOptions = SolveOptions;

/**
 * Exact search on a level: 'solved' = optimal solution, 'unsolvable' = no solution (shorter than
 * upperBound if given), 'timeout' with a proven lower bound. Defaults to `solve` from
 * @puzzlecave/core; any engine with the same contract will do.
 */
export type ExactEngine = (level: LevelData, opts: ExactOptions) => SolveResult;

export interface WindowOptions {
  maxStates: number;
  /** memory cap of the search (MB) */
  maxMemoryMb?: number;
  timeoutMs: number;
  now?: () => number;
}

export type WindowResult =
  /** path strictly shorter than the limit */
  | { status: 'shorter'; moves: Dir[] }
  /** complete search: no path shorter than the limit */
  | { status: 'none' }
  /** state or time limit reached */
  | { status: 'limit' };

/**
 * Shortest path from state `from` to state `goal` (same configuration, player on the same cell;
 * orientation and move counter are ignored), or to victory if goal.status = 'won', of length
 * strictly below `limit`.
 */
export type WindowEngine = (
  from: GameState,
  goal: GameState,
  limit: number,
  opts: WindowOptions,
) => WindowResult;
