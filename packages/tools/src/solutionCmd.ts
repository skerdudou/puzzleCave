// `npm run solution -- show <id | file>` and `npm run solution -- set <id> <file> [--force]`:
// the solution files (levels/solutions/<id>.sol) hold their moves encoded (core solutionFile.ts),
// so that they cannot be pasted as is into the game's replay import. `show` prints one as U/D/L/R
// letters (its comment lines kept); `set` saves a solution given as letters (a player's, by hand)
// or encoded: it must win, and be shorter than the saved one unless --force. The saved header is
// kept (status, proven lower bound); the thresholds are not touched.
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { formatSolution, parseSolution, replay, solutionToLetters } from '@puzzlecave/core';
import { loadPack } from '@puzzlecave/tiled';
import type { CommandResult } from './commands';

export const SOLUTION_USAGE =
  'usage: solution show <id | file>  |  solution set <id> <file> [--force]';

/** The default header of a solution saved by `set` over none. */
const DEFAULT_HEADER = '# best known — not proven optimal';

export function solutionCommand(dir: string, args: string[]): CommandResult {
  const [sub, a, b] = args.filter((x) => !x.startsWith('--'));
  const force = args.includes('--force');
  const file = (id: string) => join(dir, 'solutions', `${id}.sol`);
  if (sub === 'show' && a) {
    // the level's solution first; else a file of that name
    const path = existsSync(file(a)) ? file(a) : a;
    if (!existsSync(path)) return { ok: false, lines: [`${a}: no such solution`] };
    return { ok: true, lines: solutionToLetters(readFileSync(path, 'utf8')).trimEnd().split('\n') };
  }
  if (sub === 'set' && a && b) {
    const level = loadPack(dir).levels.find((l) => l.id === a);
    if (!level) return { ok: false, lines: [`${a}: unknown level`] };
    if (!existsSync(b)) return { ok: false, lines: [`${b}: no such file`] };
    let moves;
    try {
      moves = parseSolution(readFileSync(b, 'utf8'));
    } catch (err) {
      return { ok: false, lines: [`${b}: unreadable — ${(err as Error).message}`] };
    }
    const end = replay(level, moves);
    if (end.status !== 'won')
      return { ok: false, lines: [`${a}: the solution does not win (status ${end.status})`] };
    const target = file(a);
    const old = existsSync(target) ? readFileSync(target, 'utf8') : undefined;
    let oldLength: number | undefined;
    try {
      oldLength = old === undefined ? undefined : parseSolution(old).length;
    } catch {
      oldLength = undefined;
    }
    if (oldLength !== undefined && moves.length >= oldLength && !force)
      return {
        ok: false,
        lines: [
          `${a}: ${moves.length} moves, not shorter than the saved ${oldLength}; --force to replace`,
        ],
      };
    // the saved header (its status, its proven lower bound) holds for a solution not longer; a
    // longer one (--force) is not the proven optimum the header may claim: best known
    const kept = old?.split(/\r?\n/).find((l) => l.startsWith('#'));
    const header =
      kept !== undefined && oldLength !== undefined && moves.length <= oldLength
        ? kept
        : DEFAULT_HEADER;
    writeFileSync(target, formatSolution(moves, header));
    return {
      ok: true,
      lines: [
        `${a}: ${moves.length} moves written to solutions/${a}.sol${oldLength !== undefined ? ` (was ${oldLength})` : ''}; thresholds unchanged`,
      ],
    };
  }
  return { ok: false, lines: [SOLUTION_USAGE] };
}
