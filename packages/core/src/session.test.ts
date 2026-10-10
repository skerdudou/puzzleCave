import { expect, test } from 'vitest';
import { fromAscii } from './ascii';
import { Session } from './session';

const level = fromAscii(['@.#', '..E']);

test('move pushes effective moves, undo pops them', () => {
  const s = new Session(level);
  s.move('right');
  s.move('down');
  expect(s.state.moves).toBe(2);
  expect(s.moveLog).toEqual(['right', 'down']);
  expect(s.undo()).toBe(true);
  expect(s.state.moves).toBe(1);
  expect(s.state.player).toEqual({ x: 1, y: 0 });
  expect(s.moveLog).toEqual(['right']);
});

test('undo at the start returns false', () => {
  expect(new Session(level).undo()).toBe(false);
});

test('a mere change of facing creates no history entry', () => {
  const s = new Session(level);
  s.move('right');
  s.move('right'); // wall, already facing right: nothing
  s.move('up'); // edge: only turns
  expect(s.state.facing).toBe('up');
  expect(s.moveLog).toEqual(['right']);
  expect(s.undo()).toBe(true);
  expect(s.state.moves).toBe(0);
});

test('no undo after a win or a drowning', () => {
  const s = new Session(level);
  s.move('right');
  s.move('down');
  s.move('right');
  expect(s.state.status).toBe('won');
  expect(s.undo()).toBe(false);

  const p = new Session(fromAscii(['@~E']), 'platinum');
  p.move('right');
  expect(p.state.status).toBe('drowned');
  expect(p.undo()).toBe(false);
});

test('restart returns to the initial state', () => {
  const s = new Session(level);
  s.move('right');
  s.restart();
  expect(s.state.moves).toBe(0);
  expect(s.moveLog).toEqual([]);
  expect(s.state.player).toEqual({ x: 0, y: 0 });
});

test('undo right after a restart restores the previous game (a single level)', () => {
  const s = new Session(level);
  s.move('right');
  s.move('down');
  s.restart();
  expect(s.canUndoRestart).toBe(true);
  expect(s.undo()).toBe(true);
  expect(s.moveLog).toEqual(['right', 'down']);
  expect(s.state.moves).toBe(2);
  expect(s.canUndoRestart).toBe(false);
  s.restart();
  s.undo();
  expect(s.undo()).toBe(true); // ordinary undo of the last move
  expect(s.moveLog).toEqual(['right']);
});

test('a move after restart removes the ability to undo the restart', () => {
  const s = new Session(level);
  s.move('right');
  s.restart();
  s.move('down');
  expect(s.canUndoRestart).toBe(false);
  expect(s.undo()).toBe(true);
  expect(s.undo()).toBe(false);
  expect(s.moveLog).toEqual([]);
});

test('restart on a fresh game or after drowning: nothing to restore', () => {
  const s = new Session(level);
  s.move('right');
  s.restart();
  s.restart(); // the saved game remains available
  expect(s.undo()).toBe(true);
  expect(s.moveLog).toEqual(['right']);

  const p = new Session(fromAscii(['@~E']), 'platinum');
  p.move('right');
  p.restart();
  expect(p.canUndoRestart).toBe(false);
  expect(p.undo()).toBe(false);
});
