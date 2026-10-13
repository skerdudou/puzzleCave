import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { freemem, totalmem } from 'node:os';
import { join } from 'node:path';
import {
  formatMoves,
  normalizeMoves,
  parseMoves,
  replay,
  solve,
  type Dir,
  type LevelData,
  type ThresholdOverrides,
  type ExactEngine,
  type SolveResult,
} from '@puzzlecave/core';
import { loadPack, setMapProperty } from '@puzzlecave/tiled';
import { inProcessMemoryMb } from './memory';
import { goldTimeFor, solutionFeatures } from './times';

/** first line (a comment, ignored by parseMoves) of a saved solution */
export function solutionHeader(proven: boolean, lowerBound: number): string {
  return proven
    ? '# optimal (proven)'
    : `# best known — not proven optimal (proven lower bound ≥ ${lowerBound})`;
}

/** lower bound written in a saved solution's header (0 if none): it stays proven for any later
 * solution of the same level, so a shorter or weaker run must not lower it */
export function savedLowerBound(file: string): number {
  if (!existsSync(file)) return 0;
  const m = /proven lower bound ≥ (\d+)/.exec(readFileSync(file, 'utf8').split('\n', 1)[0]!);
  return m ? Number(m[1]) : 0;
}

/** the platinum move limit of a level and the property that sets it (undefined: no goldMoves) */
export function platinumLimit(
  t: ThresholdOverrides,
): { name: 'platinumMoves' | 'goldMoves'; value: number } | undefined {
  if (t.platinumMoves !== undefined) return { name: 'platinumMoves', value: t.platinumMoves };
  if (t.goldMoves !== undefined) return { name: 'goldMoves', value: t.goldMoves };
  return undefined;
}

export type ThresholdChanges = Partial<Record<'goldMoves' | 'platinumMoves', number>>;

/**
 * Thresholds a new best solution of `n` moves sets. goldMoves is a "good honest" solution chosen
 * by the designer: it is only written for a level that has none. Otherwise the best length goes
 * to platinumMoves, when strictly shorter than the platinum limit — or always with `force` (a
 * goldMoves below a forced length is raised to it, so that platinumMoves ≤ goldMoves holds).
 */
export function thresholdChanges(
  t: ThresholdOverrides,
  n: number,
  force = false,
): ThresholdChanges {
  const gold = t.goldMoves;
  if (gold === undefined) return { goldMoves: n };
  const limit = t.platinumMoves ?? gold;
  if (force) {
    if (n > gold) return { goldMoves: n, platinumMoves: n };
    return n === limit ? {} : { platinumMoves: n };
  }
  return n < limit ? { platinumMoves: n } : {};
}

/** moves of the saved solution of a level (without refused moves), if it is readable and wins */
export function savedWinningMoves(dir: string, level: LevelData): Dir[] | undefined {
  const file = join(dir, 'solutions', `${level.id}.txt`);
  if (!existsSync(file)) return undefined;
  try {
    const r = normalizeMoves(level, parseMoves(readFileSync(file, 'utf8')));
    return r.status === 'won' ? r.moves : undefined;
  } catch {
    return undefined;
  }
}

/** goldTime of a solution (undefined if it does not win) */
function goldTimeOf(level: LevelData, moves: readonly Dir[]): number | undefined {
  try {
    return goldTimeFor(solutionFeatures(level, moves));
  } catch {
    return undefined;
  }
}

/** goldTime to write and the length of the solution it comes from; {} when it is not guessed */
export interface GoldTimeChoice {
  goldTime?: number;
  from?: number;
}

/**
 * goldTime that goes with the threshold changes `changes` of a written solution `moves`, for a
 * level without goldTime (undefined when it has one: an existing goldTime is only replaced by
 * `times --force`). It comes from the gold reference solution: the written one when the write
 * sets goldMoves; otherwise the solution saved before the write (`previous`) if its length is
 * goldMoves, else the written one if its length is goldMoves; else it is not guessed ({}).
 */
export function goldTimeChoice(
  level: LevelData,
  changes: ThresholdChanges,
  moves: readonly Dir[],
  previous: readonly Dir[] | undefined,
): GoldTimeChoice | undefined {
  if (level.thresholds.goldTime !== undefined) return undefined;
  const gold = changes.goldMoves ?? level.thresholds.goldMoves;
  const written = normalizeMoves(level, moves).moves;
  const candidates =
    changes.goldMoves !== undefined
      ? [written]
      : [previous && normalizeMoves(level, previous).moves, written];
  for (const c of candidates) {
    if (c === undefined || c.length !== gold) continue;
    const goldTime = goldTimeOf(level, c);
    if (goldTime !== undefined) return { goldTime, from: c.length };
  }
  return {};
}

/**
 * Writes into the level's .tmx the threshold changes of a new best solution `moves` (the one
 * written to solutions/<id>.txt), and goldTime when the level has none (goldTimeChoice;
 * `previous`: the winning solution saved before this write, if any). Returns the report lines
 * about goldTime (written, or missing).
 */
export function applyThresholds(
  dir: string,
  level: LevelData,
  moves: readonly Dir[],
  o: { force?: boolean | undefined; previous?: readonly Dir[] | undefined } = {},
): string[] {
  const changes = thresholdChanges(level.thresholds, moves.length, o.force);
  const time = goldTimeChoice(level, changes, moves, o.previous);
  const props: [string, number][] = Object.entries(changes);
  const lines: string[] = [];
  if (time?.goldTime !== undefined) {
    props.push(['goldTime', time.goldTime]);
    lines.push(
      `${level.id}: goldTime = ${time.goldTime} s written (from the ${time.from}-move gold solution)`,
    );
  } else if (time !== undefined) lines.push(goldTimeMissing(level));
  if (!props.length) return lines;
  const tmx = join(dir, `${level.id}.tmx`);
  let xml = readFileSync(tmx, 'utf8');
  for (const [name, value] of props) xml = setMapProperty(xml, name, value);
  writeFileSync(tmx, xml);
  return lines;
}

/** warning for a level without goldTime whose gold reference solution is not at hand */
export function goldTimeMissing(level: LevelData): string {
  const gold = level.thresholds.goldMoves;
  return `${level.id}: warning — goldTime missing: run npm run times -- ${level.id} --apply [--from <folder of the ${gold ?? 'gold'}-move gold solution>]`;
}

/** "<id>: platinumMoves (x) < proven optimum (n) — impossible threshold", if so */
export function impossibleThreshold(
  level: LevelData,
  bound: number,
  what: 'proven optimum' | 'proven lower bound',
): string | undefined {
  const p = platinumLimit(level.thresholds);
  if (p === undefined || p.value >= bound) return undefined;
  return `${level.id}: ${p.name} (${p.value}) < ${what} (${bound}) — impossible threshold`;
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
      const text = readFileSync(file, 'utf8');
      const end = replay(level, parseMoves(text));
      if (end.status !== 'won')
        lines.push(`${level.id}: the solution does not win (status ${end.status})`);
      const p = platinumLimit(level.thresholds);
      if (end.status === 'won' && p !== undefined) {
        // the header proves that nothing shorter than the optimum / the lower bound exists
        const head = text.split('\n', 1)[0]!;
        const optimum = /^#\s*optimal \(proven\)/.test(head) ? end.moves : undefined;
        const bound = optimum ?? savedLowerBound(file);
        if (p.value < bound)
          lines.push(
            `${level.id}: ${p.name} (${p.value}) < ${optimum !== undefined ? 'proven optimum' : 'proven lower bound'} (${bound}) — impossible threshold`,
          );
        else if (p.value < end.moves)
          warnings.push(
            `${level.id}: warning — the saved solution (${end.moves} moves) is longer than ${p.name} (${p.value})`,
          );
        else if (p.value > end.moves)
          warnings.push(
            `${level.id}: warning — ${p.name} (${p.value}) is longer than the saved solution (${end.moves} moves)`,
          );
      }
    } catch (err) {
      lines.push(`${level.id}: unreadable solution — ${(err as Error).message}`);
    }
  }
  const ok = lines.length === 0;
  lines.push(...warnings);
  // no time medals without goldTime: allowed (e.g. a level in progress), but flagged
  for (const level of pack.levels) {
    if (level.thresholds.goldTime === undefined)
      lines.push(
        `${level.id}: warning — no goldTime (npm run times -- ${level.id} --apply [--from <folder>])`,
      );
  }
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
 * Report lines for a solver result and, with --apply, writing of the solution and thresholds
 * (thresholdChanges: goldMoves for a level without one, otherwise platinumMoves lowered to a
 * strictly shorter proven optimum, or always with --force); the solution is only written if it
 * is missing or a threshold changes.
 */
export function reportSolve(
  dir: string,
  level: LevelData,
  r: SolveResult,
  o: Pick<SolveCommandOptions, 'apply' | 'force'>,
): CommandResult {
  const id = level.id;
  if (r.status === 'unsolvable')
    return { ok: false, lines: [`${id}: unsolvable (${r.explored} states)`] };
  if (r.status === 'timeout') {
    const lines = [
      `${id}: limit reached without a solution (${r.explored} states) — proven lower bound: ≥ ${r.lowerBound} moves`,
    ];
    const impossible = impossibleThreshold(level, r.lowerBound, 'proven lower bound');
    if (impossible) lines.push(impossible);
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
  const proposed = level.thresholds.goldMoves === undefined ? 'goldMoves' : 'platinumMoves';
  const lines = [`${id}: ${n} moves (${r.explored} states) — proposed ${proposed} = ${n}`];
  let ok = true;
  const impossible = impossibleThreshold(level, n, 'proven optimum');
  if (impossible) {
    ok = false;
    lines.push(impossible);
  }
  if (o.apply) {
    try {
      const solution = join(dir, 'solutions', `${id}.txt`);
      const better = Object.keys(thresholdChanges(level.thresholds, n, o.force)).length > 0;
      const previous = savedWinningMoves(dir, level);
      if (o.force || better || !existsSync(solution)) {
        mkdirSync(join(dir, 'solutions'), { recursive: true });
        writeFileSync(solution, `${solutionHeader(true, n)}\n${formatMoves(r.moves)}`);
      }
      lines.push(...applyThresholds(dir, level, r.moves, { force: o.force, previous }));
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
