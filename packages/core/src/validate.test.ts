import { expect, test } from 'vitest';
import { fromAscii } from './ascii';
import { assertValidLevel, validateLevel } from './validate';
import type { LevelData } from './types';

const ok = fromAscii(['@kB', '.~E'], { id: 'ok' });

test('a correct level is valid', () => {
  expect(validateLevel(ok)).toEqual([]);
});

test.each<[string, LevelData, RegExp]>([
  ['empty id', { ...ok, id: '' }, /empty id/],
  ['dimensions', { ...ok, width: 0 }, /dimensions/],
  ['terrain size', { ...ok, terrain: ok.terrain.slice(1) }, /terrain/],
  ['start outside map', { ...ok, start: { x: 9, y: 0 } }, /start outside/],
  [
    'start on wall',
    { ...ok, terrain: ok.terrain.map((t, i) => (i === 0 ? 'wall' : t)) },
    /start on wall/,
  ],
  ['object outside map', { ...ok, objects: [{ x: 5, y: 5, kind: 'key' }] }, /outside the map/],
  [
    'two objects on the same tile',
    { ...ok, objects: [...ok.objects, { x: 1, y: 0, kind: 'door' }] },
    /two objects/,
  ],
  ['object on the start', { ...ok, objects: [{ x: 0, y: 0, kind: 'key' }] }, /on the start/],
  ['object on water', { ...ok, objects: [{ x: 1, y: 1, kind: 'key' }] }, /on water/],
  ['object on the exit', { ...ok, objects: [{ x: 2, y: 1, kind: 'block' }] }, /on exit/],
  ['no exit', { ...ok, terrain: ok.terrain.map((t) => (t === 'exit' ? 'floor' : t)) }, /no exit/],
  ['non-integer keys', { ...ok, initialKeys: 1.5 }, /keys/],
])('%s', (_name, level, re) => {
  expect(validateLevel(level)).toContainEqual(expect.stringMatching(re));
});

test.each([NaN, 0, -5, Infinity])('seuil goldMoves %j rejected', (v) => {
  const errors = validateLevel({ ...ok, thresholds: { goldMoves: v } });
  expect(errors).toContainEqual(expect.stringContaining('invalid threshold goldMoves'));
});

test('absent or valid thresholds accepted', () => {
  expect(
    validateLevel({ ...ok, thresholds: { goldMoves: 12, goldTime: 4.5, platinumMoves: 10 } }),
  ).toEqual([]);
});

test('platinumMoves: at most goldMoves, and only with a goldMoves', () => {
  expect(validateLevel({ ...ok, thresholds: { goldMoves: 12, platinumMoves: 12 } })).toEqual([]);
  expect(validateLevel({ ...ok, thresholds: { goldMoves: 12, platinumMoves: 13 } })).toEqual([
    'platinumMoves (13) > goldMoves (12)',
  ]);
  expect(validateLevel({ ...ok, thresholds: { platinumMoves: 13 } })).toEqual([
    'platinumMoves without goldMoves',
  ]);
});

test('a start on water is valid', () => {
  const level = fromAscii(['@~E']);
  expect(validateLevel({ ...level, start: { x: 1, y: 0 } })).toEqual([]);
});

test('assertValidLevel throws a readable error', () => {
  expect(() => assertValidLevel({ ...ok, id: 'x', width: 0 })).toThrow(/Invalid level "x"/);
});
