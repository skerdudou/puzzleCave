// Child process of parallel `solve`: receives a task over IPC, solves one level, sends back the
// result and exits (see parallel.ts).
import { solve, type SolveResult } from '@puzzlecave/core';
import { loadPack } from '@puzzlecave/tiled';
import { exactBackend, type GpuTask } from './gpu';

export interface WorkerTask {
  dir: string;
  id: string;
  timeoutMs: number;
  /** state limit; absent = unlimited */
  maxStates?: number;
  /** solver memory cap (MB) */
  maxMemoryMb: number;
  /** GPU lane: search on the GPU */
  gpu?: GpuTask;
  /** tests only: child that throws, exits with code 7 or hangs */
  crash?: 'throw' | 'exit' | 'hang';
}

export interface WorkerReply {
  id: string;
  result: SolveResult;
  /** duration of the solve alone */
  ms: number;
  /** peak resident memory of the child process */
  maxRssMb: number;
  /** GPU engine messages (fallback to the CPU) */
  notes?: string[];
}

process.once('message', async (task: WorkerTask) => {
  if (task.crash === 'throw') throw new Error(`simulated failure (${task.id})`);
  if (task.crash === 'exit') process.exit(7);
  if (task.crash === 'hang') for (;;);
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
  let result: SolveResult;
  try {
    result = (backend?.engine ?? solve)(level, {
      timeoutMs: task.timeoutMs,
      maxStates: task.maxStates,
      maxMemoryMb: task.maxMemoryMb,
      partialExpansion: 'auto',
    });
  } finally {
    backend?.close();
  }
  const reply: WorkerReply = {
    id: task.id,
    result,
    ms: performance.now() - t0,
    maxRssMb: Math.round(process.resourceUsage().maxRSS / 1024),
    ...(notes.length ? { notes } : {}),
  };
  process.send!(reply, () => process.disconnect?.());
});
