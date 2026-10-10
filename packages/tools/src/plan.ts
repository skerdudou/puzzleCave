// `npm run plan -- <id…> [--timeout s] [--keys auto|explicit] [--improve s] [--max-memory MB]
// [--apply]`: event planner (sub-goals with frozen blocks), then optionally the improve pipeline
// started from the plan. --apply saves the result only if it wins and is shorter than the saved
// solution, and lowers goldMoves when it is shorter.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  formatMoves,
  improveLevel,
  parseMoves,
  planSolution,
  replay,
  type Dir,
  type LevelData,
} from '@puzzlecave/core';
import { loadPack, setMapProperty } from '@puzzlecave/tiled';
import { solutionHeader, type CommandResult } from './commands';

export interface PlanCommandOptions {
  timeoutMs: number;
  keys: 'auto' | 'explicit';
  /** improve pipeline duration after the plan (0: none) */
  improveMs: number;
  maxMemoryMb?: number | undefined;
  apply: boolean;
  log?: (line: string) => void;
}

export const PLAN_USAGE =
  'usage: plan <id…> [--timeout s] [--keys auto|explicit] [--improve s] [--max-memory MB] [--apply]';

export function parsePlanArgs(
  args: string[],
): { ids: string[]; opts: PlanCommandOptions } | { error: string } {
  const valued = new Set(['--timeout', '--keys', '--improve', '--max-memory']);
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
  const timeout = num('--timeout', 300);
  const improve = num('--improve', 0);
  const mem = value('--max-memory') === undefined ? undefined : num('--max-memory', 0);
  const keys = value('--keys') ?? 'explicit';
  if (!(timeout > 0) || Number.isNaN(improve) || (mem !== undefined && !(mem > 0)))
    return { error: PLAN_USAGE };
  if (keys !== 'auto' && keys !== 'explicit') return { error: PLAN_USAGE };
  const ids = args.filter((a, i) => !a.startsWith('--') && !valued.has(args[i - 1] ?? ''));
  if (ids.length === 0) return { error: PLAN_USAGE };
  return {
    ids,
    opts: {
      timeoutMs: timeout * 1000,
      keys,
      improveMs: improve * 1000,
      maxMemoryMb: mem,
      apply: args.includes('--apply'),
    },
  };
}

const sec = (ms: number) => `${(ms / 1000).toFixed(1)} s`;

export function planCommand(dir: string, ids: string[], o: PlanCommandOptions): CommandResult {
  const pack = loadPack(dir);
  const byId = new Map(pack.levels.map((l) => [l.id, l]));
  const lines: string[] = [];
  let ok = true;
  for (const id of ids) {
    const level = byId.get(id);
    if (!level) {
      lines.push(`${id}: unknown level`);
      ok = false;
      continue;
    }
    const t0 = performance.now();
    const r = planSolution(level, { timeoutMs: o.timeoutMs, keys: o.keys, log: o.log });
    const stats = `${r.expanded} event states, ${r.subSearches} sub-searches, ${r.subStates} macro-states`;
    if (r.status !== 'solved') {
      lines.push(`${id}: no plan (${r.reason}) — ${stats}, ${sec(performance.now() - t0)}`);
      ok = false;
      continue;
    }
    lines.push(
      `${id}: plan of ${r.moves.length} moves, ${r.events.length} events — ${stats}, ${sec(performance.now() - t0)}`,
    );
    for (const e of r.events) lines.push(`  ${e}`);
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
    if (o.apply) lines.push(...apply(dir, level, best, lowerBound));
  }
  return { ok, lines };
}

/** writes the solution if it wins and beats the saved one; lowers goldMoves accordingly */
function apply(dir: string, level: LevelData, moves: Dir[], lowerBound: number): string[] {
  if (replay(level, moves).status !== 'won') return [`${level.id}: plan rejected (does not win)`];
  const file = join(dir, 'solutions', `${level.id}.txt`);
  if (existsSync(file)) {
    try {
      const saved = parseMoves(readFileSync(file, 'utf8'));
      if (replay(level, saved).status === 'won' && saved.length <= moves.length)
        return [`${level.id}: saved solution (${saved.length}) kept`];
    } catch {
      // unreadable: replaced
    }
  }
  mkdirSync(join(dir, 'solutions'), { recursive: true });
  writeFileSync(file, `${solutionHeader(false, lowerBound)}\n${formatMoves(moves)}`);
  const gold = level.thresholds.goldMoves;
  if (gold === undefined || moves.length < gold) {
    const tmx = join(dir, `${level.id}.tmx`);
    writeFileSync(tmx, setMapProperty(readFileSync(tmx, 'utf8'), 'goldMoves', moves.length));
  }
  return [`${level.id}: solution written (${moves.length} moves)`];
}
