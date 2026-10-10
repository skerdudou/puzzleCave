// Author tools API of the development server (never shipped in the build).
// Logic without a Vite dependency: tested with a temporary directory and a fake launcher.
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  statSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs';
import { join } from 'node:path';
import { formatMoves, parseMoves, replay, type LevelData } from '@puzzlecave/core';
import { parseImproveOutput, type ImproveSummary } from './improveOutput';

/**
 * Options passed to `improve` AFTER `improve <id>` and before `--timeout`.
 * Single configuration point: add e.g. '--gpu', 'auto' there for the GPU solver.
 */
export const IMPROVE_ARGS: readonly string[] = ['--apply'];

export const DEFAULT_TIMEOUT_S = 120;
export const MAX_BODY_BYTES = 64 * 1024;
const MAX_LOG_LINES = 500;
const MAX_JOBS = 50;
const ID_RE = /^[A-Za-z0-9_-]{1,64}$/;
/** margin of the server's hard stop beyond --timeout (the CLI watchdog is +60 s) */
export const HARD_STOP_MARGIN_S = 90;
const PROVEN_HEADER = /^#\s*optimal \(proven\)/m;
export const DESIGNER_HEADER = '# designer solution (not optimized)';

/** Arguments of the `improve` CLI (without the program): `improve <id> <IMPROVE_ARGS> --timeout <s>`. */
export function improveArgs(id: string, timeoutS: number): string[] {
  return ['improve', id, ...IMPROVE_ARGS, '--timeout', String(timeoutS)];
}

export interface LaunchedProcess {
  onLine(cb: (line: string) => void): void;
  onExit(cb: (code: number | null) => void): void;
  kill(): void;
}
export type Launch = (id: string, timeoutS: number) => LaunchedProcess;

export interface AuthorApiOptions {
  levelsDir: string;
  getLevel: (id: string) => LevelData | undefined;
  launch: Launch;
  timeoutS?: number;
  /** called at the end of each job (e.g. to invalidate the levels cache) */
  onJobEnd?: (levelId: string) => void;
  /** tests: file operations of the proof restoration (failures can be injected) */
  fsOps?: { copyFileSync: typeof copyFileSync; unlinkSync: typeof unlinkSync };
}

export interface ApiResponse {
  status: number;
  body: unknown;
}

type JobState = 'running' | 'done' | 'failed';
interface Job {
  id: string;
  levelId: string;
  state: JobState;
  log: string[];
  startedAt: number;
  endedAt?: number;
  timeoutS: number;
  tmxMtime: number;
  tmxChanged: boolean;
  proc: LaunchedProcess;
  timer?: ReturnType<typeof setTimeout>;
  finish?: (state: JobState) => void;
  /** length of the proven-optimal solution overwritten by a forced replacement */
  prevProven?: number;
  proofKept?: boolean;
}

const json = (status: number, body: unknown): ApiResponse => ({ status, body });
const PREFIX = '/__pc/';

export function createAuthorApi(o: AuthorApiOptions) {
  const timeoutS = o.timeoutS ?? DEFAULT_TIMEOUT_S;
  const jobs = new Map<string, Job>();
  let counter = 0;
  let lastEnd = 0;

  const solutionFile = (id: string) => join(o.levelsDir, 'solutions', `${id}.txt`);
  const prevSolutionFile = (id: string) => join(o.levelsDir, 'solutions', `${id}.prev.txt`);
  const tmxMtime = (id: string) => {
    try {
      return statSync(join(o.levelsDir, `${id}.tmx`)).mtimeMs;
    } catch {
      return 0;
    }
  };
  const runningFor = (levelId: string) =>
    [...jobs.values()].some((j) => j.levelId === levelId && j.state === 'running');

  function readSaved(id: string): { text: string; moves: ReturnType<typeof parseMoves> } | null {
    const f = solutionFile(id);
    if (!existsSync(f)) return null;
    const text = readFileSync(f, 'utf8');
    try {
      return { text, moves: parseMoves(text) };
    } catch {
      return { text, moves: [] };
    }
  }

  function jobView(j: Job) {
    const s: ImproveSummary = parseImproveOutput(j.log);
    const end = j.endedAt ?? Date.now();
    const kept = j.proofKept === true;
    return {
      state: j.state,
      levelId: j.levelId,
      log: j.log,
      elapsedMs: end - j.startedAt,
      timeoutS: j.timeoutS,
      before: s.before,
      after: kept ? j.prevProven : s.after,
      proven: kept ? true : s.proven,
      lowerBound: kept ? j.prevProven : s.lowerBound,
      proofKept: kept,
      warnings: s.warnings ?? [],
      tmxChanged: j.tmxChanged,
    };
  }

  function startJob(levelId: string, prevProven?: number): Job {
    const proc = o.launch(levelId, timeoutS);
    const job: Job = {
      id: `j${++counter}-${Math.random().toString(36).slice(2, 8)}`,
      levelId,
      state: 'running',
      log: [],
      startedAt: Date.now(),
      timeoutS,
      tmxMtime: tmxMtime(levelId),
      tmxChanged: false,
      proc,
      prevProven,
    };
    jobs.set(job.id, job);
    if (jobs.size > MAX_JOBS) {
      for (const [k, v] of jobs) {
        if (v.state !== 'running') {
          jobs.delete(k);
          break;
        }
      }
    }
    proc.onLine((l) => {
      if (l.trim() === '') return;
      job.log.push(l);
      if (job.log.length > MAX_LOG_LINES) job.log.shift();
    });
    const finish = (state: JobState) => {
      if (job.state !== 'running') return;
      if (job.timer) clearTimeout(job.timer);
      job.state = state;
      job.endedAt = Date.now();
      try {
        restoreProof(job);
      } catch (err) {
        // never let a file error (EBUSY…) block the end of the job or kill the server
        job.log.push(
          `${levelId}: warning — proof restoration impossible (${(err as Error).message})`,
        );
      }
      try {
        job.tmxChanged = tmxMtime(levelId) !== job.tmxMtime;
      } finally {
        lastEnd = Date.now();
        try {
          o.onJobEnd?.(levelId);
        } catch (err) {
          job.log.push(`${levelId}: warning — onJobEnd failed (${(err as Error).message})`);
        }
      }
    };
    job.finish = finish;
    proc.onExit((code) => {
      // improve exits with 1 when it warns (impossible threshold…) although its result is good:
      // only the absence of a result line, or a stop by signal, is a failure
      const s = parseImproveOutput(job.log);
      const hasResult =
        s.after !== undefined || s.unsolvable !== undefined || s.lowerBound !== undefined;
      finish(code !== null && hasResult ? 'done' : 'failed');
    });
    // hard stop: a stuck child must not keep the level busy indefinitely
    job.timer = setTimeout(
      () => {
        if (job.state !== 'running') return;
        job.log.push(`forced stop after ${timeoutS + HARD_STOP_MARGIN_S} s`);
        proc.kill();
        finish('failed');
      },
      (timeoutS + HARD_STOP_MARGIN_S) * 1000,
    );
    return job;
  }

  /** Never degrade a proof: puts back the old proven solution if the run did not prove it. */
  function restoreProof(job: Job): void {
    const prevFile = prevSolutionFile(job.levelId);
    if (!existsSync(prevFile)) return;
    const fsOps = o.fsOps ?? { copyFileSync, unlinkSync };
    const s = parseImproveOutput(job.log);
    const cur = readSaved(job.levelId);
    const curLen = s.after ?? (cur ? cur.moves.length : Infinity);
    if (job.prevProven !== undefined && s.proven !== true && job.prevProven <= curLen) {
      try {
        fsOps.copyFileSync(prevFile, solutionFile(job.levelId));
      } catch (err) {
        // .prev.txt is then the only copy of the proven solution: keep it
        throw new Error(`${(err as Error).message}; proven solution kept in ${prevFile}`);
      }
      job.proofKept = true;
    }
    try {
      fsOps.unlinkSync(prevFile);
    } catch {
      // .prev.txt remains, harmless
    }
  }

  function post(id: string, body: unknown): ApiResponse {
    if (!ID_RE.test(id)) return json(400, { error: 'bad-id' });
    const level = o.getLevel(id);
    if (!level) return json(404, { error: 'unknown-level' });
    if (typeof body !== 'object' || body === null) return json(400, { error: 'bad-body' });
    const { moves: text, force } = body as { moves?: unknown; force?: unknown };
    if (typeof text !== 'string' || text.length > MAX_BODY_BYTES) {
      return json(400, { error: 'bad-body' });
    }
    let moves;
    try {
      moves = parseMoves(text);
    } catch (err) {
      return json(400, { error: 'bad-moves', message: (err as Error).message });
    }
    if (moves.length === 0) return json(400, { error: 'bad-moves', message: 'empty solution' });
    if (replay(level, moves).status !== 'won') return json(422, { error: 'not-winning' });
    if (runningFor(id)) return json(409, { error: 'job-running' });
    const saved = readSaved(id);
    const savedValid =
      saved !== null && saved.moves.length > 0 && replay(level, saved.moves).status === 'won';
    const savedProven = savedValid && PROVEN_HEADER.test(saved.text);
    if (savedValid && saved.moves.length <= moves.length && force !== true) {
      return json(409, {
        error: 'not-shorter',
        existing: saved.moves.length,
        existingProven: savedProven,
      });
    }
    mkdirSync(join(o.levelsDir, 'solutions'), { recursive: true });
    if (saved) copyFileSync(solutionFile(id), prevSolutionFile(id));
    writeFileSync(solutionFile(id), `${DESIGNER_HEADER}\n${formatMoves(moves)}`);
    const job = startJob(id, savedProven ? saved.moves.length : undefined);
    return json(200, { saved: true, jobId: job.id, moves: moves.length });
  }

  async function handle(method: string, pathname: string, body?: unknown): Promise<ApiResponse> {
    if (!pathname.startsWith(PREFIX)) return json(404, { error: 'not-found' });
    const [kind, rawId, ...rest] = pathname.slice(PREFIX.length).split('/');
    if (rest.length > 0 || (kind !== 'solution' && kind !== 'job')) {
      return json(404, { error: 'not-found' });
    }
    let id: string;
    try {
      id = decodeURIComponent(rawId ?? '');
    } catch {
      return json(400, { error: 'bad-id' });
    }
    if (kind === 'job') {
      if (method !== 'GET') return json(405, { error: 'method' });
      const j = jobs.get(id);
      return j ? json(200, jobView(j)) : json(404, { error: 'unknown-job' });
    }
    if (method === 'GET') {
      if (!ID_RE.test(id)) return json(400, { error: 'bad-id' });
      if (!o.getLevel(id)) return json(404, { error: 'unknown-level' });
      const saved = readSaved(id);
      if (!saved) return json(404, { error: 'no-solution' });
      const header = saved.text.split(/\r?\n/).find((l) => l.startsWith('#')) ?? '';
      return json(200, {
        text: saved.text,
        moves: formatMoves(saved.moves).replace(/\n/g, ''),
        header,
      });
    }
    if (method === 'POST') return post(id, body);
    return json(405, { error: 'method' });
  }

  function dispose(): void {
    for (const j of jobs.values()) {
      if (j.state === 'running') {
        j.proc.kill();
        j.finish?.('failed');
      }
    }
  }

  /** busy: a job is running or has just finished (the file watcher lags slightly) */
  const busy = () =>
    [...jobs.values()].some((j) => j.state === 'running') || Date.now() - lastEnd < 3000;

  return { handle, dispose, busy };
}

export type AuthorApi = ReturnType<typeof createAuthorApi>;
