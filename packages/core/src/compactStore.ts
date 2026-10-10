// Compact solver structures: memory budget, open-addressing state table and binary heap, all on
// typed arrays (outside the V8 heap: --max-old-space-size does not bound them, hence the
// explicit budget).

/** Bytes allocated by the solver typed arrays, capped by `limit`. */
export class MemoryBudget {
  used = 0;
  peak = 0;
  constructor(readonly limit: number) {}

  /** reserves `bytes`; false (nothing reserved) if the cap would be exceeded */
  take(bytes: number): boolean {
    if (this.used + bytes > this.limit) return false;
    this.used += bytes;
    if (this.used > this.peak) this.peak = this.used;
    return true;
  }

  give(bytes: number): void {
    this.used -= bytes;
  }
}

/** 32-bit hash (MurmurHash3, 32-bit words) of `words` words of `a` starting at `off`. */
export function hashWords(a: Uint32Array, off: number, words: number): number {
  let h = 0x9747b28c ^ words;
  for (let i = 0; i < words; i++) {
    let k = Math.imul(a[off + i]!, 0xcc9e2d51);
    k = (k << 15) | (k >>> 17);
    h ^= Math.imul(k, 0x1b873593);
    h = (h << 13) | (h >>> 19);
    h = (Math.imul(h, 5) + 0xe6546b64) | 0;
  }
  h ^= h >>> 16;
  h = Math.imul(h, 0x85ebca6b);
  h ^= h >>> 13;
  h = Math.imul(h, 0xc2b2ae35);
  h ^= h >>> 16;
  return h >>> 0;
}

const MAX_LOAD = 0.75;
const NODE_FIXED_BYTES = 4 + 2 + 2 + 2 + 1;

/**
 * Search nodes numbered in insertion order, stored in blocks of 2^chunkBits (no copying when the
 * number of nodes grows): key (`words` words), parent, cost (≤ 65535), edge, strong bound
 * (NO_H = not computed yet) and a "closed" flag. Index: open-addressing table (linear probing)
 * of node ids + 1 and their hash; on equal hash, the full key breaks the tie. Every allocation
 * goes through the budget: insert returns -1 when it is exhausted.
 */
export class StateStore {
  static readonly NO_H = 0xffff;
  size = 0;
  private readonly chunkBits: number;
  private readonly chunkMask: number;
  private readonly keys: Uint32Array[] = [];
  private readonly parents: Uint32Array[] = [];
  private readonly costs: Uint16Array[] = [];
  private readonly edges: Uint16Array[] = [];
  private readonly hs: Uint16Array[] = [];
  private readonly flags: Uint8Array[] = [];
  private slots: Uint32Array;
  private slotHash: Uint32Array;
  private mask: number;
  /** free slot found by the last unsuccessful find, and the hash searched */
  private freeSlot = -1;
  private freeHash = 0;

  constructor(
    readonly words: number,
    private readonly budget: MemoryBudget,
    chunkBits = 12,
  ) {
    this.chunkBits = chunkBits;
    this.chunkMask = (1 << chunkBits) - 1;
    const cap = 1024;
    if (!budget.take(cap * 8)) throw new Error('memory budget too small');
    this.slots = new Uint32Array(cap);
    this.slotHash = new Uint32Array(cap);
    this.mask = cap - 1;
  }

  /** bytes per node outside the table */
  get nodeBytes(): number {
    return this.words * 4 + NODE_FIXED_BYTES;
  }

  /** id of the node with key `key[off…]`, or -1 */
  find(key: Uint32Array, h: number, off = 0): number {
    const { slots, slotHash, mask, words } = this;
    for (let i = h & mask; ; i = (i + 1) & mask) {
      const s = slots[i]!;
      if (s === 0) {
        this.freeSlot = i;
        this.freeHash = h;
        return -1;
      }
      if (slotHash[i] !== h) continue;
      const id = s - 1;
      const chunk = this.keys[id >>> this.chunkBits]!;
      const base = (id & this.chunkMask) * words;
      let j = 0;
      while (j < words && chunk[base + j] === key[off + j]) j++;
      if (j === words) return id;
    }
  }

  /** adds an absent key; -1 if the budget is exhausted */
  insert(key: Uint32Array, h: number, off = 0): number {
    if ((this.size + 1) / (this.mask + 1) > MAX_LOAD) {
      if (!this.grow()) return -1;
      this.freeSlot = -1;
    }
    const id = this.size;
    const c = id >>> this.chunkBits;
    if (c === this.keys.length && !this.addChunk()) return -1;
    // on equal hash, two absent keys have the same first free slot
    if (this.freeSlot < 0 || this.freeHash !== h || this.slots[this.freeSlot] !== 0) {
      if (this.find(key, h, off) >= 0) throw new Error('key already present');
    }
    const slot = this.freeSlot;
    this.freeSlot = -1;
    this.slots[slot] = id + 1;
    this.slotHash[slot] = h;
    const at = (id & this.chunkMask) * this.words;
    this.keys[c]!.set(key.subarray(off, off + this.words), at);
    this.hs[c]![id & this.chunkMask] = StateStore.NO_H;
    this.flags[c]![id & this.chunkMask] = 0;
    this.size++;
    return id;
  }

  /** empties the table keeping its arrays (and their share of the budget) for a new search */
  reset(): void {
    this.slots.fill(0);
    this.size = 0;
    this.freeSlot = -1;
  }

  readKey(id: number, out: Uint32Array, off = 0): void {
    const chunk = this.keys[id >>> this.chunkBits]!;
    const base = (id & this.chunkMask) * this.words;
    for (let j = 0; j < this.words; j++) out[off + j] = chunk[base + j]!;
  }

  parent(id: number): number {
    return this.parents[id >>> this.chunkBits]![id & this.chunkMask]!;
  }
  setParent(id: number, v: number): void {
    this.parents[id >>> this.chunkBits]![id & this.chunkMask] = v;
  }
  cost(id: number): number {
    return this.costs[id >>> this.chunkBits]![id & this.chunkMask]!;
  }
  setCost(id: number, v: number): void {
    this.costs[id >>> this.chunkBits]![id & this.chunkMask] = v;
  }
  edge(id: number): number {
    return this.edges[id >>> this.chunkBits]![id & this.chunkMask]!;
  }
  setEdge(id: number, v: number): void {
    this.edges[id >>> this.chunkBits]![id & this.chunkMask] = v;
  }
  h(id: number): number {
    return this.hs[id >>> this.chunkBits]![id & this.chunkMask]!;
  }
  setH(id: number, v: number): void {
    this.hs[id >>> this.chunkBits]![id & this.chunkMask] = v;
  }
  closed(id: number): boolean {
    return this.flags[id >>> this.chunkBits]![id & this.chunkMask] === 1;
  }
  setClosed(id: number): void {
    this.flags[id >>> this.chunkBits]![id & this.chunkMask] = 1;
  }

  private addChunk(): boolean {
    const n = 1 << this.chunkBits;
    if (!this.budget.take(n * this.nodeBytes)) return false;
    this.keys.push(new Uint32Array(n * this.words));
    this.parents.push(new Uint32Array(n));
    this.costs.push(new Uint16Array(n));
    this.edges.push(new Uint16Array(n));
    this.hs.push(new Uint16Array(n));
    this.flags.push(new Uint8Array(n));
    return true;
  }

  /** doubles the table; the old and the new one coexist during the copy */
  private grow(): boolean {
    const oldCap = this.mask + 1;
    const cap = oldCap * 2;
    if (!this.budget.take(cap * 8)) return false;
    const slots = new Uint32Array(cap);
    const slotHash = new Uint32Array(cap);
    const mask = cap - 1;
    for (let i = 0; i < oldCap; i++) {
      const s = this.slots[i]!;
      if (s === 0) continue;
      const h = this.slotHash[i]!;
      let j = h & mask;
      while (slots[j] !== 0) j = (j + 1) & mask;
      slots[j] = s;
      slotHash[j] = h;
    }
    this.slots = slots;
    this.slotHash = slotHash;
    this.mask = mask;
    this.budget.give(oldCap * 8);
    return true;
  }
}

/** Binary min-heap of (priority, value) on Uint32s; pop() stores the minimum in top*. */
export class TypedHeap {
  size = 0;
  topPrio = 0;
  topVal = 0;
  private prio = new Uint32Array(0);
  private vals = new Uint32Array(0);

  constructor(private readonly budget: MemoryBudget) {}

  /** false if the budget does not allow growing (nothing is added) */
  push(priority: number, value: number): boolean {
    if (this.size === this.prio.length && !this.grow()) return false;
    const { prio, vals } = this;
    let i = this.size++;
    while (i > 0) {
      const p = (i - 1) >> 1;
      const pp = prio[p]!;
      if (pp <= priority) break;
      prio[i] = pp;
      vals[i] = vals[p]!;
      i = p;
    }
    prio[i] = priority;
    vals[i] = value;
    return true;
  }

  /** empties the heap keeping its arrays */
  reset(): void {
    this.size = 0;
  }

  /** removes the minimum (the heap must not be empty) */
  pop(): void {
    const { prio, vals } = this;
    this.topPrio = prio[0]!;
    this.topVal = vals[0]!;
    const n = --this.size;
    if (n === 0) return;
    const lp = prio[n]!;
    const lv = vals[n]!;
    let i = 0;
    for (;;) {
      let m = 2 * i + 1;
      if (m >= n) break;
      if (m + 1 < n && prio[m + 1]! < prio[m]!) m++;
      if (prio[m]! >= lp) break;
      prio[i] = prio[m]!;
      vals[i] = vals[m]!;
      i = m;
    }
    prio[i] = lp;
    vals[i] = lv;
  }

  private grow(): boolean {
    const old = this.prio.length;
    const cap = Math.max(1024, old * 2);
    if (!this.budget.take(cap * 8)) return false;
    const prio = new Uint32Array(cap);
    const vals = new Uint32Array(cap);
    prio.set(this.prio);
    vals.set(this.vals);
    this.prio = prio;
    this.vals = vals;
    this.budget.give(old * 8);
    return true;
  }
}
