import { formatMoves, parseMoves, type Dir, type Mode } from '@puzzlecave/core';
import type { SavedReplay } from './save';

const LETTER: Record<Dir, string> = { up: 'U', down: 'D', left: 'L', right: 'R' };

/** A replay as text to copy: a `# master` line for a master run, then the moves (formatMoves). */
export function replayText(r: SavedReplay): string {
  return (r.mode === 'master' ? '# master\n' : '') + formatMoves(movesOf(r));
}

/** The most moves a replay read from text may hold: a bigger paste is not a run of this game. */
export const MAX_REPLAY_MOVES = 100_000;

/**
 * A replay read from pasted text; throws when it holds no move, a character that is not one, or
 * more than MAX_REPLAY_MOVES moves.
 */
export function parseReplayText(text: string): SavedReplay {
  const dirs = parseMoves(text);
  if (dirs.length === 0) throw new Error('empty');
  if (dirs.length > MAX_REPLAY_MOVES) throw new Error('too long');
  const master = text.split(/\r?\n/).some((l) => l.trim().toLowerCase() === '# master');
  return toSaved(dirs, master ? 'master' : 'normal');
}

export function toSaved(moves: readonly Dir[], mode: Mode): SavedReplay {
  return { mode, moves: moves.map((d) => LETTER[d]).join('') };
}

export function movesOf(r: SavedReplay): Dir[] {
  return parseMoves(r.moves);
}
