// `npm run longrun -- <id> [options]`: external exact search of one level bounded by its saved
// solution (see search.ts); options in LONGRUN_USAGE and DEVELOPMENT.md.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { availableParallelism, freemem } from 'node:os';
import { join } from 'node:path';
import { formatMoves, parseMoves, replay, type Dir, type LevelData } from '@puzzlecave/core';
import { loadPack, setMapProperty } from '@puzzlecave/tiled';
import { solutionHeader, type CommandResult } from '../commands';
import type { Dominance } from './expander';
import { LongRun, type LongRunResult } from './search';

const MB = 1024 ** 2;

export const LONGRUN_USAGE =
  'usage: longrun <id> [--work-dir d] [--max-disk GB] [--max-memory MB] [--threads n] [--partitions n] [--timeout s] [--bound n] [--watch file]… [--gen-strong slack] [--dead-pruning] [--dominance off|player|keys] [--compress none|gen|all] [--gpu auto|on|off] [--resume] [--apply]';

export interface LongRunCommandOptions {
  id: string;
  workDir: string | undefined;
  maxDiskGb: number;
  maxMemoryMb: number | undefined;
  threads: number | undefined;
  parts: number | undefined;
  timeoutMs: number | undefined;
  bound: number | undefined;
  /** other solution files of the level: a shorter winning one lowers the bound */
  watch: string[];
  genStrongSlack: number | undefined;
  deadPruning: boolean;
  dominance: Dominance;
  compress: 'none' | 'gen' | 'all';
  gpu: 'auto' | 'on' | 'off';
  resume: boolean;
  apply: boolean;
}

export function parseLongRunArgs(args: string[]): LongRunCommandOptions | { error: string } {
  const valued = new Set([
    '--work-dir',
    '--max-disk',
    '--max-memory',
    '--threads',
    '--partitions',
    '--timeout',
    '--bound',
    '--watch',
    '--gen-strong',
    '--compress',
    '--gpu',
    '--dominance',
  ]);
  const value = (name: string) => {
    const i = args.indexOf(name);
    return i < 0 ? undefined : args[i + 1];
  };
  const num = (name: string, min: number): number | undefined | null => {
    const raw = value(name);
    if (raw === undefined) return undefined;
    const n = Number(raw);
    return Number.isFinite(n) && n >= min ? n : null;
  };
  const nums = {
    maxDiskGb: num('--max-disk', 0.001),
    maxMemoryMb: num('--max-memory', 64),
    threads: num('--threads', 0),
    parts: num('--partitions', 1),
    timeout: num('--timeout', 1),
    bound: num('--bound', 1),
    genStrong: num('--gen-strong', 0),
  };
  if (Object.values(nums).some((v) => v === null)) return { error: LONGRUN_USAGE };
  if (nums.parts != null && !Number.isInteger(Math.log2(nums.parts)))
    return { error: `--partitions expects a power of two\n${LONGRUN_USAGE}` };
  const ids = args.filter((a, i) => !a.startsWith('--') && !valued.has(args[i - 1] ?? ''));
  if (ids.length !== 1) return { error: LONGRUN_USAGE };
  if (!['auto', 'on', 'off'].includes(value('--gpu') ?? 'auto'))
    return { error: `--gpu expects auto, on or off\n${LONGRUN_USAGE}` };
  if (!['off', 'player', 'keys'].includes(value('--dominance') ?? 'keys'))
    return { error: `--dominance expects off, player or keys\n${LONGRUN_USAGE}` };
  if (!['none', 'gen', 'all'].includes(value('--compress') ?? 'gen'))
    return { error: `--compress expects none, gen or all\n${LONGRUN_USAGE}` };
  return {
    id: ids[0]!,
    workDir: value('--work-dir'),
    maxDiskGb: nums.maxDiskGb ?? 100,
    maxMemoryMb: nums.maxMemoryMb ?? undefined,
    threads: nums.threads == null ? undefined : Math.floor(nums.threads),
    parts: nums.parts ?? undefined,
    timeoutMs: nums.timeout == null ? undefined : nums.timeout * 1000,
    bound: nums.bound ?? undefined,
    watch: args.flatMap((a, i) => (args[i - 1] === '--watch' ? [a] : [])),
    genStrongSlack: nums.genStrong ?? undefined,
    deadPruning: args.includes('--dead-pruning'),
    dominance: (value('--dominance') ?? 'keys') as Dominance,
    compress: (value('--compress') ?? 'gen') as 'none' | 'gen' | 'all',
    gpu: (value('--gpu') ?? 'auto') as 'auto' | 'on' | 'off',
    resume: args.includes('--resume'),
    apply: args.includes('--apply'),
  };
}

/** saved solution if it wins */
function savedSolution(dir: string, level: LevelData): Dir[] | undefined {
  return winning(join(dir, 'solutions', `${level.id}.txt`), level);
}

/** the solution of a file if it wins */
function winning(file: string, level: LevelData): Dir[] | undefined {
  if (!existsSync(file)) return undefined;
  try {
    const moves = parseMoves(readFileSync(file, 'utf8'));
    return replay(level, moves).status === 'won' ? moves : undefined;
  } catch {
    return undefined;
  }
}

/** lower bound written in the header of the saved solution */
function savedLowerBound(dir: string, id: string): number {
  const file = join(dir, 'solutions', `${id}.txt`);
  if (!existsSync(file)) return 0;
  const text = readFileSync(file, 'utf8');
  if (/^# optimal \(proven\)/.test(text)) return Infinity;
  const m = /proven lower bound ≥ (\d+)/.exec(text.split(/\r?\n/)[0] ?? '');
  return m ? Number(m[1]) : 0;
}

export async function longRunCommand(
  dir: string,
  o: LongRunCommandOptions,
  log: (line: string) => void,
  onRun?: (run: LongRun) => void,
): Promise<CommandResult> {
  const pack = loadPack(dir);
  const level = pack.levels.find((l) => l.id === o.id);
  if (!level) return { ok: false, lines: [`${o.id}: unknown level`] };
  const workDir = o.workDir ?? join(dir, '..', '.oneshot', 'longrun', o.id);
  mkdirSync(workDir, { recursive: true });
  const saved = savedSolution(dir, level);
  const bound = () => {
    // explicit --bound: replaces the saved solution (the watched files still lower it)
    let b = o.bound ?? savedSolution(dir, level)?.length ?? Infinity;
    for (const file of o.watch) b = Math.min(b, winning(file, level)?.length ?? Infinity);
    return b;
  };
  const threads = o.threads ?? Math.max(1, Math.floor(availableParallelism() / 2));
  const maxMemoryMb =
    o.maxMemoryMb ?? Math.max(256, Math.min(8192, Math.floor((freemem() / MB) * 0.5)));
  const start = bound();
  log(
    `${level.id}: saved solution ${saved ? `${saved.length} moves` : 'none'}; searching for fewer than ${Number.isFinite(start) ? start : 'the horizon'} moves; work dir ${workDir}`,
  );
  const run = new LongRun(level, {
    workDir,
    upperBound: Number.isFinite(start) ? start : undefined,
    boundSource: () => {
      const b = bound();
      return Number.isFinite(b) ? b : undefined;
    },
    parts: o.parts,
    threads,
    maxMemoryMb,
    maxDiskGb: o.maxDiskGb,
    resume: o.resume,
    timeoutMs: o.timeoutMs,
    genStrongSlack: o.genStrongSlack,
    deadPruning: o.deadPruning,
    dominance: o.dominance,
    compress: o.compress,
    gpu: o.gpu,
    log,
  });
  onRun?.(run);
  const r = await run.run();
  return report(dir, workDir, level, r, o.apply);
}

function report(
  dir: string,
  workDir: string,
  level: LevelData,
  r: LongRunResult,
  apply: boolean,
): CommandResult {
  const id = level.id;
  const s = r.stats;
  const lines = [
    `${id}: ${s.layers} layers, ${s.expanded} states expanded, ${s.emitted} successors written, ${(s.ms / 1000).toFixed(0)} s, disk peak ${(s.diskPeak / 1024 ** 3).toFixed(2)} GB`,
  ];
  const solFile = join(dir, 'solutions', `${id}.txt`);
  const saved = savedSolution(dir, level);
  if (r.status === 'solved') {
    const n = r.moves.length;
    if (replay(level, r.moves).status !== 'won') {
      lines.push(`${id}: solution rejected — it does not win, nothing is written`);
      return { ok: false, lines };
    }
    const text = `${solutionHeader(true, n)}\n${formatMoves(r.moves)}`;
    writeFileSync(join(workDir, 'solution.txt'), text);
    lines.push(
      `${id}: optimal solution of ${n} moves (shorter than ${r.upperBound}) — saved in ${join(workDir, 'solution.txt')}`,
    );
    if (apply && (!saved || n < saved.length)) {
      writeFileSync(solFile, text);
      const gold = level.thresholds.goldMoves;
      if (gold === undefined || n < gold) {
        const tmx = join(dir, `${id}.tmx`);
        writeFileSync(tmx, setMapProperty(readFileSync(tmx, 'utf8'), 'goldMoves', n));
      }
      lines.push(`${id}: written to solutions/${id}.txt (optimal, proven)`);
    }
    return { ok: true, lines };
  }
  if (r.status === 'exhausted') {
    const proven = saved !== undefined && saved.length === r.upperBound;
    lines.push(
      `${id}: no solution of fewer than ${r.upperBound} moves${proven ? ' — the saved solution is optimal (proven)' : ''}`,
    );
    writeFileSync(join(workDir, 'proof.txt'), `no solution of fewer than ${r.upperBound} moves\n`);
    if (apply && proven) {
      writeFileSync(solFile, `${solutionHeader(true, r.upperBound)}\n${formatMoves(saved)}`);
      lines.push(`${id}: solutions/${id}.txt marked "# optimal (proven)"`);
    }
    return { ok: true, lines };
  }
  lines.push(
    `${id}: stopped (${r.reason}) — proven lower bound ≥ ${r.lowerBound}; resume with --resume`,
  );
  if (apply && saved && r.lowerBound > savedLowerBound(dir, id)) {
    writeFileSync(solFile, `${solutionHeader(false, r.lowerBound)}\n${formatMoves(saved)}`);
    lines.push(`${id}: lower bound of solutions/${id}.txt raised to ${r.lowerBound}`);
  }
  return { ok: true, lines };
}
