// Worker threads for the structural pass of explore (packages/core/src/planner/explore.ts): each
// candidate is an independent rebuild of a plan of the same solution, so the pass hands them to
// a pool of threads, each with its own Rebuilder (memo) of the current solution. The order in
// which results are kept is decided by structuralPass (lowest candidate index first), not here.
import { availableParallelism, freemem } from 'node:os';
import { Worker } from 'node:worker_threads';
import type {
  CandidateOutcome,
  CandidateRunner,
  Dir,
  LevelData,
  RebuildOptions,
  Unit,
} from '@puzzlecave/core';

export interface ExploreWorkerInit {
  level: LevelData;
  opts: RebuildOptions;
  /** one Int32 cancel flag per worker */
  flags: SharedArrayBuffer;
  index: number;
}

export type ExploreWorkerRequest =
  { type: 'reset'; moves: Dir[] } | { type: 'run'; id: number; order: Unit[]; bound: number };

export type ExploreWorkerReply =
  | { type: 'done'; id: number; out: CandidateOutcome; searches: number; retries: number }
  | { type: 'error'; id: number; message: string };

/** memory of a worker besides its searches: its V8 heap (memo of stage results, plans) */
export const WORKER_BASE_MB = 512;
/** memory always left free on the machine by the default --total-memory */
export const KEEP_FREE_MB = 4096;

/** default --workers: all cores but two, at most 16 */
export function defaultWorkers(cores = availableParallelism()): number {
  return Math.max(1, Math.min(16, cores - 2));
}

/** default --total-memory (MB): free memory minus KEEP_FREE_MB, at least 1 GB */
export function defaultTotalMemoryMb(freeBytes = freemem()): number {
  return Math.max(1024, Math.floor(freeBytes / 1024 ** 2) - KEEP_FREE_MB);
}

export interface WorkerPlan {
  workers: number;
  /** memory of each wide or retried search (may be lowered to fit a single worker) */
  largeMemoryMb: number;
  /** estimated memory of each worker */
  perWorkerMb: number;
}

/**
 * Number of workers that fit in the total memory: each one may hold one search at a time, of at
 * most max(largeMemoryMb, stageMemoryMb), plus WORKER_BASE_MB; the main thread keeps
 * stageMemoryMb + WORKER_BASE_MB for screening and improve. When even one worker does not fit,
 * one worker is kept and its large searches get what is left (at least 256 MB).
 */
export function planWorkers(
  requested: number,
  totalMb: number,
  largeMemoryMb: number,
  stageMemoryMb: number,
): WorkerPlan {
  const left = totalMb - (stageMemoryMb + WORKER_BASE_MB);
  const per = Math.max(largeMemoryMb, stageMemoryMb) + WORKER_BASE_MB;
  const n = Math.min(requested, Math.floor(left / per));
  if (n >= 1) return { workers: n, largeMemoryMb, perWorkerMb: per };
  const large = Math.max(256, Math.min(largeMemoryMb, left - WORKER_BASE_MB));
  return {
    workers: 1,
    largeMemoryMb: large,
    perWorkerMb: Math.max(large, stageMemoryMb) + WORKER_BASE_MB,
  };
}

interface Lane {
  worker: Worker;
  index: number;
  /** run under way */
  job?: { id: number; resolve: (out: CandidateOutcome) => void };
  searches: number;
  retries: number;
  exited: boolean;
}

/**
 * A pool of explore workers, as the CandidateRunner of structuralPass: `width` threads, one
 * candidate each. A worker that dies (out of memory) fails its candidate and is replaced.
 */
export class ExplorePool implements CandidateRunner {
  readonly width: number;
  private readonly lanes: Lane[] = [];
  private readonly flags: Int32Array;
  private readonly flagsBuf: SharedArrayBuffer;
  private readonly waiting: {
    id: number;
    order: Unit[];
    bound: number;
    resolve: (out: CandidateOutcome) => void;
  }[] = [];
  private solution: Dir[] | undefined;
  private nextId = 0;
  /** searches and retries of the workers that died */
  private lost = { searches: 0, retries: 0 };
  private closing = false;

  constructor(
    private readonly level: LevelData,
    private readonly opts: RebuildOptions,
    workers: number,
    /** --max-old-space-size of each worker (its memo) */
    private readonly heapMb = WORKER_BASE_MB,
  ) {
    this.width = Math.max(1, workers);
    this.flagsBuf = new SharedArrayBuffer(4 * this.width);
    this.flags = new Int32Array(this.flagsBuf);
    for (let i = 0; i < this.width; i++) this.lanes.push(this.spawn(i));
  }

  private spawn(index: number): Lane {
    // the clock and the cancellation are the worker's own
    const { now: _now, cancelled: _cancelled, ...opts } = this.opts;
    const init: ExploreWorkerInit = { level: this.level, opts, flags: this.flagsBuf, index };
    const worker = new Worker(new URL('./exploreBoot.mjs', import.meta.url), {
      workerData: init,
      resourceLimits: { maxOldGenerationSizeMb: this.heapMb },
    });
    const lane: Lane = { worker, index, searches: 0, retries: 0, exited: false };
    worker.on('message', (r: ExploreWorkerReply) => {
      const job = lane.job;
      if (!job || job.id !== r.id) return;
      lane.job = undefined;
      if (r.type === 'done') {
        lane.searches = r.searches;
        lane.retries = r.retries;
        job.resolve(r.out);
      } else job.resolve({ failed: `worker error: ${r.message.split('\n')[0]}` });
      this.dispatch();
    });
    const died = (why: string) => {
      if (lane.exited) return;
      lane.exited = true;
      if (this.closing) return;
      this.lost.searches += lane.searches;
      this.lost.retries += lane.retries;
      const job = lane.job;
      lane.job = undefined;
      // replaced by a fresh worker on the current solution
      const fresh = this.spawn(index);
      this.lanes[index] = fresh;
      if (this.solution) fresh.worker.postMessage({ type: 'reset', moves: this.solution });
      job?.resolve({ failed: `worker died: ${why}` });
      this.dispatch();
    };
    worker.on('error', (err: Error) => died(err.message));
    worker.on('exit', (code) => died(`exit code ${code}`));
    if (this.solution) worker.postMessage({ type: 'reset', moves: this.solution });
    return lane;
  }

  reset(solution: readonly Dir[]): void {
    this.solution = solution.slice();
    for (const lane of this.lanes)
      lane.worker.postMessage({
        type: 'reset',
        moves: this.solution,
      } satisfies ExploreWorkerRequest);
  }

  run(order: Unit[], bound: number): { result: Promise<CandidateOutcome>; cancel: () => void } {
    const id = this.nextId++;
    let resolve!: (out: CandidateOutcome) => void;
    const result = new Promise<CandidateOutcome>((r) => (resolve = r));
    this.waiting.push({ id, order, bound, resolve });
    this.dispatch();
    const cancel = () => {
      const queued = this.waiting.findIndex((w) => w.id === id);
      if (queued >= 0) {
        this.waiting.splice(queued, 1)[0]!.resolve({ failed: 'cancelled' });
        return;
      }
      const lane = this.lanes.find((l) => l.job?.id === id);
      if (lane) Atomics.store(this.flags, lane.index, 1);
    };
    return { result, cancel };
  }

  private dispatch(): void {
    if (this.closing) return;
    for (const lane of this.lanes) {
      if (lane.job || lane.exited || !this.waiting.length) continue;
      const w = this.waiting.shift()!;
      lane.job = { id: w.id, resolve: w.resolve };
      Atomics.store(this.flags, lane.index, 0);
      lane.worker.postMessage({
        type: 'run',
        id: w.id,
        order: w.order,
        bound: w.bound,
      } satisfies ExploreWorkerRequest);
    }
  }

  stats(): { searches: number; retries: number } {
    let { searches, retries } = this.lost;
    for (const lane of this.lanes) {
      searches += lane.searches;
      retries += lane.retries;
    }
    return { searches, retries };
  }

  /** threads still running */
  alive(): number {
    return this.lanes.filter((l) => !l.exited).length;
  }

  /** stops every worker (a run under way is cancelled) */
  async close(): Promise<void> {
    this.closing = true;
    for (const w of this.waiting.splice(0)) w.resolve({ failed: 'cancelled' });
    await Promise.all(
      this.lanes.map(async (lane) => {
        lane.job?.resolve({ failed: 'cancelled' });
        lane.job = undefined;
        await lane.worker.terminate();
        lane.exited = true;
      }),
    );
  }
}
