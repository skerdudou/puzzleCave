import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, expect, test } from 'vitest';
import { parseMoves } from '@puzzlecave/core';
import { LEVELS_DIR } from './paths';
import { parseSubgoalArgs, subgoalCommand } from './subgoal';

const tmp = mkdtempSync(join(tmpdir(), 'subgoal-'));
afterAll(() => rmSync(tmp, { recursive: true, force: true }));

test('subgoal arguments', () => {
  expect(parseSubgoalArgs(['pc-11', 'st.txt'])).toEqual({
    id: 'pc-11',
    file: 'st.txt',
    opts: {
      timeoutMs: 60_000,
      maxStates: 200_000,
      maxMemoryMb: undefined,
      fromSolution: false,
      improveMs: 0,
      apply: false,
    },
  });
  expect(
    parseSubgoalArgs([
      'pc-11',
      '--timeout',
      '5',
      'st.txt',
      '--from-solution',
      '--max-states',
      '1000',
      '--max-memory',
      '300',
      '--improve',
      '30',
      '--apply',
    ]),
  ).toEqual({
    id: 'pc-11',
    file: 'st.txt',
    opts: {
      timeoutMs: 5_000,
      maxStates: 1000,
      maxMemoryMb: 300,
      fromSolution: true,
      improveMs: 30_000,
      apply: true,
    },
  });
  expect(parseSubgoalArgs(['pc-11'])).toHaveProperty('error');
  expect(parseSubgoalArgs(['pc-11', 'a', 'b'])).toHaveProperty('error');
  expect(parseSubgoalArgs(['pc-11', 'a', '--timeout', '0'])).toHaveProperty('error');
  expect(parseSubgoalArgs(['pc-11', 'a', '--bogus'])).toHaveProperty('error');
});

const opts = {
  timeoutMs: 20_000,
  maxStates: 50_000,
  maxMemoryMb: 64,
  fromSolution: false,
  improveMs: 0,
  apply: false,
};

test('pc-12: stages derived from the saved solution rebuild a winning solution as short', () => {
  const file = join(tmp, 'pc-12.txt');
  const r = subgoalCommand(LEVELS_DIR, 'pc-12', file, { ...opts, fromSolution: true });
  const saved = parseMoves(readFileSync(join(LEVELS_DIR, 'solutions', 'pc-12.txt'), 'utf8'));
  expect(r.ok).toBe(true);
  const m = /^pc-12: (\d+) moves from \d+ stages, wins/.exec(r.lines.at(-1)!);
  expect(Number(m?.[1])).toBeLessThanOrEqual(saved.length);
  expect(readFileSync(file, 'utf8')).toMatch(/^exit {2}# \d+ moves$/m);
  // never overwritten
  expect(subgoalCommand(LEVELS_DIR, 'pc-12', file, { ...opts, fromSolution: true }).ok).toBe(false);
});

test('errors: syntax with its line, failing stage with its reason', () => {
  const bad = join(tmp, 'bad.txt');
  writeFileSync(bad, '# x\nkey 1,1 exit\n');
  expect(subgoalCommand(LEVELS_DIR, 'pc-12', bad, opts)).toEqual({
    ok: false,
    lines: [`${bad}: line 2: "exit" cannot be combined with other goals`],
  });
  const lost = join(tmp, 'lost.txt');
  writeFileSync(lost, 'water 14,8\nexit\n');
  const r = subgoalCommand(LEVELS_DIR, 'pc-12', lost, opts);
  expect(r.ok).toBe(false);
  expect(r.lines.at(-1)).toMatch(/^pc-12: stage 1 \(line 1\) failed: unreachable .*could push: /);
  expect(subgoalCommand(LEVELS_DIR, 'nope', lost, opts).lines).toEqual(['nope: unknown level']);
});
