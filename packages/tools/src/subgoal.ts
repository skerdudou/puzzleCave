// `npm run subgoal -- <id> <stages-file> [--from-solution] [--timeout s] [--max-states N]
// [--max-memory MB] [--improve s] [--apply]`: hand-written sub-goal plan (format in
// packages/core/src/planner/stages.ts). Each stage is one restricted search from the end of the
// previous one; the chained moves must win with the real rules. --from-solution first writes the
// stages of the saved solution into the stages file (to edit, e.g. reorder, and rebuild).
// --apply follows the rules of `plan --apply`.
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  deriveStages,
  formatStage,
  formatStages,
  improveLevel,
  parseMoves,
  parseStages,
  runStages,
  type Dir,
} from '@puzzlecave/core';
import { loadPack } from '@puzzlecave/tiled';
import type { CommandResult } from './commands';
import { applySolution } from './plan';

export interface SubgoalCommandOptions {
  /** per stage */
  timeoutMs: number;
  maxStates: number;
  maxMemoryMb?: number | undefined;
  fromSolution: boolean;
  /** improve pipeline duration after the stages (0: none) */
  improveMs: number;
  apply: boolean;
}

export const SUBGOAL_USAGE =
  'usage: subgoal <id> <stages-file> [--from-solution] [--timeout s] [--max-states N] [--max-memory MB] [--improve s] [--apply]';

export function parseSubgoalArgs(
  args: string[],
): { id: string; file: string; opts: SubgoalCommandOptions } | { error: string } {
  const valued = new Set(['--timeout', '--max-states', '--improve', '--max-memory']);
  const flags = new Set([...valued, '--from-solution', '--apply']);
  const value = (name: string) => {
    const i = args.indexOf(name);
    return i < 0 ? undefined : args[i + 1];
  };
  const num = (name: string, def: number) => {
    const raw = value(name);
    if (raw === undefined) return def;
    const n = Number(raw);
    return Number.isFinite(n) && n >= 0 ? n : NaN;
  };
  const timeout = num('--timeout', 60);
  const maxStates = num('--max-states', 200_000);
  const improve = num('--improve', 0);
  const mem = value('--max-memory') === undefined ? undefined : num('--max-memory', 0);
  if (
    !(timeout > 0) ||
    !(maxStates >= 1) ||
    Number.isNaN(improve) ||
    (mem !== undefined && !(mem > 0))
  )
    return { error: SUBGOAL_USAGE };
  if (args.some((a) => a.startsWith('--') && !flags.has(a))) return { error: SUBGOAL_USAGE };
  const pos = args.filter((a, i) => !a.startsWith('--') && !valued.has(args[i - 1] ?? ''));
  if (pos.length !== 2) return { error: SUBGOAL_USAGE };
  return {
    id: pos[0]!,
    file: pos[1]!,
    opts: {
      timeoutMs: timeout * 1000,
      maxStates: Math.floor(maxStates),
      maxMemoryMb: mem,
      fromSolution: args.includes('--from-solution'),
      improveMs: improve * 1000,
      apply: args.includes('--apply'),
    },
  };
}

const sec = (ms: number) => `${(ms / 1000).toFixed(1)} s`;

export function subgoalCommand(
  dir: string,
  id: string,
  file: string,
  o: SubgoalCommandOptions,
): CommandResult {
  const level = loadPack(dir).levels.find((l) => l.id === id);
  if (!level) return { ok: false, lines: [`${id}: unknown level`] };
  const lines: string[] = [];
  if (o.fromSolution) {
    if (existsSync(file))
      return { ok: false, lines: [`${file}: already exists (not overwritten)`] };
    const sol = join(dir, 'solutions', `${id}.txt`);
    if (!existsSync(sol)) return { ok: false, lines: [`${id}: no saved solution`] };
    let stages;
    try {
      stages = deriveStages(level, parseMoves(readFileSync(sol, 'utf8')));
    } catch (err) {
      return { ok: false, lines: [`${id}: saved solution: ${(err as Error).message}`] };
    }
    writeFileSync(
      file,
      `# ${id}: stages of the saved solution (npm run subgoal -- ${id} <this file>)\n` +
        formatStages(stages, level.width),
    );
    lines.push(`${id}: ${stages.length} stages written to ${file}`);
  }
  if (!existsSync(file)) return { ok: false, lines: [...lines, `${file}: not found`] };
  let stages;
  try {
    stages = parseStages(readFileSync(file, 'utf8'), level.width, level.height);
  } catch (err) {
    return { ok: false, lines: [...lines, `${file}: ${(err as Error).message}`] };
  }
  const t0 = performance.now();
  const r = runStages(level, stages, {
    maxStates: o.maxStates,
    timeoutMs: o.timeoutMs,
    ...(o.maxMemoryMb !== undefined ? { maxMemoryMb: o.maxMemoryMb } : {}),
  });
  let total = 0;
  for (const rep of r.stages) {
    total += rep.moves;
    const st = stages[rep.index - 1]!;
    lines.push(
      `  ${rep.index}. line ${rep.line}: ${formatStage({ ...st, comment: '' }, level.width)} — ${rep.moves} moves (total ${total}), ${rep.explored} macro-states, ${sec(rep.ms)}`,
    );
  }
  if (r.status !== 'won') {
    const where = r.index > stages.length ? 'end' : `stage ${r.index} (line ${r.line})`;
    lines.push(`${id}: ${where} failed: ${r.reason} — ${r.moves.length} moves before it`);
    return { ok: false, lines };
  }
  lines.push(
    `${id}: ${r.moves.length} moves from ${stages.length} stages, wins — ${sec(performance.now() - t0)}`,
  );
  let best: Dir[] = r.moves;
  let lowerBound = 0;
  if (o.improveMs > 0) {
    const t1 = performance.now();
    const im = improveLevel(level, {
      initial: r.moves,
      timeoutMs: o.improveMs,
      ...(o.maxMemoryMb !== undefined ? { maxMemoryMb: o.maxMemoryMb } : {}),
    });
    if (im.moves) best = im.moves;
    lowerBound = im.lowerBound;
    lines.push(
      `${id}: improve ${r.moves.length} → ${best.length} moves${im.proven ? ' (proven)' : ` (≥ ${im.lowerBound})`}, ${sec(performance.now() - t1)}`,
    );
  }
  if (o.apply) lines.push(...applySolution(dir, level, best, lowerBound));
  return { ok: true, lines };
}
