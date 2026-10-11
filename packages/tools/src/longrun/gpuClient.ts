// CPU side of the GPU batch expansion (see @puzzlecave/gpu batchProtocol): synchronous calls
// from a worker thread, which waits on the shared flag.
import { receiveMessageOnPort } from 'node:worker_threads';
import { CTL, OUT_EXTRA, type BatchLane } from '@puzzlecave/gpu';

/** longest wait for one request (the card may be busy with the other lanes) */
const TIMEOUT_MS = 120_000;

export class GpuBatchClient {
  readonly ctl: Int32Array;
  /** states of the next request (words each) */
  readonly input: Uint32Array;
  /** successors of the last reply (words + OUT_EXTRA each) */
  readonly output: Uint32Array;
  readonly stateCap: number;
  readonly stride: number;

  constructor(
    private readonly lane: BatchLane,
    words: number,
  ) {
    this.ctl = new Int32Array(lane.ctl);
    this.input = new Uint32Array(lane.input);
    this.output = new Uint32Array(lane.output);
    this.stateCap = Math.floor(this.input.length / words);
    this.stride = words + OUT_EXTRA;
  }

  /**
   * expands input[0, count) at cost g, successors with f < best only; returns the states done
   * (the first `done`, the others must be sent again), successors and goals in ctl
   */
  call(
    count: number,
    g: number,
    best: number,
  ): { done: number; out: number; goals: number; truncated: boolean } {
    const ctl = this.ctl;
    ctl[CTL.COUNT] = count;
    ctl[CTL.G] = g;
    ctl[CTL.BEST] = best;
    Atomics.store(ctl, CTL.FLAG, 0);
    this.lane.port.postMessage('go');
    if (Atomics.wait(ctl, CTL.FLAG, 0, TIMEOUT_MS) === 'timed-out')
      throw new Error('GPU batch expansion: no reply');
    if (ctl[CTL.ERROR] !== 0) {
      const m = receiveMessageOnPort(this.lane.port);
      throw new Error(`GPU batch expansion: ${m ? String(m.message) : 'failed'}`);
    }
    return {
      done: ctl[CTL.DONE]!,
      out: ctl[CTL.OUT]!,
      goals: ctl[CTL.GOALS]!,
      truncated: ctl[CTL.TRUNC] !== 0,
    };
  }

  /** goal k of the last reply: cost, state index, edge */
  goal(k: number): [number, number, number] {
    const o = CTL.HEADER + 3 * k;
    return [this.ctl[o]!, this.ctl[o + 1]!, this.ctl[o + 2]!];
  }
}
