// Long-run external search: the work of one thread (a worker_threads worker, or the coordinator
// itself with --threads 0). A job is a bucket (layer G, partition p): load its segments,
// remove duplicates (inside the bucket, then against the run file of p: states already expanded
// at a smaller cost), compute the strong bound, append the survivors to the run file of p and
// expand them; successors are buffered by (target layer, target partition) and appended in
// compressed chunks to this worker's gen file of layer G.
import { closeSync, mkdirSync, openSync, readSync, writeSync } from 'node:fs';
import { dirname } from 'node:path';
import {
  CompactBound,
  CompactModel,
  DeadlockAnalysis,
  UNREACHABLE,
  hashWords,
  type LevelData,
  type SuccessorSink,
} from '@puzzlecave/core';
import {
  MAX_LAYER,
  RUN_BLOCK,
  RUN_INDEX_FIELDS,
  StopError,
  compress,
  decompress,
  genFile,
  indexFile,
  lowerBest,
  partOf,
  passOf,
  recordWords,
  runFile,
  takeDisk,
  type Goal,
  type JobResult,
  type JobSpec,
  type LayerEnd,
  type Shared,
} from './layout';
import { GpuBatchClient } from './gpuClient';
import type { BatchLane } from '@puzzlecave/gpu';

const MB = 1024 ** 2;
/** bytes of a bucket chunk (one target layer and partition) before it is written */
const CHUNK_BYTES = 64 * 1024;
/** initial capacity (records) of a chunk buffer, doubled up to CHUNK_BYTES */
const CHUNK_START = 16;
/** write buffer of the gen and run files */
const OUT_BYTES = 4 * MB;
/** fewer states to expand in a pass: on the CPU even with a GPU lane */
const GPU_MIN_STATES = 2048;

export interface ExpanderOptions {
  dir: string;
  parts: number;
  worker: number;
  /** memory of this thread in bytes (bucket tables + successor buffers + cache) */
  memoryBytes: number;
  /** recent-successor cache entries (0: none) */
  cacheEntries?: number | undefined;
  /**
   * strong bound on the successors too (not only when expanding): computed when
   * cost + toExit ≥ best − slack, the successor is dropped if cost + strong ≥ best. Off if
   * undefined.
   */
  genStrongSlack?: number | undefined;
  /** dead-state test (DeadlockAnalysis, sound) before expanding a state */
  deadPruning?: boolean | undefined;
  /**
   * zstd blocks: 'gen' (default: the bucket segments, written and read once), 'all' (also the
   * run files, decompressed again at every layer) or 'none'
   */
  compress?: 'none' | 'gen' | 'all' | undefined;
  /** GPU batch expansion lane (the walk BFS and the successors are computed by the card) */
  gpu?: BatchLane | undefined;
}

/** buffered output file with disk accounting */
class OutFile {
  private readonly buf: Uint8Array;
  private fill = 0;
  private fd = -1;
  /** bytes written to the file by this object */
  offset = 0;

  constructor(
    private readonly path: string,
    private readonly shared: Shared,
    size = OUT_BYTES,
    /** 'w' (new file) or 'a' (append) */
    private readonly mode: 'w' | 'a' = 'w',
    buf?: Uint8Array,
  ) {
    this.buf = buf ?? new Uint8Array(size);
  }

  write(src: Uint8Array): void {
    if (this.fill + src.length > this.buf.length) this.flush();
    if (src.length > this.buf.length) {
      this.writeRaw(src);
      this.offset += src.length;
      return;
    }
    this.buf.set(src, this.fill);
    this.fill += src.length;
  }

  /** writes to an already open file descriptor (not closed by this object) */
  useFd(fd: number): this {
    this.fd = fd;
    this.ownFd = false;
    return this;
  }
  private ownFd = true;

  private writeRaw(src: Uint8Array): void {
    takeDisk(this.shared, src.length);
    if (this.fd < 0) {
      ensureDir(dirname(this.path));
      this.fd = openSync(this.path, this.mode);
    }
    let done = 0;
    while (done < src.length) done += writeSync(this.fd, src, done, src.length - done);
  }

  /** bytes written so far, buffered ones included */
  get position(): number {
    return this.offset + this.fill;
  }

  flush(): void {
    if (this.fill === 0) return;
    this.writeRaw(this.buf.subarray(0, this.fill));
    this.offset += this.fill;
    this.fill = 0;
  }

  /** closes without writing the buffered bytes (interrupted job) */
  abort(): void {
    this.fill = 0;
    if (this.fd >= 0 && this.ownFd) closeSync(this.fd);
    this.fd = -1;
  }

  close(): void {
    this.flush();
    if (this.fd >= 0 && this.ownFd) closeSync(this.fd);
    this.fd = -1;
  }
}

/** directories already created by this thread */
const madeDirs = new Set<string>();
export function ensureDir(dir: string): void {
  if (madeDirs.has(dir)) return;
  mkdirSync(dir, { recursive: true });
  madeDirs.add(dir);
}

function readFully(fd: number, dst: Uint8Array, position: number): void {
  let got = 0;
  while (got < dst.length) {
    const n = readSync(fd, dst, got, dst.length - got, position + got);
    if (n === 0) throw new Error('unexpected end of file');
    got += n;
  }
}

/** appends compressed blocks of records to a run file (open in append mode) */
class RunWriter {
  private readonly block: Uint32Array;
  private n = 0;
  private readonly bin: OutFile;
  /** new blocks (RUN_INDEX_FIELDS each) */
  readonly blocks: number[] = [];
  private binOffset: number;

  constructor(
    path: string,
    fd: number,
    shared: Shared,
    private readonly R: number,
    private readonly startBytes: number,
    buf: Uint8Array,
    private readonly compressed: boolean,
  ) {
    this.block = new Uint32Array(RUN_BLOCK * R);
    this.bin = new OutFile(path, shared, OUT_BYTES, 'a', buf).useFd(fd);
    this.binOffset = startBytes;
  }

  add(src: Uint32Array, off: number): void {
    const R = this.R;
    this.block.set(src.subarray(off, off + R), this.n * R);
    if (++this.n === RUN_BLOCK) this.flushBlock();
  }

  private flushBlock(): void {
    if (this.n === 0) return;
    const raw = new Uint8Array(this.block.buffer, 0, this.n * this.R * 4);
    const z = this.compressed ? compress(raw, this.R) : raw;
    this.bin.write(z);
    this.blocks.push(this.binOffset, z.length, this.n);
    this.binOffset += z.length;
    this.n = 0;
  }

  /** writes everything; returns the bytes appended to the run file */
  close(): number {
    this.flushBlock();
    this.bin.close();
    return this.binOffset - this.startBytes;
  }

  abort(): void {
    this.bin.abort();
  }
}

/** reads one block of `count` records (RUN_INDEX_FIELDS entry) of a run file */
export function readRunBlock(
  fd: number,
  offset: number,
  stored: number,
  count: number,
  R: number,
): Uint32Array {
  const z = new Uint8Array(stored);
  readFully(fd, z, offset);
  return decompress(z, count * R * 4, R).slice();
}

interface Chunk {
  words: Uint32Array;
  n: number;
  minF: number;
}

export class Expander {
  readonly model: CompactModel;
  readonly bound: CompactBound;
  readonly words: number;
  readonly R: number;
  private readonly chunkRecords: number;
  /** successor buffers by target layer × parts + partition */
  private readonly chunks = new Map<number, Chunk>();
  private chunkBytes = 0;
  private readonly chunkCap: number;
  private readonly jobBytes: number;
  private gen: OutFile | undefined;
  private genPath = '';
  private index: number[] = [];
  private layer = -1;
  // recent-successor cache (direct mapped): key, cost (0xffff = empty)
  private readonly cacheKeys: Uint32Array;
  private readonly cacheCost: Uint16Array;
  private readonly cacheMask: number;
  /** write buffer of the run files (reused by every job) */
  private readonly runBuf = new Uint8Array(OUT_BYTES);
  /** compressed bytes read (grown on demand) */
  private zbuf = new Uint8Array(64 * 1024);
  /** gen files opened by this layer's jobs (closed at the end of the layer, before deletion) */
  private readonly genFds = new Map<string, number>();
  /** run file of each partition, open in append mode */
  private readonly runFds = new Map<number, number>();
  // successor evaluation (genStrongSlack): a second model, the first one is being expanded
  private readonly succModel: CompactModel | undefined;
  private readonly succBound: CompactBound | undefined;
  private readonly dead: DeadlockAnalysis | undefined;
  /** expansion on the GPU (batches), if a lane was given */
  private readonly gpu: GpuBatchClient | undefined;

  constructor(
    level: LevelData,
    private readonly opts: ExpanderOptions,
    private readonly shared: Shared,
  ) {
    this.model = new CompactModel(level);
    this.bound = new CompactBound(this.model);
    this.words = this.model.words;
    this.R = recordWords(this.words);
    this.chunkRecords = Math.max(1, Math.floor(CHUNK_BYTES / (this.R * 4)));
    let entries = opts.cacheEntries ?? 0;
    entries = entries > 0 ? 2 ** Math.ceil(Math.log2(entries)) : 0;
    this.cacheKeys = new Uint32Array(entries * this.words);
    this.cacheCost = new Uint16Array(entries).fill(0xffff);
    this.cacheMask = entries - 1;
    if (opts.genStrongSlack !== undefined) {
      this.succModel = new CompactModel(level);
      this.succBound = new CompactBound(this.succModel);
    }
    if (opts.deadPruning) this.dead = new DeadlockAnalysis(this.model);
    if (opts.gpu) this.gpu = new GpuBatchClient(opts.gpu, this.words);
    const left = Math.max(
      32 * MB,
      opts.memoryBytes - entries * (this.words * 4 + 2) - 2 * OUT_BYTES - RUN_BLOCK * this.R * 4,
    );
    this.chunkCap = Math.floor(left * 0.3);
    this.jobBytes = Math.floor(left * 0.7);
  }

  /** layer start: successors of this layer's jobs go to this worker's gen file of `layer` */
  private begin(layer: number): void {
    if (this.layer === layer) return;
    if (this.layer >= 0) throw new Error(`layer ${this.layer} not ended`);
    this.layer = layer;
    this.genPath = genFile(this.opts.dir, layer, this.opts.worker);
    this.gen = new OutFile(this.genPath, this.shared);
    this.index = [];
  }

  private closeReads(): void {
    for (const fd of this.genFds.values()) closeSync(fd);
    this.genFds.clear();
  }

  /** closes the run files (before the coordinator truncates them, and at the end) */
  closeRuns(): void {
    for (const fd of this.runFds.values()) closeSync(fd);
    this.runFds.clear();
  }

  /** flushes the successor buffers and the gen file; writes its segment index */
  endLayer(): LayerEnd {
    this.closeReads();
    if (this.layer < 0) return { bytes: 0 };
    this.flushChunks();
    const gen = this.gen!;
    gen.close();
    const bytes = gen.offset;
    this.layer = -1;
    this.gen = undefined;
    if (bytes === 0) return { bytes: 0 };
    const ib = new Uint8Array(new Float64Array(this.index).buffer);
    const out = new OutFile(indexFile(this.genPath), this.shared, ib.length);
    out.write(ib);
    out.close();
    return { file: this.genPath, bytes: bytes + ib.length };
  }

  /** drops the outputs of an interrupted layer (files are deleted by the coordinator) */
  abortLayer(): void {
    this.closeReads();
    this.closeRuns();
    this.chunks.clear();
    this.chunkBytes = 0;
    this.gen?.abort();
    this.gen = undefined;
    this.layer = -1;
    // its entries may describe successors that were never written
    this.cacheCost.fill(0xffff);
  }

  private writeChunk(code: number, c: Chunk): void {
    if (c.n === 0) return;
    const parts = this.opts.parts;
    const gen = this.gen!;
    const offset = gen.position;
    const raw = new Uint8Array(c.words.buffer, 0, c.n * this.R * 4);
    const z = this.opts.compress === 'none' ? raw : compress(raw, this.R);
    gen.write(z);
    this.index.push(Math.floor(code / parts), code % parts, offset, c.n, c.minF, z.length);
    c.n = 0;
    c.minF = Infinity;
  }

  private flushChunks(): void {
    for (const [code, c] of this.chunks) this.writeChunk(code, c);
    this.chunks.clear();
    this.chunkBytes = 0;
  }

  private emit(
    src: Uint32Array,
    so: number,
    h: number,
    layer: number,
    f: number,
    parent0: number,
    parent1: number,
    edge: number,
  ): void {
    const { words, R } = this;
    const code = layer * this.opts.parts + partOf(h, this.opts.parts);
    let c = this.chunks.get(code);
    if (!c) {
      // buffers start small and double: the memory follows the buffered records, so the cap
      // is only reached with large chunks (flushing many tiny ones would flood the indexes)
      if (this.chunkBytes + CHUNK_START * R * 4 > this.chunkCap) this.flushChunks();
      c = { words: new Uint32Array(CHUNK_START * R), n: 0, minF: Infinity };
      this.chunks.set(code, c);
      this.chunkBytes += CHUNK_START * R * 4;
    } else if (c.n * R === c.words.length) {
      const size = Math.min(this.chunkRecords, c.n * 2);
      if (this.chunkBytes + (size - c.n) * R * 4 > this.chunkCap) {
        this.flushChunks();
        this.emit(src, so, h, layer, f, parent0, parent1, edge);
        return;
      }
      const bigger = new Uint32Array(size * R);
      bigger.set(c.words);
      this.chunkBytes += (size - c.n) * R * 4;
      c.words = bigger;
    }
    const o = c.n * R;
    for (let j = 0; j < words; j++) c.words[o + j] = src[so + j]!;
    c.words[o + words] = parent0;
    c.words[o + words + 1] = parent1;
    c.words[o + words + 2] = edge;
    if (f < c.minF) c.minF = f;
    if (++c.n === this.chunkRecords) this.writeChunk(code, c);
  }

  /** true if `key` was emitted recently with a cost ≤ cost (then dropping it is safe) */
  private cached(key: Uint32Array, ko: number, h: number, cost: number): boolean {
    if (this.cacheMask < 0) return false;
    const { words } = this;
    const slot = (Math.imul(h, 0x9e3779b1) >>> 0) & this.cacheMask;
    const o = slot * words;
    const keys = this.cacheKeys;
    let same = this.cacheCost[slot] !== 0xffff;
    for (let j = 0; same && j < words; j++) if (keys[o + j] !== key[ko + j]) same = false;
    if (same && this.cacheCost[slot]! <= cost) return true;
    for (let j = 0; j < words; j++) keys[o + j] = key[ko + j]!;
    this.cacheCost[slot] = cost;
    return false;
  }

  /**
   * reads a block of `count` records stored in `stored` bytes at `offset`; the result may
   * alias an internal buffer (valid until the next call)
   */
  private readBlock(fd: number, offset: number, stored: number, count: number): Uint32Array {
    if (this.zbuf.length < stored) this.zbuf = new Uint8Array(stored * 2);
    const view = this.zbuf.subarray(0, stored);
    readFully(fd, view, offset);
    return decompress(view, count * this.R * 4, this.R);
  }

  run(spec: JobSpec): JobResult {
    this.begin(spec.layer);
    const { words, R, model, bound, shared } = this;
    const { layer, part } = spec;
    const toExit = bound.toExit;
    const result: JobResult = {
      part,
      loaded: 0,
      unique: 0,
      closedDup: 0,
      pruned: 0,
      dead: 0,
      expanded: 0,
      emitted: 0,
      cached: 0,
      genPruned: 0,
      passes: 1,
      truncated: false,
      runBlocks: [],
      runBytes: 0,
      ms: { load: 0, closed: 0, expand: 0 },
    };
    let total = 0;
    for (let s = 2; s < spec.segments.length; s += 4) total += spec.segments[s]!;
    if (total === 0) return result;
    // bytes per loaded record: record, hash, table (2 slots), flags
    const perRecord = R * 4 + 4 + 8 + 1;
    const passes = Math.max(1, Math.ceil((total * perRecord) / this.jobBytes));
    result.passes = passes;
    const path = runFile(this.opts.dir, part);
    // one descriptor per partition, kept open (an open costs ~0.3 ms on Windows): reads of the
    // earlier layers, appends of this one
    let runFd = this.runFds.get(part);
    if (runFd === undefined) {
      ensureDir(dirname(path));
      runFd = openSync(path, 'a+');
      this.runFds.set(part, runFd);
    }
    const run = new RunWriter(
      path,
      runFd,
      shared,
      R,
      spec.runBytes,
      this.runBuf,
      this.opts.compress === 'all',
    );
    let runCount = 0;
    const cap = passes === 1 ? total : Math.ceil((total / passes) * 1.25) + 1024;
    let recs = new Uint32Array(cap * R);
    let hashes = new Uint32Array(cap);
    const fds = this.genFds;
    const fdOf = (f: number) => {
      const p = spec.files[f]!;
      let fd = fds.get(p);
      if (fd === undefined) {
        fd = openSync(p, 'r');
        fds.set(p, fd);
      }
      return fd;
    };
    let best = Atomics.load(shared.ints, 0);
    let goal: Goal | undefined;
    const parent0 = ((layer << 16) | part) >>> 0;
    let curIndex = 0;
    const next = model.next;
    const self = this;
    const slack = this.opts.genStrongSlack;
    const succModel = this.succModel;
    const succBound = this.succBound;
    const won = (cost: number, index: number, edge: number) => {
      if (cost >= best) return;
      best = cost;
      goal = { cost, layer, part, index, edge };
      lowerBest(shared, cost);
    };
    /** successor `src[so…]` (player on `cell`) of the state of run index `index` */
    const accept = (
      src: Uint32Array,
      so: number,
      cost: number,
      cell: number,
      edge: number,
      index: number,
    ) => {
      if (cost >= best) return;
      const hx = toExit[cell]!;
      if (hx === UNREACHABLE) return;
      const f = cost + hx;
      if (f >= best) return;
      if (cost > MAX_LAYER) {
        result.truncated = true;
        return;
      }
      if (slack !== undefined && f >= best - slack) {
        succModel!.load(src, so);
        const hs = succBound!.strong();
        if (hs === UNREACHABLE || cost + hs >= best) {
          result.genPruned++;
          return;
        }
      }
      const h = hashWords(src, so, words);
      if (self.cached(src, so, h, cost)) {
        result.cached++;
        return;
      }
      self.emit(src, so, h, cost, f, parent0, index, edge);
      result.emitted++;
    };
    const sink: SuccessorSink = {
      succ(edge, walk, cell, isWon) {
        const cost = layer + walk + 1;
        if (isWon) won(cost, curIndex, edge);
        else accept(next, 0, cost, cell, edge, curIndex);
        return true;
      },
    };
    // GPU batches: keys in gpu.input, run index of each slot
    const gpu = this.gpu;
    const slotIndex = gpu ? new Int32Array(gpu.stateCap) : undefined;
    let slots = 0;
    const flushGpu = () => {
      const g = gpu!;
      const stride = g.stride;
      while (slots > 0) {
        const r = g.call(slots, layer, best);
        const out = g.output;
        for (let c = 0; c < r.out; c++) {
          const o = c * stride;
          const v = out[o + words + 1]!;
          accept(out, o, v >>> 16, out[o]! & 0xffff, v & 0xffff, slotIndex![out[o + words]!]!);
        }
        for (let k = 0; k < r.goals; k++) {
          const [cost, si, edge] = g.goal(k);
          won(cost, slotIndex![si]!, edge);
        }
        if (r.truncated) result.truncated = true;
        if (r.done < slots) {
          g.input.copyWithin(0, r.done * words, slots * words);
          slotIndex!.copyWithin(0, r.done, slots);
        }
        slots -= r.done;
      }
    };

    try {
      for (let pass = 0; pass < passes; pass++) {
        // 1. load the bucket (this pass's share)
        let t = performance.now();
        let n = 0;
        for (let s = 0; s < spec.segments.length; s += 4) {
          const count = spec.segments[s + 2]!;
          const src = this.readBlock(
            fdOf(spec.segments[s]!),
            spec.segments[s + 1]!,
            spec.segments[s + 3]!,
            count,
          );
          for (let i = 0; i < count; i++) {
            const h = hashWords(src, i * R, words);
            if (passes > 1 && passOf(h, passes) !== pass) continue;
            if (n === hashes.length) {
              const bigger = new Uint32Array(recs.length * 2);
              bigger.set(recs);
              recs = bigger;
              const hb = new Uint32Array(hashes.length * 2);
              hb.set(hashes);
              hashes = hb;
            }
            for (let j = 0, a = i * R, b = n * R; j < R; j++) recs[b + j] = src[a + j]!;
            hashes[n++] = h;
          }
        }
        result.loaded += n;
        // 2. duplicates inside the bucket (same cost: keep the first)
        let bits = 4;
        while (1 << bits < n * 2) bits++;
        const mask = (1 << bits) - 1;
        const table = new Int32Array(1 << bits);
        const alive = new Uint8Array(n);
        const sameKey = (a: number, b: Uint32Array, bo: number) => {
          const ao = a * R;
          for (let j = 0; j < words; j++) if (recs[ao + j] !== b[bo + j]) return false;
          return true;
        };
        const find = (h: number, src: Uint32Array, so: number): number => {
          let slot = (Math.imul(h, 0x9e3779b1) >>> (32 - bits)) & mask;
          for (;;) {
            const e = table[slot]!;
            if (e === 0) return -1 - slot;
            const i = e - 1;
            if (hashes[i] === h && sameKey(i, src, so)) return i;
            slot = (slot + 1) & mask;
          }
        };
        let unique = 0;
        for (let i = 0; i < n; i++) {
          const r = find(hashes[i]!, recs, i * R);
          if (r >= 0) continue;
          table[-1 - r] = i + 1;
          alive[i] = 1;
          unique++;
        }
        result.unique += unique;
        result.ms.load += performance.now() - t;
        // 3. against the run file of this partition (states expanded at a smaller cost)
        t = performance.now();
        let aliveCount = unique;
        const blocks = spec.runBlocks;
        for (let b = 0; aliveCount > 0 && b < blocks.length; b += RUN_INDEX_FIELDS) {
          const count = blocks[b + 2]!;
          const src = this.readBlock(runFd, blocks[b]!, blocks[b + 1]!, count);
          for (let i = 0; i < count; i++) {
            const h = hashWords(src, i * R, words);
            if (passes > 1 && passOf(h, passes) !== pass) continue;
            const r = find(h, src, i * R);
            if (r >= 0 && alive[r]) {
              alive[r] = 0;
              result.closedDup++;
              aliveCount--;
            }
          }
        }
        result.ms.closed += performance.now() - t;
        // 4. strong bound (and dead test), run file, expansion (on the GPU if the pass has
        // enough states: a request has a fixed latency of a few ms)
        t = performance.now();
        const onGpu = gpu !== undefined && aliveCount >= GPU_MIN_STATES ? gpu : undefined;
        for (let i = 0; i < n; i++) {
          if (!alive[i]) continue;
          if ((i & 1023) === 0) {
            if (Atomics.load(shared.ints, 1) !== 0) throw new StopError('stop');
            const b = Atomics.load(shared.ints, 0);
            if (b < best) best = b;
          }
          model.load(recs, i * R);
          const h = bound.strong();
          if (h === UNREACHABLE || layer + h >= best) {
            result.pruned++;
            continue;
          }
          if (this.dead?.dead()) {
            result.dead++;
            continue;
          }
          run.add(recs, i * R);
          curIndex = spec.closed + runCount++;
          result.expanded++;
          if (!onGpu) {
            model.expand(sink);
            continue;
          }
          for (let j = 0; j < words; j++) onGpu.input[slots * words + j] = recs[i * R + j]!;
          slotIndex![slots++] = curIndex;
          if (slots === onGpu.stateCap) flushGpu();
        }
        if (onGpu) flushGpu();
        result.ms.expand += performance.now() - t;
      }
      result.runBytes = run.close();
      result.runBlocks = run.blocks;
    } catch (err) {
      run.abort();
      throw err;
    }
    if (goal) result.goal = goal;
    return result;
  }
}
