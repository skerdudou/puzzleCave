import { parseArgs } from './args';
import { solveCommand, validateCommand, type CommandResult } from './commands';
import { exactBackend } from './gpu';
import { improveCommand, improveParallel } from './improve';
import { solveParallel } from './parallel';
import { LEVELS_DIR } from './paths';

const parsed = parseArgs(process.argv.slice(2));
if (parsed.kind === 'error') {
  console.error(parsed.message);
  process.exit(2);
}
let result: CommandResult;
try {
  if (parsed.kind === 'validate') {
    result = validateCommand(LEVELS_DIR);
    for (const line of result.lines) console.log(line);
  } else {
    const o = {
      timeoutMs: parsed.timeoutMs,
      maxStates: parsed.maxStates,
      maxMemoryMb: parsed.maxMemoryMb,
      apply: parsed.apply,
      force: parsed.force,
    };
    const single = parsed.ids !== 'all' && parsed.ids.length === 1;
    const improve = parsed.kind === 'improve';
    if (single) {
      // single level: in the current process; global searches on the GPU with --gpu
      const backend = await exactBackend(parsed.gpu, {
        maxVramMb: parsed.maxVramMb,
        log: (line) => console.log(line),
      });
      if (backend.engine) console.log(`exact search: ${backend.label}`);
      try {
        result = improve
          ? improveCommand(LEVELS_DIR, parsed.ids, { ...o, global: backend.engine })
          : solveCommand(LEVELS_DIR, parsed.ids, { ...o, exact: backend.engine });
      } finally {
        backend.close();
      }
      for (const line of result.lines) console.log(line);
    } else {
      result = await (improve ? improveParallel : solveParallel)(LEVELS_DIR, parsed.ids, {
        ...o,
        jobs: parsed.jobs,
        gpu: parsed.gpu,
        maxVramMb: parsed.maxVramMb,
        onLine: (line) => console.log(line),
      });
    }
  }
} catch (err) {
  // e.g. --gpu on without a usable GPU
  console.error((err as Error).message);
  process.exit(2);
}
process.exit(result.ok ? 0 : 1);
