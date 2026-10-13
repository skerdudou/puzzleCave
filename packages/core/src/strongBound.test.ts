import { expect, test } from 'vitest';
import { fromAscii } from './ascii';
import { CompactModel } from './compactModel';
import { StrongBound, minCostAssignment } from './strongBound';
import { UNREACHABLE } from './solverBound';
import { initialState } from './state';
import { mulberry32, sampleLevels, validRandomLevel } from './testLevels';
import type { LevelData, LevelObject, Terrain } from './types';

/**
 * Exhaustive macro-state graph of a small level and the exact cost to win from every state
 * (backward Dijkstra; edge cost = walk + 1). undefined beyond `cap` states.
 */
export function exactCosts(level: LevelData, cap: number) {
  const model = new CompactModel(level);
  const ids = new Map<string, number>();
  const keys: Uint32Array[] = [];
  const succ: { to: number; cost: number }[][] = [];
  const winCost: number[] = [];
  const add = (k: Uint32Array) => {
    const s = k.join(',');
    let id = ids.get(s);
    if (id === undefined) {
      id = keys.length;
      ids.set(s, id);
      keys.push(k);
      succ.push([]);
      winCost.push(Infinity);
    }
    return id;
  };
  add(model.encode(model.start));
  for (let i = 0; i < keys.length; i++) {
    if (keys.length > cap) return undefined;
    for (const s of model.successors(keys[i]!)) {
      if (s.won) winCost[i] = Math.min(winCost[i]!, s.walk + 1);
      else succ[i]!.push({ to: add(Uint32Array.from(s.next)), cost: s.walk + 1 });
    }
  }
  // backward Dijkstra (small graphs: simple label-correcting passes)
  const pred: { from: number; cost: number }[][] = keys.map(() => []);
  succ.forEach((l, i) => l.forEach((e) => pred[e.to]!.push({ from: i, cost: e.cost })));
  const h = winCost.slice();
  const queue = h.map((_, i) => i).filter((i) => h[i]! < Infinity);
  const inQ = new Uint8Array(keys.length);
  for (const i of queue) inQ[i] = 1;
  for (let head = 0; head < queue.length; head++) {
    const j = queue[head]!;
    inQ[j] = 0;
    for (const { from, cost } of pred[j]!) {
      if (h[j]! + cost < h[from]!) {
        h[from] = h[j]! + cost;
        if (!inQ[from]) {
          inQ[from] = 1;
          queue.push(from);
        }
      }
    }
  }
  return { model, keys, h };
}

/** random levels with many waters and blocks (fill chains), keys and doors */
function waterLevel(rnd: () => number, n: number): LevelData {
  const int = (k: number) => Math.floor(rnd() * k);
  const width = 4 + int(4);
  const height = 3 + int(4);
  const terrain: Terrain[] = Array.from({ length: width * height }, () => {
    const r = rnd();
    return r < 0.5 ? 'floor' : r < 0.62 ? 'wall' : r < 0.7 ? 'gravel' : 'water';
  });
  const at = (x: number, y: number) => y * width + x;
  const exit = { x: int(width), y: int(height) };
  terrain[at(exit.x, exit.y)] = 'exit';
  const used = new Set<number>([at(exit.x, exit.y)]);
  const free = () => {
    for (let t = 0; t < 50; t++) {
      const i = int(width * height);
      if (!used.has(i) && (terrain[i] === 'floor' || (terrain[i] === 'gravel' && rnd() < 0.2))) {
        used.add(i);
        return { x: i % width, y: Math.floor(i / width) };
      }
    }
    return undefined;
  };
  const start = free() ?? { x: (exit.x + 1) % width, y: exit.y };
  terrain[at(start.x, start.y)] = rnd() < 0.15 ? 'water' : 'floor';
  used.add(at(start.x, start.y));
  const objects: LevelObject[] = [];
  const add = (kind: LevelObject['kind'], count: number) => {
    for (let i = 0; i < count; i++) {
      const p = free();
      if (p) objects.push({ ...p, kind });
    }
  };
  add('block', 1 + int(5));
  add('key', int(3));
  add('door', int(3));
  return {
    id: `wrnd-${n}`,
    name: `wrnd-${n}`,
    width,
    height,
    terrain,
    objects,
    start,
    initialKeys: int(4) - 1,
    thresholds: {},
  };
}

function startTdr(level: LevelData): number {
  const model = new CompactModel(level);
  const sb = new StrongBound(model);
  model.load(model.encode(initialState(level)));
  return sb.tdr();
}

test('timed relaxation: fill chains, keys behind water, doors', () => {
  // the water must be filled: walk 1 to the block side? the block is next to the player
  expect(startTdr(fromAscii(['@B~E']))).toBe(3);
  // no block: unreachable
  expect(startTdr(fromAscii(['@.~E']))).toBe(UNREACHABLE);
  // two waters in a row need two blocks: the second block must come after the first fill
  expect(startTdr(fromAscii(['@BB~~E']))).toBeGreaterThanOrEqual(5);
  // a key behind a door: one key needed, picked before
  expect(startTdr(fromAscii(['k.@DE']))).toBe(2 + 4);
});

/**
 * Admissibility on exhaustive graphs: for every reachable macro-state of small random levels,
 * tdr, fill and value are ≤ the exact cost to win (and value(limit) is ≥ limit or equal to
 * value()). Also counts how often each bound beats the compact one.
 */
test('property: timed relaxation, mandatory fills and value are admissible (random levels)', () => {
  const rnd = mulberry32(4242);
  const levels: LevelData[] = [...sampleLevels(400)];
  for (let i = 0; i < 700; i++) levels.push(validRandomLevel(rnd, i));
  for (let i = 0; i < 3000; i++) levels.push(waterLevel(rnd, i));
  let states = 0;
  let strongerTdr = 0;
  let fillPositive = 0;
  let graphs = 0;
  for (const level of levels) {
    const g = exactCosts(level, 30_000);
    if (!g) continue;
    graphs++;
    const sb = new StrongBound(g.model, {
      maxTrackedKeys: 2 + (graphs % 3),
      maxDoorCount: 1 + (graphs % 4),
    });
    g.keys.forEach((k, i) => {
      g.model.load(k);
      const exact = g.h[i]!;
      const cheap = sb.compact.strong();
      const h = sb.tdr();
      const v = sb.value();
      const f = i % 4 === 0 ? sb.fill() : 0;
      const limit = (i * 7) % 13;
      const vl = sb.value(limit);
      states++;
      expect(v).toBe(Math.max(cheap, h));
      const where = `${level.id} state ${i}`;
      if (vl < limit) expect(vl, where).toBe(v);
      if (exact < Infinity) {
        expect(h, where).toBeLessThanOrEqual(exact);
        expect(f, `${where} (fill)`).toBeLessThanOrEqual(exact);
        if (h > cheap) strongerTdr++;
        if (f > 0) fillPositive++;
      }
    });
  }
  expect(graphs).toBeGreaterThan(2000);
  expect(states).toBeGreaterThan(50_000);
  expect(strongerTdr).toBeGreaterThan(1000);
  expect(fillPositive).toBeGreaterThan(100);
}, 600_000);

test('min-cost assignment: same as brute force on random matrices', () => {
  const rnd = mulberry32(9);
  const brute = (c: number[][], row = 0, used = new Set<number>()): number => {
    if (row === c.length) return 0;
    let best = Infinity;
    for (let j = 0; j < c[0]!.length; j++) {
      if (used.has(j)) continue;
      used.add(j);
      best = Math.min(best, c[row]![j]! + brute(c, row + 1, used));
      used.delete(j);
    }
    return best;
  };
  for (let t = 0; t < 300; t++) {
    const rows = 1 + Math.floor(rnd() * 4);
    const cols = rows + Math.floor(rnd() * 3);
    const c = Array.from({ length: rows }, () =>
      Array.from({ length: cols }, () => Math.floor(rnd() * 20)),
    );
    expect(minCostAssignment(c)).toBe(brute(c));
  }
});
