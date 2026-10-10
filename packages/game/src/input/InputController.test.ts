import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { InputController, type Action, type KeyLike } from './InputController';

const key = (code: string, k = '', repeat = false): KeyLike => ({ code, key: k, repeat });
let actions: Action[];
let c: InputController;
beforeEach(() => {
  vi.useFakeTimers();
  actions = [];
  c = new InputController((a) => actions.push(a), 10);
});
afterEach(() => vi.useRealTimers());
const moves = () => actions.flatMap((a) => (a.type === 'move' ? [a.dir] : []));

test('directions by physical position: arrows and KeyW/A/S/D (= ZQSD on AZERTY)', () => {
  for (const code of ['ArrowUp', 'KeyA', 'KeyS', 'KeyD', 'KeyW']) {
    expect(c.keydown(key(code, 'x'))).toBe(true);
    c.keyup(key(code));
  }
  expect(moves()).toEqual(['up', 'left', 'down', 'right', 'up']);
});

test('U, R, Escape read by letter; Ctrl+Z ignored', () => {
  c.keydown(key('KeyU', 'u'));
  c.keydown(key('KeyR', 'R'));
  c.keydown(key('Escape', 'Escape'));
  expect(c.keydown({ ...key('KeyZ', 'z'), ctrlKey: true })).toBe(false);
  expect(actions).toEqual([{ type: 'undo' }, { type: 'restart' }, { type: 'menu' }]);
});

test('rafale : 50 appuis en 200 ms → 50 coups, aucun perdu', () => {
  for (let i = 0; i < 50; i++) {
    const code = i % 2 ? 'ArrowLeft' : 'ArrowRight';
    c.keydown(key(code));
    vi.advanceTimersByTime(2);
    c.keyup(key(code));
    vi.advanceTimersByTime(2);
  }
  expect(moves()).toHaveLength(50);
});

test('OS key repeat ignored, custom repeat at the chosen rate', () => {
  c.keydown(key('ArrowRight'));
  c.keydown(key('ArrowRight', '', true));
  expect(moves()).toHaveLength(1);
  vi.advanceTimersByTime(199);
  expect(moves()).toHaveLength(1);
  vi.advanceTimersByTime(1); // 200 ms : initial delay
  expect(moves()).toHaveLength(2);
  vi.advanceTimersByTime(300); // 10/s → +3
  expect(moves()).toHaveLength(5);
  c.keyup(key('ArrowRight'));
  vi.advanceTimersByTime(1000);
  expect(moves()).toHaveLength(5);
});

test('two directions held: the last one repeats, then the other on release', () => {
  c.keydown(key('ArrowRight'));
  c.keydown(key('ArrowUp'));
  vi.advanceTimersByTime(200);
  expect(moves()).toEqual(['right', 'up', 'up']);
  c.keyup(key('ArrowUp'));
  vi.advanceTimersByTime(200);
  expect(moves().at(-1)).toBe('right');
});

test('reset (focus loss) stops the repeat', () => {
  c.keydown(key('ArrowDown'));
  c.reset();
  vi.advanceTimersByTime(2000);
  expect(moves()).toEqual(['down']);
  c.keydown(key('ArrowDown')); // no longer considered held
  expect(moves()).toEqual(['down', 'down']);
});

test.each([
  [0, 5], // clamped to 4/s: delay 250 ms, then 250, 500, 750, 1000
  [NaN, 10], // non-finite → 10/s: delay 200 ms, then 100 ms
])('invalid rate %p: clamped repeat (%i moves in 1 s)', (rate, expected) => {
  c = new InputController((a) => actions.push(a), rate);
  c.keydown(key('ArrowRight'));
  vi.advanceTimersByTime(1000);
  expect(moves()).toHaveLength(expected);
});

test('releasing a non-repeated key does not restart the current repeat', () => {
  c.keydown(key('ArrowRight'));
  c.keydown(key('ArrowUp')); // Up repeats
  vi.advanceTimersByTime(250); // Up emitted at 200 ms, next at 300 ms
  c.keyup(key('ArrowRight')); // Right is not the repeated direction
  const before = moves().length;
  vi.advanceTimersByTime(100);
  expect(moves().length).toBe(before + 1); // 300 ms, without the 200 ms delay
  vi.advanceTimersByTime(100);
  expect(moves().length).toBe(before + 2); // 400 ms
  expect(moves().slice(before)).toEqual(['up', 'up']);
});
