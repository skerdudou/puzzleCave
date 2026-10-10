// Level preparation for the GPU engine (pure, no WebGPU): cell and bit tables,
// bit rows of the static grid, lower bound, and buffer plan within a VRAM budget.
//
// The GPU macro-state is exactly the compact engine's key (CompactModel, same words, same
// canonical form of the pocket keys): encoding, decoding and path reconstruction are those
// of the compact model, and both engines count the same states.
import { CompactModel, UNREACHABLE, WALL, type LevelData } from '@puzzlecave/core';

/** maximum width and height: a grid row fits in one word, one lane per row */
export const MAX_SIDE = 32;
/**
 * move-count horizon (beyond it: stop, never \"unsolvable\"): 65534 instead of 65535 for
 * the compact engine, since g and f fit in 16 bits with 0xFFFF meaning \"none\"
 */
export const MAX_F = 65534;
export const KEYS_OFFSET = 0x8000;
/** words of a candidate after the key: cost, parent, edge, table cell, then state index */
export const CAND_EXTRA = 4;

export interface GpuLayout {
  model: CompactModel;
  width: number;
  height: number;
  cells: number;
  words: number;
  /**
   * Contents of the `tbl` buffer:
   * - [0, cells) info0 = base code (FREE, WALL, WATER, EXIT) | holdsBlock << 3 | key << 4
   *   | (key/door bit + 1) << 16;
   * - [offInfo1, +cells) info1 = (water bit + 1) | (block bit + 1) << 16;
   * - [offExit, +cells) relaxed distance to the exit (UNREACHABLE if none);
   * - [offBit, +bits) cell | grid code << 16 of each bit (KEY, DOOR, FREE = filled water,
   *   BLOCK);
   * - [offWalk, +height) walkRows, [offExitRows, +height) exitRows, [offDoor, +words) doorMask.
   * Bits are relative to key word 1 (absolute bit − 32); 0 = none.
   */
  table: Uint32Array;
  offInfo1: number;
  offExit: number;
  offBit: number;
  offWalk: number;
  offExitRows: number;
  offDoor: number;
  /** bit rows of the FREE cells of the static grid */
  walkRows: Uint32Array;
  /** bit rows of the exits */
  exitRows: Uint32Array;
  /** door bits in each key word */
  doorMask: Uint32Array;
  toExit: Int32Array;
}

/** reason why the GPU engine cannot handle this level, or undefined */
export function gpuUnsupported(level: LevelData): string | undefined {
  if (level.width > MAX_SIDE) return `width ${level.width} > ${MAX_SIDE}`;
  if (level.height > MAX_SIDE) return `height ${level.height} > ${MAX_SIDE}`;
  return undefined;
}

export function makeLayout(level: LevelData): GpuLayout {
  const reason = gpuUnsupported(level);
  if (reason) throw new Error(`level not supported by the GPU: ${reason}`);
  const model = new CompactModel(level);
  const { width, height, n: cells, words, base, nb } = model;
  const bits = model.bitCell.length;
  const offInfo1 = cells;
  const offExit = 2 * cells;
  const offBit = 3 * cells;
  const offWalk = offBit + Math.max(1, bits);
  const offExitRows = offWalk + height;
  const offDoor = offExitRows + height;
  const table = new Uint32Array(offDoor + words);
  const rel = (abs: number) => (abs < 0 ? 0 : abs - 32 + 1);
  // relaxed distance to the exit (BFS where only walls stop, like CompactBound.toExit)
  const toExit = new Int32Array(cells).fill(UNREACHABLE);
  const queue: number[] = [];
  for (let c = 0; c < cells; c++)
    if (model.isExit[c]) {
      toExit[c] = 0;
      queue.push(c);
    }
  for (let h = 0; h < queue.length; h++) {
    const c = queue[h]!;
    for (let d = 0; d < 4; d++) {
      const m = nb[c * 4 + d]!;
      if (m < 0 || base[m] === WALL || toExit[m] !== UNREACHABLE) continue;
      toExit[m] = toExit[c]! + 1;
      queue.push(m);
    }
  }
  const fixedIsKey = new Uint8Array(cells);
  for (let f = 0; f < model.fixedCount; f++) fixedIsKey[model.fixedCell[f]!] = model.fixedIsKey[f]!;
  for (let c = 0; c < cells; c++) {
    table[c] =
      (base[c]! |
        (model.holdsBlock[c]! << 3) |
        (fixedIsKey[c]! << 4) |
        (rel(model.fixedBit[c]!) << 16)) >>>
      0;
    table[offInfo1 + c] = (rel(model.waterBit[c]!) | (rel(model.blockBit[c]!) << 16)) >>> 0;
    table[offExit + c] = toExit[c]!;
  }
  const doorMask = new Uint32Array(words);
  for (let b = 0; b < bits; b++) {
    table[offBit + b] = (model.bitCell[b]! | (model.bitCode[b]! << 16)) >>> 0;
    const cell = model.bitCell[b]!;
    if (model.fixedBit[cell] === b + 32 && !fixedIsKey[cell])
      doorMask[(b + 32) >>> 5]! |= 1 << (b & 31);
  }
  const walkRows = new Uint32Array(height);
  const exitRows = new Uint32Array(height);
  for (let c = 0; c < cells; c++) {
    const x = c % width;
    const y = (c - x) / width;
    if (base[c] === 0) walkRows[y]! |= 1 << x;
    if (model.isExit[c]) exitRows[y]! |= 1 << x;
  }
  table.set(walkRows, offWalk);
  table.set(exitRows, offExitRows);
  table.set(doorMask, offDoor);
  return {
    model,
    width,
    height,
    cells,
    words,
    table,
    offInfo1,
    offExit,
    offBit,
    offWalk,
    offExitRows,
    offDoor,
    walkRows,
    exitRows,
    doorMask,
    toExit,
  };
}

export interface BufferPlan {
  /** maximum number of stored states */
  storeCap: number;
  /** hash table slots (power of 2, load ≤ 75%) */
  tableSize: number;
  /** candidates (non-deduplicated successors) per batch */
  candCap: number;
  /** words per candidate */
  stride: number;
  /** key words stored in each bank (word j goes into bank j % 3) */
  banks: number[];
  /** VRAM bytes of the buffers */
  bytes: number;
}

/** fixed bytes: counters, goals, indirect arguments, uniforms, readback buffer */
const FIXED_BYTES = 1 << 20;
export const GOAL_CAP = 1 << 16;
/** 4-byte arrays per state: g and deferred, meta (edge, expanded g), parent, frontier (2), winner */
const PER_STATE_ARRAYS = 6;

/**
 * Buffer plan within `budgetBytes`: ~20% for candidates (at most 4 M), the rest for the states
 * (key + 6 arrays) and the hash table, choosing the table size (power of 2)
 * that stores the most states. Each buffer stays under maxBinding (2 GiB on D3D12). undefined if
 * the budget does not even allow 1024 states.
 */
export function planBuffers(
  words: number,
  budgetBytes: number,
  o: { maxBinding: number; maxStates?: number | undefined; maxCandidates?: number | undefined },
): BufferPlan | undefined {
  const banks = [0, 1, 2].map((k) => Math.max(0, Math.ceil((words - k) / 3)));
  const stride = words + CAND_EXTRA;
  const avail = budgetBytes - FIXED_BYTES - GOAL_CAP * 12;
  if (avail <= 0) return undefined;
  const candCap = Math.max(
    256,
    Math.min(
      o.maxCandidates ?? 4_000_000,
      Math.floor((avail * 0.2) / ((stride + 1) * 4)),
      Math.floor(o.maxBinding / (stride * 4)),
    ),
  );
  const rest = avail - candCap * (stride + 1) * 4;
  const perState = 4 * words + 4 * PER_STATE_ARRAYS;
  const byBinding = Math.floor(o.maxBinding / (4 * Math.max(1, banks[0]!)));
  let best: BufferPlan | undefined;
  for (let tableSize = 1024; tableSize * 4 <= Math.min(rest, o.maxBinding); tableSize *= 2) {
    const storeCap = Math.min(
      Math.floor(tableSize * 0.75),
      Math.floor((rest - 4 * tableSize) / perState),
      byBinding,
      o.maxStates ?? Infinity,
    );
    if (storeCap < 1024 && storeCap < (o.maxStates ?? Infinity)) continue;
    if (best && storeCap <= best.storeCap) continue;
    const bytes =
      FIXED_BYTES +
      GOAL_CAP * 12 +
      candCap * (stride + 1) * 4 +
      tableSize * 4 +
      storeCap * perState;
    best = { storeCap, tableSize, candCap, stride, banks, bytes };
  }
  return best;
}
