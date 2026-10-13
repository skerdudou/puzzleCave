// Certification worker thread (see certify.ts): takes segments in order from the shared plan,
// evaluates g + h on their records and lowers the shared minimum. Files are opened read-only.
import { closeSync, openSync, readSync } from 'node:fs';
import { parentPort, workerData } from 'node:worker_threads';
import { CompactModel, StrongBound, UNREACHABLE } from '@puzzlecave/core';
import type { CertifyWorkerInit, CertifyWorkerResult } from './certify';
import { decompress, recordWords } from './layout';

const init = workerData as CertifyWorkerInit;
const { plan, ints, counts, worker } = init;
const model = new CompactModel(init.level);
const bound = new StrongBound(model);
const toExit = bound.compact.toExit;
const words = init.words;
const R = recordWords(words);
const fds = new Map<number, number>();
let zbuf = new Uint8Array(1 << 16);
const result: CertifyWorkerResult = { read: 0, evaluated: 0 };

function lower(value: number): boolean {
  for (;;) {
    const cur = Atomics.load(ints, 0);
    if (value >= cur) return false;
    if (Atomics.compareExchange(ints, 0, cur, value) === cur) return true;
  }
}

try {
  for (;;) {
    const s = Atomics.add(ints, 1, 1);
    if (s >= plan.count) break;
    // segments are sorted by min f: nothing further can go below the minimum
    if (plan.minF[s]! >= Atomics.load(ints, 0)) break;
    const g = plan.layer[s]!;
    const count = plan.records[s]!;
    const size = plan.stored[s]!;
    const f = plan.fileId[s]!;
    let fd = fds.get(f);
    if (fd === undefined) {
      fd = openSync(plan.files[f]!, 'r');
      fds.set(f, fd);
    }
    if (zbuf.length < size) zbuf = new Uint8Array(size * 2);
    const view = zbuf.subarray(0, size);
    let got = 0;
    while (got < size) {
      const k = readSync(fd, view, got, size - got, plan.offset[s]! + got);
      if (k === 0) throw new Error(`${plan.files[f]}: unexpected end of file`);
      got += k;
    }
    const recs = decompress(view, count * R * 4, R);
    for (let r = 0; r < count; r++) {
      const best = Atomics.load(ints, 0);
      const o = r * R;
      // the player tile is in the low 16 bits of word 0
      if (g + toExit[recs[o]! & 0xffff]! >= best) continue;
      model.load(recs, o);
      result.evaluated++;
      const h = bound.value(best - g);
      if (h >= UNREACHABLE) continue;
      if (g + h < best && lower(g + h))
        result.best = { value: g + h, layer: g, key: Array.from(recs.subarray(o, o + words)) };
    }
    result.read += count;
    counts[worker * 2] = result.read;
    counts[worker * 2 + 1] = result.evaluated;
  }
} finally {
  for (const fd of fds.values()) closeSync(fd);
}
parentPort!.postMessage(result);
