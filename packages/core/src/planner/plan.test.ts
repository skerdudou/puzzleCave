import { expect, test } from 'vitest';
import { fromAscii } from '../ascii';
import { BLOCK, KEY, WATER } from '../compactModel';
import { replay } from '../replay';
import { solve } from '../solver';
import { initialState } from '../state';
import { sampleLevels } from '../testLevels';
import { planSolution } from './plan';
import { reachSubgoal, restrict } from './subgoal';

const cell = (w: number, x: number, y: number) => y * w + x;

test('restrict: frozen blocks and doors, forbidden waters become walls', () => {
  const level = fromAscii(['@B~D.', 'B.~.E']);
  const s = initialState(level);
  const r = restrict(s, { free: [cell(5, 1, 0)], waters: [cell(5, 2, 0)] });
  expect(r.objects[cell(5, 1, 0)]).toBe('block');
  expect(r.terrain[cell(5, 0, 1)]).toBe('wall');
  expect(r.objects[cell(5, 0, 1)]).toBe(null);
  expect(r.terrain[cell(5, 3, 0)]).toBe('wall');
  expect(r.terrain[cell(5, 2, 0)]).toBe('water');
  expect(r.terrain[cell(5, 2, 1)]).toBe('wall');
  expect(restrict(s, { waters: 'all' }).terrain[cell(5, 2, 1)]).toBe('water');
});

test('reachSubgoal: shortest moves to the goal, replayed on the real state', () => {
  // the frozen block (1,1) is not touched; the free one fills the water
  const level = fromAscii(['@B.~.', '.B...', '.....']);
  const s = initialState(level);
  const w = cell(5, 3, 0);
  const r = reachSubgoal(s, { free: [cell(5, 1, 0)], waters: [w] }, (m) => m.grid[w] !== WATER);
  expect(r.ok).toBe(true);
  if (!r.ok) return;
  expect(r.moves).toEqual(['right', 'right']);
  expect(r.state.terrain[w]).toBe('floor');
  expect(r.state.objects[cell(5, 1, 1)]).toBe('block');
});

test('reachSubgoal: reports the frozen blocks the player could push', () => {
  const level = fromAscii(['@B.k']);
  const k = 3;
  const r = reachSubgoal(initialState(level), {}, (m) => m.grid[k] !== KEY);
  expect(r).toMatchObject({ ok: false, touched: [1], full: false });
  expect(reachSubgoal(initialState(level), { free: [1] }, (m) => m.grid[k] !== KEY).ok).toBe(
    false, // the block would have to go onto the key: impossible
  );
  const r2 = reachSubgoal(
    initialState(fromAscii(['@B..k', '.....'])),
    { free: [1] },
    (m) => m.grid[4] !== KEY,
  );
  expect(r2.ok).toBe(true);
});

test('reachSubgoal: win goal', () => {
  const level = fromAscii(['@kDE']);
  const r = reachSubgoal(initialState(level), { doors: [2] }, () => false, { win: true });
  expect(r.ok && r.state.status).toBe('won');
});

const LEVELS: Record<string, string[]> = {
  corridor: ['@..E'],
  keyDoorBlock: ['@kB~E', '#D###', '#.###'],
  detour: ['k....@.DE', '#####.###', '#####k###'],
  water: ['@B.B.B.~~E', 'B.B.B.B~~.', '.B.B.B.~~.', 'B.B.B.B...'],
  // a key behind water, then a door
  chain: ['@.B.~k', '###..#', 'E.D..#'],
};

test.each(Object.entries(LEVELS))('planSolution solves %s, plan replays', (_, rows) => {
  const level = fromAscii(rows);
  for (const keys of ['explicit', 'auto'] as const) {
    const r = planSolution(level, { timeoutMs: 10_000, keys });
    expect(r.status).toBe('solved');
    if (r.status === 'solved') expect(replay(level, r.moves).status).toBe('won');
  }
});

test('planSolution fails cleanly on an unsolvable level', () => {
  expect(planSolution(fromAscii(['@#E']), { timeoutMs: 1000 })).toMatchObject({
    status: 'failed',
    reason: 'exhausted',
  });
});

test('property: on the random sample, every plan found wins, on solvable levels only', () => {
  let solved = 0;
  let solvable = 0;
  for (const level of sampleLevels()) {
    const exact = solve(level, { timeoutMs: 60_000 });
    const r = planSolution(level, { timeoutMs: 10_000 });
    if (exact.status === 'solved') solvable++;
    if (r.status !== 'solved') continue;
    solved++;
    expect(exact.status, level.id).toBe('solved');
    expect(replay(level, r.moves).status, level.id).toBe('won');
  }
  // incomplete by design (few unfrozen blocks per event), but almost every small level passes
  expect(solved).toBeGreaterThan(0.95 * solvable);
});

test('restrict: keys not allowed become walls', () => {
  const s = initialState(fromAscii(['@k.k.E']));
  const r = restrict(s, { keys: [3] });
  expect(r.terrain[1]).toBe('wall');
  expect(r.objects[3]).toBe('key');
  expect(restrict(s, {}).objects[1]).toBe('key');
});

test('reachSubgoal: alternatives are goal states with different boards, cheapest first', () => {
  const s = initialState(fromAscii(['@B...']));
  const r = reachSubgoal(s, { free: [1] }, (m) => m.grid[1] !== BLOCK, { alternatives: 3 });
  expect(r.ok).toBe(true);
  if (!r.ok) return;
  const all = [r, ...(r.more ?? [])];
  expect(all.map((x) => x.state.objects.indexOf('block'))).toEqual([2, 3, 4]);
  expect(all.map((x) => x.moves.length)).toEqual([1, 2, 3]);
  // one goal state by default
  expect(reachSubgoal(s, { free: [1] }, (m) => m.grid[1] !== BLOCK)).not.toHaveProperty('more');
});

test('planSolution: widening raises the caps of a state an event was capped on', () => {
  const level = fromAscii(LEVELS.water!);
  // two macro-states per restricted search: every event is capped at level 0
  const capped = planSolution(level, { timeoutMs: 10_000, maxSubStates: 2, widen: 0 });
  expect(capped).toMatchObject({ status: 'failed', reason: 'exhausted', widened: 0 });
  const widened = planSolution(level, { timeoutMs: 10_000, maxSubStates: 2, widen: 4 });
  expect(widened.status).toBe('solved');
  expect(widened.widened).toBeGreaterThan(0);
  if (widened.status === 'solved') expect(replay(level, widened.moves).status).toBe('won');
});

test('planSolution: statistics per event kind', () => {
  const r = planSolution(fromAscii(LEVELS.chain!), { timeoutMs: 10_000 });
  expect(r.status).toBe('solved');
  expect(r.kinds.exit.realised).toBe(1);
  expect(r.kinds.fill.realised + r.kinds.key.realised).toBeGreaterThan(0);
  const total = Object.values(r.kinds).reduce((a, k) => a + k.searches, 0);
  expect(total).toBe(r.subSearches);
});

test.each([
  ['alternatives', { alternatives: 3 }],
  ['side keys', { sideKeys: true }],
  ['no prechecks', { prechecks: false }],
  ['no widening', { widen: 0 }],
  ['every door at once', { allDoorsLevel: 0 }],
])('planSolution with %s: the small levels are solved, plans replay', (_, o) => {
  for (const rows of Object.values(LEVELS)) {
    const level = fromAscii(rows);
    const r = planSolution(level, { timeoutMs: 10_000, ...o });
    expect(r.status, rows.join('/')).toBe('solved');
    if (r.status === 'solved') expect(replay(level, r.moves).status).toBe('won');
  }
});
