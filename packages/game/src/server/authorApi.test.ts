import { mkdirSync, mkdtempSync, readFileSync, existsSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, expect, test } from 'vitest';
import { fromAscii } from '@puzzlecave/core';
import {
  createAuthorApi,
  improveArgs,
  IMPROVE_ARGS,
  type Launch,
  type LaunchedProcess,
} from './authorApi';

const LEVEL = fromAscii(['@.#', '..E']); // RDR wins in 3 moves

let dir: string;
let launches: { id: string; timeoutS: number; proc: Fake }[];

class Fake implements LaunchedProcess {
  killed = false;
  line: (l: string) => void = () => {};
  exit: (code: number | null) => void = () => {};
  onLine(cb: (l: string) => void): void {
    this.line = cb;
  }
  onExit(cb: (code: number | null) => void): void {
    this.exit = cb;
  }
  kill(): void {
    this.killed = true;
  }
}
const launch: Launch = (id, timeoutS) => {
  const proc = new Fake();
  launches.push({ id, timeoutS, proc });
  return proc;
};

const make = (timeoutS?: number) =>
  createAuthorApi({
    levelsDir: dir,
    getLevel: (id) => (id === 'lvl' ? { ...LEVEL, id: 'lvl' } : undefined),
    launch,
    timeoutS,
  });

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'pc-author-'));
  mkdirSync(join(dir, 'solutions'));
  launches = [];
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

const file = () => join(dir, 'solutions', 'lvl.txt');

test('GET solution: 404 if missing, otherwise text, moves and header', async () => {
  const api = make();
  expect((await api.handle('GET', '/__pc/solution/lvl')).status).toBe(404);
  writeFileSync(file(), '# optimal (proven)\nRDR\n');
  const r = await api.handle('GET', '/__pc/solution/lvl');
  expect(r.status).toBe(200);
  expect(r.body).toEqual({
    text: '# optimal (proven)\nRDR\n',
    moves: 'RDR',
    header: '# optimal (proven)',
  });
});

test('invalid id, path or unknown level: refused, nothing written', async () => {
  const api = make();
  for (const id of ['../x', 'a%2Fb', 'unknown', '..%5Cx', '']) {
    const r = await api.handle('POST', `/__pc/solution/${id}`, { moves: 'RDR' });
    expect([400, 404]).toContain(r.status);
  }
  expect(launches).toHaveLength(0);
});

test('POST: invalid body, invalid characters, solution that does not win', async () => {
  const api = make();
  expect((await api.handle('POST', '/__pc/solution/lvl', undefined)).status).toBe(400);
  expect((await api.handle('POST', '/__pc/solution/lvl', { moves: 12 })).status).toBe(400);
  expect((await api.handle('POST', '/__pc/solution/lvl', { moves: 'RXR' })).status).toBe(400);
  const r = await api.handle('POST', '/__pc/solution/lvl', { moves: 'RD' });
  expect(r.status).toBe(422);
  expect(existsSync(file())).toBe(false);
  expect(launches).toHaveLength(0);
});

test('valid POST: writes with the designer header and launches improve', async () => {
  const api = make(30);
  const r = await api.handle('POST', '/__pc/solution/lvl', { moves: 'r d r' });
  expect(r.status).toBe(200);
  expect(r.body).toMatchObject({ saved: true, moves: 3 });
  expect(readFileSync(file(), 'utf8')).toBe('# designer solution (not optimized)\nRDR\n');
  expect(launches).toHaveLength(1);
  expect(launches[0]).toMatchObject({ id: 'lvl', timeoutS: 30 });
  const jobId = (r.body as { jobId: string }).jobId;
  const job = await api.handle('GET', `/__pc/job/${jobId}`);
  expect(job.body).toMatchObject({ state: 'running', levelId: 'lvl' });
});

test('default timeout 120 s', async () => {
  await make().handle('POST', '/__pc/solution/lvl', { moves: 'RDR' });
  expect(launches[0]!.timeoutS).toBe(120);
});

test('a single job per level at a time', async () => {
  const api = make();
  await api.handle('POST', '/__pc/solution/lvl', { moves: 'RLRDR' });
  const r = await api.handle('POST', '/__pc/solution/lvl', { moves: 'RDR', force: true });
  expect(r.status).toBe(409);
  expect(r.body).toMatchObject({ error: 'job-running' });
  expect(launches).toHaveLength(1);
});

test('saved solution shorter or equal: refused unless forced', async () => {
  const api = make();
  writeFileSync(file(), '# optimal (proven)\nRDR\n');
  const same = await api.handle('POST', '/__pc/solution/lvl', { moves: 'DRR' });
  expect(same.status).toBe(409);
  expect(same.body).toMatchObject({ error: 'not-shorter', existing: 3 });
  const longer = await api.handle('POST', '/__pc/solution/lvl', { moves: 'RLRDR' });
  expect(longer.status).toBe(409);
  expect(readFileSync(file(), 'utf8')).toBe('# optimal (proven)\nRDR\n');
  const forced = await api.handle('POST', '/__pc/solution/lvl', { moves: 'RLRDR', force: true });
  expect(forced.status).toBe(200);
  expect(readFileSync(file(), 'utf8')).toBe('# designer solution (not optimized)\nRLRDR\n');
});

test('saved solution longer: replaced without force', async () => {
  const api = make();
  writeFileSync(file(), '# x\nRLRDR\n');
  expect((await api.handle('POST', '/__pc/solution/lvl', { moves: 'RDR' })).status).toBe(200);
});

test('invalid saved solution: replaced without force', async () => {
  const api = make();
  writeFileSync(file(), '# x\nRD\n');
  expect((await api.handle('POST', '/__pc/solution/lvl', { moves: 'RDR' })).status).toBe(200);
});

test('job: output parsed, done with before/after/proof', async () => {
  const api = make();
  const r = await api.handle('POST', '/__pc/solution/lvl', { moves: 'RLRDR' });
  const jobId = (r.body as { jobId: string }).jobId;
  const p = launches[0]!.proc;
  p.line('> improve');
  p.line('lvl: solution saved (5) → 3 moves — optimal (proven) (0.1 s)');
  p.line('  proof: 5 → 3 (0.0 s) — exact search finished (3 states)');
  p.exit(0);
  const job = (await api.handle('GET', `/__pc/job/${jobId}`)).body as Record<string, unknown>;
  expect(job).toMatchObject({
    state: 'done',
    before: 5,
    after: 3,
    proven: true,
    lowerBound: 3,
  });
  expect(job.log).toContain('  proof: 5 → 3 (0.0 s) — exact search finished (3 states)');
  // the level is free again
  writeFileSync(file(), '# optimal (proven)\nRDR\n');
  expect(
    (await api.handle('POST', '/__pc/solution/lvl', { moves: 'RLRDR', force: true })).status,
  ).toBe(200);
});

test('job: non-zero exit code or unreadable output = failed', async () => {
  const api = make();
  const r = await api.handle('POST', '/__pc/solution/lvl', { moves: 'RDR' });
  const jobId = (r.body as { jobId: string }).jobId;
  launches[0]!.proc.exit(1);
  expect((await api.handle('GET', `/__pc/job/${jobId}`)).body).toMatchObject({ state: 'failed' });
  const r2 = await api.handle('POST', '/__pc/solution/lvl', { moves: 'RDR', force: true });
  launches[1]!.proc.exit(0); // no result line
  expect(
    (await api.handle('GET', `/__pc/job/${(r2.body as { jobId: string }).jobId}`)).body,
  ).toMatchObject({ state: 'failed' });
});

test('unknown job: 404; unknown route: 404; unhandled method: 405', async () => {
  const api = make();
  expect((await api.handle('GET', '/__pc/job/nope')).status).toBe(404);
  expect((await api.handle('GET', '/__pc/other')).status).toBe(404);
  expect((await api.handle('DELETE', '/__pc/solution/lvl')).status).toBe(405);
});

test('dispose kills running jobs', async () => {
  const api = make();
  await api.handle('POST', '/__pc/solution/lvl', { moves: 'RDR' });
  api.dispose();
  expect(launches[0]!.proc.killed).toBe(true);
});

test('improve arguments defined in a single place', () => {
  expect(IMPROVE_ARGS).toEqual(['--apply']);
  expect(improveArgs('lvl', 45)).toEqual(['improve', 'lvl', '--apply', '--timeout', '45']);
});
