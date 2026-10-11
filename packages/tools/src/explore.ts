// `npm run explore -- <id…> [--timeout s] [--variants n] [--improve-top k] [--screen f]
// [--seed n] [--max-memory MB] [--from dir] [--save dir] [--apply]`: starting points improve cannot reach by
// local changes. The saved solution is cut into its events; variants of that event plan
// (reordered, merged, unpinned, extra waters) are rebuilt by exact per-stage searches and
// ranked by length, then improve's windows run on the shortest few (packages/core/src/planner/
// explore.ts). A separate command rather than an improve flag: it needs a winning solution to
// start from and has its own knobs, and improve stays the reference pipeline (with its proof).
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { exploreLevel, formatMoves, parseMoves, replay, type Dir } from '@puzzlecave/core';
import { loadPack } from '@puzzlecave/tiled';
import type { CommandResult } from './commands';
import { applySolution } from './plan';

export interface ExploreCommandOptions {
  /** per level */
  timeoutMs: number;
  variants: number;
  improveTop: number;
  /** share of the time spent screening */
  screen: number;
  seed: number;
  maxMemoryMb?: number | undefined;
  /** directory where shorter solutions are written as <id>-<length>.txt */
  save?: string | undefined;
  /** directory of <id>-<length>.txt solutions to start from when shorter than the saved one */
  from?: string | undefined;
  apply: boolean;
  log?: (line: string) => void;
}

export const EXPLORE_USAGE =
  'usage: explore <id…> [--timeout s] [--variants n] [--improve-top k] [--screen f] [--seed n] [--max-memory MB] [--from dir] [--save dir] [--apply]';

export function parseExploreArgs(
  args: string[],
): { ids: string[]; opts: ExploreCommandOptions } | { error: string } {
  const valued = new Set([
    '--timeout',
    '--variants',
    '--improve-top',
    '--screen',
    '--seed',
    '--max-memory',
    '--save',
    '--from',
  ]);
  const flags = new Set([...valued, '--apply']);
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
  const seed = num('--seed', 1);
  const mem = value('--max-memory') === undefined ? undefined : num('--max-memory', 0);
  const save = value('--save');
  const from = value('--from');
  const badDir = (name: string, v: string | undefined) =>
    args.includes(name) && (v === undefined || v.startsWith('--'));
  if (
    !(timeout > 0) ||
    !(variants >= 1) ||
    !Number.isInteger(top) ||
    !(screen > 0 && screen <= 1) ||
    !Number.isInteger(seed) ||
    (mem !== undefined && !(mem > 0)) ||
    badDir('--save', save) ||
    badDir('--from', from)
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
      seed,
      maxMemoryMb: mem,
      save,
      from,
      apply: args.includes('--apply'),
    },
  };
}

const sec = (ms: number) => `${(ms / 1000).toFixed(1)} s`;

export function exploreCommand(
  dir: string,
  ids: string[],
  o: ExploreCommandOptions,
): CommandResult {
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
    const file = join(dir, 'solutions', `${id}.txt`);
    if (!level || !existsSync(file)) {
      emit(`${id}: ${level ? 'no saved solution' : 'unknown level'}`);
      ok = false;
      continue;
    }
    let saved: Dir[];
    try {
      saved = parseMoves(readFileSync(file, 'utf8'));
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
          const moves = parseMoves(readFileSync(join(o.from, f), 'utf8'));
          if (moves.length < start.length && replay(level, moves).status === 'won') start = moves;
        } catch {
          // unreadable: ignored
        }
      }
    if (start !== saved) emit(`${id}: starting from ${start.length} moves (${o.from})`);
    const r = exploreLevel(level, start, {
      timeoutMs: o.timeoutMs,
      variants: o.variants,
      improveTop: o.improveTop,
      screenFraction: o.screen,
      seed: o.seed,
      ...(o.maxMemoryMb !== undefined ? { maxMemoryMb: o.maxMemoryMb } : {}),
      log: (line) => o.log?.(`${id}: ${line}`),
    });
    const improved = r.improved.map((v) => `${v.before} → ${v.after}`).join(', ');
    emit(
      `${id}: ${r.initialLength} → ${r.moves.length} moves — ${r.rounds} round(s), ${r.tried} variants (${r.feasible} feasible), plan rebuilt ${r.baseLength ?? 'failed'}, best variant of round 1 ${r.bestScreened ?? '-'}, improved ${improved || '-'} — ${sec(r.ms)}`,
    );
    if (r.moves.length < saved.length) {
      if (o.save) {
        mkdirSync(o.save, { recursive: true });
        const out = join(o.save, `${id}-${r.moves.length}.txt`);
        writeFileSync(out, formatMoves(r.moves));
        emit(`${id}: shorter solution saved to ${out}`);
      }
      if (o.apply) applySolution(dir, level, r.moves, 0).forEach(emit);
    }
  }
  return { ok, lines };
}
