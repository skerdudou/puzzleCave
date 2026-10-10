// Client of the /__pc/* routes of the development server (absent from the build).
import { parseMoves, type Dir } from '@puzzlecave/core';
import { app } from '../app';
import type { JobInfo } from './jobText';

/** The saving tools only exist on `vite dev` (the routes are not in the build). */
export const authorServerAvailable = (): boolean => import.meta.env.DEV && app.author;

export type SaveOutcome =
  | { kind: 'saved'; jobId: string; moves: number }
  | { kind: 'not-shorter'; existing: number; proven: boolean }
  | { kind: 'not-winning' }
  | { kind: 'job-running' }
  | { kind: 'error'; message: string };

async function call(method: string, path: string, body?: unknown): Promise<Response> {
  return fetch(path, {
    method,
    headers: body === undefined ? undefined : { 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
    cache: 'no-store',
  });
}

export async function saveSolution(
  levelId: string,
  moves: string,
  force = false,
): Promise<SaveOutcome> {
  try {
    const r = await call('POST', `/__pc/solution/${encodeURIComponent(levelId)}`, { moves, force });
    const body = (await r.json().catch(() => ({}))) as Record<string, unknown>;
    if (r.ok) return { kind: 'saved', jobId: String(body.jobId), moves: Number(body.moves) };
    if (body.error === 'not-shorter')
      return {
        kind: 'not-shorter',
        existing: Number(body.existing),
        proven: body.existingProven === true,
      };
    if (body.error === 'not-winning') return { kind: 'not-winning' };
    if (body.error === 'job-running') return { kind: 'job-running' };
    return { kind: 'error', message: String(body.message ?? body.error ?? r.status) };
  } catch (err) {
    return { kind: 'error', message: (err as Error).message };
  }
}

export async function fetchJob(jobId: string): Promise<JobInfo | null> {
  try {
    const r = await call('GET', `/__pc/job/${encodeURIComponent(jobId)}`);
    return r.ok ? ((await r.json()) as JobInfo) : null;
  } catch {
    return null;
  }
}

/** Saved solution of the level, or null (missing / server unreachable). */
export async function fetchSolution(
  levelId: string,
): Promise<{ moves: Dir[]; header: string } | null> {
  try {
    const r = await call('GET', `/__pc/solution/${encodeURIComponent(levelId)}`);
    if (!r.ok) return null;
    const b = (await r.json()) as { text: string; header: string };
    return { moves: parseMoves(b.text), header: b.header };
  } catch {
    return null;
  }
}
