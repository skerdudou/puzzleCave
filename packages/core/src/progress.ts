import {
  bestMasterMedal,
  bestMedal,
  type Award,
  type MasterMedal,
  type Medal,
  type RunResult,
} from './medals';

export interface Chapter {
  id: string;
  /** en and fr required; other UI languages optional (English is used when missing) */
  name: { en: string; fr: string } & Partial<Record<string, string>>;
  unlockAfter: number;
  levels: string[];
  /** false: no master mode (nor its medals) on this chapter's levels; true when absent */
  masterMode?: boolean;
}

export function hasMasterMode(chapter: Chapter | undefined): boolean {
  return chapter?.masterMode !== false;
}

/**
 * Master mode opens on a level once gold (moves) is earned there. A master medal already earned
 * without gold (a platinum of an older save) also keeps it open.
 */
export function isMasterUnlocked(record: LevelRecord | undefined): boolean {
  return record?.medals.moves === 'gold' || record?.medals.master !== undefined;
}

export interface LevelRecord {
  completed: boolean;
  bestMoves?: number;
  bestTimeMs?: number;
  /** best moves and best time of the runs finished in master mode (none yet: absent) */
  masterBestMoves?: number;
  masterBestTimeMs?: number;
  /** `master`: the best master mode medal (saves of version 1 had `platinum: true` instead) */
  medals: { moves?: Medal; time?: Medal; master?: MasterMedal };
}

export type Records = Readonly<Record<string, LevelRecord>>;

export function completedCount(chapter: Chapter, records: Records): number {
  return chapter.levels.filter((id) => records[id]?.completed).length;
}

export function isChapterUnlocked(
  chapters: readonly Chapter[],
  ci: number,
  records: Records,
): boolean {
  if (ci === 0) return true;
  const prev = chapters[ci - 1];
  const cur = chapters[ci];
  if (!prev || !cur) return false;
  return (
    isChapterUnlocked(chapters, ci - 1, records) && completedCount(prev, records) >= cur.unlockAfter
  );
}

export function isLevelUnlocked(
  chapters: readonly Chapter[],
  ci: number,
  li: number,
  records: Records,
): boolean {
  const ch = chapters[ci];
  if (!ch || li < 0 || li >= ch.levels.length) return false;
  if (!isChapterUnlocked(chapters, ci, records)) return false;
  if (li === 0) return true;
  // a level already completed stays open (a level inserted before it, e.g. a replaced one,
  // does not lock it again)
  return Boolean(records[ch.levels[li - 1]!]?.completed || records[ch.levels[li]!]?.completed);
}

export function recordRun(prev: LevelRecord | undefined, r: RunResult, a: Award): LevelRecord {
  const medals: LevelRecord['medals'] = {};
  const moves = bestMedal(prev?.medals.moves, a.moves);
  if (moves) medals.moves = moves;
  const time = bestMedal(prev?.medals.time, a.time);
  if (time) medals.time = time;
  const master = bestMasterMedal(prev?.medals.master, a.master);
  if (master) medals.master = master;
  const rec: LevelRecord = {
    completed: true,
    bestMoves: Math.min(prev?.bestMoves ?? Infinity, r.moves),
    bestTimeMs: Math.min(prev?.bestTimeMs ?? Infinity, r.timeMs),
    medals,
  };
  if (r.mode === 'master') {
    rec.masterBestMoves = Math.min(prev?.masterBestMoves ?? Infinity, r.moves);
    rec.masterBestTimeMs = Math.min(prev?.masterBestTimeMs ?? Infinity, r.timeMs);
  } else {
    if (prev?.masterBestMoves !== undefined) rec.masterBestMoves = prev.masterBestMoves;
    if (prev?.masterBestTimeMs !== undefined) rec.masterBestTimeMs = prev.masterBestTimeMs;
  }
  return rec;
}

export function validateChapters(value: unknown, levelIds: ReadonlySet<string>): string[] {
  if (!Array.isArray(value)) return ['chapters.json must contain an array of chapters'];
  const e: string[] = [];
  const used = new Set<string>();
  value.forEach((raw: unknown, ci) => {
    const c = (raw ?? {}) as Partial<Chapter>;
    const label = `chapter ${ci + 1}${typeof c.id === 'string' ? ` (${c.id})` : ''}`;
    if (typeof c.id !== 'string' || !c.id) e.push(`${label}: missing id`);
    if (typeof c.name?.fr !== 'string' || typeof c.name?.en !== 'string')
      e.push(`${label}: missing fr/en name`);
    if (!Array.isArray(c.levels) || c.levels.length === 0) {
      e.push(`${label}: empty level list`);
      return;
    }
    for (const id of c.levels) {
      if (used.has(id)) e.push(`${label}: level "${id}" used twice`);
      used.add(id);
      if (!levelIds.has(id)) e.push(`${label}: unknown level "${id}"`);
    }
    const prevLen =
      ci === 0 ? 0 : (((value[ci - 1] ?? {}) as Partial<Chapter>).levels?.length ?? 0);
    const ua = c.unlockAfter;
    if (typeof ua !== 'number' || !Number.isInteger(ua) || ua < 0 || ua > prevLen) {
      e.push(`${label}: unlockAfter must be an integer between 0 and ${prevLen}`);
    }
    if (c.masterMode !== undefined && typeof c.masterMode !== 'boolean')
      e.push(`${label}: masterMode must be true or false`);
  });
  for (const id of levelIds) if (!used.has(id)) e.push(`level "${id}" missing from the chapters`);
  return e;
}
