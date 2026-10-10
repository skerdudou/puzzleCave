// Static analysis of a level and dead-state test (step A of the event planner study).
//
// Everything here is an OVER-approximation of what can still happen, so that `dead()` never
// declares a live state dead: a block may only move where a relaxed push allows it (other blocks,
// keys and doors ignored; unfilled water crossed as if already filled), the player walks through
// doors, keys and movable blocks. Only walls, gravel (for blocks) and the exit (which ends the
// game: nobody stands on it to push) are taken as they are.
import { BLOCK, DOOR, KEY, WALL, WATER, type CompactModel } from './compactModel';

const INF = 0x3fffffff;

/** what a dead() call found (tests, reports) */
export type DeadReason =
  | 'alive'
  /** no relaxed route to an exit (immovable blocks are walls) */
  | 'no-route'
  /** a water on every route cannot get a block of its own */
  | 'required-water'
  /** fewer blocks able to fill water than waters on the cheapest route */
  | 'blocks'
  /** fewer keys (pocket + remaining) than doors on every route */
  | 'keys';

export interface ExitEntrance {
  /** cell next to an exit from which the player steps in */
  cell: number;
  /** waters and doors on every relaxed route from the start to this entrance (cuts) */
  waters: number[];
  doors: number[];
}

/**
 * Per-level analysis on a CompactModel: block reach sets (relaxed pushes), which blocks can fill
 * which water, immovable cells, exit entrances; and `dead()` on the state loaded in the model:
 *
 * 1. relaxed route to an exit, immovable blocks counting as walls;
 * 2. resource route: 0-1 search over (cell, doors crossed ≤ K) minimising the waters entered,
 *    K = keys in pocket + remaining keys (each door crossed costs one key, the key debt included:
 *    a negative pocket lowers K). No route with ≤ K doors → dead ('keys');
 * 3. required waters: those on every resource route (single-cell cuts, tested by removing each
 *    water of the cheapest route); wmin = waters of the cheapest route;
 * 4. bipartite matching blocks → unfilled waters (block b can fill w if w is in b's relaxed reach):
 *    the required waters must all be matched ('required-water') and the matching must have ≥ wmin
 *    edges ('blocks'). Each water entered must be filled first, by a block of its own (a block
 *    that sinks is consumed), hence the soundness.
 *
 * The door budget dimension is only used up to MAX_DOOR_LAYERS; beyond, doors are free (relaxed).
 */
export class DeadlockAnalysis {
  readonly n: number;
  /** a block standing on c can never be pushed (walls, gravel, exits around it) */
  readonly immovable: Uint8Array;
  /** water cells (unfilled at the start, not inert) and their index */
  readonly waterCells: Int32Array;
  readonly waterIndex: Int32Array;
  /** fill[w * words32 + (c >>> 5)]: a block on c can reach water w through relaxed pushes */
  private readonly fill: Uint32Array;
  private readonly cw: number;
  readonly entrances: ExitEntrance[];
  lastReason: DeadReason = 'alive';

  // work arrays
  private readonly dist: Int32Array;
  private readonly deque: Int32Array;
  private readonly blocks: Int32Array;
  private readonly matchW: Int32Array;
  private readonly matchB: Int32Array;
  private readonly seenB: Uint32Array;
  private readonly prev: Int32Array;
  private seenEpoch = 0;
  private layers = 0;

  static readonly MAX_DOOR_LAYERS = 4;

  constructor(private readonly model: CompactModel) {
    const { n, nb, base, isExit, holdsBlock } = model;
    this.n = n;
    const standable = (c: number) => c >= 0 && base[c] !== WALL && !isExit[c];
    const canEnter = (c: number) => c >= 0 && holdsBlock[c] === 1 && base[c] !== WALL;
    this.immovable = new Uint8Array(n);
    for (let c = 0; c < n; c++) {
      let mov = false;
      for (let k = 0; k < 4 && !mov; k++)
        mov = canEnter(nb[c * 4 + k]!) && standable(nb[c * 4 + (k ^ 1)]!);
      if (!mov) this.immovable[c] = 1;
    }
    const waters: number[] = [];
    for (let c = 0; c < n; c++) if (base[c] === WATER) waters.push(c);
    this.waterCells = Int32Array.from(waters);
    this.waterIndex = new Int32Array(n).fill(-1);
    waters.forEach((c, i) => (this.waterIndex[c] = i));
    this.cw = Math.ceil(n / 32);
    this.fill = new Uint32Array(waters.length * this.cw);
    // reverse BFS from each water over relaxed pushes f → c (player on the other side of f); a
    // cell a block cannot enter (gravel under an initial block) is a start, never a step
    const q = new Int32Array(n);
    const seen = new Uint8Array(n);
    waters.forEach((w, i) => {
      seen.fill(0);
      seen[w] = 1;
      q[0] = w;
      let tail = 1;
      for (let h = 0; h < tail; h++) {
        const c = q[h]!;
        if (h > 0) this.fill[i * this.cw + (c >>> 5)]! |= 1 << (c & 31);
        if (h > 0 && !canEnter(c)) continue;
        for (let k = 0; k < 4; k++) {
          // the block comes from f = c − d(k), pushed in direction k by a player on f − d(k)
          const f = nb[c * 4 + (k ^ 1)]!;
          if (f < 0 || seen[f] || base[f] === WALL) continue;
          if (!standable(nb[f * 4 + (k ^ 1)]!)) continue;
          seen[f] = 1;
          q[tail++] = f;
        }
      }
    });
    this.dist = new Int32Array(n * (DeadlockAnalysis.MAX_DOOR_LAYERS + 1));
    this.prev = new Int32Array(n * (DeadlockAnalysis.MAX_DOOR_LAYERS + 1));
    this.deque = new Int32Array(2 * n * (DeadlockAnalysis.MAX_DOOR_LAYERS + 1) + 2);
    this.blocks = new Int32Array(n);
    this.matchW = new Int32Array(waters.length);
    this.matchB = new Int32Array(n);
    this.seenB = new Uint32Array(n);
    this.entrances = this.computeEntrances();
  }

  /** a block on cell c can reach (and fill) water cell w through relaxed pushes */
  canFill(c: number, w: number): boolean {
    const i = this.waterIndex[w]!;
    if (i < 0) return false;
    return ((this.fill[i * this.cw + (c >>> 5)]! >>> (c & 31)) & 1) === 1;
  }

  /** cells a block on c can reach through relaxed pushes (c included) */
  blockReach(c: number): number[] {
    const { nb, base, isExit, holdsBlock } = this.model;
    const standable = (x: number) => x >= 0 && base[x] !== WALL && !isExit[x];
    const seen = new Set([c]);
    const q = [c];
    for (let h = 0; h < q.length; h++) {
      const f = q[h]!;
      for (let k = 0; k < 4; k++) {
        const to = nb[f * 4 + k]!;
        if (to < 0 || seen.has(to) || !holdsBlock[to] || base[to] === WALL) continue;
        if (!standable(nb[f * 4 + (k ^ 1)]!)) continue;
        seen.add(to);
        q.push(to);
      }
    }
    return [...seen].sort((a, b) => a - b);
  }

  /** cells from which a block can fill water w */
  fillers(w: number): number[] {
    const out: number[] = [];
    for (let c = 0; c < this.n; c++) if (this.canFill(c, w)) out.push(c);
    return out;
  }

  /** the loaded state can no longer be won (sound: never true for a winnable state) */
  dead(): boolean {
    this.calls++;
    this.lastReason = this.check();
    if (this.lastReason === 'alive') return false;
    this.deadCount++;
    return true;
  }

  /** statistics: dead() calls and states found dead */
  calls = 0;
  deadCount = 0;

  private check(): DeadReason {
    const m = this.model;
    const { grid, n } = m;
    // key budget: pocket (possibly negative) + keys still on the map
    let keysLeft = 0;
    for (let f = 0; f < m.fixedCount; f++) if (grid[m.fixedCell[f]!] === KEY) keysLeft++;
    const budget = m.keys + keysLeft;
    this.layers = budget < 0 ? 0 : Math.min(budget, m.doorsLeft, DeadlockAnalysis.MAX_DOOR_LAYERS);
    // doors are only counted when the budget is below the remaining doors
    const countDoors = budget < m.doorsLeft && budget <= DeadlockAnalysis.MAX_DOOR_LAYERS;
    const wmin = this.route(-1, countDoors);
    if (wmin === INF) {
      if (this.route(-1, false) === INF) return 'no-route';
      return 'keys';
    }
    // waters of the cheapest route
    const path: number[] = [];
    for (let s = this.lastEnd; s >= 0; s = this.prev[s]!) {
      const c = s % n;
      if (c !== m.player && grid[c] === WATER && path[path.length - 1] !== c) path.push(c);
    }
    if (path.length === 0) return 'alive';
    // blocks of the state
    let nbk = 0;
    for (let c = 0; c < n; c++) if (grid[c] === BLOCK && !this.immovable[c]) this.blocks[nbk++] = c;
    if (nbk < wmin) return 'blocks';
    // fast path: the waters of this route can all get a block of their own (they include the
    // required ones, and there are wmin of them)
    this.matchW.fill(-1);
    this.matchB.fill(-1);
    let all = true;
    for (const w of path) if (!this.augment(this.waterIndex[w]!, nbk)) all = false;
    if (all) return 'alive';
    this.matchW.fill(-1);
    this.matchB.fill(-1);
    let size = 0;
    // required waters first: each must be matched
    for (const w of path) {
      if (this.route(w, countDoors) !== INF) continue;
      if (!this.augment(this.waterIndex[w]!, nbk)) return 'required-water';
      size++;
    }
    if (size >= wmin) return 'alive';
    // then any water, until wmin edges
    const { waterCells } = this;
    for (let i = 0; i < waterCells.length && size < wmin; i++) {
      if (this.matchW[i]! >= 0 || grid[waterCells[i]!] !== WATER) continue;
      if (this.augment(i, nbk)) size++;
    }
    return size >= wmin ? 'alive' : 'blocks';
  }

  private lastEnd = -1;

  /**
   * 0-1 search from the player over (cell, doors crossed) minimising the waters entered; `avoid`
   * is a water cell taken as a wall (-1: none). Returns the waters of the cheapest route to an
   * exit (INF if none); lastEnd/prev give the route.
   */
  private route(avoid: number, countDoors: boolean): number {
    const m = this.model;
    const { nb, grid, isExit, n } = m;
    const L = countDoors ? this.layers + 1 : 1;
    const size = n * L;
    const dist = this.dist;
    const prev = this.prev;
    dist.fill(INF, 0, size);
    const dq = this.deque;
    const mid = size + 1;
    let head = mid;
    let tail = mid;
    const s0 = m.player;
    dist[s0] = 0;
    prev[s0] = -1;
    dq[tail++] = s0;
    this.lastEnd = -1;
    while (head < tail) {
      const s = dq[head++]!;
      const c = s % n;
      const layer = (s - c) / n;
      const d0 = dist[s]!;
      if (isExit[c]) {
        this.lastEnd = s;
        return d0;
      }
      for (let k = 0; k < 4; k++) {
        const to = nb[c * 4 + k]!;
        if (to < 0 || to === avoid) continue;
        const g = grid[to]!;
        if (g === WALL || (g === BLOCK && this.immovable[to])) continue;
        let nl = layer;
        if (g === DOOR && countDoors) {
          nl = layer + 1;
          if (nl >= L) continue;
        }
        const w = g === WATER ? 1 : 0;
        const t = nl * n + to;
        const nd = d0 + w;
        if (nd >= dist[t]!) continue;
        dist[t] = nd;
        prev[t] = s;
        if (w === 0) dq[--head] = t;
        else dq[tail++] = t;
      }
    }
    return INF;
  }

  /** augmenting path from water index i (Kuhn) over the nbk blocks */
  private augment(i: number, nbk: number): boolean {
    this.seenEpoch++;
    return this.tryWater(i, nbk);
  }

  private tryWater(i: number, nbk: number): boolean {
    const base = i * this.cw;
    for (let j = 0; j < nbk; j++) {
      const c = this.blocks[j]!;
      if (((this.fill[base + (c >>> 5)]! >>> (c & 31)) & 1) === 0) continue;
      if (this.seenB[j] === this.seenEpoch) continue;
      this.seenB[j] = this.seenEpoch;
      const other = this.matchB[j]!;
      if (other < 0 || this.tryWater(other, nbk)) {
        this.matchB[j] = i;
        this.matchW[i] = j;
        return true;
      }
    }
    return false;
  }

  /** exit entrances of the start state, with the waters and doors on every route to them */
  private computeEntrances(): ExitEntrance[] {
    const m = this.model;
    const { nb, base, isExit, n } = m;
    const startCell = m.start.player.y * m.width + m.start.player.x;
    const reach = (target: number, avoid: number): boolean => {
      const seen = new Uint8Array(n);
      const q = [startCell];
      seen[startCell] = 1;
      for (let h = 0; h < q.length; h++) {
        const c = q[h]!;
        if (c === target) return true;
        for (let k = 0; k < 4; k++) {
          const to = nb[c * 4 + k]!;
          if (to < 0 || to === avoid || seen[to] || base[to] === WALL || isExit[to]) continue;
          seen[to] = 1;
          q.push(to);
        }
      }
      return false;
    };
    const out: ExitEntrance[] = [];
    const doorCells = new Set<number>();
    for (let f = 0; f < m.fixedCount; f++) if (!m.fixedIsKey[f]) doorCells.add(m.fixedCell[f]!);
    for (let e = 0; e < n; e++) {
      if (!isExit[e]) continue;
      for (let k = 0; k < 4; k++) {
        const c = nb[e * 4 + k]!;
        if (c < 0 || base[c] === WALL || isExit[c] || out.some((x) => x.cell === c)) continue;
        if (!reach(c, -1)) continue;
        const waters: number[] = [];
        const doors: number[] = [];
        for (const w of this.waterCells) if (w === c || !reach(c, w)) waters.push(w);
        for (const d of doorCells) if (d === c || !reach(c, d)) doors.push(d);
        out.push({ cell: c, waters, doors });
      }
    }
    return out;
  }
}
