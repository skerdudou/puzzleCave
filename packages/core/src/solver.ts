import { CompactBound } from './compactBound';
import { CompactModel } from './compactModel';
import { MemoryBudget, StateStore, TypedHeap, hashWords } from './compactStore';
import { DeadlockAnalysis } from './deadlock';
import { UNREACHABLE } from './solverBound';
import { DIRS } from './state';
import type { Dir, LevelData } from './types';

/** memoryBytes: peak bytes allocated by the compact solver (typed arrays); deadStates: states closed by deadPruning */
export type SolveResult = { deadStates?: number } & (
  | { status: 'solved'; moves: Dir[]; explored: number; memoryBytes?: number }
  | { status: 'unsolvable'; explored: number; memoryBytes?: number }
  /** lowerBound: proven minimum number of moves of any solution (see solve) */
  | { status: 'timeout'; explored: number; lowerBound: number; memoryBytes?: number }
);

export interface SolveOptions {
  /** maximum number of distinct macro-states (configuration + player position); unlimited by default */
  maxStates?: number;
  /**
   * solver memory cap in MB (1024 by default): the table, nodes and heap are typed arrays
   * outside the V8 heap, which --max-old-space-size does not bound
   */
  maxMemoryMb?: number;
  timeoutMs?: number;
  now?: () => number;
  /**
   * partial expansion (PEA*): only successors with f ≤ the node's f are stored, and the node is
   * pushed back at the smallest deferred f. Same number of stored states when the search
   * succeeds, but a deeper bound for the same memory, at the cost of ~6–10x more time per state.
   * 'auto': normal search; if it stops on the memory or state limit before the timeout, a
   * partial search in the same arrays for the remaining time, keeping the better of the two
   * results. false by default.
   */
  partialExpansion?: boolean | 'auto';
  /**
   * length of an already known solution: only strictly shorter solutions are searched for (any
   * node with f ≥ upperBound is pruned). 'unsolvable' then means "no solution of fewer than
   * upperBound moves"; the lower bound reported on timeout remains valid.
   */
  upperBound?: number;
  /**
   * dead-state pruning (DeadlockAnalysis): a state that can no longer be won is closed when
   * popped, like a state without a route to the exit. Sound (the analysis over-approximates what
   * can still happen), so status, optimal length and lower bound stay valid. false by default.
   */
  deadPruning?: boolean;
}

/** priority = f · TIE_SPAN + (TIE_SPAN − 1 − cost): on equal f, the most advanced first */
const TIE_SPAN = 1 << 16;
/** cost and f of a heap entry (horizon: nothing beyond it is pushed) */
const MAX_F = TIE_SPAN - 1;
/** heap values ≥ GOAL: exits found */
const GOAL = 0x80000000;
const MB = 1024 ** 2;

interface Context {
  model: CompactModel;
  bound: CompactBound;
  store: StateStore;
  heap: TypedHeap;
  budget: MemoryBudget;
  maxStates: number;
  now: () => number;
  deadline: number;
  upperBound: number;
  dead: DeadlockAnalysis | undefined;
}

/**
 * Compact exact engine. Macro-search: a macro-state is (remaining objects, filled water, keys,
 * player position), packed into Uint32 words (see CompactModel). From each one, a BFS gives the
 * area reachable without interaction; each interaction (exit, key, door, push) is applied
 * directly on the packed state and costs the walk + 1 move. A* on the number of moves: a relaxed
 * lower bound (distance to the exit) at insertion, a strong lower bound (distinct doors,
 * CompactBound) computed when popped from the heap and pushed back if larger; both are
 * admissible and the strong one is consistent, so the first exit to leave the heap is an
 * optimal solution. One node per macro-state (typed table): a better cost found before closing
 * updates the node and the old heap entry becomes stale (different cost). Only the start cell
 * and the direction of each interaction are kept: the walk is rebuilt at the end by the BFS of
 * the parent state.
 *
 * Stops (status timeout): time, maxStates, memory budget (maxMemoryMb); a level whose
 * exploration exceeds the horizon f > 65535 moves also ends in timeout (never "unsolvable").
 *
 * Lower bound on timeout: the largest f = cost + lower bound popped from the heap.
 * Let C* be the optimum. Invariant: while the search runs, the heap holds an entry with
 * f ≤ C* — either a macro-state of an optimal path with its optimal cost (both lower bounds
 * are admissible, the weak one ≤ the strong one, and the strong one is consistent: a macro-state
 * is only closed with its optimal cost, so the first non-closed state of an optimal path was
 * pushed with its optimal cost), or the goal already found with cost bestGoal = C*. The only
 * entries never pushed or dropped without successors are: successors with f ≥ bestGoal (if one
 * is on an optimal path, then bestGoal = C* and the goal stays in the heap as a witness),
 * UNREACHABLE states (on no path), entries beyond the horizon (f > 65535: if C* ≤ 65535 none is
 * on an optimal path), stale entries (cost > best known: an entry of the same state with a
 * smaller cost is in the heap or already processed); lazy re-pushing with the strong bound
 * replaces the entry by an entry of the same state with f still ≤ C*. Partial expansion: let s_j
 * be the deepest state of an optimal path stored with its optimal cost; it is not closed
 * (otherwise s_{j+1} would have been stored with its optimal cost), so it is in the heap either
 * with its f, or pushed back at the smallest deferred f, which is ≤ f(s_{j+1}) ≤ C*. Every entry
 * popped is the heap minimum, hence has f ≤ C* (priority = f·TIE_SPAN + TIE_SPAN − 1 − cost with
 * cost < TIE_SPAN: a smaller f always gives a smaller priority; f and cost ≤ 65535 by the
 * horizon, and no entry with an UNREACHABLE bound is pushed). The maximum of the popped f is
 * therefore ≤ C* (and ≤ 65535 < C* otherwise). With upperBound = U, bestGoal starts at U: if
 * C* < U, no entry of an optimal path (f ≤ C* < U) is pruned and the argument is unchanged; if
 * C* ≥ U, every pushed entry has f < U ≤ C*, and an exhausted search proves that no solution
 * has fewer than U moves ('unsolvable'). For a plain search (partialExpansion false or true)
 * without a time stop, it grows with maxStates and maxMemoryMb: the search is deterministic
 * (the door cache, sized by the budget, does not change the values) and these limits only
 * interrupt it. With 'auto', the result is the better of the two searches: never less than the
 * normal search at the same limits (itself monotonic), but not monotonic by itself — the
 * partial search only has the time left by the first, which lasts longer the larger the limits.
 */
export function solve(level: LevelData, opts: SolveOptions = {}): SolveResult {
  const now = opts.now ?? (() => performance.now());
  const t0 = now();
  const budget = new MemoryBudget(Math.floor((opts.maxMemoryMb ?? 1024) * MB));
  const model = new CompactModel(level);
  const empty = (): SolveResult => ({
    status: 'timeout',
    explored: 0,
    lowerBound: 0,
    memoryBytes: budget.peak,
  });
  // model and bound precomputations (small next to the nodes; the door cache is
  // sized within the budget)
  if (!budget.take(model.n * 64)) return empty();
  let bound: CompactBound;
  let store: StateStore;
  try {
    bound = new CompactBound(model, budget);
    store = new StateStore(model.words, budget);
  } catch {
    return empty();
  }
  const ctx: Context = {
    model,
    bound,
    store,
    heap: new TypedHeap(budget),
    budget,
    maxStates: opts.maxStates ?? Infinity,
    now,
    deadline: t0 + (opts.timeoutMs ?? 60_000),
    upperBound: opts.upperBound ?? Infinity,
    dead: opts.deadPruning ? new DeadlockAnalysis(model) : undefined,
  };
  const mode = opts.partialExpansion ?? false;
  if (mode !== 'auto') return withStats(search(ctx, mode).result, ctx);
  const first = search(ctx, false);
  if (!first.limited) return withStats(first.result, ctx);
  store.reset();
  ctx.heap.reset();
  const second = search(ctx, true).result;
  if (second.status !== 'timeout' || first.result.status !== 'timeout')
    return withStats(second, ctx);
  return withStats(second.lowerBound > first.result.lowerBound ? second : first.result, ctx);
}

function withStats(r: SolveResult, ctx: Context): SolveResult {
  return ctx.dead ? { ...r, deadStates: ctx.dead.deadCount } : r;
}

/** one search; limited: stopped by the memory or state limit */
function search(ctx: Context, partial: boolean): { result: SolveResult; limited: boolean } {
  const { model, bound, store, heap, budget, maxStates, now, deadline } = ctx;
  const { words } = model;
  const toExit = bound.toExit;
  const NO_H = StateStore.NO_H;
  const prio = (f: number, cost: number) => f * TIE_SPAN + (MAX_F - cost);
  let lowerBound = 0;
  let explored = 0;
  /** expansion was interrupted by a limit (memory or states) */
  let stopped = false;
  const timeout = () => ({
    result: { status: 'timeout', explored, lowerBound, memoryBytes: budget.peak } as SolveResult,
    limited: stopped,
  });

  const key = new Uint32Array(words);
  const startKey = model.encode(model.start);
  const startH = toExit[model.start.player.y * model.width + model.start.player.x]!;
  const root = store.insert(startKey, hashWords(startKey, 0, words));
  if (root < 0) return timeout();
  explored = 1;
  store.setCost(root, 0);
  store.setParent(root, root);
  if (startH < ctx.upperBound && startH < UNREACHABLE && !heap.push(prio(startH, 0), root)) {
    stopped = true;
    return timeout();
  }

  const goalParent: number[] = [];
  const goalEdge: number[] = [];
  /** cost of the best exit found, or upperBound: nothing with f ≥ bestGoal is stored */
  let bestGoal = ctx.upperBound;
  /** entries were dropped beyond the horizon: never "unsolvable" */
  let truncated = false;
  let curId = 0;
  let curCost = 0;
  // partial expansion: f of the current entry, smallest f among deferred successors
  let curF = 0;
  let deferredF = Infinity;
  const next = model.next;

  const sink = {
    succ(edge: number, walk: number, cell: number, won: boolean): boolean {
      const nextCost = curCost + walk + 1;
      if (won) {
        if (nextCost >= bestGoal) return true;
        if (nextCost > MAX_F) {
          truncated = true;
          return true;
        }
        bestGoal = nextCost;
        goalParent.push(curId);
        goalEdge.push(edge);
        if (heap.push(prio(nextCost, nextCost), GOAL + goalParent.length - 1)) return true;
        stopped = true;
        return false;
      }
      const hx = toExit[cell]!;
      if (hx === UNREACHABLE) return true;
      let f = nextCost + hx;
      if (f >= bestGoal) return true;
      if (partial && f > curF) {
        if (f < deferredF) deferredF = f;
        return true;
      }
      const h = hashWords(next, 0, words);
      let id = store.find(next, h);
      if (id >= 0) {
        if (store.closed(id) || store.cost(id) <= nextCost) return true;
        const hs = store.h(id);
        if (hs !== NO_H) {
          f = nextCost + hs;
          if (f >= bestGoal) return true;
          if (partial && f > curF) {
            if (f < deferredF) deferredF = f;
            return true;
          }
        }
        if (f > MAX_F) {
          truncated = true;
          return true;
        }
      } else {
        if (f > MAX_F) {
          truncated = true;
          return true;
        }
        if (store.size >= maxStates) {
          stopped = true;
          return false;
        }
        id = store.insert(next, h);
        if (id < 0) {
          stopped = true;
          return false;
        }
        explored = store.size;
      }
      store.setCost(id, nextCost);
      store.setParent(id, curId);
      store.setEdge(id, edge);
      if (heap.push(prio(f, nextCost), id)) return true;
      stopped = true;
      return false;
    },
  };

  const rebuild = (goal: number): Dir[] => {
    const chain: number[] = [];
    for (let id = goalParent[goal]!; id !== root; id = store.parent(id)) chain.push(id);
    chain.push(root);
    chain.reverse();
    const moves: Dir[] = [];
    for (let i = 0; i < chain.length; i++) {
      store.readKey(chain[i]!, key);
      model.load(key);
      model.explore();
      const edge = i + 1 < chain.length ? store.edge(chain[i + 1]!) : goalEdge[goal]!;
      for (const d of model.walkTo(edge >> 2)) moves.push(DIRS[d]!);
      moves.push(DIRS[edge & 3]!);
    }
    return moves;
  };

  for (let pops = 0; heap.size > 0; pops++) {
    if ((pops & 255) === 0 && now() > deadline) return timeout();
    heap.pop();
    const p = heap.topPrio;
    const val = heap.topVal;
    const f = p >>> 16;
    const cost = MAX_F - (p & 0xffff);
    if (f > lowerBound) lowerBound = f;
    if (val >= GOAL) {
      const moves = rebuild(val - GOAL);
      return {
        result: { status: 'solved', moves, explored, memoryBytes: budget.peak },
        limited: false,
      };
    }
    const id = val;
    if (store.closed(id) || store.cost(id) !== cost) continue;
    store.readKey(id, key);
    model.load(key);
    let h = store.h(id);
    if (h === NO_H) {
      h = bound.strong();
      // a dead state is on no path to the exit: closed like an UNREACHABLE one
      if (h !== UNREACHABLE && ctx.dead?.dead()) h = UNREACHABLE;
      if (h === UNREACHABLE) {
        store.setClosed(id);
        continue;
      }
      if (cost + h > MAX_F) {
        truncated = true;
        continue;
      }
      store.setH(id, h);
    }
    if (cost + h > f) {
      if (cost + h >= bestGoal) continue;
      if (heap.push(prio(cost + h, cost), id)) continue;
      stopped = true;
      return timeout();
    }
    curId = id;
    curCost = cost;
    curF = f;
    deferredF = Infinity;
    if (!partial) store.setClosed(id);
    model.expand(sink);
    if (stopped) return timeout();
    if (!partial) continue;
    // deferred successors: the node stays open, pushed back at the smallest deferred f
    if (deferredF === Infinity || deferredF >= bestGoal) store.setClosed(id);
    else if (deferredF > MAX_F) {
      truncated = true;
      store.setClosed(id);
    } else if (!heap.push(prio(deferredF, cost), id)) {
      stopped = true;
      return timeout();
    }
  }
  if (truncated) return timeout();
  return {
    result: { status: 'unsolvable', explored, memoryBytes: budget.peak },
    limited: false,
  };
}
