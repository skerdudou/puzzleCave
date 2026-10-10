import { fork, type ChildProcess } from 'node:child_process';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';
// circular import is safe: seconds is only called once both modules are loaded
import { seconds } from './parallel';

/** tsx loader as an absolute URL: `--import tsx` would depend on the current directory */
const TSX_LOADER = pathToFileURL(createRequire(import.meta.url).resolve('tsx')).href;

/** Live children, killed if the parent stops (normal exit, Ctrl+C, SIGTERM). */
const live = new Set<ChildProcess>();
const killAll = () => {
  for (const child of live) child.kill();
};
const onSignal = (signal: NodeJS.Signals) => {
  killAll();
  process.exit(signal === 'SIGINT' ? 130 : 143);
};
let users = 0;
function guardChildren(on: boolean): void {
  users += on ? 1 : -1;
  if (on && users === 1) {
    process.on('exit', killAll);
    process.on('SIGINT', onSignal);
    process.on('SIGTERM', onSignal);
  } else if (!on && users === 0) {
    process.off('exit', killAll);
    process.off('SIGINT', onSignal);
    process.off('SIGTERM', onSignal);
  }
}

export interface PoolOptions<T, R> {
  /** child .ts module: receives a task T over IPC, sends back a reply R, then exits */
  worker: string;
  /** gpuTask: task variant for the GPU lane (absent: level outside the GPU limits) */
  items: { id: string; task: T; gpuTask?: T }[];
  /**
   * the first lane is the GPU lane: it takes items from the end of the queue (the heaviest, see
   * gpuOrder), with their gpuTask; so only one child at a time touches the card
   */
  gpuLane?: boolean;
  jobs: number;
  /** --max-old-space-size of each child */
  heapMb: number;
  /** beyond this, the child is stopped */
  watchdogMs: number;
  onReply: (id: string, reply: R) => void;
  /** failure without a reply; stderr = tail of the child's error output */
  onFail: (id: string, text: string, stderr: string) => void;
}

/**
 * Runs each task in a separate Node process, at most `jobs` at a time. Each task is reported
 * exactly once (onReply or onFail), at the child's 'close' event, which follows the delivery of
 * all its IPC messages. Callbacks run in the parent, one at a time.
 */
export async function runPool<T, R>(o: PoolOptions<T, R>): Promise<void> {
  const queue = o.items.slice();
  const run = (id: string, task: T): Promise<void> =>
    new Promise((resolve) => {
      let reply: R | undefined;
      let spawnError: string | undefined;
      let watchdogFired = false;
      let stderr = '';
      const child = fork(o.worker, [], {
        execArgv: ['--import', TSX_LOADER, `--max-old-space-size=${o.heapMb}`],
        stdio: ['ignore', 'inherit', 'pipe', 'ipc'],
      });
      live.add(child);
      const watchdog = setTimeout(() => {
        watchdogFired = true;
        child.kill();
      }, o.watchdogMs);
      // keep the tail of the error output to explain a failure
      child.stderr?.on('data', (chunk: Buffer) => (stderr = (stderr + chunk).slice(-4000)));
      child.on('message', (m: R) => {
        reply ??= m;
      });
      let done = false;
      const finish = (code: number | null, signal: NodeJS.Signals | null) => {
        if (done) return;
        done = true;
        clearTimeout(watchdog);
        live.delete(child);
        if (reply !== undefined) o.onReply(id, reply);
        else if (watchdogFired)
          o.onFail(id, `process stopped — no result after ${seconds(o.watchdogMs)}`, stderr);
        else if (spawnError) o.onFail(id, `process failed (${spawnError})`, stderr);
        else
          o.onFail(
            id,
            `process failed (${code !== null ? `code ${code}` : `signal ${signal}`})`,
            stderr,
          );
        resolve();
      };
      child.on('close', finish);
      child.on('error', (err) => {
        spawnError ??= err.message;
        // a child that failed to start does not always emit 'close'; otherwise 'close' (or the
        // watchdog, if the child waits for a task never received) will do the reporting
        if (child.pid === undefined) finish(null, null);
      });
      child.send(task as object, (err) => {
        if (err) spawnError ??= err.message;
      });
    });

  /** GPU lane: the last item that has a GPU variant, otherwise the last one */
  const takeGpu = () => {
    for (let i = queue.length - 1; i >= 0; i--) {
      const item = queue[i]!;
      if (item.gpuTask === undefined) continue;
      queue.splice(i, 1);
      return { id: item.id, task: item.gpuTask };
    }
    return queue.pop();
  };
  const lane = async (index: number) => {
    const take = o.gpuLane && index === 0 ? takeGpu : () => queue.shift();
    for (let item = take(); item; item = take()) await run(item.id, item.task);
  };
  guardChildren(true);
  try {
    await Promise.all(Array.from({ length: o.jobs }, (_, i) => lane(i)));
  } finally {
    guardChildren(false);
  }
}

/** most telling line of an error output (e.g. "FATAL ERROR: … heap out of memory") */
export function stderrCause(stderr: string): string | undefined {
  const errLines = stderr
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean);
  return errLines.find((l) => /FATAL ERROR|Error/.test(l)) ?? errLines.at(-1);
}
