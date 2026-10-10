import { spawn, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { improveArgs, type Launch, type LaunchedProcess } from './authorApi';

const ROOT = fileURLToPath(new URL('../../../../', import.meta.url));
const CLI = 'packages/tools/src/cli.ts';

/**
 * Launches the `improve` CLI (equivalent of `npm run improve -- …`) in a child process, without
 * going through npm/cmd so that it can be stopped cleanly. Arguments: see IMPROVE_ARGS.
 */
export const launchImprove: Launch = (id, timeoutS): LaunchedProcess => {
  const child = spawn(process.execPath, ['--import', 'tsx', CLI, ...improveArgs(id, timeoutS)], {
    cwd: ROOT,
    stdio: ['ignore', 'pipe', 'pipe'],
    windowsHide: true,
    detached: process.platform !== 'win32',
  });
  const lineCbs: ((l: string) => void)[] = [];
  const exitCbs: ((c: number | null) => void)[] = [];
  for (const stream of [child.stdout, child.stderr]) {
    let buf = '';
    stream.setEncoding('utf8');
    stream.on('data', (chunk: string) => {
      buf += chunk;
      const parts = buf.split(/\r?\n/);
      buf = parts.pop() ?? '';
      for (const l of parts) for (const cb of lineCbs) cb(l);
    });
    stream.on('end', () => {
      if (buf) for (const cb of lineCbs) cb(buf);
      buf = '';
    });
  }
  // 'close': the output is fully read before concluding
  child.on('close', (code) => {
    for (const cb of exitCbs) cb(code);
  });
  child.on('error', (err) => {
    for (const cb of lineCbs) cb(`launch error: ${err.message}`);
    for (const cb of exitCbs) cb(null);
  });
  return {
    onLine: (cb) => void lineCbs.push(cb),
    onExit: (cb) => void exitCbs.push(cb),
    kill() {
      if (child.pid === undefined || child.exitCode !== null) return;
      try {
        if (process.platform === 'win32') {
          spawnSync('taskkill', ['/pid', String(child.pid), '/T', '/F'], { windowsHide: true });
        } else {
          process.kill(-child.pid, 'SIGKILL');
        }
      } catch {
        child.kill('SIGKILL');
      }
    },
  };
};
