import { describe, expect, test } from 'vitest';
import { fromAscii, toAscii, type AsciiOptions } from './ascii';
import { initialState } from './state';
import { step } from './step';
import type { Dir, GameState, Mode } from './types';

const lvl = (rows: string[], opts: AsciiOptions = {}, mode: Mode = 'normal') =>
  initialState(fromAscii(rows, opts), mode);
const go = (s: GameState, ...dirs: Dir[]) => dirs.reduce((st, d) => step(st, d).state, s);

describe('movement', () => {
  test('walks on floor and counts a move', () => {
    const s = go(lvl(['@.E']), 'right');
    expect(s.player).toEqual({ x: 1, y: 0 });
    expect(s.moves).toBe(1);
    expect(s.facing).toBe('right');
  });

  test('reaching the exit wins', () => {
    const r = step(go(lvl(['@.E']), 'right'), 'right');
    expect(r.state.status).toBe('won');
    expect(r.events.at(-1)).toEqual({ type: 'won' });
  });

  test('gravel can be crossed', () => {
    expect(go(lvl(['@,E']), 'right', 'right').status).toBe('won');
  });

  test('a wall blocks: the player only turns, no move counted', () => {
    const r = step(lvl(['@#E']), 'right');
    expect(r.state.player).toEqual({ x: 0, y: 0 });
    expect(r.state.moves).toBe(0);
    expect(r.state.facing).toBe('right');
    expect(r.events).toEqual([{ type: 'turned', facing: 'right' }]);
  });

  test('blocked while already facing that way: same state, no event', () => {
    const s = lvl(['@E']); // initial facing: down, map edge below
    const r = step(s, 'down');
    expect(r.state).toBe(s);
    expect(r.events).toEqual([]);
  });

  test('the map edge blocks', () => {
    expect(go(lvl(['@E']), 'left').player).toEqual({ x: 0, y: 0 });
  });

  test('start on water: you can leave it but not go back', () => {
    const s0 = { ...lvl(['@~E']), player: { x: 1, y: 0 } };
    const s1 = step(s0, 'left').state;
    expect(s1.player).toEqual({ x: 0, y: 0 });
    expect(s1.moves).toBe(1);
    const r = step(s1, 'right');
    expect(r.state.player).toEqual({ x: 0, y: 0 });
    expect(r.state.moves).toBe(1);
  });

  test('the original state is never mutated', () => {
    const s = lvl(['@B.E']);
    const before = JSON.stringify(s);
    step(s, 'right');
    expect(JSON.stringify(s)).toBe(before);
  });

  test('a finished game ignores input', () => {
    const won = go(lvl(['@E']), 'right');
    expect(step(won, 'left')).toEqual({ state: won, events: [] });
  });

  test('burst of 50 moves: exactly 50 moves applied', () => {
    const s = go(lvl(['@' + '.'.repeat(50) + 'E']), ...Array<Dir>(50).fill('right'));
    expect(s.player).toEqual({ x: 50, y: 0 });
    expect(s.moves).toBe(50);
    expect(s.status).toBe('playing');
    expect(step(s, 'right').state.status).toBe('won');
  });
});

describe('water', () => {
  test('normal mode: water blocks', () => {
    const s = go(lvl(['@~E']), 'right');
    expect(s.player).toEqual({ x: 0, y: 0 });
    expect(s.moves).toBe(0);
  });

  test('platinum mode: water drowns', () => {
    const r = step(lvl(['@~E'], {}, 'platinum'), 'right');
    expect(r.state.status).toBe('drowned');
    expect(r.state.moves).toBe(1);
    expect(r.events).toContainEqual({ type: 'drowned', at: { x: 1, y: 0 } });
    expect(step(r.state, 'right').state).toBe(r.state);
  });
});

describe('keys and doors', () => {
  test('pick up a key then open the door', () => {
    let r = step(lvl(['@kDE']), 'right');
    expect(r.state.keys).toBe(1);
    expect(r.events).toContainEqual({ type: 'keyPicked', at: { x: 1, y: 0 } });
    r = step(r.state, 'right');
    expect(r.state.keys).toBe(0);
    expect(r.state.player).toEqual({ x: 2, y: 0 });
    expect(r.events).toContainEqual({ type: 'doorOpened', at: { x: 2, y: 0 } });
    expect(step(r.state, 'right').state.status).toBe('won');
  });

  test('door without a key: blocks', () => {
    expect(go(lvl(['@DE']), 'right').player).toEqual({ x: 0, y: 0 });
  });

  test('negative initial keys: enough must be picked up', () => {
    expect(go(lvl(['@kkDE'], { initialKeys: -1 }), 'right', 'right', 'right').player).toEqual({
      x: 3,
      y: 0,
    });
    expect(go(lvl(['@kkDE'], { initialKeys: -2 }), 'right', 'right', 'right').player).toEqual({
      x: 2,
      y: 0,
    });
  });
});

describe('blocks', () => {
  test('push a block onto the floor', () => {
    const r = step(lvl(['@B..']), 'right');
    expect(toAscii(r.state)).toEqual(['.@B.']);
    expect(r.events).toContainEqual({ type: 'pushed', from: { x: 1, y: 0 }, to: { x: 2, y: 0 } });
  });

  test('a block pushed into water fills it', () => {
    const r = step(lvl(['@B~.']), 'right');
    expect(r.events).toContainEqual({ type: 'blockSank', at: { x: 2, y: 0 } });
    expect(toAscii(r.state)).toEqual(['.@..']);
    expect(go(r.state, 'right', 'right').player).toEqual({ x: 3, y: 0 });
  });

  test.each([
    ['gravel', ['@B,']],
    ['wall', ['@B#']],
    ['exit', ['@BE']],
    ['edge', ['@B']],
    ['another block', ['@BB.']],
    ['key', ['@Bk']],
    ['door', ['@BD']],
  ])('a block cannot move onto: %s', (_name, rows) => {
    const s = go(lvl(rows), 'right');
    expect(s.moves).toBe(0);
    expect(s.player).toEqual({ x: 0, y: 0 });
  });
});
