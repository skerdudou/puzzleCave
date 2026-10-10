// Choice of the engine for global exact searches according to --gpu: the @puzzlecave/gpu package
// (and the native webgpu module) is only loaded by dynamic import, and only if --gpu is not off.
import type { ExactEngine } from '@puzzlecave/core';
import type { GpuMode } from './args';

export interface ExactBackend {
  /** GPU engine (with its safeguards); undefined = compact engine (CPU) */
  engine?: ExactEngine;
  /** "CPU" or "GPU <adapter>" */
  label: string;
  /** releases the GPU (VRAM, thread) */
  close(): void;
}

/** task of a GPU-lane child */
export interface GpuTask {
  mode: 'auto' | 'on';
  maxVramMb?: number | undefined;
}

export interface BackendOptions {
  /** VRAM of each search (MB); GPU engine default otherwise */
  maxVramMb?: number | undefined;
  log: (line: string) => void;
}

/**
 * the GPU engine handles this level (same rule as gpuUnsupported in @puzzlecave/gpu, tested against
 * it: the package is not imported statically)
 */
export function fitsGpu(level: { width: number; height: number }): boolean {
  return level.width <= 32 && level.height <= 32;
}

const CPU: ExactBackend = { label: 'CPU', close() {} };
/** the "GPU unavailable" message is only given once per process */
let noticed = false;

function unavailable(mode: GpuMode, reason: string, log: (line: string) => void): ExactBackend {
  if (mode === 'on') throw new Error(`--gpu on: ${reason}`);
  if (!noticed) {
    noticed = true;
    log(`GPU unavailable (${reason}) — exact searches on the CPU (compact engine)`);
  }
  return CPU;
}

async function loadGpu(): Promise<typeof import('@puzzlecave/gpu') | string> {
  try {
    return await import('@puzzlecave/gpu');
  } catch (err) {
    return `@puzzlecave/gpu module unavailable (${(err as Error).message})`;
  }
}

/** wait for the card held by another puzzleCave process, with --gpu on */
const ON_WAIT_MS = 3_600_000;

/**
 * Opens the GPU (machine-wide lock: one process at a time). Card taken: 'auto' does not wait
 * (CPU), 'on' waits for it to be released (one hour at most) with a message.
 */
function open<R extends { ok: boolean; busy?: boolean; reason?: string }>(
  mode: GpuMode,
  attempt: (o: { waitMs: number }) => R,
  log: (line: string) => void,
): R {
  const first = attempt({ waitMs: 0 });
  if (first.ok || !first.busy || mode !== 'on') return first;
  log(`${first.reason} — waiting for the card (--gpu on)`);
  return attempt({ waitMs: ON_WAIT_MS });
}

/**
 * Engine for global exact searches: 'off' → CPU; 'auto' → GPU if a compatible adapter is present
 * and free, otherwise CPU with a single message; 'on' → GPU (waiting for another process to
 * release it) or an error.
 */
export async function exactBackend(mode: GpuMode, o: BackendOptions): Promise<ExactBackend> {
  if (mode === 'off') return CPU;
  const gpu = await loadGpu();
  if (typeof gpu === 'string') return unavailable(mode, gpu, o.log);
  const opened = open(mode, (w) => gpu.GpuWorker.open(w), o.log);
  if (!opened.ok) return unavailable(mode, opened.reason, o.log);
  const worker = opened.worker;
  return {
    engine: gpu.gpuExactEngine(worker, {
      log: o.log,
      ...(o.maxVramMb !== undefined ? { maxVramMb: o.maxVramMb } : {}),
    }),
    label: `GPU ${worker.name}`,
    close: () => worker.close(),
  };
}

/** Is the GPU usable? (opens then closes the device; same rules as exactBackend) */
export async function probeBackend(
  mode: GpuMode,
  log: (line: string) => void,
): Promise<{ gpu: boolean; label: string }> {
  if (mode === 'off') return { gpu: false, label: 'CPU' };
  const gpu = await loadGpu();
  if (typeof gpu === 'string') return { gpu: false, label: unavailable(mode, gpu, log).label };
  const r = open(mode, (w) => gpu.probeGpu(w), log);
  if (!r.ok) return { gpu: false, label: unavailable(mode, r.reason, log).label };
  return { gpu: true, label: `GPU ${r.name}` };
}
