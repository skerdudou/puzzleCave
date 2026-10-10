import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { freemem, totalmem } from 'node:os';
import { join } from 'node:path';
import {
  formatMoves,
  parseMoves,
  replay,
  solve,
  type LevelData,
  type ExactEngine,
  type SolveResult,
} from '@puzzlecave/core';
import { loadPack, setMapProperty } from '@puzzlecave/tiled';
import { inProcessMemoryMb } from './memory';

/** first line (a comment, ignored by parseMoves) of a saved solution */
export function solutionHeader(proven: boolean, lowerBound: number): string {
  return proven
    ? '# optimal (proven)'
    : `# best known — not proven optimal (proven lower bound ≥ ${lowerBound})`;
}

export interface CommandResult {
  ok: boolean;
  lines: string[];
}

export function validateCommand(dir: string): CommandResult {
  const pack = loadPack(dir);
  const lines = [...pack.errors];
  const warnings: string[] = [];
  let checked = 0;
  for (const level of pack.levels) {
    const file = join(dir, 'solutions', `${level.id}.txt`);
    if (!existsSync(file)) continue;
    checked++;
    try {
      const end = replay(level, parseMoves(readFileSync(file, 'utf8')));
      if (end.status !== 'won')
        lines.push(`${level.id}: the solution does not win (status ${end.status})`);
      const gold = level.thresholds.goldMoves;
      if (end.status === 'won' && gold !== undefined && gold > end.moves)
        warnings.push(
          `${level.id}: warning — goldMoves (${gold}) is longer than the saved solution (${end.moves} moves)`,
        );
    } catch (err) {
      lines.push(`${level.id}: unreadable solution — ${(err as Error).message}`);
    }
  }
  const ok = lines.length === 0;
  lines.push(...warnings);
  // starting on water: allowed, but flagged so that it is a deliberate choice
  for (const level of pack.levels) {
    if (level.terrain[level.start.y * level.width + level.start.x] === 'water') {
      lines.push(`${level.id}: warning — starts on water`);
    }
  }
  lines.push(
    `${pack.levels.length} level(s) loaded, ${checked} solution(s) replayed${ok ? ' — OK' : ''}`,
  );
  return { ok, lines };
}

export interface SolveCommandOptions {
  timeoutMs: number;
  /** state limit; undefined = unlimited */
  maxStates?: number | undefined;
  /**
   * solver memory cap per process (MB); undefined = computed: the whole budget under 70% of
   * RAM when sequential, its share when parallel (see planJobs)
   */
  maxMemoryMb?: number | undefined;
  apply: boolean;
  force: boolean;
  /** exact engine (solve: each level; improve: final windows); `solve` by default */
  exact?: ExactEngine | undefined;
}

/**
 * Report lines for a solver result and, with --apply, writing of the solution and goldMoves. An
 * existing goldMoves is only replaced by a strictly shorter proven optimum (or always with
 * --force); the solution is only written if it is missing or goldMoves changes.
 */
export function reportSolve(
  dir: string,
  level: LevelData,
  r: SolveResult,
  o: Pick<SolveCommandOptions, 'apply' | 'force'>,
): CommandResult {
  const id = level.id;
  const gold = level.thresholds.goldMoves;
  if (r.status === 'unsolvable')
    return { ok: false, lines: [`${id}: unsolvable (${r.explored} states)`] };
  if (r.status === 'timeout') {
    const lines = [
      `${id}: limit reached without a solution (${r.explored} states) — proven lower bound: ≥ ${r.lowerBound} moves`,
    ];
    if (gold !== undefined && r.lowerBound > gold)
      lines.push(
        `${id}: goldMoves (${gold}) < proven lower bound (${r.lowerBound}) — impossible threshold`,
      );
    return { ok: false, lines };
  }
  // safeguard: the solution is replayed before any report or write
  const end = replay(level, r.moves).status;
  if (end !== 'won')
    return {
      ok: false,
      lines: [
        `${id}: engine solution rejected — it does not win (status ${end}), nothing is written`,
      ],
    };
  const n = r.moves.length;
  const lines = [`${id}: ${n} moves (${r.explored} states) — proposed goldMoves = ${n}`];
  let ok = true;
  if (gold !== undefined && n > gold) {
    ok = false;
    lines.push(`${id}: goldMoves (${gold}) < proven optimum (${n}) — impossible threshold`);
  }
  if (o.apply) {
    try {
      const solution = join(dir, 'solutions', `${id}.txt`);
      const setGold = o.force || gold === undefined || n < gold;
      if (setGold || !existsSync(solution)) {
        mkdirSync(join(dir, 'solutions'), { recursive: true });
        writeFileSync(solution, `${solutionHeader(true, n)}\n${formatMoves(r.moves)}`);
      }
      if (setGold) {
        const tmx = join(dir, `${id}.tmx`);
        writeFileSync(tmx, setMapProperty(readFileSync(tmx, 'utf8'), 'goldMoves', n));
      }
    } catch (err) {
      ok = false;
      lines.push(`${id}: write error — ${(err as Error).message}`);
    }
  }
  return { ok, lines };
}

/** Sequential solving in the current process. */
export function solveCommand(
  dir: string,
  ids: string[] | 'all',
  o: SolveCommandOptions,
): CommandResult {
  const pack = loadPack(dir);
  const lines = [...pack.errors];
  let ok = pack.errors.length === 0;
  const byId = new Map(pack.levels.map((l) => [l.id, l]));
  const wanted = ids === 'all' ? pack.levels.map((l) => l.id) : ids;
  const maxMemoryMb = o.maxMemoryMb ?? inProcessMemoryMb(totalmem(), freemem());
  for (const id of wanted) {
    const level = byId.get(id);
    if (!level) {
      lines.push(`${id}: unknown level`);
      ok = false;
      continue;
    }
    const r = reportSolve(
      dir,
      level,
      (o.exact ?? solve)(level, {
        timeoutMs: o.timeoutMs,
        maxStates: o.maxStates,
        maxMemoryMb,
        partialExpansion: 'auto',
      }),
      o,
    );
    lines.push(...r.lines);
    ok &&= r.ok;
  }
  return { ok, lines };
}
