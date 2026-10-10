import type { Plugin } from 'vite';
import { loadPack } from '@puzzlecave/tiled';

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
      return `export const levels = ${JSON.stringify(pack.levels)};\nexport const chapters = ${JSON.stringify(pack.chapters)};\n`;
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
