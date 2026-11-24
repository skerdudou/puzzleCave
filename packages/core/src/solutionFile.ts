// Solution files (levels/solutions/<id>.sol, gold/<id>.sol, archive/<id>/<moves>-<name>.sol):
// comment lines ("# …", read by people and by the tools), then the moves encoded on one line,
// `v1:` and base64url of 4 bits a move (up 0, down 1, left 2, right 3; 4–14 left for later
// actions, 15 pads an odd count). Not the U/D/L/R letters of a replay: a solution copied from the
// repository cannot be pasted as is into the game's replay import (which reads letters only). It
// is no secret (the decoder is here): `npm run solution -- show <id>` prints the letters.
import { formatMoves, parseMoves } from './replay';
import type { Dir } from './types';

/** The extension of the solution files. */
export const SOLUTION_EXT = '.sol';

const CODE: Record<Dir, number> = { up: 0, down: 1, left: 2, right: 3 };
const DIR_OF: readonly Dir[] = ['up', 'down', 'left', 'right'];
const PAD = 15;
const PREFIX = 'v1:';
const B64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';

function toBase64Url(bytes: Uint8Array): string {
  let out = '';
  for (let i = 0; i < bytes.length; i += 3) {
    const n = (bytes[i]! << 16) | ((bytes[i + 1] ?? 0) << 8) | (bytes[i + 2] ?? 0);
    const chars = Math.ceil((Math.min(3, bytes.length - i) * 8) / 6);
    for (let c = 0; c < chars; c++) out += B64[(n >> (18 - 6 * c)) & 63];
  }
  return out;
}

function fromBase64Url(text: string): Uint8Array {
  const vals: number[] = [];
  for (const ch of text) {
    const v = B64.indexOf(ch);
    if (v < 0) throw new Error(`invalid character in encoded moves: "${ch}"`);
    vals.push(v);
  }
  if (vals.length % 4 === 1) throw new Error('encoded moves cut short');
  const bytes: number[] = [];
  for (let i = 0; i < vals.length; i += 4) {
    const group = vals.slice(i, i + 4);
    let n = 0;
    for (let c = 0; c < 4; c++) n = (n << 6) | (group[c] ?? 0);
    const count = Math.floor((group.length * 6) / 8);
    for (let b = 0; b < count; b++) bytes.push((n >> (16 - 8 * b)) & 255);
  }
  return Uint8Array.from(bytes);
}

/** The moves as one encoded line (`v1:…`). */
export function encodeMoves(moves: readonly Dir[]): string {
  const bytes = new Uint8Array(Math.ceil(moves.length / 2));
  moves.forEach((d, i) => {
    bytes[i >> 1]! |= CODE[d] << (i % 2 === 0 ? 4 : 0);
  });
  if (moves.length % 2 === 1) bytes[bytes.length - 1]! |= PAD;
  return PREFIX + toBase64Url(bytes);
}

/** The moves of an encoded line (`v1:…`); throws on anything else. */
export function decodeMoves(line: string): Dir[] {
  if (!line.startsWith(PREFIX)) throw new Error('not encoded moves (v1:…)');
  const bytes = fromBase64Url(line.slice(PREFIX.length));
  const moves: Dir[] = [];
  bytes.forEach((b, i) => {
    for (const [k, nib] of [b >> 4, b & 15].entries()) {
      if (nib === PAD && i === bytes.length - 1 && k === 1) continue;
      const d = DIR_OF[nib];
      if (!d) throw new Error(`unknown move code ${nib}`);
      moves.push(d);
    }
  });
  return moves;
}

/**
 * The moves of a solution file: its comment lines skipped, its encoded line decoded. Lines of
 * U/D/L/R letters are read too (a solution written by hand, before it is saved in this format).
 */
export function parseSolution(text: string): Dir[] {
  const moves: Dir[] = [];
  for (const raw of text.split(/\r?\n/)) {
    const line = (raw.split('#')[0] ?? '').trim();
    if (!line) continue;
    moves.push(...(line.startsWith(PREFIX) ? decodeMoves(line) : parseMoves(line)));
  }
  return moves;
}

/** A solution file's text: its header lines (each starting with "#"), then the encoded moves. */
export function formatSolution(moves: readonly Dir[], header?: string): string {
  return `${header ? `${header}\n` : ''}${encodeMoves(moves)}\n`;
}

/** A solution file made readable: its comment lines kept, its encoded lines as U/D/L/R letters. */
export function solutionToLetters(text: string): string {
  return text
    .split(/\r?\n/)
    .map((line) =>
      line.trim().startsWith(PREFIX) ? formatMoves(decodeMoves(line.trim())).trimEnd() : line,
    )
    .join('\n');
}
