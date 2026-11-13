import { expect, test } from 'vitest';
import { MAX_REPLAY_MOVES, movesOf, parseReplayText, replayText, toSaved } from './replayText';

test('text round-trips a normal replay', () => {
  const r = toSaved(['up', 'right', 'down', 'left'], 'normal');
  expect(r.moves).toBe('URDL');
  expect(parseReplayText(replayText(r))).toEqual(r);
});
test('master replay round-trips its mode', () => {
  const r = toSaved(['up'], 'master');
  expect(replayText(r).startsWith('# master\n')).toBe(true);
  expect(parseReplayText(replayText(r))).toEqual(r);
});
test('pasted text is forgiving', () => {
  expect(parseReplayText('  ur\r\n dl \n')).toEqual({ mode: 'normal', moves: 'URDL' });
});
test('unreadable text is refused', () => {
  expect(() => parseReplayText('')).toThrow();
  expect(() => parseReplayText('# master\n')).toThrow();
  expect(() => parseReplayText('URX')).toThrow();
});
test('moves come back as directions', () => {
  expect(movesOf({ mode: 'normal', moves: 'UL' })).toEqual(['up', 'left']);
});
test('a text over the cap of moves is refused', () => {
  expect(parseReplayText('U'.repeat(MAX_REPLAY_MOVES)).moves).toHaveLength(MAX_REPLAY_MOVES);
  expect(() => parseReplayText('U'.repeat(MAX_REPLAY_MOVES + 1))).toThrow();
});
