// Estimate of the remaining number of moves, to GUIDE the solution search (findSolution): port of
// the study prototype (the "doors" and "first water" lower bounds), on the loaded state of the
// compact model. It is used neither to prove a bound nor to guarantee an optimum; only the
// detection of dead states (DEAD) prunes.
import { BLOCK, DOOR, KEY, WALL, WATER, type CompactModel } from '../compactModel';
import type { GameState } from '../types';

export const DEAD = 0x3fffffff;

export class Guide {
  private readonly n: number;
  /** wall-free distance (inert objects included) to the nearest exit */
  private readonly toExit: Int32Array;
  /** wall-free distance from each initial key (indexed by the key's cell) */
  private readonly fromKey = new Map<number, Int32Array>();
  /** cells of the initial keys */
  private readonly keyCells: number[] = [];
  /** initial waters and relaxed (static) push distances from each cell to each of them */
  private readonly waterIndex: Int32Array;
  private readonly pushDist: Int32Array[] = [];
  private readonly work: Int32Array;
  private readonly region: Uint8Array;
  private readonly queue: Int32Array;
  private readonly frontier: Int32Array;

  constructor(private readonly model: CompactModel) {
    const { n, nb, base, isExit } = model;
    this.n = n;
    const wall = (i: number) => base[i] === WALL;
    const exits: number[] = [];
    for (let i = 0; i < n; i++) if (isExit[i]) exits.push(i);
    this.toExit = this.distances(exits, wall);
    for (let f = 0; f < model.fixedCount; f++) {
      if (!model.fixedIsKey[f]) continue;
      const k = model.fixedCell[f]!;
      this.keyCells.push(k);
      this.fromKey.set(k, this.distances([k], wall));
    }
    this.work = new Int32Array(n);
    this.waterIndex = new Int32Array(n).fill(-1);
    this.region = new Uint8Array(n);
    this.queue = new Int32Array(n * 2);
    this.frontier = new Int32Array(n);
    // relaxed push graph: a block goes from f to c = f + d if c is floor or water and if the
    // player's cell f − d is not a wall; reverse BFS from each (non-walled) water. Only the
    // destination c must accept a block: the origin f may be gravel (an initial block standing on
    // gravel can be pushed off it but never back onto it), so gravel is a start, never a step.
    const terrain = model.start.terrain;
    const canHold = (i: number) =>
      base[i] !== WALL && (terrain[i] === 'floor' || terrain[i] === 'water');
    for (let w = 0; w < n; w++) {
      if (base[w] !== WATER) continue;
      const d = new Int32Array(n).fill(DEAD);
      d[w] = 0;
      const q = [w];
      for (let h = 0; h < q.length; h++) {
        const c = q[h]!;
        if (c !== w && !canHold(c)) continue; // c (gravel) is reached as an origin only
        for (let k = 0; k < 4; k++) {
          const f = nb[c * 4 + (k ^ 1)]!; // cell the block comes from to reach c going in direction k
          if (f < 0) continue;
          const p = nb[f * 4 + (k ^ 1)]!; // cell of the pushing player
          if (p < 0 || base[f] === WALL || base[p] === WALL || d[f] !== DEAD) continue;
          d[f] = d[c]! + 1;
          q.push(f);
        }
      }
      this.waterIndex[w] = this.pushDist.length;
      this.pushDist.push(d);
    }
  }

  private distances(sources: readonly number[], blocked: (i: number) => boolean): Int32Array {
    const { n, nb } = this.model;
    const d = new Int32Array(n).fill(DEAD);
    const q = [...sources];
    for (const s of sources) d[s] = 0;
    for (let h = 0; h < q.length; h++) {
      const c = q[h]!;
      for (let k = 0; k < 4; k++) {
        const m = nb[c * 4 + k]!;
        if (m < 0 || d[m] !== DEAD || blocked(m)) continue;
        d[m] = d[c]! + 1;
        q.push(m);
      }
    }
    return d;
  }

  /** estimate for a game state (tests) */
  hOf(s: GameState): number {
    this.model.load(this.model.encode(s));
    return this.h();
  }

  /** estimate of the remainder for the state loaded in the model (max of the components); DEAD if dead */
  h(): number {
    const p = this.model.player;
    const direct = this.toExit[p]!;
    if (direct === DEAD) return DEAD;
    const doors = this.doorBound(p);
    if (doors === DEAD) return DEAD;
    const water = this.waterBound(p);
    if (water === DEAD) return DEAD;
    return Math.max(direct, doors, water);
  }

  /** minimum number of doors on a wall-free route (0-1 BFS), then detours for the keys */
  private doorBound(p: number): number {
    const { n } = this;
    const { nb, grid, isExit, keys: pocket } = this.model;
    const dist = this.work;
    dist.fill(DEAD);
    const dq = this.queue;
    let head = n;
    let tail = n;
    dq[tail++] = p;
    dist[p] = 0;
    let doors = DEAD;
    while (head < tail) {
      const c = dq[head++]!;
      if (isExit[c]) {
        doors = dist[c]!;
        break;
      }
      for (let d = 0; d < 4; d++) {
        const k = nb[c * 4 + d]!;
        if (k < 0 || grid[k] === WALL) continue;
        const w = grid[k] === DOOR ? 1 : 0;
        const nd = dist[c]! + w;
        if (nd >= dist[k]!) continue;
        dist[k] = nd;
        if (w === 0) dq[--head] = k;
        else dq[tail++] = k;
      }
    }
    if (doors === DEAD) return DEAD;
    // no door on the route: no key needed, even with a negative pocket key count
    if (doors === 0) return this.toExit[p]!;
    const need = doors - pocket;
    if (need <= 0) return this.toExit[p]!;
    const keys = this.keyCells.filter((k) => grid[k] === KEY);
    if (keys.length < need) return DEAD;
    let best = DEAD;
    if (need === 1) {
      for (const k of keys) best = Math.min(best, this.fromKey.get(k)![p]! + this.toExit[k]!);
      return best >= DEAD ? DEAD : best;
    }
    let delta = DEAD;
    for (let a = 0; a < keys.length; a++) {
      const da = this.fromKey.get(keys[a]!)!;
      for (let b = a + 1; b < keys.length; b++) delta = Math.min(delta, da[keys[b]!]!);
    }
    for (const k1 of keys) {
      const d1 = this.fromKey.get(k1)![p]!;
      for (const k2 of keys)
        if (k2 !== k1) best = Math.min(best, d1 + (need - 1) * delta + this.toExit[k2]!);
    }
    return best >= DEAD ? DEAD : best;
  }

  /** if the exit is behind water: bring a block into a frontier water, then go to the exit */
  private waterBound(p: number): number {
    const { n, region, frontier } = this;
    const { nb, grid, isExit } = this.model;
    // starting on the exit: it is enough to leave it and come back
    if (isExit[p]) return this.toExit[p]!;
    region.fill(0);
    const dist = this.work;
    dist.fill(DEAD);
    dist[p] = 0;
    const q = this.queue;
    let head = 0;
    let tail = 0;
    let fronts = 0;
    q[tail++] = p;
    region[p] = 1;
    while (head < tail) {
      const c = q[head++]!;
      for (let d = 0; d < 4; d++) {
        const k = nb[c * 4 + d]!;
        if (k < 0 || region[k] || grid[k] === WALL) continue;
        region[k] = 1;
        if (isExit[k]) return this.toExit[p]!;
        if (grid[k] === WATER) {
          frontier[fronts++] = k;
          continue;
        }
        dist[k] = dist[c]! + 1;
        q[tail++] = k;
      }
    }
    if (fronts === 0) return DEAD;
    let best = DEAD;
    for (let b = 0; b < n; b++) {
      if (grid[b] !== BLOCK) continue;
      let adj = DEAD;
      for (let d = 0; d < 4; d++) {
        const m = nb[b * 4 + d]!;
        if (m >= 0) adj = Math.min(adj, dist[m]!);
      }
      for (let i = 0; i < fronts; i++) {
        const w = frontier[i]!;
        const pd = this.pushDist[this.waterIndex[w]!]![b]!;
        if (pd !== DEAD) best = Math.min(best, adj + pd + 1 + this.toExit[w]!);
      }
    }
    return best >= DEAD ? DEAD : best;
  }
}
