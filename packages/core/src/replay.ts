import { initialState } from './state';
import { step } from './step';
import type { Dir, GameState, LevelData, Mode } from './types';

const LETTER_TO_DIR: Record<string, Dir> = { U: 'up', D: 'down', L: 'left', R: 'right' };
const DIR_TO_LETTER: Record<Dir, string> = { up: 'U', down: 'D', left: 'L', right: 'R' };

export function replay(level: LevelData, dirs: readonly Dir[], mode: Mode = 'normal'): GameState {
  let s = initialState(level, mode);
  for (const d of dirs) s = step(s, d).state;
  return s;
}

export function parseMoves(text: string): Dir[] {
  const dirs: Dir[] = [];
  for (const line of text.split(/\r?\n/)) {
    const content = line.split('#')[0] ?? '';
    for (const ch of content) {
      if (/\s/.test(ch)) continue;
      const d = LETTER_TO_DIR[ch.toUpperCase()];
      if (!d) throw new Error(`invalid solution character: "${ch}"`);
      dirs.push(d);
    }
  }
  return dirs;
}

export function formatMoves(dirs: readonly Dir[]): string {
  const letters = dirs.map((d) => DIR_TO_LETTER[d]).join('');
  const lines: string[] = [];
  for (let i = 0; i < letters.length; i += 50) lines.push(letters.slice(i, i + 50));
  return lines.join('\n') + '\n';
}
