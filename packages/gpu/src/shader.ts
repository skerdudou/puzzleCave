// WGSL of the GPU engine, specialized for a level (dimensions, word count, static grid rows
// injected as constants). See gpuSolve.ts for the algorithm and its proof, and
// emulate.ts for the same expansion written in TypeScript (tested against the compact model).
import { BLOCK, DOOR, EXIT, FREE, KEY, UNREACHABLE, WATER } from '@puzzlecave/core';
import { CAND_EXTRA, GOAL_CAP, KEYS_OFFSET, MAX_F, type GpuLayout } from './layout';

/** group size of the \"one thread per element\" kernels */
export const WG = 256;

/** counters (ctr buffer, u32), shared between the WGSL and the host */
export const C = {
  /** states selected in the current window (frontier) */
  FRONT: 0,
  /** candidates emitted by the last expansion */
  CAND: 1,
  /** stored states */
  STORED: 2,
  /** recorded goals */
  GOALS: 3,
  /** cost of the best goal (or upperBound): nothing with f ≥ goalCost is stored or expanded */
  GOALCOST: 4,
  /** smallest open f beyond the window */
  NEXTF: 5,
  CANDOVF: 6,
  STOREOVF: 7,
  TABLEOVF: 8,
  /** expanded states (statistic) */
  EXPANDED: 9,
  /** inserted candidates (statistic) */
  CANDTOTAL: 10,
  /** a successor exceeded the MAX_F horizon: never \"unsolvable\" */
  TRUNC: 11,
  /** start f of the current window: proven lower bound */
  CUR: 12,
  /** stop of the GPU-driven loop, see HALT */
  HALT: 13,
  /** slice of the frontier being expanded */
  SLICE_OFF: 14,
  SLICE_LEN: 15,
  /** inconsistency (push outside the candidate cells): result discarded */
  ERROR: 16,
  COUNT: 32,
} as const;

export const HALT = {
  RUNNING: 0,
  /** current f ≥ best goal: the goal is optimal */
  DONE: 1,
  /** no open state left with f < goalCost */
  EXHAUSTED: 2,
  /** frontier too large for the GPU loop: host-driven slices */
  BIG_FRONTIER: 3,
  /** candidate buffer overflow: host-driven slices */
  CAND_OVERFLOW: 4,
  /** state or table overflow (or inconsistency) */
  OVERFLOW: 5,
} as const;

/** indices (u32) of the indirect arguments: candidates, selection, expansion */
export const IND = { CAND: 0, SEL: 3, EXPAND: 6 } as const;

/** `mt` entry of a never-expanded state: edge 0, expanded g = 0x7FFFF */
export const MT_NEW = 0xffffe000;

/** uniforms (u32): capacities, Δ, then the level geometry and the tbl buffer offsets */
export function params(
  L: GpuLayout,
  p: {
    storeCap: number;
    candCap: number;
    tableSize: number;
    delta: number;
    gpuLen: number;
    partial: boolean;
  },
): Uint32Array {
  return new Uint32Array([
    p.storeCap,
    p.candCap,
    p.tableSize - 1,
    p.delta,
    p.gpuLen,
    L.height,
    L.width,
    L.width === 32 ? 0xffffffff : (1 << L.width) - 1,
    L.offInfo1,
    L.offExit,
    L.offBit,
    L.offWalk,
    L.offExitRows,
    L.offDoor,
    p.partial ? 1 : 0,
    0,
  ]);
}

/**
 * WGSL of the engine for keys of W words. Only the size of the local arrays depends on the level:
 * the grid (walk rows, exits, doors, cell and bit tables) is read from the
 * tbl buffer and the uniforms, and the compiled kernels serve all levels with the same W.
 */
export function shader(W: number): string {
  const banks = [0, 1, 2].map((k) => Math.max(1, Math.ceil((W - k) / 3)));
  const counters = Object.entries(C)
    .map(([k, v]) => `const C_${k} = ${v}u;`)
    .join('\n');
  const halts = Object.entries(HALT)
    .map(([k, v]) => `const H_${k} = ${v}u;`)
    .join('\n');
  return /* wgsl */ `enable subgroups;
diagnostic(off, subgroup_uniformity);

const W = ${W}u;
const ST = ${W + CAND_EXTRA}u;
const WK0 = ${banks[0]}u;
const WK1 = ${banks[1]}u;
const WK2 = ${banks[2]}u;
const INF = 0xFFFFFFFFu;
const NONE16 = 0xFFFFu;
const FLAG = 0x80000000u;
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
${counters}
${halts}

struct Params {
  storeCap: u32, candCap: u32, tableMask: u32, delta: u32, gpuLen: u32,
  // height, width, row mask, offsets in tbl (see GpuLayout.table)
  h: u32, wd: u32, rowMask: u32, offI1: u32, offTE: u32, offBit: u32, offWalk: u32,
  offExitR: u32, offDoor: u32,
  // partial expansion: 1 = only successors with f < CUR + delta are stored
  partial: u32, p15: u32,
}
@group(0) @binding(0) var<uniform> P: Params;
@group(0) @binding(1) var<storage, read> tbl: array<u32>;
@group(0) @binding(2) var<storage, read_write> store0: array<u32>;
@group(0) @binding(3) var<storage, read_write> store1: array<u32>;
@group(0) @binding(4) var<storage, read_write> store2: array<u32>;
/**
 * best known cost g (high 16 bits, 0xFFFF = none) | smallest f of the successors deferred
 * by partial expansion at this g (low 16 bits, 0xFFFF = none). atomicMin on the whole
 * value: a better g clears the deferred ones (they will all be re-emitted), a deferred one is
 * only recorded if g has not changed.
 */
@group(0) @binding(5) var<storage, read_write> gf: array<atomic<u32>>;
/** arrival edge (13 bits) | g at which the state was expanded (19 bits, 0x7FFFF = never) */
@group(0) @binding(6) var<storage, read_write> mt: array<u32>;
@group(0) @binding(7) var<storage, read_write> parent: array<u32>;
/** hash table: 0 empty, FLAG | i candidate i being inserted, otherwise state + 1 */
@group(0) @binding(8) var<storage, read_write> table: array<atomic<u32>>;
/** frontier: (state, smallest f to emit) per pair */
@group(0) @binding(9) var<storage, read_write> frontier: array<u32>;
/** candidates: key (W words), cost, parent, edge, table slot then state */
@group(0) @binding(10) var<storage, read_write> cand: array<u32>;
@group(0) @binding(11) var<storage, read_write> candTarget: array<u32>;
@group(0) @binding(12) var<storage, read_write> owner: array<atomic<u32>>;
@group(0) @binding(13) var<storage, read_write> ctr: array<atomic<u32>>;
/** goals: cost, parent state, edge */
@group(0) @binding(14) var<storage, read_write> goals: array<u32>;
/** indirect arguments: write-bound to the control kernels only */
@group(1) @binding(0) var<storage, read_write> indirect: array<u32>;

// word j of state s: bank j % 3
fn ld(s: u32, j: u32) -> u32 {
  let k = j % 3u;
  let o = j / 3u;
  if (k == 0u) { return store0[s * WK0 + o]; }
  if (k == 1u) { return store1[s * WK1 + o]; }
  return store2[s * WK2 + o];
}
fn st(s: u32, j: u32, v: u32) {
  let k = j % 3u;
  let o = j / 3u;
  if (k == 0u) { store0[s * WK0 + o] = v; } else if (k == 1u) { store1[s * WK1 + o] = v; } else { store2[s * WK2 + o] = v; }
}

fn tid(wg: vec3u, nwg: vec3u, lid: u32) -> u32 { return (wg.y * nwg.x + wg.x) * ${WG}u + lid; }

fn groupsXY(threads: u32, size: u32, at: u32) {
  let groups = (threads + size - 1u) / size;
  let gx = min(groups, 65535u);
  var gy = 1u;
  if (gx > 0u) { gy = (groups + gx - 1u) / gx; }
  indirect[at] = gx;
  indirect[at + 1u] = gy;
  indirect[at + 2u] = 1u;
}

// ---- GPU-driven loop: prep → sel → post → expand → insertion (args, insert, commit,
// resolve, claim, record), repeated K times per submission without a round trip to the host.

@compute @workgroup_size(1) fn prep() {
  if (atomicLoad(&ctr[C_HALT]) == H_RUNNING) {
    if (atomicLoad(&ctr[C_STOREOVF]) != 0u || atomicLoad(&ctr[C_TABLEOVF]) != 0u || atomicLoad(&ctr[C_ERROR]) != 0u) {
      atomicStore(&ctr[C_HALT], H_OVERFLOW);
    } else if (atomicLoad(&ctr[C_CUR]) >= atomicLoad(&ctr[C_GOALCOST])) {
      atomicStore(&ctr[C_HALT], H_DONE);
    }
  }
  if (atomicLoad(&ctr[C_HALT]) != H_RUNNING) { groupsXY(0u, ${WG}u, ${IND.SEL}u); return; }
  atomicStore(&ctr[C_FRONT], 0u);
  atomicStore(&ctr[C_NEXTF], INF);
  groupsXY(min(atomicLoad(&ctr[C_STORED]), P.storeCap), ${WG}u, ${IND.SEL}u);
}

// selection. A state is open (a) if its best g is < the g at which it was expanded, with key
// f = g + h, or (b) if it has deferred successors, with key f = smallest deferred f.
// Key < CUR + delta → frontier (marked expanded at g; in (b) only successors with f ≥ key
// will be emitted, the others were already stored at this g); otherwise the key contributes to the NEXTF minimum.
@compute @workgroup_size(${WG}) fn sel(@builtin(workgroup_id) wg: vec3u, @builtin(num_workgroups) nwg: vec3u, @builtin(local_invocation_index) lid: u32) {
  let i = tid(wg, nwg, lid);
  if (i >= min(atomicLoad(&ctr[C_STORED]), P.storeCap)) { return; }
  let m = mt[i];
  let v = atomicLoad(&gf[i]);
  let g = v >> 16u;
  if (g == NONE16) { return; }
  var key: u32;
  var lo = 0u;
  if (g < (m >> 13u)) {
    key = g + tbl[P.offTE + (ld(i, 0u) & 0xFFFFu)];
  } else if ((v & NONE16) != NONE16) {
    key = v & NONE16;
    lo = key;
  } else {
    return;
  }
  if (key >= atomicLoad(&ctr[C_GOALCOST])) { return; }
  if (key < atomicLoad(&ctr[C_CUR]) + P.delta) {
    mt[i] = (m & 0x1FFFu) | (g << 13u);
    atomicOr(&gf[i], NONE16);
    let k = atomicAdd(&ctr[C_FRONT], 1u);
    frontier[2u * k] = i;
    frontier[2u * k + 1u] = lo;
  } else {
    atomicMin(&ctr[C_NEXTF], key);
  }
}

@compute @workgroup_size(1) fn post() {
  groupsXY(0u, 1u, ${IND.EXPAND}u);
  if (atomicLoad(&ctr[C_HALT]) != H_RUNNING) { return; }
  atomicStore(&ctr[C_CAND], 0u);
  atomicStore(&ctr[C_CANDOVF], 0u);
  let fc = atomicLoad(&ctr[C_FRONT]);
  if (fc == 0u) {
    // window exhausted: all open states have f ≥ NEXTF, which becomes the proven bound
    let nf = atomicLoad(&ctr[C_NEXTF]);
    if (nf == INF) { atomicStore(&ctr[C_HALT], H_EXHAUSTED); return; }
    atomicStore(&ctr[C_CUR], nf);
    if (nf >= atomicLoad(&ctr[C_GOALCOST])) { atomicStore(&ctr[C_HALT], H_DONE); }
    return;
  }
  if (fc > P.gpuLen) { atomicStore(&ctr[C_HALT], H_BIG_FRONTIER); return; }
  atomicStore(&ctr[C_SLICE_OFF], 0u);
  atomicStore(&ctr[C_SLICE_LEN], fc);
  groupsXY(fc, 1u, ${IND.EXPAND}u);
}

fn has(w: ptr<function, array<u32, W>>, rel: u32) -> bool {
  return (((*w)[1u + (rel >> 5u)] >> (rel & 31u)) & 1u) != 0u;
}

// grid code of cell c in state w (like CompactModel.load)
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

fn goal(cost: u32, si: u32, edge: u32, goalCost: u32) {
  if (cost >= goalCost) { return; }
  if (cost > MAX_F) { atomicStore(&ctr[C_TRUNC], 1u); return; }
  atomicMin(&ctr[C_GOALCOST], cost);
  let gi = atomicAdd(&ctr[C_GOALS], 1u);
  if (gi < GOAL_CAP) {
    goals[gi * 3u] = cost;
    goals[gi * 3u + 1u] = si;
    goals[gi * 3u + 2u] = edge;
  }
}

// interaction from cell c (reached in k steps) in direction d: rules of
// CompactModel.expand (exit, key, door, push), then pruning and emission of the candidate if
// lo ≤ f < lim; f ≥ lim: deferred (smallest deferred f kept in gf[si])
fn emit(si: u32, g: u32, lo: u32, lim: u32, w: ptr<function, array<u32, W>>, c: u32, d: u32, k: u32, doors: u32) {
  let cx = c % P.wd;
  let cy = c / P.wd;
  var m = c + 1u;
  if (d == 0u) { m = c - P.wd; } else if (d == 1u) { m = c + P.wd; } else if (d == 2u) { m = c - 1u; }
  let cost = g + k + 1u;
  let edge = c * 4u + d;
  let goalCost = atomicLoad(&ctr[C_GOALCOST]);
  let gm = gridAt(w, m);
  if (gm == G_EXIT) { goal(cost, si, edge, goalCost); return; }
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
    if (to == 0u) { atomicStore(&ctr[C_ERROR], 1u); return; }
    cw[1u + ((to - 1u) >> 5u)] |= 1u << ((to - 1u) & 31u);
  } else {
    // key or door; pocket keys brought down to the remaining doors (model's canonical form)
    if (gm == G_DOOR && kw <= KOFF) { return; }
    let fb = (tbl[m] >> 16u) - 1u;
    cw[1u + (fb >> 5u)] &= ~(1u << (fb & 31u));
    if (gm == G_KEY) { kw = min(kw + 1u, doors + KOFF); } else { kw -= 1u; }
  }
  // object placed on the exit: the interaction wins
  if ((tbl[m] & 7u) == G_EXIT) { goal(cost, si, edge, goalCost); return; }
  let hn = tbl[P.offTE + m];
  if (hn >= UNREACH) { return; }
  let f = cost + hn;
  if (f >= goalCost) { return; }
  if (f > MAX_F) { atomicStore(&ctr[C_TRUNC], 1u); return; }
  if (f < lo) { return; }
  if (f >= lim) { atomicMin(&gf[si], (g << 16u) | f); return; }
  cw[0] = m | (kw << 16u);
  let ci = atomicAdd(&ctr[C_CAND], 1u);
  if (ci >= P.candCap) { atomicStore(&ctr[C_CANDOVF], 1u); return; }
  let base = ci * ST;
  for (var j = 0u; j < W; j++) { cand[base + j] = cw[j]; }
  cand[base + W] = cost;
  cand[base + W + 1u] = si;
  cand[base + W + 2u] = edge;
}

// expansion: a group of 32 threads (one subgroup) per state; lane y carries row y of the
// bit-parallel walk BFS, neighboring rows are exchanged with subgroupShuffleUp/Down. The
// layer loop is uniform (subgroupAny); the interactions of layer k are emitted
// before layer k + 1, as in the compact model's BFS.
@compute @workgroup_size(32) fn expand(@builtin(workgroup_id) wg: vec3u, @builtin(num_workgroups) nwg: vec3u, @builtin(local_invocation_index) lane: u32) {
  let i = wg.y * nwg.x + wg.x;
  if (i >= atomicLoad(&ctr[C_SLICE_LEN])) { return; }
  let at = 2u * (atomicLoad(&ctr[C_SLICE_OFF]) + i);
  let si = frontier[at];
  let lo = frontier[at + 1u];
  var lim = INF;
  if (P.partial != 0u) { lim = atomicLoad(&ctr[C_CUR]) + P.delta; }
  var w: array<u32, W>;
  for (var j = 0u; j < W; j++) { w[j] = ld(si, j); }
  let g = atomicLoad(&gf[si]) >> 16u;
  let y = lane;
  var objR = 0u;
  var waterR = 0u;
  var doors = 0u;
  for (var j = 1u; j < W; j++) {
    doors += countOneBits(w[j] & tbl[P.offDoor + j]);
    var m = w[j];
    while (m != 0u) {
      let b = firstTrailingBit(m);
      m &= m - 1u;
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
        while (m != 0u) { let x = firstTrailingBit(m); m &= m - 1u; emit(si, g, lo, lim, &w, y * P.wd + x, 0u, k, doors); }
      }
      if (y + 1u < P.h) {
        m = fr & tgtDn;
        while (m != 0u) { let x = firstTrailingBit(m); m &= m - 1u; emit(si, g, lo, lim, &w, y * P.wd + x, 1u, k, doors); }
      }
      m = fr & ((tgtR << 1u) & P.rowMask);
      while (m != 0u) { let x = firstTrailingBit(m); m &= m - 1u; emit(si, g, lo, lim, &w, y * P.wd + x, 2u, k, doors); }
      m = fr & (tgtR >> 1u);
      while (m != 0u) { let x = firstTrailingBit(m); m &= m - 1u; emit(si, g, lo, lim, &w, y * P.wd + x, 3u, k, doors); }
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
  if (lane == 0u) { atomicAdd(&ctr[C_EXPANDED], 1u); }
}

// ---- insertion of a batch of candidates (deduplication, best cost, parent)

// indirect arguments of the insertion kernels; no candidate on overflow or stop
@compute @workgroup_size(1) fn args() {
  var n = min(atomicLoad(&ctr[C_CAND]), P.candCap);
  if (atomicLoad(&ctr[C_CANDOVF]) != 0u) {
    n = 0u;
    if (atomicLoad(&ctr[C_HALT]) == H_RUNNING) { atomicStore(&ctr[C_HALT], H_CAND_OVERFLOW); }
  }
  if (atomicLoad(&ctr[C_HALT]) != H_RUNNING) { n = 0u; }
  atomicStore(&ctr[C_CAND], n);
  atomicAdd(&ctr[C_CANDTOTAL], n);
  groupsXY(n, ${WG}u, ${IND.CAND}u);
}

fn candN() -> u32 { return atomicLoad(&ctr[C_CAND]); }

fn hashAt(base: u32) -> u32 {
  var h = 0x811C9DC5u;
  for (var j = 0u; j < W; j++) {
    var k = cand[base + j] * 0xCC9E2D51u;
    k = (k << 15u) | (k >> 17u);
    k *= 0x1B873593u;
    h ^= k;
    h = (h << 13u) | (h >> 19u);
    h = h * 5u + 0xE6546B64u;
  }
  h ^= h >> 16u;
  h *= 0x85EBCA6Bu;
  h ^= h >> 13u;
  h *= 0xC2B2AE35u;
  h ^= h >> 16u;
  return h;
}

fn eqCand(a: u32, b: u32) -> bool {
  for (var j = 0u; j < W; j++) { if (cand[a + j] != cand[b + j]) { return false; } }
  return true;
}

fn eqStore(a: u32, s: u32) -> bool {
  for (var j = 0u; j < W; j++) { if (cand[a + j] != ld(s, j)) { return false; } }
  return true;
}

// linear probing; a new state reserves its slot with FLAG | i (the first candidate wins, its
// duplicates in the batch point to it), an already stored state is found by full comparison
@compute @workgroup_size(${WG}) fn insert(@builtin(workgroup_id) wg: vec3u, @builtin(num_workgroups) nwg: vec3u, @builtin(local_invocation_index) lid: u32) {
  let i = tid(wg, nwg, lid);
  if (i >= candN()) { return; }
  let base = i * ST;
  var s = hashAt(base) & P.tableMask;
  for (var probe = 0u; probe <= P.tableMask; probe++) {
    var v = atomicLoad(&table[s]);
    loop {
      if (v != 0u) { break; }
      let r = atomicCompareExchangeWeak(&table[s], 0u, FLAG | i);
      if (r.exchanged) { candTarget[i] = FLAG | i; cand[base + W + 3u] = s; return; }
      v = r.old_value;
    }
    if ((v & FLAG) != 0u) {
      if (eqCand(base, (v & ~FLAG) * ST)) { candTarget[i] = v; return; }
    } else if (eqStore(base, v - 1u)) {
      candTarget[i] = v - 1u;
      return;
    }
    s = (s + 1u) & P.tableMask;
  }
  atomicStore(&ctr[C_TABLEOVF], 1u);
  candTarget[i] = INF;
}

// candidates that reserved a slot become states (consecutive indices)
@compute @workgroup_size(${WG}) fn commit(@builtin(workgroup_id) wg: vec3u, @builtin(num_workgroups) nwg: vec3u, @builtin(local_invocation_index) lid: u32) {
  let i = tid(wg, nwg, lid);
  if (i >= candN()) { return; }
  if (candTarget[i] != (FLAG | i)) { return; }
  let base = i * ST;
  let idx = atomicAdd(&ctr[C_STORED], 1u);
  if (idx >= P.storeCap) {
    atomicStore(&ctr[C_STOREOVF], 1u);
    candTarget[i] = INF;
    cand[base + W + 3u] = INF;
    return;
  }
  for (var j = 0u; j < W; j++) { st(idx, j, cand[base + j]); }
  atomicStore(&gf[idx], INF);
  mt[idx] = ${MT_NEW}u;
  parent[idx] = INF;
  atomicStore(&table[cand[base + W + 3u]], idx + 1u);
  cand[base + W + 3u] = idx;
}

// best cost of each state touched by the batch
@compute @workgroup_size(${WG}) fn resolve(@builtin(workgroup_id) wg: vec3u, @builtin(num_workgroups) nwg: vec3u, @builtin(local_invocation_index) lid: u32) {
  let i = tid(wg, nwg, lid);
  if (i >= candN()) { return; }
  var t = candTarget[i];
  if (t == INF) { return; }
  if ((t & FLAG) != 0u) {
    t = cand[(t & ~FLAG) * ST + W + 3u];
    candTarget[i] = t;
    if (t == INF) { return; }
  }
  atomicMin(&gf[t], (cand[i * ST + W] << 16u) | NONE16);
  atomicStore(&owner[t], 0u);
}

// among the candidates with the best cost, only one (the largest index) writes parent and edge
@compute @workgroup_size(${WG}) fn claim(@builtin(workgroup_id) wg: vec3u, @builtin(num_workgroups) nwg: vec3u, @builtin(local_invocation_index) lid: u32) {
  let i = tid(wg, nwg, lid);
  if (i >= candN()) { return; }
  let t = candTarget[i];
  if (t == INF) { return; }
  if (cand[i * ST + W] == (atomicLoad(&gf[t]) >> 16u)) { atomicMax(&owner[t], i + 1u); }
}

@compute @workgroup_size(${WG}) fn record(@builtin(workgroup_id) wg: vec3u, @builtin(num_workgroups) nwg: vec3u, @builtin(local_invocation_index) lid: u32) {
  let i = tid(wg, nwg, lid);
  if (i >= candN()) { return; }
  let t = candTarget[i];
  if (t == INF) { return; }
  if (atomicLoad(&owner[t]) == i + 1u) {
    parent[t] = cand[i * ST + W + 1u];
    mt[t] = (mt[t] & 0xFFFFE000u) | cand[i * ST + W + 2u];
  }
}
`;
}
