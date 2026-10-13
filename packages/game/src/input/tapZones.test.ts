import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import type { Dir } from '@puzzlecave/core';
import { ZoneGesture, isTapZoneMode, nextTapZoneMode, zoneDir } from './tapZones';

describe('zoneDir', () => {
  test('the four triangles of the X', () => {
    expect(zoneDir(0, -100)).toBe('up');
    expect(zoneDir(0, 100)).toBe('down');
    expect(zoneDir(-100, 0)).toBe('left');
    expect(zoneDir(100, 0)).toBe('right');
    // well inside a triangle, off its axis
    expect(zoneDir(100, -50)).toBe('right');
    expect(zoneDir(-30, 90)).toBe('down');
  });

  test('nothing on or near a diagonal (10° on each side), something just beyond', () => {
    for (const [sx, sy] of [
      [1, 1],
      [1, -1],
      [-1, 1],
      [-1, -1],
    ] as const) {
      expect(zoneDir(100 * sx, 100 * sy)).toBeNull();
      // 36° from the axis: 9° from the diagonal
      const a = (36 * Math.PI) / 180;
      expect(zoneDir(100 * Math.cos(a) * sx, 100 * Math.sin(a) * sy)).toBeNull();
      // 34° from the axis: 11° from the diagonal
      const b = (34 * Math.PI) / 180;
      expect(zoneDir(100 * Math.cos(b) * sx, 100 * Math.sin(b) * sy)).toBe(
        sx > 0 ? 'right' : 'left',
      );
      expect(zoneDir(100 * Math.sin(b) * sx, 100 * Math.cos(b) * sy)).toBe(sy > 0 ? 'down' : 'up');
    }
  });

  test('nothing in the dead circle at the centre', () => {
    expect(zoneDir(0, 0)).toBeNull();
    expect(zoneDir(15, 0)).toBeNull();
    expect(zoneDir(0, -15.9)).toBeNull();
    expect(zoneDir(16, 0)).toBe('right');
    expect(zoneDir(5, 5, 4)).toBeNull(); // diagonal, out of the circle
    expect(zoneDir(NaN, 3)).toBeNull();
  });

  test('screen- or player-centred: the same point, seen from another centre', () => {
    const screen = { x: 180, y: 370 };
    const player = { x: 120, y: 160 };
    // a tap just left of the player, high on the screen: "up" from the screen centre
    const tap = { x: 80, y: 160 };
    expect(zoneDir(tap.x - screen.x, tap.y - screen.y)).toBe('up');
    expect(zoneDir(tap.x - player.x, tap.y - player.y)).toBe('left');
  });

  test('modes', () => {
    expect(nextTapZoneMode('off')).toBe('screen');
    expect(nextTapZoneMode('screen')).toBe('player');
    expect(nextTapZoneMode('player')).toBe('off');
    expect(isTapZoneMode('player')).toBe(true);
    expect(isTapZoneMode('centre')).toBe(false);
    expect(isTapZoneMode(undefined)).toBe(false);
  });
});

describe('ZoneGesture: tap, hold or drag', () => {
  let moves: Dir[];
  let rate: number;
  const start = (dir: Dir = 'left') =>
    new ZoneGesture(
      dir,
      100,
      100,
      (d) => moves.push(d),
      () => rate,
    );
  beforeEach(() => {
    vi.useFakeTimers();
    moves = [];
    rate = 10; // hold delay 200 ms, then 100 ms
  });
  afterEach(() => vi.useRealTimers());

  test('a tap: nothing on touch-down, one move on release', () => {
    const g = start();
    expect(moves).toEqual([]);
    vi.advanceTimersByTime(150);
    expect(moves).toEqual([]);
    g.release();
    expect(moves).toEqual(['left']);
    vi.advanceTimersByTime(2000);
    expect(moves).toEqual(['left']);
  });

  test('a small wiggle within the slop is still a tap', () => {
    const g = start('up');
    expect(g.move(106, 96)).toBe(false);
    expect(g.move(93, 104)).toBe(false);
    g.release();
    expect(moves).toEqual(['up']);
  });

  test('holding still: a move at the hold delay, then at the repeat rate, none on release', () => {
    const g = start('down');
    vi.advanceTimersByTime(199);
    expect(moves).toEqual([]);
    vi.advanceTimersByTime(1);
    expect(moves).toEqual(['down']);
    vi.advanceTimersByTime(300);
    expect(moves).toHaveLength(4);
    g.release();
    vi.advanceTimersByTime(1000);
    expect(moves).toHaveLength(4);
  });

  test('the repeat follows the rate setting, read at each step', () => {
    rate = 4; // 250 ms, then 250 ms
    const g = start();
    vi.advanceTimersByTime(249);
    expect(moves).toHaveLength(0);
    vi.advanceTimersByTime(1);
    expect(moves).toHaveLength(1);
    rate = 20;
    vi.advanceTimersByTime(250); // the interval already scheduled (250), then 50 ms
    expect(moves).toHaveLength(2);
    vi.advanceTimersByTime(100);
    expect(moves).toHaveLength(4);
    g.cancel();
  });

  test('moving beyond the slop before the delay: a drag, the zone emits nothing', () => {
    const g = start('right');
    vi.advanceTimersByTime(100);
    expect(g.move(111, 100)).toBe(true);
    expect(g.dragging).toBe(true);
    // the drag goes on, even back over the start
    expect(g.move(100, 100)).toBe(true);
    vi.advanceTimersByTime(2000);
    g.release();
    expect(moves).toEqual([]);
  });

  test('moving away while repeating stops the repeat, and makes no drag', () => {
    const g = start('up');
    vi.advanceTimersByTime(300);
    expect(moves).toHaveLength(2);
    expect(g.move(130, 100)).toBe(false);
    expect(g.move(200, 100)).toBe(false);
    vi.advanceTimersByTime(1000);
    g.release();
    expect(moves).toHaveLength(2);
  });

  test('a cancelled touch emits nothing, before or during a hold', () => {
    const a = start();
    a.cancel();
    vi.advanceTimersByTime(1000);
    a.release(); // a release after the cancel: nothing either
    expect(moves).toEqual([]);
    const b = start();
    vi.advanceTimersByTime(200);
    b.cancel();
    vi.advanceTimersByTime(1000);
    expect(moves).toEqual(['left']);
  });
});
