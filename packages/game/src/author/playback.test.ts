import { expect, test } from 'vitest';
import { Playback, MAX_SPEED, MIN_SPEED } from './playback';

test('initial state: start, playing at 8 moves/s', () => {
  const p = new Playback(10);
  expect(p.index).toBe(0);
  expect(p.speed).toBe(8);
  expect(p.playing).toBe(true);
});

test('tick advances at the speed rate and keeps the remainder', () => {
  const p = new Playback(10);
  expect(p.tick(100)).toBe(0);
  expect(p.tick(25)).toBe(1); // 125 ms = 1 move at 8/s
  expect(p.index).toBe(1);
  expect(p.tick(250)).toBe(2);
  expect(p.index).toBe(3);
});

test('a long browser pause is capped (no burst of moves)', () => {
  const p = new Playback(100);
  expect(p.tick(10_000)).toBeLessThanOrEqual(4); // 500 ms at most = 4 moves at 8/s
});

test('automatic stop at the end', () => {
  const p = new Playback(2);
  p.tick(250);
  p.tick(250);
  expect(p.index).toBe(2);
  expect(p.playing).toBe(false);
  expect(p.tick(1000)).toBe(0);
});

test('pause / play, and playing from the end restarts from the beginning', () => {
  const p = new Playback(1);
  p.tick(250);
  expect(p.atEnd).toBe(true);
  p.toggle();
  expect(p.index).toBe(0);
  expect(p.playing).toBe(true);
  p.toggle();
  expect(p.playing).toBe(false);
  expect(p.tick(1000)).toBe(0);
});

test('step by step: pauses, bounded', () => {
  const p = new Playback(3);
  expect(p.stepBack()).toBe(false);
  expect(p.stepForward()).toBe(true);
  expect(p.playing).toBe(false);
  expect(p.index).toBe(1);
  p.stepForward();
  p.stepForward();
  expect(p.stepForward()).toBe(false);
  expect(p.index).toBe(3);
  expect(p.stepBack()).toBe(true);
  expect(p.index).toBe(2);
});

test('speed bounded between 1 and 20 moves/s', () => {
  const p = new Playback(5);
  for (let i = 0; i < 40; i++) p.faster();
  expect(p.speed).toBe(MAX_SPEED);
  expect(MAX_SPEED).toBe(20);
  for (let i = 0; i < 40; i++) p.slower();
  expect(p.speed).toBe(MIN_SPEED);
  expect(MIN_SPEED).toBe(1);
});

test('restart: back to the start, paused', () => {
  const p = new Playback(5);
  p.tick(500);
  p.restart();
  expect(p.index).toBe(0);
  expect(p.playing).toBe(false);
});

test('animation duration shortened at high speed, capped at 100 ms', () => {
  const p = new Playback(5);
  expect(p.animMs()).toBe(100);
  for (let i = 0; i < 40; i++) p.faster();
  expect(p.animMs()).toBeLessThan(50);
  expect(p.animMs()).toBeGreaterThan(0);
});

test('empty solution: nothing to play', () => {
  const p = new Playback(0);
  expect(p.tick(1000)).toBe(0);
  expect(p.stepForward()).toBe(false);
});
