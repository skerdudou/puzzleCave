import { chapters, levels } from 'virtual:levels';
import { hasMasterMode, resolveThresholds, type LevelData } from '@puzzlecave/core';
import type { SaveContext } from './save';

export { chapters, levels };
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
};
