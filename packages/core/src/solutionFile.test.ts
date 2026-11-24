import { expect, test } from 'vitest';
import { formatMoves, parseMoves } from './replay';
import {
  decodeMoves,
  encodeMoves,
  formatSolution,
  parseSolution,
  solutionToLetters,
} from './solutionFile';

test('moves encoded and decoded back, of any length', () => {
  for (const letters of ['', 'U', 'DL', 'RRR', 'UDLRUDLRL', 'R'.repeat(1301)]) {
    const moves = parseMoves(letters);
    const line = encodeMoves(moves);
    expect(line.startsWith('v1:')).toBe(true);
    expect(line).toMatch(/^v1:[A-Za-z0-9_-]*$/);
    expect(decodeMoves(line)).toEqual(moves);
  }
});

test('4 bits a move: two moves a byte, about 1.33 characters a move', () => {
  expect(encodeMoves(parseMoves('R'.repeat(300))).length).toBe(3 + 200);
});

test('an encoded file is not letters: the replay import cannot read it', () => {
  const text = formatSolution(parseMoves('RRDDLLUU'), '# optimal (proven)');
  expect(text.split('\n')[0]).toBe('# optimal (proven)');
  expect(() => parseMoves(text)).toThrow();
});

test('a solution file: comments skipped, encoded or letters (written by hand)', () => {
  const moves = parseMoves('RRDDL');
  expect(parseSolution(formatSolution(moves, '# best known'))).toEqual(moves);
  expect(parseSolution('# by hand\nRRD\nDL\n')).toEqual(moves);
});

test('readable: the encoded line shown as letters, the header kept', () => {
  const moves = parseMoves('UUDDLRLR');
  expect(solutionToLetters(formatSolution(moves, '# optimal (proven)'))).toBe(
    `# optimal (proven)\n${formatMoves(moves).trimEnd()}\n`,
  );
});

test('a damaged line is refused', () => {
  expect(() => decodeMoves('v1:@@')).toThrow(/invalid character/);
  expect(() => decodeMoves('RRR')).toThrow(/not encoded/);
  // one character too many: cut short
  expect(() => decodeMoves(`${encodeMoves(parseMoves('RRRRRR'))}A`)).toThrow(/cut short/);
  // the padding code in a move's place
  expect(() => decodeMoves('v1:8w')).toThrow(/unknown move code/);
  // a code no move has yet (5)
  expect(() => decodeMoves('v1:VQ')).toThrow(/unknown move code/);
});
