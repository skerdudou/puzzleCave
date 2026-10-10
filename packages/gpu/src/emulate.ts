// CPU emulation of the `expand` kernel's expansion (shader.ts), using only the GPU's
// tables: bit rows per lane, layered BFS, interactions read from the key. Used by the tests
// (compared to the compact model's successors); the WGSL follows the same structure line by line.
import { BLOCK, DOOR, EXIT, FREE, KEY, WATER, type Successor } from '@puzzlecave/core';
import { KEYS_OFFSET, type GpuLayout } from './layout';

const DX = [0, 0, -1, 1];
const DY = [-1, 1, 0, 0];

function popcount(v: number): number {
  v -= (v >>> 1) & 0x55555555;
  v = (v & 0x33333333) + ((v >>> 2) & 0x33333333);
  return (Math.imul((v + (v >>> 4)) & 0x0f0f0f0f, 0x01010101) >>> 24) & 0xff;
}

export function emulateSuccessors(L: GpuLayout, key: Uint32Array): Successor[] {
  const { width: WD, height: H, words: W, table: tbl } = L;
  const rowMask = WD === 32 ? 0xffffffff : (1 << WD) - 1;
  const w = Uint32Array.from(key);
  const has = (k: Uint32Array, rel: number) => ((k[1 + (rel >>> 5)]! >>> (rel & 31)) & 1) === 1;
  const gridAt = (c: number): number => {
    const i1 = tbl[L.offInfo1 + c]!;
    const bb = i1 >>> 16;
    if (bb !== 0 && has(w, bb - 1)) return BLOCK;
    const i0 = tbl[c]!;
    const fb = i0 >>> 16;
    if (fb !== 0 && has(w, fb - 1)) return (i0 >>> 4) & 1 ? KEY : DOOR;
    const wb = i1 & 0xffff;
    if (wb !== 0 && has(w, wb - 1)) return FREE;
    return i0 & 7;
  };
  // grid rows of this state (in the kernel, each lane computes its own row)
  const obj = new Uint32Array(H);
  const water = new Uint32Array(H);
  let doorsLeft = 0;
  for (let j = 1; j < W; j++) {
    doorsLeft += popcount(w[j]! & L.doorMask[j]!);
    let m = w[j]!;
    while (m !== 0) {
      const b = 31 - Math.clz32(m & -m);
      m &= m - 1;
      const e = tbl[L.offBit + (j - 1) * 32 + b]!;
      const c = e & 0xffff;
      const bit = 1 << (c % WD);
      if (e >>> 16 === FREE) water[Math.floor(c / WD)]! |= bit;
      else obj[Math.floor(c / WD)]! |= bit;
    }
  }
  const walk = new Uint32Array(H);
  const tgt = new Uint32Array(H);
  for (let y = 0; y < H; y++) {
    walk[y] = (L.walkRows[y]! | water[y]!) & ~obj[y]!;
    tgt[y] = obj[y]! | L.exitRows[y]!;
  }
  const keysWord = w[0]! >>> 16;
  const out: Successor[] = [];

  const emit = (c: number, d: number, k: number) => {
    const cx = c % WD;
    const cy = (c - cx) / WD;
    const m = (cy + DY[d]!) * WD + cx + DX[d]!;
    const edge = c * 4 + d;
    const gm = gridAt(m);
    if (gm === EXIT) {
      out.push({ edge, walk: k, cell: m, won: true, next: [] });
      return;
    }
    const next = Uint32Array.from(w);
    const set = (rel: number) => (next[1 + (rel >>> 5)]! |= 1 << (rel & 31));
    const clear = (rel: number) => (next[1 + (rel >>> 5)]! &= ~(1 << (rel & 31)));
    let kw = keysWord;
    if (gm === BLOCK) {
      const bx = cx + 2 * DX[d]!;
      const by = cy + 2 * DY[d]!;
      if (bx < 0 || by < 0 || bx >= WD || by >= H) return;
      const behind = by * WD + bx;
      const gb = gridAt(behind);
      const holds = (tbl[behind]! >>> 3) & 1;
      if (!(gb === WATER || (gb === FREE && holds))) return;
      clear((tbl[L.offInfo1 + m]! >>> 16) - 1);
      const to =
        gb === WATER ? tbl[L.offInfo1 + behind]! & 0xffff : tbl[L.offInfo1 + behind]! >>> 16;
      if (to === 0) throw new Error('push outside the candidate cells');
      set(to - 1);
    } else {
      if (gm === DOOR && kw - KEYS_OFFSET <= 0) return;
      clear((tbl[m]! >>> 16) - 1);
      kw = gm === KEY ? Math.min(kw + 1, doorsLeft + KEYS_OFFSET) : kw - 1;
    }
    next[0] = (m | (kw << 16)) >>> 0;
    const won = (tbl[m]! & 7) === EXIT;
    out.push({ edge, walk: k, cell: m, won, next: won ? [] : [...next] });
  };

  const p = w[0]! & 0xffff;
  let fr = new Uint32Array(H);
  fr[Math.floor(p / WD)] = 1 << (p % WD);
  const vis = Uint32Array.from(fr);
  for (let k = 0; ; k++) {
    for (let y = 0; y < H; y++) {
      const F = fr[y]!;
      if (F === 0) continue;
      const each = (mask: number, d: number) => {
        for (let m = mask >>> 0; m !== 0; m &= m - 1) emit(y * WD + 31 - Math.clz32(m & -m), d, k);
      };
      if (y > 0) each(F & tgt[y - 1]!, 0);
      if (y + 1 < H) each(F & tgt[y + 1]!, 1);
      each(F & ((tgt[y]! << 1) & rowMask), 2);
      each(F & (tgt[y]! >>> 1), 3);
    }
    const nf = new Uint32Array(H);
    let any = 0;
    for (let y = 0; y < H; y++) {
      let e = fr[y]! | (fr[y]! << 1) | (fr[y]! >>> 1);
      if (y > 0) e |= fr[y - 1]!;
      if (y + 1 < H) e |= fr[y + 1]!;
      nf[y] = e & walk[y]! & ~vis[y]! & rowMask;
      any |= nf[y]!;
    }
    if (any === 0) break;
    fr = nf;
    for (let y = 0; y < H; y++) vis[y]! |= nf[y]!;
  }
  return out;
}
