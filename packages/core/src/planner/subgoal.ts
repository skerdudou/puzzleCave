// Low level of the event planner: one sub-goal reached by a small Dijkstra over the macro-states
// of a restricted copy of the current state, where everything not explicitly allowed is frozen
// (blocks and doors become walls, so do the waters a block may not be pushed into).
import { BLOCK, CompactModel, FREE, WATER } from '../compactModel';
import { MemoryBudget, StateStore, TypedHeap, hashWords } from '../compactStore';
import { DIRS } from '../state';
import { step } from '../step';
import type { Dir, GameState, Terrain } from '../types';

export interface Restriction {
  /** blocks that may move (cells); every other block is a wall */
  free?: Iterable<number>;
  /** doors that may be opened; every other door is a wall */
  doors?: Iterable<number>;
  /** waters a block may be pushed into ('all': every one); the others are walls */
  waters?: Iterable<number> | 'all';
}

/** goal tested on the restricted model with the macro-state loaded; true: reached */
export type Goal = (m: CompactModel) => boolean;

export interface SubgoalOptions {
  /** macro-states of the restricted search (small by design) */
  maxStates?: number;
  /** the goal is a win (reaching the exit) */
  win?: boolean;
  /** wall-clock limit of the search (none by default) */
  timeoutMs?: number;
  now?: () => number;
  /** memory budget of the search structures (256 MB by default) */
  maxMemoryMb?: number;
}

export type SubgoalResult =
  | { ok: true; moves: Dir[]; state: GameState; explored: number }
  /**
   * touched: frozen blocks the player stood next to with room behind them (pushable if
   * unfrozen); full: stopped by maxStates (or the memory budget) rather than exhausted;
   * timedOut: stopped by timeoutMs
   */
  | { ok: false; touched: number[]; full: boolean; timedOut: boolean; explored: number };

/** Copy of s where every block, door and water that is not allowed becomes a wall. */
export function restrict(s: GameState, r: Restriction): GameState {
  const free = new Set(r.free ?? []);
  const doors = new Set(r.doors ?? []);
  const allWaters = r.waters === 'all';
  const waters = new Set(r.waters === 'all' ? [] : (r.waters ?? []));
  const terrain: Terrain[] = s.terrain.slice();
  const objects = s.objects.slice();
  const player = s.player.y * s.width + s.player.x;
  for (let i = 0; i < terrain.length; i++) {
    const o = objects[i];
    if ((o === 'block' && !free.has(i)) || (o === 'door' && !doors.has(i))) {
      terrain[i] = 'wall';
      objects[i] = null;
    } else if (terrain[i] === 'water' && !allWaters && !waters.has(i) && i !== player)
      terrain[i] = 'wall';
  }
  return { ...s, terrain, objects };
}

/**
 * Shortest move sequence (in moves) from s, in the restricted world, to a macro-state where
 * goal holds (or to a win with opts.win). The moves are replayed on the real state s: frozen
 * objects are walls in the restricted copy, so no move touches them and the real game follows the
 * same path (checked).
 */
export function reachSubgoal(
  s: GameState,
  r: Restriction,
  goal: Goal,
  opts: SubgoalOptions = {},
): SubgoalResult {
  const model = new CompactModel(restrict(s, r));
  const { words, nb, n } = model;
  const free = new Set(r.free ?? []);
  const frozen = new Uint8Array(n);
  s.objects.forEach((o, i) => {
    if (o === 'block' && !free.has(i)) frozen[i] = 1;
  });
  const touched = new Set<number>();
  const budget = new MemoryBudget((opts.maxMemoryMb ?? 256) * 1024 * 1024);
  const store = new StateStore(words, budget);
  const heap = new TypedHeap(budget);
  const key = new Uint32Array(words);
  const startKey = model.encode(model.start);
  const root = store.insert(startKey, hashWords(startKey, 0, words));
  store.setCost(root, 0);
  store.setParent(root, root);
  heap.push(0, root);
  const maxStates = opts.maxStates ?? 50_000;
  let curId = root;
  let curCost = 0;
  let winEdge = -1;
  let winParent = -1;
  let winCost = Infinity;
  let full = false;
  let timedOut = false;
  const now = opts.now ?? (() => performance.now());
  const deadline = opts.timeoutMs === undefined ? Infinity : now() + opts.timeoutMs;
  let pops = 0;
  const next = model.next;
  const sink = {
    succ(edge: number, walk: number, _cell: number, won: boolean): boolean {
      const nc = curCost + walk + 1;
      if (won) {
        if (opts.win && nc < winCost) {
          winCost = nc;
          winEdge = edge;
          winParent = curId;
        }
        return true;
      }
      const h = hashWords(next, 0, words);
      let id = store.find(next, h);
      if (id >= 0) {
        if (store.closed(id) || store.cost(id) <= nc) return true;
      } else {
        if (store.size >= maxStates) {
          full = true;
          return false;
        }
        id = store.insert(next, h);
        if (id < 0) {
          full = true;
          return false;
        }
      }
      store.setCost(id, Math.min(nc, 0xffff));
      store.setParent(id, curId);
      store.setEdge(id, edge);
      heap.push(nc, id);
      return true;
    },
  };
  const noteTouched = () => {
    const reached = model.explore();
    for (let k = 0; k < reached; k++) {
      const c = model.order[k]!;
      for (let d = 0; d < 4; d++) {
        const m = nb[c * 4 + d]!;
        if (m < 0 || !frozen[m] || touched.has(m)) continue;
        const behind = nb[m * 4 + d]!;
        if (behind < 0) continue;
        const g = model.grid[behind];
        const room =
          (g === FREE && model.holdsBlock[behind] === 1) ||
          g === WATER ||
          (s.terrain[behind] === 'water' && !frozen[behind] && g !== BLOCK);
        if (room) touched.add(m);
      }
    }
  };
  let found = -1;
  while (heap.size > 0) {
    heap.pop();
    const id = heap.topVal;
    const cost = heap.topPrio;
    if (store.closed(id) || store.cost(id) !== cost) continue;
    if ((++pops & 255) === 0 && now() > deadline) {
      timedOut = true;
      break;
    }
    // a win found earlier is not longer than anything still in the heap
    if (winEdge >= 0 && winCost <= cost) break;
    store.setClosed(id);
    store.readKey(id, key);
    model.load(key);
    if (!opts.win && id !== root && goal(model)) {
      found = id;
      break;
    }
    model.load(key);
    noteTouched();
    curId = id;
    curCost = cost;
    model.expand(sink);
    if (full) break;
  }
  if (found < 0 && winEdge < 0)
    return { ok: false, touched: [...touched], full, timedOut, explored: store.size };
  const moves = found >= 0 ? rebuild(found, -1) : rebuild(winParent, winEdge);
  // replay on the real state
  let real = s;
  for (const d of moves) {
    const nx = step(real, d).state;
    if (nx.moves === real.moves) throw new Error('sub-goal replay: move without effect');
    real = nx;
  }
  if (opts.win && real.status !== 'won') throw new Error('sub-goal replay: no win');
  return { ok: true, moves, state: real, explored: store.size };

  function rebuild(last: number, edgeAfter: number): Dir[] {
    const chain: number[] = [];
    for (let id = last; id !== root; id = store.parent(id)) chain.push(id);
    chain.push(root);
    chain.reverse();
    const out: Dir[] = [];
    for (let i = 0; i < chain.length; i++) {
      const edge = i + 1 < chain.length ? store.edge(chain[i + 1]!) : edgeAfter;
      if (edge < 0) break;
      store.readKey(chain[i]!, key);
      model.load(key);
      model.explore();
      for (const d of model.walkTo(edge >> 2)) out.push(DIRS[d]!);
      out.push(DIRS[edge & 3]!);
    }
    return out;
  }
}
