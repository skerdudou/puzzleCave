// Exact GPU engine (WebGPU): same contract as the compact engine's `solve` (move-optimal,
// upperBound, proven lower bound when exceeded), same macro-state (CompactModel key).
//
// Algorithm: A* over f windows [CUR, CUR + Δ) (Δ = 1 by default: A* by f buckets) with
// partial expansion (PEA*), entirely on the GPU.
// - Stored states live in buffers (key, best cost g, smallest deferred f, parent, edge, g at
//   which the state was expanded); a linear-probing hash table deduplicates them.
// - One micro-iteration: `sel` picks the open states with key < CUR + Δ and marks them
//   expanded at g; a state is open (a) if g < expanded g (new or improved), key f = g + h, or
//   (b) if it has deferred successors, key = smallest deferred f. If none, CUR moves to the
//   smallest open key. `expand` expands each chosen state (one 32-thread subgroup per state,
//   bit-parallel walk BFS, one row per thread): a successor with f < CUR + Δ becomes a
//   candidate (key, cost, parent, edge), a successor with larger f is deferred (only the
//   smallest deferred f is kept, in the state); in (b), successors with f < key are not
//   re-emitted (already stored at this g). Insertion deduplicates the candidates (table),
//   stores the new ones, keeps the smallest cost for each state (atomicMin, which also clears
//   the deferred successors of a larger g) and the parent of a candidate with that cost.
// - K micro-iterations per submission, driven by the GPU (indirect dispatches), one batch in
//   flight while the host encodes the next; a frontier too large for the candidate buffer is
//   expanded in host-driven slices.
// - End: CUR ≥ cost of the best goal (optimal), or nothing open left.
//
// Proof (h = relaxed distance to the exit, admissible and consistent: a walk from c to n then
// the interaction step is a path of the relaxed grid, hence h(c) ≤ cost + h(n)).
// (1) The parents form a tree of real paths: when parent[t] = s is written, g(t) = g read from
//     s + walk + 1 > g(s), and g only decreases; the length L(t) of the parent path
//     satisfies L(t) ≤ g(t) by induction. A goal recorded at cost c therefore has a path ≤ c,
//     and ≥ C* (it is a real path): at final cost C*, the rebuilt path is exactly C* long.
// (2) Invariant: all open keys are ≥ CUR. True at the start (f(start) = h = CUR); a successor
//     of a state with key ≥ CUR has f ≥ CUR (consistency), including when re-opened with a
//     better g; a deferred one has f ≥ CUR + Δ; CUR only rises to the smallest open key, when
//     the window is empty.
// (3) Witness: let P = s0 … sn be an optimal path and s_j the first state of P that has not
//     "stored s_{j+1} with its optimal g". s_j has its optimal g (through its predecessor, or
//     s0 with g = 0). Either it was not expanded at this g: open in (a), key f(s_j) ≤ C*. Or it
//     was and s_{j+1} was deferred: open in (b), key ≤ f(s_{j+1}) ≤ C* (re-expansions in (b)
//     emit [key, CUR + Δ) and re-defer the rest: every successor with f < key was emitted
//     earlier at the same g). Only exception: s_{j+1} pruned because f ≥ goalCost, hence
//     goalCost ≤ C*, so goalCost = C* (optimal goal already found). As long as no optimal goal
//     is found, an open key ≤ C* therefore exists, and CUR ≤ C* by (2): CUR is a proven lower
//     bound at any stop (time, memory; an overflow stops before any new window, and the lost
//     candidate has f ≥ CUR). At the end: "nothing open with key < goalCost" or
//     "CUR ≥ goalCost" give goalCost = C* (or no solution < U).
// (4) upperBound U: goalCost starts at U; nothing with f ≥ U is stored. Ending without a goal
//     means no solution of fewer than U moves ('unsolvable'), like `solve`.
// (5) Horizon MAX_F = 65534 (g and f on 16 bits): a successor beyond it raises TRUNC and the
//     exhausted search ends as 'timeout' (never "unsolvable").
// Δ > 1 expands states before their g is final (re-opened if g drops): more work, but fewer
// micro-iterations; (2) and (3) do not depend on Δ.
import { DIRS, UNREACHABLE, type Dir, type LevelData, type SolveResult } from '@puzzlecave/core';
import type { GpuHandle } from './device';
import { GOAL_CAP, makeLayout, planBuffers, type BufferPlan, type GpuLayout } from './layout';
import { C, HALT, IND, params, shader } from './shader';

// WebGPU flags (specification values; avoids depending on Dawn's globals)
const U_MAP_READ = 0x01;
const U_COPY_SRC = 0x04;
const U_COPY_DST = 0x08;
const U_UNIFORM = 0x40;
const U_STORAGE = 0x80;
const U_INDIRECT = 0x100;
const MAP_READ = 1;
const COMPUTE = 4;

const INF = 0xffffffff;
const MB = 1024 ** 2;

export interface GpuSolveOptions {
  /** VRAM cap for the search buffers (MB); 4096 by default */
  maxMemoryMb?: number;
  /** maximum number of stored states; unlimited by default */
  maxStates?: number;
  timeoutMs?: number;
  /** only strictly shorter solutions are searched (see solve) */
  upperBound?: number;
  /**
   * maximum width of the f windows; 1 by default (A* by f buckets: nothing speculative
   * is stored). Beyond that, adaptive Δ: Δ while the search is small, then 1. Measured:
   * same duration on solved levels, weaker bound at equal memory (pc-15: 40 vs 42).
   */
  delta?: number;
  /**
   * partial expansion (PEA*): only successors with f < end of the window are stored, the
   * parent keeps the smallest deferred f and will be re-expanded (for the successors with
   * f ≥ this minimum only) when the window reaches it. Fewer stored states for the same bound,
   * at the cost of re-expansions. true by default.
   */
  partial?: boolean;
  /** micro-iterations per submission; 24 by default */
  microIters?: number;
  /**
   * first budget tried (MB, 256 by default): if the states overflow, the search restarts
   * with a ×8 budget (never exceeding maxMemoryMb). Small levels thus barely occupy the
   * card; the redone work is at most ~1/7 of the total.
   */
  initialMemoryMb?: number;
  /** maximum candidates per batch (tests: forces host-driven slices) */
  maxCandidates?: number;
}

export interface GpuStats {
  stored: number;
  expanded: number;
  candidates: number;
  /** searches started (growing budget) */
  attempts: number;
  /** submissions (round trips with the card), all searches included */
  submits: number;
  /** host time spent encoding and submitting, and waiting for the card (ms) */
  encodeMs: number;
  waitMs: number;
  /** VRAM of the buffers of the last search */
  vramBytes: number;
  /** shader and pipeline compilation */
  compileMs: number;
  ms: number;
}

export type GpuSolveResult = SolveResult & { gpu: GpuStats };

interface Kernels {
  bgl0: GPUBindGroupLayout;
  bgl1: GPUBindGroupLayout;
  p: Record<
    | 'prep'
    | 'sel'
    | 'post'
    | 'expand'
    | 'args'
    | 'insert'
    | 'commit'
    | 'resolve'
    | 'claim'
    | 'record',
    GPUComputePipeline
  >;
}

/** kernels compiled per device and per word count (compilation costs ~0.3 s) */
const compiled = new WeakMap<GPUDevice, Map<number, Promise<Kernels>>>();

function kernelsFor(gpu: GpuHandle, words: number): Promise<Kernels> {
  let byWords = compiled.get(gpu.device);
  if (!byWords) compiled.set(gpu.device, (byWords = new Map()));
  let k = byWords.get(words);
  if (!k) {
    k = compile(gpu, words);
    byWords.set(words, k);
    k.catch(() => byWords.delete(words));
  }
  return k;
}

async function compile(gpu: GpuHandle, words: number): Promise<Kernels> {
  const { device } = gpu;
  const module = device.createShaderModule({ code: shader(words) });
  const info = await module.getCompilationInfo();
  const errors = info.messages.filter((m) => m.type === 'error');
  if (errors.length)
    throw new Error(
      `WGSL: ${errors.map((m) => `${m.lineNum}:${m.linePos} ${m.message}`).join('; ')}`,
    );
  const bgl0 = device.createBindGroupLayout({
    entries: Array.from({ length: 15 }, (_, i) => ({
      binding: i,
      visibility: COMPUTE,
      buffer: { type: i === 0 ? 'uniform' : i === 1 ? 'read-only-storage' : 'storage' },
    })),
  });
  const bgl1 = device.createBindGroupLayout({
    entries: [{ binding: 0, visibility: COMPUTE, buffer: { type: 'storage' } }],
  });
  const main = device.createPipelineLayout({ bindGroupLayouts: [bgl0] });
  const control = device.createPipelineLayout({ bindGroupLayouts: [bgl0, bgl1] });
  const pipe = (entryPoint: string, layout: GPUPipelineLayout) =>
    device.createComputePipeline({ layout, compute: { module, entryPoint } });
  return {
    bgl0,
    bgl1,
    p: {
      prep: pipe('prep', control),
      post: pipe('post', control),
      args: pipe('args', control),
      sel: pipe('sel', main),
      expand: pipe('expand', main),
      insert: pipe('insert', main),
      commit: pipe('commit', main),
      resolve: pipe('resolve', main),
      claim: pipe('claim', main),
      record: pipe('record', main),
    },
  };
}

interface Attempt {
  status: 'solved' | 'unsolvable' | 'timeout' | 'overflow';
  moves?: Dir[];
  /** proven lower bound (CUR, or the optimal cost) */
  lowerBound: number;
  stored: number;
  expanded: number;
  candidates: number;
  bytes: number;
  submits: number;
}

/**
 * Exact search on the open GPU `gpu` (in this thread: asynchronous calls). See engine.ts
 * for the synchronous version honoring the ExactEngine contract, with replay and CPU fallback.
 */
export async function gpuSolveOn(
  gpu: GpuHandle,
  level: LevelData,
  opts: GpuSolveOptions = {},
): Promise<GpuSolveResult> {
  const t0 = performance.now();
  const deadline = t0 + (opts.timeoutMs ?? 60_000);
  const L = makeLayout(level);
  const budget = (opts.maxMemoryMb ?? 4096) * MB;
  const upperBound = opts.upperBound ?? Infinity;
  const stats: GpuStats = {
    stored: 0,
    expanded: 0,
    candidates: 0,
    attempts: 0,
    submits: 0,
    encodeMs: 0,
    waitMs: 0,
    vramBytes: 0,
    compileMs: 0,
    ms: 0,
  };
  const done = (r: SolveResult): GpuSolveResult => {
    stats.ms = performance.now() - t0;
    return { ...r, memoryBytes: stats.vramBytes, gpu: stats };
  };
  const { x, y } = L.model.start.player;
  const startH = L.toExit[y * L.width + x]!;
  if (startH >= UNREACHABLE || startH >= upperBound)
    return done({ status: 'unsolvable', explored: 1 });

  const kernels = await kernelsFor(gpu, L.words);
  stats.compileMs = performance.now() - t0;
  let lowerBound = 0;
  let attemptBudget = Math.min(budget, (opts.initialMemoryMb ?? 256) * MB);
  for (;;) {
    const plan = planBuffers(L.words, attemptBudget, {
      maxBinding: gpu.maxBinding,
      maxStates: opts.maxStates,
      maxCandidates: opts.maxCandidates,
    });
    if (!plan) return done({ status: 'timeout', explored: 0, lowerBound });
    stats.attempts++;
    const a = await runAttempt(gpu, kernels, L, plan, deadline, upperBound, startH, opts, stats);
    stats.stored = a.stored;
    stats.expanded = a.expanded;
    stats.candidates = a.candidates;
    stats.submits += a.submits;
    stats.vramBytes = a.bytes;
    lowerBound = Math.max(lowerBound, a.lowerBound);
    const grow =
      a.status === 'overflow' &&
      attemptBudget < budget &&
      plan.storeCap < (opts.maxStates ?? Infinity) &&
      performance.now() < deadline;
    if (grow) {
      attemptBudget = Math.min(budget, attemptBudget * 8);
      continue;
    }
    if (a.status === 'solved')
      return done({ status: 'solved', moves: a.moves!, explored: a.stored });
    if (a.status === 'unsolvable') return done({ status: 'unsolvable', explored: a.stored });
    return done({ status: 'timeout', explored: a.stored, lowerBound });
  }
}

async function runAttempt(
  gpu: GpuHandle,
  k: Kernels,
  L: GpuLayout,
  plan: BufferPlan,
  deadline: number,
  upperBound: number,
  startH: number,
  opts: GpuSolveOptions,
  timing: { encodeMs: number; waitMs: number },
): Promise<Attempt> {
  const { device } = gpu;
  const W = L.words;
  const { storeCap, candCap, tableSize, stride, banks } = plan;
  const all: GPUBuffer[] = [];
  const buf = (bytes: number, usage = U_STORAGE | U_COPY_DST | U_COPY_SRC) => {
    const b = device.createBuffer({ size: Math.max(16, Math.ceil(bytes / 16) * 16), usage });
    all.push(b);
    return b;
  };
  try {
    const uniforms = buf(64, U_UNIFORM | U_COPY_DST);
    const tbl = buf(L.table.byteLength);
    // empty bank (fewer than 3 words): never read by the shader
    const store = banks.map((n) => buf(n > 0 ? storeCap * n * 4 : 16));
    const gOf = buf(storeCap * 4);
    const mt = buf(storeCap * 4);
    const parent = buf(storeCap * 4);
    const table = buf(tableSize * 4);
    const frontier = buf(storeCap * 8);
    const cand = buf(candCap * stride * 4);
    const candTarget = buf(candCap * 4);
    const owner = buf(storeCap * 4);
    const ctr = buf(C.COUNT * 4);
    const goals = buf(GOAL_CAP * 3 * 4);
    const indirect = buf(16 * 4, U_STORAGE | U_INDIRECT | U_COPY_DST);
    // two readback buffers: a submission can be in flight while the previous one is read
    const readback = [0, 1].map(() => buf(C.COUNT * 4, U_MAP_READ | U_COPY_DST));
    const bytes = all.reduce((a, b) => a + b.size, 0);
    const order = [
      uniforms,
      tbl,
      ...store,
      gOf,
      mt,
      parent,
      table,
      frontier,
      cand,
      candTarget,
      owner,
      ctr,
      goals,
    ];
    const bg0 = device.createBindGroup({
      layout: k.bgl0,
      entries: order.map((b, binding) => ({ binding, resource: { buffer: b } })),
    });
    const bg1 = device.createBindGroup({
      layout: k.bgl1,
      entries: [{ binding: 0, resource: { buffer: indirect } }],
    });
    device.queue.writeBuffer(tbl, 0, L.table);

    let delta = opts.delta ?? 1;
    const deltaMax = delta;
    let gpuLen = Math.max(256, Math.floor(candCap / 16));
    const setParams = () =>
      device.queue.writeBuffer(
        uniforms,
        0,
        params(L, { storeCap, candCap, tableSize, delta, gpuLen, partial: opts.partial ?? true }),
      );
    const setCtr = (values: Record<number, number>) => {
      for (const [i, v] of Object.entries(values))
        device.queue.writeBuffer(ctr, Number(i) * 4, new Uint32Array([v]));
    };
    const read = async (
      enc: GPUCommandEncoder,
      t0: number,
      rb: GPUBuffer,
    ): Promise<Uint32Array> => {
      enc.copyBufferToBuffer(ctr, 0, rb, 0, C.COUNT * 4);
      device.queue.submit([enc.finish()]);
      const t1 = performance.now();
      timing.encodeMs += t1 - t0;
      await rb.mapAsync(MAP_READ);
      timing.waitMs += performance.now() - t1;
      const c = new Uint32Array(rb.getMappedRange().slice(0));
      rb.unmap();
      if (gpu.error) throw new Error(`GPU: ${gpu.error}`);
      return c;
    };
    const insertPasses = (pass: GPUComputePassEncoder) => {
      pass.setPipeline(k.p.args);
      pass.dispatchWorkgroups(1);
      for (const p of [k.p.insert, k.p.commit, k.p.resolve, k.p.claim, k.p.record]) {
        pass.setPipeline(p);
        pass.dispatchWorkgroupsIndirect(indirect, IND.CAND * 4);
      }
    };
    let submits = 0;
    const pass = (body: (pass: GPUComputePassEncoder) => void): Promise<Uint32Array> => {
      submits++;
      const t0 = performance.now();
      const enc = device.createCommandEncoder();
      const p = enc.beginComputePass();
      p.setBindGroup(0, bg0);
      p.setBindGroup(1, bg1);
      body(p);
      p.end();
      return read(enc, t0, readback[submits % 2]!);
    };

    // initial state: a candidate of cost 0, without parent
    const init = new Uint32Array(C.COUNT);
    init[C.CAND] = 1;
    init[C.GOALCOST] = Number.isFinite(upperBound) ? upperBound : INF;
    init[C.NEXTF] = INF;
    init[C.CUR] = startH;
    device.queue.writeBuffer(ctr, 0, init);
    const root = new Uint32Array(stride);
    root.set(L.model.encode(L.model.start));
    root[W + 1] = INF;
    device.queue.writeBuffer(cand, 0, root);
    setParams();
    let c = await pass(insertPasses);

    const K = opts.microIters ?? 24;
    let lastExpanded = 0;
    let succ = 1;
    let status: Attempt['status'] | undefined;
    // K micro-iterations driven by the GPU; once the search has stopped (HALT), the
    // following micro-iterations do nothing
    const batch = (): Promise<Uint32Array> => {
      setParams();
      const r = pass((p) => {
        for (let i = 0; i < K; i++) {
          p.setPipeline(k.p.prep);
          p.dispatchWorkgroups(1);
          p.setPipeline(k.p.sel);
          p.dispatchWorkgroupsIndirect(indirect, IND.SEL * 4);
          p.setPipeline(k.p.post);
          p.dispatchWorkgroups(1);
          p.setPipeline(k.p.expand);
          p.dispatchWorkgroupsIndirect(indirect, IND.EXPAND * 4);
          insertPasses(p);
        }
      });
      r.catch(() => undefined); // an error is picked up by the wait, not as an orphan rejection
      return r;
    };
    /**
     * GPU loop stop (counters in c): final status, or undefined to resume the
     * loop after expanding, in host-driven slices, a frontier that is too large
     * (or that overflowed the candidate buffer); it is already chosen and marked expanded.
     */
    const afterHalt = async (): Promise<Attempt['status'] | undefined> => {
      const halt = c[C.HALT]!;
      if (halt === HALT.DONE || halt === HALT.EXHAUSTED)
        return c[C.GOALS]! > 0 ? 'solved' : c[C.TRUNC] ? 'timeout' : 'unsolvable';
      if (halt === HALT.OVERFLOW) return 'overflow';
      const total = c[C.FRONT]!;
      let factor = succ * 1.5;
      for (let off = 0; off < total;) {
        if (performance.now() > deadline) return 'timeout';
        const len = Math.min(total - off, Math.max(1, Math.floor(candCap / factor)));
        setCtr({
          [C.CAND]: 0,
          [C.CANDOVF]: 0,
          [C.HALT]: HALT.RUNNING,
          [C.SLICE_OFF]: off,
          [C.SLICE_LEN]: len,
        });
        c = await pass((p) => {
          p.setPipeline(k.p.expand);
          const gx = Math.min(len, 65535);
          p.dispatchWorkgroups(gx, Math.ceil(len / gx));
          insertPasses(p);
        });
        if (c[C.ERROR]) throw new Error('GPU: push outside the candidate cells (inconsistency)');
        if (c[C.CANDOVF]) {
          // nothing was inserted: same slice, smaller
          if (len === 1) return 'overflow';
          factor *= 2;
          continue;
        }
        if (c[C.STOREOVF] || c[C.TABLEOVF]) return 'overflow';
        off += len;
      }
      return undefined;
    };
    // always one batch in flight: the host encodes the next batch while the card works (the
    // gpuLen and Δ parameters therefore apply one batch late)
    let inflight: Promise<Uint32Array> | undefined;
    try {
      while (!status) {
        if (performance.now() > deadline) {
          status = 'timeout';
          break;
        }
        const current = inflight ?? batch();
        inflight = batch();
        c = await current;
        // observed successors per state: the GPU loop only takes frontiers whose
        // candidates fit (with margin) in the buffer
        succ = Math.max(1, c[C.CANDTOTAL]! / Math.max(1, c[C.EXPANDED]!));
        gpuLen = Math.max(256, Math.floor(candCap / (succ * 2)));
        // adaptive Δ (if Δ > 1 requested): wide while the search is small (fewer
        // micro-iterations), 1 as soon as the frontiers are large or the stored states
        // exceed 1 M or 1/8 of the capacity
        const big =
          (c[C.EXPANDED]! - lastExpanded) / K > 200_000 ||
          c[C.STORED]! > Math.min(storeCap / 8, 1_000_000);
        delta = big ? 1 : deltaMax;
        lastExpanded = c[C.EXPANDED]!;
        if (c[C.ERROR]) throw new Error('GPU: push outside the candidate cells (inconsistency)');
        if (c[C.HALT] === HALT.RUNNING) continue;
        // stop: the in-flight batch did nothing, its counters are the most recent
        c = await inflight;
        inflight = undefined;
        status = await afterHalt();
        if (!status) setCtr({ [C.HALT]: HALT.RUNNING });
      }
    } finally {
      if (inflight) await inflight.catch(() => undefined);
    }
    c = await pass(() => {});
    const result: Attempt = {
      status,
      lowerBound: c[C.CUR]!,
      stored: Math.min(c[C.STORED]!, storeCap),
      expanded: c[C.EXPANDED]!,
      candidates: c[C.CANDTOTAL]!,
      submits,
      bytes,
    };
    if (status === 'solved') {
      result.moves = await rebuild(device, L, plan, { goals, parent, mt, store }, c);
      result.lowerBound = result.moves.length;
    }
    return result;
  } finally {
    for (const b of all) b.destroy();
    // the VRAM is only returned once the submitted work has finished: the next search
    // (×8 budget) does not add to the previous one
    await device.queue.onSubmittedWorkDone();
  }
}

/** Reads ranges (in u32) of several buffers in a single round trip. */
async function readRanges(
  device: GPUDevice,
  ranges: [GPUBuffer, number, number][],
): Promise<Uint32Array[]> {
  const sizes = ranges.map(([, , n]) => Math.ceil((n * 4) / 16) * 16);
  const rb = device.createBuffer({
    size: Math.max(
      16,
      sizes.reduce((a, b) => a + b, 0),
    ),
    usage: U_MAP_READ | U_COPY_DST,
  });
  try {
    const enc = device.createCommandEncoder();
    const starts: number[] = [];
    let at = 0;
    ranges.forEach(([src, off, n], i) => {
      enc.copyBufferToBuffer(src, off * 4, rb, at, n * 4);
      starts.push(at / 4);
      at += sizes[i]!;
    });
    device.queue.submit([enc.finish()]);
    await rb.mapAsync(MAP_READ);
    const all = new Uint32Array(rb.getMappedRange().slice(0));
    rb.unmap();
    return ranges.map(([, , n], i) => all.slice(starts[i]!, starts[i]! + n));
  } finally {
    rb.destroy();
  }
}

/**
 * Path of the best goal: walks up the parents (point reads), then replays each
 * macro-move with the compact model (BFS walk from the parent state, then the interaction).
 */
async function rebuild(
  device: GPUDevice,
  L: GpuLayout,
  plan: BufferPlan,
  B: { goals: GPUBuffer; parent: GPUBuffer; mt: GPUBuffer; store: GPUBuffer[] },
  c: Uint32Array,
): Promise<Dir[]> {
  const goalCost = c[C.GOALCOST]!;
  const n = Math.min(c[C.GOALS]!, GOAL_CAP);
  const [goals] = await readRanges(device, [[B.goals, 0, n * 3]]);
  let gi = -1;
  for (let i = 0; i < n; i++) if (goals![i * 3] === goalCost) gi = i;
  if (gi < 0) throw new Error(`GPU: goal of cost ${goalCost} not recorded`);
  const model = L.model;
  const banks = plan.banks;
  const chain: { words: Uint32Array; edge: number }[] = [];
  let state = goals![gi * 3 + 1]!;
  let edge = goals![gi * 3 + 2]!;
  for (let guard = 0; ; guard++) {
    if (guard > plan.storeCap) throw new Error('GPU: endless parent chain');
    const ranges: [GPUBuffer, number, number][] = [
      [B.parent, state, 1],
      [B.mt, state, 1],
    ];
    banks.forEach((count, k) => {
      if (count > 0) ranges.push([B.store[k]!, state * count, count]);
    });
    const [p, m, ...parts] = await readRanges(device, ranges);
    const words = new Uint32Array(L.words);
    for (let j = 0; j < L.words; j++) words[j] = parts[j % 3]![Math.floor(j / 3)]!;
    chain.push({ words, edge });
    if (p![0] === INF) break;
    edge = m![0]! & 0x1fff;
    state = p![0]!;
  }
  const moves: Dir[] = [];
  for (const link of chain.reverse()) {
    model.load(link.words);
    model.explore();
    if (!model.reached(link.edge >> 2))
      throw new Error('GPU: impossible walk during reconstruction');
    for (const d of model.walkTo(link.edge >> 2)) moves.push(DIRS[d]!);
    moves.push(DIRS[link.edge & 3]!);
  }
  if (moves.length !== goalCost)
    throw new Error(`GPU: path rebuilt with ${moves.length} moves for a goal of ${goalCost}`);
  return moves;
}
