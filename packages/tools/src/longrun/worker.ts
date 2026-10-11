// Long-run worker thread: runs the jobs the coordinator sends (see expander.ts).
import { parentPort, workerData } from 'node:worker_threads';
import type { LevelData } from '@puzzlecave/core';
import { Expander, type ExpanderOptions } from './expander';
import { StopError, openShared, type JobSpec } from './layout';

export interface WorkerInit {
  level: LevelData;
  opts: ExpanderOptions;
  intsBuf: SharedArrayBuffer;
  diskBuf: SharedArrayBuffer;
}

export type WorkerRequest = { type: 'job'; spec: JobSpec } | { type: 'end' } | { type: 'abort' };

const init = workerData as WorkerInit;
const expander = new Expander(init.level, init.opts, openShared(init.intsBuf, init.diskBuf));
const port = parentPort!;

port.on('message', (msg: WorkerRequest) => {
  try {
    if (msg.type === 'job') port.postMessage({ type: 'done', result: expander.run(msg.spec) });
    else if (msg.type === 'end') port.postMessage({ type: 'ended', end: expander.endLayer() });
    else {
      expander.abortLayer();
      port.postMessage({ type: 'aborted' });
    }
  } catch (err) {
    if (err instanceof StopError) port.postMessage({ type: 'stopped', reason: err.reason });
    else port.postMessage({ type: 'error', message: (err as Error).stack ?? String(err) });
  }
});
port.postMessage({ type: 'ready' });
