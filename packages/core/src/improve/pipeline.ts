import { solve } from '../solver';
import type { Dir, LevelData, Status } from '../types';
import type { ExactEngine, WindowEngine } from './engine';
import { findSolution, type FindOptions, type FindResult } from './findSolution';
import { freezeStage } from './freeze';
import { normalizeMoves } from './macro';
import { reoptimize } from './reoptimize';

export interface ImproveOptions {
  /** solution supplied by the designer: preferred starting point if it wins */
  initial?: readonly Dir[];
  /** total duration of the pipeline */
  timeoutMs: number;
  /** macro-states of each search (findSolution, frozen blocks, proof); unlimited by default */
  maxStates?: number | undefined;
  /**
   * memory cap (MB) of each search (findSolution, windows, frozen blocks, proof): the stages
   * follow one another, one search at a time; engine defaults otherwise
   */
  maxMemoryMb?: number | undefined;
  /** macro-states of each reoptimization window (2,000,000 by default, ≤ maxStates) */
  maxStatesPerWindow?: number;
  now?: () => number;
  /** exact engine (proof, frozen blocks, final windows); `solve` by default */
  exact?: ExactEngine;
  /**
   * engine of the global searches (frozen blocks, proof); `exact` by default. The reoptimization
   * windows, small and numerous, keep `exact` (e.g. GPU for the global searches, compact engine
   * for the windows)
   */
  global?: ExactEngine;
  /** engine of the internal windows; `searchWindow` by default */
  window?: WindowEngine;
  /** search for any solution; `findSolution` by default */
  find?: (level: LevelData, opts: FindOptions) => FindResult;
}

export type StageName = 'find' | 'reoptimize' | 'freeze' | 'proof';

export interface StageReport {
  stage: StageName;
  /** length before and after the stage (absent while there is no solution) */
  before?: number;
  after?: number;
  ms: number;
  note: string;
}

export interface ImproveResult {
  /** starting point: designer solution, found solution, or none */
  start: 'designer' | 'found' | 'none';
  /** status of the designer solution when it does not win (then ignored) */
  designerInvalid?: Status;
  /** length of the starting point */
  initialLength?: number;
  /** best solution: wins the level, never longer than the starting point */
  moves?: Dir[];
  /** the global exact search proved that no solution is shorter than moves */
  proven: boolean;
  /** proven lower bound of the number of moves (= length if proven) */
  lowerBound: number;
  /** the exact search proved the level unsolvable */
  unsolvable?: boolean;
  stages: StageReport[];
}

/** stage ends, as a fraction of the total duration (unused time carries over to the next stage) */
const FIND_END = 0.3;
const REOPTIMIZE_END = 0.6;
const FREEZE_END = 0.8;

/**
 * "Best known" pipeline of a level: starting point (designer solution if it wins, otherwise
 * findSolution), exact reoptimization by windows, frozen blocks, then a global exact search
 * bounded by the current length. Each stage returns a winning solution that is never longer.
 * Proven optimal if the exact search finishes, or if its lower bound reaches the length;
 * otherwise best known, with the proven lower bound.
 */
export function improveLevel(level: LevelData, opts: ImproveOptions): ImproveResult {
  const now = opts.now ?? (() => performance.now());
  const t0 = now();
  const until = (fraction: number) => Math.max(0, t0 + fraction * opts.timeoutMs - now());
  const exact = opts.exact ?? solve;
  const global = opts.global ?? exact;
  const find = opts.find ?? findSolution;
  // common options: state limit (absent = unlimited) and memory cap
  const states = opts.maxStates !== undefined ? { maxStates: opts.maxStates } : {};
  const memory = opts.maxMemoryMb !== undefined ? { maxMemoryMb: opts.maxMemoryMb } : {};
  const stages: StageReport[] = [];
  const result: ImproveResult = { start: 'none', proven: false, lowerBound: 0, stages };
  let moves: Dir[] | undefined;
  const run = (stage: StageName, body: () => string) => {
    const s0 = now();
    const before = moves?.length;
    const note = body();
    stages.push({
      stage,
      ...(before !== undefined ? { before } : {}),
      ...(moves ? { after: moves.length } : {}),
      ms: now() - s0,
      note,
    });
  };

  if (opts.initial) {
    const n = normalizeMoves(level, opts.initial);
    if (n.status === 'won') {
      moves = n.moves;
      result.start = 'designer';
    } else result.designerInvalid = n.status;
  }
  if (!moves)
    run('find', () => {
      const f = find(level, {
        maxStates: opts.maxStates ?? Infinity,
        ...memory,
        timeoutMs: until(FIND_END),
        now,
      });
      if (f.status !== 'solved') return `no solution (${f.reason}, ${f.explored} states)`;
      const n = normalizeMoves(level, f.moves);
      if (n.status !== 'won') return 'found solution invalid (discarded)';
      moves = n.moves;
      result.start = 'found';
      return `${f.explored} states`;
    });
  if (moves) {
    result.initialLength = moves.length;
    const maxStatesPerWindow = Math.min(
      opts.maxStatesPerWindow ?? 2_000_000,
      opts.maxStates ?? Infinity,
    );
    run('reoptimize', () => {
      const r = reoptimize(level, moves!, {
        timeoutMs: until(REOPTIMIZE_END),
        now,
        maxStatesPerWindow,
        ...memory,
        exact,
        ...(opts.window ? { window: opts.window } : {}),
      });
      moves = r.moves;
      return `${r.windows} windows, ${r.improvements} replacements, windows up to ${r.largestWindow} interactions${r.timedOut ? ' (time elapsed)' : ''}`;
    });
    run('freeze', () => {
      const r = freezeStage(level, moves!, {
        timeoutMs: until(FREEZE_END),
        now,
        ...states,
        ...memory,
        exact: global,
        find,
      });
      moves = r.moves;
      const greedy = r.greedyFrozen
        ? ` (${r.greedyFrozen} used blocks additionally frozen by the greedy pass)`
        : '';
      const kept = `${r.keptBlocks}/${r.totalBlocks} blocks kept pushable${greedy}`;
      return r.restrictedOptimal
        ? `${kept}: no shorter solution with only these blocks`
        : `${kept}: restricted search not finished`;
    });
  }
  run('proof', () => {
    const upper = moves?.length;
    const r = global(level, {
      ...states,
      ...memory,
      // stopped by memory before the deadline: partial expansion for the remaining time
      partialExpansion: 'auto',
      timeoutMs: until(1),
      now,
      ...(upper !== undefined ? { upperBound: upper } : {}),
    });
    if (r.status === 'solved') {
      const n = normalizeMoves(level, r.moves);
      // safeguards: an inconsistent engine answer proves nothing and leaves the bound untouched
      if (n.status !== 'won')
        return `inconsistent exact engine solution (status ${n.status}) — ignored`;
      if (upper !== undefined && n.moves.length > upper)
        return `inconsistent exact engine solution (${n.moves.length} > ${upper} moves) — ignored`;
      if (upper === undefined || n.moves.length < upper) {
        moves = n.moves;
        if (result.start === 'none') result.start = 'found';
        result.initialLength ??= n.moves.length;
      }
      result.proven = true;
      result.lowerBound = n.moves.length;
      return `exact search finished (${r.explored} states)`;
    }
    if (r.status === 'unsolvable') {
      if (upper === undefined) {
        result.unsolvable = true;
        return `unsolvable (${r.explored} states)`;
      }
      // only an engine that applies upperBound can answer "unsolvable" when we hold a winning
      // solution: the answer then means "nothing shorter"
      result.proven = true;
      result.lowerBound = upper;
      return `no shorter solution (${r.explored} states)`;
    }
    result.lowerBound = r.lowerBound;
    result.proven = upper !== undefined && r.lowerBound >= upper;
    return `limit reached (${r.explored} states), lower bound ${r.lowerBound}`;
  });
  if (moves) {
    result.moves = moves;
    if (result.proven) result.lowerBound = moves.length;
  }
  return result;
}
