// GPU thread of the long-run batch expansion: owns the device, serves the lanes' requests one
// at a time (see batchProtocol.ts).
import { parentPort, workerData } from 'node:worker_threads';
import { GpuBatchExpander } from './batch';
import { CTL, GOAL_SLOTS, type BatchHostInit, type BatchHostMessage } from './batchProtocol';
import { closeGpu, openGpu } from './device';
import { GpuLock, LOCK_FILE } from './engine';

const init = workerData as BatchHostInit;
const post = (m: BatchHostMessage) => parentPort!.postMessage(m);

async function main(): Promise<void> {
  const locked = GpuLock.acquire(init.lockFile ?? LOCK_FILE, 0);
  if (!locked.ok) return post({ type: 'unavailable', reason: locked.reason });
  const opened = await openGpu();
  if (!opened.ok) {
    locked.lock.release();
    return post({ type: 'unavailable', reason: opened.reason });
  }
  const gpu = opened.gpu;
  // one expander (buffers) per lane: the lanes' requests overlap, the device queue orders
  // the kernels
  let gxs: GpuBatchExpander[];
  try {
    gxs = [];
    for (let i = 0; i < init.lanes.length; i++)
      gxs.push(await GpuBatchExpander.open(gpu, init.level, init.stateCap, init.perState));
  } catch (err) {
    locked.lock.release();
    return post({ type: 'unavailable', reason: (err as Error).message });
  }
  const W = gxs[0]!.words;
  const pending = new Set<Promise<void>>();
  init.lanes.forEach((lane, i) => {
    const gx = gxs[i]!;
    const ctl = new Int32Array(lane.ctl);
    const input = new Uint32Array(lane.input);
    const output = new Uint32Array(lane.output);
    const port = init.ports[i]!;
    port.on('message', () => {
      const job = (async () => {
        try {
          const count = ctl[CTL.COUNT]!;
          // WebGPU does not take views of shared memory: private copy
          const states = input.slice(0, count * W);
          const r = await gx.expand(states, count, ctl[CTL.G]!, ctl[CTL.BEST]!, output);
          ctl[CTL.OUT] = r.count;
          ctl[CTL.DONE] = r.done;
          ctl[CTL.TRUNC] = r.truncated ? 1 : 0;
          const goals = Math.min(r.goals.length / 3, GOAL_SLOTS);
          ctl[CTL.GOALS] = goals;
          for (let k = 0; k < goals * 3; k++) ctl[CTL.HEADER + k] = r.goals[k]!;
          ctl[CTL.ERROR] = 0;
        } catch (err) {
          ctl[CTL.ERROR] = 1;
          port.postMessage((err as Error).message);
        }
        Atomics.store(ctl, CTL.FLAG, 1);
        Atomics.notify(ctl, CTL.FLAG);
      })();
      pending.add(job);
      void job.then(() => pending.delete(job));
    });
  });
  // 'close' from the coordinator: device and machine lock released, then the thread ends
  parentPort!.on('message', (m: unknown) => {
    if (m !== 'close') return;
    void Promise.all(pending).then(() => {
      for (const gx of gxs) gx.destroy();
      closeGpu(gpu);
      locked.lock.release();
      process.exit(0);
    });
  });
  post({ type: 'ready', name: gpu.name });
}

main().catch((err: unknown) => post({ type: 'error', message: String(err) }));
