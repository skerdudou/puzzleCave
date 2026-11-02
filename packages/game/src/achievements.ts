// Achievements (pure, no Phaser): what they are, how far the player is, when they are earned.
import type { Chapter, Records } from '@puzzlecave/core';
import type { MessageKey } from './i18n';

/** What the achievements need to know about the game's levels. */
export interface AchievementLevels {
  chapters: readonly Chapter[];
  /** master mode (and its medals) exists on this level */
  hasMaster(levelId: string): boolean;
}

export interface Progress {
  got: number;
  goal: number;
}

export interface Achievement {
  id: string;
  name: MessageKey;
  desc: MessageKey;
  /** the description's {chapter}: this chapter's name */
  chapter?: Chapter;
  /** the description's {n} */
  n?: number;
  /** a secret: name and description shown as "???" until earned */
  hidden?: boolean;
  /**
   * How far the level records go toward it; it is earned once `got` reaches `goal`. Absent: it
   * is earned by something the player does (Deep Thought, the Konami code).
   */
  progress?: (records: Records) => Progress;
}

/** The ids of the achievements earned by an action, not by the level records. */
export const DEEP_THOUGHT = 'deepThought';
export const KONAMI = 'konami';

/** The chapters that have achievements, by their id, and the names of these. */
const CHAPTER_NAMES: Readonly<
  Record<string, { done: MessageKey; gold: MessageKey; grandMaster?: MessageKey }>
> = {
  easy: { done: 'achDoneEasy', gold: 'achGoldEasy' },
  medium: { done: 'achDoneMedium', gold: 'achGoldMedium', grandMaster: 'achGmMedium' },
  hard: { done: 'achDoneHard', gold: 'achGoldHard', grandMaster: 'achGmHard' },
  expert: { done: 'achDoneExpert', gold: 'achGoldExpert', grandMaster: 'achGmExpert' },
};

const count = (
  ids: readonly string[],
  records: Records,
  ok: (id: string) => boolean,
): Progress => ({
  got: ids.filter(ok).length,
  goal: ids.length,
});
const isGold = (records: Records) => (id: string) => records[id]?.medals.moves === 'gold';
const isGrandMaster = (records: Records) => (id: string) =>
  records[id]?.medals.master === 'grandMaster';

/**
 * Every achievement, in the order of the achievements screen: for each chapter, finish it, gold
 * on all its levels, grand master on all of them (when it has master mode); then the medals over
 * the whole game; then the secrets.
 */
export function achievementList(lv: AchievementLevels): Achievement[] {
  const list: Achievement[] = [];
  const all = lv.chapters.flatMap((c) => c.levels);
  const withMaster = all.filter((id) => lv.hasMaster(id));
  for (const chapter of lv.chapters) {
    const names = CHAPTER_NAMES[chapter.id];
    if (!names) continue;
    const ids = chapter.levels;
    list.push(
      {
        id: `done:${chapter.id}`,
        name: names.done,
        desc: 'achDescDone',
        chapter,
        progress: (r) => count(ids, r, (id) => r[id]?.completed === true),
      },
      {
        id: `gold:${chapter.id}`,
        name: names.gold,
        desc: 'achDescGold',
        chapter,
        progress: (r) => count(ids, r, isGold(r)),
      },
    );
    if (names.grandMaster && ids.length > 0 && ids.every((id) => lv.hasMaster(id)))
      list.push({
        id: `grandMaster:${chapter.id}`,
        name: names.grandMaster,
        desc: 'achDescGrandMaster',
        chapter,
        progress: (r) => count(ids, r, isGrandMaster(r)),
      });
  }
  const golds = (n: number) => (r: Records) => ({ got: count(all, r, isGold(r)).got, goal: n });
  list.push(
    { id: 'gold1', name: 'achGold1', desc: 'achDescGold1', progress: golds(1) },
    { id: 'gold10', name: 'achGold10', desc: 'achDescGoldN', n: 10, progress: golds(10) },
    { id: 'gold25', name: 'achGold25', desc: 'achDescGoldN', n: 25, progress: golds(25) },
    {
      id: 'goldAll',
      name: 'achGoldAll',
      desc: 'achDescGoldAll',
      progress: golds(all.length),
    },
    {
      id: 'master1',
      name: 'achMaster1',
      desc: 'achDescMaster1',
      progress: (r) => ({
        got: Math.min(1, count(withMaster, r, (id) => r[id]?.medals.master !== undefined).got),
        goal: 1,
      }),
    },
    {
      id: 'grandMaster1',
      name: 'achGrandMaster1',
      desc: 'achDescGrandMaster1',
      progress: (r) => ({ got: Math.min(1, count(withMaster, r, isGrandMaster(r)).got), goal: 1 }),
    },
    {
      id: 'completionist',
      name: 'achCompletionist',
      desc: 'achDescCompletionist',
      progress: (r) => ({
        got: count(all, r, isGold(r)).got + count(withMaster, r, isGrandMaster(r)).got,
        goal: all.length + withMaster.length,
      }),
    },
    { id: DEEP_THOUGHT, name: 'achDeepThought', desc: 'achDescDeepThought', hidden: true },
    { id: KONAMI, name: 'achKonami', desc: 'achDescKonami', hidden: true },
  );
  // none that cannot be earned: a chapter with no levels, more golds than there are levels
  return list.filter((a) => !a.progress || (a.progress({}).goal > 0 && (a.n ?? 0) <= all.length));
}

/** The achievements the level records earn that are not in `earned` yet, in the list's order. */
export function newlyEarned(
  list: readonly Achievement[],
  records: Records,
  earned: Readonly<Record<string, number>>,
): string[] {
  return list
    .filter((a) => earned[a.id] === undefined && a.progress)
    .filter((a) => {
      const p = a.progress!(records);
      return p.got >= p.goal;
    })
    .map((a) => a.id);
}

/** Adds `ids` to `earned` (at `now`, ms since 1970); returns those not earned before. */
export function grant(
  earned: Record<string, number>,
  ids: readonly string[],
  now: number,
): string[] {
  const fresh = ids.filter((id) => earned[id] === undefined);
  for (const id of fresh) earned[id] = now;
  return fresh;
}

/** Deep Thought: this long without a move, in the middle of a level. */
export const DEEP_THOUGHT_MS = 60_000;

/**
 * The time since the player last did something in a level (a move, a bump, an undo, a restart),
 * in the run clock's time: the time the game was hidden does not count.
 */
export class Stillness {
  private since: number | null = null;

  /** The player did something, at `elapsedMs` of the run clock. */
  act(elapsedMs: number): void {
    this.since = elapsedMs;
  }

  /** A new game: nothing done yet (the watch waits for the first move). */
  reset(): void {
    this.since = null;
  }

  /** The player has kept still for DEEP_THOUGHT_MS, at `elapsedMs` of the run clock. */
  thinking(elapsedMs: number): boolean {
    return this.since !== null && elapsedMs - this.since >= DEEP_THOUGHT_MS;
  }
}

/** ↑ ↑ ↓ ↓ ← → ← → B A, as KeyboardEvent.key values (letters in lower case). */
export const KONAMI_KEYS = [
  'arrowup',
  'arrowup',
  'arrowdown',
  'arrowdown',
  'arrowleft',
  'arrowright',
  'arrowleft',
  'arrowright',
  'b',
  'a',
] as const;

/** Watches the keys for the Konami code. */
export class KonamiCode {
  private last: string[] = [];

  /** A key pressed (KeyboardEvent.key); true when it ends the code. */
  key(key: string): boolean {
    this.last.push(key.toLowerCase());
    if (this.last.length > KONAMI_KEYS.length) this.last.shift();
    const done =
      this.last.length === KONAMI_KEYS.length && this.last.every((k, i) => k === KONAMI_KEYS[i]);
    if (done) this.last = [];
    return done;
  }
}

/** How an achievement shows on the achievements screen. */
export interface AchievementView {
  earned: boolean;
  /** a secret not earned yet: "???" */
  secret: boolean;
  /** not earned yet, with a count worth showing ("7 / 10"): more than one step */
  progress?: Progress;
}

export function viewOf(
  a: Achievement,
  records: Records,
  earned: Readonly<Record<string, number>>,
): AchievementView {
  const done = earned[a.id] !== undefined;
  const view: AchievementView = { earned: done, secret: Boolean(a.hidden) && !done };
  if (!done && a.progress) {
    const p = a.progress(records);
    if (p.goal > 1) view.progress = { got: Math.min(p.got, p.goal), goal: p.goal };
  }
  return view;
}
