// Messages between the main thread (GpuWorker) and the GPU thread (host.ts).
import type { LevelData } from '@puzzlecave/core';
import type { GpuSolveOptions, GpuSolveResult } from './gpuSolve';

export type HostRequest =
  { type: 'open' } | { type: 'close' } | { type: 'solve'; level: LevelData; opts: GpuSolveOptions };

export type HostReply =
  | { type: 'opened'; name: string }
  | { type: 'unavailable'; reason: string }
  | { type: 'closed' }
  | { type: 'result'; result: GpuSolveResult }
  | { type: 'error'; message: string };
