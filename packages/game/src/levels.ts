import { chapters, levels } from 'virtual:levels';
import type { LevelData } from '@puzzlecave/core';

export { chapters, levels };
const byId = new Map(levels.map((l) => [l.id, l]));

export function levelById(id: string): LevelData {
  const l = byId.get(id);
  if (!l) throw new Error(`niveau inconnu : ${id}`);
  return l;
}

export function locate(id: string): { chapterIndex: number; levelIndex: number } | null {
  for (let ci = 0; ci < chapters.length; ci++) {
    const li = chapters[ci]!.levels.indexOf(id);
    if (li >= 0) return { chapterIndex: ci, levelIndex: li };
  }
  return null;
}
