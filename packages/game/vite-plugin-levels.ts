import type { Plugin } from 'vite';
import { loadPack } from '@puzzlecave/tiled';
import { provenOptima, readSolutions } from './src/server/solutions';

const SOLUTIONS_ID = 'virtual:solutions';
const SOLUTIONS_RESOLVED = '\0virtual:solutions';

/**
 * `virtual:solutions`: the saved solutions (levels/solutions/<id>.txt), for the preview of main's
 * author mode, which replays them without the development server. `bundle` false (the release,
 * the dev server, which reads them from disk): an empty table, nothing of them in the build.
 */
export function solutionsPlugin(dir: string, bundle: boolean): Plugin {
  return {
    name: 'puzzlecave-solutions',
    resolveId(source) {
      return source === SOLUTIONS_ID ? SOLUTIONS_RESOLVED : null;
    },
    load(id) {
      if (id !== SOLUTIONS_RESOLVED) return null;
      return `export const solutions = ${JSON.stringify(bundle ? readSolutions(dir) : {})};\n`;
    },
  };
}

const ID = 'virtual:levels';
const RESOLVED = '\0virtual:levels';

/** suspendReload: no page reload during an optimization (the level .tmx may be rewritten). */
export function levelsPlugin(dir: string, suspendReload: () => boolean = () => false): Plugin {
  const norm = (p: string) => p.replace(/\\/g, '/').toLowerCase();
  return {
    name: 'puzzlecave-levels',
    resolveId(source) {
      return source === ID ? RESOLVED : null;
    },
    load(id) {
      if (id !== RESOLVED) return null;
      const pack = loadPack(dir);
      for (const f of pack.files) this.addWatchFile(f);
      if (pack.errors.length) this.error(`Invalid levels:\n${pack.errors.join('\n')}`);
      // the proven optima (levels/solutions/; on the dev server, read again when the levels are)
      const optima = provenOptima(dir);
      return `export const levels = ${JSON.stringify(pack.levels)};\nexport const chapters = ${JSON.stringify(pack.chapters)};\nexport const optima = ${JSON.stringify(optima)};\n`;
    },
    configureServer(server) {
      server.watcher.add(dir);
      const reload = (file: string) => {
        if (!norm(file).startsWith(norm(dir)) || norm(file).includes('/solutions/')) return;
        if (suspendReload()) {
          const stale = server.moduleGraph.getModuleById(RESOLVED);
          if (stale) server.moduleGraph.invalidateModule(stale);
          return;
        }
        const mod = server.moduleGraph.getModuleById(RESOLVED);
        if (mod) server.moduleGraph.invalidateModule(mod);
        server.ws.send({ type: 'full-reload' });
      };
      server.watcher.on('change', reload);
      server.watcher.on('add', reload);
      server.watcher.on('unlink', reload);
    },
  };
}
