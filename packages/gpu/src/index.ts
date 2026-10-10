// Exact GPU engine (WebGPU, native `webgpu` package loaded on demand). To be imported
// dynamically: `await import('@puzzlecave/gpu')`.
import { GpuWorker, type OpenOptions } from './engine';

export { MAX_SIDE, gpuUnsupported } from './layout';
export { closeGpu, openGpu, type GpuHandle, type OpenResult } from './device';
export { gpuSolveOn, type GpuSolveOptions, type GpuSolveResult, type GpuStats } from './gpuSolve';
export {
  DEFAULT_VRAM_MB,
  GpuLock,
  GpuWorker,
  LOCK_FILE,
  gpuExactEngine,
  type GpuEngineOptions,
  type GpuSolver,
  type OpenOptions,
} from './engine';

/**
 * is a compatible adapter present and free? (takes the machine lock, opens then
 * closes the GPU thread)
 */
export function probeGpu(
  o: OpenOptions = {},
): { ok: true; name: string } | { ok: false; reason: string; busy?: boolean } {
  const r = GpuWorker.open(o);
  if (!r.ok) return r;
  const name = r.worker.name;
  r.worker.close();
  return { ok: true, name };
}
