import { resolve } from 'node:path';
import { parseArgs } from './args';
import { solveCommand, validateCommand, type CommandResult } from './commands';
import { exploreCommand, parseExploreArgs } from './explore';
import { exactBackend } from './gpu';
import { improveCommand, improveParallel } from './improve';
import { solveParallel } from './parallel';
import { LEVELS_DIR } from './paths';
import { parsePlanArgs, planCommand } from './plan';
import { parseSubgoalArgs, subgoalCommand } from './subgoal';
import { longRunCommand, parseLongRunArgs } from './longrun/command';
import { certifyCommand, parseCertifyArgs } from './longrun/certify';
import { parseTimesArgs, timesCommand } from './times';

if (process.argv[2] === 'plan') {
  const p = parsePlanArgs(process.argv.slice(3));
  if ('error' in p) {
    console.error(p.error);
    process.exit(2);
  }
  const r = planCommand(LEVELS_DIR, p.ids, p.opts);
  for (const line of r.lines) console.log(line);
  process.exit(r.ok ? 0 : 1);
}
if (process.argv[2] === 'times') {
  const p = parseTimesArgs(process.argv.slice(3));
  if ('error' in p) {
    console.error(p.error);
    process.exit(2);
  }
  const r = timesCommand(LEVELS_DIR, p);
  for (const line of r.lines) console.log(line);
  process.exit(r.ok ? 0 : 1);
}
if (process.argv[2] === 'explore') {
  const p = parseExploreArgs(process.argv.slice(3));
  if ('error' in p) {
    console.error(p.error);
    process.exit(2);
  }
  // relative to the directory npm was started from
  const cwd = process.env.INIT_CWD ?? '.';
  // the result lines are streamed through log as well
  const r = await exploreCommand(LEVELS_DIR, p.ids, {
    ...p.opts,
    save: p.opts.save && resolve(cwd, p.opts.save),
    from: p.opts.from && resolve(cwd, p.opts.from),
    log: (line) => console.log(line),
  });
  process.exit(r.ok ? 0 : 1);
}
if (process.argv[2] === 'subgoal') {
  const p = parseSubgoalArgs(process.argv.slice(3));
  if ('error' in p) {
    console.error(p.error);
    process.exit(2);
  }
  // relative to the directory npm was started from
  const file = resolve(process.env.INIT_CWD ?? '.', p.file);
  const r = subgoalCommand(LEVELS_DIR, p.id, file, p.opts);
  for (const line of r.lines) console.log(line);
  process.exit(r.ok ? 0 : 1);
}
if (process.argv[2] === 'certify') {
  const p = parseCertifyArgs(process.argv.slice(3));
  if ('error' in p) {
    console.error(p.error);
    process.exit(2);
  }
  // relative to the directory npm was started from
  const workDir = resolve(process.env.INIT_CWD ?? '.', p.workDir);
  const r = await certifyCommand(LEVELS_DIR, { ...p, workDir }, (line) => console.log(line));
  for (const line of r.lines) console.log(line);
  process.exit(r.ok ? 0 : 1);
}
if (process.argv[2] === 'longrun') {
  const p = parseLongRunArgs(process.argv.slice(3));
  if ('error' in p) {
    console.error(p.error);
    process.exit(2);
  }
  let interrupts = 0;
  const r = await longRunCommand(
    LEVELS_DIR,
    p,
    (line) => console.log(line),
    (run) => {
      // Ctrl+C: the current layer is dropped, the checkpoint stays (resume with --resume)
      process.on('SIGINT', () => {
        if (++interrupts > 1) process.exit(130);
        console.log('stopping (Ctrl+C again to quit at once)…');
        run.requestStop();
      });
    },
  );
  for (const line of r.lines) console.log(line);
  process.exit(r.ok ? 0 : 1);
}
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
      find: parsed.find,
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
