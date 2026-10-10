import type { IncomingMessage } from 'node:http';
import type { Plugin } from 'vite';
import { loadPack } from '@puzzlecave/tiled';
import { createAuthorApi, DEFAULT_TIMEOUT_S, MAX_BODY_BYTES } from './src/server/authorApi';
import { launchImprove } from './src/server/launcher';

export interface AuthorPluginState {
  /** true while an optimization is running (the levels plugin does not reload the page) */
  busy: () => boolean;
}

/** /__pc/* design-aid routes: `vite dev` only (apply: 'serve'), never in the build. */
export function authorPlugin(levelsDir: string, state?: { api?: AuthorPluginState }): Plugin {
  const timeoutS = Number(process.env.PC_IMPROVE_TIMEOUT) || DEFAULT_TIMEOUT_S;
  return {
    name: 'puzzlecave-author',
    apply: 'serve',
    configureServer(server) {
      const api = createAuthorApi({
        levelsDir,
        getLevel: (id) => loadPack(levelsDir).levels.find((l) => l.id === id),
        launch: launchImprove,
        timeoutS,
        onJobEnd: () => {
          const mod = server.moduleGraph.getModuleById('\0virtual:levels');
          if (mod) server.moduleGraph.invalidateModule(mod);
        },
      });
      if (state) state.api = { busy: api.busy };
      server.httpServer?.on('close', () => api.dispose());
      const onExit = () => api.dispose();
      process.once('exit', onExit);
      // no listener accumulation when Vite restarts its server
      server.httpServer?.on('close', () => process.off('exit', onExit));

      server.middlewares.use(async (req, res, next) => {
        const url = new URL(req.url ?? '/', 'http://localhost');
        if (!url.pathname.startsWith('/__pc/')) return next();
        const send = (status: number, body: unknown) => {
          res.statusCode = status;
          res.setHeader('Content-Type', 'application/json; charset=utf-8');
          res.setHeader('Cache-Control', 'no-store');
          res.end(JSON.stringify(body));
        };
        try {
          let body: unknown;
          if (req.method === 'POST') {
            // anti-CSRF: a third-party site cannot send this Content-Type without a CORS preflight
            const origin = req.headers.origin;
            if (
              !String(req.headers['content-type'] ?? '').startsWith('application/json') ||
              (origin !== undefined && new URL(origin).host !== req.headers.host)
            ) {
              return send(403, { error: 'forbidden' });
            }
            const raw = await readBody(req, MAX_BODY_BYTES + 1024);
            if (raw === null) {
              res.setHeader('Connection', 'close');
              res.once('finish', () => req.destroy());
              return send(413, { error: 'too-large' });
            }
            try {
              body = JSON.parse(raw);
            } catch {
              return send(400, { error: 'bad-json' });
            }
          }
          const r = await api.handle(req.method ?? 'GET', url.pathname, body);
          send(r.status, r.body);
        } catch (err) {
          send(500, { error: 'internal', message: (err as Error).message });
        }
      });
    },
  };
}

function readBody(req: IncomingMessage, max: number): Promise<string | null> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let size = 0;
    req.on('data', (c: Buffer) => {
      size += c.length;
      if (size > max) {
        resolve(null);
        return;
      }
      chunks.push(c);
    });
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
  });
}
