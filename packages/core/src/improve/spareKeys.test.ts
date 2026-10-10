import { expect, test, vi } from 'vitest';
import { fromAscii } from '../ascii';
import { replay } from '../replay';
import type { Dir } from '../types';
import { reoptimize } from './reoptimize';
import { droppablePickups, spareKeys } from './spareKeys';
import { searchWindow } from './window';

/** exact engine that never answers: only the internal windows (towards an exact state) work */
const stuck = () => ({ status: 'timeout' as const, explored: 0, lowerBound: 0 });
const opts = { timeoutMs: 30_000, exact: stuck };
const moves = (s: string): Dir[] =>
  [...s].map((c) => ({ U: 'up', D: 'down', L: 'left', R: 'right' })[c] as Dir);

// one key in hand opens the door: the key at (1,0) is a detour of 2 moves
const DETOUR = ['#k######', '@.....DE'];
const WITH_DETOUR = moves('RUDRRRRRR');

test('droppablePickups: a pickup whose key is never needed afterwards', () => {
  expect(droppablePickups(fromAscii(DETOUR, { initialKeys: 1 }), WITH_DETOUR)).toEqual([1]);
  // without a key at the start, the door needs it
  expect(droppablePickups(fromAscii(DETOUR, { initialKeys: 0 }), WITH_DETOUR)).toEqual([]);
});

test('windows alone cannot drop a useless key pickup, the spare keys pass does', () => {
  const level = fromAscii(DETOUR, { initialKeys: 1 });
  expect(replay(level, WITH_DETOUR).status).toBe('won');
  expect(reoptimize(level, WITH_DETOUR, opts).moves).toHaveLength(WITH_DETOUR.length);
  const r = spareKeys(level, WITH_DETOUR, opts);
  expect(r.moves).toEqual(moves('RRRRRRR'));
  expect(r.dropped).toBe(1);
  expect(r.rejected).toBe(0);
  expect(replay(level, r.moves).status).toBe('won');
});

test('several spare keys: dropped one at a time', () => {
  const level = fromAscii(['#k#k####', '@.....DE'], { initialKeys: 2 });
  const long = moves('RUDRRUDRRRR');
  expect(replay(level, long).status).toBe('won');
  expect(droppablePickups(level, long)).toEqual([1, 2]);
  const r = spareKeys(level, long, opts);
  expect(r.moves).toEqual(moves('RRRRRRR'));
  expect(r.dropped).toBe(2);
});

test('a key needed by a later door is never dropped', () => {
  const level = fromAscii(DETOUR, { initialKeys: 0 });
  const window = vi.fn(searchWindow);
  const r = spareKeys(level, WITH_DETOUR, { ...opts, window });
  expect(window).not.toHaveBeenCalled();
  expect(r.moves).toEqual(WITH_DETOUR);
  expect(r.dropped).toBe(0);
});

test('a key lying on the path of a later push is kept, the useless one is dropped', () => {
  // the block must go up through (2,2): that key has to be picked up first; (4,2) is useless
  const level = fromAscii(['##E##', '##~##', '@.k.k', '..B..', '.....']);
  const long = moves('RRRRDDLLUUUU');
  expect(replay(level, long).status).toBe('won');
  expect(droppablePickups(level, long)).toEqual([1, 2]);
  const r = spareKeys(level, long, opts);
  expect(r.moves).toHaveLength(10);
  expect(r.dropped).toBe(1);
  expect(replay(level, r.moves).status).toBe('won');
  // the key on the push path is still picked up
  expect(r.moves.slice(0, 2)).toEqual(moves('RR'));
});

test('replay safety: a window answer that breaks the solution is rejected', () => {
  const level = fromAscii(DETOUR, { initialKeys: 1 });
  // shorter, but the spliced solution no longer wins
  const window = vi.fn(() => ({ status: 'shorter' as const, moves: moves('L') }));
  const r = spareKeys(level, WITH_DETOUR, { ...opts, window });
  expect(window).toHaveBeenCalled();
  expect(r.rejected).toBeGreaterThan(0);
  expect(r.dropped).toBe(0);
  expect(r.moves).toEqual(WITH_DETOUR);
  expect(replay(level, r.moves).status).toBe('won');
});

test('starting solution that does not win: error', () => {
  expect(() => spareKeys(fromAscii(DETOUR, { initialKeys: 1 }), moves('R'), opts)).toThrow();
});
