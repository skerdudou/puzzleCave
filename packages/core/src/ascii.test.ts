import { expect, test } from 'vitest';
import { fromAscii, toAscii } from './ascii';
import { initialState } from './state';

test('fromAscii builds terrain, objects and start', () => {
  const l = fromAscii(['@k,', '~BE'], { id: 't', initialKeys: 2 });
  expect(l.width).toBe(3);
  expect(l.height).toBe(2);
  expect(l.terrain).toEqual(['floor', 'floor', 'gravel', 'water', 'floor', 'exit']);
  expect(l.objects).toEqual([
    { x: 1, y: 0, kind: 'key' },
    { x: 1, y: 1, kind: 'block' },
  ]);
  expect(l.start).toEqual({ x: 0, y: 0 });
  expect(l.initialKeys).toBe(2);
  expect(l.thresholds).toEqual({});
});

test('fromAscii rejects an unknown character, uneven rows, zero or two starts', () => {
  expect(() => fromAscii(['@x'])).toThrow(/unknown/);
  expect(() => fromAscii(['@.', '.'])).toThrow(/length/);
  expect(() => fromAscii(['..'])).toThrow(/start/);
  expect(() => fromAscii(['@@'])).toThrow(/start/);
});

test('toAscii redraws the state', () => {
  const rows = ['@k,', '~BE'];
  expect(toAscii(initialState(fromAscii(rows)))).toEqual(rows);
});
