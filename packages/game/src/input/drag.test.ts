import { expect, test } from 'vitest';
import type { Dir } from '@puzzlecave/core';
import { DRAG_STEPS, DRAG_STEP_DEFAULT, DragSteps, nearestDragStep, shiftDragStep } from './drag';

/** the moves emitted by a finger going down at the first point then through the others */
function drag(points: [number, number][], step = 10): Dir[] {
  const [first, ...rest] = points;
  const g = new DragSteps(first![0], first![1], step);
  return rest.flatMap(([x, y]) => g.move(x, y));
}
/** a straight path from a to b in small increments (like touchmove events) */
function path(a: [number, number], b: [number, number], n = 20): [number, number][] {
  return Array.from({ length: n }, (_, i): [number, number] => [
    a[0] + ((b[0] - a[0]) * (i + 1)) / n,
    a[1] + ((b[1] - a[1]) * (i + 1)) / n,
  ]);
}

test('a tap or a small wiggle emits nothing', () => {
  expect(drag([[0, 0]])).toEqual([]);
  expect(
    drag([
      [0, 0],
      [3, 2],
      [-4, 5],
      [6, -6],
      [0, 9],
      [9, 0],
    ]),
  ).toEqual([]);
});

test('one move per step travelled, in the drag direction', () => {
  expect(drag([[0, 0], ...path([0, 0], [35, 0])])).toEqual(['right', 'right', 'right']);
  expect(drag([[0, 0], ...path([0, 0], [0, -20])])).toEqual(['up', 'up']);
  expect(drag([[0, 0], ...path([0, 0], [-10, 0])])).toEqual(['left']);
  expect(drag([[0, 0], ...path([0, 0], [0, 49])])).toEqual(['down', 'down', 'down', 'down']);
});

test('a fast drag (one big jump between two events) loses no step', () => {
  expect(
    drag([
      [0, 0],
      [42, 3],
    ]),
  ).toEqual(['right', 'right', 'right', 'right']);
});

test('steering: right then up, then left', () => {
  const pts = [
    [0, 0],
    ...path([0, 0], [20, 0]),
    ...path([20, 0], [20, -30]),
    ...path([20, -30], [0, -30]),
  ] as [number, number][];
  expect(drag(pts)).toEqual(['right', 'right', 'up', 'up', 'up', 'left', 'left']);
});

test('a slanted drag keeps its direction (drift across the axis is absorbed)', () => {
  // 100 px right while sliding 40 px down: 10 moves right, never down
  expect(drag([[0, 0], ...path([0, 0], [100, 40], 50)])).toEqual(Array(10).fill('right'));
});

test('hysteresis: jitter across the drag does not alternate directions', () => {
  // right with the finger shaking ±4 px up and down (step 10): only moves right
  const shaky: [number, number][] = [[0, 0]];
  for (let i = 1; i <= 40; i++) shaky.push([i * 2, i % 2 ? 4 : -4]);
  expect(drag(shaky)).toEqual(Array(8).fill('right'));
  // nearly diagonal (0.9 px down per px right) with ±1 px jitter: the first axis is kept
  const diag: [number, number][] = [[0, 0]];
  for (let i = 1; i <= 50; i++) diag.push([i * 2 + (i % 2), i * 1.8 - (i % 2)]);
  const moves = drag(diag);
  expect(moves.length).toBeGreaterThanOrEqual(9);
  expect(new Set(moves)).toEqual(new Set(['right']));
});

test('turning back on the same axis costs one step from the farthest point', () => {
  // 18 px right (one move, 8 px beyond it), then back 10 px from there: one move left
  expect(drag([[0, 0], ...path([0, 0], [18, 0]), ...path([18, 0], [8, 0])])).toEqual([
    'right',
    'left',
  ]);
  // back and forth by less than a step after a move: nothing more
  expect(
    drag([
      [0, 0],
      [10, 0],
      [4, 0],
      [12, 0],
      [5, 0],
    ]),
  ).toEqual(['right']);
});

test('a turn just after an overshoot needs a clear perpendicular travel', () => {
  // 19 px right (one move, 9 px beyond), then up: at 10 px up the side does not beat 1.3 × 9
  expect(
    drag([
      [0, 0],
      [19, 0],
      [19, -10],
    ]),
  ).toEqual(['right']);
  expect(
    drag([
      [0, 0],
      [19, 0],
      [19, -12],
    ]),
  ).toEqual(['right', 'up']);
});

test('the offered distances: nearest and ± one notch, kept within range', () => {
  expect(DRAG_STEPS[0]).toBeLessThan(DRAG_STEPS.at(-1)!);
  expect(nearestDragStep(25)).toBe(24);
  expect(nearestDragStep(1000)).toBe(80);
  expect(DRAG_STEPS).toContain(DRAG_STEP_DEFAULT);
  expect(shiftDragStep(24, 1)).toBe(32);
  expect(shiftDragStep(24, -1)).toBe(20);
  expect(shiftDragStep(16, -1)).toBe(16);
  expect(shiftDragStep(80, 1)).toBe(80);
});
