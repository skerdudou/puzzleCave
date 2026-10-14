import { expect, test } from 'vitest';
import { RunClock, countdown } from './runClock';

test('the clock starts with the first move', () => {
  const c = new RunClock();
  expect(c.started).toBe(false);
  expect(c.elapsed(5000)).toBe(0);
  c.begin(1000);
  c.begin(3000); // a later move does not restart it
  expect(c.started).toBe(true);
  expect(c.elapsed(4500)).toBe(3500);
});

test('hidden time is not counted', () => {
  const c = new RunClock();
  c.begin(1000);
  c.pause(3000);
  expect(c.elapsed(60_000)).toBe(2000); // frozen while hidden
  c.pause(10_000); // a second hide event changes nothing
  c.resume(61_000);
  expect(c.elapsed(62_000)).toBe(3000);
  c.resume(70_000); // not hidden: nothing to do
  expect(c.elapsed(72_000)).toBe(13_000);
});

test('hidden before the first move: the clock still starts at zero', () => {
  const c = new RunClock();
  c.pause(1000);
  c.resume(9000);
  c.begin(10_000);
  expect(c.elapsed(10_500)).toBe(500);
});

test('restart: a new clock; undo of the restart brings the old one back, hidden time excluded', () => {
  const c = new RunClock();
  c.begin(0);
  c.restart(true);
  expect(c.started).toBe(false);
  expect(c.elapsed(5000)).toBe(0);
  c.pause(5000);
  c.resume(25_000);
  c.undoRestart();
  expect(c.elapsed(26_000)).toBe(6000);
  // master mode: the old game is gone
  const m = new RunClock();
  m.begin(0);
  m.restart(false);
  m.undoRestart();
  expect(m.started).toBe(false);
});

test('countdown: time left, warning in the last seconds, over past the limit', () => {
  expect(countdown(60_000, 0)).toEqual({ leftMs: 60_000, warn: false, over: false });
  expect(countdown(60_000, 49_999).warn).toBe(false);
  expect(countdown(60_000, 50_000)).toEqual({ leftMs: 10_000, warn: true, over: false });
  expect(countdown(60_000, 60_000)).toEqual({ leftMs: 0, warn: true, over: false });
  expect(countdown(60_000, 60_001)).toEqual({ leftMs: 0, warn: true, over: true });
  // a short limit warns for its last quarter only
  expect(countdown(15_000, 11_000).warn).toBe(false);
  expect(countdown(15_000, 11_250).warn).toBe(true);
});
