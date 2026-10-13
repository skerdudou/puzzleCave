import { BLOCK, CompactModel, DOOR, FREE, KEY, WATER } from '../compactModel';
import { MemoryBudget, StateStore, TypedHeap, hashWords } from '../compactStore';
import { DIRS } from '../state';
import type { Dir, LevelData } from '../types';
import { DeadlockAnalysis } from '../deadlock';
import { DEAD, Guide } from './guide';
import { closeKeys } from './keyClosure';

export type FindResult = { deadStates?: number; dominated?: number } & (
  | { status: 'solved'; moves: Dir[]; explored: number }
  /**
   * exhausted: all non-dead macro-states were visited without winning; limit / timeout: state
   * (or memory) limit or time limit reached
   */
  | { status: 'failed'; reason: 'exhausted' | 'limit' | 'timeout'; explored: number }
);

export interface FindOptions {
  maxStates: number;
  /** memory cap of the typed arrays (MB, 1024 by default) */
  maxMemoryMb?: number;
  timeoutMs: number;
  now?: () => number;
  /** discard the states DeadlockAnalysis proves lost (sound: completeness is kept) */
  deadPruning?: boolean;
  /** skip a state dominated by a known one holding one key more in pocket (see findSolution) */
  keyDominance?: boolean;
  /**
   * key closure: after each interaction (and at the start) the player also picks up every key
   * reachable by walking, as one macro step (see closeKeys). Off by default: complete, but the
   * gains measured on the real levels are inconsistent (docs/solver-study.md)
   */
  keyClosure?: boolean;
  /** tests and measurements: false runs the full closure on every successor (same result) */
  keyClosureFilter?: boolean;
  /** called every `progressMs` ms (2,000 by default) and at the end with the search counters */
  onProgress?: (p: FindProgress) => void;
  progressMs?: number;
}

/** counters of a running search (see FindOptions.onProgress) */
export interface FindProgress {
  ms: number;
  /** stored macro-states (generated and not discarded as duplicates) */
  explored: number;
  /** expanded macro-states */
  expanded: number;
  /** open states in the heap */
  open: number;
  /** bytes of the memory budget in use, and their peak */
  usedBytes: number;
  peakBytes: number;
  /** novelty tables (one pair of bitsets per value of h) and their bytes */
  noveltyTables: number;
  noveltyBytes: number;
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
  const deadTest = opts.deadPruning ? new DeadlockAnalysis(probe) : undefined;
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
  const progress = (expanded: number): FindProgress => ({
    ms: now() - t0,
    explored: store.size,
    expanded,
    open: heap.size,
    usedBytes: budget.used,
    peakBytes: budget.peak,
    noveltyTables: seen1.size,
    noveltyBytes: seen1.size * (na + pairBytes),
  });
  const prio = (w: number, h: number, cost: number) =>
    ((w << 30) >>> 0) +
    Math.min(h, H_MAX) * (1 << COST_BITS) +
    (COST_MAX - Math.min(cost, COST_MAX));

  const explored = () => store.size;
  /** third model, for the key closure (model expands, probe evaluates) */
  const closer = opts.keyClosure ? new CompactModel(level) : undefined;
  const startKey = model.encode(model.start);
  const startCost = closer ? closeKeys(closer, startKey) : 0;
  const root = store.insert(startKey, hashWords(startKey, 0, words));
  if (root < 0) return { status: 'failed', reason: 'limit', explored: 0 };
  store.setParent(root, root);
  probe.load(startKey);
  const h0 = guide.h();
  if (h0 === DEAD || deadTest?.dead())
    return { status: 'failed', reason: 'exhausted', explored: 1 };
  store.setCost(root, startCost);
  if (novelty(atomsOfProbe(), h0) < 0 || !heap.push(prio(1, h0, startCost), root))
    return { status: 'failed', reason: 'limit', explored: 1 };

  const key = new Uint32Array(words);
  let curId = 0;
  let curCost = 0;
  let failed: 'limit' | undefined;
  let goalEdge = -1;
  let goalCost = Infinity;
  const next = model.next;
  /**
   * Key closure filter. Every stored state is closed: no key touches the walking region R of
   * the state being expanded (computed before the expansion into `region`). After an interaction
   * at cell m, only m and, for a push into water, the filled cell become walkable; R otherwise
   * only shrinks. A key is thus reachable in the successor only if it touches the cells opened
   * from m outside R: a small flood that spares most full closures (same result). The root is
   * not closed when the player starts on water: its successors always get the full closure.
   */
  const filter = closer !== undefined && opts.keyClosureFilter !== false;
  const region = filter ? new Int32Array(model.n) : undefined;
  const flood = closer ? new Int32Array(model.n) : undefined;
  const floodSeen = closer ? new Int32Array(model.n) : undefined;
  let stamp = 0;
  let floodStamp = 0;
  const keyNear = (edge: number): boolean => {
    const { grid, nb, isExit } = model;
    const d = edge & 3;
    const m = nb[edge]!;
    let behind = -1;
    let behindCode = 0;
    if (grid[m] === BLOCK) {
      behind = nb[m * 4 + d]!;
      behindCode = grid[behind] === WATER ? FREE : BLOCK;
    }
    const fs = ++floodStamp;
    floodSeen![m] = fs;
    flood![0] = m;
    for (let head = 0, tail = 1; head < tail; head++) {
      const x = flood![head]!;
      for (let k = 0; k < 4; k++) {
        const y = nb[x * 4 + k]!;
        if (y < 0 || y === m) continue;
        const g = y === behind ? behindCode : grid[y];
        if (g === KEY && !isExit[y]) return true;
        if (g !== FREE || region![y] === stamp || floodSeen![y] === fs) continue;
        floodSeen![y] = fs;
        flood![tail++] = y;
      }
    }
    return false;
  };
  /**
   * key dominance: the same state with one key k taken off the board and one more key in pocket
   * (same player cell) is at least as good — it can replay any continuation, skipping the moves
   * that were blocked at a door for lack of a key and walking on k as on floor. If it is already
   * known, `next` is skipped (completeness kept, optimality not).
   */
  const dominance = opts.keyDominance ?? false;
  const dom = new Uint32Array(words);
  let dominatedCount = 0;
  const stats = () => ({
    ...(deadTest ? { deadStates: deadTest.deadCount } : {}),
    ...(dominance ? { dominated: dominatedCount } : {}),
  });
  const dominated = (): boolean => {
    probe.load(next);
    const keysWord = next[0]! >>> 16;
    const cap = probe.doorsLeft + 0x8000;
    for (let f = 0; f < probe.fixedCount; f++) {
      if (!probe.fixedIsKey[f] || probe.grid[probe.fixedCell[f]!] !== KEY) continue;
      dom.set(next);
      const bit = probe.fixedBit[probe.fixedCell[f]!]!;
      dom[bit >>> 5]! &= ~(1 << (bit & 31));
      dom[0] = ((next[0]! & 0xffff) | (Math.min(keysWord + 1, cap) << 16)) >>> 0;
      if (store.find(dom, hashWords(dom, 0, words)) >= 0) {
        dominatedCount++;
        return true;
      }
    }
    return false;
  };
  const sink = {
    succ(edge: number, walk: number, _cell: number, won: boolean): boolean {
      let nextCost = curCost + walk + 1;
      if (won) {
        if (nextCost < goalCost) {
          goalCost = nextCost;
          goalEdge = edge;
        }
        return true;
      }
      if (closer && (!filter || curId === root || keyNear(edge)))
        nextCost += closeKeys(closer, next);
      if (dominance && dominated()) return true;
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
      if (h === DEAD || deadTest?.dead()) {
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
    const dirs: number[] = [];
    if (closer) closeKeys(closer, model.encode(model.start), dirs);
    const raw = new Uint32Array(words);
    for (let i = 0; i < chain.length; i++) {
      store.readKey(chain[i]!, key);
      model.load(key);
      model.explore();
      const edge = i + 1 < chain.length ? store.edge(chain[i + 1]!) : lastEdge;
      dirs.push(...model.walkTo(edge >> 2), edge & 3);
      if (closer && i + 1 < chain.length) {
        // the stored child is the closure of this interaction's successor: rebuild its tour
        model.expand({
          succ: (e) => {
            if (e !== edge) return true;
            raw.set(model.next);
            return false;
          },
        });
        closeKeys(closer, raw, dirs);
      }
    }
    return dirs.map((d) => DIRS[d]!);
  };

  const report = opts.onProgress;
  const reportEvery = opts.progressMs ?? 2000;
  let lastReport = t0;
  for (let pops = 0; heap.size > 0; pops++) {
    if ((pops & 255) === 0) {
      const t = now();
      if (t - t0 > opts.timeoutMs) {
        report?.(progress(pops));
        return { status: 'failed', reason: 'timeout', explored: explored(), ...stats() };
      }
      if (report && t - lastReport >= reportEvery) {
        lastReport = t;
        report(progress(pops));
      }
    }
    heap.pop();
    const id = heap.topVal;
    store.readKey(id, key);
    model.load(key);
    curId = id;
    curCost = store.cost(id);
    if (region) {
      stamp++;
      const reached = model.explore();
      for (let h = 0; h < reached; h++) region[model.order[h]!] = stamp;
    }
    model.expand(sink);
    if (goalEdge >= 0 || failed) report?.(progress(pops + 1));
    if (goalEdge >= 0)
      return { status: 'solved', moves: path(id, goalEdge), explored: explored(), ...stats() };
    if (failed) return { status: 'failed', reason: failed, explored: explored(), ...stats() };
  }
  return { status: 'failed', reason: 'exhausted', explored: explored(), ...stats() };
}
