import type { Dir } from '@puzzlecave/core';

export function swipeDir(dx: number, dy: number, threshold: number): Dir | null {
  const ax = Math.abs(dx);
  const ay = Math.abs(dy);
  if (Math.max(ax, ay) < threshold || ax === ay) return null;
  return ax > ay ? (dx > 0 ? 'right' : 'left') : dy > 0 ? 'down' : 'up';
}
