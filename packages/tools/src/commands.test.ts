import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, test } from 'vitest';
import { fromAscii, solve, type LevelData } from '@puzzlecave/core';
import { TILE_ORDER, writeTmx } from '@puzzlecave/tiled';
import { reportSolve, solveCommand, thresholdChanges, validateCommand } from './commands';
import { childNeedBytes, inProcessMemoryMb, planJobs, solveParallel } from './parallel';

const TSX = `<tileset name="pc" tilewidth="16" tileheight="16">${TILE_ORDER.map((k, i) => `<tile id="${i}"><properties><property name="kind" value="${k}"/></properties></tile>`).join('')}</tileset>`;

function fixture(extra: LevelData[] = []): string {
  const dir = mkdtempSync(join(tmpdir(), 'pc-tools-'));
  writeFileSync(join(dir, 'tileset.tsx'), TSX);
  const levels = [fromAscii(['@..E'], { id: 'a' }), fromAscii(['@#E'], { id: 'z' }), ...extra];
  for (const l of levels) writeFileSync(join(dir, `${l.id}.tmx`), writeTmx(l));
  writeFileSync(
    join(dir, 'chapters.json'),
    JSON.stringify([
      { id: 'c', name: { fr: 'C', en: 'C' }, unlockAfter: 0, levels: levels.map((l) => l.id) },
    ]),
  );
  return dir;
}
const opts = { timeoutMs: 5000, maxStates: 100_000, apply: false, force: false };
const tmxOf = (dir: string) => readFileSync(join(dir, 'a.tmx'), 'utf8');

test('validate: OK without solutions', () => {
  const r = validateCommand(fixture());
  expect(r.ok).toBe(true);
  expect(r.lines.at(-1)).toMatch(/2 level\(s\) loaded, 0 solution\(s\) replayed — OK/);
});

test('validate: starting on water is a warning, not an error', () => {
  const dir = fixture();
  const level = fromAscii(['@~.E'], { id: 'w' });
  writeFileSync(join(dir, 'w.tmx'), writeTmx({ ...level, start: { x: 1, y: 0 } }));
  writeFileSync(
    join(dir, 'chapters.json'),
    JSON.stringify([
      { id: 'c', name: { fr: 'C', en: 'C' }, unlockAfter: 0, levels: ['a', 'z', 'w'] },
    ]),
  );
  const r = validateCommand(dir);
  expect(r.ok).toBe(true);
  expect(r.lines).toContain('w: warning — starts on water');
  expect(r.lines.at(-1)).toMatch(/3 level\(s\) loaded, 0 solution\(s\) replayed — OK/);
});

test('validate: a solution that does not win is an error', () => {
  const dir = fixture();
  mkdirSync(join(dir, 'solutions'));
  writeFileSync(join(dir, 'solutions', 'a.txt'), 'RR\n');
  const r = validateCommand(dir);
  expect(r.ok).toBe(false);
  expect(r.lines.join('\n')).toMatch(/a: the solution does not win/);
});

const setGold = (dir: string, from: number, to: number) =>
  writeFileSync(
    join(dir, 'a.tmx'),
    tmxOf(dir).replace(
      `name="goldMoves" type="int" value="${from}"`,
      `name="goldMoves" type="int" value="${to}"`,
    ),
  );
const solutionOf = (dir: string) => readFileSync(join(dir, 'solutions', 'a.txt'), 'utf8');

test('solve --apply writes the solution and goldMoves', () => {
  const dir = fixture();
  expect(solveCommand(dir, ['a'], { ...opts, apply: true }).ok).toBe(true);
  expect(solutionOf(dir)).toBe('# optimal (proven)\nRRR\n');
  expect(tmxOf(dir)).toMatch(/name="goldMoves" type="int" value="3"/);
  expect(validateCommand(dir).ok).toBe(true);
});

test('solve --apply does not rewrite an equal goldMoves nor its solution', () => {
  const dir = fixture();
  solveCommand(dir, ['a'], { ...opts, apply: true });
  writeFileSync(join(dir, 'solutions', 'a.txt'), 'RLRRR\n');
  expect(solveCommand(dir, ['a'], { ...opts, apply: true }).ok).toBe(true);
  expect(solutionOf(dir)).toBe('RLRRR\n');
  expect(tmxOf(dir)).toMatch(/name="goldMoves" type="int" value="3"/);
});

test('solve --apply keeps an existing goldMoves and sets platinumMoves to the proven optimum', () => {
  const dir = fixture();
  solveCommand(dir, ['a'], { ...opts, apply: true });
  setGold(dir, 3, 7);
  writeFileSync(join(dir, 'solutions', 'a.txt'), 'RLRRR\n');
  const r = solveCommand(dir, ['a'], { ...opts, apply: true });
  expect(r.ok).toBe(true);
  expect(r.lines[0]).toMatch(/proposed platinumMoves = 3$/);
  expect(tmxOf(dir)).toMatch(/name="goldMoves" type="int" value="7"/);
  expect(tmxOf(dir)).toMatch(/name="platinumMoves" type="int" value="3"/);
  expect(solutionOf(dir)).toBe('# optimal (proven)\nRRR\n');
  // an equal platinumMoves: nothing rewritten
  const before = tmxOf(dir);
  solveCommand(dir, ['a'], { ...opts, apply: true });
  expect(tmxOf(dir)).toBe(before);
});

const goldTimeOf = (dir: string) =>
  /name="goldTime" type="\w+" value="([\d.]+)"/.exec(tmxOf(dir))?.[1];
const withA = (thresholds: LevelData['thresholds']) => fromAscii(['@..E'], { id: 'a', thresholds });

test('solve --apply on a new level: goldMoves and goldTime from the same solution', () => {
  const dir = fixture();
  const r = solveCommand(dir, ['a'], { ...opts, apply: true });
  expect(r.lines).toContain('a: goldTime = 1 s written (from the 3-move gold solution)');
  expect(tmxOf(dir)).toMatch(/name="goldMoves" type="int" value="3"/);
  expect(goldTimeOf(dir)).toBe('1');
  expect(validateCommand(dir).lines.filter((l) => l.startsWith('a:'))).toEqual([]);
});

test('solve --apply: an existing goldTime is never replaced', () => {
  const dir = fixture();
  writeFileSync(join(dir, 'a.tmx'), writeTmx(withA({ goldTime: 42 })));
  const r = solveCommand(dir, ['a'], { ...opts, apply: true });
  expect(tmxOf(dir)).toMatch(/name="goldMoves" type="int" value="3"/);
  expect(goldTimeOf(dir)).toBe('42');
  expect(r.lines.join('\n')).not.toMatch(/goldTime/);
});

test('solve --apply: a platinum write leaves goldTime untouched', () => {
  const dir = fixture();
  writeFileSync(join(dir, 'a.tmx'), writeTmx(withA({ goldMoves: 7, goldTime: 42 })));
  mkdirSync(join(dir, 'solutions'));
  writeFileSync(join(dir, 'solutions', 'a.txt'), 'RLRRR\n');
  solveCommand(dir, ['a'], { ...opts, apply: true });
  expect(tmxOf(dir)).toMatch(/name="platinumMoves" type="int" value="3"/);
  expect(goldTimeOf(dir)).toBe('42');
});

test('solve --apply: existing goldMoves without goldTime, from a solution of goldMoves moves only', () => {
  // the found solution has goldMoves moves: it is the gold reference
  const equal = fixture();
  writeFileSync(join(equal, 'a.tmx'), writeTmx(withA({ goldMoves: 3 })));
  const r = solveCommand(equal, ['a'], { ...opts, apply: true });
  expect(r.lines).toContain('a: goldTime = 1 s written (from the 3-move gold solution)');
  expect(goldTimeOf(equal)).toBe('1');
  // the saved solution has goldMoves moves (4 turns): it is preferred to the shorter written one
  const saved = fixture();
  writeFileSync(join(saved, 'a.tmx'), writeTmx(withA({ goldMoves: 7 })));
  mkdirSync(join(saved, 'solutions'));
  writeFileSync(join(saved, 'solutions', 'a.txt'), 'RLRLRRR\n');
  const rs = solveCommand(saved, ['a'], { ...opts, apply: true });
  expect(rs.lines).toContain('a: goldTime = 2 s written (from the 7-move gold solution)');
  expect(tmxOf(saved)).toMatch(/name="platinumMoves" type="int" value="3"/);
  expect(goldTimeOf(saved)).toBe('2');
  // neither the saved nor the written solution has goldMoves moves: not guessed
  const none = fixture();
  writeFileSync(join(none, 'a.tmx'), writeTmx(withA({ goldMoves: 9 })));
  const rn = solveCommand(none, ['a'], { ...opts, apply: true });
  expect(rn.ok).toBe(true);
  expect(rn.lines).toContain(
    'a: warning — goldTime missing: run npm run times -- a --apply [--from <folder of the 9-move gold solution>]',
  );
  expect(goldTimeOf(none)).toBeUndefined();
  expect(tmxOf(none)).toMatch(/name="platinumMoves" type="int" value="3"/);
});

test('validate: a level without goldTime is a warning, not an error', () => {
  const dir = fixture();
  writeFileSync(join(dir, 'a.tmx'), writeTmx(withA({ goldTime: 5 })));
  const r = validateCommand(dir);
  expect(r.ok).toBe(true);
  expect(r.lines).toContain(
    'z: warning — no goldTime (npm run times -- z --apply [--from <folder>])',
  );
  expect(r.lines.filter((l) => l.startsWith('a:'))).toEqual([]);
});

test('validate: the gold reference solution must win in exactly goldMoves moves', () => {
  const dir = fixture();
  writeFileSync(join(dir, 'a.tmx'), writeTmx(withA({ goldMoves: 5, platinumMoves: 3 })));
  mkdirSync(join(dir, 'solutions', 'gold'), { recursive: true });
  writeFileSync(join(dir, 'solutions', 'a.txt'), '# optimal (proven)\nRRR\n');
  writeFileSync(join(dir, 'solutions', 'gold', 'a.txt'), 'RLRRR\n');
  const good = validateCommand(dir);
  expect(good.ok).toBe(true);
  expect(good.lines.at(-1)).toMatch(/1 solution\(s\) replayed \(\+ 1 gold reference\(s\)\) — OK$/);
  writeFileSync(join(dir, 'solutions', 'gold', 'a.txt'), 'RRR\n');
  const short = validateCommand(dir);
  expect(short.ok).toBe(false);
  expect(short.lines).toContain(
    'a: the gold reference solution (3 moves) differs from goldMoves (5)',
  );
  writeFileSync(join(dir, 'solutions', 'gold', 'a.txt'), 'RLRR\n');
  expect(validateCommand(dir).lines.join('\n')).toMatch(
    /a: the gold reference solution does not win/,
  );
});

test('thresholdChanges: goldMoves for a new level, platinumMoves otherwise', () => {
  expect(thresholdChanges({}, 50)).toEqual({ goldMoves: 50 });
  expect(thresholdChanges({ goldMoves: 60 }, 50)).toEqual({ platinumMoves: 50 });
  expect(thresholdChanges({ goldMoves: 60 }, 60)).toEqual({});
  expect(thresholdChanges({ goldMoves: 60, platinumMoves: 50 }, 50)).toEqual({});
  expect(thresholdChanges({ goldMoves: 60, platinumMoves: 50 }, 52)).toEqual({});
  expect(thresholdChanges({ goldMoves: 60, platinumMoves: 50 }, 48)).toEqual({ platinumMoves: 48 });
  // --force: always the new length; a goldMoves below it is raised too
  expect(thresholdChanges({ goldMoves: 60, platinumMoves: 50 }, 52, true)).toEqual({
    platinumMoves: 52,
  });
  expect(thresholdChanges({ goldMoves: 60 }, 70, true)).toEqual({
    goldMoves: 70,
    platinumMoves: 70,
  });
});

test('solve: a goldMoves below the optimum is flagged, kept without --force, replaced with it', () => {
  const dir = fixture();
  solveCommand(dir, ['a'], { ...opts, apply: true });
  setGold(dir, 3, 2);
  const r = solveCommand(dir, ['a'], { ...opts, apply: true });
  expect(r.ok).toBe(false);
  expect(r.lines).toContain('a: goldMoves (2) < proven optimum (3) — impossible threshold');
  expect(tmxOf(dir)).toMatch(/name="goldMoves" type="int" value="2"/);
  writeFileSync(join(dir, 'solutions', 'a.txt'), 'RRR\n');
  solveCommand(dir, ['a'], { ...opts, apply: true, force: true });
  expect(tmxOf(dir)).toMatch(/name="goldMoves" type="int" value="3"/);
  // --force rewrites the solution, always with its status header
  expect(solutionOf(dir)).toBe('# optimal (proven)\nRRR\n');
});

test('solve --apply: a write error is an error line, not an exception', () => {
  const dir = fixture();
  writeFileSync(join(dir, 'solutions'), 'not a directory');
  const r = solveCommand(dir, ['a', 'z'], { ...opts, apply: true });
  expect(r.ok).toBe(false);
  expect(r.lines[0]).toMatch(/^a: 3 moves/);
  expect(r.lines[1]).toMatch(/^a: write error — /);
  expect(r.lines.some((l) => /^z: unsolvable/.test(l))).toBe(true);
});

test('solve --apply: an engine solution that does not win is never written (replayed first)', () => {
  const dir = fixture();
  const before = tmxOf(dir);
  const level = fromAscii(['@..E'], { id: 'a' });
  const r = reportSolve(
    dir,
    level,
    { status: 'solved', moves: ['right', 'right'], explored: 1 },
    { apply: true, force: true },
  );
  expect(r.ok).toBe(false);
  expect(r.lines).toEqual([
    'a: engine solution rejected — it does not win (status playing), nothing is written',
  ]);
  expect(existsSync(join(dir, 'solutions', 'a.txt'))).toBe(false);
  expect(tmxOf(dir)).toBe(before);
});

// optimum 17 moves, ~200 macro-states: a limit of 20 states causes an overflow
const BOUNDED = ['@B.B.B.~~E', 'B.B.B.B~~.', '.B.B.B.~~.', 'B.B.B.B...'];

test('solve: on overflow, prints the proven lower bound', () => {
  const dir = fixture([fromAscii(BOUNDED, { id: 'b' })]);
  const r = solveCommand(dir, ['b'], { ...opts, maxStates: 20 });
  expect(r.ok).toBe(false);
  expect(r.lines).toHaveLength(1);
  const m =
    /^b: limit reached without a solution \(\d+ states\) — proven lower bound: ≥ (\d+) moves$/.exec(
      r.lines[0]!,
    );
  expect(m).not.toBeNull();
  const bound = Number(m![1]);
  expect(bound).toBeGreaterThan(0);
  expect(bound).toBeLessThanOrEqual(17);
});

test('solve: at the state limit, the partial-expansion pass gives a deeper bound', () => {
  const dir = fixture([fromAscii(BOUNDED, { id: 'b' })]);
  const plain = solve(fromAscii(BOUNDED), { maxStates: 40 });
  expect(plain.status).toBe('timeout');
  const line = solveCommand(dir, ['b'], { ...opts, maxStates: 40 }).lines[0]!;
  const bound = Number(/≥ (\d+) moves/.exec(line)![1]);
  expect(bound).toBeGreaterThan(plain.status === 'timeout' ? plain.lowerBound : Infinity);
  expect(bound).toBeLessThanOrEqual(17);
});

test('solve: a goldMoves below the proven lower bound is an error', () => {
  const dir = fixture([fromAscii(BOUNDED, { id: 'b', thresholds: { goldMoves: 1 } })]);
  const r = solveCommand(dir, ['b'], { ...opts, maxStates: 20 });
  expect(r.lines[1]).toMatch(
    /^b: goldMoves \(1\) < proven lower bound \(\d+\) — impossible threshold$/,
  );
  writeFileSync(
    join(dir, 'b.tmx'),
    writeTmx(fromAscii(BOUNDED, { id: 'b', thresholds: { goldMoves: 17 } })),
  );
  expect(solveCommand(dir, ['b'], { ...opts, maxStates: 20 }).lines).toHaveLength(1);
});

test('solve flags an unsolvable level and an unknown id', () => {
  const dir = fixture();
  const r = solveCommand(dir, ['z', 'nope'], opts);
  expect(r.ok).toBe(false);
  expect(r.lines.join('\n')).toMatch(/z: unsolvable/);
  expect(r.lines.join('\n')).toMatch(/nope: unknown level/);
  expect(existsSync(join(dir, 'solutions', 'z.txt'))).toBe(false);
});

test('solve --all processes every level', () => {
  const r = solveCommand(fixture(), 'all', opts);
  expect(r.lines.some((l) => l.startsWith('a:'))).toBe(true);
  expect(r.lines.some((l) => l.startsWith('z:'))).toBe(true);
});

const MB = 1024 ** 2;
const GB = 1024 ** 3;
const machine = (gb: number, threads: number, usedPct: number) => ({
  totalBytes: gb * GB,
  freeBytes: gb * GB * (1 - usedPct / 100),
  logicalCpus: threads,
});
const BASE = 150 * MB;
/** share of a child's budget left to the solver (the rest: Node, tsx, pack) */
const solverMb = (childBytes: number) => Math.floor((childBytes - BASE) / MB);

test('estimated memory need of a child', () => {
  // ~120 B per macro-state (compact engine) + 150 MB
  expect(childNeedBytes(6_000_000)).toBe(6_000_000 * 120 + BASE);
  // no state limit: at least 1.5 GB per child
  expect(childNeedBytes(undefined)).toBe(1.5 * GB);
  // explicit solver cap
  expect(childNeedBytes(6_000_000, 3000)).toBe(3000 * MB + BASE);
});

test('plan: 32 GB, 16 threads, 37% already used', () => {
  const m = machine(32, 16, 37);
  const budget = 0.33 * 32 * GB;
  // no state limit: at least 1.5 GB per child, memory limits to 7 processes
  expect(planJobs({ levels: 19, ...m })).toEqual({
    jobs: 7,
    memoryMb: solverMb(budget / 7),
    heapMb: 512,
  });
  // 3 M states (~0.5 GB): the cores limit to 8 processes
  expect(planJobs({ levels: 19, maxStates: 3_000_000, ...m })).toEqual({
    jobs: 8,
    memoryMb: solverMb(budget / 8),
    heapMb: 512,
  });
  // at most one process per level
  expect(planJobs({ levels: 3, ...m }).jobs).toBe(3);
  // explicit cap: 3 GB per solver → 3 processes, cap respected
  expect(planJobs({ levels: 19, maxMemoryMb: 3000, ...m })).toEqual({
    jobs: 3,
    memoryMb: 3000,
    heapMb: 512,
  });
  // explicit --jobs beyond the budget: respected, each child keeps its need, warning
  const forced = planJobs({ levels: 19, jobs: 10, ...m });
  expect(forced).toMatchObject({ jobs: 10, memoryMb: solverMb(1.5 * GB) });
  expect(forced.warning).toMatch(/exceeds/);
});

test('plan: 16 GB, 8 threads, 50% already used', () => {
  const m = machine(16, 8, 50);
  const budget = 0.2 * 16 * GB;
  expect(planJobs({ levels: 19, ...m })).toEqual({
    jobs: 2,
    memoryMb: solverMb(budget / 2),
    heapMb: 512,
  });
  expect(planJobs({ levels: 19, maxStates: 3_000_000, ...m })).toEqual({
    jobs: 4,
    memoryMb: solverMb(budget / 4),
    heapMb: 512,
  });
});

test('plan: 16 threads, 70% or more already used → a single process and a warning', () => {
  for (const used of [70, 85]) {
    const p = planJobs({ levels: 19, ...machine(32, 16, used) });
    expect(p).toMatchObject({ jobs: 1, memoryMb: solverMb(1.5 * GB) });
    expect(p.warning).toMatch(/memory/);
  }
});

test('solver memory in the current process: the budget under 70%, at least 256 MB', () => {
  expect(inProcessMemoryMb(32 * GB, 32 * GB * 0.63)).toBe(solverMb(0.33 * 32 * GB));
  expect(inProcessMemoryMb(32 * GB, 32 * GB * 0.2)).toBe(256);
});

test('parallel solve: same statuses and lengths as sequential', async () => {
  const levels = [fromAscii(BOUNDED, { id: 'b' }), fromAscii(BOUNDED.slice(0, 3), { id: 'c' })];
  const seqDir = fixture(levels);
  const o = { ...opts, maxStates: 50 };
  const seq = solveCommand(seqDir, ['a', 'z', 'b', 'c', 'nope'], o);
  const streamed: string[] = [];
  const par = await solveParallel(fixture(levels), ['a', 'z', 'b', 'c', 'nope'], {
    ...o,
    jobs: 2,
    onLine: (l) => streamed.push(l),
  });
  expect(par.ok).toBe(seq.ok);
  expect(par.lines).toEqual(streamed);
  for (const line of seq.lines) expect(par.lines).toContain(line);
  const summary = par.lines.join('\n');
  expect(summary).toMatch(/solved \(\d+\)/);
  expect(summary).toMatch(/total time/);
}, 60_000);

test('parallel solve --apply: writes done by the parent', async () => {
  const dir = fixture();
  const r = await solveParallel(dir, ['a', 'z'], { ...opts, apply: true, jobs: 2 });
  expect(r.ok).toBe(false);
  expect(solutionOf(dir)).toBe('# optimal (proven)\nRRR\n');
  expect(tmxOf(dir)).toMatch(/name="goldMoves" type="int" value="3"/);
}, 60_000);

test('parallel solve: a failing process is flagged without blocking the others', async () => {
  const dir = fixture([fromAscii(BOUNDED, { id: 'b' })]);
  const r = await solveParallel(dir, 'all', {
    ...opts,
    jobs: 1,
    crash: { a: 'throw', z: 'exit' },
  });
  expect(r.ok).toBe(false);
  expect(r.lines).toContain('a: process failed (code 1)');
  expect(r.lines).toContain('z: process failed (code 7)');
  expect(r.lines.some((l) => /^b: 17 moves/.test(l))).toBe(true);
}, 60_000);

/** summary lines ("  id: …") by id */
const summaryRows = (lines: string[]) => {
  const rows = new Map<string, number>();
  for (const l of lines) {
    const m = /^ {2}(\S+): /.exec(l);
    if (m) rows.set(m[1]!, (rows.get(m[1]!) ?? 0) + 1);
  }
  return rows;
};

test('parallel solve: each level is reported exactly once', async () => {
  const dir = fixture([fromAscii(BOUNDED, { id: 'b' })]);
  for (let round = 0; round < 3; round++) {
    const r = await solveParallel(dir, 'all', { ...opts, jobs: 3 });
    expect(Object.fromEntries(summaryRows(r.lines))).toEqual({ a: 1, b: 1, z: 1 });
    for (const id of ['a', 'b', 'z'])
      expect(r.lines.filter((l) => l.startsWith(`${id}: `))).toHaveLength(1);
    expect(r.lines.some((l) => l.includes('failed'))).toBe(false);
  }
}, 60_000);

test('parallel solve: a --apply write error becomes an error line', async () => {
  const dir = fixture([fromAscii(BOUNDED, { id: 'b' })]);
  // "solutions" is a file: the solutions directory cannot be created
  writeFileSync(join(dir, 'solutions'), 'not a directory');
  const r = await solveParallel(dir, 'all', { ...opts, apply: true, jobs: 1 });
  expect(r.ok).toBe(false);
  expect(r.lines.some((l) => /^a: write error — /.test(l))).toBe(true);
  expect(r.lines.some((l) => /^b: 17 moves/.test(l))).toBe(true);
  expect(r.lines.at(-1)).toMatch(/total time/);
}, 60_000);

test('parallel solve: a hung child is stopped by the watchdog', async () => {
  const dir = fixture();
  const r = await solveParallel(dir, 'all', {
    ...opts,
    timeoutMs: 200,
    jobs: 2,
    watchdogMarginMs: 1000,
    crash: { a: 'hang' },
  });
  expect(r.ok).toBe(false);
  expect(r.lines).toContain('a: process stopped — no result after 1.2 s');
  expect(r.lines.some((l) => /^z: unsolvable/.test(l))).toBe(true);
}, 60_000);
