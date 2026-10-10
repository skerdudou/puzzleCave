import { BLOCK, CompactModel, DOOR, KEY, WATER } from '../compactModel';
import { MemoryBudget, StateStore, TypedHeap, hashWords } from '../compactStore';
import { DIRS } from '../state';
import type { Dir, LevelData } from '../types';
import { DEAD, Guide } from './guide';

export type FindResult =
  | { status: 'solved'; moves: Dir[]; explored: number }
  /**
   * exhausted: all non-dead macro-states were visited without winning; limit / timeout: state
   * (or memory) limit or time limit reached
   */
  | { status: 'failed'; reason: 'exhausted' | 'limit' | 'timeout'; explored: number };

export interface FindOptions {
  maxStates: number;
  /** memory cap of the typed arrays (MB, 1024 by default) */
  maxMemoryMb?: number;
  timeoutMs: number;
  now?: () => number;
}

/** 32-bit priority: novelty (2 bits) | h (17 bits) | 8191 − cost (13 bits) */
const H_BITS = 17;
const H_MAX = (1 << H_BITS) - 1;
const COST_BITS = 13;
const COST_MAX = (1 << COST_BITS) - 1;
const MB = 1024 ** 2;

/**
 * Search for ONE solution, with no optimality guarantee: best-first by novelty (BFWS, Lipovetzky
 * & Geffner), over the macro-states (walk + one interaction) of the compact model (packed state,
 * direct expansion, typed table and heap). Atoms of a state: player at c, block at c, water w
 * filled, key/door k consumed, number of keys in pocket (0–15). Within the partition of equal
 * estimate h, a state has novelty 1 if it makes a never-seen atom true, 2 if it makes a
 * never-seen pair of atoms true, 3 otherwise. Order: novelty, then h, then the most advanced.
 * Novelty-3 states are demoted, not pruned, and only states the guide deems dead are discarded:
 * the search is complete over live macro-states.
 */
export function findSolution(level: LevelData, opts: FindOptions): FindResult {
  const now = opts.now ?? (() => performance.now());
  const t0 = now();
  // two models: one expands the current state, the other evaluates each successor
  const model = new CompactModel(level);
  const probe = new CompactModel(level);
  const guide = new Guide(probe);
  const { n, words } = model;
  const budget = new MemoryBudget(Math.floor((opts.maxMemoryMb ?? 1024) * MB));
  let store: StateStore;
  try {
    store = new StateStore(words, budget);
  } catch {
    return { status: 'failed', reason: 'limit', explored: 0 };
  }
  const heap = new TypedHeap(budget);

  // atom numbering: player at c: c; block at c: n + c; waters; keys/doors; keys
  const waterAtom = new Int32Array(n).fill(-1);
  let na = 2 * n;
  const waterCells: number[] = [];
  for (let i = 0; i < n; i++)
    if (model.base[i] === WATER) {
      waterAtom[i] = na++;
      waterCells.push(i);
    }
  const fixedAtom = na;
  na += model.fixedCount;
  const keysAtom = na;
  na += 16;
  const atoms = new Int32Array(3 * n + model.fixedCount + 17);
  /** atoms of the state loaded in probe */
  const atomsOfProbe = (): number => {
    const { grid } = probe;
    let k = 0;
    atoms[k++] = probe.player;
    for (let i = 0; i < n; i++) if (grid[i] === BLOCK) atoms[k++] = n + i;
    for (const w of waterCells) if (grid[w] !== WATER) atoms[k++] = waterAtom[w]!;
    for (let f = 0; f < probe.fixedCount; f++) {
      const g = grid[probe.fixedCell[f]!];
      if (g !== KEY && g !== DOOR) atoms[k++] = fixedAtom + f;
    }
    atoms[k++] = keysAtom + Math.max(0, Math.min(15, probe.keys));
    return k;
  };
  // atoms and pairs already seen, per value of h (bitsets, taken from the budget: -1 if exhausted)
  const seen1 = new Map<number, Uint8Array>();
  const seen2 = new Map<number, Uint8Array>();
  const pairBytes = Math.ceil((na * na) / 8);
  const novelty = (count: number, h: number): number => {
    let one = seen1.get(h);
    let two = seen2.get(h);
    if (!one || !two) {
      if (!budget.take(na + pairBytes)) return -1;
      seen1.set(h, (one = new Uint8Array(na)));
      seen2.set(h, (two = new Uint8Array(pairBytes)));
    }
    let w = 3;
    for (let i = 0; i < count; i++) {
      if (!one[atoms[i]!]) {
        one[atoms[i]!] = 1;
        w = 1;
      }
    }
    for (let i = 0; i < count; i++) {
      const base = atoms[i]! * na;
      for (let j = i + 1; j < count; j++) {
        const pair = base + atoms[j]!;
        const bit = 1 << (pair & 7);
        if (two[pair >> 3]! & bit) continue;
        two[pair >> 3]! |= bit;
        if (w > 2) w = 2;
      }
    }
    return w;
  };
  const prio = (w: number, h: number, cost: number) =>
    ((w << 30) >>> 0) +
    Math.min(h, H_MAX) * (1 << COST_BITS) +
    (COST_MAX - Math.min(cost, COST_MAX));

  const explored = () => store.size;
  const startKey = model.encode(model.start);
  const root = store.insert(startKey, hashWords(startKey, 0, words));
  if (root < 0) return { status: 'failed', reason: 'limit', explored: 0 };
  store.setParent(root, root);
  probe.load(startKey);
  const h0 = guide.h();
  if (h0 === DEAD) return { status: 'failed', reason: 'exhausted', explored: 1 };
  store.setCost(root, 0);
  if (novelty(atomsOfProbe(), h0) < 0 || !heap.push(prio(1, h0, 0), root))
    return { status: 'failed', reason: 'limit', explored: 1 };

  const key = new Uint32Array(words);
  let curId = 0;
  let curCost = 0;
  let failed: 'limit' | undefined;
  let goalEdge = -1;
  let goalCost = Infinity;
  const next = model.next;
  const sink = {
    succ(edge: number, walk: number, _cell: number, won: boolean): boolean {
      const nextCost = curCost + walk + 1;
      if (won) {
        if (nextCost < goalCost) {
          goalCost = nextCost;
          goalEdge = edge;
        }
        return true;
      }
      const hash = hashWords(next, 0, words);
      if (store.find(next, hash) >= 0) return true;
      if (store.size >= opts.maxStates) {
        failed = 'limit';
        return false;
      }
      const id = store.insert(next, hash);
      if (id < 0) {
        failed = 'limit';
        return false;
      }
      store.setParent(id, curId);
      store.setEdge(id, edge);
      store.setCost(id, Math.min(nextCost, 0xffff));
      probe.load(next);
      const h = guide.h();
      if (h === DEAD) {
        store.setClosed(id);
        return true;
      }
      const w = novelty(atomsOfProbe(), h);
      if (w >= 0 && heap.push(prio(w, h, nextCost), id)) return true;
      failed = 'limit';
      return false;
    },
  };

  const path = (last: number, lastEdge: number): Dir[] => {
    const chain: number[] = [];
    for (let id = last; id !== root; id = store.parent(id)) chain.push(id);
    chain.push(root);
    chain.reverse();
    const moves: Dir[] = [];
    for (let i = 0; i < chain.length; i++) {
      store.readKey(chain[i]!, key);
      model.load(key);
      model.explore();
      const edge = i + 1 < chain.length ? store.edge(chain[i + 1]!) : lastEdge;
      for (const d of model.walkTo(edge >> 2)) moves.push(DIRS[d]!);
      moves.push(DIRS[edge & 3]!);
    }
    return moves;
  };

  for (let pops = 0; heap.size > 0; pops++) {
    if ((pops & 255) === 0 && now() - t0 > opts.timeoutMs)
      return { status: 'failed', reason: 'timeout', explored: explored() };
    heap.pop();
    const id = heap.topVal;
    store.readKey(id, key);
    model.load(key);
    curId = id;
    curCost = store.cost(id);
    model.expand(sink);
    if (goalEdge >= 0) return { status: 'solved', moves: path(id, goalEdge), explored: explored() };
    if (failed) return { status: 'failed', reason: failed, explored: explored() };
  }
  return { status: 'failed', reason: 'exhausted', explored: explored() };
}
