import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { freemem, totalmem } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  formatMoves,
  improveLevel,
  parseMoves,
  replay,
  type Dir,
  type ExactEngine,
  type ImproveResult,
  type LevelData,
  type StageName,
} from '@puzzlecave/core';
import { loadPack, setMapProperty } from '@puzzlecave/tiled';
import {
  savedLowerBound,
  solutionHeader,
  type CommandResult,
  type SolveCommandOptions,
} from './commands';
import type { GpuMode } from './args';
import type { ImproveReply, ImproveTask } from './improveWorker';
import { inProcessMemoryMb } from './memory';
import { runLevels, seconds } from './parallel';

export { solutionHeader };

const WORKER = fileURLToPath(new URL('./improveWorker.ts', import.meta.url));
/** watchdog margin beyond timeoutMs (loading, last search, sending) */
const WATCHDOG_MARGIN_MS = 60_000;

export interface ImproveCommandOptions extends SolveCommandOptions {
  /** engine of the global searches (frozen blocks, proof), e.g. GPU; `exact` by default */
  global?: ExactEngine | undefined;
}

const solutionFile = (dir: string, id: string) => join(dir, 'solutions', `${id}.txt`);

/** saved solution (the designer's or from a previous run), if any */
export function readSolution(dir: string, id: string): Dir[] | { error: string } | undefined {
  const file = solutionFile(dir, id);
  if (!existsSync(file)) return undefined;
  try {
    return parseMoves(readFileSync(file, 'utf8'));
  } catch (err) {
    return { error: (err as Error).message };
  }
}

const STAGE: Record<StageName, string> = {
  find: 'search',
  reoptimize: 'windows',
  spareKeys: 'spare keys',
  freeze: 'frozen blocks',
  proof: 'proof',
};

export type ImproveOutcome = 'proven' | 'best' | 'none';

/**
 * Report of a level and, with --apply, writing of the solution (with its status header, if the
 * text changes) and goldMoves: an existing goldMoves is only lowered by a strictly shorter
 * solution (or always with --force).
 */
export function reportImprove(
  dir: string,
  level: LevelData,
  r: ImproveResult,
  ms: number,
  o: Pick<SolveCommandOptions, 'apply' | 'force'>,
  notes: string[] = [],
): CommandResult & { outcome: ImproveOutcome; summary: string } {
  const id = level.id;
  const gold = level.thresholds.goldMoves;
  const len = (v?: number) => (v === undefined ? '—' : String(v));
  const stages = r.stages.map(
    (s) => `  ${STAGE[s.stage]}: ${len(s.before)} → ${len(s.after)} (${seconds(s.ms)}) — ${s.note}`,
  );
  const time = `(${seconds(ms)})`;
  if (!r.moves) {
    const summary = r.unsolvable ? 'unsolvable' : `proven lower bound ≥ ${r.lowerBound}`;
    return {
      ok: false,
      lines: [`${id}: no solution — ${summary} ${time}`, ...stages, ...notes],
      outcome: 'none',
      summary,
    };
  }
  const n = r.moves.length;
  // safeguard: the solution is replayed before any write
  const end = replay(level, r.moves).status;
  if (end !== 'won')
    return {
      ok: false,
      lines: [
        `${id}: solution rejected — it does not win (status ${end}), nothing is written`,
        ...stages,
        ...notes,
      ],
      outcome: 'none',
      summary: `solution rejected (status ${end})`,
    };
  const from = r.start === 'designer' ? 'solution saved' : 'solution found';
  const status = r.proven ? 'optimal (proven)' : `best known, proven lower bound ≥ ${r.lowerBound}`;
  const lines = [
    `${id}: ${from} (${r.initialLength}) → ${n} moves — ${status} ${time}`,
    ...stages,
    ...notes,
  ];
  let ok = true;
  if (gold !== undefined && r.proven && gold < n) {
    ok = false;
    lines.push(`${id}: goldMoves (${gold}) < proven optimum (${n}) — impossible threshold`);
  } else if (gold !== undefined && gold < r.lowerBound) {
    ok = false;
    lines.push(
      `${id}: goldMoves (${gold}) < proven lower bound (${r.lowerBound}) — impossible threshold`,
    );
  }
  // an unreadable or losing saved solution (designer input to fix) is never overwritten without
  // --force: the found solution is written next to it, goldMoves is left untouched
  const keepSaved = savedIsInvalid(dir, level) && !o.force;
  if (savedIsInvalid(dir, level)) ok = false;
  if (o.apply) {
    try {
      const file = keepSaved ? join(dir, 'solutions', `${id}.found.txt`) : solutionFile(dir, id);
      const bound = keepSaved
        ? r.lowerBound
        : Math.max(r.lowerBound, savedLowerBound(solutionFile(dir, id)));
      const text = `${solutionHeader(r.proven, bound)}\n${formatMoves(r.moves)}`;
      if (!existsSync(file) || readFileSync(file, 'utf8') !== text) {
        mkdirSync(join(dir, 'solutions'), { recursive: true });
        writeFileSync(file, text);
      }
      if (keepSaved)
        lines.push(
          `${id}: saved solution kept (invalid) — found solution written to solutions/${id}.found.txt, goldMoves unchanged; --force to replace`,
        );
      else {
        // the saved solution is valid again, or --force: the .found.txt is stale
        rmSync(join(dir, 'solutions', `${id}.found.txt`), { force: true });
        if (o.force || gold === undefined || n < gold) {
          const tmx = join(dir, `${id}.tmx`);
          writeFileSync(tmx, setMapProperty(readFileSync(tmx, 'utf8'), 'goldMoves', n));
        }
      }
    } catch (err) {
      ok = false;
      lines.push(`${id}: write error — ${(err as Error).message}`);
    }
  }
  const summary = `${n} moves${r.proven ? '' : ` (≥ ${r.lowerBound})`}, start ${r.initialLength}`;
  return { ok, lines, outcome: r.proven ? 'proven' : 'best', summary };
}

/** a solution is saved but it is unreadable or does not win */
function savedIsInvalid(dir: string, level: LevelData): boolean {
  const saved = readSolution(dir, level.id);
  if (saved === undefined) return false;
  return !Array.isArray(saved) || replay(level, saved).status !== 'won';
}

/** Starting point of a level: the saved solution if readable, with its warnings. */
function designerStart(dir: string, level: LevelData): { initial?: Dir[]; notes: string[] } {
  const saved = readSolution(dir, level.id);
  if (saved === undefined) return { notes: [] };
  if (!Array.isArray(saved))
    return {
      notes: [`${level.id}: warning — unreadable solution (${saved.error}), ignored`],
    };
  return { initial: saved, notes: [] };
}

function invalidNote(id: string, r: ImproveResult): string[] {
  return r.designerInvalid
    ? [`${id}: warning — the saved solution does not win (status ${r.designerInvalid}), ignored`]
    : [];
}

/**
 * "Best known" pipeline of each level, in sequence in the current process. Memory cap of each
 * search: --max-memory, otherwise the whole budget under 70% (like solve).
 */
export function improveCommand(
  dir: string,
  ids: string[] | 'all',
  o: ImproveCommandOptions,
): CommandResult {
  const pack = loadPack(dir);
  const lines = [...pack.errors];
  let ok = pack.errors.length === 0;
  const byId = new Map(pack.levels.map((l) => [l.id, l]));
  const maxMemoryMb = o.maxMemoryMb ?? inProcessMemoryMb(totalmem(), freemem());
  for (const id of ids === 'all' ? pack.levels.map((l) => l.id) : ids) {
    const level = byId.get(id);
    if (!level) {
      lines.push(`${id}: unknown level`);
      ok = false;
      continue;
    }
    const start = designerStart(dir, level);
    const t0 = performance.now();
    const r = improveLevel(level, {
      timeoutMs: o.timeoutMs,
      maxStates: o.maxStates,
      maxMemoryMb,
      ...(start.initial ? { initial: start.initial } : {}),
      ...(o.exact ? { exact: o.exact } : {}),
      ...(o.global ? { global: o.global } : {}),
    });
    const rep = reportImprove(dir, level, r, performance.now() - t0, o, [
      ...start.notes,
      ...invalidNote(id, r),
    ]);
    lines.push(...rep.lines);
    ok &&= rep.ok;
  }
  return { ok, lines };
}

export interface ImproveParallelOptions extends SolveCommandOptions {
  jobs?: number | undefined;
  onLine?: (line: string) => void;
  /** global searches on the GPU, in a GPU lane (see runLevels); off by default */
  gpu?: GpuMode | undefined;
  maxVramMb?: number | undefined;
}

/**
 * Pipeline of each level in a separate Node process, with solve's memory plan (runLevels): the
 * stages follow one another, one search at a time, each capped at the child's share. --apply
 * writes by the parent; summary sorted by id.
 */
export function improveParallel(
  dir: string,
  ids: string[] | 'all',
  o: ImproveParallelOptions,
): Promise<CommandResult> {
  const notes = new Map<string, string[]>();
  return runLevels<ImproveTask, ImproveReply, ImproveOutcome>({
    dir,
    ids,
    worker: WORKER,
    timeoutMs: o.timeoutMs,
    watchdogMarginMs: WATCHDOG_MARGIN_MS,
    maxStates: o.maxStates,
    maxMemoryMb: o.maxMemoryMb,
    jobs: o.jobs,
    onLine: o.onLine,
    gpu: { mode: o.gpu ?? 'off', maxVramMb: o.maxVramMb },
    task: (level, memoryMb, gpu) => {
      const start = designerStart(dir, level);
      notes.set(level.id, start.notes);
      return {
        dir,
        id: level.id,
        timeoutMs: o.timeoutMs,
        ...(o.maxStates !== undefined ? { maxStates: o.maxStates } : {}),
        maxMemoryMb: memoryMb,
        ...(start.initial ? { initial: start.initial } : {}),
        ...(gpu ? { gpu } : {}),
      };
    },
    report: (level, reply) => {
      const rep = reportImprove(dir, level, reply.result, reply.ms, o, [
        ...(reply.notes ?? []),
        ...notes.get(level.id)!,
        ...invalidNote(level.id, reply.result),
      ]);
      return {
        ok: rep.ok,
        lines: rep.lines,
        rows: [
          {
            kind: rep.outcome,
            text: `${rep.summary} (${seconds(reply.ms)}, ${reply.maxRssMb} MB)`,
          },
          ...rep.lines
            .filter((l) => /impossible threshold|write error/.test(l))
            .map((text) => ({ kind: 'error' as const, text })),
        ],
      };
    },
    sections: [
      ['proven', 'proven'],
      ['best', 'best known'],
      ['none', 'no solution'],
    ],
  });
}
