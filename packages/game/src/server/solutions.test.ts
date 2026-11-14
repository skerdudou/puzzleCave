import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, expect, test } from 'vitest';
import { provenOptima, readSolutions } from './solutions';

const dirs: string[] = [];
afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});
const levelsDir = () => {
  const d = mkdtempSync(join(tmpdir(), 'pc-solutions-'));
  dirs.push(d);
  return d;
};

test('no solutions folder: none', () => {
  expect(readSolutions(levelsDir())).toEqual({});
});

test('the saved solutions by id; not the .prev.txt, the sub-folders or other files', () => {
  const d = levelsDir();
  const s = join(d, 'solutions');
  mkdirSync(join(s, 'gold'), { recursive: true });
  writeFileSync(join(s, 'pc-01.txt'), '# optimal (proven)\nRRDD');
  writeFileSync(join(s, 'pc-02.txt'), '# best known\nLLUU');
  writeFileSync(join(s, 'pc-02.prev.txt'), '# optimal (proven)\nLU');
  writeFileSync(join(s, 'gold', 'pc-01.txt'), 'RRDDLL');
  writeFileSync(join(s, 'notes.md'), 'x');
  expect(readSolutions(d)).toEqual({
    'pc-01': '# optimal (proven)\nRRDD',
    'pc-02': '# best known\nLLUU',
  });
});

test('proven optima: the moves of the solutions marked "# optimal (proven)" only', () => {
  const d = levelsDir();
  const s = join(d, 'solutions');
  mkdirSync(s, { recursive: true });
  writeFileSync(join(s, 'pc-01.txt'), '# optimal (proven)\r\nRRDD\r\nLU\r\n');
  writeFileSync(join(s, 'pc-02.txt'), '# best known — not proven optimal\nLLUU');
  writeFileSync(join(s, 'pc-03.prev.txt'), '# optimal (proven)\nLU');
  expect(provenOptima(d)).toEqual({ 'pc-01': 6 });
});

test('the repository: every level with a saved solution is there', () => {
  const real = readSolutions(join(__dirname, '../../../../levels'));
  expect(Object.keys(real).length).toBeGreaterThan(20);
  expect(real['pc-01']).toMatch(/^# /);
});
