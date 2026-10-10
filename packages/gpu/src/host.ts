// GPU thread: owns the WebGPU device and runs the searches (Dawn's asynchronous API). The main
// thread calls it synchronously (GpuWorker, engine.ts): each reply is posted on
// the port then signaled with Atomics.notify.
import { workerData, type MessagePort } from 'node:worker_threads';
import { closeGpu, openGpu, type GpuHandle } from './device';
import { gpuSolveOn } from './gpuSolve';
import type { HostReply, HostRequest } from './protocol';

const { port, signal } = workerData as { port: MessagePort; signal: SharedArrayBuffer };
const flag = new Int32Array(signal);
let gpu: GpuHandle | undefined;

function reply(m: HostReply): void {
  port.postMessage(m);
  Atomics.store(flag, 0, 1);
  Atomics.notify(flag, 0);
}

port.on('message', (req: HostRequest) => {
  void handle(req).then(reply, (err: unknown) =>
    reply({ type: 'error', message: err instanceof Error ? err.message : String(err) }),
  );
});

async function handle(req: HostRequest): Promise<HostReply> {
  if (req.type === 'open') {
    const r = await openGpu();
    if (!r.ok) return { type: 'unavailable', reason: r.reason };
    gpu = r.gpu;
    return { type: 'opened', name: r.gpu.name };
  }
  if (req.type === 'close') {
    if (gpu) closeGpu(gpu);
    gpu = undefined;
    return { type: 'closed' };
  }
  if (!gpu) throw new Error('GPU non ouvert');
  if (gpu.lost) throw new Error(gpu.error ?? 'appareil perdu');
  return { type: 'result', result: await gpuSolveOn(gpu, req.level, req.opts) };
}
