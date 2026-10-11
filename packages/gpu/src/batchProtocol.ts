// Batch expansion service (batchHost.ts) shared by several CPU threads: each thread (lane) has
// its own shared buffers and port. The thread writes up to `stateCap` states in `input`, the
// request fields in `ctl`, posts 'go' on its port and waits on ctl[FLAG] (Atomics.wait); the
// GPU thread expands them (one request at a time on the card), writes the successors in
// `output` and the goals after the ctl header, then sets ctl[FLAG] and notifies.
import { Worker, type MessagePort } from 'node:worker_threads';
import type { LevelData } from '@puzzlecave/core';

export const CTL = {
  /** 0 = request pending, 1 = reply ready */
  FLAG: 0,
  COUNT: 1,
  G: 2,
  BEST: 3,
  /** successors written in output */
  OUT: 4,
  /** states of the request expanded (the others are sent again) */
  DONE: 5,
  TRUNC: 6,
  GOALS: 7,
  /** 1: the request failed (message on the port) */
  ERROR: 8,
  HEADER: 16,
} as const;
/** goals returned per request (cost, state index, edge) */
export const GOAL_SLOTS = 4096;
/** words of an output record after the key: state index, cost << 16 | edge */
export const OUT_EXTRA = 2;

export interface BatchLane {
  ctl: SharedArrayBuffer;
  input: SharedArrayBuffer;
  output: SharedArrayBuffer;
  port: MessagePort;
}

export interface BatchHostInit {
  level: LevelData;
  stateCap: number;
  /** output records per state of a request */
  perState: number;
  lanes: Omit<BatchLane, 'port'>[];
  ports: MessagePort[];
  /** machine lock file (one puzzleCave process on the card) */
  lockFile?: string | undefined;
}

export type BatchHostMessage =
  | { type: 'ready'; name: string }
  | { type: 'unavailable'; reason: string }
  | { type: 'error'; message: string };

export function laneBuffers(
  words: number,
  stateCap: number,
  perState: number,
): Omit<BatchLane, 'port'> {
  return {
    ctl: new SharedArrayBuffer((CTL.HEADER + GOAL_SLOTS * 3) * 4),
    input: new SharedArrayBuffer(stateCap * words * 4),
    output: new SharedArrayBuffer(stateCap * perState * (words + OUT_EXTRA) * 4),
  };
}

/** starts the GPU thread of the batch expansion (its first message: ready or unavailable) */
export function startBatchHost(init: BatchHostInit): Worker {
  return new Worker(new URL('./batchBoot.mjs', import.meta.url), {
    workerData: init,
    transferList: init.ports,
    env: process.env,
  });
}
