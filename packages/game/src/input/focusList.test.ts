import { expect, test } from 'vitest';
import { FocusList, focusKey } from './focusList';

test('the first arrow focuses the first button (or the last, going back), then it wraps', () => {
  const f = new FocusList(3);
  expect(f.index).toBe(-1);
  expect(f.move(1)).toBe(0);
  expect(f.move(1)).toBe(1);
  expect(f.move(1)).toBe(2);
  expect(f.move(1)).toBe(0);
  expect(f.move(-1)).toBe(2);
  expect(new FocusList(3).move(-1)).toBe(2);
});

test('a focus kept across a restart, and an empty list', () => {
  expect(new FocusList(4, 2).move(1)).toBe(3);
  expect(new FocusList(0).move(1)).toBe(-1);
});

test.each([
  [{ key: 'ArrowDown' }, 'next'],
  [{ key: 'ArrowRight' }, 'next'],
  [{ key: 'Tab' }, 'next'],
  [{ key: 'Tab', shiftKey: true }, 'prev'],
  [{ key: 'ArrowUp' }, 'prev'],
  [{ key: 'ArrowLeft' }, 'prev'],
  [{ key: 'Enter' }, 'activate'],
  [{ key: ' ' }, 'activate'],
  [{ key: 'Escape' }, null],
])('%j → %s', (e, action) => {
  expect(focusKey(e)).toBe(action);
});
