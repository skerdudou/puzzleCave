// Engine of the internal windows of the reoptimization, on the structures of the compact exact
// engine (packed state, direct expansion, typed table and heap).
import { CompactModel, WALL } from '../compactModel';
import { MemoryBudget, StateStore, TypedHeap, hashWords } from '../compactStore';
import { DIRS } from '../state';
import type { Dir } from '../types';
import type { WindowEngine, WindowOptions } from './engine';

/** priority = f · TIE_SPAN + (TIE_SPAN − 1 − cost): exact order by f as long as cost < TIE_SPAN */
const TIE_SPAN = 1 << 16;
const MAX_F = TIE_SPAN - 1;
/** heap values ≥ GOAL: arrivals found */
const GOAL = 0x80000000;
const FAR = 0x3fffffff;
const MB = 1024 ** 2;

/** distance of each cell to the `targets` cells, only walls (and inert objects) block */
function wallDistance(model: CompactModel, targets: readonly number[]): Int32Array {
  const { n, nb, base } = model;
  const d = new Int32Array(n).fill(FAR);
  const q = new Int32Array(n);
  let tail = 0;
  for (const t of targets) {
    d[t] = 0;
    q[tail++] = t;
  }
  for (let head = 0; head < tail; head++) {
    const c = q[head]!;
    for (let k = 0; k < 4; k++) {
      const m = nb[c * 4 + k]!;
      if (m < 0 || base[m] === WALL || d[m] !== FAR) continue;
      d[m] = d[c]! + 1;
      q[tail++] = m;
    }
  }
  return d;
}

/**
 * Default window engine: A* over macro-states, from `from` to the exact state `goal` (or to
 * victory), cost < limit. Lower bound: wall-free distance from the player to the arrival cell (or
 * to the exit), consistent. Exact pruning of states that can no longer become `goal`: a key or
 * door of `goal` consumed, a water of `goal` filled (nothing comes back; a block only disappears
 * by filling a water, so the block count follows). The arrival is reached as soon as the
 * configuration (pocket keys included) is that of `goal` and its cell is in the player's zone: we
 * walk there. Typed arrays within a budget (opts.maxMemoryMb, 256 MB by default): beyond it,
 * 'limit'.
 */
export const searchWindow: WindowEngine = (from, goal, limit, opts: WindowOptions) => {
  // costs < limit ≤ TIE_SPAN: cost ≤ 65535 fits in the 16-bit cost of the nodes
  if (limit > TIE_SPAN) return { status: 'limit' };
  const now = opts.now ?? (() => performance.now());
  const t0 = now();
  const model = new CompactModel(from);
  const { words, width } = model;
  const toWin = goal.status === 'won';
  const goalCell = goal.player.y * width + goal.player.x;
  const exits: number[] = [];
  for (let i = 0; i < model.n; i++) if (model.isExit[i]) exits.push(i);
  const h = wallDistance(model, toWin ? exits : [goalCell]);
  const goalKey = toWin ? undefined : model.encode({ ...goal, status: 'playing' });
  const { fixedMask, waterMask } = model;
  /** model.next can still become goal */
  const viable = (): boolean => {
    const next = model.next;
    for (let w = 1; w < words; w++) {
      const g = goalKey![w]!;
      const s = next[w]!;
      if ((g & fixedMask[w]! & ~s) !== 0 || (s & waterMask[w]! & ~g) !== 0) return false;
    }
    return true;
  };
  /** the loaded state has goal's configuration (pocket keys included) */
  const atGoalConfig = (): boolean => {
    const cur = model.cur;
    if (cur[0]! >>> 16 !== goalKey![0]! >>> 16) return false;
    for (let w = 1; w < words; w++) if (cur[w] !== goalKey![w]) return false;
    return true;
  };

  const budget = new MemoryBudget(Math.floor((opts.maxMemoryMb ?? 256) * MB));
  let store: StateStore;
  try {
    store = new StateStore(words, budget);
  } catch {
    return { status: 'limit' };
  }
  const heap = new TypedHeap(budget);
  const prio = (f: number, cost: number) => f * TIE_SPAN + (MAX_F - cost);
  const key = new Uint32Array(words);
  const startKey = model.encode(model.start);
  const root = store.insert(startKey, hashWords(startKey, 0, words));
  if (root < 0) return { status: 'limit' };
  store.setCost(root, 0);
  store.setParent(root, root);
  const startH = h[model.start.player.y * width + model.start.player.x]!;
  if (startH < limit && !heap.push(prio(startH, 0), root)) return { status: 'limit' };

  // arrivals: parent node and edge (cell × 4 + direction, or the cell alone for a walk)
  const goalParent: number[] = [];
  const goalEdge: number[] = [];
  const goalWalkOnly: boolean[] = [];
  const addGoal = (parent: number, edge: number, walkOnly: boolean, cost: number): boolean => {
    goalParent.push(parent);
    goalEdge.push(edge);
    goalWalkOnly.push(walkOnly);
    return heap.push(prio(cost, cost), GOAL + goalParent.length - 1);
  };
  let curId = 0;
  let curCost = 0;
  let overflow = false;
  const next = model.next;
  const sink = {
    succ(edge: number, walk: number, cell: number, won: boolean): boolean {
      const nextCost = curCost + walk + 1;
      if (won) {
        if (!toWin || nextCost >= limit) return true;
        if (addGoal(curId, edge, false, nextCost)) return true;
        overflow = true;
        return false;
      }
      const hv = h[cell]!;
      const f = nextCost + hv;
      if (f >= limit) return true;
      if (!toWin && !viable()) return true;
      const hash = hashWords(next, 0, words);
      let id = store.find(next, hash);
      if (id >= 0) {
        if (store.closed(id) || store.cost(id) <= nextCost) return true;
      } else {
        if (store.size >= opts.maxStates) {
          overflow = true;
          return false;
        }
        id = store.insert(next, hash);
        if (id < 0) {
          overflow = true;
          return false;
        }
      }
      store.setCost(id, nextCost);
      store.setParent(id, curId);
      store.setEdge(id, edge);
      if (heap.push(prio(f, nextCost), id)) return true;
      overflow = true;
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
      const last = i + 1 === chain.length;
      const edge = last ? goalEdge[goal]! : store.edge(chain[i + 1]!);
      if (last && goalWalkOnly[goal]) {
        for (const d of model.walkTo(edge)) moves.push(DIRS[d]!);
        break;
      }
      for (const d of model.walkTo(edge >> 2)) moves.push(DIRS[d]!);
      moves.push(DIRS[edge & 3]!);
    }
    return moves;
  };

  for (let pops = 0; heap.size > 0; pops++) {
    if ((pops & 255) === 0 && now() - t0 > opts.timeoutMs) return { status: 'limit' };
    heap.pop();
    const val = heap.topVal;
    if (val >= GOAL) return { status: 'shorter', moves: rebuild(val - GOAL) };
    const cost = MAX_F - (heap.topPrio & 0xffff);
    const id = val;
    if (store.closed(id) || store.cost(id) !== cost) continue;
    store.setClosed(id);
    store.readKey(id, key);
    model.load(key);
    if (!toWin && atGoalConfig()) {
      model.explore();
      if (model.reached(goalCell)) {
        const walk = model.dist[goalCell]!;
        if (cost + walk < limit && !addGoal(id, goalCell, true, cost + walk))
          return { status: 'limit' };
      }
    }
    curId = id;
    curCost = cost;
    model.expand(sink);
    if (overflow) return { status: 'limit' };
  }
  return { status: 'none' };
};
