import { expect, test } from 'vitest';
import { fromAscii } from '../ascii';
import { KEY, WATER } from '../compactModel';
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
