import type { Page } from '@playwright/test';
import { encodeSave, importSave, SAVE_KEY, type SaveData } from '../src/save';

/**
 * The save in the page's storage, decoded (the storage holds it in the export format, not as
 * readable JSON); null: no save yet.
 */
export async function storedSave(page: Page): Promise<SaveData | null> {
  const raw = await page.evaluate((k) => localStorage.getItem(k), SAVE_KEY);
  return raw === null ? null : importSave(raw);
}

/** A save (maybe of an older version, or partial) as the storage holds it, to write before a test. */
export const encodedSave = (save: unknown): string => encodeSave(JSON.stringify(save));
