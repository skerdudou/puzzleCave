import { PREVIEW_KEYS, RELEASE_KEYS, type KV, type SaveKeys } from './save';

/**
 * The preview of `main` published beside the release (DEVELOPMENT.md › Preview of `main`): built
 * with VITE_PREVIEW=1 and VITE_PREVIEW_SHA=<short commit>. In the release build both are absent:
 * PREVIEW is the constant false, and what only the preview uses is left out of the bundle.
 */
export const PREVIEW = import.meta.env.VITE_PREVIEW === '1';
/** The commit the preview was built from (empty in the release). */
export const PREVIEW_SHA: string = PREVIEW ? (import.meta.env.VITE_PREVIEW_SHA ?? '') : '';
/** Where the game saves: the preview never touches the release's save (same origin). */
export const SAVE_KEYS: SaveKeys = PREVIEW ? PREVIEW_KEYS : RELEASE_KEYS;

/** Where the preview remembers its author mode (the installed app starts without the query). */
export const PREVIEW_DEV_KEY = 'puzzlecave.preview.dev';

/**
 * The preview's author mode: `?dev` (or `?dev=1`) turns it on, `?dev=0` off, and the choice is
 * remembered; without the parameter, the remembered choice (off at first). Only the preview calls
 * it (the release has no switch); the tools that need the development server stay hidden there.
 */
export function previewDevMode(search: string, storage: KV | null): boolean {
  const v = new URLSearchParams(search).get('dev');
  if (v !== null) {
    const on = v !== '0';
    try {
      storage?.setItem(PREVIEW_DEV_KEY, on ? '1' : '0');
    } catch {
      // not remembered: on for this visit only
    }
    return on;
  }
  try {
    return storage?.getItem(PREVIEW_DEV_KEY) === '1';
  } catch {
    return false;
  }
}
