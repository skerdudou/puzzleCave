import { expect, test } from 'vitest';
import { fromAscii } from './ascii';
import { formatMoves, parseMoves, replay } from './replay';
import type { Dir } from './types';

test('parseMoves reads U D L R, ignores whitespace, case and comments', () => {
  expect(parseMoves('RrD # comment\n l U')).toEqual(['right', 'right', 'down', 'left', 'up']);
});

test('parseMoves rejects an unknown character', () => {
  expect(() => parseMoves('RX')).toThrow(/"X"/);
});

test('formatMoves : uppercase, 50 per line', () => {
  const dirs = Array<Dir>(51).fill('up');
  expect(formatMoves(dirs)).toBe('U'.repeat(50) + '\nU\n');
  expect(parseMoves(formatMoves(dirs))).toEqual(dirs);
});

test('replay replays a solution through to the win', () => {
  const l = fromAscii(['@.#', '..E']);
  expect(replay(l, parseMoves('RDR')).status).toBe('won');
  expect(replay(l, parseMoves('RD')).status).toBe('playing');
});
