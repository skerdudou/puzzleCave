import { DOOR, KEY, WALL, type CompactModel } from './compactModel';
import type { MemoryBudget } from './compactStore';
import { UNREACHABLE } from './solverBound';

/** door table cache entries: at most one per possible set of doors */
const MAX_CACHE_ENTRIES = 4096;
const NO_DIST = 0xffff;

/**
 * Lower bounds of the compact solver, on the relaxed map where only walls stop movement (water,
 * blocks, doors, gravel are passable).
 *
 * - toExit: relaxed distance to the nearest exit (lower bound at insertion).
 * - strong() (evaluated when popped from the heap): "distinct doors" bound (Fable study,
 *   bound2.ts). Let dmin be the minimum number of distinct remaining doors on a relaxed path to
 *   the exit (0-1 BFS: entering a door costs 1; a minimal path does not go through a door
 *   twice). Each door crossed consumes a key and only opens with keys > 0, so need = dmin − keys
 *   keys (initial negative keys included) must be picked up before the exit.
 *   need ≤ 0 (or dmin = 0): toExit. need = 1: min_k d(p,k) + d(k,E) (v2 bound). need ≥ 2:
 *   min_{k1≠k2} d(p,k1) + max(d(k1,k2), (need−1)·δ) + d(k2,E) (k1 the first key picked up, k2
 *   the last), δ = smallest distance between two remaining keys; fewer than need keys
 *   remaining: dead state (UNREACHABLE). (The formula of bound2.ts, without the d(k1,k2) term,
 *   can be weaker than the v2 bound: fixed here, measured by the tests.)
 *   Consistency (h(s) ≤ walk + 1 + h(s')): picking up key k (cost c ≥ d(p,k)) leaves dmin
 *   unchanged (the walk crosses no door), lowers need by 1 and does not decrease δ; we take
 *   k1 = k in the formula for s, with d(k,k2') ≤ d(k,k1') + d(k1',k2') and
 *   δ ≤ d(k,k1'); opening door q (keys > 0) gives dmin(s) ≤ 1 + dmin(s') hence
 *   need(s) ≤ need(s'), and the bound grows with need; a push or an exit only changes the
 *   position (triangle inequality). Checked by the tests. It dominates the v2 bound
 *   (d(p,k1) + d(k1,k2) + d(k2,E) ≥ d(p,k2) + d(k2,E)).
 */
export class CompactBound {
  readonly toExit: Int32Array;
  /** relaxed distance from each initial key (key index × n + tile) */
  private readonly keyDist: Int32Array;
  /** indices (in fixedCell) and tiles of the keys */
  private readonly keyCells: Int32Array;
  private readonly keyPair: Int32Array;
  private readonly dist01: Int32Array;
  private readonly deque: Int32Array;
  private readonly hasDoors: boolean;
  /** remaining keys of the loaded state (key indices) and their distance to the exit */
  private readonly left: Int32Array;
  private readonly leftExit: Int32Array;
  /** key indices by increasing distance to the exit */
  private readonly byExit: Int32Array;
  /** key pairs (a, b, distance) by increasing distance, flattened */
  private readonly pairsByDist: Int32Array;
  /** door bits among the key/door bits (words 1… of the state key) */
  private readonly doorMask: Uint32Array;
  private readonly sig: Uint32Array;
  /** cache of the "doors to the exit" tables: signature, occupied entry, distances */
  private readonly cacheSig: Uint32Array;
  private readonly cacheUsed: Uint8Array;
  private readonly cacheDist: Uint16Array;
  private readonly cacheMask: number;
  cacheMisses = 0;

  constructor(
    private readonly model: CompactModel,
    budget?: MemoryBudget,
  ) {
    const { n, isExit } = model;
    const exits: number[] = [];
    for (let i = 0; i < n; i++) if (isExit[i]) exits.push(i);
    this.toExit = this.bfs(exits);
    const keys: number[] = [];
    let doors = 0;
    for (let f = 0; f < model.fixedCount; f++) {
      if (model.fixedIsKey[f]) keys.push(model.fixedCell[f]!);
      else doors++;
    }
    this.hasDoors = doors > 0;
    this.keyCells = Int32Array.from(keys);
    this.keyDist = new Int32Array(keys.length * n);
    keys.forEach((k, i) => this.keyDist.set(this.bfs([k]), i * n));
    this.keyPair = new Int32Array(keys.length * keys.length);
    for (let a = 0; a < keys.length; a++)
      for (let b = 0; b < keys.length; b++)
        this.keyPair[a * keys.length + b] = this.keyDist[a * n + keys[b]!]!;
    this.dist01 = new Int32Array(n);
    this.deque = new Int32Array(2 * n + 2);
    this.left = new Int32Array(keys.length);
    this.leftExit = new Int32Array(keys.length);
    const idx = keys.map((_, i) => i);
    this.byExit = Int32Array.from(
      idx.sort((a, b) => this.toExit[keys[a]!]! - this.toExit[keys[b]!]!),
    );
    const pairs: [number, number, number][] = [];
    for (let a = 0; a < keys.length; a++)
      for (let b = a + 1; b < keys.length; b++)
        pairs.push([a, b, this.keyPair[a * keys.length + b]!]);
    pairs.sort((x, y) => x[2] - y[2]);
    this.pairsByDist = Int32Array.from(pairs.flat());
    const sw = Math.ceil(model.fixedCount / 32);
    this.doorMask = new Uint32Array(sw);
    for (let f = 0; f < model.fixedCount; f++)
      if (!model.fixedIsKey[f]) this.doorMask[f >>> 5]! |= 1 << (f & 31);
    this.sig = new Uint32Array(sw);
    // fixed tables (small: keys × tiles) are counted first; the door cache is then
    // sized within the budget: at most 1/8 of the cap, halved until it fits, and absent
    // (0-1 BFS on every call) if it does not fit at all
    if (budget && !budget.take(this.fixedBytes))
      throw new Error('memory budget too small for the bounds');
    const entryBytes = sw * 4 + 1 + n * 2;
    let entries = doors === 0 ? 0 : Math.min(MAX_CACHE_ENTRIES, 2 ** doors);
    if (budget)
      while (
        entries > 0 &&
        !(entries * entryBytes <= budget.limit / 8 && budget.take(entries * entryBytes))
      )
        entries >>= 1;
    this.cacheMask = Math.max(0, entries - 1);
    this.cacheSig = new Uint32Array(entries * sw);
    this.cacheUsed = new Uint8Array(entries);
    this.cacheDist = new Uint16Array(entries * n);
  }

  /** bytes of the fixed tables of this bound (excluding the door cache) */
  private get fixedBytes(): number {
    return (
      this.keyDist.byteLength +
      this.keyPair.byteLength +
      this.pairsByDist.byteLength +
      this.model.n * 24
    );
  }

  /** bytes of the "doors to the exit" table cache */
  get cacheBytes(): number {
    return this.cacheSig.byteLength + this.cacheUsed.byteLength + this.cacheDist.byteLength;
  }

  /** door cache entries (0: no cache) */
  get cacheEntries(): number {
    return this.cacheUsed.length;
  }

  /** bytes of this bound's tables (taken from the budget given to the constructor) */
  get bytes(): number {
    return this.fixedBytes + this.cacheBytes;
  }

  get keyCount(): number {
    return this.keyCells.length;
  }

  private bfs(sources: readonly number[]): Int32Array {
    const { n, nb, base } = this.model;
    const d = new Int32Array(n).fill(UNREACHABLE);
    const q = [...sources];
    for (const s of sources) d[s] = 0;
    for (let h = 0; h < q.length; h++) {
      const c = q[h]!;
      for (let k = 0; k < 4; k++) {
        const m = nb[c * 4 + k]!;
        if (m < 0 || base[m] === WALL || d[m] !== UNREACHABLE) continue;
        d[m] = d[c]! + 1;
        q.push(m);
      }
    }
    return d;
  }

  /** strong bound of the state loaded in the model */
  strong(): number {
    const model = this.model;
    const p = model.player;
    const direct = this.toExit[p]!;
    if (direct === UNREACHABLE || !this.hasDoors) return direct;
    const keys = model.keys;
    if (keys >= model.doorsLeft) return direct;
    const dmin = this.cachedMinDoors(p);
    if (dmin === 0) return direct;
    const need = dmin - keys;
    if (need <= 0) return direct;
    const { grid, n } = model;
    const kc = this.keyCells;
    const left = this.left;
    // remaining keys, by increasing distance to the exit
    let count = 0;
    for (let j = 0; j < kc.length; j++) {
      const i = this.byExit[j]!;
      if (grid[kc[i]!] === KEY) left[count++] = i;
    }
    if (count < need) return UNREACHABLE;
    const kd = this.keyDist;
    const leftExit = this.leftExit;
    for (let j = 0; j < count; j++) leftExit[j] = this.toExit[kc[left[j]!]!]!;
    if (need === 1) {
      let best = UNREACHABLE;
      for (let j = 0; j < count; j++) {
        const v = kd[left[j]! * n + p]! + leftExit[j]!;
        if (v < best) best = v;
      }
      return best;
    }
    // δ: first pair (sorted by distance) whose two keys both remain
    let delta = UNREACHABLE;
    const pairs = this.pairsByDist;
    for (let j = 0; j < pairs.length; j += 3) {
      if (grid[kc[pairs[j]!]!] === KEY && grid[kc[pairs[j + 1]!]!] === KEY) {
        delta = pairs[j + 2]!;
        break;
      }
    }
    if (delta >= UNREACHABLE) return UNREACHABLE;
    // first key k1, last k2: between the two, at least d(k1,k2) and (need−1)·δ;
    // k2 is scanned by increasing distance to the exit, stopping as soon as middle + d(k2,E)
    // can no longer improve
    const middle = (need - 1) * delta;
    const m = kc.length;
    const pair = this.keyPair;
    let best = UNREACHABLE;
    for (let j = 0; j < count; j++) {
      const i1 = left[j]!;
      const a = kd[i1 * n + p]! + middle;
      if (a + leftExit[0]! >= best) continue;
      const row = i1 * m;
      for (let jj = 0; jj < count; jj++) {
        const e = leftExit[jj]!;
        if (a + e >= best) break;
        if (jj === j) continue;
        const extra = pair[row + left[jj]!]! - middle;
        const v = a + (extra > 0 ? extra : 0) + e;
        if (v < best) best = v;
      }
    }
    return best >= UNREACHABLE ? UNREACHABLE : best;
  }

  /**
   * Level-by-level 0-1 BFS: minimum number of remaining doors to cross from p to an exit.
   * Level D: BFS of the tiles with D doors (free edges); a neighboring door moves to level
   * D + 1. Each tile enters each per-level queue at most once (≤ n entries).
   */
  minDoors(p: number): number {
    const { nb, grid, isExit, n } = this.model;
    const dist = this.dist01;
    dist.fill(UNREACHABLE);
    let qa = this.deque.subarray(0, n);
    let qb = this.deque.subarray(n, 2 * n);
    let la = 1;
    qa[0] = p;
    dist[p] = 0;
    for (let D = 0; la > 0; D++) {
      let lb = 0;
      for (let i = 0; i < la; i++) {
        const c = qa[i]!;
        if (dist[c] !== D) continue;
        if (isExit[c]) return D;
        for (let k = 0; k < 4; k++) {
          const m = nb[c * 4 + k]!;
          if (m < 0) continue;
          const g = grid[m];
          if (g === WALL) continue;
          if (g === DOOR) {
            if (dist[m]! > D + 1) {
              dist[m] = D + 1;
              qb[lb++] = m;
            }
          } else if (dist[m]! > D) {
            dist[m] = D;
            qa[la++] = m;
          }
        }
      }
      const t = qa;
      qa = qb;
      qb = t;
      la = lb;
    }
    return UNREACHABLE;
  }

  /**
   * Same value as minDoors(p), read from a table of the minimum number of doors to the exit
   * from each tile (reverse 0-1 BFS from the exits), cached per set of remaining doors (exact
   * signature: the state's door bits; direct-mapped). Useful when door sets are few (pc-03:
   * 9 doors); with 125 doors (pc-15) almost every call is a cache miss, at the cost of one BFS.
   */
  cachedMinDoors(p: number): number {
    if (this.cacheUsed.length === 0) return this.minDoors(p);
    const { cur } = this.model;
    const sig = this.sig;
    const sw = sig.length;
    let h = 0x811c9dc5;
    for (let w = 0; w < sw; w++) {
      const v = cur[1 + w]! & this.doorMask[w]!;
      sig[w] = v;
      h = Math.imul(h ^ v, 0x01000193);
      h ^= h >>> 15;
    }
    const e = (h >>> 0) & this.cacheMask;
    const tags = this.cacheSig;
    let hit = this.cacheUsed[e] === 1;
    for (let w = 0; hit && w < sw; w++) if (tags[e * sw + w] !== sig[w]) hit = false;
    const n = this.model.n;
    if (!hit) {
      this.fillDoorTable(e * n);
      tags.set(sig, e * sw);
      this.cacheUsed[e] = 1;
      this.cacheMisses++;
    }
    const v = this.cacheDist[e * n + p]!;
    return v === NO_DIST ? UNREACHABLE : v;
  }

  /** reverse 0-1 BFS from the exits; a door counts for whoever crosses it towards the exit */
  private fillDoorTable(at: number): void {
    const { nb, grid, isExit, n } = this.model;
    const dist = this.cacheDist.subarray(at, at + n);
    dist.fill(NO_DIST);
    let qa = this.deque.subarray(0, n);
    let qb = this.deque.subarray(n, 2 * n);
    let la = 0;
    for (let i = 0; i < n; i++)
      if (isExit[i]) {
        dist[i] = 0;
        qa[la++] = i;
      }
    for (let D = 0; la > 0; D++) {
      let lb = 0;
      for (let i = 0; i < la; i++) {
        const c = qa[i]!;
        if (dist[c] !== D) continue;
        // d(m) ≤ door(c) + d(c): the path from m goes through c then continues
        const nd = grid[c] === DOOR ? D + 1 : D;
        for (let k = 0; k < 4; k++) {
          const m = nb[c * 4 + k]!;
          if (m < 0 || grid[m] === WALL || dist[m]! <= nd) continue;
          dist[m] = nd;
          if (nd === D) qa[la++] = m;
          else qb[lb++] = m;
        }
      }
      const t = qa;
      qa = qb;
      qb = t;
      la = lb;
    }
  }
}
