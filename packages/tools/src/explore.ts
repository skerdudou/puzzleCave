// `npm run explore -- <id…> [--timeout s] [--variants n] [--improve-top k] [--screen f]
// [--pass f] [--merge-window k] [--merge-neighbours n] [--merge-widen n] [--merge-states N] [--merge-timeout s]
// [--stage-states N] [--stage-states-max N] [--stage-timeout s] [--large-memory MB] [--seed n]
// [--max-memory MB] [--workers n] [--total-memory MB] [--from dir] [--save dir] [--apply]`: starting points improve cannot reach
// by local changes. The saved solution is cut into its events; a structural pass drops each
// stage and merges windows of stages into wide searches, then variants of that event plan
// (reordered, merged, dropped, unpinned, extra waters) are rebuilt by exact per-stage searches
// and ranked by length, and improve's windows run on the shortest few (packages/core/src/
// planner/explore.ts). A separate command rather than an improve flag: it needs a winning solution to
// start from and has its own knobs, and improve stays the reference pipeline (with its proof).
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  exploreLevel,
  formatMoves,
  parseSolution,
  railsPass,
  replay,
  type Dir,
} from '@puzzlecave/core';
import { loadPack } from '@puzzlecave/tiled';
import type { CommandResult } from './commands';
import { ExplorePool, defaultTotalMemoryMb, defaultWorkers, planWorkers } from './explorePool';
import { applySolution } from './plan';

export interface ExploreCommandOptions {
  /** per level */
  timeoutMs: number;
  variants: number;
  improveTop: number;
  /** share of the time spent screening */
  screen: number;
  /** share of a round given to the structural pass (0: none) */
  pass: number;
  /** largest window of merged stages */
  mergeWindow: number;
  mergeNeighbours: number;
  mergeWiden: number;
  mergeStates: number;
  mergeTimeoutMs: number;
  /** macro-states per stage, and the ceiling of its retries */
  stageStates: number;
  stageStatesMax: number;
  stageTimeoutMs: number;
  /** memory of each retried or wide search (MB) */
  largeMemoryMb: number;
  seed: number;
  maxMemoryMb?: number | undefined;
  /** worker threads of the structural pass (1: in the main thread; default: defaultWorkers) */
  workers?: number | undefined;
  /** memory of the pool and the main thread (MB; default: free memory − 4 GB) */
  totalMemoryMb?: number | undefined;
  /** directory where shorter solutions are written as <id>-<length>.txt */
  save?: string | undefined;
  /** directory of <id>-<length>.txt solutions to start from when shorter than the saved one */
  from?: string | undefined;
  /** the rails pass first (railsPass, keys and doors restricted then not), then the rounds */
  rails: boolean;
  /** the rails pass alone */
  railsOnly: boolean;
  /** macro-states and memory (MB) of each rails search */
  railsStates: number;
  railsMemoryMb: number;
  /** time of the rails pass (default: half of timeoutMs, all of it with railsOnly) */
  railsTimeoutMs?: number | undefined;
  apply: boolean;
  log?: (line: string) => void;
}

export const EXPLORE_USAGE =
  'usage: explore <id…> [--timeout s] [--variants n] [--improve-top k] [--screen f] [--pass f] [--merge-window k] [--merge-neighbours n] [--merge-widen n] [--merge-states N] [--merge-timeout s] [--stage-states N] [--stage-states-max N] [--stage-timeout s] [--large-memory MB] [--seed n] [--max-memory MB] [--workers n] [--total-memory MB] [--rails | --rails-only] [--rails-states N] [--rails-memory MB] [--rails-timeout s] [--from dir] [--save dir] [--apply]';

export function parseExploreArgs(
  args: string[],
): { ids: string[]; opts: ExploreCommandOptions } | { error: string } {
  const valued = new Set([
    '--timeout',
    '--variants',
    '--improve-top',
    '--screen',
    '--pass',
    '--merge-window',
    '--merge-neighbours',
    '--merge-widen',
    '--merge-states',
    '--merge-timeout',
    '--stage-states',
    '--stage-states-max',
    '--stage-timeout',
    '--large-memory',
    '--seed',
    '--max-memory',
    '--workers',
    '--total-memory',
    '--save',
    '--from',
    '--rails-states',
    '--rails-memory',
    '--rails-timeout',
  ]);
  const flags = new Set([...valued, '--apply', '--rails', '--rails-only']);
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
  const variants = num('--variants', 1_000_000);
  const top = num('--improve-top', 3);
  const screen = num('--screen', 0.3);
  const pass = num('--pass', 0.3);
  const window = num('--merge-window', 6);
  const neighbours = num('--merge-neighbours', 2);
  const widen = num('--merge-widen', 5);
  const mergeStates = num('--merge-states', 2_000_000);
  const mergeTimeout = num('--merge-timeout', 60);
  const stageStates = num('--stage-states', 200_000);
  const stageStatesMax = num('--stage-states-max', 3_200_000);
  const stageTimeout = num('--stage-timeout', 10);
  const largeMemory = num('--large-memory', 1024);
  const seed = num('--seed', 1);
  const mem = value('--max-memory') === undefined ? undefined : num('--max-memory', 0);
  const workers = value('--workers') === undefined ? undefined : num('--workers', 0);
  const total = value('--total-memory') === undefined ? undefined : num('--total-memory', 0);
  const save = value('--save');
  const from = value('--from');
  const railsStates = num('--rails-states', 20_000_000);
  const railsMemory = num('--rails-memory', 4000);
  const railsTimeout =
    value('--rails-timeout') === undefined ? undefined : num('--rails-timeout', 0);
  const badDir = (name: string, v: string | undefined) =>
    args.includes(name) && (v === undefined || v.startsWith('--'));
  if (
    !(timeout > 0) ||
    !(variants >= 1) ||
    !Number.isInteger(top) ||
    !(screen > 0 && screen <= 1) ||
    !(pass >= 0 && pass < 1) ||
    !Number.isInteger(window) ||
    !Number.isInteger(neighbours) ||
    !Number.isInteger(widen) ||
    !(mergeStates >= 1) ||
    !(mergeTimeout > 0) ||
    !(stageStates >= 1) ||
    !(stageStatesMax >= 1) ||
    !(stageTimeout > 0) ||
    !(largeMemory > 0) ||
    !Number.isInteger(seed) ||
    (mem !== undefined && !(mem > 0)) ||
    (workers !== undefined && !(Number.isInteger(workers) && workers >= 1)) ||
    (total !== undefined && !(total > 0)) ||
    badDir('--save', save) ||
    badDir('--from', from) ||
    !(railsStates >= 1) ||
    !(railsMemory > 0) ||
    (railsTimeout !== undefined && !(railsTimeout > 0)) ||
    (args.includes('--rails') && args.includes('--rails-only'))
  )
    return { error: EXPLORE_USAGE };
  if (args.some((a) => a.startsWith('--') && !flags.has(a))) return { error: EXPLORE_USAGE };
  const ids = args.filter((a, i) => !a.startsWith('--') && !valued.has(args[i - 1] ?? ''));
  if (ids.length === 0) return { error: EXPLORE_USAGE };
  return {
    ids,
    opts: {
      timeoutMs: timeout * 1000,
      variants: Math.floor(variants),
      improveTop: top,
      screen,
      pass,
      mergeWindow: window,
      mergeNeighbours: neighbours,
      mergeWiden: widen,
      mergeStates: Math.floor(mergeStates),
      mergeTimeoutMs: mergeTimeout * 1000,
      stageStates: Math.floor(stageStates),
      stageStatesMax: Math.floor(stageStatesMax),
      stageTimeoutMs: stageTimeout * 1000,
      largeMemoryMb: largeMemory,
      seed,
      maxMemoryMb: mem,
      workers,
      totalMemoryMb: total,
      save,
      from,
      rails: args.includes('--rails'),
      railsOnly: args.includes('--rails-only'),
      railsStates: Math.floor(railsStates),
      railsMemoryMb: railsMemory,
      railsTimeoutMs: railsTimeout === undefined ? undefined : railsTimeout * 1000,
      apply: args.includes('--apply'),
    },
  };
}

const sec = (ms: number) => `${(ms / 1000).toFixed(1)} s`;

export async function exploreCommand(
  dir: string,
  ids: string[],
  o: ExploreCommandOptions,
): Promise<CommandResult> {
  const pack = loadPack(dir);
  const byId = new Map(pack.levels.map((l) => [l.id, l]));
  const lines: string[] = [];
  // result lines, also streamed through log (levels take minutes each)
  const emit = (line: string) => {
    lines.push(line);
    o.log?.(line);
  };
  let ok = true;
  for (const id of ids) {
    const level = byId.get(id);
    const file = join(dir, 'solutions', `${id}.sol`);
    if (!level || !existsSync(file)) {
      emit(`${id}: ${level ? 'no saved solution' : 'unknown level'}`);
      ok = false;
      continue;
    }
    let saved: Dir[];
    try {
      saved = parseSolution(readFileSync(file, 'utf8'));
      if (replay(level, saved).status !== 'won') throw new Error('it does not win');
    } catch (err) {
      emit(`${id}: saved solution unusable — ${(err as Error).message}`);
      ok = false;
      continue;
    }
    // --from: start from the shortest winning <id>-<n>.txt of that directory if it beats the
    // saved solution (which stays the reference of --save and --apply)
    let start = saved;
    if (o.from && existsSync(o.from))
      for (const f of readdirSync(o.from)) {
        if (!new RegExp(`^${id}-\\d+\\.txt$`).test(f)) continue;
        try {
          const moves = parseSolution(readFileSync(join(o.from, f), 'utf8'));
          if (moves.length < start.length && replay(level, moves).status === 'won') start = moves;
        } catch {
          // unreadable: ignored
        }
      }
    if (start !== saved) emit(`${id}: starting from ${start.length} moves (${o.from})`);
    // the rails pass (exact searches on the solution's own block routes): keys and doors
    // restricted first (quick on key/door levels), then not; the rounds go on from its result
    let railsMs = 0;
    if (o.rails || o.railsOnly) {
      const budget = o.railsTimeoutMs ?? (o.railsOnly ? o.timeoutMs : o.timeoutMs / 2);
      for (const keyRails of [true, false]) {
        const left = budget - railsMs;
        if (left <= 0) break;
        const rr = railsPass(level, start, {
          keyRails,
          maxStates: o.railsStates,
          maxMemoryMb: o.railsMemoryMb,
          timeoutMs: left,
          log: (line) => o.log?.(`${id}: ${line}`),
        });
        railsMs += rr.ms;
        const certified = rr.reached === 0 ? ' (optimal on its own rails)' : '';
        emit(
          `${id}: rails${keyRails ? ' (keys)' : ''}: ${start.length} → ${rr.moves.length} moves, searched back to cut ${rr.reached}/${rr.moves.length}${certified}, ${rr.searches} search(es)${rr.timedOut ? ', out of time' : ''} — ${sec(rr.ms)}`,
        );
        start = rr.moves;
      }
    }
    let best = start;
    if (!o.railsOnly) {
      // worker threads of the structural pass, as many as the memory allows
      const plan = planWorkers(
        o.workers ?? defaultWorkers(),
        o.totalMemoryMb ?? defaultTotalMemoryMb(),
        o.largeMemoryMb,
        o.maxMemoryMb ?? 256,
      );
      const rebuild = {
        maxStates: o.stageStates,
        maxStatesLimit: o.stageStatesMax,
        stageTimeoutMs: o.stageTimeoutMs,
        largeMemoryMb: plan.largeMemoryMb,
        mergeStates: o.mergeStates,
        mergeTimeoutMs: o.mergeTimeoutMs,
        ...(o.maxMemoryMb !== undefined ? { maxMemoryMb: o.maxMemoryMb } : {}),
      };
      const pool =
        o.pass > 0 && plan.workers > 1 ? new ExplorePool(level, rebuild, plan.workers) : undefined;
      if (pool || plan.largeMemoryMb < o.largeMemoryMb)
        o.log?.(
          `${id}: structural pass on ${plan.workers} thread(s), ${plan.perWorkerMb} MB each (large searches ${plan.largeMemoryMb} MB)`,
        );
      let r;
      try {
        r = await exploreLevel(level, start, {
          ...rebuild,
          // what the rails pass left of the level's time
          timeoutMs: Math.max(1000, o.timeoutMs - railsMs),
          variants: o.variants,
          improveTop: o.improveTop,
          screenFraction: o.screen,
          passFraction: o.pass,
          window: o.mergeWindow,
          neighbours: o.mergeNeighbours,
          widen: o.mergeWiden,
          seed: o.seed,
          ...(pool ? { runner: pool } : {}),
          log: (line) => o.log?.(`${id}: ${line}`),
        });
      } finally {
        await pool?.close();
      }
      const improved = r.improved.map((v) => `${v.before} → ${v.after}`).join(', ');
      const pass = r.passGains.map((g) => `${g.before} → ${g.after}`).join(', ');
      emit(
        `${id}: ${r.initialLength} → ${r.moves.length} moves — ${r.rounds} round(s), pass ${pass || '-'}, ${r.tried} variants (${r.feasible} feasible, ${r.retries} stage retries), plan rebuilt ${r.baseLength ?? 'failed'}, best variant of round 1 ${r.bestScreened ?? '-'}, improved ${improved || '-'} — ${sec(r.ms)}`,
      );
      best = r.moves;
    }
    if (best.length < saved.length) {
      if (o.save) {
        mkdirSync(o.save, { recursive: true });
        const out = join(o.save, `${id}-${best.length}.txt`);
        writeFileSync(out, formatMoves(best));
        emit(`${id}: shorter solution saved to ${out}`);
      }
      if (o.apply) applySolution(dir, level, best, 0).forEach(emit);
    }
  }
  return { ok, lines };
}
