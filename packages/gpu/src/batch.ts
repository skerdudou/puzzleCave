// Batch expansion on the GPU for the long-run external search (packages/tools/src/longrun):
// the CPU sends a batch of macro-states of one layer (cost g), the card returns every successor
// with f = cost + toExit < best (key, index of the state in the batch, cost and edge) and the
// goals reached. Same expansion as the engine's `expand` kernel (shader.ts: one 32-thread
// subgroup per state, bit-parallel walk BFS, interactions of CompactModel.expand), without
// the store, the table or partial expansion: deduplication stays with the CPU and the disk.
import { BLOCK, DOOR, EXIT, FREE, KEY, UNREACHABLE, WATER, type LevelData } from '@puzzlecave/core';
import type { GpuHandle } from './device';
import { KEYS_OFFSET, MAX_F, makeLayout, type GpuLayout } from './layout';

const U_MAP_READ = 0x01;
const U_COPY_SRC = 0x04;
const U_COPY_DST = 0x08;
const U_UNIFORM = 0x40;
const U_STORAGE = 0x80;
const MAP_READ = 1;
const COMPUTE = 4;

/** words of an output record after the key: state index, cost << 16 | edge */
export const BATCH_EXTRA = 2;
/** goals kept per batch */
const GOAL_CAP = 4096;
/** counters: candidates, overflow, truncated (beyond MAX_F), goals */
const CTR = 4;
/** output records per state copied back at once (more: a second copy) */
const FIRST_COPY_PER_STATE = 12;

export function batchShader(W: number): string {
  return /* wgsl */ `enable subgroups;
diagnostic(off, subgroup_uniformity);

const W = ${W}u;
const ST = ${W + BATCH_EXTRA}u;
const UNREACH = ${UNREACHABLE}u;
const KOFF = ${KEYS_OFFSET}u;
const MAX_F = ${MAX_F}u;
const GOAL_CAP = ${GOAL_CAP}u;
const G_FREE = ${FREE}u;
const G_WATER = ${WATER}u;
const G_EXIT = ${EXIT}u;
const G_KEY = ${KEY}u;
const G_DOOR = ${DOOR}u;
const G_BLOCK = ${BLOCK}u;

struct Params {
  h: u32, wd: u32, rowMask: u32, offI1: u32, offTE: u32, offBit: u32, offWalk: u32,
  offExitR: u32, offDoor: u32,
  count: u32, g: u32, best: u32, candCap: u32, p13: u32, p14: u32, p15: u32,
}
@group(0) @binding(0) var<uniform> P: Params;
@group(0) @binding(1) var<storage, read> tbl: array<u32>;
@group(0) @binding(2) var<storage, read> states: array<u32>;
@group(0) @binding(3) var<storage, read_write> cand: array<u32>;
@group(0) @binding(4) var<storage, read_write> ctr: array<atomic<u32>>;
@group(0) @binding(5) var<storage, read_write> goals: array<u32>;

fn has(w: ptr<function, array<u32, W>>, rel: u32) -> bool {
  return (((*w)[1u + (rel >> 5u)] >> (rel & 31u)) & 1u) != 0u;
}

fn gridAt(w: ptr<function, array<u32, W>>, c: u32) -> u32 {
  let i1 = tbl[P.offI1 + c];
  let bb = i1 >> 16u;
  if (bb != 0u && has(w, bb - 1u)) { return G_BLOCK; }
  let i0 = tbl[c];
  let fb = i0 >> 16u;
  if (fb != 0u && has(w, fb - 1u)) {
    if (((i0 >> 4u) & 1u) != 0u) { return G_KEY; }
    return G_DOOR;
  }
  let wb = i1 & 0xFFFFu;
  if (wb != 0u && has(w, wb - 1u)) { return G_FREE; }
  return i0 & 7u;
}

fn goal(cost: u32, si: u32, edge: u32) {
  if (cost >= P.best) { return; }
  let gi = atomicAdd(&ctr[3], 1u);
  if (gi < GOAL_CAP) {
    goals[gi * 3u] = cost;
    goals[gi * 3u + 1u] = si;
    goals[gi * 3u + 2u] = edge;
  } else {
    // goals lost: the host retries on fewer states
    atomicStore(&ctr[1], 1u);
  }
}

fn emit(si: u32, w: ptr<function, array<u32, W>>, c: u32, d: u32, k: u32, doors: u32) {
  let cx = c % P.wd;
  let cy = c / P.wd;
  var m = c + 1u;
  if (d == 0u) { m = c - P.wd; } else if (d == 1u) { m = c + P.wd; } else if (d == 2u) { m = c - 1u; }
  let cost = P.g + k + 1u;
  let edge = c * 4u + d;
  let gm = gridAt(w, m);
  if (gm == G_EXIT) { goal(cost, si, edge); return; }
  var cw = *w;
  var kw = cw[0] >> 16u;
  if (gm == G_BLOCK) {
    var bx = i32(cx);
    var by = i32(cy);
    if (d == 0u) { by -= 2; } else if (d == 1u) { by += 2; } else if (d == 2u) { bx -= 2; } else { bx += 2; }
    if (bx < 0 || by < 0 || bx >= i32(P.wd) || by >= i32(P.h)) { return; }
    let behind = u32(by) * P.wd + u32(bx);
    let gb = gridAt(w, behind);
    let holds = (tbl[behind] >> 3u) & 1u;
    if (!(gb == G_WATER || (gb == G_FREE && holds == 1u))) { return; }
    let src = (tbl[P.offI1 + m] >> 16u) - 1u;
    cw[1u + (src >> 5u)] &= ~(1u << (src & 31u));
    var to = tbl[P.offI1 + behind] >> 16u;
    if (gb == G_WATER) { to = tbl[P.offI1 + behind] & 0xFFFFu; }
    if (to == 0u) { atomicStore(&ctr[1], 2u); return; }
    cw[1u + ((to - 1u) >> 5u)] |= 1u << ((to - 1u) & 31u);
  } else {
    if (gm == G_DOOR && kw <= KOFF) { return; }
    let fb = (tbl[m] >> 16u) - 1u;
    cw[1u + (fb >> 5u)] &= ~(1u << (fb & 31u));
    if (gm == G_KEY) { kw = min(kw + 1u, doors + KOFF); } else { kw -= 1u; }
  }
  if ((tbl[m] & 7u) == G_EXIT) { goal(cost, si, edge); return; }
  let hn = tbl[P.offTE + m];
  if (hn >= UNREACH) { return; }
  if (cost + hn >= P.best) { return; }
  if (cost > MAX_F) { atomicStore(&ctr[2], 1u); return; }
  cw[0] = m | (kw << 16u);
  let ci = atomicAdd(&ctr[0], 1u);
  if (ci >= P.candCap) { atomicStore(&ctr[1], 1u); return; }
  let base = ci * ST;
  for (var j = 0u; j < W; j++) { cand[base + j] = cw[j]; }
  cand[base + W] = si;
  cand[base + W + 1u] = (cost << 16u) | edge;
}

@compute @workgroup_size(32) fn bexpand(@builtin(workgroup_id) wg: vec3u, @builtin(num_workgroups) nwg: vec3u, @builtin(local_invocation_index) lane: u32) {
  let si = wg.y * nwg.x + wg.x;
  if (si >= P.count) { return; }
  var w: array<u32, W>;
  for (var j = 0u; j < W; j++) { w[j] = states[si * W + j]; }
  let y = lane;
  var objR = 0u;
  var waterR = 0u;
  var doors = 0u;
  for (var j = 1u; j < W; j++) {
    doors += countOneBits(w[j] & tbl[P.offDoor + j]);
    var mm = w[j];
    while (mm != 0u) {
      let b = firstTrailingBit(mm);
      mm &= mm - 1u;
      let e = tbl[P.offBit + (j - 1u) * 32u + b];
      let c = e & 0xFFFFu;
      if (c / P.wd == y) {
        if ((e >> 16u) == G_FREE) { waterR |= 1u << (c % P.wd); } else { objR |= 1u << (c % P.wd); }
      }
    }
  }
  var walkR = 0u;
  var tgtR = 0u;
  if (y < P.h) {
    walkR = (tbl[P.offWalk + y] | waterR) & ~objR;
    tgtR = objR | tbl[P.offExitR + y];
  }
  let tgtUp = subgroupShuffleUp(tgtR, 1u);
  let tgtDn = subgroupShuffleDown(tgtR, 1u);
  let p = w[0] & 0xFFFFu;
  var fr = 0u;
  if (y < P.h && p / P.wd == y) { fr = 1u << (p % P.wd); }
  var vis = fr;
  var k = 0u;
  loop {
    if (fr != 0u) {
      var m: u32;
      if (y > 0u) {
        m = fr & tgtUp;
        while (m != 0u) { let x = firstTrailingBit(m); m &= m - 1u; emit(si, &w, y * P.wd + x, 0u, k, doors); }
      }
      if (y + 1u < P.h) {
        m = fr & tgtDn;
        while (m != 0u) { let x = firstTrailingBit(m); m &= m - 1u; emit(si, &w, y * P.wd + x, 1u, k, doors); }
      }
      m = fr & ((tgtR << 1u) & P.rowMask);
      while (m != 0u) { let x = firstTrailingBit(m); m &= m - 1u; emit(si, &w, y * P.wd + x, 2u, k, doors); }
      m = fr & (tgtR >> 1u);
      while (m != 0u) { let x = firstTrailingBit(m); m &= m - 1u; emit(si, &w, y * P.wd + x, 3u, k, doors); }
    }
    var up = subgroupShuffleUp(fr, 1u);
    var dn = subgroupShuffleDown(fr, 1u);
    if (y == 0u) { up = 0u; }
    if (y + 1u >= P.h) { dn = 0u; }
    let nf = (fr | (fr << 1u) | (fr >> 1u) | up | dn) & walkR & ~vis & P.rowMask;
    if (!subgroupAny(nf != 0u)) { break; }
    fr = nf;
    vis |= nf;
    k += 1u;
  }
}
`;
}

export interface BatchResult {
  /** output records (W + BATCH_EXTRA words each) */
  cands: Uint32Array;
  count: number;
  /** goals: (cost, state index, edge) triples */
  goals: number[];
  /** a successor beyond the horizon was dropped */
  truncated: boolean;
  /** states of the batch actually expanded (the rest did not fit in the output) */
  done: number;
}

/** compiled pipelines per device and word count (several expanders share them) */
const pipelines = new WeakMap<
  GPUDevice,
  Map<number, Promise<{ layout: GPUBindGroupLayout; pipeline: GPUComputePipeline }>>
>();

function pipelineFor(
  gpu: GpuHandle,
  W: number,
): Promise<{ layout: GPUBindGroupLayout; pipeline: GPUComputePipeline }> {
  const { device } = gpu;
  let byW = pipelines.get(device);
  if (!byW) pipelines.set(device, (byW = new Map()));
  let p = byW.get(W);
  if (!p) {
    p = (async () => {
      const module = device.createShaderModule({ code: batchShader(W) });
      const info = await module.getCompilationInfo();
      const errors = info.messages.filter((m) => m.type === 'error');
      if (errors.length)
        throw new Error(
          `WGSL: ${errors.map((m) => `${m.lineNum}:${m.linePos} ${m.message}`).join('; ')}`,
        );
      const layout = device.createBindGroupLayout({
        entries: Array.from({ length: 6 }, (_, i) => ({
          binding: i,
          visibility: COMPUTE,
          buffer: { type: i === 0 ? 'uniform' : i <= 2 ? 'read-only-storage' : 'storage' },
        })) as GPUBindGroupLayoutEntry[],
      });
      const pipeline = device.createComputePipeline({
        layout: device.createPipelineLayout({ bindGroupLayouts: [layout] }),
        compute: { module, entryPoint: 'bexpand' },
      });
      return { layout, pipeline };
    })();
    byW.set(W, p);
  }
  return p;
}

/** batch expander of one level on an open device (asynchronous: GPU thread) */
export class GpuBatchExpander {
  readonly words: number;
  private constructor(
    private readonly gpu: GpuHandle,
    readonly layout: GpuLayout,
    private readonly pipeline: GPUComputePipeline,
    private readonly bindGroup: GPUBindGroup,
    private readonly bufs: {
      uniforms: GPUBuffer;
      states: GPUBuffer;
      cand: GPUBuffer;
      ctr: GPUBuffer;
      goals: GPUBuffer;
      readback: GPUBuffer;
    },
    /** states and output records per GPU pass */
    readonly stateCap: number,
    readonly candCap: number,
  ) {
    this.words = layout.words;
  }

  static async open(
    gpu: GpuHandle,
    level: LevelData,
    stateCap = 16384,
    perState = 24,
  ): Promise<GpuBatchExpander> {
    const L = makeLayout(level);
    const W = L.words;
    const { device } = gpu;
    const { layout, pipeline } = await pipelineFor(gpu, W);
    const candCap = stateCap * perState;
    const buf = (bytes: number, usage = U_STORAGE | U_COPY_DST | U_COPY_SRC) =>
      device.createBuffer({ size: Math.max(16, Math.ceil(bytes / 16) * 16), usage });
    const ST = W + BATCH_EXTRA;
    const bufs = {
      uniforms: buf(64, U_UNIFORM | U_COPY_DST),
      tbl: buf(L.table.byteLength),
      states: buf(stateCap * W * 4),
      cand: buf(candCap * ST * 4),
      ctr: buf(CTR * 4),
      goals: buf(GOAL_CAP * 3 * 4),
      readback: buf(CTR * 4 + GOAL_CAP * 12 + candCap * ST * 4, U_MAP_READ | U_COPY_DST),
    };
    device.queue.writeBuffer(bufs.tbl, 0, L.table);
    const order = [bufs.uniforms, bufs.tbl, bufs.states, bufs.cand, bufs.ctr, bufs.goals];
    const bindGroup = device.createBindGroup({
      layout,
      entries: order.map((b, binding) => ({ binding, resource: { buffer: b } })),
    });
    return new GpuBatchExpander(gpu, L, pipeline, bindGroup, bufs, stateCap, candCap);
  }

  /**
   * expands `count` states (W words each, from `states[offset]`) of cost g; only successors
   * with f < best are returned (written to `into` if given). A pass whose output overflows is
   * retried on half the states.
   */
  async expand(
    states: Uint32Array,
    count: number,
    g: number,
    best: number,
    into?: Uint32Array,
  ): Promise<BatchResult> {
    const { device } = this.gpu;
    const W = this.words;
    const ST = W + BATCH_EXTRA;
    const L = this.layout;
    let n = Math.min(count, this.stateCap);
    for (;;) {
      device.queue.writeBuffer(this.bufs.states, 0, states, 0, n * W);
      device.queue.writeBuffer(
        this.bufs.uniforms,
        0,
        new Uint32Array([
          L.height,
          L.width,
          L.width === 32 ? 0xffffffff : (1 << L.width) - 1,
          L.offInfo1,
          L.offExit,
          L.offBit,
          L.offWalk,
          L.offExitRows,
          L.offDoor,
          n,
          g,
          Math.min(best, 0xffffffff),
          this.candCap,
          0,
          0,
          0,
        ]),
      );
      device.queue.writeBuffer(this.bufs.ctr, 0, new Uint32Array(CTR));
      // a single round trip: kernel, then counters, goals and the whole output buffer copied
      // to the readback buffer (the output size is not known before the counters are read)
      const enc = device.createCommandEncoder();
      const pass = enc.beginComputePass();
      pass.setPipeline(this.pipeline);
      pass.setBindGroup(0, this.bindGroup);
      const gx = Math.min(n, 65535);
      pass.dispatchWorkgroups(gx, Math.ceil(n / gx));
      pass.end();
      const rb = this.bufs.readback;
      const goalsAt = CTR * 4;
      const candAt = goalsAt + GOAL_CAP * 12;
      enc.copyBufferToBuffer(this.bufs.ctr, 0, rb, 0, CTR * 4);
      enc.copyBufferToBuffer(this.bufs.goals, 0, rb, goalsAt, GOAL_CAP * 12);
      // expected output size (a second copy brings the rest if it is larger)
      const first = Math.min(this.candCap, n * FIRST_COPY_PER_STATE);
      enc.copyBufferToBuffer(this.bufs.cand, 0, rb, candAt, first * ST * 4);
      device.queue.submit([enc.finish()]);
      await rb.mapAsync(MAP_READ, 0, candAt + first * ST * 4);
      let mapped = rb.getMappedRange(0, candAt + first * ST * 4);
      let ctr = new Uint32Array(mapped, 0, CTR);
      if (ctr[0]! > first && ctr[1] === 0) {
        const c = ctr[0]!;
        rb.unmap();
        const enc2 = device.createCommandEncoder();
        enc2.copyBufferToBuffer(this.bufs.cand, 0, rb, candAt, c * ST * 4);
        device.queue.submit([enc2.finish()]);
        await rb.mapAsync(MAP_READ, 0, candAt + c * ST * 4);
        mapped = rb.getMappedRange(0, candAt + c * ST * 4);
        ctr = new Uint32Array(mapped, 0, CTR);
      }
      try {
        if (this.gpu.error) throw new Error(`GPU: ${this.gpu.error}`);
        if (ctr[1] === 2) throw new Error('GPU: push outside the candidate cells');
        if (ctr[1] !== 0) {
          if (n === 1) throw new Error('GPU: output too small for one state');
          n = Math.ceil(n / 2);
          continue;
        }
        const c = ctr[0]!;
        const gn = Math.min(ctr[3]!, GOAL_CAP);
        const src = new Uint32Array(mapped, candAt, c * ST);
        let cands: Uint32Array;
        if (into) {
          into.set(src);
          cands = into;
        } else cands = src.slice();
        const goals = [...new Uint32Array(mapped, goalsAt, gn * 3)];
        return { cands, count: c, goals, truncated: ctr[2] !== 0, done: n };
      } finally {
        rb.unmap();
      }
    }
  }

  destroy(): void {
    for (const b of Object.values(this.bufs)) b.destroy();
  }
}
