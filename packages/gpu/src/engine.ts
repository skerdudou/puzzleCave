// GPU engine honoring the (synchronous) ExactEngine contract: the GPU lives in a dedicated thread (host.ts) that the
// main thread waits on with Atomics.wait, and every reply goes through safeguards: replay of
// every solution, fallback to the compact engine (CPU) if the level exceeds the GPU limits, if the
// reply is inconsistent or if the GPU fails.
import { closeSync, openSync, readFileSync, rmSync, statSync, writeSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  MessageChannel,
  Worker,
  receiveMessageOnPort,
  type MessagePort,
} from 'node:worker_threads';
import {
  replay,
  solve,
  type ExactEngine,
  type ExactOptions,
  type LevelData,
  type SolveResult,
} from '@puzzlecave/core';
import { simulatedAbsence } from './device';
import type { GpuSolveOptions, GpuSolveResult } from './gpuSolve';
import { gpuUnsupported } from './layout';
import type { HostReply, HostRequest } from './protocol';

/** default search VRAM (MB) */
export const DEFAULT_VRAM_MB = 4096;
/** maximum wait for a reply beyond the search timeout (compilation, reconstruction) */
const REPLY_MARGIN_MS = 120_000;
const OPEN_TIMEOUT_MS = 60_000;

/** synchronous GPU engine (GpuWorker, or a fake in tests) */
export interface GpuSolver {
  solve(level: LevelData, opts: GpuSolveOptions): GpuSolveResult;
}

/** machine-wide GPU lock: a single puzzleCave process at a time on the card */
export const LOCK_FILE = join(tmpdir(), 'puzzlecave-gpu.lock');

function alive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (err) {
    return (err as NodeJS.ErrnoException).code === 'EPERM';
  }
}

/**
 * File lock (created exclusively, containing the holder's pid). A lock whose
 * process has vanished (crash) is taken over; a still-empty file younger than 5 s belongs
 * to a process that is writing it.
 */
export class GpuLock {
  private constructor(private readonly file: string) {
    process.once('exit', this.releaseOnExit);
  }

  private readonly releaseOnExit = () => this.release();

  /** takes the lock, waiting at most waitMs for it to be released */
  static acquire(
    file = LOCK_FILE,
    waitMs = 0,
  ): { ok: true; lock: GpuLock } | { ok: false; reason: string; pid?: number } {
    const deadline = performance.now() + waitMs;
    const sleeper = new Int32Array(new SharedArrayBuffer(4));
    for (;;) {
      try {
        const fd = openSync(file, 'wx');
        writeSync(fd, String(process.pid));
        closeSync(fd);
        return { ok: true, lock: new GpuLock(file) };
      } catch (err) {
        if ((err as NodeJS.ErrnoException).code !== 'EEXIST')
          return { ok: false, reason: `GPU lock ${file}: ${(err as Error).message}` };
      }
      let pid = NaN;
      let young = false;
      try {
        pid = Number.parseInt(readFileSync(file, 'utf8'), 10);
        young = Date.now() - statSync(file).mtimeMs < 5000;
      } catch {
        continue; // released in the meantime
      }
      const held = Number.isInteger(pid) && pid > 0 ? alive(pid) : young;
      if (!held) {
        rmSync(file, { force: true });
        continue;
      }
      if (performance.now() >= deadline)
        return {
          ok: false,
          reason: `GPU already in use (process ${Number.isInteger(pid) ? pid : '?'})`,
          ...(Number.isInteger(pid) ? { pid } : {}),
        };
      Atomics.wait(sleeper, 0, 0, 200);
    }
  }

  release(): void {
    process.off('exit', this.releaseOnExit);
    try {
      if (readFileSync(this.file, 'utf8') === String(process.pid)) rmSync(this.file);
    } catch {
      // already released
    }
  }
}

export interface OpenOptions {
  /** maximum wait for the machine lock (ms); 0 by default: immediate refusal if the card is taken */
  waitMs?: number;
  /** lock file (tests) */
  lockFile?: string;
}

/**
 * GPU thread called synchronously: request posted on a MessagePort, wait with Atomics.wait
 * on a shared flag, reply read with receiveMessageOnPort. One call at a time. Holds the
 * machine-wide GPU lock until close().
 */
export class GpuWorker implements GpuSolver {
  private constructor(
    private readonly worker: Worker,
    private readonly port: MessagePort,
    private readonly flag: Int32Array,
    private readonly lock: GpuLock,
    /** adapter description */
    readonly name: string,
  ) {}

  /**
   * takes the machine lock, opens the thread and the device; { ok: false } if the card is taken by
   * another process or if no compatible adapter is present
   */
  static open(
    o: OpenOptions = {},
  ): { ok: true; worker: GpuWorker } | { ok: false; reason: string; busy?: boolean } {
    const simulated = simulatedAbsence();
    if (simulated) return { ok: false, reason: simulated };
    const locked = GpuLock.acquire(o.lockFile ?? LOCK_FILE, o.waitMs ?? 0);
    if (!locked.ok) return { ok: false, reason: locked.reason, busy: true };
    const opened = GpuWorker.start(locked.lock);
    if (!opened.ok) locked.lock.release();
    return opened;
  }

  private static start(
    lock: GpuLock,
  ): { ok: true; worker: GpuWorker } | { ok: false; reason: string } {
    const signal = new SharedArrayBuffer(4);
    const { port1, port2 } = new MessageChannel();
    const worker = new Worker(new URL('./hostBoot.mjs', import.meta.url), {
      workerData: { port: port2, signal },
      transferList: [port2],
      env: process.env,
    });
    worker.unref();
    const flag = new Int32Array(signal);
    let reply: HostReply;
    try {
      reply = call(port1, flag, { type: 'open' }, OPEN_TIMEOUT_MS);
    } catch (err) {
      void worker.terminate();
      return { ok: false, reason: (err as Error).message };
    }
    if (reply.type !== 'opened') {
      void worker.terminate();
      return {
        ok: false,
        reason: reply.type === 'unavailable' ? reply.reason : `GPU thread: ${describe(reply)}`,
      };
    }
    return { ok: true, worker: new GpuWorker(worker, port1, flag, lock, reply.name) };
  }

  solve(level: LevelData, opts: GpuSolveOptions): GpuSolveResult {
    const reply = call(
      this.port,
      this.flag,
      { type: 'solve', level, opts },
      (opts.timeoutMs ?? 60_000) + REPLY_MARGIN_MS,
    );
    if (reply.type !== 'result') throw new Error(describe(reply));
    return reply.result;
  }

  /** releases the device (all the VRAM) and stops the thread */
  close(): void {
    try {
      call(this.port, this.flag, { type: 'close' }, 30_000);
    } catch {
      // the thread is stopped anyway
    }
    this.port.close();
    void this.worker.terminate();
    this.lock.release();
  }
}

function describe(reply: HostReply): string {
  return reply.type === 'error' ? reply.message : `unexpected reply (${reply.type})`;
}

function call(port: MessagePort, flag: Int32Array, req: HostRequest, timeoutMs: number): HostReply {
  Atomics.store(flag, 0, 0);
  port.postMessage(req);
  const deadline = performance.now() + timeoutMs;
  for (;;) {
    const left = deadline - performance.now();
    if (left <= 0) throw new Error(`GPU thread: no reply after ${Math.round(timeoutMs / 1000)} s`);
    Atomics.wait(flag, 0, 0, Math.min(left, 1000));
    const m = receiveMessageOnPort(port);
    if (m) return m.message as HostReply;
  }
}

export interface GpuEngineOptions {
  /** VRAM of each search (MB); DEFAULT_VRAM_MB by default */
  maxVramMb?: number;
  /** messages (CPU fallback); console.log by default */
  log?: (line: string) => void;
}

/**
 * ExactEngine on the GPU, with safeguards:
 * - level beyond the GPU limits (over 32 × 32): compact engine, with a message;
 * - GPU solution replayed (replay): if it does not win, if its length is not the
 *   announced one or if it is not shorter than upperBound, it is discarded (message) and the
 *   level is solved by the compact engine with the remaining time;
 * - GPU exception (device lost, reply timeout): message, compact engine for this level
 *   and all following ones.
 * The options' maxMemoryMb (compact engine RAM) only applies to the fallback; the GPU uses
 * maxVramMb. partialExpansion and now are ignored by the GPU (it has its own partial expansion and
 * measures real time).
 */
export function gpuExactEngine(gpu: GpuSolver, o: GpuEngineOptions = {}): ExactEngine {
  const log = o.log ?? ((line: string) => console.log(line));
  let broken = false;
  return (level: LevelData, opts: ExactOptions): SolveResult => {
    const t0 = performance.now();
    const cpu = (): SolveResult =>
      solve(level, {
        ...opts,
        timeoutMs: Math.max(0, (opts.timeoutMs ?? 60_000) - (performance.now() - t0)),
      });
    if (broken) return cpu();
    const unsupported = gpuUnsupported(level);
    if (unsupported) {
      log(`${level.id}: ${unsupported} for the GPU — compact engine (CPU)`);
      return cpu();
    }
    let r: GpuSolveResult;
    try {
      r = gpu.solve(level, {
        maxMemoryMb: o.maxVramMb ?? DEFAULT_VRAM_MB,
        ...(opts.timeoutMs !== undefined ? { timeoutMs: opts.timeoutMs } : {}),
        ...(opts.maxStates !== undefined && Number.isFinite(opts.maxStates)
          ? { maxStates: opts.maxStates }
          : {}),
        ...(opts.upperBound !== undefined ? { upperBound: opts.upperBound } : {}),
      });
    } catch (err) {
      broken = true;
      log(
        `${level.id}: GPU failure (${(err as Error).message}) — compact engine (CPU) from now on`,
      );
      return cpu();
    }
    if (r.status === 'solved') {
      const end = replay(level, r.moves);
      const tooLong = opts.upperBound !== undefined && r.moves.length >= opts.upperBound;
      if (end.status !== 'won' || end.moves !== r.moves.length || tooLong) {
        log(
          `${level.id}: inconsistent GPU solution (${r.moves.length} moves, status ${end.status}${tooLong ? `, ≥ bound ${opts.upperBound}` : ''}) — discarded, compact engine (CPU) for this level`,
        );
        return cpu();
      }
    }
    const { gpu: _stats, ...result } = r;
    return result;
  };
}
