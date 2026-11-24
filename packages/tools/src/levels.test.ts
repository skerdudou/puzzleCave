import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { expect, test } from 'vitest';
import { loadPack } from '@puzzlecave/tiled';
import { validateCommand } from './commands';
import { LEVELS_DIR } from './paths';

test('all repository levels load and belong to a chapter', () => {
  const pack = loadPack(LEVELS_DIR);
  expect(pack.errors).toEqual([]);
  expect(pack.levels.length).toBe(45);
  expect(pack.chapters.map((c) => c.id)).toEqual(['easy', 'medium', 'hard', 'expert']);
});

test('all reference solutions win', () => {
  expect(validateCommand(LEVELS_DIR).lines.at(-1)).toMatch(/OK$/);
});

test('the repository solutions are .sol files, their moves encoded (not pasteable as a replay)', () => {
  const bad: string[] = [];
  const walk = (dir: string) => {
    for (const f of readdirSync(dir)) {
      const p = join(dir, f);
      if (statSync(p).isDirectory()) walk(p);
      else if (!f.endsWith('.sol')) bad.push(`${p}: not a .sol file`);
      else
        for (const line of readFileSync(p, 'utf8').split(/\r?\n/))
          if (line.trim() && !line.startsWith('#') && !line.startsWith('v1:'))
            bad.push(
              `${p}: a line that is neither a comment nor encoded moves (npm run solution -- set)`,
            );
    }
  };
  walk(join(LEVELS_DIR, 'solutions'));
  expect(bad).toEqual([]);
});

test('pc-01 has a solution (used by the e2e test)', () => {
  expect(existsSync(join(LEVELS_DIR, 'solutions', 'pc-01.sol'))).toBe(true);
});
