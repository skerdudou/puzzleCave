import { expect, test } from 'vitest';
import { fromAscii } from '../ascii';
import { replay } from '../replay';
import { solve } from '../solver';
import { deriveStages, formatStages, parseStages, runStages } from './stages';

// a key behind water, then a door: fill (4,0) with the block (2,0), take (5,0), open (2,2)
const CHAIN = fromAscii(['@.B.~k', '###..#', 'E.D..#']);
const W = CHAIN.width;
const H = CHAIN.height;

test('parseStages: clauses, comments, round trip through formatStages', () => {
  const text = [
    '# comment line',
    '',
    'water 4,0 blocks 2,0   # fill',
    'key 5,0 reach 3,1 waters all max 500',
    'door 2,2 at 1,0 player 2,2 doors 2,2 waters 4,0',
    'exit',
  ].join('\n');
  const stages = parseStages(text, W, H);
  expect(stages).toHaveLength(4);
  expect(stages[0]).toMatchObject({ waters: [4], blocks: [2], line: 3, comment: 'fill' });
  expect(stages[1]).toMatchObject({ keys: [5], reach: [9], allowWaters: 'all', maxStates: 500 });
  expect(stages[2]).toMatchObject({
    doors: [14],
    at: [1],
    player: [14],
    allowDoors: [14],
    allowWaters: [4],
  });
  expect(stages[3]).toMatchObject({ exit: true });
  const again = parseStages(formatStages(stages, W), W, H);
  expect(again.map(({ line: _, ...s }) => s)).toEqual(stages.map(({ line: _, ...s }) => s));
});

test.each([
  ['blocks 2,0', /no goal/],
  ['exit key 5,0', /cannot be combined/],
  ['key 9,0', /outside the 6×3 map/],
  ['key 5,0 waters all 4,0', /waters all/],
  ['key 5,0 player 1,0 2,0', /one cell/],
  ['key 5,0 blocks', /needs cells/],
  ['key 5,0 max x', /bad "max"/],
  ['key 5-0', /unexpected/],
  ['2,0 key 5,0', /outside a clause/],
])('parseStages rejects "%s"', (line, err) => {
  expect(() => parseStages(`# ok\n${line}`, W, H)).toThrow(/^line 2: /);
  expect(() => parseStages(line, W, H)).toThrow(err);
});

test('runStages: hand-written stages win, with per-stage move counts', () => {
  const stages = parseStages('water 4,0 blocks 2,0\nkey 5,0\ndoor 2,2\nexit', W, H);
  const r = runStages(CHAIN, stages);
  expect(r.status).toBe('won');
  if (r.status !== 'won') return;
  expect(r.stages.map((s) => s.moves)).toEqual([3, 2, 5, 2]);
  expect(replay(CHAIN, r.moves).status).toBe('won');
});

test('runStages: a stage already satisfied costs nothing', () => {
  const stages = parseStages('water 4,0 blocks 2,0\nreach 3,0\nkey 5,0\ndoor 2,2\nexit', W, H);
  const r = runStages(CHAIN, stages);
  expect(r.status === 'won' && r.stages[1]!.moves).toBe(0);
});

test('runStages: the failing stage and why', () => {
  // the block is frozen: unreachable, and the hint names it
  const frozen = runStages(CHAIN, parseStages('key 5,0\nexit', W, H));
  expect(frozen).toMatchObject({ status: 'failed', index: 1, line: 1, moves: [] });
  if (frozen.status === 'failed') {
    expect(frozen.reason).toMatch(/^unreachable/);
    expect(frozen.reason).toMatch(/could push: 2,0$/);
  }
  // the door is not allowed in the exit stage: the stage before succeeded
  const door = runStages(CHAIN, parseStages('water 4,0 blocks 2,0\nkey 5,0\nexit', W, H));
  expect(door).toMatchObject({ status: 'failed', index: 3, line: 3 });
  expect(door.moves).toHaveLength(5);
  // state limit
  const tiny = runStages(CHAIN, parseStages('water 4,0 blocks 2,0 max 1', W, H));
  expect(tiny.status === 'failed' && tiny.reason).toMatch(/^state limit reached/);
  // wrong cells
  expect(runStages(CHAIN, parseStages('water 4,0 blocks 3,0', W, H))).toMatchObject({
    status: 'failed',
    reason: 'no block at (3,0)',
  });
  expect(runStages(CHAIN, parseStages('key 4,0', W, H))).toMatchObject({
    reason: 'no key at (4,0) in the level',
  });
  // no exit stage
  expect(runStages(CHAIN, parseStages('water 4,0 blocks 2,0', W, H))).toMatchObject({
    status: 'failed',
    index: 2,
    reason: 'the stages end without reaching the exit',
  });
});

test('deriveStages: events of a solution, rebuilt into a winning solution as short', () => {
  const sol = solve(CHAIN, { timeoutMs: 10_000 });
  expect(sol.status).toBe('solved');
  if (sol.status !== 'solved') return;
  const stages = deriveStages(CHAIN, sol.moves);
  expect(formatStages(stages, W)).toBe(
    [
      'water 4,0  player 3,0  blocks 2,0  # 3 moves',
      'key 5,0  player 5,0  # 2 moves',
      'door 2,2  player 2,2  # 5 moves',
      'exit  # 2 moves',
      '',
    ].join('\n'),
  );
  const r = runStages(CHAIN, stages);
  expect(r.status === 'won' && r.moves.length).toBe(sol.moves.length);
  expect(() => deriveStages(CHAIN, ['right'])).toThrow(/does not win/);
});

test('deriveStages pins the moved blocks; reordered stages give another solution', () => {
  // two waters, two blocks: either order wins
  const level = fromAscii(['....E', '.B.B.', '..@..', '.~.~.']);
  const stages = parseStages('water 1,3 blocks 1,1\nwater 3,3 blocks 3,1\nexit', 5, 4);
  const a = runStages(level, stages);
  const b = runStages(level, [stages[1]!, stages[0]!, stages[2]!]);
  expect(a.status).toBe('won');
  expect(b.status).toBe('won');
  const derived = deriveStages(level, a.moves);
  expect(derived.map((s) => s.blocks)).toEqual([[6], [8], []]);
  const back = runStages(level, derived);
  expect(back.status === 'won' && back.moves.length).toBeLessThanOrEqual(a.moves.length);
  // a block moved without sinking is pinned with `at`
  const push = fromAscii(['@B.', '#.#', '#k#', '#E#']);
  const st = deriveStages(push, ['right', 'down', 'down', 'down']);
  expect(formatStages(st, 3)).toBe(
    'key 1,2  at 2,0  player 1,2  blocks 1,0  # 3 moves\nexit  # 1 moves\n',
  );
  expect(runStages(push, st).status).toBe('won');
});
