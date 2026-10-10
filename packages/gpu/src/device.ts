// GPU access through WebGPU (npm package `webgpu`, Dawn): adapter, compatibility check,
// device. The native package is only loaded through a dynamic import, on first call.

/** limits requested from the device */
const NEED_STORAGE_BUFFERS = 15;
const NEED_BINDING_BYTES = 128 * 1024 ** 2;
/** one grid row per lane: a group of 32 threads must be a single subgroup */
const NEED_SUBGROUP = 32;

export interface GpuHandle {
  device: GPUDevice;
  /** short adapter description (vendor, architecture, driver) */
  name: string;
  /** maximum size of a bound buffer (bytes) */
  maxBinding: number;
  /** the device was lost (driver, TDR): no longer usable */
  lost: boolean;
  /** last uncaptured WebGPU error */
  error?: string;
}

export type OpenResult = { ok: true; gpu: GpuHandle } | { ok: false; reason: string };

/**
 * The object returned by create() must stay alive as long as the device is in use: if it is collected,
 * Dawn shuts down under the device's feet (process crash).
 */
let keepAlive: unknown;

/** reason if a missing adapter is simulated (PUZZLECAVE_GPU=none), otherwise undefined */
export function simulatedAbsence(): string | undefined {
  return process.env.PUZZLECAVE_GPU === 'none'
    ? 'no WebGPU adapter (PUZZLECAVE_GPU=none)'
    : undefined;
}

/**
 * Opens a compatible device: `subgroups` feature with subgroups of at least 32
 * threads, 15 storage buffers per stage, bound buffers of at least 128 MiB. Environment
 * variable PUZZLECAVE_GPU=none: adapter missing (simulated fallback, tests).
 */
export async function openGpu(): Promise<OpenResult> {
  const simulated = simulatedAbsence();
  if (simulated) return { ok: false, reason: simulated };
  let mod: typeof import('webgpu');
  try {
    mod = await import('webgpu');
  } catch (err) {
    return { ok: false, reason: `webgpu module unavailable (${(err as Error).message})` };
  }
  try {
    const gpu = mod.create([]);
    keepAlive = gpu;
    const adapter = await gpu.requestAdapter({ powerPreference: 'high-performance' });
    if (!adapter) return { ok: false, reason: 'no WebGPU adapter' };
    const info = adapter.info as GPUAdapterInfo & { subgroupMinSize?: number };
    const name = [info.vendor, info.architecture, info.description].filter(Boolean).join(' ');
    const lim = adapter.limits;
    if (!adapter.features.has('subgroups')) return { ok: false, reason: `${name}: no subgroups` };
    if ((info.subgroupMinSize ?? 0) < NEED_SUBGROUP)
      return {
        ok: false,
        reason: `${name}: subgroups of ${info.subgroupMinSize ?? '?'} threads (${NEED_SUBGROUP} needed)`,
      };
    if (lim.maxStorageBuffersPerShaderStage < NEED_STORAGE_BUFFERS)
      return {
        ok: false,
        reason: `${name}: ${lim.maxStorageBuffersPerShaderStage} storage buffers per stage`,
      };
    if (
      lim.maxStorageBufferBindingSize < NEED_BINDING_BYTES ||
      lim.maxBufferSize < NEED_BINDING_BYTES
    )
      return {
        ok: false,
        reason: `${name}: buffers limited to ${lim.maxStorageBufferBindingSize} bytes`,
      };
    const device = await adapter.requestDevice({
      requiredFeatures: ['subgroups'],
      requiredLimits: {
        maxBufferSize: lim.maxBufferSize,
        maxStorageBufferBindingSize: lim.maxStorageBufferBindingSize,
        maxStorageBuffersPerShaderStage: NEED_STORAGE_BUFFERS,
      },
    });
    const handle: GpuHandle = {
      device,
      name,
      maxBinding: Math.min(lim.maxStorageBufferBindingSize, lim.maxBufferSize),
      lost: false,
    };
    device.lost.then((l) => {
      handle.lost = true;
      handle.error ??= `device lost (${l.reason}${l.message ? `: ${l.message}` : ''})`;
    });
    device.onuncapturederror = (e) => {
      handle.error ??= e.error.message;
    };
    return { ok: true, gpu: handle };
  } catch (err) {
    return { ok: false, reason: `WebGPU: ${(err as Error).message}` };
  }
}

/** releases the device (and all its memory) */
export function closeGpu(gpu: GpuHandle): void {
  gpu.device.destroy();
  gpu.lost = true;
}

void keepAlive;
