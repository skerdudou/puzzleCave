// `npm run certify -- <work-dir> [--level id] [--threads n] [--target T]`: offline certification
// of a long-run checkpoint with the strong admissible bound (StrongBound.value). READ-ONLY: the
// manifest and the pending gen files are only opened for reading; nothing is written in the work
// dir (the run may even be resumed later).
//
// Claim: C* ≥ min(B, min over pending records r of g_r + h(s_r)), where B = the checkpoint's best
// goal or upper bound, the pending records are the records of the gen files listed in the
// manifest whose target layer is ≥ nextLayer, and h is admissible. Proof (same as the bound of
// search.ts, with h instead of toExit): if C* < B, let P be an optimal path and s its first state
// not expanded at its optimal cost g*(s) (the start, if layer 0 is pending). Its predecessor was
// expanded at its optimal cost, so s was emitted with cost g*(s): the emission can only be
// dropped when g* + toExit(s) ≥ best (then C* ≥ B), or by the recent-successor cache when the same
// state was emitted with a cost ≤ g* (that record has cost g* and takes its place). If
// g*(s) < nextLayer, that layer was processed and the record of s was expanded (contradiction),
// was a duplicate of one that was (contradiction), was already expanded at a smaller cost
// (contradiction with g* optimal), or was pruned by the strong bound (then C* ≥ B). So a record
// of s with cost g*(s) is pending, and C* = g*(s) + h*(s) ≥ g*(s) + h(s). Including other pending
// records (duplicates, states already expanded) can only lower the minimum.
// Version 5 checkpoints (dominance pruning: a state is dropped when an expanded state of an
// earlier layer walks, at no greater cost, to a state that dominates it): s may have been dropped,
// so the argument goes through the covering lemma at the top of expander.ts instead. Its pending
// case is a record y with g_y ≤ t + 1 that dominates the path's state at time t + 1, hence
// h*(y) ≤ C* − t − 1 and g_y + h(y) ≤ g_y + h*(y) ≤ C* for any admissible h: the same claim.
// The gen files and their indexes are unchanged in v5 (only the partition hash and the run
// block index differ), so both versions are read the same way.
//
// Order: the index entries (segments) are sorted by their min f = g + toExit; a segment whose min
// f is ≥ the current minimum cannot lower it and the scan stops there. --target T starts from
// min(B, T): only records with g + h < T are looked for, and the result is "≥ T" if none.
import { closeSync, openSync, readFileSync, readSync } from 'node:fs';
import { availableParallelism } from 'node:os';
import { join } from 'node:path';
import { Worker } from 'node:worker_threads';
import { CompactModel, hashWords, toAscii, type LevelData } from '@puzzlecave/core';
import { loadPack } from '@puzzlecave/tiled';
import type { CommandResult } from '../commands';
import {
  INDEX_FIELDS,
  coreHash,
  decompress,
  keyMaskOf,
  genFile,
  indexFile,
  partOf,
  recordWords,
  runFile,
} from './layout';
import { fingerprint } from './search';

export const CERTIFY_USAGE =
  'usage: certify <work-dir> [--level id] [--threads n] [--target T] [--progress s] [--skip-fingerprint]';

export interface CertifyOptions {
  workDir: string;
  level?: string | undefined;
  threads?: number | undefined;
  target?: number | undefined;
  /** seconds between progress lines (default 60) */
  progressSec?: number | undefined;
  /** accept a checkpoint whose fingerprint differs (metadata) if its start state matches */
  skipFingerprint?: boolean | undefined;
}

export function parseCertifyArgs(args: string[]): CertifyOptions | { error: string } {
  const valued = new Set(['--level', '--threads', '--target', '--progress']);
  const value = (name: string) => {
    const i = args.indexOf(name);
    return i < 0 ? undefined : args[i + 1];
  };
  const num = (name: string) => {
    const raw = value(name);
    if (raw === undefined) return undefined;
    const n = Number(raw);
    return Number.isFinite(n) && n >= 0 ? n : null;
  };
  const threads = num('--threads');
  const target = num('--target');
  const progress = num('--progress');
  if (threads === null || target === null || progress === null) return { error: CERTIFY_USAGE };
  const dirs = args.filter((a, i) => !a.startsWith('--') && !valued.has(args[i - 1] ?? ''));
  if (dirs.length !== 1) return { error: CERTIFY_USAGE };
  return {
    workDir: dirs[0]!,
    level: value('--level'),
    threads: threads ?? undefined,
    target: target ?? undefined,
    progressSec: progress ?? undefined,
    skipFingerprint: args.includes('--skip-fingerprint'),
  };
}

/** what the manifest says (fields used here) */
interface ManifestView {
  version: number;
  level: string;
  fingerprint: string;
  words: number;
  nextLayer: number;
  best: number;
  upperBound: number;
  gens: { layer: number; worker: number }[];
}

/** segments to scan, in shared memory (read by the workers) */
export interface CertifyPlan {
  files: string[];
  count: number;
  fileId: Uint16Array<SharedArrayBuffer>;
  offset: Float64Array<SharedArrayBuffer>;
  records: Uint32Array<SharedArrayBuffer>;
  stored: Uint32Array<SharedArrayBuffer>;
  layer: Uint16Array<SharedArrayBuffer>;
  minF: Uint16Array<SharedArrayBuffer>;
}

export interface CertifyWorkerInit {
  level: LevelData;
  words: number;
  plan: CertifyPlan;
  /** [0] current minimum (exclusive bound), [1] next segment to take */
  ints: Int32Array;
  /** per worker: records read, records whose strong bound was computed (Float64) */
  counts: Float64Array;
  worker: number;
}

export interface CertifyWorkerResult {
  /** lowest g + h found below the start bound by this worker, with its record */
  best?: { value: number; layer: number; key: number[] };
  read: number;
  evaluated: number;
}

export interface CertifyResult {
  lowerBound: number;
  /** the minimum was reached by a pending record (otherwise: start bound) */
  witness?: { value: number; layer: number; state: string[] };
  pending: number;
  scanned: number;
  evaluated: number;
  ms: number;
  start: number;
}

/**
 * reads the manifest and the segment indexes: the pending segments with min f < below, sorted by
 * min f, and the number of pending records
 */
export function planCertify(
  dir: string,
  below: number,
): { m: ManifestView; plan: CertifyPlan; pending: number } {
  const m = JSON.parse(readFileSync(join(dir, 'manifest.json'), 'utf8')) as ManifestView;
  if (m.version !== 4 && m.version !== 5)
    throw new Error(`${dir}: unsupported checkpoint version ${m.version}`);
  const files: string[] = [];
  let cap = 1 << 16;
  let fileId = new Uint16Array(cap);
  let offset = new Float64Array(cap);
  let records = new Uint32Array(cap);
  let stored = new Uint32Array(cap);
  let layer = new Uint16Array(cap);
  let minF = new Uint16Array(cap);
  let count = 0;
  let pending = 0;
  for (const g of m.gens) {
    const bin = genFile(dir, g.layer, g.worker);
    const id = files.length;
    files.push(bin);
    if (id > 0xffff) throw new Error('too many gen files');
    const raw = readFileSync(indexFile(bin));
    const idx = new Float64Array(raw.buffer, raw.byteOffset, raw.byteLength / 8);
    for (let i = 0; i < idx.length; i += INDEX_FIELDS) {
      const target = idx[i]!;
      if (target < m.nextLayer) continue;
      pending += idx[i + 3]!;
      const f = idx[i + 4]!;
      if (target >= below || f >= below) continue;
      if (count === cap) {
        cap *= 2;
        const grow = <T extends Uint16Array | Uint32Array | Float64Array>(
          a: T,
          make: (n: number) => T,
        ) => {
          const b = make(cap);
          b.set(a);
          return b;
        };
        fileId = grow(fileId, (k) => new Uint16Array(k));
        offset = grow(offset, (k) => new Float64Array(k));
        records = grow(records, (k) => new Uint32Array(k));
        stored = grow(stored, (k) => new Uint32Array(k));
        layer = grow(layer, (k) => new Uint16Array(k));
        minF = grow(minF, (k) => new Uint16Array(k));
      }
      fileId[count] = id;
      offset[count] = idx[i + 2]!;
      records[count] = idx[i + 3]!;
      layer[count] = target;
      minF[count] = Math.min(0xffff, f);
      stored[count] = idx[i + 5]!;
      count++;
    }
  }
  // sort by min f (then layer): order of a permutation, then copy into shared arrays
  const order = new Uint32Array(count);
  for (let i = 0; i < count; i++) order[i] = i;
  const keyOf = new Float64Array(count);
  for (let i = 0; i < count; i++) keyOf[i] = minF[i]! * 65536 + layer[i]!;
  order.sort((a, b) => keyOf[a]! - keyOf[b]!);
  const buf = (bytes: number) => new SharedArrayBuffer(Math.max(8, count * bytes));
  const plan: CertifyPlan = {
    files,
    count,
    fileId: new Uint16Array(buf(2)),
    offset: new Float64Array(buf(8)),
    records: new Uint32Array(buf(4)),
    stored: new Uint32Array(buf(4)),
    layer: new Uint16Array(buf(2)),
    minF: new Uint16Array(buf(2)),
  };
  for (let i = 0; i < count; i++) {
    const j = order[i]!;
    plan.fileId[i] = fileId[j]!;
    plan.offset[i] = offset[j]!;
    plan.records[i] = records[j]!;
    plan.stored[i] = stored[j]!;
    plan.layer[i] = layer[j]!;
    plan.minF[i] = minF[j]!;
  }
  return { m, plan, pending };
}

/**
 * the root record of a checkpoint (start state key): pending in the gen file of layer -1, or,
 * once layer 0 is done, the first record of its partition's run file
 */
function readRoot(dir: string, start: Uint32Array, keyMask?: Uint32Array): Uint32Array | undefined {
  const words = start.length;
  const R = recordWords(words);
  try {
    const m = JSON.parse(readFileSync(join(dir, 'manifest.json'), 'utf8')) as {
      version: number;
      nextLayer: number;
      parts: number;
      runBlocks: number[][];
    };
    let stored: Uint8Array;
    if (m.nextLayer === 0) {
      const bin = genFile(dir, -1, 0);
      const raw = readFileSync(indexFile(bin));
      const idx = new Float64Array(raw.buffer, raw.byteOffset, raw.byteLength / 8);
      stored = readFileSync(bin).subarray(idx[2]!, idx[2]! + idx[5]!);
      return decompress(new Uint8Array(stored), R * 4, R).slice(0, words);
    }
    // v4: partition by the full key hash; v5: by the core hash (blocks, waters, doors)
    const hash = m.version >= 5 ? coreHash(start, 0, words, keyMask!) : hashWords(start, 0, words);
    const part = partOf(hash, m.parts);
    const block = m.runBlocks[part]!;
    const fd = openSync(runFile(dir, part), 'r');
    try {
      const buf = new Uint8Array(block[1]!);
      readSync(fd, buf, 0, buf.length, block[0]!);
      return decompress(buf, block[2]! * R * 4, R).slice(0, words);
    } finally {
      closeSync(fd);
    }
  } catch {
    return undefined;
  }
}

export async function certify(
  level: LevelData,
  opts: CertifyOptions,
  log: (line: string) => void = () => undefined,
): Promise<CertifyResult> {
  const t0 = performance.now();
  const dir = opts.workDir;
  const head = JSON.parse(readFileSync(join(dir, 'manifest.json'), 'utf8')) as ManifestView;
  const model = new CompactModel(level);
  if (head.words !== model.words) throw new Error(`${dir}: checkpoint with another state size`);
  if (head.fingerprint !== fingerprint(level)) {
    if (!opts.skipFingerprint)
      throw new Error(
        `${dir}: checkpoint of another level or level version (medal thresholds count too: --skip-fingerprint if only they changed)`,
      );
    // weaker check: the root record is the start state of this level
    const start = model.encode(model.start);
    const root = readRoot(dir, start, keyMaskOf(model));
    if (!root || start.some((v, i) => v !== root[i]))
      throw new Error(`${dir}: the checkpoint's start state is not the level's start state`);
    log(`${level.id}: fingerprint differs; start state checked (same level rules assumed)`);
  }
  const start = Math.min(head.best, opts.target ?? Infinity);
  const { m, plan, pending } = planCertify(dir, start);
  log(
    `${level.id}: checkpoint at layer ${m.nextLayer}, best ${m.best}, ${pending} pending records; ${plan.count} segments with min f < ${start} (index read in ${((performance.now() - t0) / 1000).toFixed(1)} s)`,
  );
  const ints = new Int32Array(new SharedArrayBuffer(8));
  ints[0] = start;
  ints[1] = 0;
  const threads = Math.max(1, Math.floor(opts.threads ?? Math.max(1, availableParallelism() / 2)));
  const counts = new Float64Array(new SharedArrayBuffer(threads * 2 * 8));
  const results: CertifyWorkerResult[] = [];
  const timer = setInterval(
    () => {
      let read = 0;
      let evaluated = 0;
      for (let w = 0; w < threads; w++) {
        read += counts[w * 2]!;
        evaluated += counts[w * 2 + 1]!;
      }
      const at = Math.min(Atomics.load(ints, 1), plan.count);
      const f = at < plan.count ? plan.minF[at] : '-';
      log(
        `${((performance.now() - t0) / 1000).toFixed(0)} s: segment ${at}/${plan.count} (min f ${f}), ${read} records read, ${evaluated} evaluated, minimum ${Atomics.load(ints, 0)}`,
      );
    },
    (opts.progressSec ?? 60) * 1000,
  );
  try {
    await Promise.all(
      Array.from({ length: threads }, (_, w) => {
        const init: CertifyWorkerInit = { level, words: m.words, plan, ints, counts, worker: w };
        const worker = new Worker(new URL('./certifyBoot.mjs', import.meta.url), {
          workerData: init,
        });
        return new Promise<void>((resolve, reject) => {
          worker.once('message', (r: CertifyWorkerResult) => {
            results.push(r);
            void worker.terminate().then(() => resolve());
          });
          worker.once('error', reject);
        });
      }),
    );
  } finally {
    clearInterval(timer);
  }
  const lowerBound = Atomics.load(ints, 0);
  let witness: CertifyResult['witness'];
  for (const r of results)
    if (r.best && r.best.value === lowerBound && !witness) {
      const s = model.decode(Uint32Array.from(r.best.key));
      witness = { value: r.best.value, layer: r.best.layer, state: toAscii(s) };
    }
  return {
    lowerBound,
    ...(witness ? { witness } : {}),
    pending,
    scanned: results.reduce((a, r) => a + r.read, 0),
    evaluated: results.reduce((a, r) => a + r.evaluated, 0),
    ms: performance.now() - t0,
    start,
  };
}

export async function certifyCommand(
  levelsDir: string,
  opts: CertifyOptions,
  log: (line: string) => void,
): Promise<CommandResult> {
  const head = JSON.parse(
    readFileSync(join(opts.workDir, 'manifest.json'), 'utf8'),
  ) as ManifestView;
  const id = opts.level ?? head.level;
  const level = loadPack(levelsDir).levels.find((l) => l.id === id);
  if (!level) return { ok: false, lines: [`${id}: unknown level`] };
  const r = await certify(level, opts, log);
  const lines = [
    `${id}: ${r.scanned} records read, ${r.evaluated} evaluated with the strong bound, ${(r.ms / 1000).toFixed(0)} s`,
    `${id}: certified lower bound ≥ ${r.lowerBound}${r.lowerBound >= r.start ? ` (no pending record below the start bound ${r.start})` : ''}`,
  ];
  if (r.witness)
    lines.push(
      `lowest pending record: g = ${r.witness.layer}, g + h = ${r.witness.value}`,
      ...r.witness.state,
    );
  return { ok: true, lines };
}
