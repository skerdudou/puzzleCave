import { planSolution, type PlanOptions, type PlanResult } from '../planner/plan';
import { solve } from '../solver';
import type { Dir, LevelData, Status } from '../types';
import type { ExactEngine, WindowEngine } from './engine';
import { findSolution, type FindOptions, type FindResult } from './findSolution';
import { freezeStage } from './freeze';
import { normalizeMoves } from './macro';
import { reoptimize } from './reoptimize';
import { spareKeys } from './spareKeys';

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
  /**
   * duration of the solution search (used when there is no winning initial solution); 30% of
   * timeoutMs by default. When given, it comes on top: the later stages keep their usual share
   * (70%) of timeoutMs after the search
   */
  findTimeoutMs?: number | undefined;
  /** memory cap (MB) of the solution search; maxMemoryMb by default */
  findMemoryMb?: number | undefined;
  /** key closure in the solution search (FindOptions.keyClosure); off by default */
  keyClosure?: boolean | undefined;
  /** search for any solution; `findSolution` by default */
  find?: (level: LevelData, opts: FindOptions) => FindResult;
  /**
   * event planner run when there is no designer solution and the search finds none (true by
   * default: it costs nothing when the search succeeds)
   */
  planFallback?: boolean;
  /** share of the total duration given to the planner (0.3 by default) */
  planShare?: number;
  /** planner; `planSolution` by default */
  planner?: (level: LevelData, opts: PlanOptions) => PlanResult;
}

export type StageName = 'find' | 'plan' | 'reoptimize' | 'spareKeys' | 'freeze' | 'proof';

export interface StageReport {
  stage: StageName;
  /** length before and after the stage (absent while there is no solution) */
  before?: number;
  after?: number;
  ms: number;
  note: string;
}

export interface ImproveResult {
  /** starting point: designer solution, found solution (search or proof), planned, or none */
  start: 'designer' | 'found' | 'planned' | 'none';
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
const SPARE_KEYS_END = 0.7;
const FREEZE_END = 0.85;
/** planner settings of the fallback (see docs/solver-study.md, planner limits relaxed) */
const PLAN_FALLBACK: Omit<PlanOptions, 'timeoutMs'> = {};

/**
 * "Best known" pipeline of a level: starting point (designer solution if it wins, otherwise
 * findSolution), exact reoptimization by windows, spare keys (useless key pickups removed, then
 * windows again), frozen blocks, then a global exact search
 * bounded by the current length. Each stage returns a winning solution that is never longer.
 * Proven optimal if the exact search finishes, or if its lower bound reaches the length;
 * otherwise best known, with the proven lower bound.
 */
export function improveLevel(level: LevelData, opts: ImproveOptions): ImproveResult {
  const now = opts.now ?? (() => performance.now());
  // shifted after an explicit search time (findTimeoutMs), see below
  let t0 = now();
  // when the planner ran, the stage ends after the starting point (windows … proof) are rescaled
  // over the time left, so that it does not eat the windows' share
  let rest0 = FIND_END;
  const until = (fraction: number) => {
    const f =
      fraction <= FIND_END
        ? fraction
        : rest0 + ((fraction - FIND_END) / (1 - FIND_END)) * (1 - rest0);
    return Math.max(0, t0 + f * opts.timeoutMs - now());
  };
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
  if (!moves) {
    run('find', () => {
      const f = find(level, {
        maxStates: opts.maxStates ?? Infinity,
        ...memory,
        ...(opts.findMemoryMb !== undefined ? { maxMemoryMb: opts.findMemoryMb } : {}),
        ...(opts.keyClosure ? { keyClosure: true } : {}),
        timeoutMs: opts.findTimeoutMs ?? until(FIND_END),
        now,
      });
      if (f.status !== 'solved') return `no solution (${f.reason}, ${f.explored} states)`;
      const n = normalizeMoves(level, f.moves);
      if (n.status !== 'won') return 'found solution invalid (discarded)';
      moves = n.moves;
      result.start = 'found';
      return `${f.explored} states`;
    });
    // explicit search time: the later stages keep their share of timeoutMs after it
    if (opts.findTimeoutMs !== undefined) t0 = now() - FIND_END * opts.timeoutMs;
  }
  if (!moves && opts.planFallback !== false) {
    const share = Math.min(1 - FIND_END, Math.max(0, opts.planShare ?? 0.3));
    run('plan', () => {
      const p = (opts.planner ?? planSolution)(level, {
        ...PLAN_FALLBACK,
        timeoutMs: until(FIND_END + share),
        now,
      });
      const work = `${p.expanded} event states, ${p.subSearches} sub-searches`;
      if (p.status !== 'solved') return `no plan (${p.reason}, ${work})`;
      const n = normalizeMoves(level, p.moves);
      if (n.status !== 'won') return 'planned solution invalid (discarded)';
      moves = n.moves;
      result.start = 'planned';
      return `${p.events.length} events, ${work}`;
    });
    rest0 = Math.min(1, Math.max(FIND_END, (now() - t0) / opts.timeoutMs));
  }
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
    run('spareKeys', () => {
      const windowOpts = {
        now,
        maxStatesPerWindow,
        ...memory,
        exact,
        ...(opts.window ? { window: opts.window } : {}),
      };
      const r = spareKeys(level, moves!, { ...windowOpts, timeoutMs: until(SPARE_KEYS_END) });
      moves = r.moves;
      let note = `${r.dropped} key pickups removed, ${r.windows} windows${r.timedOut ? ' (time elapsed)' : ''}`;
      if (r.dropped > 0 && until(SPARE_KEYS_END) > 0) {
        // the removed pickups change the states: the windows may shorten the new solution
        const w = reoptimize(level, moves, { ...windowOpts, timeoutMs: until(SPARE_KEYS_END) });
        moves = w.moves;
        note += `; windows again: ${w.improvements} replacements${w.timedOut ? ' (time elapsed)' : ''}`;
      }
      return note;
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
