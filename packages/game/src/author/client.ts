// Client of the /__pc/* routes of the development server (absent from the build), and the saved
// solutions bundled in the preview of main.
import { parseMoves, type Dir } from '@puzzlecave/core';
import { app } from '../app';
import { PREVIEW } from '../preview';
import type { JobInfo } from './jobText';

/** The saving tools only exist on `vite dev` (the routes are not in the build). */
export const authorServerAvailable = (): boolean => import.meta.env.DEV && app.author;

/**
 * The saved solutions can be replayed: on `vite dev` (read from disk) and in the preview of main
 * (bundled in it, as of its commit); never in the release.
 */
export const savedSolutionsAvailable = (): boolean =>
  app.author && (import.meta.env.DEV || PREVIEW);

export interface SavedSolution {
  moves: Dir[];
  /** its first comment line ("# optimal (proven)", "# best known …") */
  header: string;
}

/** A solution file's text (levels/solutions/<id>.txt): its moves and its header. */
export function parseSavedSolution(text: string): SavedSolution {
  return {
    moves: parseMoves(text),
    header: text.split(/\r?\n/).find((l) => l.startsWith('#')) ?? '',
  };
}

/** The level's saved solution, or null (none saved, server unreachable, the release). */
export async function savedSolution(levelId: string): Promise<SavedSolution | null> {
  if (import.meta.env.DEV) return fetchSolution(levelId);
  if (!PREVIEW) return null;
  const { solutions } = await import('virtual:solutions');
  const text = solutions[levelId];
  return text === undefined ? null : parseSavedSolution(text);
}

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
export async function fetchSolution(levelId: string): Promise<SavedSolution | null> {
  try {
    const r = await call('GET', `/__pc/solution/${encodeURIComponent(levelId)}`);
    if (!r.ok) return null;
    const b = (await r.json()) as { text: string; header: string };
    return { moves: parseMoves(b.text), header: b.header };
  } catch {
    return null;
  }
}
