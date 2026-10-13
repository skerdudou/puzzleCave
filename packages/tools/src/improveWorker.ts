// Child process of parallel `improve`: receives a task over IPC, runs one level's "best known"
// pipeline, sends back the result and exits (see improve.ts, pool.ts).
import { improveLevel, type Dir, type ImproveResult } from '@puzzlecave/core';
import { loadPack } from '@puzzlecave/tiled';
import { exactBackend, type GpuTask } from './gpu';

export interface ImproveTask {
  dir: string;
  id: string;
  timeoutMs: number;
  /** state limit; absent = unlimited */
  maxStates?: number;
  /** memory cap of each pipeline search (MB) */
  maxMemoryMb: number;
  /** saved (designer) solution, read by the parent */
  initial?: Dir[];
  /** GPU lane: global searches (frozen blocks, proof) on the GPU */
  gpu?: GpuTask;
  /** solution search: duration (ms), memory cap (MB), key closure (see ImproveOptions) */
  findTimeoutMs?: number;
  findMemoryMb?: number;
  keyClosure?: boolean;
}

export interface ImproveReply {
  id: string;
  result: ImproveResult;
  ms: number;
  maxRssMb: number;
  /** GPU engine messages (fallback to the CPU) */
  notes?: string[];
}

process.once('message', async (task: ImproveTask) => {
  const level = loadPack(task.dir).levels.find((l) => l.id === task.id);
  if (!level) throw new Error(`unknown level: ${task.id}`);
  const notes: string[] = [];
  const backend = task.gpu
    ? await exactBackend(task.gpu.mode, {
        maxVramMb: task.gpu.maxVramMb,
        log: (line) => notes.push(line),
      })
    : undefined;
  const t0 = performance.now();
  let result: ImproveResult;
  try {
    result = improveLevel(level, {
      timeoutMs: task.timeoutMs,
      maxStates: task.maxStates,
      maxMemoryMb: task.maxMemoryMb,
      ...(task.initial ? { initial: task.initial } : {}),
      ...(backend?.engine ? { global: backend.engine } : {}),
      findTimeoutMs: task.findTimeoutMs,
      findMemoryMb: task.findMemoryMb,
      keyClosure: task.keyClosure,
    });
  } finally {
    backend?.close();
  }
  const reply: ImproveReply = {
    id: task.id,
    result,
    ms: performance.now() - t0,
    maxRssMb: Math.round(process.resourceUsage().maxRSS / 1024),
    ...(notes.length ? { notes } : {}),
  };
  process.send!(reply, () => process.disconnect?.());
});
