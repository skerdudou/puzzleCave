import { expect, test } from 'vitest';
import { MemoryBudget, StateStore, TypedHeap, hashWords } from './compactStore';

const key = (words: number, ...v: number[]) => {
  const k = new Uint32Array(words);
  v.forEach((x, i) => (k[i] = x));
  return k;
};

test('hash: deterministic, sensitive to every word', () => {
  const a = key(3, 1, 2, 3);
  expect(hashWords(a, 0, 3)).toBe(hashWords(key(3, 1, 2, 3), 0, 3));
  expect(hashWords(a, 0, 3)).not.toBe(hashWords(key(3, 1, 2, 4), 0, 3));
  expect(hashWords(a, 0, 3)).not.toBe(hashWords(key(3, 2, 1, 3), 0, 3));
  // offset: same key read in the middle of an array
  const big = new Uint32Array([9, 9, 1, 2, 3]);
  expect(hashWords(big, 2, 3)).toBe(hashWords(a, 0, 3));
});

test('table: insertion, lookup and key readback', () => {
  const s = new StateStore(3, new MemoryBudget(64 * 2 ** 20));
  const k = key(3, 7, 0xffffffff, 42);
  const h = hashWords(k, 0, 3);
  expect(s.find(k, h)).toBe(-1);
  const id = s.insert(k, h);
  expect(id).toBe(0);
  expect(s.size).toBe(1);
  expect(s.find(k, h)).toBe(0);
  const out = new Uint32Array(3);
  s.readKey(id, out);
  expect([...out]).toEqual([7, 0xffffffff, 42]);
  s.setCost(id, 65535);
  s.setParent(id, 123456789);
  s.setEdge(id, 4095);
  s.setH(id, 300);
  s.setClosed(id);
  expect([s.cost(id), s.parent(id), s.edge(id), s.h(id), s.closed(id)]).toEqual([
    65535,
    123456789,
    4095,
    300,
    true,
  ]);
  expect(s.h(s.insert(key(3, 1), hashWords(key(3, 1), 0, 3)))).toBe(StateStore.NO_H);
});

test('table: hash collisions resolved by the full key', () => {
  const s = new StateStore(2, new MemoryBudget(64 * 2 ** 20));
  // same forced hash for 1000 distinct keys
  for (let i = 0; i < 1000; i++) expect(s.insert(key(2, i, i * 3), 12345)).toBe(i);
  for (let i = 0; i < 1000; i++) expect(s.find(key(2, i, i * 3), 12345)).toBe(i);
  expect(s.find(key(2, 5, 16), 12345)).toBe(-1);
  expect(s.find(key(2, 5, 15), 999)).toBe(-1);
  // inserting another key after an unsuccessful find: stored in its own slot
  const id = s.insert(key(2, 77, 77), 4242);
  expect(s.find(key(2, 77, 77), 4242)).toBe(id);
});

test('table: resizing and node blocks, no loss (all keys read back)', () => {
  const s = new StateStore(4, new MemoryBudget(512 * 2 ** 20), 10);
  const n = 300_000;
  const k = new Uint32Array(4);
  const out = new Uint32Array(4);
  const setKey = (i: number) => {
    k[0] = i;
    k[1] = i ^ 0x5555;
    k[3] = i * 7;
  };
  /** reads back the first `count` keys: id, cost and key; returns the number of mismatches */
  const errors = (count: number) => {
    let bad = 0;
    for (let i = 0; i < count; i++) {
      setKey(i);
      const id = s.find(k, hashWords(k, 0, 4));
      if (id !== i || s.cost(id) !== (i & 0xffff)) {
        bad++;
        continue;
      }
      s.readKey(id, out);
      for (let j = 0; j < 4; j++) if (out[j] !== k[j]) bad++;
    }
    return bad;
  };
  let grows = 0;
  for (let i = 0; i < n; i++) {
    setKey(i);
    const id = s.insert(k, hashWords(k, 0, 4));
    expect(id).toBe(i);
    s.setCost(id, i & 0xffff);
    // right after each doubling of the table (load 0.75 on 1024 · 2^g slots)
    if (i + 1 === 0.75 * 1024 * 2 ** grows + 1) {
      grows++;
      expect(errors(i + 1), `after ${grows} doubling(s)`).toBe(0);
    }
  }
  expect(grows).toBeGreaterThan(8);
  expect(s.size).toBe(n);
  expect(errors(n)).toBe(0);
});

test('table: reset without reallocating', () => {
  const budget = new MemoryBudget(64 * 2 ** 20);
  const s = new StateStore(2, budget, 8);
  for (let i = 0; i < 5000; i++) {
    const id = s.insert(key(2, i), hashWords(key(2, i), 0, 2));
    s.setClosed(id);
    s.setH(id, 7);
  }
  const used = budget.used;
  s.reset();
  expect(s.size).toBe(0);
  expect(budget.used).toBe(used);
  expect(s.find(key(2, 3), hashWords(key(2, 3), 0, 2))).toBe(-1);
  const id = s.insert(key(2, 3), hashWords(key(2, 3), 0, 2));
  expect([id, s.closed(id), s.h(id)]).toEqual([0, false, StateStore.NO_H]);
  for (let i = 0; i < 5000; i++) s.insert(key(2, i, 1), hashWords(key(2, i, 1), 0, 2));
  expect(budget.used).toBe(used);
});

test('table: rejects an insertion beyond the memory budget', () => {
  const budget = new MemoryBudget(2 * 2 ** 20);
  const s = new StateStore(8, budget, 12);
  const k = new Uint32Array(8);
  let inserted = 0;
  for (let i = 0; i < 1_000_000; i++) {
    k[0] = i;
    if (s.insert(k, hashWords(k, 0, 8)) < 0) break;
    inserted++;
  }
  expect(inserted).toBeGreaterThan(1000);
  expect(inserted).toBeLessThan(1_000_000);
  expect(budget.used).toBeLessThanOrEqual(budget.limit);
  // nodes already inserted remain readable
  k[0] = 0;
  expect(s.find(k, hashWords(k, 0, 8))).toBe(0);
});

test('typed heap: pops in priority order and grows', () => {
  const heap = new TypedHeap(new MemoryBudget(64 * 2 ** 20));
  const values: number[] = [];
  let x = 12345;
  for (let i = 0; i < 50_000; i++) {
    x = (Math.imul(x, 1103515245) + 12345) >>> 0;
    values.push(x);
    expect(heap.push(x, i)).toBe(true);
  }
  values.sort((a, b) => a - b);
  for (const v of values) {
    heap.pop();
    expect(heap.topPrio).toBe(v);
  }
  expect(heap.size).toBe(0);
});

test('typed heap: refuses to grow beyond the budget', () => {
  const heap = new TypedHeap(new MemoryBudget(1024 * 1024));
  let pushed = 0;
  while (heap.push(pushed, pushed) && pushed < 10_000_000) pushed++;
  expect(pushed).toBeGreaterThan(1000);
  expect(pushed).toBeLessThan(10_000_000);
});
