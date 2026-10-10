// Measurements of the GPU engine in this thread (no synchronous bridge or safety replay), or of the
// compact engine for comparison:
//   npx tsx packages/gpu/src/bench.ts <id…> [--vram MB] [--timeout s] [--delta n] [--ub n] [--full]
//   npx tsx packages/gpu/src/bench.ts <id…> --cpu [--ram MB] [--timeout s]   (compact engine)
//   npx tsx packages/gpu/src/bench.ts --tiny        (fixed cost per level)
import { fromAscii, replay, solve, type LevelData, type SolveResult } from '@puzzlecave/core';
import { loadPack } from '@puzzlecave/tiled';
import { fileURLToPath } from 'node:url';
import { closeGpu, openGpu, type GpuHandle } from './device';
import { gpuSolveOn } from './gpuSolve';

const args = process.argv.slice(2);
const num = (name: string) => {
  const i = args.indexOf(name);
  return i >= 0 ? Number(args[i + 1]) : undefined;
};
const cpu = args.includes('--cpu');
let gpu: GpuHandle | undefined;
if (!cpu) {
  const opened = await openGpu();
  if (!opened.ok) throw new Error(opened.reason);
  gpu = opened.gpu;
  console.log(`adapter: ${gpu.name}`);
}
const levels: LevelData[] = [];
if (args.includes('--tiny'))
  for (let i = 0; i < 6; i++)
    levels.push(fromAscii(['@k.B..', '..~..E', i % 2 ? '.D....' : ',D....']));
else {
  const pack = loadPack(fileURLToPath(new URL('../../../levels', import.meta.url)));
  const ids = args.filter((a, i) => !a.startsWith('--') && !(args[i - 1] ?? '').startsWith('--'));
  for (const id of ids) {
    const l = pack.levels.find((x) => x.id === id);
    if (!l) throw new Error(`niveau inconnu ${id}`);
    levels.push(l);
  }
}
const timeoutMs = (num('--timeout') ?? 600) * 1000;
const ub = num('--ub');
const common = (level: LevelData, r: SolveResult, ms: number) => ({
  id: level.id,
  status: r.status,
  moves: r.status === 'solved' ? r.moves.length : undefined,
  replay: r.status === 'solved' ? replay(level, r.moves).status : undefined,
  lowerBound: r.status === 'timeout' ? r.lowerBound : undefined,
  explored: r.explored,
  ms: Math.round(ms),
});
for (const level of levels) {
  const t = performance.now();
  if (!gpu) {
    const r = solve(level, {
      maxMemoryMb: num('--ram') ?? 2048,
      timeoutMs,
      partialExpansion: 'auto',
      ...(ub !== undefined ? { upperBound: ub } : {}),
    });
    const ms = performance.now() - t;
    console.log(
      JSON.stringify({
        engine: 'cpu',
        ...common(level, r, ms),
        ramMb: Math.round((r.memoryBytes ?? 0) / 1024 ** 2),
        statesPerSec: Math.round(r.explored / (ms / 1000)),
      }),
    );
    continue;
  }
  const delta = num('--delta');
  const r = await gpuSolveOn(gpu, level, {
    maxMemoryMb: num('--vram') ?? 4096,
    timeoutMs,
    ...(ub !== undefined ? { upperBound: ub } : {}),
    ...(delta !== undefined ? { delta } : {}),
    partial: !args.includes('--full'),
  });
  const ms = performance.now() - t;
  console.log(
    JSON.stringify({
      engine: 'gpu',
      ...common(level, r, ms),
      expanded: r.gpu.expanded,
      candidates: r.gpu.candidates,
      attempts: r.gpu.attempts,
      submits: r.gpu.submits,
      encodeMs: Math.round(r.gpu.encodeMs),
      waitMs: Math.round(r.gpu.waitMs),
      vramMb: Math.round(r.gpu.vramBytes / 1024 ** 2),
      bytesPerState: Math.round(r.gpu.vramBytes / Math.max(1, r.gpu.stored)),
      compileMs: Math.round(r.gpu.compileMs),
      statesPerSec: Math.round(r.gpu.stored / (ms / 1000)),
      maxRssMb: Math.round(process.resourceUsage().maxRSS / 1024),
    }),
  );
}
if (gpu) closeGpu(gpu);
process.exit(0);
