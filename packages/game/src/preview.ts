import { PREVIEW_KEYS, RELEASE_KEYS, type SaveKeys } from './save';

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
