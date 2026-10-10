import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, test } from 'vitest';
import {
  fromAscii,
  parseMoves,
  replay,
  solve,
  type ExactEngine,
  type ImproveResult,
  type LevelData,
} from '@puzzlecave/core';
import { TILE_ORDER, writeTmx } from '@puzzlecave/tiled';
import { validateCommand } from './commands';
import { improveCommand, improveParallel, reportImprove, solutionHeader } from './improve';

const TSX = `<tileset name="pc" tilewidth="16" tileheight="16">${TILE_ORDER.map((k, i) => `<tile id="${i}"><properties><property name="kind" value="${k}"/></properties></tile>`).join('')}</tileset>`;

// optimum 4 (RRRR): key, block into the water, exit
const ROWS = ['@kB~E', '.D###', '.k...'];
const LONG = 'DDUURLRRRR\n';

function fixture(levels: LevelData[], solutions: Record<string, string> = {}): string {
  const dir = mkdtempSync(join(tmpdir(), 'pc-improve-'));
  writeFileSync(join(dir, 'tileset.tsx'), TSX);
  for (const l of levels) writeFileSync(join(dir, `${l.id}.tmx`), writeTmx(l));
  writeFileSync(
    join(dir, 'chapters.json'),
    JSON.stringify([
      { id: 'c', name: { fr: 'C', en: 'C' }, unlockAfter: 0, levels: levels.map((l) => l.id) },
    ]),
  );
  if (Object.keys(solutions).length > 0) mkdirSync(join(dir, 'solutions'));
  for (const [id, text] of Object.entries(solutions))
    writeFileSync(join(dir, 'solutions', `${id}.txt`), text);
  return dir;
}
const level = (id: string, goldMoves?: number) =>
  fromAscii(ROWS, { id, ...(goldMoves !== undefined ? { thresholds: { goldMoves } } : {}) });
const tmx = (dir: string, id = 'k') => readFileSync(join(dir, `${id}.tmx`), 'utf8');
const gold = (dir: string, id = 'k') =>
  /name="goldMoves" type="int" value="(\d+)"/.exec(tmx(dir, id))?.[1];
const solution = (dir: string, id = 'k') =>
  readFileSync(join(dir, 'solutions', `${id}.txt`), 'utf8');
const opts = { timeoutMs: 20_000, maxStates: 100_000, apply: false, force: false };
const stuck = (lowerBound: number) => () => ({
  status: 'timeout' as const,
  explored: 0,
  lowerBound,
});

test('solution status header', () => {
  expect(solutionHeader(true, 4)).toBe('# optimal (proven)');
  expect(solutionHeader(false, 62)).toBe(
    '# best known — not proven optimal (proven lower bound ≥ 62)',
  );
});

test('improve: the designer solution is the starting point; without --apply nothing is written', () => {
  const dir = fixture([level('k', 10)], { k: LONG });
  const r = improveCommand(dir, ['k'], opts);
  expect(r.ok).toBe(true);
  expect(r.lines[0]).toMatch(
    /^k: solution saved \(10\) → 4 moves — optimal \(proven\) \(\d+\.\d s\)$/,
  );
  expect(r.lines.some((l) => /^ {2}proof: /.test(l))).toBe(true);
  expect(solution(dir)).toBe(LONG);
  expect(gold(dir)).toBe('10');
});

test('improve --apply: solution with its comment, goldMoves lowered', () => {
  const dir = fixture([level('k', 10)], { k: LONG });
  expect(improveCommand(dir, ['k'], { ...opts, apply: true }).ok).toBe(true);
  expect(solution(dir)).toBe('# optimal (proven)\nRRRR\n');
  expect(gold(dir)).toBe('4');
  expect(validateCommand(dir).ok).toBe(true);
});

test('improve --apply: goldMoves only lowered by a shorter solution', () => {
  // equal goldMoves: unchanged, the .tmx is not rewritten
  const same = fixture([level('k', 4)], { k: 'RRRR\n' });
  const before = tmx(same);
  improveCommand(same, ['k'], { ...opts, apply: true });
  expect(tmx(same)).toBe(before);
  expect(solution(same)).toBe('# optimal (proven)\nRRRR\n');
  // goldMoves below the proven optimum: flagged, kept without --force, replaced with it
  const low = fixture([level('k', 3)], { k: LONG });
  const r = improveCommand(low, ['k'], { ...opts, apply: true });
  expect(r.ok).toBe(false);
  expect(r.lines).toContain('k: goldMoves (3) < proven optimum (4) — impossible threshold');
  expect(gold(low)).toBe('3');
  improveCommand(low, ['k'], { ...opts, apply: true, force: true });
  expect(gold(low)).toBe('4');
});

test('improve --apply: best known but unproven, comment with the lower bound', () => {
  const dir = fixture([level('k')], { k: 'RRRR\n' });
  const r = improveCommand(dir, ['k'], { ...opts, apply: true, exact: stuck(2) });
  expect(r.ok).toBe(true);
  expect(r.lines[0]).toMatch(
    /^k: solution saved \(4\) → 4 moves — best known, proven lower bound ≥ 2 /,
  );
  expect(solution(dir)).toBe('# best known — not proven optimal (proven lower bound ≥ 2)\nRRRR\n');
  expect(gold(dir)).toBe('4');
});

test('improve: without a designer solution, one is searched for', () => {
  const dir = fixture([level('k')]);
  const r = improveCommand(dir, ['k'], { ...opts, apply: true });
  expect(r.lines[0]).toMatch(/^k: solution found \(\d+\) → 4 moves — optimal \(proven\)/);
  expect(solution(dir)).toBe('# optimal (proven)\nRRRR\n');
  expect(gold(dir)).toBe('4');
});

const found = (dir: string, id = 'k') =>
  readFileSync(join(dir, 'solutions', `${id}.found.txt`), 'utf8');

test.each([
  ['that does not win', 'D\n', 'the saved solution does not win (status playing), ignored'],
  ['unreadable', 'DX\n', 'unreadable solution (invalid solution character: "X"), ignored'],
])(
  'improve --apply: a saved solution %s is kept, the found one written next to it',
  (_, text, warning) => {
    const dir = fixture([level('k', 9)], { k: text });
    const before = tmx(dir);
    const r = improveCommand(dir, ['k'], { ...opts, apply: true });
    expect(r.ok).toBe(false);
    expect(r.lines).toContain(`k: warning — ${warning}`);
    expect(r.lines.some((l) => /^k: solution found/.test(l))).toBe(true);
    expect(r.lines).toContain(
      'k: saved solution kept (invalid) — found solution written to solutions/k.found.txt, goldMoves unchanged; --force to replace',
    );
    expect(solution(dir)).toBe(text);
    expect(tmx(dir)).toBe(before);
    expect(found(dir)).toBe('# optimal (proven)\nRRRR\n');
    // with --force, the found solution replaces the invalid one; the stale .found.txt disappears
    improveCommand(dir, ['k'], { ...opts, apply: true, force: true });
    expect(solution(dir)).toBe('# optimal (proven)\nRRRR\n');
    expect(replay(level('k'), parseMoves(solution(dir))).status).toBe('won');
    expect(gold(dir)).toBe('4');
    expect(existsSync(join(dir, 'solutions', 'k.found.txt'))).toBe(false);
  },
);

test('improve --apply: the stale .found.txt disappears when the saved solution becomes valid again', () => {
  const dir = fixture([level('k', 9)], { k: 'D\n' });
  improveCommand(dir, ['k'], { ...opts, apply: true });
  expect(found(dir)).toBe('# optimal (proven)\nRRRR\n');
  // the designer fixes their solution
  writeFileSync(join(dir, 'solutions', 'k.txt'), LONG);
  const r = improveCommand(dir, ['k'], { ...opts, apply: true });
  expect(r.ok).toBe(true);
  expect(existsSync(join(dir, 'solutions', 'k.found.txt'))).toBe(false);
  expect(solution(dir)).toBe('# optimal (proven)\nRRRR\n');
  // without --apply, nothing is touched
  const dir2 = fixture([level('k', 9)], { k: 'D\n' });
  improveCommand(dir2, ['k'], { ...opts, apply: true });
  writeFileSync(join(dir2, 'solutions', 'k.txt'), LONG);
  improveCommand(dir2, ['k'], opts);
  expect(found(dir2)).toBe('# optimal (proven)\nRRRR\n');
});

test('improve --apply: a solution that does not win is never written (replayed first)', () => {
  const dir = fixture([level('k', 9)]);
  const before = tmx(dir);
  const bad: ImproveResult = {
    start: 'found',
    initialLength: 1,
    moves: ['down'],
    proven: false,
    lowerBound: 1,
    stages: [],
  };
  const r = reportImprove(dir, level('k', 9), bad, 0, { apply: true, force: true });
  expect(r.ok).toBe(false);
  expect(r.lines).toContain(
    'k: solution rejected — it does not win (status playing), nothing is written',
  );
  expect(existsSync(join(dir, 'solutions', 'k.txt'))).toBe(false);
  expect(tmx(dir)).toBe(before);
});

test('improve: unsolvable or unknown level', () => {
  const dir = fixture([fromAscii(['@#E'], { id: 'z' })]);
  const r = improveCommand(dir, ['z', 'nope'], { ...opts, apply: true });
  expect(r.ok).toBe(false);
  expect(r.lines.some((l) => /^z: no solution — unsolvable/.test(l))).toBe(true);
  expect(r.lines).toContain('nope: unknown level');
  expect(existsSync(join(dir, 'solutions', 'z.txt'))).toBe(false);
});

test('parallel improve: same level lines, writes by the parent', async () => {
  const levels = [level('k', 10), fromAscii(['@#E'], { id: 'z' })];
  const seq = improveCommand(fixture(levels, { k: LONG }), ['k', 'z'], opts);
  const dir = fixture(levels, { k: LONG });
  const par = await improveParallel(dir, 'all', { ...opts, apply: true, jobs: 2 });
  expect(par.ok).toBe(false);
  const levelLine = (lines: string[], id: string) =>
    lines.find((l) => l.startsWith(`${id}: `))!.replace(/\(\d+\.\d s\)/, '');
  expect(levelLine(par.lines, 'k')).toBe(levelLine(seq.lines, 'k'));
  expect(levelLine(par.lines, 'z')).toBe(levelLine(seq.lines, 'z'));
  expect(par.lines.join('\n')).toMatch(/proven \(1\):\n {2}k: 4 moves/);
  expect(par.lines.at(-1)).toMatch(/total time/);
  expect(solution(dir)).toBe('# optimal (proven)\nRRRR\n');
  expect(gold(dir)).toBe('4');
}, 60_000);

test('improve: compact engine memory cap — --max-memory, otherwise the budget under 70%', () => {
  const seen: (number | undefined)[] = [];
  const exact: ExactEngine = (l, eo) => {
    seen.push(eo.maxMemoryMb);
    return solve(l, eo);
  };
  improveCommand(fixture([level('k')], { k: LONG }), ['k'], { ...opts, maxMemoryMb: 300, exact });
  expect(seen.length).toBeGreaterThan(0);
  expect(seen.every((m) => m === 300)).toBe(true);
  seen.length = 0;
  improveCommand(fixture([level('k')], { k: LONG }), ['k'], { ...opts, exact });
  expect(seen.every((m) => m !== undefined && m >= 256)).toBe(true);
});

test('parallel improve: solve memory plan (solver cap per process)', async () => {
  const dir = fixture([level('k'), level('j')], { k: LONG, j: LONG });
  const r = await improveParallel(dir, 'all', { ...opts, maxMemoryMb: 300, jobs: 2 });
  expect(r.lines[0]).toBe('2 level(s), 2 process(es), solver ≤ 300 MB each');
  expect(r.lines.join('\n')).toMatch(/proven \(2\):\n {2}j: 4 moves[^\n]*\n {2}k: 4 moves/);
}, 60_000);

test('validate: warns about a goldMoves longer than the saved solution', () => {
  const dir = fixture([level('k', 6)], { k: '# optimal (proven)\nRRRR\n' });
  const r = validateCommand(dir);
  expect(r.ok).toBe(true);
  expect(r.lines).toContain(
    'k: warning — goldMoves (6) is longer than the saved solution (4 moves)',
  );
});
