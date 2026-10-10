import { availableParallelism, freemem, totalmem } from 'node:os';
import { fileURLToPath } from 'node:url';
import { CompactModel, type LevelData } from '@puzzlecave/core';
import { loadPack } from '@puzzlecave/tiled';
import type { GpuMode } from './args';
import { reportSolve, type CommandResult, type SolveCommandOptions } from './commands';
import { fitsGpu, probeBackend, type GpuTask } from './gpu';
import { CHILD_HEAP_MB, childNeedBytes, memoryBudget, solverMemoryMb } from './memory';
import { runPool, stderrCause } from './pool';
import type { WorkerReply, WorkerTask } from './solveWorker';

export { childNeedBytes, inProcessMemoryMb } from './memory';

const WORKER = fileURLToPath(new URL('./solveWorker.ts', import.meta.url));

/** watchdog margin beyond timeoutMs (pack loading, sending the result) */
const WATCHDOG_MARGIN_MS = 30_000;

export interface PlanInput {
  levels: number;
  /** state limit; undefined = unlimited */
  maxStates?: number | undefined;
  /** explicit --max-memory (solver cap per process, MB) */
  maxMemoryMb?: number | undefined;
  /** explicit --jobs; otherwise chosen here */
  jobs?: number | undefined;
  totalBytes: number;
  freeBytes: number;
  logicalCpus: number;
}

export interface Plan {
  jobs: number;
  /** solver memory cap (maxMemoryMb) of each child */
  memoryMb: number;
  /** --max-old-space-size of each child */
  heapMb: number;
  warning?: string;
}

/**
 * Number of processes and memory cap of each. Budget = what can still be taken without exceeding
 * 70% of RAM (0.7 × total − already used at launch). Need of one child: see childNeedBytes (at
 * least 1.5 GB with no state limit). By default: at most one process per level, one per physical
 * core (half the logical cores) and as many as the budget holds. Each child gets at least its
 * need, and its share of the budget if there is room; the solver stops cleanly (timeout) at its
 * cap — the child's share minus 150 MB for Node — since its typed arrays escape
 * --max-old-space-size.
 */
export function planJobs(p: PlanInput): Plan {
  const budget = memoryBudget(p.totalBytes, p.freeBytes);
  const need = childNeedBytes(p.maxStates, p.maxMemoryMb);
  const levels = Math.max(1, p.levels);
  const gb = (b: number) => `${(b / 1024 ** 3).toFixed(1)} GB`;
  let jobs: number;
  let warning: string | undefined;
  if (p.jobs !== undefined) {
    jobs = Math.max(1, Math.min(p.jobs, levels));
    if (jobs * need > budget)
      warning = `warning: ${jobs} processes × ${gb(need)} estimated exceeds the memory available under 70% (${gb(Math.max(0, budget))})`;
  } else if (budget < need) {
    jobs = 1;
    warning = `warning: memory available under 70% (${gb(Math.max(0, budget))}) is below the estimated need of one process (${gb(need)}) — a single process`;
  } else {
    jobs = Math.max(1, Math.min(levels, Math.floor(p.logicalCpus / 2), Math.floor(budget / need)));
  }
  const memoryMb = p.maxMemoryMb ?? solverMemoryMb(Math.max(need, budget / jobs));
  const plan = { jobs, memoryMb, heapMb: CHILD_HEAP_MB };
  return warning === undefined ? plan : { ...plan, warning };
}

export const seconds = (ms: number) => `${(ms / 1000).toFixed(1)} s`;

/** state size (compact engine words), then object count; Infinity if too large */
function weight(level: LevelData): number {
  try {
    return new CompactModel(level).words * 1e6 + level.objects.length;
  } catch {
    return Infinity;
  }
}

/**
 * Queue order with a GPU lane: the GPU lane takes from the end of the queue, the CPU lanes from
 * the front. Levels outside the GPU limits first (never taken by the GPU lane while better ones
 * remain), then by increasing state size: the heaviest go to the GPU.
 */
export function gpuOrder(levels: LevelData[]): LevelData[] {
  const key = (l: LevelData) => (fitsGpu(l) ? weight(l) : -1);
  return levels
    .map((l) => ({ l, k: key(l) }))
    .sort((a, b) => a.k - b.k)
    .map((x) => x.l);
}

/** report of one level by the parent: lines, status, summary entries */
export interface LevelReport<K extends string> {
  ok: boolean;
  lines: string[];
  rows: { kind: K | 'error'; text: string }[];
}

export interface LevelRunOptions<T, R, K extends string> {
  dir: string;
  ids: string[] | 'all';
  /** child .ts module (see pool.ts) */
  worker: string;
  timeoutMs: number;
  /** watchdog margin beyond timeoutMs */
  watchdogMarginMs: number;
  maxStates?: number | undefined;
  maxMemoryMb?: number | undefined;
  jobs?: number | undefined;
  onLine?: ((line: string) => void) | undefined;
  /**
   * --gpu: if a GPU is usable ('auto') or required ('on'), one of the pool's lanes becomes the GPU
   * lane — a single child at a time on the card, taking the heaviest levels first; the other
   * lanes continue on the CPU. 'off' or absent: nothing is loaded.
   */
  gpu?: { mode: GpuMode; maxVramMb?: number | undefined } | undefined;
  /**
   * child task for a level; memoryMb = memory cap of its solver (RAM); gpu = global searches on
   * the GPU (GPU lane)
   */
  task: (level: LevelData, memoryMb: number, gpu?: GpuTask) => T;
  /** report of a reply (including --apply writes); an exception is an error */
  report: (level: LevelData, reply: R) => LevelReport<K>;
  /** summary sections, in order (errors follow) */
  sections: [K, string][];
}

/**
 * Processes each level in a separate Node process (runPool), at most `jobs` at a time, following
 * the memory plan of planJobs; shared by solve and improve. Reports (and --apply writes) are done
 * by the parent, on receipt of each reply, one at a time. Lines come out in completion order,
 * followed by a summary sorted by id; each level is reported exactly once (accounted at the
 * child's 'close' event).
 */
export async function runLevels<T, R, K extends string>(
  o: LevelRunOptions<T, R, K>,
): Promise<CommandResult> {
  const t0 = performance.now();
  const lines: string[] = [];
  const emit = (line: string) => {
    lines.push(line);
    o.onLine?.(line);
  };
  const pack = loadPack(o.dir);
  pack.errors.forEach(emit);
  let ok = pack.errors.length === 0;
  const byId = new Map(pack.levels.map((l) => [l.id, l]));
  const wanted = o.ids === 'all' ? pack.levels.map((l) => l.id) : o.ids;
  const rows = new Map<string, { kind: K | 'error'; text: string }[]>();
  const record = (id: string, kind: K | 'error', text: string) =>
    rows.set(id, [...(rows.get(id) ?? []), { kind, text }]);
  const queue: LevelData[] = [];
  for (const id of wanted) {
    const level = byId.get(id);
    if (level) queue.push(level);
    else {
      emit(`${id}: unknown level`);
      record(id, 'error', 'unknown level');
      ok = false;
    }
  }
  const plan = planJobs({
    levels: queue.length,
    maxStates: o.maxStates,
    maxMemoryMb: o.maxMemoryMb,
    jobs: o.jobs,
    totalBytes: totalmem(),
    freeBytes: freemem(),
    logicalCpus: availableParallelism(),
  });
  // GPU lane: the parent checks the card once (and releases it immediately)
  const gpuMode = o.gpu?.mode ?? 'off';
  const gpu =
    queue.length > 0 && gpuMode !== 'off' ? await probeBackend(gpuMode, emit) : { gpu: false };
  if (queue.length > 0) {
    emit(`${queue.length} level(s), ${plan.jobs} process(es), solver ≤ ${plan.memoryMb} MB each`);
    if (plan.warning) emit(plan.warning);
    if (gpu.gpu && 'label' in gpu)
      emit(
        `GPU lane (${gpu.label}): one process at a time on the card, heaviest levels first${plan.jobs > 1 ? `; ${plan.jobs - 1} CPU lane(s)` : ''}`,
      );
  }
  const gpuTask: GpuTask | undefined = gpu.gpu
    ? { mode: gpuMode === 'on' ? 'on' : 'auto', maxVramMb: o.gpu?.maxVramMb }
    : undefined;
  const ordered = gpuTask ? gpuOrder(queue) : queue;
  const fail = (id: string, text: string, stderr = '') => {
    emit(`${id}: ${text}`);
    const cause = stderrCause(stderr);
    if (cause) emit(`  ${cause}`);
    record(id, 'error', text);
    ok = false;
  };

  await runPool<T, R>({
    worker: o.worker,
    items: ordered.map((level) => ({
      id: level.id,
      task: o.task(level, plan.memoryMb),
      ...(gpuTask && fitsGpu(level) ? { gpuTask: o.task(level, plan.memoryMb, gpuTask) } : {}),
    })),
    gpuLane: gpuTask !== undefined,
    jobs: plan.jobs,
    heapMb: plan.heapMb,
    watchdogMs: o.timeoutMs + o.watchdogMarginMs,
    onReply: (id, reply) => {
      try {
        const r = o.report(byId.get(id)!, reply);
        r.lines.forEach(emit);
        ok &&= r.ok;
        for (const row of r.rows) record(id, row.kind, row.text);
      } catch (err) {
        fail(id, `write error — ${(err as Error).message}`);
      }
    },
    onFail: fail,
  });

  const sorted = [...rows].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
  const section = (kind: K | 'error', title: string) => {
    const list = sorted.flatMap(([id, rs]) =>
      rs.filter((x) => x.kind === kind).map((x) => `  ${id}: ${x.text}`),
    );
    emit(`${title} (${list.length}):`);
    list.forEach(emit);
  };
  emit(`— summary (${wanted.length} level(s), ${plan.jobs} process(es)) —`);
  for (const [kind, title] of o.sections) section(kind, title);
  section('error', 'errors');
  emit(`total time: ${seconds(performance.now() - t0)}`);
  return { ok, lines };
}

export interface ParallelOptions extends SolveCommandOptions {
  /** simultaneous processes; by default chosen by planJobs */
  jobs?: number | undefined;
  /** called for each line as it is produced */
  onLine?: (line: string) => void;
  /** tests only: children to make fail */
  crash?: Record<string, WorkerTask['crash']>;
  /** tests only: watchdog margin (30 s by default) */
  watchdogMarginMs?: number;
  /** searches on the GPU, in a GPU lane (see runLevels); off by default */
  gpu?: GpuMode | undefined;
  maxVramMb?: number | undefined;
}

/** Solves each level in a separate process (see runLevels). */
export function solveParallel(
  dir: string,
  ids: string[] | 'all',
  o: ParallelOptions,
): Promise<CommandResult> {
  return runLevels<WorkerTask, WorkerReply, 'solved' | 'unsolved'>({
    dir,
    ids,
    worker: WORKER,
    timeoutMs: o.timeoutMs,
    watchdogMarginMs: o.watchdogMarginMs ?? WATCHDOG_MARGIN_MS,
    maxStates: o.maxStates,
    maxMemoryMb: o.maxMemoryMb,
    jobs: o.jobs,
    onLine: o.onLine,
    gpu: { mode: o.gpu ?? 'off', maxVramMb: o.maxVramMb },
    task: (level, memoryMb, gpu) => ({
      dir,
      id: level.id,
      timeoutMs: o.timeoutMs,
      ...(o.maxStates !== undefined ? { maxStates: o.maxStates } : {}),
      maxMemoryMb: memoryMb,
      ...(gpu ? { gpu } : {}),
      ...(o.crash?.[level.id] ? { crash: o.crash[level.id] } : {}),
    }),
    report: (level, reply) => {
      const res = reply.result;
      const cost = `${res.explored} states, ${seconds(reply.ms)}, ${reply.maxRssMb} MB`;
      const row =
        res.status === 'solved'
          ? { kind: 'solved' as const, text: `${res.moves.length} moves (${cost})` }
          : res.status === 'timeout'
            ? { kind: 'unsolved' as const, text: `≥ ${res.lowerBound} moves (${cost})` }
            : { kind: 'unsolved' as const, text: `unsolvable (${cost})` };
      let r: CommandResult;
      try {
        r = reportSolve(dir, level, res, o);
      } catch (err) {
        const text = `write error — ${(err as Error).message}`;
        return {
          ok: false,
          lines: [`${level.id}: ${text}`],
          rows: [row, { kind: 'error', text }],
        };
      }
      // GPU engine messages (fallback to the CPU): before the report, not errors
      const notes = reply.notes ?? [];
      // engine solution rejected (it does not win): an error, not a solved level
      if (res.status === 'solved' && / rejected /.test(r.lines[0]!))
        return {
          ok: false,
          lines: [...notes, ...r.lines],
          rows: [{ kind: 'error', text: r.lines[0]! }],
        };
      return {
        ok: r.ok,
        lines: [...notes, ...r.lines],
        rows: [row, ...r.lines.slice(1).map((text) => ({ kind: 'error' as const, text }))],
      };
    },
    sections: [
      ['solved', 'solved'],
      ['unsolved', 'unsolved'],
    ],
  });
}
