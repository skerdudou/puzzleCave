import { expect, test } from 'vitest';
import { fromAscii } from '../ascii';
import { parseMoves, replay } from '../replay';
import { railsPass } from './rails';

const opts = { maxStates: 100_000, timeoutMs: 10_000 };

test('a detour in the walking is cut out, from the cut after the last interaction', () => {
  // the block goes into the water (a cut), then the player wanders before the exit
  const level = fromAscii(['@B~.E']);
  const moves = parseMoves('RR' + 'LR' + 'RR');
  expect(replay(level, moves).status).toBe('won');
  const r = railsPass(level, moves, opts);
  expect(r.moves.length).toBe(4);
  expect(replay(level, r.moves).status).toBe('won');
  // the first move already sinks the block: the cut is after move 1
  expect(r.gains).toEqual([{ k: 1, before: 6, after: 4 }]);
  // the new solution searched to its start: optimal on its own rails
  expect(r.reached).toBe(0);
});

test('an optimal solution stays, searched back to its start', () => {
  const level = fromAscii(['@B~.E']);
  const r = railsPass(level, parseMoves('RRRR'), opts);
  expect(r.moves.length).toBe(4);
  expect(r.gains).toEqual([]);
  expect(r.reached).toBe(0);
});

test('on a level with room around, the result still wins and is never longer', () => {
  // one block pushed into its water, then the walk to the exit: the searches run on a level
  // where most of the floor turns to gravel (the player still walks on it)
  const level = fromAscii(['#######', '#@.B.~#', '#.....#', '#....E#', '#######']);
  const moves = parseMoves('RRR' + 'DRRD');
  expect(replay(level, moves).status).toBe('won');
  const r = railsPass(level, moves, opts);
  expect(replay(level, r.moves).status).toBe('won');
  expect(r.moves.length).toBeLessThanOrEqual(moves.length);
  expect(r.reached).toBe(0);
});

test('out of time: the solution as it was, nothing searched', () => {
  const level = fromAscii(['@B~.E']);
  const moves = parseMoves('RR' + 'LR' + 'RR');
  const r = railsPass(level, moves, { maxStates: 100_000, timeoutMs: 0 });
  expect(r.moves).toEqual(moves);
  expect(r.reached).toBe(moves.length);
  expect(r.timedOut).toBe(true);
  expect(r.searches).toBe(0);
});
