import { chapters, levels } from 'virtual:levels';
import {
  hasMasterMode,
  isMasterUnlocked,
  resolveThresholds,
  type LevelData,
  type LevelRecord,
} from '@puzzlecave/core';
import { achievementList } from './achievements';
import { PREVIEW } from './preview';
import type { SaveContext } from './save';

export { chapters, levels };

/**
 * A level's name as shown; out of the release (the preview, the dev server — not for the e2e
 * tests, run as the release: VITE_E2E=1), its id after it
 * ("Pick a Door (pc-31)").
 */
export function levelTitle(
  level: Pick<LevelData, 'id' | 'name'>,
  showId = PREVIEW || (import.meta.env.DEV && import.meta.env.VITE_E2E !== '1'),
): string {
  return showId ? `${level.name} (${level.id})` : level.name;
}

const byId = new Map(levels.map((l) => [l.id, l]));

export function levelById(id: string): LevelData {
  const l = byId.get(id);
  if (!l) throw new Error(`unknown level: ${id}`);
  return l;
}

/** master mode (and its medals) exists on this level: its chapter does not disable it */
export function hasMaster(id: string): boolean {
  const pos = locate(id);
  return pos !== null && hasMasterMode(chapters[pos.chapterIndex]);
}

/** master mode of a level: absent from its chapter, locked (no gold yet) or open */
export function masterState(id: string, rec: LevelRecord | undefined): 'none' | 'locked' | 'open' {
  if (!hasMaster(id)) return 'none';
  return isMasterUnlocked(rec) ? 'open' : 'locked';
}

export function locate(id: string): { chapterIndex: number; levelIndex: number } | null {
  for (let ci = 0; ci < chapters.length; ci++) {
    const li = chapters[ci]!.levels.indexOf(id);
    if (li >= 0) return { chapterIndex: ci, levelIndex: li };
  }
  return null;
}

/** The levels as the save migrations see them: thresholds of the levels with master mode. */
export const saveContext: SaveContext = {
  masterThresholds: (id) =>
    byId.has(id) && hasMaster(id) ? resolveThresholds(levelById(id).thresholds) : undefined,
  timeTier: (id) => (byId.has(id) ? resolveThresholds(levelById(id).thresholds).time : undefined),
};

/** The game's achievements (achievements.ts), for its levels. */
export const achievements = achievementList({
  chapters,
  hasMaster,
  hasTime: (id) => resolveThresholds(levelById(id).thresholds).time !== undefined,
});
