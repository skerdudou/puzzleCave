// Measurements of findSolution from scratch (saved solutions ignored), one level after another in
// this process:
//   npx tsx packages/tools/src/findBench.ts <id…> [--memory MB] [--timeout s] [--key-closure]
//     [--every s] [--save dir]
// Prints a progress line every --every seconds (10 by default), a line each time the memory
// peak crosses 1, 2, 4, 8, 16 GB, then the result. findSolution is deterministic: the run at a
// budget B is the run at a larger budget stopped when the peak would exceed B, so one run at
// the largest budget gives the result at every smaller budget (solved at B iff peak ≤ B).
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  CompactModel,
  findSolution,
  formatMoves,
  replay,
  type FindProgress,
} from '@puzzlecave/core';
import { loadPack } from '@puzzlecave/tiled';
import { LEVELS_DIR } from './paths';

const args = process.argv.slice(2);
const num = (name: string) => {
  const i = args.indexOf(name);
  return i >= 0 ? Number(args[i + 1]) : undefined;
};
const VALUED = new Set(['--memory', '--timeout', '--every', '--save']);
const ids = args.filter((a, i) => !a.startsWith('--') && !VALUED.has(args[i - 1] ?? ''));
const memoryMb = num('--memory') ?? 1024;
const timeoutMs = (num('--timeout') ?? 300) * 1000;
const everyMs = (num('--every') ?? 10) * 1000;
const keyClosure = args.includes('--key-closure');
// measurements: full closure on every successor (same search, slower)
const keyClosureFilter = !args.includes('--no-closure-filter');
const saveDir = args.includes('--save') ? args[args.indexOf('--save') + 1]! : undefined;
const MB = 1024 ** 2;
const pack = loadPack(LEVELS_DIR);

for (const id of ids) {
  const level = pack.levels.find((l) => l.id === id);
  if (!level) throw new Error(`unknown level ${id}`);
  const model = new CompactModel(level);
  const nodeBytes = model.words * 4 + 11;
  const marks = [1024, 2048, 4096, 8192, 16384];
  let mark = 0;
  let last = 0;
  let lastProgress: FindProgress | undefined;
  const line = (tag: string, p: FindProgress) => {
    const store = p.explored * nodeBytes;
    const table = 2 ** Math.ceil(Math.log2(Math.max(1024, p.explored / 0.75))) * 8;
    console.log(
      JSON.stringify({
        id,
        tag,
        s: Math.round(p.ms / 100) / 10,
        states: p.explored,
        expanded: p.expanded,
        open: p.open,
        usedMb: Math.round(p.usedBytes / MB),
        peakMb: Math.round(p.peakBytes / MB),
        bPerState: p.explored ? Math.round(p.usedBytes / p.explored) : 0,
        nodesMb: Math.round(store / MB),
        tableMb: Math.round(table / MB),
        noveltyMb: Math.round(p.noveltyBytes / MB),
        noveltyTables: p.noveltyTables,
        rssMb: Math.round(process.memoryUsage().rss / MB),
      }),
    );
  };
  console.log(
    JSON.stringify({
      id,
      tag: 'start',
      memoryMb,
      timeoutS: timeoutMs / 1000,
      keyClosure,
      cells: model.n,
      words: model.words,
      nodeBytes,
    }),
  );
  const r = findSolution(level, {
    maxStates: Infinity,
    maxMemoryMb: memoryMb,
    timeoutMs,
    keyClosure,
    keyClosureFilter,
    progressMs: 1000,
    onProgress: (p) => {
      while (mark < marks.length && p.peakBytes > marks[mark]! * MB) line(`>${marks[mark++]}MB`, p);
      if (p.ms - last >= everyMs) {
        last = p.ms;
        line('progress', p);
      }
      lastProgress = p;
    },
  });
  const result: Record<string, unknown> = { id, tag: 'result', status: r.status };
  if (r.status === 'failed') result.reason = r.reason;
  else {
    result.moves = r.moves.length;
    result.replay = replay(level, r.moves).status;
    if (saveDir) {
      mkdirSync(saveDir, { recursive: true });
      const file = join(saveDir, `${id}${keyClosure ? '.kc' : ''}.txt`);
      writeFileSync(file, `${formatMoves(r.moves)}\n`);
      result.saved = file;
    }
  }
  if (lastProgress) {
    result.s = Math.round(lastProgress.ms / 100) / 10;
    result.states = lastProgress.explored;
    result.expanded = lastProgress.expanded;
    result.peakMb = Math.round(lastProgress.peakBytes / MB);
    result.noveltyMb = Math.round(lastProgress.noveltyBytes / MB);
  }
  console.log(JSON.stringify(result));
}
