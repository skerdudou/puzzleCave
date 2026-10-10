import { initialState } from './state';
import type { GameState, LevelData, ObjKind, Terrain } from './types';

// Grid codes of a loaded macro-state
export const FREE = 0; // floor, gravel or filled water, no object: walking passes through
export const WALL = 1; // wall, or object placed on a wall or on water (inert forever)
export const WATER = 2; // unfilled water
export const EXIT = 3;
export const KEY = 4;
export const DOOR = 5;
export const BLOCK = 6;

const KEYS_OFFSET = 0x8000;
/** order of state.DIRS: up, down, left, right */
const DX = [0, 0, -1, 1];
const DY = [-1, 1, 0, 0];

export interface Successor {
  /** start tile of the interaction × 4 + direction */
  edge: number;
  /** walking moves before the interaction */
  walk: number;
  /** player tile after the interaction */
  cell: number;
  won: boolean;
  /** key of the next macro-state (empty if won) */
  next: number[];
}

/** Receives the successors of an expansion; the next key is in model.next. */
export interface SuccessorSink {
  /** false interrupts the expansion */
  succ(edge: number, walk: number, cell: number, won: boolean): boolean;
}

/**
 * Compact model of a level for the solver: static precomputations and a macro-state packed into
 * `words` Uint32 words:
 * - word 0: player tile (low 16 bits) and keys in pocket + 0x8000 (high 16 bits);
 * - then a bit field: keys/doors still present (they never move), filled water, and blocks on
 *   the candidate tiles (tiles a block can reach through relaxed pushes: floor or water target,
 *   player on a non-wall tile — an exact superset).
 * Expansion applies the rules of step.ts directly (the single source of truth, checked by the
 * tests): walking by BFS over floor/gravel/filled water without objects; interaction on entering
 * a key (picked up), a door (opened if keys > 0, one key fewer), a block (pushed if the tile
 * behind is floor or water without an object; in water it sinks and fills it) or the exit (won).
 * Unfilled water stops the player (normal mode: you never drown in it).
 */
export class CompactModel {
  readonly width: number;
  readonly height: number;
  readonly n: number;
  readonly words: number;
  readonly start: GameState;
  /** static grid (FREE, WALL, WATER, EXIT) */
  readonly base: Uint8Array;
  /** neighbor of each tile in each direction, -1 outside the map */
  readonly nb: Int32Array;
  readonly isExit: Uint8Array;
  /** original floor or water: a block can be pushed there */
  readonly holdsBlock: Uint8Array;
  readonly fixedCount: number;
  readonly fixedCell: Int32Array;
  readonly fixedIsKey: Uint8Array;
  readonly waterCount: number;
  readonly blockCells: number;
  /** bit (absolute) of each tile: key/door, water, block; -1 otherwise */
  readonly fixedBit: Int32Array;
  readonly waterBit: Int32Array;
  readonly blockBit: Int32Array;
  /** tile and grid code of each bit (from bit 32) */
  readonly bitCell: Int32Array;
  readonly bitCode: Uint8Array;
  private readonly inertObjects: (ObjKind | null)[];

  // loaded macro-state
  readonly cur: Uint32Array;
  readonly next: Uint32Array;
  readonly grid: Uint8Array;
  player = 0;
  keys = 0;
  doorsLeft = 0;
  // walking BFS
  readonly dist: Int32Array;
  readonly via: Uint8Array;
  readonly order: Int32Array;
  private readonly mark: Uint32Array;
  /** bits of the present keys/doors and filled water in a state key (word 0 excluded) */
  readonly fixedMask: Uint32Array;
  readonly waterMask: Uint32Array;
  private epoch = 0;

  /** of a level, or of a game state taken as the start (move counter ignored) */
  constructor(level: LevelData | GameState) {
    const start: GameState =
      'player' in level
        ? { ...level, moves: 0, status: 'playing', mode: 'normal' }
        : initialState(level, 'normal');
    this.start = start;
    const { width, height } = start;
    const n = width * height;
    this.width = width;
    this.height = height;
    this.n = n;
    if (n > 0x4000) throw new Error('map too large for the compact solver');
    this.nb = new Int32Array(n * 4);
    for (let c = 0; c < n; c++) {
      const x = c % width;
      const y = (c - x) / width;
      for (let d = 0; d < 4; d++) {
        const nx = x + DX[d]!;
        const ny = y + DY[d]!;
        this.nb[c * 4 + d] = nx < 0 || ny < 0 || nx >= width || ny >= height ? -1 : ny * width + nx;
      }
    }
    const terrain = start.terrain;
    this.base = new Uint8Array(n);
    this.isExit = new Uint8Array(n);
    this.holdsBlock = new Uint8Array(n);
    const inert = (i: number) => terrain[i] === 'wall' || terrain[i] === 'water';
    for (let i = 0; i < n; i++) {
      const t = terrain[i]!;
      this.base[i] = t === 'wall' ? WALL : t === 'water' ? WATER : t === 'exit' ? EXIT : FREE;
      if (t === 'exit') this.isExit[i] = 1;
      if (t === 'floor' || t === 'water') this.holdsBlock[i] = 1;
    }
    // object on a wall or on water: step() always blocks (the water cannot be filled,
    // a block cannot be pushed onto an object) — it is a wall
    this.inertObjects = start.objects.map((o, i) => (o !== null && inert(i) ? o : null));
    for (let i = 0; i < n; i++) if (this.inertObjects[i] !== null) this.base[i] = WALL;

    const fixed: number[] = [];
    const water: number[] = [];
    start.objects.forEach((o, i) => {
      if ((o === 'key' || o === 'door') && !inert(i)) fixed.push(i);
    });
    terrain.forEach((t, i) => {
      if (t === 'water' && this.inertObjects[i] === null) water.push(i);
    });
    // candidate block tiles: closure under relaxed pushes from the initial blocks
    const cand = new Uint8Array(n);
    const queue: number[] = [];
    start.objects.forEach((o, i) => {
      if (o === 'block' && !inert(i)) {
        cand[i] = 1;
        queue.push(i);
      }
    });
    for (let h = 0; h < queue.length; h++) {
      const c = queue[h]!;
      for (let d = 0; d < 4; d++) {
        const to = this.nb[c * 4 + d]!;
        const from = this.nb[c * 4 + (d ^ 1)]!;
        if (to < 0 || from < 0 || cand[to] || !this.holdsBlock[to] || this.base[from] === WALL)
          continue;
        cand[to] = 1;
        queue.push(to);
      }
    }
    const blocks: number[] = [];
    for (let i = 0; i < n; i++) if (cand[i]) blocks.push(i);

    this.fixedCount = fixed.length;
    this.waterCount = water.length;
    this.blockCells = blocks.length;
    this.fixedCell = Int32Array.from(fixed);
    this.fixedIsKey = Uint8Array.from(fixed, (i) => (start.objects[i] === 'key' ? 1 : 0));
    const bits = fixed.length + water.length + blocks.length;
    this.words = 1 + Math.ceil(bits / 32);
    this.fixedBit = new Int32Array(n).fill(-1);
    this.waterBit = new Int32Array(n).fill(-1);
    this.blockBit = new Int32Array(n).fill(-1);
    this.bitCell = new Int32Array(bits);
    this.bitCode = new Uint8Array(bits);
    let b = 0;
    fixed.forEach((c, i) => {
      this.fixedBit[c] = 32 + b;
      this.bitCell[b] = c;
      this.bitCode[b++] = this.fixedIsKey[i] ? KEY : DOOR;
    });
    for (const c of water) {
      this.waterBit[c] = 32 + b;
      this.bitCell[b] = c;
      this.bitCode[b++] = FREE;
    }
    for (const c of blocks) {
      this.blockBit[c] = 32 + b;
      this.bitCell[b] = c;
      this.bitCode[b++] = BLOCK;
    }

    this.fixedMask = new Uint32Array(this.words);
    this.waterMask = new Uint32Array(this.words);
    for (let k = 0; k < bits; k++) {
      const code = this.bitCode[k]!;
      if (code === BLOCK) continue;
      const mask = code === FREE ? this.waterMask : this.fixedMask;
      mask[(k + 32) >>> 5]! |= 1 << (k & 31);
    }

    this.cur = new Uint32Array(this.words);
    this.next = new Uint32Array(this.words);
    this.grid = new Uint8Array(n);
    this.dist = new Int32Array(n);
    this.via = new Uint8Array(n);
    this.order = new Int32Array(n);
    this.mark = new Uint32Array(n);
  }

  /** tile c was reached by the last BFS (explore or expand); distance in dist[c] */
  reached(c: number): boolean {
    return this.mark[c] === this.epoch;
  }

  /**
   * Canonical key of a state. Keys in pocket are clamped to [−remaining keys, remaining
   * doors]: beyond the remaining doors, one more key opens nothing; below −remaining keys, no
   * door will ever open again, same as at −remaining keys. Lengths are therefore unchanged, and
   * the counter fits in 16 bits even for extreme initial keys. The interval is preserved:
   * opening a door removes one key and one door, picking up a key adds a key and removes a
   * remaining key; expand only caps a picked-up key at the remaining doors. The key from expand
   * is therefore always the one from encode on the real state (tested along games), which the
   * windows require (arriving at an exact state).
   */
  encode(s: GameState): Uint32Array {
    const key = new Uint32Array(this.words);
    let keysLeft = 0;
    let doorsLeft = 0;
    for (let f = 0; f < this.fixedCount; f++) {
      const o = s.objects[this.fixedCell[f]!];
      if (o === 'key') keysLeft++;
      else if (o === 'door') doorsLeft++;
    }
    const keys = Math.max(-keysLeft, Math.min(doorsLeft, s.keys));
    key[0] = ((s.player.y * this.width + s.player.x) | ((keys + KEYS_OFFSET) << 16)) >>> 0;
    const set = (bit: number) => (key[bit >>> 5]! |= 1 << (bit & 31));
    for (let i = 0; i < this.n; i++) {
      const o = s.objects[i] ?? null;
      if (this.fixedBit[i]! >= 0 && (o === 'key' || o === 'door')) set(this.fixedBit[i]!);
      if (this.waterBit[i]! >= 0 && s.terrain[i] !== 'water') set(this.waterBit[i]!);
      if (o === 'block' && this.inertObjects[i] === null) {
        if (this.blockBit[i]! < 0) throw new Error(`block outside the candidate tiles (${i})`);
        set(this.blockBit[i]!);
      }
    }
    return key;
  }

  decode(key: Uint32Array, off = 0): GameState {
    const objects = this.inertObjects.slice();
    const terrain: Terrain[] = this.start.terrain.slice();
    for (let b = 0; b < this.bitCell.length; b++) {
      if (((key[off + ((b + 32) >>> 5)]! >>> (b & 31)) & 1) === 0) continue;
      const c = this.bitCell[b]!;
      const code = this.bitCode[b]!;
      if (code === FREE) terrain[c] = 'floor';
      else objects[c] = code === KEY ? 'key' : code === DOOR ? 'door' : 'block';
    }
    const w0 = key[off]!;
    const p = w0 & 0xffff;
    return {
      ...this.start,
      terrain,
      objects,
      keys: (w0 >>> 16) - KEYS_OFFSET,
      player: { x: p % this.width, y: Math.floor(p / this.width) },
    };
  }

  /** loads the macro-state `src[off…]` into cur, grid, player, keys, doorsLeft */
  load(src: Uint32Array, off = 0): void {
    const { cur, grid, bitCell, bitCode, words } = this;
    for (let j = 0; j < words; j++) cur[j] = src[off + j]!;
    grid.set(this.base);
    let doors = 0;
    for (let w = 1; w < words; w++) {
      let word = cur[w]!;
      while (word !== 0) {
        const low = word & -word;
        const b = ((w - 1) << 5) + (31 - Math.clz32(low));
        word ^= low;
        const code = bitCode[b]!;
        grid[bitCell[b]!] = code;
        if (code === DOOR) doors++;
      }
    }
    const w0 = cur[0]!;
    this.player = w0 & 0xffff;
    this.keys = (w0 >>> 16) - KEYS_OFFSET;
    this.doorsLeft = doors;
  }

  /** walking BFS from the player of the loaded state; returns the number of tiles reached */
  explore(): number {
    const { grid, nb, dist, via, order, mark } = this;
    const epoch = ++this.epoch;
    const origin = this.player;
    mark[origin] = epoch;
    dist[origin] = 0;
    order[0] = origin;
    let tail = 1;
    for (let head = 0; head < tail; head++) {
      const c = order[head]!;
      const dc = dist[c]! + 1;
      for (let d = 0; d < 4; d++) {
        const m = nb[c * 4 + d]!;
        if (m < 0 || grid[m] !== FREE || mark[m] === epoch) continue;
        mark[m] = epoch;
        dist[m] = dc;
        via[m] = d;
        order[tail++] = m;
      }
    }
    return tail;
  }

  /** walking path (directions) to tile c, from the last BFS */
  walkTo(c: number): number[] {
    const path: number[] = [];
    while (c !== this.player) {
      const d = this.via[c]!;
      path.push(d);
      c = this.nb[c * 4 + (d ^ 1)]!;
    }
    return path.reverse();
  }

  /** successors of the loaded state; false if the sink interrupted */
  expand(sink: SuccessorSink): boolean {
    const { grid, nb, dist, order, cur, next, words, isExit, mark } = this;
    const keys = this.keys;
    const keysWord = cur[0]! >>> 16;
    const keysCap = this.doorsLeft + KEYS_OFFSET;
    // walking BFS (like explore); a tile's interactions are emitted when it leaves
    // the queue, hence in BFS order
    const epoch = ++this.epoch;
    const origin = this.player;
    mark[origin] = epoch;
    dist[origin] = 0;
    order[0] = origin;
    let tail = 1;
    for (let k = 0; k < tail; k++) {
      const c = order[k]!;
      const walk = dist[c]!;
      for (let d = 0; d < 4; d++) {
        const m = nb[c * 4 + d]!;
        if (m < 0) continue;
        const g = grid[m]!;
        if (g === FREE) {
          if (mark[m] !== epoch) {
            mark[m] = epoch;
            dist[m] = walk + 1;
            order[tail++] = m;
          }
          continue;
        }
        if (g <= WATER) continue;
        const edge = c * 4 + d;
        if (g === EXIT) {
          if (!sink.succ(edge, walk, m, true)) return false;
          continue;
        }
        let w0: number;
        if (g === BLOCK) {
          const behind = nb[m * 4 + d]!;
          if (behind < 0) continue;
          const gb = grid[behind]!;
          if (!(gb === WATER || (gb === FREE && this.holdsBlock[behind]))) continue;
          for (let j = 1; j < words; j++) next[j] = cur[j]!;
          const from = this.blockBit[m]!;
          next[from >>> 5]! &= ~(1 << (from & 31));
          const to = gb === WATER ? this.waterBit[behind]! : this.blockBit[behind]!;
          if (to < 0) throw new Error('push outside the candidate tiles');
          next[to >>> 5]! |= 1 << (to & 31);
          w0 = keysWord;
        } else {
          if (g === DOOR && keys <= 0) continue;
          for (let j = 1; j < words; j++) next[j] = cur[j]!;
          const bit = this.fixedBit[m]!;
          next[bit >>> 5]! &= ~(1 << (bit & 31));
          // keys clamped to the remaining doors, like encode
          w0 = g === KEY ? Math.min(keysWord + 1, keysCap) : keysWord - 1;
        }
        next[0] = (m | (w0 << 16)) >>> 0;
        if (!sink.succ(edge, walk, m, isExit[m] === 1)) return false;
      }
    }
    return true;
  }

  /** tests: successors of a macro-state, with their keys */
  successors(key: Uint32Array): Successor[] {
    this.load(key);
    const out: Successor[] = [];
    this.expand({
      succ: (edge, walk, cell, won) => {
        out.push({ edge, walk, cell, won, next: won ? [] : [...this.next] });
        return true;
      },
    });
    return out;
  }
}
