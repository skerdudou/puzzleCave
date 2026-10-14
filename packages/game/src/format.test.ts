import { expect, test } from 'vitest';
import { ellipsize, formatTime } from './format';

test.each([
  [0, '0:00.00'],
  [7429, '0:07.42'],
  [61234, '1:01.23'],
])('%i ms → %s', (ms, s) => expect(formatTime(ms)).toBe(s));

test('ellipsize keeps what fits, with an ellipsis when cut', () => {
  const upTo = (n: number) => (s: string) => [...s].length <= n;
  expect(ellipsize('Pick a Door', upTo(20))).toBe('Pick a Door');
  expect(ellipsize('Pick a Door', upTo(11))).toBe('Pick a Door');
  expect(ellipsize('Pick a Door', upTo(8))).toBe('Pick a…'); // no space before the ellipsis
  expect(ellipsize('Pick a Door', upTo(1))).toBe('…');
  expect(ellipsize('Pick a Door', upTo(0))).toBe('');
});
