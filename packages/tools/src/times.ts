import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  initialState,
  parseMoves,
  step,
  type Chapter,
  type Dir,
  type LevelData,
} from '@puzzlecave/core';
import { loadPack, setMapProperty } from '@puzzlecave/tiled';
import type { CommandResult } from './commands';

export interface TimeRule {
  /** seconds per move, out of the held runs (one key press each) */
  perMove: number;
  /** extra seconds per direction change */
  perTurn: number;
  /** a straight run of this many moves or more is played holding the key */
  holdFrom: number;
  /** a held run: the key repeat's first delay (s) after its first move, then its interval (s) */
  holdDelay: number;
  holdInterval: number;
  /** fatigue: the time grows by `fatigue` each time the moves double past `fatigueMoves`, up to
   * `fatigue` at most */
  fatigue: number;
  fatigueMoves: number;
}

/**
 * Gold-time rule: the time of a fast player who knows the route, on a touch screen (slower than
 * a keyboard) with the key repeat at 20 per second (the default is 10: raising it helps on long
 * straight runs). Fitted on play-tested runs (Bomberman 254 moves in 41.4 s, Bomberman 2 A 124 in
 * 18.94 s, No Way Down 217 in 48.49 s, scaled to the moves played), never under any of them: a
 * press costs 0.105 s and a direction change 0.21 s more; a run of 6 moves or more is held, so
 * after its first move it costs the repeat's first delay (0.2 s) then 0.05 s a move. No fatigue
 * showed up to 278 moves: past 300 moves the time grows by 5 % each time the moves double, 5 % at
 * most. An earlier rule (0.05 s a move, 0.35 s a turn, fitted on the best times of an older game
 * where moves were faster) made levels with many turns far too easy and those with long runs too
 * hard. The chapter's margin (CHAPTER_MARGINS) is added on top.
 */
export const TIME_RULE: Readonly<TimeRule> = {
  perMove: 0.105,
  perTurn: 0.21,
  holdFrom: 6,
  holdDelay: 0.2,
  holdInterval: 0.05,
  fatigue: 0.05,
  fatigueMoves: 300,
};

/**
 * The gold time's margin over TIME_RULE, per chapter: it shrinks chapter after chapter (gold is
 * a challenge, more so further on); none on Expert, where a better route than the gold one is
 * expected. None for a level outside these chapters.
 */
export const CHAPTER_MARGINS: Readonly<Record<string, number>> = {
  easy: 1.15,
  medium: 1.1,
  hard: 1.05,
  expert: 1,
};
const DEFAULT_MARGIN = 1;

/** The gold time's margin of level `id` (from its chapter). */
export function marginFor(chapters: readonly Chapter[], id: string): number {
  const ch = chapters.find((c) => c.levels.includes(id));
  return (ch && CHAPTER_MARGINS[ch.id]) ?? DEFAULT_MARGIN;
}

/** shape of a winning solution, the input of the time rule */
export interface SolutionFeatures {
  moves: number;
  /** direction changes between two consecutive moves */
  turns: number;
  /** straight runs long enough to be held (TIME_RULE.holdFrom moves or more) */
  heldRuns: number;
  /** the moves of those runs */
  heldMoves: number;
  pushes: number;
  keys: number;
  doors: number;
  /** blocks sunk into water */
  fills: number;
  /** pushes + keys picked + doors opened */
  interactions: number;
}

/**
 * Replays `moves` and measures the solution. Throws if a move is refused (a saved solution never
 * bumps into a wall) or if the solution does not win.
 */
export function solutionFeatures(
  level: LevelData,
  moves: readonly Dir[],
  rule: TimeRule = TIME_RULE,
): SolutionFeatures {
  const f: SolutionFeatures = {
    moves: 0,
    turns: 0,
    heldRuns: 0,
    heldMoves: 0,
    pushes: 0,
    keys: 0,
    doors: 0,
    fills: 0,
    interactions: 0,
  };
  let s = initialState(level);
  let prev: Dir | undefined;
  let run = 0;
  const endRun = () => {
    if (run >= rule.holdFrom) {
      f.heldRuns++;
      f.heldMoves += run;
    }
    run = 0;
  };
  for (const dir of moves) {
    const r = step(s, dir);
    if (r.state.moves === s.moves) throw new Error(`move ${f.moves + 1} (${dir}) is refused`);
    s = r.state;
    f.moves++;
    if (prev !== undefined && prev !== dir) {
      f.turns++;
      endRun();
    }
    run++;
    prev = dir;
    for (const e of r.events) {
      if (e.type === 'pushed') f.pushes++;
      else if (e.type === 'keyPicked') f.keys++;
      else if (e.type === 'doorOpened') f.doors++;
      else if (e.type === 'blockSank') f.fills++;
    }
  }
  endRun();
  if (s.status !== 'won') throw new Error(`the solution does not win (status ${s.status})`);
  f.interactions = f.pushes + f.keys + f.doors;
  return f;
}

/** the fatigue factor of a solution of `moves` moves (1 up to TIME_RULE.fatigueMoves) */
export function fatigueFactor(moves: number, rule: TimeRule = TIME_RULE): number {
  const doublings = Math.log2(1 + Math.max(0, moves - rule.fatigueMoves) / rule.fatigueMoves);
  return 1 + Math.min(rule.fatigue, rule.fatigue * doublings);
}

/** time (seconds, unrounded, no margin) of the fast player of TIME_RULE on solution `f` */
export function estimateTime(f: SolutionFeatures, rule: TimeRule = TIME_RULE): number {
  // a held run of L moves: its first move pressed, then the repeat's delay, then L - 2 intervals
  const held = f.heldRuns * (rule.perMove + rule.holdDelay - 2 * rule.holdInterval);
  const pace =
    rule.perMove * (f.moves - f.heldMoves) +
    held +
    rule.holdInterval * f.heldMoves +
    rule.perTurn * f.turns;
  return pace * fatigueFactor(f.moves, rule);
}

/**
 * Rounding to a threshold, always up so that the solution it comes from stays within it: to the
 * tenth of a second below a minute, to the second above (the value rounded to the microsecond
 * first, so that a float a hair above a step, 13.700000001, stays on it).
 */
export function niceSeconds(t: number): number {
  const r = Math.round(t * 1e6) / 1e6;
  return r < 60 ? Math.max(0.1, Math.ceil(Math.round(r * 1e5) / 1e4) / 10) : Math.ceil(r);
}

/**
 * goldTime of a level from the features of a winning solution, with the chapter's `margin`. When
 * that solution is shorter than the gold move limit `goldMoves` (a level without a gold reference
 * solution, whose saved one is the platinum route), the time grows with the move ratio: a gold
 * player plays goldMoves moves (a better route makes the gold time easier).
 */
export function goldTimeFor(
  f: SolutionFeatures,
  goldMoves?: number,
  margin = 1,
  rule: TimeRule = TIME_RULE,
): number {
  const ratio = goldMoves !== undefined && goldMoves > f.moves ? goldMoves / f.moves : 1;
  return niceSeconds(estimateTime(f, rule) * ratio * margin);
}

/** The chapters of the pack in `dir` (none when chapters.json is missing or unreadable). */
export function readChapters(dir: string): Chapter[] {
  try {
    return JSON.parse(readFileSync(join(dir, 'chapters.json'), 'utf8')) as Chapter[];
  } catch {
    return [];
  }
}

export const TIMES_USAGE = 'usage: times [<id…>] [--from <solutions dir>] [--apply] [--force]';

export interface TimesArgs {
  ids: string[] | 'all';
  apply: boolean;
  force: boolean;
  /** solutions read from this folder instead of levels/solutions/gold, else levels/solutions */
  from?: string | undefined;
}

export function parseTimesArgs(args: string[]): TimesArgs | { error: string } {
  const fromAt = args.indexOf('--from');
  const from = fromAt >= 0 ? args[fromAt + 1] : undefined;
  if (fromAt >= 0 && (from === undefined || from.startsWith('--')))
    return { error: `--from needs a folder\n${TIMES_USAGE}` };
  const rest = fromAt >= 0 ? args.filter((_, i) => i !== fromAt && i !== fromAt + 1) : args;
  const unknown = rest.find(
    (a) => a.startsWith('--') && !['--apply', '--force', '--all'].includes(a),
  );
  if (unknown) return { error: `unknown option ${unknown}\n${TIMES_USAGE}` };
  const ids = rest.filter((a) => !a.startsWith('--'));
  return {
    ids: ids.length ? ids : 'all',
    apply: rest.includes('--apply'),
    force: rest.includes('--force'),
    from,
  };
}

/**
 * Table of the proposed goldTime of each level (from its gold reference solution, else its saved
 * one, with its chapter's margin); with `apply`, writes goldTime into the .tmx when it has none,
 * or replaces it with `force`.
 */
export function timesCommand(dir: string, o: TimesArgs): CommandResult {
  const pack = loadPack(dir);
  const lines = [...pack.errors];
  let ok = pack.errors.length === 0;
  const byId = new Map(pack.levels.map((l) => [l.id, l]));
  const wanted = o.ids === 'all' ? pack.levels.map((l) => l.id) : o.ids;
  lines.push('level   moves turns held  estimate  margin  goldTime  current');
  for (const id of wanted) {
    const level = byId.get(id);
    if (!level) {
      lines.push(`${id}: unknown level`);
      ok = false;
      continue;
    }
    // the gold reference solution when there is one, else the saved (platinum) one
    const goldFile = join(dir, 'solutions', 'gold', `${id}.txt`);
    const file =
      o.from !== undefined
        ? join(o.from, `${id}.txt`)
        : existsSync(goldFile)
          ? goldFile
          : join(dir, 'solutions', `${id}.txt`);
    if (!existsSync(file)) {
      lines.push(`${id}: no saved solution — skipped`);
      continue;
    }
    let f: SolutionFeatures;
    try {
      f = solutionFeatures(level, parseMoves(readFileSync(file, 'utf8')));
    } catch (err) {
      lines.push(`${id}: ${(err as Error).message}`);
      ok = false;
      continue;
    }
    const est = estimateTime(f);
    const margin = marginFor(pack.chapters, id);
    const gold = goldTimeFor(f, level.thresholds.goldMoves, margin);
    const current = level.thresholds.goldTime;
    let note = '';
    if (o.apply) {
      if (current === undefined || (o.force && current !== gold)) {
        const tmx = join(dir, `${id}.tmx`);
        try {
          writeFileSync(tmx, setMapProperty(readFileSync(tmx, 'utf8'), 'goldTime', gold));
          note = '  written';
        } catch (err) {
          ok = false;
          note = `  write error — ${(err as Error).message}`;
        }
      } else if (current !== gold) note = '  kept (--force to replace)';
    }
    lines.push(
      `${id.padEnd(7)} ${String(f.moves).padStart(5)} ${String(f.turns).padStart(5)} ${String(f.heldMoves).padStart(4)}  ${est.toFixed(1).padStart(8)}  ${margin.toFixed(2).padStart(6)}  ${String(gold).padStart(8)}  ${String(current ?? '—').padStart(7)}${note}`,
    );
  }
  return { ok, lines };
}
