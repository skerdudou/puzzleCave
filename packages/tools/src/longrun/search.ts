// Long-run external search (coordinator). Uniform-cost search by layers of g (moves), bounded by
// an upper bound U (only solutions of fewer than U moves are searched), with the states on disk:
// - layer G = every state first reached with cost G; a layer is processed only once all smaller
//   ones are done (every interaction costs ≥ 1 move), so each state is expanded at its optimal
//   cost and the first goal found is optimal once all layers below its cost are done;
// - states are partitioned by hash; a job (G, p) loads the bucket of layer G for partition p,
//   removes duplicates (inside the bucket and against the runs of p of earlier layers: delayed
//   duplicate detection), computes the strong bound (pruned if G + h ≥ U), writes the survivors
//   to the run file (G, p) and expands them (see expander.ts). Jobs of a layer run in parallel
//   on the worker threads;
// - every record carries its parent (layer, partition, index in the run file) and the edge, so
//   the path is rebuilt by following the parents in the run files;
// - after each layer, a manifest is written (checkpoint): an interrupted run resumes at the
//   first unfinished layer.
//
// Proven lower bound (any time a layer is done): min(best goal or U, min f = g + toExit over the
// pending bucket records). Let P be an optimal path with C* moves, C* < U; let s be its first
// state not expanded at its optimal cost: its predecessor was, so s was emitted with its optimal
// cost g* into a pending bucket (layers < nextLayer are done, and an earlier expansion of s at
// cost g* would contradict the choice of s) with f = g* + toExit(s) ≤ C*, unless it was dropped
// as a duplicate of a record of cost ≤ g* (then that record is pending at the same layer and
// carries the same f, or it was expanded: contradiction) or by the strong bound or toExit (not
// on any path with fewer than best moves). Hence C* ≥ that minimum; and if C* ≥ U the bound U is
// the claim "nothing shorter than U". When no record is pending below the best goal, the search
// is complete: the goal (if any) is optimal, otherwise no solution has fewer than U moves.
import { createHash } from 'node:crypto';
import {
  existsSync,
  mkdirSync,
  openSync,
  readFileSync,
  readSync,
  closeSync,
  fsyncSync,
  readdirSync,
  renameSync,
  rmSync,
  statSync,
  statfsSync,
  writeFileSync,
  truncateSync,
  appendFileSync,
} from 'node:fs';
import { join } from 'node:path';
import { MessageChannel, Worker } from 'node:worker_threads';
import {
  gpuUnsupported,
  laneBuffers,
  startBatchHost,
  type BatchHostMessage,
  type BatchLane,
} from '@puzzlecave/gpu';
import { CompactModel, DIRS, hashWords, type Dir, type LevelData } from '@puzzlecave/core';
import { Expander, readRunBlock } from './expander';
import {
  INDEX_FIELDS,
  RUN_INDEX_FIELDS,
  compress,
  decompress,
  MAX_LAYER,
  ROOT_LAYER,
  genDir,
  genFile,
  indexFile,
  makeShared,
  openShared,
  partOf,
  recordWords,
  runFile,
  type Goal,
  type JobResult,
  type JobSpec,
  type LayerEnd,
  type Shared,
} from './layout';
import type { WorkerInit, WorkerRequest } from './worker';

const MB = 1024 ** 2;
const GB = 1024 ** 3;
/** disk space always left free on the volume */
const DISK_RESERVE = 5 * GB;
const ROOT_SOURCE = -1;
/** states per GPU request, and output records reserved per state */
const GPU_BATCH = 16384;
const GPU_PER_STATE = 24;

export interface LongRunOptions {
  workDir: string;
  /** only solutions of fewer than upperBound moves are searched (default: horizon) */
  upperBound?: number | undefined;
  /** partitions (power of two), 256 by default; fixed for a run */
  parts?: number | undefined;
  /** worker threads; 0 = jobs in the calling thread */
  threads: number;
  /** memory of all the threads, in MB */
  maxMemoryMb: number;
  /** disk cap of the work dir, in GB */
  maxDiskGb: number;
  /** resume from the checkpoint of workDir (otherwise workDir is emptied) */
  resume?: boolean | undefined;
  timeoutMs?: number | undefined;
  /** recent-successor cache entries per thread (0: none) */
  cacheEntries?: number | undefined;
  /** strong bound on successors near the upper bound (see ExpanderOptions) */
  genStrongSlack?: number | undefined;
  /** dead-state test before expansion (see ExpanderOptions) */
  deadPruning?: boolean | undefined;
  /** compressed blocks (see ExpanderOptions), 'gen' by default */
  compress?: 'none' | 'gen' | 'all' | undefined;
  /** expansion on the GPU: auto (if available), on (required), off (default) */
  gpu?: 'auto' | 'on' | 'off' | undefined;
  /** machine lock of the card (tests) */
  gpuLockFile?: string | undefined;
  /** re-read before each layer: a smaller value lowers the upper bound (e.g. the saved solution) */
  boundSource?: (() => number | undefined) | undefined;
  /** stop after this many layers in this call (tests: simulated interruption) */
  maxLayers?: number | undefined;
  log?: ((line: string) => void) | undefined;
}

export interface LongRunStats {
  /** states expanded (written to the runs) */
  expanded: number;
  /** bucket records loaded */
  loaded: number;
  /** successors written to the buckets */
  emitted: number;
  /** layers processed (all calls) */
  layers: number;
  /** last layer done */
  layer: number;
  /** elapsed time (all calls) */
  ms: number;
  /** disk peak of this call, bytes */
  diskPeak: number;
}

export type LongRunResult = { stats: LongRunStats; upperBound: number } & (
  | { status: 'solved'; moves: Dir[] }
  /** no solution of fewer than upperBound moves */
  | { status: 'exhausted' }
  | {
      status: 'stopped';
      reason: 'disk' | 'time' | 'interrupt' | 'layers';
      lowerBound: number;
    }
);

interface Manifest {
  version: 4;
  level: string;
  fingerprint: string;
  upperBound: number;
  parts: number;
  words: number;
  /** all layers below are done */
  nextLayer: number;
  best: number;
  goal?: Goal | undefined;
  truncated: boolean;
  /** per partition: records, bytes of the run file and of its index */
  runRecords: number[];
  runBytes: number[];
  /** per partition: blocks of the run file (RUN_INDEX_FIELDS each) */
  runBlocks: number[][];
  /** states expanded per layer: (layer, states) pairs */
  layerSizes: number[];
  /** live gen files */
  gens: { layer: number; worker: number; maxTarget: number }[];
  stats: Omit<LongRunStats, 'diskPeak'>;
}

interface Pending {
  /** quintuples (file id, partition, byte offset, records, compressed bytes) */
  segs: number[];
  minF: number;
  records: number;
}

export const fingerprint = (level: LevelData) =>
  createHash('sha1').update(JSON.stringify(level)).digest('hex');

function dirBytes(dir: string): number {
  if (!existsSync(dir)) return 0;
  let total = 0;
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, e.name);
    total += e.isDirectory() ? dirBytes(p) : statSync(p).size;
  }
  return total;
}

/** flushes a file, or every file under a directory, to the disk */
function syncTree(path: string): void {
  if (!existsSync(path)) return;
  if (statSync(path).isDirectory()) {
    for (const e of readdirSync(path)) syncTree(join(path, e));
    return;
  }
  const fd = openSync(path, 'r+'); // Windows only flushes a handle opened for writing
  try {
    fsyncSync(fd);
  } finally {
    closeSync(fd);
  }
}

function processAlive(pid: number): boolean {
  if (!Number.isInteger(pid) || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (e) {
    return (e as NodeJS.ErrnoException).code === 'EPERM';
  }
}

/** minimal interface of a thread (worker or inline) */
interface Lane {
  job(spec: JobSpec): Promise<JobResult>;
  end(): Promise<LayerEnd>;
  abort(): Promise<void>;
  close(): Promise<void>;
}

class StoppedError extends Error {
  constructor(readonly reason: 'disk' | 'stop') {
    super(reason);
  }
}

class InlineLane implements Lane {
  constructor(private readonly x: Expander) {}
  async job(spec: JobSpec) {
    try {
      return this.x.run(spec);
    } catch (err) {
      const reason = (err as { reason?: 'disk' | 'stop' }).reason;
      if (reason) throw new StoppedError(reason);
      throw err;
    }
  }
  async end() {
    try {
      return this.x.endLayer();
    } catch (err) {
      const reason = (err as { reason?: 'disk' | 'stop' }).reason;
      if (reason) throw new StoppedError(reason);
      throw err;
    }
  }
  async abort() {
    this.x.abortLayer();
  }
  async close() {
    this.x.closeRuns();
  }
}

type Reply =
  | { type: 'ready' }
  | { type: 'done'; result: JobResult }
  | { type: 'ended'; end: LayerEnd }
  | { type: 'aborted' }
  | { type: 'stopped'; reason: 'disk' | 'stop' }
  | { type: 'error'; message: string };

class WorkerLane implements Lane {
  private waiting: ((r: Reply) => void) | undefined;
  private readonly ready: Promise<Reply>;
  private dead: Error | undefined;

  constructor(private readonly worker: Worker) {
    this.ready = new Promise((res) => (this.waiting = res));
    worker.on('message', (r: Reply) => {
      const w = this.waiting;
      this.waiting = undefined;
      w?.(r);
    });
    worker.on('error', (err: Error) => {
      this.dead = err;
      const w = this.waiting;
      this.waiting = undefined;
      w?.({ type: 'error', message: err.stack ?? String(err) });
    });
  }

  private async call(req: WorkerRequest): Promise<Reply> {
    await this.ready;
    if (this.dead) throw this.dead;
    const reply = new Promise<Reply>((res) => (this.waiting = res));
    this.worker.postMessage(req);
    const r = await reply;
    if (r.type === 'stopped') throw new StoppedError(r.reason);
    if (r.type === 'error') throw new Error(`worker: ${r.message}`);
    return r;
  }

  async job(spec: JobSpec) {
    return ((await this.call({ type: 'job', spec })) as { result: JobResult }).result;
  }
  async end() {
    return ((await this.call({ type: 'end' })) as { end: LayerEnd }).end;
  }
  async abort() {
    await this.call({ type: 'abort' });
  }
  async close() {
    await this.worker.terminate();
  }
}

export class LongRun {
  private readonly shared: Shared;
  private readonly intsBuf: SharedArrayBuffer;
  private readonly diskBuf: SharedArrayBuffer;
  private interrupted = false;

  constructor(
    private readonly level: LevelData,
    private readonly opts: LongRunOptions,
  ) {
    const bufs = makeShared(0, 0, 0);
    this.intsBuf = bufs.intsBuf;
    this.diskBuf = bufs.diskBuf;
    this.shared = openShared(this.intsBuf, this.diskBuf);
  }

  /** asks the running search to stop (Ctrl+C): the current layer is dropped */
  requestStop(): void {
    this.interrupted = true;
    Atomics.store(this.shared.ints, 1, 1);
  }

  private log(line: string): void {
    this.opts.log?.(line);
    try {
      appendFileSync(
        join(this.opts.workDir, 'progress.log'),
        `${new Date().toISOString()} ${line}\n`,
      );
    } catch {
      // the log is a convenience
    }
  }

  /** one process per work dir: a second one would read the other's records as its closed set */
  async run(): Promise<LongRunResult> {
    const dir = this.opts.workDir;
    mkdirSync(dir, { recursive: true });
    const lock = join(dir, 'lock');
    for (;;) {
      try {
        writeFileSync(lock, String(process.pid), { flag: 'wx' });
        break;
      } catch (e) {
        if ((e as NodeJS.ErrnoException).code !== 'EEXIST') throw e;
        const pid = Number(readFileSync(lock, 'utf8'));
        if (pid !== process.pid && processAlive(pid))
          throw new Error(`${dir} is used by the running process ${pid}`);
        rmSync(lock, { force: true }); // left by a process that is gone
      }
    }
    try {
      return await this.runLocked();
    } finally {
      rmSync(lock, { force: true });
    }
  }

  private async runLocked(): Promise<LongRunResult> {
    const t0 = performance.now();
    const { level, opts } = this;
    const dir = opts.workDir;
    const model = new CompactModel(level);
    const words = model.words;
    const R = recordWords(words);
    const fp = fingerprint(level);
    const U = Math.min(opts.upperBound ?? MAX_LAYER + 1, MAX_LAYER + 1);

    // checkpoint or new run
    let m: Manifest | undefined;
    const manifestFile = join(dir, 'manifest.json');
    if (opts.resume && existsSync(manifestFile)) {
      m = JSON.parse(readFileSync(manifestFile, 'utf8')) as Manifest;
      if (m.version !== 4) throw new Error(`${manifestFile}: checkpoint of an older version`);
      if (m.fingerprint !== fp || m.words !== words)
        throw new Error(`${manifestFile}: checkpoint of another level or level version`);
      if (opts.parts !== undefined && opts.parts !== m.parts)
        throw new Error(`${manifestFile}: checkpoint with ${m.parts} partitions`);
      this.cleanAfter(m);
      this.log(`resume at layer ${m.nextLayer} (${m.stats.expanded} states expanded)`);
    } else {
      if (opts.resume) this.log('no checkpoint: new run');
      rmSync(join(dir, 'runs'), { recursive: true, force: true });
      rmSync(join(dir, 'gen'), { recursive: true, force: true });
      rmSync(manifestFile, { force: true });
      const parts = opts.parts ?? 256;
      if (!Number.isInteger(Math.log2(parts)) || parts < 1 || parts > 0x8000)
        throw new Error('partitions: a power of two ≤ 32768');
      mkdirSync(dir, { recursive: true });
      // root: a gen file of the virtual layer -1 with the start state
      const rec = new Uint32Array(R);
      rec.set(model.encode(model.start));
      rec[words] = (ROOT_LAYER << 16) >>> 0;
      const part = partOf(hashWords(rec, 0, words), parts);
      const bin = genFile(dir, ROOT_SOURCE, 0);
      mkdirSync(genDir(dir, ROOT_SOURCE), { recursive: true });
      const z = compress(new Uint8Array(rec.buffer), R);
      writeFileSync(bin, z);
      writeFileSync(indexFile(bin), new Float64Array([0, part, 0, 1, 0, z.length]));
      m = {
        version: 4,
        level: level.id,
        fingerprint: fp,
        upperBound: U,
        parts,
        words,
        nextLayer: 0,
        best: U,
        truncated: false,
        runRecords: new Array<number>(parts).fill(0),
        runBytes: new Array<number>(parts).fill(0),
        runBlocks: Array.from({ length: parts }, () => []),
        layerSizes: [],
        gens: [{ layer: ROOT_SOURCE, worker: 0, maxTarget: 0 }],
        stats: { expanded: 0, loaded: 0, emitted: 0, layers: 0, layer: -1, ms: 0 },
      };
      this.save(m);
    }
    const parts = m.parts;
    const msBefore = m.stats.ms;
    /**
     * lowers the upper bound (a shorter solution was saved meanwhile): pruning with a smaller
     * bound only drops states that are on no path shorter than it, so the layers already done
     * stay valid; a goal found that is not shorter than the new bound is dropped
     */
    const tighten = (bound: number | undefined, why: string) => {
      if (bound === undefined || !(bound < m!.upperBound)) return;
      this.log(`upper bound ${m!.upperBound} → ${bound} (${why})`);
      m!.upperBound = bound;
      if (bound <= m!.best) {
        m!.best = bound;
        m!.goal = undefined;
      }
      Atomics.store(this.shared.ints, 0, m!.best);
    };
    tighten(U, 'option');

    // disk: what is already there, cap = min(--max-disk, used + free − reserve)
    const used = dirBytes(dir);
    let free = Infinity;
    try {
      const s = statfsSync(dir);
      free = Number(s.bavail) * Number(s.bsize);
    } catch {
      // unknown: the cap alone
    }
    const limit = Math.min(opts.maxDiskGb * GB, used + Math.max(0, free - DISK_RESERVE));
    Atomics.store(this.shared.ints, 0, m.best);
    Atomics.store(this.shared.ints, 1, 0);
    this.shared.disk[0] = BigInt(used);
    this.shared.disk[1] = BigInt(Math.floor(limit));
    let diskPeak = used;

    // pending buckets from the live gen files
    const files: string[] = [];
    const pending = new Map<number, Pending>();
    const addGen = (layer: number, worker: number) => {
      const bin = genFile(dir, layer, worker);
      const id = files.length;
      files.push(bin);
      const idx = new Float64Array(new Uint8Array(readFileSync(indexFile(bin))).buffer);
      let maxTarget = -1;
      for (let i = 0; i < idx.length; i += INDEX_FIELDS) {
        const target = idx[i]!;
        if (target > maxTarget) maxTarget = target;
        if (target < m!.nextLayer) continue;
        let p = pending.get(target);
        if (!p) pending.set(target, (p = { segs: [], minF: Infinity, records: 0 }));
        p.segs.push(id, idx[i + 1]!, idx[i + 2]!, idx[i + 3]!, idx[i + 5]!);
        p.records += idx[i + 3]!;
        if (idx[i + 4]! < p.minF) p.minF = idx[i + 4]!;
      }
      return maxTarget;
    };
    for (const g of m.gens) addGen(g.layer, g.worker);

    // threads
    const threads = Math.max(0, Math.floor(opts.threads));
    const memoryBytes = Math.floor((opts.maxMemoryMb * MB) / Math.max(1, threads));
    const xopts = {
      dir,
      parts,
      memoryBytes,
      cacheEntries: opts.cacheEntries ?? Math.floor(memoryBytes / 8 / (words * 4 + 2)),
      genStrongSlack: opts.genStrongSlack,
      deadPruning: opts.deadPruning,
      compress: opts.compress,
    };
    // GPU: one thread owns the card, each lane sends it batches of states to expand
    let host: Worker | undefined;
    let gpuLanes: BatchLane[] | undefined;
    const gpuMode = opts.gpu ?? 'off';
    if (gpuMode !== 'off') {
      const reason = gpuUnsupported(level);
      if (reason) {
        if (gpuMode === 'on') throw new Error(`GPU: ${reason}`);
        this.log(`GPU unavailable (${reason}) — expansion on the CPU`);
      } else {
        const n = Math.max(1, threads);
        const bufs = Array.from({ length: n }, () => laneBuffers(words, GPU_BATCH, GPU_PER_STATE));
        const channels = bufs.map(() => new MessageChannel());
        const h = startBatchHost({
          level,
          stateCap: GPU_BATCH,
          perState: GPU_PER_STATE,
          lanes: bufs,
          ports: channels.map((c) => c.port2),
          lockFile: opts.gpuLockFile,
        });
        const first = await new Promise<BatchHostMessage>((res) => {
          h.once('message', res);
          h.once('error', (err) => res({ type: 'error', message: String(err) }));
        });
        if (first.type === 'ready') {
          host = h;
          gpuLanes = bufs.map((b, i) => ({ ...b, port: channels[i]!.port1 }));
          this.log(`GPU: ${first.name} — batch expansion`);
        } else {
          await h.terminate();
          const why = first.type === 'unavailable' ? first.reason : first.message;
          if (gpuMode === 'on') throw new Error(`GPU: ${why}`);
          this.log(`GPU unavailable (${why}) — expansion on the CPU`);
        }
      }
    }
    const lanes: Lane[] = [];
    if (threads === 0)
      lanes.push(
        new InlineLane(
          new Expander(level, { ...xopts, worker: 0, gpu: gpuLanes?.[0] }, this.shared),
        ),
      );
    for (let w = 0; w < threads; w++) {
      const lane = gpuLanes?.[w];
      const init: WorkerInit = {
        level,
        opts: { ...xopts, worker: w, gpu: lane },
        intsBuf: this.intsBuf,
        diskBuf: this.diskBuf,
      };
      lanes.push(
        new WorkerLane(
          new Worker(new URL('./workerBoot.mjs', import.meta.url), {
            workerData: init,
            transferList: lane ? [lane.port] : [],
          }),
        ),
      );
    }

    const deadline = opts.timeoutMs === undefined ? Infinity : t0 + opts.timeoutMs;
    const timer =
      opts.timeoutMs === undefined
        ? undefined
        : setTimeout(() => Atomics.store(this.shared.ints, 1, 1), opts.timeoutMs);
    const lowerBound = () => {
      let lb = m!.best;
      for (const [layer, p] of pending) if (layer < m!.best && p.minF < lb) lb = p.minF;
      return lb;
    };
    const stats = (): LongRunStats => ({
      ...m!.stats,
      ms: msBefore + performance.now() - t0,
      diskPeak,
    });
    let layersThisCall = 0;
    let stopReason: 'disk' | 'time' | 'interrupt' | 'layers' | undefined;
    this.log(
      `${level.id}: long run, upper bound ${m.upperBound}, ${parts} partitions, ${threads} threads, ${opts.maxMemoryMb} MB, disk cap ${(limit / GB).toFixed(1)} GB, ${R * 4} bytes/record`,
    );
    try {
      for (;;) {
        if (opts.boundSource) tighten(opts.boundSource(), 'saved solution');
        const lb = lowerBound();
        if (lb >= m.best) break;
        if (opts.maxLayers !== undefined && layersThisCall >= opts.maxLayers) {
          stopReason = 'layers';
          break;
        }
        if (this.interrupted) {
          stopReason = 'interrupt';
          break;
        }
        if (performance.now() > deadline) {
          stopReason = 'time';
          break;
        }
        let G = Infinity;
        for (const layer of pending.keys()) if (layer < G) G = layer;
        const bucket = pending.get(G)!;
        const tl = performance.now();
        // jobs: one per partition, the largest first
        const byPart = new Map<number, number[]>();
        for (let i = 0; i < bucket.segs.length; i += 5) {
          const p = bucket.segs[i + 1]!;
          let l = byPart.get(p);
          if (!l) byPart.set(p, (l = []));
          l.push(bucket.segs[i]!, bucket.segs[i + 2]!, bucket.segs[i + 3]!, bucket.segs[i + 4]!);
        }
        const jobs: JobSpec[] = [];
        for (const [part, segs] of byPart) {
          const local = new Map<number, number>();
          const fl: string[] = [];
          const s: number[] = [];
          for (let i = 0; i < segs.length; i += 4) {
            let li = local.get(segs[i]!);
            if (li === undefined) {
              li = fl.length;
              local.set(segs[i]!, li);
              fl.push(files[segs[i]!]!);
            }
            s.push(li, segs[i + 1]!, segs[i + 2]!, segs[i + 3]!);
          }
          jobs.push({
            layer: G,
            part,
            files: fl,
            segments: s,
            closed: m.runRecords[part]!,
            runBytes: m.runBytes[part]!,
            runBlocks: m.runBlocks[part]!,
          });
        }
        const size = (j: JobSpec) => {
          let n = 0;
          for (let i = 2; i < j.segments.length; i += 4) n += j.segments[i]!;
          return n;
        };
        jobs.sort((a, b) => size(b) - size(a));
        const results: JobResult[] = [];
        let failure: unknown;
        let next = 0;
        await Promise.all(
          lanes.map(async (lane) => {
            while (failure === undefined && next < jobs.length) {
              const job = jobs[next++]!;
              try {
                results.push(await lane.job(job));
              } catch (err) {
                failure ??= err;
                Atomics.store(this.shared.ints, 1, Math.max(1, Atomics.load(this.shared.ints, 1)));
              }
            }
          }),
        );
        const ends: LayerEnd[] = [];
        if (failure === undefined) {
          for (const lane of lanes) {
            try {
              ends.push(await lane.end());
            } catch (err) {
              failure ??= err;
            }
          }
        }
        const d = Number(Atomics.load(this.shared.disk, 0));
        if (d > diskPeak) diskPeak = d;
        if (failure !== undefined) {
          // drop the layer: its run and gen files; the checkpoint stays at G
          for (const lane of lanes) await lane.abort().catch(() => undefined);
          truncateRuns(dir, m);
          rmSync(genDir(dir, G), { recursive: true, force: true });
          this.shared.disk[0] = BigInt(dirBytes(dir));
          if (!(failure instanceof StoppedError)) throw failure;
          stopReason = failure.reason === 'disk' ? 'disk' : this.interrupted ? 'interrupt' : 'time';
          break;
        }
        // layer done: bookkeeping, then the checkpoint
        let expanded = 0;
        let loaded = 0;
        let emitted = 0;
        let unique = 0;
        let closedDup = 0;
        let pruned = 0;
        let cached = 0;
        let dead = 0;
        let genPruned = 0;
        let passes = 1;
        const ms = { load: 0, closed: 0, expand: 0 };
        for (const r of results) {
          m.runRecords[r.part]! += r.expanded;
          m.runBytes[r.part]! += r.runBytes;
          for (const v of r.runBlocks) m.runBlocks[r.part]!.push(v);
          dead += r.dead;
          genPruned += r.genPruned;
          expanded += r.expanded;
          loaded += r.loaded;
          emitted += r.emitted;
          unique += r.unique;
          closedDup += r.closedDup;
          pruned += r.pruned;
          cached += r.cached;
          passes = Math.max(passes, r.passes);
          ms.load += r.ms.load;
          ms.closed += r.ms.closed;
          ms.expand += r.ms.expand;
          if (r.truncated) m.truncated = true;
          if (r.goal && r.goal.cost < m.best) {
            m.best = r.goal.cost;
            m.goal = r.goal;
          }
        }
        m.layerSizes.push(G, expanded);
        pending.delete(G);
        for (let w = 0; w < ends.length; w++) {
          if (!ends[w]!.file) continue;
          const maxTarget = addGen(G, w);
          m.gens.push({ layer: G, worker: w, maxTarget });
        }
        // gen files whose targets are all done
        const done = m.gens.filter((g) => g.maxTarget <= G);
        m.gens = m.gens.filter((g) => g.maxTarget > G);
        m.nextLayer = G + 1;
        m.stats.expanded += expanded;
        m.stats.loaded += loaded;
        m.stats.emitted += emitted;
        m.stats.layers++;
        m.stats.layer = G;
        m.stats.ms = msBefore + performance.now() - t0;
        this.save(m);
        for (const g of done) {
          const bin = genFile(dir, g.layer, g.worker);
          for (const f of [bin, indexFile(bin)]) {
            if (!existsSync(f)) continue;
            const size = statSync(f).size;
            rmSync(f, { force: true });
            Atomics.sub(this.shared.disk, 0, BigInt(size));
          }
        }
        layersThisCall++;
        const sec = (performance.now() - tl) / 1000;
        let pendingRecords = 0;
        for (const p of pending.values()) pendingRecords += p.records;
        const bound = lowerBound();
        this.log(
          `layer ${G}: ${expanded} expanded (${loaded} loaded in ${bucket.segs.length / 5} segments, ${unique} distinct, ${closedDup} seen, ${pruned} pruned${opts.deadPruning ? `, ${dead} dead` : ''}${passes > 1 ? `, ${passes} passes` : ''}), ${emitted} emitted (${cached} cached${opts.genStrongSlack !== undefined ? `, ${genPruned} cut by the strong bound` : ''}) in ${sec.toFixed(1)} s` +
            ` [load ${(ms.load / 1000).toFixed(1)} closed ${(ms.closed / 1000).toFixed(1)} expand ${(ms.expand / 1000).toFixed(1)} thread-s]` +
            ` — total ${m.stats.expanded} states, ${(Number(this.shared.disk[0]) / GB).toFixed(2)} GB on disk, ${pendingRecords} pending, lower bound ≥ ${bound}${m.goal ? `, best ${m.best}` : ''}`,
        );
      }
    } finally {
      if (timer) clearTimeout(timer);
      await Promise.all(lanes.map((l) => l.close()));
      if (host) {
        // the GPU thread releases the card and the machine lock, then ends
        const h = host;
        const ended = new Promise<void>((res) => h.once('exit', () => res()));
        h.postMessage('close');
        const timer = setTimeout(() => void h.terminate(), 10_000);
        await ended;
        clearTimeout(timer);
      }
    }

    const result = { stats: stats(), upperBound: m.upperBound };
    if (stopReason !== undefined) {
      const lb = lowerBound();
      this.log(`stopped (${stopReason}): proven lower bound ≥ ${lb}`);
      return { ...result, status: 'stopped', reason: stopReason, lowerBound: lb };
    }
    if (m.goal) {
      const moves = this.rebuild(model, m, R);
      // the rebuilt path must cost what the search proved optimal, or the claim is void
      if (moves.length !== m.goal.cost)
        throw new Error(`rebuilt solution has ${moves.length} moves, goal cost ${m.goal.cost}`);
      this.log(`solved: ${moves.length} moves (optimal)`);
      return { ...result, status: 'solved', moves };
    }
    if (m.truncated) {
      return { ...result, status: 'stopped', reason: 'layers', lowerBound: lowerBound() };
    }
    this.log(`exhausted: no solution of fewer than ${m.upperBound} moves`);
    return { ...result, status: 'exhausted' };
  }

  /** follows the parents from the goal through the run files */
  private rebuild(model: CompactModel, m: Manifest, R: number): Dir[] {
    const words = model.words;
    const chain: { key: Uint32Array; edge: number }[] = [];
    let layer = m.goal!.layer;
    let part = m.goal!.part;
    let index = m.goal!.index;
    for (;;) {
      const rec = readRunRecord(this.opts.workDir, m, part, index, R);
      chain.push({ key: rec.slice(0, words), edge: rec[words + 2]! });
      const p0 = rec[words]!;
      if (p0 >>> 16 === ROOT_LAYER) break;
      layer = p0 >>> 16;
      part = p0 & 0xffff;
      index = rec[words + 1]!;
    }
    chain.reverse();
    const moves: Dir[] = [];
    for (let i = 0; i < chain.length; i++) {
      model.load(chain[i]!.key);
      model.explore();
      const edge = i + 1 < chain.length ? chain[i + 1]!.edge : m.goal!.edge;
      for (const d of model.walkTo(edge >> 2)) moves.push(DIRS[d]!);
      moves.push(DIRS[edge & 3]!);
    }
    return moves;
  }

  private save(m: Manifest): void {
    const dir = this.opts.workDir;
    // the data the manifest points at must be on disk before it does (power loss, OS crash)
    for (const sub of ['runs', 'gen']) syncTree(join(dir, sub));
    const file = join(dir, 'manifest.json');
    writeFileSync(`${file}.tmp`, JSON.stringify(m));
    syncTree(`${file}.tmp`);
    renameSync(`${file}.tmp`, file);
  }

  /** resume: removes the outputs of the interrupted layer (anything not in the manifest) */
  private cleanAfter(m: Manifest): void {
    const dir = this.opts.workDir;
    const live = new Set(m.gens.map((g) => `L${g.layer}/w${g.worker}`));
    const gen = join(dir, 'gen');
    if (existsSync(gen))
      for (const l of readdirSync(gen)) {
        const layer = Number(l.slice(1));
        if (layer >= m.nextLayer) {
          rmSync(join(gen, l), { recursive: true, force: true });
          continue;
        }
        for (const f of readdirSync(join(gen, l)))
          if (!live.has(`${l}/${f.replace(/\.(bin|idx)$/, '')}`))
            rmSync(join(gen, l, f), { force: true });
      }
    truncateRuns(dir, m);
  }
}

/** cuts the run files back to the checkpoint (blocks appended by an interrupted layer) */
function truncateRuns(dir: string, m: Manifest): void {
  for (let p = 0; p < m.parts; p++) {
    const file = runFile(dir, p);
    const size = m.runBytes[p]!;
    if (existsSync(file) && statSync(file).size > size) truncateSync(file, size);
  }
}

/** record `index` of the run file of a partition */
function readRunRecord(
  dir: string,
  m: Manifest,
  part: number,
  index: number,
  R: number,
): Uint32Array {
  const blocks = m.runBlocks[part]!;
  let first = 0;
  for (let b = 0; b < blocks.length; b += RUN_INDEX_FIELDS) {
    const count = blocks[b + 2]!;
    if (index < first + count) {
      const fd = openSync(runFile(dir, part), 'r');
      try {
        const recs = readRunBlock(fd, blocks[b]!, blocks[b + 1]!, count, R);
        return recs.slice((index - first) * R, (index - first + 1) * R);
      } finally {
        closeSync(fd);
      }
    }
    first += count;
  }
  throw new Error(`run record ${index} of partition ${part} not found`);
}
