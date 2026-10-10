import { expect, test } from 'vitest';
import { fromAscii } from './ascii';
import { CompactModel, type Successor } from './compactModel';
import { DELTA, DIRS, initialState } from './state';
import { step } from './step';
import { solve } from './solver';
import { solveNaive } from './solverNaive';
import { mulberry32, validRandomLevel } from './testLevels';
import type { GameState, LevelData } from './types';

/** Reference successors, like the v2 solver: walking BFS then step() for the interaction. */
function referenceSuccessors(model: CompactModel, s: GameState): Successor[] {
  const { width, height } = s;
  const dist = new Int32Array(width * height).fill(-1);
  const origin = s.player.y * width + s.player.x;
  dist[origin] = 0;
  const order = [origin];
  for (let head = 0; head < order.length; head++) {
    const c = order[head]!;
    for (const dir of DIRS) {
      const x = (c % width) + DELTA[dir].x;
      const y = Math.floor(c / width) + DELTA[dir].y;
      if (x < 0 || y < 0 || x >= width || y >= height) continue;
      const n = y * width + x;
      const t = s.terrain[n];
      if (dist[n] !== -1 || (t !== 'floor' && t !== 'gravel') || s.objects[n] !== null) continue;
      dist[n] = dist[c]! + 1;
      order.push(n);
    }
  }
  const out: Successor[] = [];
  for (const c of order) {
    DIRS.forEach((dir, d) => {
      const x = (c % width) + DELTA[dir].x;
      const y = Math.floor(c / width) + DELTA[dir].y;
      if (x < 0 || y < 0 || x >= width || y >= height) return;
      const n = y * width + x;
      if (s.objects[n] === null && s.terrain[n] !== 'exit') return;
      const at = { x: c % width, y: Math.floor(c / width) };
      const next = step({ ...s, player: at, moves: 0 }, dir).state;
      if (next.moves === 0 || next.status === 'drowned') return;
      out.push({
        edge: c * 4 + d,
        walk: dist[c]!,
        cell: n,
        won: next.status === 'won',
        next: next.status === 'won' ? [] : [...model.encode(next)],
      });
    });
  }
  return out;
}

const sortSucc = (a: Successor[]) => [...a].sort((x, y) => x.edge - y.edge);

/** Walks up to `limit` macro-states and compares the compact engine to the reference at each. */
function compareOn(level: LevelData, limit: number): number {
  const model = new CompactModel(level);
  const start = model.encode(initialState(level));
  const seen = new Set<string>([start.join(',')]);
  const queue = [[...start]];
  let checked = 0;
  for (let head = 0; head < queue.length && head < limit; head++) {
    const key = Uint32Array.from(queue[head]!);
    const s = model.decode(key);
    // codec round trip
    expect([...model.encode(s)], level.id).toEqual([...key]);
    const fast = model.successors(key);
    const ref = referenceSuccessors(model, s);
    expect(sortSucc(fast), level.id).toEqual(sortSucc(ref));
    checked++;
    for (const r of ref) {
      if (r.won) continue;
      const k = r.next.join(',');
      if (!seen.has(k)) {
        seen.add(k);
        queue.push(r.next);
      }
    }
  }
  return checked;
}

test('codec: initial keys outside [−keys, doors] clamped into the interval, lengths unchanged', () => {
  const rows = ['@kDDE', '#k###'];
  const cases: [number, number][] = [
    [70_000, 2],
    [3, 2],
    [-70_000, -2],
    [-3, -2],
    [1, 1],
  ];
  for (const [initialKeys, clamped] of cases) {
    const level = fromAscii(rows, { initialKeys });
    const model = new CompactModel(level);
    expect(model.decode(model.encode(initialState(level))).keys, String(initialKeys)).toBe(clamped);
    const naive = solveNaive(level);
    const r = solve(level);
    expect(r.status, String(initialKeys)).toBe(naive.status);
    if (r.status === 'solved' && naive.status === 'solved')
      expect(r.moves.length).toBe(naive.moves.length);
  }
});

test('canonical key: along real games (step), the key of each state is a successor of the previous key', () => {
  const rnd = mulberry32(17);
  let transitions = 0;
  let surplus = 0;
  for (let n = 0; n < 1000; n++) {
    const level = validRandomLevel(rnd, n);
    const model = new CompactModel(level);
    let s = initialState(level);
    let key = model.encode(s);
    for (let i = 0; i < 200 && s.status === 'playing'; i++) {
      const next = step(s, DIRS[Math.floor(rnd() * 4)]!).state;
      const interacted =
        next.keys !== s.keys ||
        next.objects.some((o, c) => o !== s.objects[c]) ||
        next.terrain.some((t, c) => t !== s.terrain[c]);
      s = next;
      if (s.status !== 'playing') break;
      if (!interacted) continue;
      const k2 = model.encode(s);
      const succ = model.successors(key).filter((x) => !x.won);
      expect(
        succ.some((x) => x.next.every((w, j) => w === k2[j])),
        `${level.id} coup ${i}`,
      ).toBe(true);
      if (s.keys > s.objects.filter((o) => o === 'door').length) surplus++;
      transitions++;
      key = k2;
    }
  }
  expect(transitions).toBeGreaterThan(500);
  expect(surplus).toBeGreaterThan(20);
});

test('codec: start key', () => {
  const level = fromAscii(['@kB~E', '#D###', '#k###'], { initialKeys: -2 });
  const model = new CompactModel(level);
  const s0 = initialState(level);
  const key = model.encode(s0);
  expect(key.length).toBe(model.words);
  const back = model.decode(key);
  expect(back.player).toEqual({ x: 0, y: 0 });
  expect(back.keys).toBe(-2);
  expect(back.objects).toEqual(s0.objects);
  expect(back.terrain).toEqual(s0.terrain);
});

test('block candidate tiles: only those a block can reach', () => {
  // walls above and below, gravel on the left: its own tile, 2 tiles to the right and the water
  const level = fromAscii(['#######', '@,B..~E', '#######']);
  const model = new CompactModel(level);
  expect(model.blockCells).toBe(4);
});

test('direct expansion identical to step() on random levels', () => {
  const rnd = mulberry32(7);
  let checked = 0;
  let onWater = 0;
  for (let n = 0; n < 400; n++) {
    const level = validRandomLevel(rnd, n);
    if (level.terrain[level.start.y * level.width + level.start.x] === 'water') onWater++;
    checked += compareOn(level, 150);
  }
  expect(checked).toBeGreaterThan(5000);
  expect(onWater).toBeGreaterThan(20);
});

test('direct expansion identical to step(): key on the exit, block on gravel, start on the exit', () => {
  const blockOnGravel: LevelData = {
    ...fromAscii(['@.B..', '.~..E', '.,...']),
    objects: [
      { x: 2, y: 0, kind: 'block' },
      { x: 1, y: 2, kind: 'block' },
      { x: 3, y: 2, kind: 'key' },
    ],
    terrain: fromAscii(['@,,..', '.~..E', '.,...']).terrain,
  };
  expect(compareOn(blockOnGravel, 500)).toBeGreaterThan(3);
  const startOnExit: LevelData = { ...fromAscii(['@.kD.E']), start: { x: 5, y: 0 } };
  expect(compareOn(startOnExit, 500)).toBeGreaterThan(0);
});
