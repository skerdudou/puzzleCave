import { expect, test } from 'vitest';
import { fromAscii } from '../ascii';
import { parseMoves, replay } from '../replay';
import {
  Rebuilder,
  baseOrder,
  exploreLevel,
  mutate,
  prng,
  screenVariants,
  segmentSolution,
  type Unit,
} from './explore';

// keys on both sides of the start, exit on the left: the given solution takes the left key
// first (2 + 6 + 8 = 16 moves); the right key first is shorter (4 + 6 + 2 = 12)
const CORRIDOR = fromAscii(['E.k.@...k']);
const LEFT_FIRST = parseMoves('LLRRRRRRLLLLLLLL');

test('segmentSolution: one segment per event, with its pins', () => {
  const m = segmentSolution(CORRIDOR, LEFT_FIRST);
  expect(m.segments.map((s) => [s.keys, s.exit, s.endPlayer, s.length])).toEqual([
    [[2], false, 2, 2],
    [[8], false, 8, 6],
    [[], true, 0, 8],
  ]);
  expect(() => segmentSolution(CORRIDOR, parseMoves('LL'))).toThrow(/does not win/);
});

test('reordering the stages gives a shorter solution than the given one', () => {
  const m = segmentSolution(CORRIDOR, LEFT_FIRST);
  const rb = new Rebuilder(m);
  const base = baseOrder(m);
  expect(rb.rebuild(base)).toEqual({ moves: LEFT_FIRST });
  const swapped = [base[1]!, base[0]!, base[2]!];
  const r = rb.rebuild(swapped);
  expect('moves' in r && r.moves.length).toBe(12);
  expect(rb.rebuild(swapped, 11)).toEqual({ failed: 'bound' });
  const sc = screenVariants(m, {
    variants: 200,
    timeoutMs: 10_000,
    keep: 3,
    exclude: [LEFT_FIRST],
  });
  expect(sc.base).toEqual(LEFT_FIRST);
  expect(sc.kept[0]!.moves).toHaveLength(12);
  expect(replay(CORRIDOR, sc.kept[0]!.moves).status).toBe('won');
  // the given solution itself is never kept
  expect(sc.kept.every((v) => v.moves.join('') !== LEFT_FIRST.join(''))).toBe(true);
});

test('exploreLevel returns the shortest solution seen after improving the best variants', () => {
  const calls: number[] = [];
  const r = exploreLevel(CORRIDOR, LEFT_FIRST, {
    timeoutMs: 5_000,
    variants: 100,
    improveTop: 2,
    improve: (_level, moves) => {
      calls.push(moves.length);
      return moves;
    },
  });
  expect(r.initialLength).toBe(16);
  expect(r.baseLength).toBe(16);
  expect(r.bestScreened).toBe(12);
  expect(calls[0]).toBe(12);
  expect(r.moves).toHaveLength(12);
  expect(replay(CORRIDOR, r.moves).status).toBe('won');
});

// the block is pushed twice, a key taken in between: the second stage finds the block by its
// identity on the cell the first stage left it on
const TWICE = fromAscii(['@B...~E', '..k....']);

test('blocks are followed by identity across stages; a block that sank is no longer free', () => {
  const sol = parseMoves('RRDURRRR');
  expect(replay(TWICE, sol).status).toBe('won');
  const m = segmentSolution(TWICE, sol);
  expect(m.segments.map((s) => [s.keys, s.waters, s.ids])).toEqual([
    [[9], [], [0]],
    [[], [5], [0]],
    [[], [], []],
  ]);
  const rb = new Rebuilder(m);
  expect(rb.rebuild(baseOrder(m))).toEqual({ moves: sol });
  // water first, then the key (its block has sunk: nothing to move), then the exit
  const order = baseOrder(m);
  const r = rb.rebuild([order[1]!, order[0]!, order[2]!]);
  // 4 pushes, 4 moves to the key and back towards the exit, 4 to the exit
  expect('moves' in r && r.moves.length).toBe(12);
  expect('moves' in r && replay(TWICE, r.moves).status).toBe('won');
  // an extra fill whose block has sunk fails
  const x: Unit = { segs: [], pinPlayer: false, pinAt: false, extra: { water: 5, block: 0 } };
  expect(rb.rebuild([order[1]!, x, order[0]!, order[2]!])).toMatchObject({
    failed: expect.stringMatching(/sunk/),
  });
});

test('extra water: a block the solution never pushes fills a water on the way', () => {
  // the exit is reached through a detour (12 moves); filling (2,0) with the block (2,1), pushed
  // up from (2,2), opens a shortcut (10 moves)
  const level = fromAscii(['@.~...E', '#.B#.##', '#..#.##', '#....##']);
  const sol = parseMoves('RDDDRRRUUURR');
  const m = segmentSolution(level, sol);
  expect(m.extras).toEqual([{ water: 2, block: 0 }]);
  const plan = mutate(m, baseOrder(m), prng(1), 'addWater')!;
  expect(plan.map((u) => u.extra ?? u.segs)).toEqual([{ water: 2, block: 0 }, [0]]);
  const r = new Rebuilder(m).rebuild(plan);
  expect('moves' in r && r.moves.length).toBe(10);
  const sc = screenVariants(m, { variants: 100, timeoutMs: 10_000, keep: 2, exclude: [sol] });
  expect(sc.kept[0]!.moves).toHaveLength(10);
});

test('mutate keeps every segment exactly once and the exit last', () => {
  const m = segmentSolution(CORRIDOR, LEFT_FIRST);
  // a larger plan: repeat the corridor's segments through fake extras
  const rnd = prng(7);
  let order: Unit[] = baseOrder(m);
  for (let i = 0; i < 500; i++) {
    order = mutate(m, order, rnd) ?? order;
    const segs = order.flatMap((u) => u.segs).sort();
    expect(segs).toEqual([0, 1, 2]);
    expect(order.at(-1)!.segs).toContain(2);
    expect(order.at(-1)!.segs).toHaveLength(1);
  }
});
