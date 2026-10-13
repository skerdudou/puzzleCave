// Author mode "Save solution" on a new level, end to end with the real `improve --apply` run
// in-process instead of the child process: goldMoves and goldTime are written into the .tmx, the
// job reports the reference time and the result text mentions it.
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, expect, test } from 'vitest';
import { fromAscii } from '@puzzlecave/core';
import { TILE_ORDER, writeTmx } from '@puzzlecave/tiled';
import { improveCommand } from '../../../tools/src/improve';
import { describeJob, type JobInfo } from '../author/jobText';
import { setLang } from '../i18n';
import { createAuthorApi, type Launch } from './authorApi';

const TSX = `<tileset name="pc" tilewidth="16" tileheight="16">${TILE_ORDER.map((k, i) => `<tile id="${i}"><properties><property name="kind" value="${k}"/></properties></tile>`).join('')}</tileset>`;
const LEVEL = fromAscii(['@.#', '..E'], { id: 'lvl' }); // RDR wins in 3 moves; RLRDR in 5

let dir: string;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'pc-author-time-'));
  writeFileSync(join(dir, 'tileset.tsx'), TSX);
  writeFileSync(join(dir, 'lvl.tmx'), writeTmx(LEVEL));
  writeFileSync(
    join(dir, 'chapters.json'),
    JSON.stringify([{ id: 'c', name: { fr: 'C', en: 'C' }, unlockAfter: 0, levels: ['lvl'] }]),
  );
  setLang('en');
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

/** runs `improve <id> --apply` in-process and replays its output like the real launcher */
const inProcess: Launch = (id) => {
  let line: (l: string) => void = () => {};
  let exit: (c: number | null) => void = () => {};
  queueMicrotask(() => {
    const r = improveCommand(dir, [id], {
      timeoutMs: 20_000,
      maxStates: 100_000,
      apply: true,
      force: false,
    });
    for (const l of r.lines) line(l);
    exit(r.ok ? 0 : 1);
  });
  return {
    onLine: (cb) => (line = cb),
    onExit: (cb) => (exit = cb),
    kill: () => {},
  };
};

test('save on a new level: goldMoves and goldTime written, the result text mentions the time', async () => {
  const api = createAuthorApi({ levelsDir: dir, getLevel: () => LEVEL, launch: inProcess });
  const r = await api.handle('POST', '/__pc/solution/lvl', { moves: 'RLRDR' });
  expect(r.status).toBe(200);
  await new Promise((resolve) => setTimeout(resolve, 0));
  const job = (await api.handle('GET', `/__pc/job/${(r.body as { jobId: string }).jobId}`))
    .body as JobInfo;
  expect(job).toMatchObject({ state: 'done', after: 3, goldTime: 1 });
  const tmx = readFileSync(join(dir, 'lvl.tmx'), 'utf8');
  expect(tmx).toMatch(/name="goldMoves" type="int" value="3"/);
  expect(tmx).toMatch(/name="goldTime" type="\w+" value="1"/);
  expect(describeJob(job, 0).detail).toBe('Reference time (gold): 1 s');
  api.dispose();
});
