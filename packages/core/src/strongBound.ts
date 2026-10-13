// Stronger admissible lower bounds for exact searches (offline certification, pruning). Not
// consistent in general: the in-RAM A* (compactBound.ts) does not use them.
//
// TIMED RELAXATION (tdr): earliest arrival times in a relaxed game, computed by one Dijkstra in
// time order. The real player is replaced by "clones" that may act in parallel; a clone only
// benefits from what clones of an EARLIER-OR-EQUAL layer did. Nodes are (cell, layer), layer =
// (P, o): P = keys picked among the tracked keys (all remaining keys if at most
// maxTrackedKeys, otherwise none; untracked keys count as already in pocket), o = doors opened
// (capped: o = cap means "≥ cap"). Layers are ordered by (P' ⊆ P and o' ≤ o); along a real game
// the layer only grows. Label L(c, λ) = lower bound on the first time the real player stands on c
// in layer λ. A(c) = min over all layers (first arrival of any clone), τ_λ(w) = earliest fill of
// water w by a clone of layer λ, B(x) = earliest time some block can stand on x.
//
// Claim: along any real game from the loaded state, (i) at every time t the real player
// (cell c, layer λ) satisfies t ≥ L(c, λ); (ii) a water w filled at time t_f by the real player
// in layer λ_f has t_f ≥ τ_λf(w); (iii) a door or block cell first entered at time t in layer λ
// has a node (cell, λ' ≤ λ) with label ≤ t. Hence the exit time is ≥ the returned bound.
// Induction on t, one real move from (c, λ = (P, o)) at time t to c' = c + d at t + 1
// ("known for λ" = some node or fill of a layer λ' ≤ λ has a label ≤ the current time; a real
// event in the past happened in a layer ≤ the current one, at a time ≥ its relaxed label):
// - floor/gravel/filled water: [enter at t + 1];
// - unfilled water w: filled at t_f ≤ t (the fill push leaves the player on the cell before w)
//   in a layer ≤ λ [enter once a fill of w is known for λ];
// - key: picked [P ∪ {k}; a key already in P is a free cell];
// - door, first opening: needs pocket > 0, pocket = k0 + picked − opened ≤ k0 + |P| + U − o
//   [allowed if k0 + |P| + U − o ≥ 1, o + 1]; door already open: the same player opened it
//   earlier in a layer ≤ λ [enter once a node on the door is known for λ];
// - block cell: either the block is pushed now — the cell behind is floor or water without
//   object: a key there was picked (in P; untracked: allowed), a door there was opened before,
//   a block there left before (known for λ) [same]; or the block left earlier: the player entered
//   the cell then [enter once a node on the cell is known for λ];
// - exit: the game ends [goal at t + 1].
// - fill of w by a push in direction d at time t_f in layer λ: the player was on q = w − 2d at
//   t_f − 1 (t_f ≥ L(q, λ) + 1) and some block on x = w − d (t_f ≥ B(x) + 1, see the block
//   nodes below) [fill event of layer λ at max(L(q, λ), B(x)) + 1, never before the chain floor
//   of w, see chainFloor].
// Block nodes B_i(x) bound the time block i can first stand on x; they use the first-arrival
// times A(c), always lower bounds of the real ones. Every relaxed rule allows at least what the
// real rule allows, no later; the Dijkstra processes labels in time order and a move whose
// condition is not yet known waits for it (all relaxed times of later events are larger), so it
// computes these labels. Checked against exact costs on every reachable state of thousands of
// small random levels (strongBound.test.ts).
import { CompactBound } from './compactBound';
import { BLOCK, DOOR, EXIT, FREE, KEY, WALL, WATER, type CompactModel } from './compactModel';
import { UNREACHABLE } from './solverBound';

const INF = 0x3fffffff;
const NONE = 255;

export interface StrongBoundOptions {
  /** remaining keys tracked one by one (2^k layers); beyond, no key is tracked (default 4) */
  maxTrackedKeys?: number;
  /** cap of the door counter (default 8) */
  maxDoorCount?: number;
}

export class StrongBound {
  readonly n: number;
  private readonly maxTracked: number;
  private readonly doorCap: number;
  private readonly canHold: Uint8Array;
  private readonly waterCells: Int32Array;

  // per evaluation
  private nodesCap = 0;
  private dist = new Int32Array(0);
  private done = new Uint8Array(0);
  /** settled nodes of each cell (linked list through settledNext) */
  private readonly settledHead: Int32Array;
  private settledNext = new Int32Array(0);
  private readonly amin: Int32Array;
  /** per (cell, P): smallest door count of a settled node / of a known fill (NONE: none) */
  private readonly minO: Uint8Array;
  private readonly tauO: Uint8Array;
  private readonly blockReady: Int32Array;
  /** per water: lower bound on the pushes done before (and by) its fill (chainFloor) */
  readonly chain: Int32Array;
  private readonly fillCost: Int32Array;
  private readonly walk0: Int32Array;
  private readonly bfsQ: Int32Array;
  private readonly near: Int32Array;
  /** static relaxed push distance to the nearest water (block node pruning) */
  private readonly toWater: Int32Array;
  private limit = INF;
  /** water never filled in this evaluation (fill(): mandatory waters), -1: none */
  private forbidden = -1;
  /** block nodes (block × n + cell): earliest time the block stands on the cell */
  private bdist = new Int32Array(0);
  private bdone = new Uint8Array(0);
  private blockBase = 0;
  private bfillBase = 0;
  /** per water: block of its first fill (-1: none), time of a fill by another block */
  private readonly fillB1: Int32Array;
  private readonly fillT2: Int32Array;
  private readonly keyBit: Int32Array;
  // binary heap (time, id)
  private heapT = new Int32Array(1024);
  private heapI = new Int32Array(1024);
  private heapN = 0;
  // wait lists: head per condition (node on cell c: c, fill of water w: n + w)
  private readonly waitHead: Int32Array;
  private waitNext = new Int32Array(1024);
  private waitNode = new Int32Array(1024);
  private waitDir = new Uint8Array(1024);
  private waitCount = 0;
  // parameters of the current evaluation
  private layersO = 1;
  private subsets = 1;
  private k0 = 0;
  private untracked = 0;
  private nodes = 0;
  /** statistics: Dijkstra pops of the last evaluation */
  pops = 0;

  /** the cheap bounds (relaxed exit distance, distinct doors and keys) */
  readonly compact: CompactBound;

  constructor(
    private readonly model: CompactModel,
    opts: StrongBoundOptions = {},
  ) {
    const { n, base, holdsBlock } = model;
    this.n = n;
    this.compact = new CompactBound(model);
    this.maxTracked = Math.min(8, opts.maxTrackedKeys ?? 4);
    this.doorCap = Math.min(NONE - 1, opts.maxDoorCount ?? 8);
    this.canHold = new Uint8Array(n);
    for (let c = 0; c < n; c++) if (holdsBlock[c] && base[c] !== WALL) this.canHold[c] = 1;
    const waters: number[] = [];
    for (let c = 0; c < n; c++) if (base[c] === WATER) waters.push(c);
    this.waterCells = Int32Array.from(waters);
    // relaxed push distance from each cell to the nearest water of the level (reverse BFS on the
    // push graph: a block on f moves to c = f + d if c holds blocks and f − d is not a wall nor an
    // exit)
    this.toWater = new Int32Array(n).fill(INF);
    const q: number[] = [];
    for (const w of waters) {
      this.toWater[w] = 0;
      q.push(w);
    }
    for (let h = 0; h < q.length; h++) {
      const c = q[h]!;
      for (let d = 0; d < 4; d++) {
        const f = model.nb[c * 4 + (d ^ 1)]!;
        if (f < 0 || base[f] === WALL || this.toWater[f]! < INF) continue;
        const s = model.nb[f * 4 + (d ^ 1)]!;
        if (s < 0 || base[s] === WALL || model.isExit[s]) continue;
        this.toWater[f] = this.toWater[c]! + 1;
        q.push(f);
      }
    }
    this.amin = new Int32Array(n);
    this.minO = new Uint8Array(n << this.maxTracked);
    this.tauO = new Uint8Array(n << this.maxTracked);
    this.blockReady = new Int32Array(n * 4);
    this.chain = new Int32Array(n);
    this.fillCost = new Int32Array(n * 4);
    this.walk0 = new Int32Array(n);
    this.bfsQ = new Int32Array(n);
    this.near = new Int32Array(n);
    this.fillB1 = new Int32Array(n);
    this.fillT2 = new Int32Array(n);
    this.keyBit = new Int32Array(n);
    this.settledHead = new Int32Array(n);
    this.waitHead = new Int32Array(2 * n);
  }

  // ---------------------------------------------------------------- heap
  private push(t: number, id: number): void {
    if (this.heapN === this.heapT.length) {
      const t2 = new Int32Array(this.heapN * 2);
      t2.set(this.heapT);
      this.heapT = t2;
      const i2 = new Int32Array(this.heapN * 2);
      i2.set(this.heapI);
      this.heapI = i2;
    }
    const T = this.heapT;
    const I = this.heapI;
    let i = this.heapN++;
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (T[p]! <= t) break;
      T[i] = T[p]!;
      I[i] = I[p]!;
      i = p;
    }
    T[i] = t;
    I[i] = id;
  }

  private popT = 0;
  private popI = 0;
  /** pops the minimum into popT / popI */
  private pop(): void {
    const T = this.heapT;
    const I = this.heapI;
    this.popT = T[0]!;
    this.popI = I[0]!;
    const n = --this.heapN;
    if (n === 0) return;
    const t = T[n]!;
    const id = I[n]!;
    let i = 0;
    for (;;) {
      let c = 2 * i + 1;
      if (c >= n) break;
      if (c + 1 < n && T[c + 1]! < T[c]!) c++;
      if (T[c]! >= t) break;
      T[i] = T[c]!;
      I[i] = I[c]!;
      i = c;
    }
    T[i] = t;
    I[i] = id;
  }

  private relax(id: number, t: number): void {
    if (t >= this.dist[id]!) return;
    this.dist[id] = t;
    this.push(t, id);
  }

  // ---------------------------------------------------------------- layered conditions
  /** a node (cond cell) or a fill (cond n + water) of a layer ≤ (P, o) is known */
  private known(cond: number, P: number, o: number): boolean {
    const n = this.n;
    const table = cond < n ? this.minO : this.tauO;
    const base = (cond < n ? cond : cond - n) << this.maxTracked;
    for (let s = P; ; s = (s - 1) & P) {
      if (table[base + s]! <= o) return true;
      if (s === 0) return false;
    }
  }

  private wait(cond: number, node: number, dir: number, kind: number): void {
    if (this.waitCount === this.waitNext.length) {
      const m = this.waitCount * 2;
      const a = new Int32Array(m);
      a.set(this.waitNext);
      this.waitNext = a;
      const b = new Int32Array(m);
      b.set(this.waitNode);
      this.waitNode = b;
      const c = new Uint8Array(m);
      c.set(this.waitDir);
      this.waitDir = c;
    }
    const e = this.waitCount++;
    this.waitNext[e] = this.waitHead[cond]!;
    this.waitNode[e] = node;
    this.waitDir[e] = dir | (kind << 2);
    this.waitHead[cond] = e;
  }

  /** cond became known for the layers ≥ (P, o) at time now: retries the waiting moves */
  private release(cond: number, P: number, o: number, now: number, blocksOnly = false): void {
    let e = this.waitHead[cond]!;
    if (e < 0) return;
    this.waitHead[cond] = -1;
    const n = this.n;
    const O = this.layersO;
    while (e >= 0) {
      const next = this.waitNext[e]!;
      const node = this.waitNode[e]!;
      const v0 = this.waitDir[e]!;
      if (v0 & 16) {
        // block move (node = block × n + cell): global conditions, re-checked by blockMove
        const x = node % n;
        this.blockMove((node - x) / n, x, v0 & 3, now);
        e = next;
        continue;
      }
      if (blocksOnly) {
        this.waitNext[e] = this.waitHead[cond]!;
        this.waitHead[cond] = e;
        e = next;
        continue;
      }
      const layer = Math.floor(node / n);
      const eo = layer % O;
      const eP = (layer - eo) / O;
      if ((P & ~eP) === 0 && o <= eo) {
        const v = this.waitDir[e]!;
        this.move(node, v & 3, now, v >> 2);
      } else {
        // keep waiting
        this.waitNext[e] = this.waitHead[cond]!;
        this.waitHead[cond] = e;
      }
      e = next;
    }
  }

  // ---------------------------------------------------------------- relaxed moves
  /**
   * moves of node `node` in direction d evaluated at time `now` (≥ its label): kind 1 = plain
   * entry (free cell, water, open door, displaced block), 2 = push or door opening, 3 = both
   */
  private move(node: number, d: number, now: number, kind: number): void {
    const { n } = this;
    const { nb, grid } = this.model;
    const c = node % n;
    const layer = (node - c) / n;
    const c2 = nb[c * 4 + d]!;
    if (c2 < 0) return;
    const g = grid[c2]!;
    if (g === WALL) return;
    const t1 = now + 1;
    if (g === FREE) {
      if (kind & 1) this.relax(node - c + c2, t1);
      return;
    }
    if (g === EXIT) {
      if (kind & 1) this.relax(this.nodes, t1);
      return;
    }
    const O = this.layersO;
    const o = layer % O;
    const P = (layer - o) / O;
    if (g === WATER) {
      if (!(kind & 1)) return;
      if (this.known(n + c2, P, o)) this.relax(node - c + c2, t1);
      else this.wait(n + c2, node, d, 1);
      return;
    }
    if (g === KEY) {
      if (!(kind & 1)) return;
      const bit = this.keyBit[c2]!;
      const P2 = bit < 0 ? P : P | (1 << bit);
      this.relax((P2 * O + o) * n + c2, t1);
      return;
    }
    if (g === DOOR) {
      if (kind & 1) {
        if (this.known(c2, P, o)) this.relax(node - c + c2, t1);
        else this.wait(c2, node, d, 1);
      }
      if (kind & 2) {
        let pocket = this.k0 + this.untracked - o;
        for (let p = P; p !== 0; p &= p - 1) pocket++;
        if (pocket >= 1) this.relax((P * O + Math.min(o + 1, O - 1)) * n + c2, t1);
      }
      return;
    }
    // block
    if (kind & 1) {
      if (this.known(c2, P, o)) this.relax(node - c + c2, t1);
      else this.wait(c2, node, d, 1);
    }
    if (kind & 2) {
      const c3 = nb[c2 * 4 + d]!;
      if (c3 < 0 || !this.canHold[c3]) return;
      const g3 = grid[c3]!;
      if (g3 === KEY) {
        const bit = this.keyBit[c3]!;
        if (bit >= 0 && !(P & (1 << bit))) return;
      } else if (g3 === DOOR || g3 === BLOCK) {
        if (!this.known(c3, P, o)) {
          this.wait(c3, node, d, 2);
          return;
        }
      }
      this.relax(node - c + c2, t1);
    }
  }

  // ---------------------------------------------------------------- blocks
  // Block nodes (block i, cell x): B_i(x) = earliest time block i can stand on x (from its cell
  // in the state at time 0). A push from x to y = x + d needs the player on s = x − d (neither a
  // wall nor an exit, first reached by a clone at A(s)): time max(B_i(x), A(s)) + 1. y must be
  // floor or water: a key or door there was removed before (A(y) known); an unfilled water y is
  // either filled by block i (it sinks: block fill event, and blockReady for the player's fills)
  // or crossed, which needs y filled before by ANOTHER block (a block that sank is gone). Other
  // blocks are ignored. By induction, every real push of block i happens no earlier.

  private brelax(i: number, x: number, t: number): void {
    const k = i * this.n + x;
    if (t >= this.bdist[k]!) return;
    // whatever this block does from x is a fill (directly or after crossings) at a time
    // ≥ t + toWater[x]: useless past the limit
    if (t + this.toWater[x]! >= this.limit) return;
    this.bdist[k] = t;
    this.push(t, this.blockBase + k);
  }

  /** push of block i from x in direction d, evaluated at time now ≥ B_i(x) */
  private blockMove(i: number, x: number, d: number, now: number): void {
    const { nb, grid, base, isExit } = this.model;
    const n = this.n;
    const y = nb[x * 4 + d]!;
    const s = nb[x * 4 + (d ^ 1)]!;
    if (y < 0 || s < 0 || base[s] === WALL || isExit[s] || !this.canHold[y]) return;
    if (this.amin[s]! >= INF) {
      this.wait(s, i * n + x, d, 4);
      return;
    }
    const m = Math.max(now, this.amin[s]!) + 1;
    const g = grid[y]!;
    if (g === WATER) {
      // sinking: fill of y by block i (with the chain floor)
      const c = this.chain[y]!;
      if (c < INF && this.pre < INF && y !== this.forbidden)
        this.push(Math.max(m, this.pre + c), this.bfillBase + i * n + y);
      // crossing: y filled before by another block
      const b1 = this.fillB1[y]!;
      if ((b1 >= 0 && b1 !== i) || this.fillT2[y]! < INF) this.brelax(i, y, m);
      else this.wait(n + y, i * n + x, d, 4);
      return;
    }
    if (g === KEY || g === DOOR) {
      if (this.amin[y]! < INF) this.brelax(i, y, m);
      else this.wait(y, i * n + x, d, 4);
      return;
    }
    this.brelax(i, y, m);
  }

  /** block i can stand on x from time t: its moves, and readiness for the waters around */
  private blockSettled(i: number, x: number, t: number): void {
    const { nb, grid } = this.model;
    for (let d = 0; d < 4; d++) {
      const w = nb[x * 4 + d]!;
      if (w >= 0 && grid[w] === WATER && t < this.blockReady[w * 4 + d]!) {
        this.blockReady[w * 4 + d] = t;
        // pushers already settled on q = x − d
        const q = nb[x * 4 + (d ^ 1)]!;
        if (q >= 0)
          for (let s = this.settledHead[q]!; s >= 0; s = this.settledNext[s]!)
            this.fillEvent(Math.max(t, this.dist[s]!) + 1, this.nodes + 1 + s - q + w, w);
      }
      this.blockMove(i, x, d, t);
    }
  }

  /** block i sank into water w at time t: first two fills by distinct blocks */
  private blockFilled(i: number, w: number, t: number): void {
    if (this.fillB1[w]! < 0) {
      this.fillB1[w] = i;
      this.release(this.n + w, 0, 0, t, true);
    } else if (this.fillB1[w] !== i && this.fillT2[w]! >= INF) {
      this.fillT2[w] = t;
      this.release(this.n + w, 0, 0, t, true);
    }
  }

  /**
   * Fill chains of the loaded state: chain[w] = lower bound on the time of any fill of water w
   * (INF if no derivation). A fill of w by a push in direction d needs a block on x = w − d and
   * the player on q = w − 2d; if x or q is an unfilled water, that water was filled earlier, by
   * another block. cost(w, d) = 1 + min over blocks of pushDist(block, x) bounds the pushes of
   * the block that fills w (blocks may be shared here: it only lowers the sum). Least fixed point:
   * c(w) = min over d of cost(w, d) + [one water prerequisite p: c(p); two: max of the two].
   * By induction on the real fill order, c(w) ≤ the sum of cost(v) over a set of DISTINCT waters
   * filled at or before w (its prerequisites were filled before it, so w is not in their sets),
   * each by its own block: distinct push moves, all done before w's fill, after the walk to the
   * first push spot of a block (≥ walk0 = min relaxed walk from the player to a push spot). So
   * the fill time of w is ≥ walk0 + c(w).
   */
  private chainFloor(): void {
    const { n } = this;
    const { nb, grid, base, isExit } = this.model;
    const waters = this.waterCells;
    const chain = this.chain;
    const cost = this.fillCost;
    chain.fill(INF);
    // relaxed walk from the player (walls only) to the push spots of the blocks
    const dist = this.walk0;
    dist.fill(INF);
    const q = this.bfsQ;
    let tail = 0;
    dist[this.model.player] = 0;
    q[tail++] = this.model.player;
    for (let h = 0; h < tail; h++) {
      const c = q[h]!;
      for (let d = 0; d < 4; d++) {
        const m = nb[c * 4 + d]!;
        if (m < 0 || base[m] === WALL || dist[m]! < INF) continue;
        dist[m] = dist[c]! + 1;
        q[tail++] = m;
      }
    }
    let pre = INF;
    // near[x] = min over blocks of pushDist(block, x): multi-source BFS on the relaxed push graph
    // (a block moves to a floor or water cell, pusher neither a wall nor an exit; objects, other
    // blocks and sinking ignored): a lower bound on the pushes
    const near = this.near;
    near.fill(INF);
    tail = 0;
    for (let b = 0; b < n; b++) {
      if (grid[b] !== BLOCK) continue;
      near[b] = 0;
      q[tail++] = b;
      for (let d0 = 0; d0 < 4; d0++) {
        const s = nb[b * 4 + (d0 ^ 1)]!;
        if (s >= 0 && dist[s]! < pre) pre = dist[s]!;
      }
    }
    this.pre = pre;
    if (tail === 0) return;
    for (let h = 0; h < tail; h++) {
      const c = q[h]!;
      for (let d = 0; d < 4; d++) {
        const to = nb[c * 4 + d]!;
        if (to < 0 || !this.canHold[to] || near[to]! < INF) continue;
        const s = nb[c * 4 + (d ^ 1)]!;
        if (s < 0 || base[s] === WALL || isExit[s]) continue;
        near[to] = near[c]! + 1;
        q[tail++] = to;
      }
    }
    for (let i = 0; i < waters.length; i++) {
      const w = waters[i]!;
      for (let d = 0; d < 4; d++) cost[w * 4 + d] = INF;
      if (grid[w] !== WATER) continue;
      for (let d = 0; d < 4; d++) {
        const x = nb[w * 4 + (d ^ 1)]!;
        const s = x < 0 ? -1 : nb[x * 4 + (d ^ 1)]!;
        if (s < 0 || base[s] === WALL || isExit[s] || base[x] === WALL) continue;
        if (near[x]! < INF) cost[w * 4 + d] = near[x]! + 1;
      }
    }
    for (let changed = true; changed;) {
      changed = false;
      for (let i = 0; i < waters.length; i++) {
        const w = waters[i]!;
        if (grid[w] !== WATER) continue;
        let v = chain[w]!;
        for (let d = 0; d < 4; d++) {
          const c = cost[w * 4 + d]!;
          if (c >= INF) continue;
          const x = nb[w * 4 + (d ^ 1)]!;
          const s = nb[x * 4 + (d ^ 1)]!;
          const px = grid[x] === WATER ? chain[x]! : 0;
          const ps = grid[s] === WATER && s !== this.model.player ? chain[s]! : 0;
          if (px >= INF || ps >= INF) continue;
          const val = c + Math.max(px, ps);
          if (val < v) v = val;
        }
        if (v < chain[w]!) {
          chain[w] = v;
          changed = true;
        }
      }
    }
  }

  private pre = 0;

  /** fill event of water w at time t (not before its chain floor) */
  private fillEvent(t: number, id: number, w: number): void {
    if (w === this.forbidden) return;
    const c = this.chain[w]!;
    if (c >= INF || this.pre >= INF) return;
    this.push(Math.max(t, this.pre + c), id);
  }

  /**
   * timed relaxation (see the top of the file) of the state loaded in the model: lower bound of
   * the moves to the exit, UNREACHABLE if the relaxed game cannot reach it, or `limit` as soon
   * as the bound is known to be ≥ limit.
   */
  tdr(limit = INF): number {
    this.limit = limit;
    const { n } = this;
    const model = this.model;
    const { grid, nb } = model;
    // tracked keys
    let keys = 0;
    for (let f = 0; f < model.fixedCount; f++) if (grid[model.fixedCell[f]!] === KEY) keys++;
    const tracked = keys <= this.maxTracked ? keys : 0;
    this.keyBit.fill(-1);
    if (tracked > 0) {
      let b = 0;
      for (let f = 0; f < model.fixedCount; f++) {
        const c = model.fixedCell[f]!;
        if (grid[c] === KEY) this.keyBit[c] = b++;
      }
    }
    this.k0 = model.keys;
    this.untracked = keys - tracked;
    const maxO =
      model.doorsLeft === 0
        ? 0
        : Math.max(0, Math.min(model.doorsLeft, this.k0 + keys, this.doorCap));
    const O = maxO + 1;
    this.layersO = O;
    this.subsets = 1 << tracked;
    const nodes = this.subsets * O * n;
    this.nodes = nodes;
    if (nodes + 1 > this.nodesCap) {
      this.nodesCap = nodes + 1;
      this.dist = new Int32Array(this.nodesCap);
      this.done = new Uint8Array(this.nodesCap);
      this.settledNext = new Int32Array(this.nodesCap);
    }
    this.dist.fill(INF, 0, nodes + 1);
    this.done.fill(0, 0, nodes + 1);
    this.amin.fill(INF);
    this.minO.fill(NONE);
    this.tauO.fill(NONE);
    this.blockReady.fill(INF);
    this.settledHead.fill(-1);
    this.waitHead.fill(-1);
    this.waitCount = 0;
    this.heapN = 0;
    this.pops = 0;
    this.fillB1.fill(-1);
    this.fillT2.fill(INF);
    let blocks = 0;
    for (let c = 0; c < n; c++) if (grid[c] === BLOCK) blocks++;
    if (blocks * n > this.bdist.length) {
      this.bdist = new Int32Array(blocks * n);
      this.bdone = new Uint8Array(blocks * n);
    }
    this.bdist.fill(INF, 0, blocks * n);
    this.bdone.fill(0, 0, blocks * n);
    const blockBase = 2 * nodes + 1;
    this.blockBase = blockBase;
    const bfillBase = blockBase + blocks * n;
    this.bfillBase = bfillBase;
    // the blocks of the state: on their cells at time 0
    for (let c = 0, i = 0; c < n; c++) if (grid[c] === BLOCK) this.brelax(i++, c, 0);
    const shift = this.maxTracked;
    this.chainFloor();
    this.relax(model.player, 0);
    // queue exhausted: dead state, or only "≥ limit" (block nodes are pruned against the limit)
    let result = limit < INF ? limit : UNREACHABLE;
    while (this.heapN > 0) {
      this.pop();
      const t = this.popT;
      const id = this.popI;
      if (t >= limit) {
        result = limit;
        break;
      }
      this.pops++;
      if (id === nodes) {
        result = t;
        break;
      }
      if (id >= bfillBase) {
        const k = id - bfillBase;
        const w = k % n;
        this.blockFilled((k - w) / n, w, t);
        continue;
      }
      if (id >= blockBase) {
        const k = id - blockBase;
        if (this.bdone[k] || t > this.bdist[k]!) continue;
        this.bdone[k] = 1;
        const x = k % n;
        this.blockSettled((k - x) / n, x, t);
        continue;
      }
      if (id > nodes) {
        // fill of water w by a clone of layer λ
        const s = id - nodes - 1;
        const w = s % n;
        const layer = (s - w) / n;
        const o = layer % O;
        const P = (layer - o) / O;
        const at = (w << shift) + P;
        if (this.tauO[at]! <= o) continue;
        this.tauO[at] = o;
        this.release(n + w, P, o, t);
        continue;
      }
      if (this.done[id] || t > this.dist[id]!) continue;
      this.done[id] = 1;
      const c = id % n;
      const layer = (id - c) / n;
      const o = layer % O;
      const P = (layer - o) / O;
      this.settledNext[id] = this.settledHead[c]!;
      this.settledHead[c] = id;
      if (this.amin[c]! >= INF) this.amin[c] = t;
      // c as the pusher of a fill in this layer
      for (let d = 0; d < 4; d++) {
        const x = nb[c * 4 + d]!;
        const w = x < 0 ? -1 : nb[x * 4 + d]!;
        if (w < 0 || grid[w] !== WATER) continue;
        const r = this.blockReady[w * 4 + d]!;
        if (r < INF) this.fillEvent(Math.max(r, t) + 1, nodes + 1 + id - c + w, w);
      }
      const at = (c << shift) + P;
      if (this.minO[at]! > o) {
        this.minO[at] = o;
        this.release(c, P, o, t);
      }
      for (let d = 0; d < 4; d++) this.move(id, d, t, 3);
    }
    return result;
  }

  /**
   * MANDATORY FILLS (h_fill) of the state loaded in the model; slow (one timed relaxation per
   * candidate water), for measurements. A water w is mandatory if the timed relaxation cannot
   * reach the exit when w can never be filled: every real game from the state fills w (the game
   * that never fills w is relaxed by tdr with w forbidden). This covers the waters that cut the
   * routes to the exit and those that cut access to the keys the doors need (the relaxation
   * counts keys and doors). Each mandatory water gets its own block (it sinks), so the pushes of
   * those blocks are distinct moves, at least the min-cost matching M of blocks to mandatory
   * waters on the relaxed push distance. Before the first of these pushes the player walks to a
   * push spot of one of these blocks (≥ pre, walls-only distance); after the last mandatory fill
   * it stands on the cell before that water and walks to the exit (≥ post). The three parts are
   * disjoint in time: h_fill = pre + M + post (0 without mandatory water, UNREACHABLE if
   * dead or fewer blocks than mandatory waters).
   */
  fill(): number {
    const { n } = this;
    const { nb, grid, base, isExit } = this.model;
    const shift = this.maxTracked;
    if (this.tdr() >= UNREACHABLE) return UNREACHABLE;
    // candidates: waters filled at least once by the relaxation
    const candidates: number[] = [];
    for (const w of this.waterCells) {
      if (grid[w] !== WATER) continue;
      let filled = false;
      for (let P = 0; P < 1 << shift && !filled; P++)
        if (this.tauO[(w << shift) + P] !== NONE) filled = true;
      if (filled) candidates.push(w);
    }
    const mandatory: number[] = [];
    for (const w of candidates) {
      this.forbidden = w;
      try {
        if (this.tdr() >= UNREACHABLE) mandatory.push(w);
      } finally {
        this.forbidden = -1;
      }
    }
    if (mandatory.length === 0) return 0;
    // relaxed push distance from each block (BFS as in chainFloor)
    const blocks: number[] = [];
    for (let c = 0; c < n; c++) if (grid[c] === BLOCK) blocks.push(c);
    if (blocks.length < mandatory.length) return UNREACHABLE;
    const BIG = 1e9;
    const cost = mandatory.map(() => new Array<number>(blocks.length).fill(BIG));
    const dist = new Int32Array(n);
    const q = this.bfsQ;
    blocks.forEach((b, j) => {
      dist.fill(INF);
      dist[b] = 0;
      q[0] = b;
      let tail = 1;
      for (let h = 0; h < tail; h++) {
        const c = q[h]!;
        for (let d = 0; d < 4; d++) {
          const to = nb[c * 4 + d]!;
          if (to < 0 || !this.canHold[to] || dist[to]! < INF) continue;
          const s = nb[c * 4 + (d ^ 1)]!;
          if (s < 0 || base[s] === WALL || isExit[s]) continue;
          dist[to] = dist[c]! + 1;
          q[tail++] = to;
        }
      }
      mandatory.forEach((w, i) => {
        if (dist[w]! < INF) cost[i]![j] = dist[w]!;
      });
    });
    const M = minCostAssignment(cost);
    if (M >= BIG) return UNREACHABLE;
    // walls-only walk from the player to a push spot of a useful block
    const walk = this.walk0; // filled by chainFloor during the last tdr() (same player)
    let pre = INF;
    blocks.forEach((b, j) => {
      if (!cost.some((row) => row[j]! < BIG)) return;
      for (let d0 = 0; d0 < 4; d0++) {
        const s = nb[b * 4 + (d0 ^ 1)]!;
        if (s >= 0 && !isExit[s] && walk[s]! < pre) pre = walk[s]!;
      }
    });
    // walk from the cell before a mandatory water to the exit
    let post = INF;
    const toExit = this.compact.toExit;
    for (const w of mandatory)
      for (let d = 0; d < 4; d++) {
        const x = nb[w * 4 + (d ^ 1)]!;
        const s = x < 0 ? -1 : nb[x * 4 + (d ^ 1)]!;
        if (s < 0 || base[s] === WALL || isExit[s] || base[x] === WALL) continue;
        if (toExit[x]! < post) post = toExit[x]!;
      }
    if (pre >= INF || post >= INF) return UNREACHABLE;
    return pre + M + post;
  }

  /**
   * Admissible lower bound of the moves to win from the state loaded in the model: max of the
   * compact bound (exit distance, distinct doors and keys) and the timed relaxation; returns a
   * value ≥ limit as soon as it is known to be ≥ limit (UNREACHABLE: the state cannot win).
   * External searches prune a state of cost g when g + value(best − g) ≥ best.
   */
  value(limit = INF): number {
    const cheap = this.compact.strong();
    if (cheap >= limit) return cheap;
    const t = this.tdr(limit);
    return t > cheap ? t : cheap;
  }
}

/**
 * minimum cost of assigning each row to a distinct column (rows ≤ columns), Hungarian algorithm
 * (potentials, O(rows² · columns))
 */
export function minCostAssignment(cost: number[][]): number {
  const n = cost.length;
  if (n === 0) return 0;
  const m = cost[0]!.length;
  const u = new Float64Array(n + 1);
  const v = new Float64Array(m + 1);
  const p = new Int32Array(m + 1); // row matched to column j (1-based), 0: none
  const way = new Int32Array(m + 1);
  for (let i = 1; i <= n; i++) {
    p[0] = i;
    let j0 = 0;
    const minv = new Float64Array(m + 1).fill(Infinity);
    const used = new Uint8Array(m + 1);
    do {
      used[j0] = 1;
      const i0 = p[j0]!;
      let delta = Infinity;
      let j1 = 0;
      for (let j = 1; j <= m; j++) {
        if (used[j]) continue;
        const cur = cost[i0 - 1]![j - 1]! - u[i0]! - v[j]!;
        if (cur < minv[j]!) {
          minv[j] = cur;
          way[j] = j0;
        }
        if (minv[j]! < delta) {
          delta = minv[j]!;
          j1 = j;
        }
      }
      for (let j = 0; j <= m; j++) {
        if (used[j]) {
          u[p[j]!]! += delta;
          v[j]! -= delta;
        } else minv[j]! -= delta;
      }
      j0 = j1;
    } while (p[j0] !== 0);
    do {
      const j1 = way[j0]!;
      p[j0] = p[j1]!;
      j0 = j1;
    } while (j0 !== 0);
  }
  let total = 0;
  for (let j = 1; j <= m; j++) if (p[j]! > 0) total += cost[p[j]! - 1]![j - 1]!;
  return total;
}
