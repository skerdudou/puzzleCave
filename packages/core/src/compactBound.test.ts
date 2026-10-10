import { expect, test } from 'vitest';
import { fromAscii } from './ascii';
import { CompactBound } from './compactBound';
import { CompactModel } from './compactModel';
import { MemoryBudget } from './compactStore';
import { solve } from './solver';
import { RemainingBound, UNREACHABLE } from './solverBound';
import { solveNaive } from './solverNaive';
import { initialState } from './state';
import { mulberry32, validRandomLevel } from './testLevels';
import type { LevelData } from './types';

function startBound(level: LevelData): { strong: number; v2: number } {
  const model = new CompactModel(level);
  const bound = new CompactBound(model);
  const s0 = initialState(level);
  model.load(model.encode(s0));
  return { strong: bound.strong(), v2: new RemainingBound(s0).strong(s0) };
}

test('door bound: two doors in series need two keys', () => {
  // left ×2 for the two keys, then right ×5: 7 moves; the old bound only sees one key (5)
  const level = fromAscii(['kk@DDE']);
  expect(startBound(level)).toEqual({ strong: 7, v2: 5 });
  const r = solveNaive(level);
  expect(r.status === 'solved' && r.moves.length).toBe(7);
});

test('door bound: negative initial keys and insufficient keys', () => {
  // -1 key: 2 keys are needed for the door; pick up both (2 moves) then 5 moves to the exit
  expect(startBound(fromAscii(['kk@.DE'], { initialKeys: -1 })).strong).toBe(1 + 1 + 5);
  // a single key for two doors: dead
  expect(startBound(fromAscii(['k@DDE'])).strong).toBe(UNREACHABLE);
  // exit reachable without a door: direct distance despite the negative keys
  expect(startBound(fromAscii(['@..E', '.D..'], { initialKeys: -3 })).strong).toBe(3);
});

test('door cache taken from the budget: all tables counted, cache reduced (or absent) if the budget is small, same values', () => {
  // 12 doors: 4096 possible tables of 2 bytes per tile
  const rows = ['k.k.k.k.k.k.@', 'DDDDDDDDDDDD.', 'k.k.k.k.k.k.E'];
  const level = fromAscii(rows);
  const model = new CompactModel(level);
  const full = new CompactBound(model, new MemoryBudget(2 ** 30));
  expect(full.cacheEntries).toBe(4096);
  const sizes: number[] = [];
  const fixed = full.bytes - full.cacheBytes;
  for (const limit of [2 ** 30, 64 * 1024, 16 * 1024, fixed + 10]) {
    const budget = new MemoryBudget(limit);
    const bound = new CompactBound(model, budget);
    expect(budget.used, `budget ${limit}`).toBe(bound.bytes);
    expect(budget.used).toBeLessThanOrEqual(limit);
    sizes.push(bound.cacheEntries);
    // same bounds on the reached states, with or without cache
    const start = model.encode(model.start);
    const seen = new Set<string>([start.join(',')]);
    const queue = [start];
    for (let head = 0; head < queue.length && head < 300; head++) {
      model.load(queue[head]!);
      const a = bound.strong();
      model.load(queue[head]!);
      expect(a).toBe(full.strong());
      for (const succ of model.successors(queue[head]!)) {
        const k = succ.next.join(',');
        if (succ.won || seen.has(k)) continue;
        seen.add(k);
        queue.push(Uint32Array.from(succ.next));
      }
    }
  }
  expect(sizes[0]).toBe(4096);
  expect(sizes[1]).toBeLessThan(4096);
  expect(sizes.at(-1)).toBe(0);
  // budget smaller than the fixed tables: explicit refusal, and solve stops cleanly
  expect(() => new CompactBound(model, new MemoryBudget(64))).toThrow(/budget/);
  const r = solve(level, { maxMemoryMb: 64 / 2 ** 20 });
  expect(r.status).toBe('timeout');
});

test('cached door table: same value as the 0-1 BFS from the player', () => {
  const rnd = mulberry32(31);
  let compared = 0;
  for (let n = 0; n < 300; n++) {
    const level = validRandomLevel(rnd, n);
    if (!level.objects.some((o) => o.kind === 'door')) continue;
    const model = new CompactModel(level);
    const bound = new CompactBound(model);
    const start = model.encode(model.start);
    const seen = new Set<string>([start.join(',')]);
    const queue = [start];
    for (let head = 0; head < queue.length && head < 200; head++) {
      model.load(queue[head]!);
      // twice: computation then cache read
      for (let r = 0; r < 2; r++)
        expect(bound.cachedMinDoors(model.player), level.id).toBe(bound.minDoors(model.player));
      compared++;
      for (const succ of model.successors(queue[head]!)) {
        const k = succ.next.join(',');
        if (succ.won || seen.has(k)) continue;
        seen.add(k);
        queue.push(Uint32Array.from(succ.next));
      }
    }
  }
  expect(compared).toBeGreaterThan(2000);
});

/**
 * Properties on random levels, over all reached macro-states: the strong bound dominates
 * the old (v2) one and the relaxed distance, it is consistent (h(s) ≤ walk + 1 + h(s')) and
 * admissible (h(start) ≤ optimum of the naive BFS).
 */
test('strong bound consistent, admissible and at least as strong as v2', () => {
  const rnd = mulberry32(99);
  let pairs = 0;
  let stronger = 0;
  let dead = 0;
  for (let n = 0; n < 300; n++) {
    const level = validRandomLevel(rnd, n);
    const model = new CompactModel(level);
    const bound = new CompactBound(model);
    const v2 = new RemainingBound(model.start);
    const hOf = (key: Uint32Array) => {
      model.load(key);
      return bound.strong();
    };
    const start = model.encode(model.start);
    const seen = new Set<string>([start.join(',')]);
    const queue = [start];
    for (let head = 0; head < queue.length && head < 300; head++) {
      const key = queue[head]!;
      const h = hOf(key);
      const s = model.decode(key);
      const hv2 = v2.strong(s);
      const p = s.player.y * s.width + s.player.x;
      if (hv2 !== UNREACHABLE) {
        expect(h, level.id).toBeGreaterThanOrEqual(hv2);
        if (h > hv2) stronger++;
      }
      expect(h).toBeGreaterThanOrEqual(bound.toExit[p]!);
      for (const succ of model.successors(key)) {
        const h2 = succ.won ? 0 : hOf(Uint32Array.from(succ.next));
        if (h !== UNREACHABLE) {
          pairs++;
          expect(h, level.id).toBeLessThanOrEqual(succ.walk + 1 + h2);
        } else {
          // dead state: no successor wins, all are dead
          dead++;
          expect(succ.won, level.id).toBe(false);
          expect(h2, level.id).toBe(UNREACHABLE);
        }
        if (succ.won) continue;
        const k = succ.next.join(',');
        if (!seen.has(k)) {
          seen.add(k);
          queue.push(Uint32Array.from(succ.next));
        }
      }
    }
    const r = solveNaive(level, { maxStates: 2_000_000 });
    if (r.status === 'solved') expect(hOf(start), level.id).toBeLessThanOrEqual(r.moves.length);
    if (r.status === 'unsolvable') continue;
  }
  expect(pairs).toBeGreaterThan(10_000);
  expect(stronger).toBeGreaterThan(0);
  expect(dead).toBeGreaterThan(100);
});
