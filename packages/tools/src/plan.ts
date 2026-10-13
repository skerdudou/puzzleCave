// `npm run plan -- <id…> [--timeout s] [--keys auto|explicit] [planner limits] [--improve s]
// [--max-memory MB] [--apply]`: event planner (sub-goals with frozen blocks), then optionally the improve pipeline
// started from the plan. --apply saves the result only if it wins and is shorter than the saved
// solution, and lowers platinumMoves when it is shorter (goldMoves only for a level without one).
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
  type PlanOptions,
  type PlanStats,
} from '@puzzlecave/core';
import { loadPack } from '@puzzlecave/tiled';
import {
  applyThresholds,
  savedLowerBound,
  savedWinningMoves,
  solutionHeader,
  type CommandResult,
} from './commands';

export interface PlanCommandOptions {
  timeoutMs: number;
  keys: 'auto' | 'explicit';
  /** improve pipeline duration after the plan (0: none) */
  improveMs: number;
  maxMemoryMb?: number | undefined;
  apply: boolean;
  /** planner limits given on the command line (planner defaults otherwise) */
  planner: PlannerLimits;
  log?: (line: string) => void;
}

export type PlannerLimits = Pick<
  PlanOptions,
  | 'maxFree'
  | 'fillFree'
  | 'exitFree'
  | 'maxTries'
  | 'maxSubStates'
  | 'alternatives'
  | 'widen'
  | 'sideKeys'
  | 'allDoorsLevel'
>;

/** integer flags of the planner limits */
const LIMIT_FLAGS: [string, keyof PlannerLimits][] = [
  ['--max-free', 'maxFree'],
  ['--fill-free', 'fillFree'],
  ['--exit-free', 'exitFree'],
  ['--tries', 'maxTries'],
  ['--sub-states', 'maxSubStates'],
  ['--alternatives', 'alternatives'],
  ['--widen', 'widen'],
  ['--all-doors', 'allDoorsLevel'],
];

export const PLAN_USAGE =
  'usage: plan <id…> [--timeout s] [--keys auto|explicit] [--max-free n] [--fill-free n] [--exit-free n] [--tries n] [--sub-states n] [--alternatives k] [--widen n] [--all-doors level] [--side-keys on|off] [--improve s] [--max-memory MB] [--apply]';

export function parsePlanArgs(
  args: string[],
): { ids: string[]; opts: PlanCommandOptions } | { error: string } {
  const valued = new Set([
    '--timeout',
    '--keys',
    '--improve',
    '--max-memory',
    '--side-keys',
    ...LIMIT_FLAGS.map(([f]) => f),
  ]);
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
  const planner: PlannerLimits = {};
  for (const [flag, field] of LIMIT_FLAGS) {
    if (value(flag) === undefined) continue;
    const n = num(flag, 0);
    if (!Number.isInteger(n)) return { error: PLAN_USAGE };
    (planner as Record<string, number>)[field] = n;
  }
  const side = value('--side-keys');
  if (side !== undefined) {
    if (side !== 'on' && side !== 'off') return { error: PLAN_USAGE };
    planner.sideKeys = side === 'on';
  }
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
      planner,
    },
  };
}

const sec = (ms: number) => `${(ms / 1000).toFixed(1)} s`;

/** per event kind: realised / attempted, macro-states, and the caps that stopped events */
export function kindLines(r: PlanStats): string[] {
  return Object.entries(r.kinds)
    .filter(([, k]) => k.attempts > 0)
    .map(
      ([kind, k]) =>
        `  ${kind}: ${k.realised}/${k.attempts} realised, ${k.searches} searches, ${k.states} macro-states; capped: ${k.full} by --sub-states, ${k.freeCapped} by free blocks, ${k.triesCapped} by --tries`,
    );
}

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
    const r = planSolution(level, {
      ...o.planner,
      timeoutMs: o.timeoutMs,
      keys: o.keys,
      ...(o.log ? { log: o.log } : {}),
    });
    const stats = `${r.expanded} event states (${r.widened} widened), ${r.subSearches} sub-searches, ${r.subStates} macro-states`;
    if (r.status !== 'solved') {
      lines.push(`${id}: no plan (${r.reason}) — ${stats}, ${sec(performance.now() - t0)}`);
      lines.push(...kindLines(r));
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
    if (o.apply) lines.push(...applySolution(dir, level, best, lowerBound));
  }
  return { ok, lines };
}

/** writes the solution if it wins and beats the saved one; sets the thresholds (applyThresholds) */
export function applySolution(
  dir: string,
  level: LevelData,
  moves: Dir[],
  lowerBound: number,
): string[] {
  if (replay(level, moves).status !== 'won')
    return [`${level.id}: solution rejected (does not win)`];
  const file = join(dir, 'solutions', `${level.id}.txt`);
  const previous = savedWinningMoves(dir, level);
  if (existsSync(file)) {
    try {
      lowerBound = Math.max(lowerBound, savedLowerBound(file));
      const saved = parseMoves(readFileSync(file, 'utf8'));
      if (replay(level, saved).status === 'won' && saved.length <= moves.length)
        return [`${level.id}: saved solution (${saved.length}) kept`];
    } catch {
      // unreadable: replaced
    }
  }
  mkdirSync(join(dir, 'solutions'), { recursive: true });
  writeFileSync(file, `${solutionHeader(false, lowerBound)}\n${formatMoves(moves)}`);
  return [
    `${level.id}: solution written (${moves.length} moves)`,
    ...applyThresholds(dir, level, moves, { previous }),
  ];
}
