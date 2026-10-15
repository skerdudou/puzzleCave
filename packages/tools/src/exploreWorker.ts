// Explore worker thread: rebuilds candidates of the structural pass (see explorePool.ts). Its
// Rebuilder (and memo) belongs to the solution of the last reset; a run stops as soon as the
// pool raises this worker's cancel flag.
import { parentPort, workerData } from 'node:worker_threads';
import { Rebuilder, segmentSolution, type CandidateOutcome } from '@puzzlecave/core';
import type { ExploreWorkerInit, ExploreWorkerReply, ExploreWorkerRequest } from './explorePool';

const init = workerData as ExploreWorkerInit;
const flags = new Int32Array(init.flags);
const cancelled = () => Atomics.load(flags, init.index) !== 0;
const port = parentPort!;
let rb: Rebuilder | undefined;
// searches and retries of the rebuilders of earlier solutions
let searches = 0;
let retries = 0;

port.on('message', (msg: ExploreWorkerRequest) => {
  if (msg.type === 'reset') {
    searches += rb?.searches ?? 0;
    retries += rb?.retries ?? 0;
    rb = new Rebuilder(segmentSolution(init.level, msg.moves), { ...init.opts, cancelled });
    return;
  }
  let reply: ExploreWorkerReply;
  try {
    if (!rb) throw new Error('no solution: reset first');
    const out: CandidateOutcome = rb.rebuild(msg.order, msg.bound, true);
    reply = {
      type: 'done',
      id: msg.id,
      out,
      searches: searches + rb.searches,
      retries: retries + rb.retries,
    };
  } catch (err) {
    reply = { type: 'error', id: msg.id, message: (err as Error).stack ?? String(err) };
  }
  port.postMessage(reply);
});
