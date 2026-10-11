// Long-run external search: on-disk layout shared by the coordinator and the workers.
//
// Record (Uint32 words): the packed macro-state key (CompactModel, `words` words), then
// [parent layer (high 16 bits) | parent partition (low 16 bits)], parent index in its run file,
// [edge (cell × 4 + direction, low 16 bits)]. The same layout is used by the bucket segments
// (generated successors, transient) and by the run files (expanded states, kept for duplicate
// detection and for rebuilding the path). Both are written in blocks: a bucket segment is one
// block, a run file is a sequence of blocks listed in the manifest. A block is stored raw or
// packed (compress below): each word XOR the same word of the previous record (records of a
// partition share most of their bits), then the non-zero bytes only, with a 4-bit mask per word.
// ~2× smaller on pc-11/pc-12 for ~5 ns per byte. zstd (node:zlib) packs ~2.6× but costs
// ~70 µs per call in context setup, and its allocations serialize the threads: it was 65 % of
// the workers' time on pc-11.
import { join } from 'node:path';

let packBuf = new Uint8Array(0);
let unpackBuf = new Uint32Array(0);

/**
 * stored bytes of a block of records of R words: packed, or the raw bytes if not smaller. The
 * result may alias an internal buffer (valid until the next call in this thread).
 */
export function compress(bytes: Uint8Array, R: number): Uint8Array {
  const words = new Uint32Array(bytes.buffer, bytes.byteOffset, bytes.length >>> 2);
  const n = words.length;
  const need = bytes.length + (n >>> 1) + 8;
  if (packBuf.length < need) packBuf = new Uint8Array(need * 2);
  const out = packBuf;
  let o = 0;
  let maskAt = 0;
  for (let i = 0; i < n; i++) {
    const v = (words[i]! ^ (i >= R ? words[i - R]! : 0)) >>> 0;
    let mask = 0;
    if ((i & 1) === 0) {
      maskAt = o++;
      out[maskAt] = 0;
    }
    if (v !== 0) {
      if (v & 0xff) {
        mask |= 1;
        out[o++] = v & 0xff;
      }
      if (v & 0xff00) {
        mask |= 2;
        out[o++] = (v >>> 8) & 0xff;
      }
      if (v & 0xff0000) {
        mask |= 4;
        out[o++] = (v >>> 16) & 0xff;
      }
      if (v >>> 24) {
        mask |= 8;
        out[o++] = v >>> 24;
      }
      out[maskAt]! |= (i & 1) === 0 ? mask : mask << 4;
    }
    if (o >= bytes.length) return bytes;
  }
  return out.subarray(0, o);
}

/**
 * records of a block stored in `stored` (raw size rawBytes); may alias an internal buffer
 * (valid until the next call in this thread)
 */
export function decompress(stored: Uint8Array, rawBytes: number, R: number): Uint32Array {
  if (stored.length === rawBytes)
    return new Uint32Array(stored.buffer, stored.byteOffset, rawBytes >>> 2);
  const n = rawBytes >>> 2;
  if (unpackBuf.length < n) unpackBuf = new Uint32Array(n * 2);
  const out = unpackBuf;
  let p = 0;
  let mask = 0;
  for (let i = 0; i < n; i++) {
    if ((i & 1) === 0) mask = stored[p++]!;
    const m = (i & 1) === 0 ? mask & 15 : mask >>> 4;
    let v = 0;
    if (m & 1) v |= stored[p++]!;
    if (m & 2) v |= stored[p++]! << 8;
    if (m & 4) v |= stored[p++]! << 16;
    if (m & 8) v |= stored[p++]! << 24;
    out[i] = (v ^ (i >= R ? out[i - R]! : 0)) >>> 0;
  }
  if (p !== stored.length) throw new Error('corrupt block');
  return out.subarray(0, n);
}

export const EXTRA_WORDS = 3;
/** parent layer of the root */
export const ROOT_LAYER = 0xffff;
/** largest layer (move count) a record can carry */
export const MAX_LAYER = 0xfffe;

export const recordWords = (words: number) => words + EXTRA_WORDS;

/** run file of a partition: the expanded states of every layer, appended layer after layer */
export const runFile = (dir: string, part: number) => join(dir, 'runs', `p${part}.bin`);
/** block list of a run file: triples (byte offset, stored bytes, records) */
export const RUN_INDEX_FIELDS = 3;
/** records per run block */
export const RUN_BLOCK = 4096;
export const genDir = (dir: string, layer: number) => join(dir, 'gen', `L${layer}`);
export const genFile = (dir: string, layer: number, worker: number) =>
  join(genDir(dir, layer), `w${worker}.bin`);
/**
 * index of a gen file (Float64 sextuples: target layer, partition, byte offset, records,
 * min f, stored bytes)
 */
export const indexFile = (bin: string) => bin.replace(/\.bin$/, '.idx');
export const INDEX_FIELDS = 6;

/** partition of a state from its 32-bit hash (parts: power of two) */
export const partOf = (hash: number, parts: number) => hash & (parts - 1);
/** sub-pass of a record when a bucket does not fit in memory (high hash bits) */
export const passOf = (hash: number, passes: number) => (hash >>> 20) % passes;

/** shared counters (SharedArrayBuffer) between the coordinator and the workers */
export interface Shared {
  /** [0]: best goal cost (upper bound, exclusive), [1]: stop flag (1 = stop requested) */
  ints: Int32Array;
  /** [0]: bytes currently on disk in the work dir, [1]: disk limit in bytes */
  disk: BigInt64Array;
}

export function makeShared(
  best: number,
  diskUsed: number,
  diskLimit: number,
): {
  intsBuf: SharedArrayBuffer;
  diskBuf: SharedArrayBuffer;
} {
  const intsBuf = new SharedArrayBuffer(8);
  const diskBuf = new SharedArrayBuffer(16);
  const ints = new Int32Array(intsBuf);
  ints[0] = best;
  const disk = new BigInt64Array(diskBuf);
  disk[0] = BigInt(Math.floor(diskUsed));
  disk[1] = BigInt(Math.floor(diskLimit));
  return { intsBuf, diskBuf };
}

export function openShared(intsBuf: SharedArrayBuffer, diskBuf: SharedArrayBuffer): Shared {
  return { ints: new Int32Array(intsBuf), disk: new BigInt64Array(diskBuf) };
}

/** lowers the shared best goal to `cost` if smaller */
export function lowerBest(s: Shared, cost: number): void {
  for (;;) {
    const cur = Atomics.load(s.ints, 0);
    if (cost >= cur) return;
    if (Atomics.compareExchange(s.ints, 0, cur, cost) === cur) return;
  }
}

/** thrown by a worker when the disk limit or a stop request interrupts its job */
export class StopError extends Error {
  constructor(readonly reason: 'disk' | 'stop') {
    super(reason === 'disk' ? 'disk limit reached' : 'stop requested');
  }
}

/** reserves `bytes` of disk; throws StopError past the limit */
export function takeDisk(s: Shared, bytes: number): void {
  if (Atomics.load(s.ints, 1) !== 0) throw new StopError('stop');
  const after = Atomics.add(s.disk, 0, BigInt(bytes)) + BigInt(bytes);
  if (after > Atomics.load(s.disk, 1)) {
    Atomics.store(s.ints, 1, 2);
    throw new StopError('disk');
  }
}

export function giveDisk(s: Shared, bytes: number): void {
  Atomics.sub(s.disk, 0, BigInt(bytes));
}

/** one job: bucket (layer, part) */
export interface JobSpec {
  layer: number;
  part: number;
  /** gen files of the segments */
  files: string[];
  /** segments: quadruples (file index, byte offset, records, stored bytes) */
  segments: number[];
  /**
   * records already in the run file of the partition (earlier layers); parent indices are
   * record indices in that file
   */
  closed: number;
  /** blocks of the run file (RUN_INDEX_FIELDS each) and its size: new blocks are appended */
  runBlocks: number[];
  runBytes: number;
}

export interface Goal {
  cost: number;
  layer: number;
  part: number;
  index: number;
  edge: number;
}

export interface JobResult {
  part: number;
  /** records loaded from the bucket (with duplicates) */
  loaded: number;
  /** distinct states of the bucket */
  unique: number;
  /** already expanded at a smaller cost */
  closedDup: number;
  /** strong bound: f ≥ best goal (or dead) */
  pruned: number;
  /** dead states (deadPruning) */
  dead: number;
  /** successors dropped by the strong bound at generation (genStrongSlack) */
  genPruned: number;
  /** written to the run file and expanded */
  expanded: number;
  /** successors emitted (after pruning) */
  emitted: number;
  /** emissions dropped by the worker's recent-successor cache */
  cached: number;
  passes: number;
  goal?: Goal;
  /** a successor beyond the horizon was dropped */
  truncated: boolean;
  /** blocks appended to the run file, and their bytes */
  runBlocks: number[];
  runBytes: number;
  ms: { load: number; closed: number; expand: number };
}

export interface LayerEnd {
  /** gen file of the layer for this worker, if any record was written */
  file?: string;
  bytes: number;
}
