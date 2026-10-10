import { expect, test } from 'vitest';
import { formatTime } from './format';

test.each([
  [0, '0:00.00'],
  [7429, '0:07.42'],
  [61234, '1:01.23'],
])('%i ms → %s', (ms, s) => expect(formatTime(ms)).toBe(s));
