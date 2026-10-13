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
import { afterAll, expect, test } from 'vitest';
import { parseMoves } from '@puzzlecave/core';
import { exploreCommand, parseExploreArgs, type ExploreCommandOptions } from './explore';
import { LEVELS_DIR } from './paths';

const tmp = mkdtempSync(join(tmpdir(), 'explore-'));
afterAll(() => rmSync(tmp, { recursive: true, force: true }));

test('explore arguments', () => {
  expect(parseExploreArgs(['pc-11'])).toEqual({
    ids: ['pc-11'],
    opts: {
      timeoutMs: 300_000,
      variants: 1_000_000,
      improveTop: 3,
      screen: 0.3,
      seed: 1,
      maxMemoryMb: undefined,
      save: undefined,
      from: undefined,
      apply: false,
    },
  });
  expect(
    parseExploreArgs([
      'pc-11',
      'pc-18',
      '--timeout',
      '900',
      '--variants',
      '5000',
      '--improve-top',
      '5',
      '--screen',
      '0.5',
      '--seed',
      '3',
      '--max-memory',
      '2048',
      '--save',
      'out',
      '--from',
      'best',
      '--apply',
    ]),
  ).toEqual({
    ids: ['pc-11', 'pc-18'],
    opts: {
      timeoutMs: 900_000,
      variants: 5000,
      improveTop: 5,
      screen: 0.5,
      seed: 3,
      maxMemoryMb: 2048,
      save: 'out',
      from: 'best',
      apply: true,
    },
  });
  expect(parseExploreArgs([])).toHaveProperty('error');
  expect(parseExploreArgs(['pc-11', '--timeout', '0'])).toHaveProperty('error');
  expect(parseExploreArgs(['pc-11', '--screen', '2'])).toHaveProperty('error');
  expect(parseExploreArgs(['pc-11', '--save'])).toHaveProperty('error');
  expect(parseExploreArgs(['pc-11', '--bogus'])).toHaveProperty('error');
});

const opts: ExploreCommandOptions = {
  timeoutMs: 3_000,
  variants: 2_000,
  improveTop: 1,
  screen: 0.3,
  seed: 1,
  maxMemoryMb: 256,
  apply: false,
};

test('pc-01: a longer saved solution is beaten, saved and applied with its lower bound', () => {
  const dir = join(tmp, 'levels');
  mkdirSync(join(dir, 'solutions'), { recursive: true });
  for (const f of ['pc-01.tmx', 'tileset.tsx']) copyFileSync(join(LEVELS_DIR, f), join(dir, f));
  const file = join(dir, 'solutions', 'pc-01.txt');
  // the 26-move optimum with a detour (right and back again)
  writeFileSync(
    file,
    '# best known — not proven optimal (proven lower bound ≥ 24)\nRLRRRRRRRRDDLLLLLLDRDLLDLUUL\n',
  );
  const out = join(tmp, 'out');
  const r = exploreCommand(dir, ['pc-01'], { ...opts, save: out, apply: true });
  expect(r.ok).toBe(true);
  expect(r.lines[0]).toMatch(/^pc-01: 28 → 26 moves — \d+ round\(s\), \d+ variants/);
  expect(r.lines).toContain(`pc-01: shorter solution saved to ${join(out, 'pc-01-26.txt')}`);
  expect(r.lines).toContain('pc-01: solution written (26 moves)');
  expect(parseMoves(readFileSync(join(out, 'pc-01-26.txt'), 'utf8'))).toHaveLength(26);
  const saved = readFileSync(file, 'utf8');
  expect(saved.split('\n')[0]).toBe('# best known — not proven optimal (proven lower bound ≥ 24)');
  expect(parseMoves(saved)).toHaveLength(26);
  // goldMoves (26) is not lowered by an equal length
  expect(readFileSync(join(dir, 'pc-01.tmx'), 'utf8')).toMatch(
    /name="goldMoves" type="int" value="26"/,
  );
});

test('real level: nothing shorter than the proven optimum, nothing written', () => {
  const out = join(tmp, 'none');
  const r = exploreCommand(LEVELS_DIR, ['pc-01', 'nope'], { ...opts, timeoutMs: 1_000, save: out });
  expect(r.ok).toBe(false);
  expect(r.lines[0]).toMatch(/^pc-01: 26 → 26 moves/);
  expect(r.lines[1]).toBe('nope: unknown level');
  expect(existsSync(out)).toBe(false);
});

test('--from: starts from the shortest winning <id>-<n>.txt that beats the saved solution', () => {
  const dir = join(tmp, 'levels-from');
  mkdirSync(join(dir, 'solutions'), { recursive: true });
  for (const f of ['pc-01.tmx', 'tileset.tsx']) copyFileSync(join(LEVELS_DIR, f), join(dir, f));
  writeFileSync(join(dir, 'solutions', 'pc-01.txt'), 'RLRRRRRRRRDDLLLLLLDRDLLDLUUL\n');
  const from = join(tmp, 'from');
  mkdirSync(from);
  writeFileSync(join(from, 'pc-01-26.txt'), 'RRRRRRRRDDLLLLLLDRDLLDLUUL\n');
  writeFileSync(join(from, 'pc-01-3.txt'), 'RRR\n'); // does not win: ignored
  const lines: string[] = [];
  const r = exploreCommand(dir, ['pc-01'], { ...opts, from, log: (l) => lines.push(l) });
  expect(r.lines[0]).toBe(`pc-01: starting from 26 moves (${from})`);
  expect(r.lines[1]).toMatch(/^pc-01: 26 → 26 moves/);
  // result lines are streamed with the progress lines
  expect(lines).toEqual(expect.arrayContaining(r.lines));
  expect(lines.some((l) => /^pc-01: round 1 from 26 moves/.test(l))).toBe(true);
});
