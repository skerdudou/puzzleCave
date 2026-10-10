import {
  copyFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { fromAscii } from '@puzzlecave/core';
import { createAuthorApi, type Launch, type LaunchedProcess } from './authorApi';

const LEVEL = fromAscii(['@.#', '..E']); // RDR wins in 3 moves; RLRDR in 5

let dir: string;
let launches: { proc: Fake }[];

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
const launch: Launch = () => {
  const proc = new Fake();
  launches.push({ proc });
  return proc;
};
const make = (timeoutS?: number) =>
  createAuthorApi({
    levelsDir: dir,
    getLevel: (id) => (id === 'lvl' ? { ...LEVEL, id: 'lvl' } : undefined),
    launch,
    timeoutS,
  });
const file = () => join(dir, 'solutions', 'lvl.txt');
const prev = () => join(dir, 'solutions', 'lvl.prev.txt');
const post = (api: ReturnType<typeof make>, moves: string, force = false) =>
  api.handle('POST', '/__pc/solution/lvl', { moves, force });
const jobOf = async (api: ReturnType<typeof make>, r: { body: unknown }) =>
  (await api.handle('GET', `/__pc/job/${(r.body as { jobId: string }).jobId}`)).body;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'pc-author-jobs-'));
  mkdirSync(join(dir, 'solutions'));
  launches = [];
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

const PROVEN = '# optimal (proven)\nRDR\n';
const PROVEN_LINE = 'lvl: solution saved (3) → 3 moves — optimal (proven) (0.1 s)';
const BEST_LINE = 'lvl: solution saved (5) → 5 moves — best known, proven lower bound ≥ 2 (1.0 s)';

test('exit code 1 with a result and a warning: done, warnings kept', async () => {
  const api = make();
  const r = await post(api, 'RDR');
  const p = launches[0]!.proc;
  p.line(PROVEN_LINE);
  p.line('lvl: goldMoves (2) < proven optimum (3) — impossible threshold');
  p.exit(1);
  const job = (await jobOf(api, r)) as { state: string; proven: boolean; warnings: string[] };
  expect(job).toMatchObject({ state: 'done', after: 3, proven: true });
  expect(job.warnings).toHaveLength(1);
});

test('without a result line or null code: failed', async () => {
  const api = make();
  const r = await post(api, 'RDR');
  launches[0]!.proc.exit(1);
  expect(await jobOf(api, r)).toMatchObject({ state: 'failed' });
  const r2 = await post(api, 'RDR', true);
  launches[1]!.proc.line(PROVEN_LINE);
  launches[1]!.proc.exit(null);
  expect(await jobOf(api, r2)).toMatchObject({ state: 'failed' });
});

describe('hard stop', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  test('stuck child killed at timeout + 90 s; job failed; level freed', async () => {
    const api = make(30);
    const r = await post(api, 'RLRDR');
    vi.advanceTimersByTime(119_000);
    expect(launches[0]!.proc.killed).toBe(false);
    vi.advanceTimersByTime(1_500);
    expect(launches[0]!.proc.killed).toBe(true);
    expect(await jobOf(api, r)).toMatchObject({ state: 'failed' });
    expect((await post(api, 'RLRDR', true)).status).toBe(200);
  });

  test('normal exit: timer cancelled', async () => {
    const api = make(30);
    await post(api, 'RDR');
    launches[0]!.proc.line(PROVEN_LINE);
    launches[0]!.proc.exit(0);
    vi.advanceTimersByTime(500_000);
    expect(launches[0]!.proc.killed).toBe(false);
  });
});

describe('proof never degraded', () => {
  test('refusal: existingProven; forced replacement: old one kept in .prev.txt', async () => {
    const api = make();
    writeFileSync(file(), PROVEN);
    const refused = await post(api, 'RLRDR');
    expect(refused.body).toMatchObject({ error: 'not-shorter', existing: 3, existingProven: true });
    await post(api, 'RLRDR', true);
    expect(readFileSync(prev(), 'utf8')).toBe(PROVEN);
  });

  test('improve did not prove: proven file restored, job reports proofKept', async () => {
    const api = make();
    writeFileSync(file(), PROVEN);
    const r = await post(api, 'RLRDR', true);
    writeFileSync(file(), '# best known — not proven optimal (proven lower bound ≥ 2)\nRLRDR\n');
    launches[0]!.proc.line(BEST_LINE);
    launches[0]!.proc.exit(0);
    expect(readFileSync(file(), 'utf8')).toBe(PROVEN);
    expect(existsSync(prev())).toBe(false);
    expect(await jobOf(api, r)).toMatchObject({
      state: 'done',
      proven: true,
      after: 3,
      proofKept: true,
    });
  });

  test('job failure: proof also kept', async () => {
    const api = make();
    writeFileSync(file(), PROVEN);
    await post(api, 'RLRDR', true);
    launches[0]!.proc.exit(null);
    expect(readFileSync(file(), 'utf8')).toBe(PROVEN);
  });

  test('improve proved: nothing to restore, .prev.txt removed', async () => {
    const api = make();
    writeFileSync(file(), PROVEN);
    const r = await post(api, 'RLRDR', true);
    writeFileSync(file(), PROVEN);
    launches[0]!.proc.line('lvl: solution saved (5) → 3 moves — optimal (proven) (1.0 s)');
    launches[0]!.proc.exit(0);
    expect(existsSync(prev())).toBe(false);
    expect(await jobOf(api, r)).toMatchObject({ proven: true, after: 3 });
    expect(await jobOf(api, r)).not.toMatchObject({ proofKept: true });
  });

  test('old unproven solution: no restoration', async () => {
    const api = make();
    writeFileSync(file(), '# best known — not proven optimal (proven lower bound ≥ 2)\nRDR\n');
    await post(api, 'RLRDR', true);
    writeFileSync(file(), '# x\nRLRDR\n');
    launches[0]!.proc.line(BEST_LINE);
    launches[0]!.proc.exit(0);
    expect(readFileSync(file(), 'utf8')).toBe('# x\nRLRDR\n');
  });
});

describe('restoration robustness', () => {
  test('copy impossible (EBUSY): no exception, warning, onJobEnd and job finished', async () => {
    const ended: string[] = [];
    const api = createAuthorApi({
      levelsDir: dir,
      getLevel: (id) => (id === 'lvl' ? { ...LEVEL, id: 'lvl' } : undefined),
      launch,
      onJobEnd: (id) => ended.push(id),
      fsOps: {
        copyFileSync: (a, b) => {
          if (String(b).endsWith('lvl.txt')) throw new Error('EBUSY');
          copyFileSync(a, b);
        },
        unlinkSync: () => {
          throw new Error('EPERM');
        },
      },
    });
    writeFileSync(file(), PROVEN);
    const r = await post(api, 'RLRDR', true);
    launches[0]!.proc.line(BEST_LINE);
    expect(() => launches[0]!.proc.exit(0)).not.toThrow();
    expect(ended).toEqual(['lvl']);
    expect(api.busy()).toBe(true); // lastEnd set
    const job = (await jobOf(api, r)) as { state: string; warnings: string[] };
    expect(job.state).toBe('done');
    expect(job.warnings.join(' ')).toContain('EBUSY');
    // the only copy of the proof is kept, and the warning names it
    expect(readFileSync(prev(), 'utf8')).toBe(PROVEN);
    expect(job.warnings.join(' ')).toContain('lvl.prev.txt');
    expect((await post(api, 'RLRDR', true)).status).toBe(200); // level freed
  });

  test('throwing onJobEnd: does not escape the callback, the job is finished', async () => {
    const api = createAuthorApi({
      levelsDir: dir,
      getLevel: (id) => (id === 'lvl' ? { ...LEVEL, id: 'lvl' } : undefined),
      launch,
      onJobEnd: () => {
        throw new Error('boom');
      },
    });
    const r = await post(api, 'RDR');
    launches[0]!.proc.line(PROVEN_LINE);
    expect(() => launches[0]!.proc.exit(0)).not.toThrow();
    expect(await jobOf(api, r)).toMatchObject({ state: 'done' });
  });

  test('dispose: child killed, timer cancelled, proof restored from .prev.txt', async () => {
    const api = make();
    writeFileSync(file(), PROVEN);
    const r = await post(api, 'RLRDR', true);
    api.dispose();
    expect(launches[0]!.proc.killed).toBe(true);
    expect(readFileSync(file(), 'utf8')).toBe(PROVEN);
    expect(existsSync(prev())).toBe(false);
    expect(await jobOf(api, r)).toMatchObject({ state: 'failed', proofKept: true });
  });

  describe('timer', () => {
    beforeEach(() => vi.useFakeTimers());
    afterEach(() => vi.useRealTimers());
    test('dispose cancels the hard-stop timer', async () => {
      const api = make(30);
      await post(api, 'RDR');
      api.dispose();
      expect(vi.getTimerCount()).toBe(0);
    });
  });
});

test('GET solution: unknown level = 404 unknown-level', async () => {
  writeFileSync(join(dir, 'solutions', 'other.txt'), 'RDR\n');
  expect((await make().handle('GET', '/__pc/solution/other')).body).toMatchObject({
    error: 'unknown-level',
  });
});
