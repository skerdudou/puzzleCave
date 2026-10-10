import { expect, test } from 'vitest';
import { fromAscii } from './ascii';
import { CompactModel } from './compactModel';
import { DeadlockAnalysis } from './deadlock';
import { findSolution } from './improve/findSolution';
import { replay } from './replay';
import { solve } from './solver';
import { initialState } from './state';
import { step } from './step';
import { mulberry32, sampleLevels, validRandomLevel } from './testLevels';
import type { Dir, GameState, LevelData } from './types';

const at = (level: LevelData, x: number, y: number) => y * level.width + x;

function deadAt(level: LevelData, s: GameState = initialState(level)) {
  const model = new CompactModel(level);
  const a = new DeadlockAnalysis(model);
  model.load(model.encode(s));
  return { dead: a.dead(), reason: a.lastReason, a };
}

function play(level: LevelData, moves: string): GameState {
  const L: Record<string, Dir> = { U: 'up', D: 'down', L: 'left', R: 'right' };
  let s = initialState(level);
  for (const ch of moves) s = step(s, L[ch]!).state;
  return s;
}

test('static analysis: block reach, fillers, immovable cells, exit entrances', () => {
  const level = fromAscii(['#####', '#@B~E', '#.,.#', '#####']);
  const a = new DeadlockAnalysis(new CompactModel(level));
  // the block at (2,1) can go right into the water, not down onto gravel; left too, with the
  // player on the water once filled (relaxed)
  expect(a.blockReach(at(level, 2, 1))).toEqual([
    at(level, 1, 1),
    at(level, 2, 1),
    at(level, 3, 1),
  ]);
  expect(a.canFill(at(level, 2, 1), at(level, 3, 1))).toBe(true);
  expect(a.fillers(at(level, 3, 1))).toEqual([at(level, 2, 1)]);
  // corner (1,2): walls left and below
  expect(a.immovable[at(level, 1, 2)]).toBe(1);
  expect(a.entrances).toEqual([{ cell: at(level, 3, 1), waters: [at(level, 3, 1)], doors: [] }]);
});

test('dead: no block can fill the water on the only route', () => {
  expect(deadAt(fromAscii(['@.~E'])).reason).toBe('blocks');
  expect(deadAt(fromAscii(['@B~E'])).dead).toBe(false);
  // a block in a corner cannot fill anything
  expect(deadAt(fromAscii(['B#..', '.@~E', '####'])).reason).toBe('blocks');
  // two waters on the route, two blocks, but the one below the wall cannot reach them
  expect(deadAt(fromAscii(['@B.~~E', '######', '#..B..'])).reason).toBe('required-water');
});

test('dead: a block standing on gravel can still be pushed off it', () => {
  const s0 = initialState(fromAscii(['@,~E']));
  const objects = s0.objects.slice();
  objects[1] = 'block';
  const s = { ...s0, objects };
  const model = new CompactModel(s);
  const a = new DeadlockAnalysis(model);
  model.load(model.encode(s));
  expect(a.dead()).toBe(false);
});

test('dead: one block for two waters on every route', () => {
  expect(deadAt(fromAscii(['@B.~~E'])).reason).toBe('blocks');
  expect(deadAt(fromAscii(['@BB.~~E'])).dead).toBe(false);
});

test('dead: wasting the only block in another water', () => {
  // the block can fill (2,0) (useless) or go right to the water (4,1) on the route
  const level = fromAscii(['..~..#', '@B..~E', '....##']);
  expect(deadAt(level).dead).toBe(false);
  // push the block up to (1,0)? not possible (player below needed): push it right then up
  const wasted = play(level, 'RDRUU');
  expect(wasted.terrain[at(level, 2, 0)]).toBe('floor');
  expect(deadAt(level, wasted).reason).toBe('blocks');
});

test('dead: not enough keys for the doors, key debt included', () => {
  expect(deadAt(fromAscii(['@.DE'])).reason).toBe('keys');
  expect(deadAt(fromAscii(['@kDE'])).dead).toBe(false);
  expect(deadAt(fromAscii(['@kDE'], { initialKeys: -1 })).reason).toBe('keys');
  expect(deadAt(fromAscii(['@kkDDE'], { initialKeys: -1 })).reason).toBe('keys');
  expect(deadAt(fromAscii(['@kkkDDE'], { initialKeys: -1 })).dead).toBe(false);
  // two routes: one through two doors, one through one door
  expect(deadAt(fromAscii(['@kDDE', '.###.', '..D..'])).dead).toBe(false);
  expect(deadAt(fromAscii(['@.DDE', '.###.', '..D..'])).reason).toBe('keys');
});

test('dead: an immovable block closes the route', () => {
  // block at (1,0) between walls: cannot be pushed (gravel to the right of it is not a target)
  expect(deadAt(fromAscii(['@,B,E'])).reason).toBe('no-route');
});

/**
 * Exhaustive macro-state graph of a small level: every reachable macro-state and whether it can
 * still win. Returns undefined beyond `cap` states.
 */
function winnable(level: LevelData, cap: number) {
  const model = new CompactModel(level);
  const ids = new Map<string, number>();
  const keys: Uint32Array[] = [];
  const succ: number[][] = [];
  const win: boolean[] = [];
  const add = (k: Uint32Array) => {
    const s = k.join(',');
    let id = ids.get(s);
    if (id === undefined) {
      id = keys.length;
      ids.set(s, id);
      keys.push(k);
      succ.push([]);
      win.push(false);
    }
    return id;
  };
  add(model.encode(model.start));
  for (let i = 0; i < keys.length; i++) {
    if (keys.length > cap) return undefined;
    for (const s of model.successors(keys[i]!)) {
      if (s.won) win[i] = true;
      else succ[i]!.push(add(Uint32Array.from(s.next)));
    }
  }
  // backward fixed point
  let changed = true;
  while (changed) {
    changed = false;
    for (let i = 0; i < keys.length; i++)
      if (!win[i] && succ[i]!.some((j) => win[j])) {
        win[i] = true;
        changed = true;
      }
  }
  return { model, keys, win };
}

test('property: no winnable state is declared dead; dead states are found (random levels)', () => {
  const levels = [...sampleLevels()];
  const rnd = mulberry32(77);
  for (let i = 0; i < 2000; i++) levels.push(validRandomLevel(rnd, i));
  let states = 0;
  let deadFound = 0;
  let losing = 0;
  let checked = 0;
  for (const level of levels) {
    const g = winnable(level, 20_000);
    if (!g) continue;
    checked++;
    const a = new DeadlockAnalysis(g.model);
    g.keys.forEach((k, i) => {
      g.model.load(k);
      const dead = a.dead();
      states++;
      if (g.win[i]) expect(dead, `${level.id} state ${i} (${a.lastReason})`).toBe(false);
      else {
        losing++;
        if (dead) deadFound++;
      }
    });
  }
  expect(checked).toBeGreaterThan(2000);
  expect(states).toBeGreaterThan(50_000);
  // the test must also find something
  expect(deadFound).toBeGreaterThan(0.5 * losing);
});

test('property: solve and findSolution with dead-state pruning keep their results', () => {
  const levels = [...sampleLevels()];
  const rnd = mulberry32(5);
  for (let i = 0; i < 300; i++) levels.push(validRandomLevel(rnd, i));
  let solved = 0;
  for (const level of levels) {
    const plain = solve(level, { timeoutMs: 60_000 });
    const pruned = solve(level, { timeoutMs: 60_000, deadPruning: true });
    expect(pruned.status, level.id).toBe(plain.status);
    if (plain.status === 'solved' && pruned.status === 'solved') {
      solved++;
      expect(pruned.moves.length, level.id).toBe(plain.moves.length);
      expect(pruned.explored).toBeLessThanOrEqual(plain.explored);
      expect(replay(level, pruned.moves).status).toBe('won');
    }
    // same status as without pruning (the guide's own DEAD test misses a few solvable levels)
    const base = findSolution(level, { maxStates: 1e6, timeoutMs: 60_000 });
    const found = findSolution(level, { maxStates: 1e6, timeoutMs: 60_000, deadPruning: true });
    expect(found.status, level.id).toBe(base.status);
    if (found.status === 'solved') expect(replay(level, found.moves).status).toBe('won');
    // key dominance keeps completeness
    const dom = findSolution(level, {
      maxStates: 1e6,
      timeoutMs: 60_000,
      deadPruning: true,
      keyDominance: true,
    });
    expect(dom.status, level.id).toBe(base.status);
    if (dom.status === 'solved') expect(replay(level, dom.moves).status).toBe('won');
    if (found.status === 'solved') expect(replay(level, found.moves).status).toBe('won');
  }
  expect(solved).toBeGreaterThan(300);
});
