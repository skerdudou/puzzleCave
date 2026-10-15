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
  structuralPass,
  type CandidateOutcome,
  type CandidateRunner,
  type Unit,
} from './explore';

// keys on both sides of the start, exit on the left: the given solution takes the left key
// first (2 + 6 + 8 = 16 moves); the right key first is shorter (4 + 6 + 2 = 12)
const CORRIDOR = fromAscii(['E.k.@...k']);
const LEFT_FIRST = parseMoves('LLRRRRRRLLLLLLLL');
// the same with two doors before the exit, so that both keys are needed: left key first
// 2 + 6 + 9 = 17 moves, right key first 4 + 6 + 3 = 13
const DOORS = fromAscii(['EDDk.@...k']);
const DOORS_LEFT = parseMoves('LLRRRRRRLLLLLLLLL');

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
  const m = segmentSolution(DOORS, DOORS_LEFT);
  const rb = new Rebuilder(m);
  const base = baseOrder(m);
  expect(rb.rebuild(base)).toEqual({ moves: DOORS_LEFT });
  const swapped = [base[1]!, base[0]!, ...base.slice(2)];
  const r = rb.rebuild(swapped);
  expect('moves' in r && r.moves.length).toBe(13);
  expect(rb.rebuild(swapped, 12)).toEqual({ failed: 'bound' });
  const sc = screenVariants(m, {
    variants: 200,
    timeoutMs: 10_000,
    keep: 3,
    exclude: [DOORS_LEFT],
  });
  expect(sc.base).toEqual(DOORS_LEFT);
  expect(sc.kept[0]!.moves).toHaveLength(13);
  expect(replay(DOORS, sc.kept[0]!.moves).status).toBe('won');
  // the given solution itself is never kept
  expect(sc.kept.every((v) => v.moves.join('') !== DOORS_LEFT.join(''))).toBe(true);
});

test('exploreLevel returns the shortest solution seen after improving the best variants', async () => {
  const calls: number[] = [];
  const r = await exploreLevel(DOORS, DOORS_LEFT, {
    timeoutMs: 5_000,
    variants: 100,
    improveTop: 2,
    passFraction: 0,
    improve: (_level, moves) => {
      calls.push(moves.length);
      return moves;
    },
  });
  expect(r.initialLength).toBe(17);
  expect(r.baseLength).toBe(17);
  expect(r.bestScreened).toBe(13);
  expect(r.passGains).toEqual([]);
  expect(calls[0]).toBe(13);
  expect(r.moves).toHaveLength(13);
  expect(replay(DOORS, r.moves).status).toBe('won');
});

test('exploreLevel: the structural pass comes first and its result is improved', async () => {
  const calls: number[] = [];
  const r = await exploreLevel(DOORS, DOORS_LEFT, {
    timeoutMs: 5_000,
    variants: 100,
    improveTop: 1,
    improve: (_level, moves) => {
      calls.push(moves.length);
      return moves;
    },
  });
  // dropping the left key's stage: the walk back to the doors takes it on the way
  expect(r.passGains[0]).toMatchObject({ round: 1, before: 17, after: 13 });
  expect(r.passGains[0]!.what).toMatch(/^drop key 3,0/);
  expect(calls[0]).toBe(13);
  expect(r.moves).toHaveLength(13);
  expect(replay(DOORS, r.moves).status).toBe('won');
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

test('mutate keeps every segment at most once and the exit last; dropped stages come back', () => {
  const m = segmentSolution(CORRIDOR, LEFT_FIRST);
  const rnd = prng(7);
  let order: Unit[] = baseOrder(m);
  let dropped = 0;
  let restored = 0;
  for (let i = 0; i < 500; i++) {
    const before = order.flatMap((u) => u.segs).length;
    order = mutate(m, order, rnd) ?? order;
    const segs = order.flatMap((u) => u.segs).sort();
    if (segs.length < before) dropped++;
    if (segs.length > before) restored++;
    expect(new Set(segs).size).toBe(segs.length);
    expect(segs.every((i) => i >= 0 && i <= 2)).toBe(true);
    expect(order.at(-1)!.segs).toEqual([2]);
  }
  expect(dropped).toBeGreaterThan(0);
  expect(restored).toBeGreaterThan(0);
});

// twelve keys right of the start, exit on its left: 13 stages
const KEYS = fromAscii(['E@kkkkkkkkkkkk']);
const KEYS_SOL = parseMoves('R'.repeat(12) + 'L'.repeat(13));

test('mutate moves a stage, or a chain of stages, further than 8 places', () => {
  const m = segmentSolution(KEYS, KEYS_SOL);
  expect(m.segments).toHaveLength(13);
  const base = baseOrder(m);
  const rnd = prng(3);
  let far = 0;
  let chains = 0;
  for (let i = 0; i < 200; i++) {
    const o = mutate(m, base, rnd, 'move');
    if (o) {
      const moved = o.findIndex((u, j) => u.segs[0] !== j);
      const unit = o[moved]!.segs[0]!;
      const to = o.findIndex((u) => u.segs[0] === unit);
      // the first displaced unit is either the moved one or its neighbour shifted by one
      if (Math.abs(unit - to) > 8 || Math.abs(o[moved]!.segs[0]! - moved) > 8) far++;
    }
    const c = mutate(m, base, rnd, 'moveChain');
    if (c) {
      chains++;
      expect(c.flatMap((u) => u.segs).sort((a, b) => a - b)).toEqual(base.map((_, j) => j));
      expect(c.at(-1)!.segs).toEqual([12]);
    }
  }
  expect(far).toBeGreaterThan(0);
  expect(chains).toBeGreaterThan(0);
});

test('a stage stopped by its cap is retried with a larger cap when asked', () => {
  const sol = parseMoves('RRDURRRR');
  const m = segmentSolution(TWICE, sol);
  const capped = new Rebuilder(m, { maxStates: 1, maxStatesLimit: 1 });
  expect(capped.rebuild(baseOrder(m), Infinity, true)).toHaveProperty('failed');
  const rb = new Rebuilder(m, { maxStates: 1, maxStatesLimit: 10_000 });
  expect(rb.rebuild(baseOrder(m))).toHaveProperty('failed');
  expect(rb.retries).toBe(0);
  expect(rb.rebuild(baseOrder(m), Infinity, true)).toEqual({ moves: sol });
  expect(rb.retries).toBeGreaterThan(0);
});

test('structural pass: a useless fill is dropped', async () => {
  // the given solution sinks the block in (2,1) before walking to the exit
  const level = fromAscii(['@....E', '.B~...']);
  const sol = parseMoves('DRURRRR');
  expect(replay(level, sol).status).toBe('won');
  const r = await structuralPass(level, sol, { timeoutMs: 10_000 });
  expect(r.moves).toHaveLength(5);
  expect(r.gains).toEqual([{ what: 'drop water 2,1', before: 7, after: 5 }]);
  expect(r.exhausted).toBe(true);
  // with a shared tried set, candidates already rebuilt are skipped: each pass stops at its
  // first gain, so the next ones try the merge of [water, exit] with ¼, ½ and all the merge
  // limits (widening levels), then nothing is left
  const tried = new Set<string>();
  const counts: number[] = [];
  for (let i = 0; i < 5; i++)
    counts.push((await structuralPass(level, sol, { timeoutMs: 10_000, tried })).tried);
  expect(counts).toEqual([1, 1, 1, 1, 0]);
});

test('structural pass: a merged window frees a neighbour block that fills the water sooner', async () => {
  // the given solution brings the far block (3,4) up to fill (4,2) (16 moves); the block (3,1),
  // never pushed, does it in 10 moves, which only a wide search of [water, exit] can see
  const level = fromAscii(['@...#..', '...B#..', '....~.E', '....#..', '...B#..', '....#..']);
  const sol = parseMoves('DDDDDRRRUULURRRR');
  expect(replay(level, sol).status).toBe('won');
  const m = segmentSolution(level, sol);
  // reorders and pins alone cannot do it
  const sc = screenVariants(m, { variants: 300, timeoutMs: 10_000, keep: 2, exclude: [sol] });
  expect(sc.kept.every((v) => v.moves.length >= 16)).toBe(true);
  const r = await structuralPass(level, sol, { timeoutMs: 10_000, window: 2, neighbours: 1 });
  expect(r.moves).toHaveLength(10);
  expect(replay(level, r.moves).status).toBe('won');
  expect(r.gains[0]!.what).toBe(
    'merge water 4,2 + exit -player -at [wide +3,1 doors optional limits ×0.25]',
  );
  // without neighbours, nothing; widening the pass adds them
  const none = await structuralPass(level, sol, { timeoutMs: 10_000, neighbours: 0, widen: 0 });
  expect(none.moves).toHaveLength(16);
  expect(none.exhausted).toBe(true);
  const widened = await structuralPass(level, sol, { timeoutMs: 10_000, neighbours: 0, widen: 1 });
  expect(widened.moves).toHaveLength(10);
});

/**
 * a runner rebuilding `width` candidates "at once": each result arrives after a delay that
 * decreases with its rank, so later candidates finish first
 */
function shuffledRunner(level: Parameters<typeof segmentSolution>[0], width: number) {
  let rb: Rebuilder | undefined;
  let n = 0;
  const cancelled: number[] = [];
  const runner: CandidateRunner = {
    width,
    reset: (sol) => (rb = new Rebuilder(segmentSolution(level, sol))),
    run(order, bound) {
      const id = n++;
      const out = rb!.rebuild(order, bound, true);
      let cancel = () => {};
      const result = new Promise<CandidateOutcome>((resolve) => {
        const timer = setTimeout(() => resolve(out), 2 * (width - (id % width)));
        cancel = () => {
          clearTimeout(timer);
          cancelled.push(id);
          resolve({ failed: 'cancelled' });
        };
      });
      return { result, cancel };
    },
    stats: () => ({ searches: rb?.searches ?? 0, retries: rb?.retries ?? 0 }),
  };
  return { runner, cancelled };
}

test('structural pass on a wider runner: same gains and tried set, later candidates cancelled', async () => {
  // a useless fill, a merged window that frees a neighbour block, a reorder of the keys
  const cases = [
    [fromAscii(['@....E', '.B~...']), parseMoves('DRURRRR'), {}],
    [
      fromAscii(['@...#..', '...B#..', '....~.E', '....#..', '...B#..', '....#..']),
      parseMoves('DDDDDRRRUULURRRR'),
      { window: 2, neighbours: 1 },
    ],
    [DOORS, DOORS_LEFT, {}],
  ] as const;
  let cancels = 0;
  for (const [level, sol, o] of cases) {
    const triedSeq = new Set<string>();
    const seq = await structuralPass(level, sol, { timeoutMs: 10_000, ...o, tried: triedSeq });
    for (const width of [2, 5]) {
      const { runner, cancelled } = shuffledRunner(level, width);
      const tried = new Set<string>();
      const par = await structuralPass(level, sol, { timeoutMs: 10_000, ...o, tried, runner });
      expect(par.moves).toEqual(seq.moves);
      expect(par.gains).toEqual(seq.gains);
      expect(par.tried).toBe(seq.tried);
      expect(par.exhausted).toBe(seq.exhausted);
      expect([...tried].sort()).toEqual([...triedSeq].sort());
      cancels += cancelled.length;
    }
  }
  expect(cancels).toBeGreaterThan(0);
});
