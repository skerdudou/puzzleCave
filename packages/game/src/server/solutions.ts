import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { parseMoves } from '@puzzlecave/core';

/** A saved solution: levels/solutions/<id>.txt (not the <id>.prev.txt kept during an optimization). */
const SOLUTION_FILE = /^([a-z0-9][a-z0-9-]*)\.txt$/;

/** The saved solutions of the levels folder, as their text by level id (empty: none saved). */
export function readSolutions(levelsDir: string): Record<string, string> {
  const dir = join(levelsDir, 'solutions');
  if (!existsSync(dir)) return {};
  const out: Record<string, string> = {};
  for (const f of readdirSync(dir).sort()) {
    const m = SOLUTION_FILE.exec(f);
    if (m && !f.endsWith('.prev.txt')) out[m[1]!] = readFileSync(join(dir, f), 'utf8');
  }
  return out;
}

/** A solution's header that marks it proven optimal (as packages/tools writes it). */
const PROVEN = '# optimal (proven)';

/**
 * The proven optimum, in moves, of each level whose saved solution is marked "# optimal (proven)":
 * nobody can finish such a level in fewer moves (the release gets it, not the solutions).
 */
export function provenOptima(levelsDir: string): Record<string, number> {
  const out: Record<string, number> = {};
  for (const [id, text] of Object.entries(readSolutions(levelsDir))) {
    const header = text.split(/\r?\n/).find((l) => l.startsWith('#'));
    if (header?.trim() === PROVEN) out[id] = parseMoves(text).length;
  }
  return out;
}
