import { readdirSync, statSync } from 'node:fs';
import { loadPack, type LevelPack } from '@puzzlecave/tiled';

/**
 * The level pack for the dev server's /__pc/* routes, parsed again only when a file of it
 * changed. Parsing and validating every level is synchronous and takes 50–100 ms: once per
 * request it blocked the server's event loop, and the level select asks for the saved solution
 * of each level it shows, so a few browsers browsing it queued every other request (pages, modules,
 * textures) for seconds.
 */
export function createPackCache(dir: string, load: (dir: string) => LevelPack = loadPack) {
  let pack: LevelPack | null = null;
  let stamp = '';
  // the folder's listing (a level added or removed) and the size and date of each file read
  const stampOf = (files: readonly string[]): string => {
    try {
      const parts = [readdirSync(dir).sort().join('/')];
      for (const f of files) {
        const s = statSync(f);
        parts.push(`${s.mtimeMs}:${s.size}`);
      }
      return parts.join('|');
    } catch {
      return ''; // a file gone: parse again
    }
  };
  return {
    get(): LevelPack {
      if (pack && stamp !== '' && stampOf(pack.files) === stamp) return pack;
      pack = load(dir);
      stamp = stampOf(pack.files);
      return pack;
    },
  };
}
