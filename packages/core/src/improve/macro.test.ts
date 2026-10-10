import { expect, test } from 'vitest';
import { fromAscii } from '../ascii';
import { replay } from '../replay';
import { initialState } from '../state';
import { step } from '../step';
import type { Dir } from '../types';
import { checkpoints, normalizeMoves, stateAsLevel } from './macro';

test('normalizeMoves removes moves without effect and those played after victory', () => {
  const level = fromAscii(['@..E', '####']);
  const moves: Dir[] = ['left', 'right', 'down', 'right', 'up', 'right', 'right', 'left'];
  expect(normalizeMoves(level, moves)).toEqual({
    moves: ['right', 'right', 'right'],
    status: 'won',
  });
  expect(normalizeMoves(level, ['right']).status).toBe('playing');
});

test('checkpoints: one point after each interaction (key, door, push, victory)', () => {
  // key (1,0), block (2,0) pushed into the water (3,0), then exit (4,0)
  const level = fromAscii(['@kB~E']);
  const moves: Dir[] = ['right', 'right', 'right', 'right'];
  const { idx, states } = checkpoints(level, moves);
  expect(idx).toEqual([0, 1, 2, 4]);
  expect(states.map((s) => s.player.x)).toEqual([0, 1, 2, 4]);
  expect(states.at(-1)!.status).toBe('won');
  expect(states.every((s) => s.moves === 0)).toBe(true);
});

test('stateAsLevel: the rest of the solution replays from the intermediate state', () => {
  const level = fromAscii(['@kB~E', '.D###', '.k...'], { initialKeys: 0 });
  const moves: Dir[] = ['right', 'right', 'right', 'right'];
  let s = initialState(level);
  for (const m of moves.slice(0, 2)) s = step(s, m).state;
  const sub = stateAsLevel(level, s);
  expect(sub.start).toEqual({ x: 2, y: 0 });
  expect(sub.initialKeys).toBe(1);
  expect(sub.objects.filter((o) => o.kind === 'key')).toEqual([{ x: 1, y: 2, kind: 'key' }]);
  expect(replay(sub, moves.slice(2)).status).toBe('won');
  // the water filled by the block becomes floor, the block is gone
  expect(sub.terrain[3]).toBe('floor');
  expect(sub.objects.some((o) => o.kind === 'block')).toBe(false);
});
