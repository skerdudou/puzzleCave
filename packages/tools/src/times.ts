import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { initialState, parseMoves, step, type Dir, type LevelData } from '@puzzlecave/core';
import { loadPack, setMapProperty } from '@puzzlecave/tiled';
import type { CommandResult } from './commands';

/** shape of a winning solution, the input of the time rule */
export interface SolutionFeatures {
  moves: number;
  /** direction changes between two consecutive moves */
  turns: number;
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
export function solutionFeatures(level: LevelData, moves: readonly Dir[]): SolutionFeatures {
  const f: SolutionFeatures = {
    moves: 0,
    turns: 0,
    pushes: 0,
    keys: 0,
    doors: 0,
    fills: 0,
    interactions: 0,
  };
  let s = initialState(level);
  let prev: Dir | undefined;
  for (const dir of moves) {
    const r = step(s, dir);
    if (r.state.moves === s.moves) throw new Error(`move ${f.moves + 1} (${dir}) is refused`);
    s = r.state;
    f.moves++;
    if (prev !== undefined && prev !== dir) f.turns++;
    prev = dir;
    for (const e of r.events) {
      if (e.type === 'pushed') f.pushes++;
      else if (e.type === 'keyPicked') f.keys++;
      else if (e.type === 'doorOpened') f.doors++;
      else if (e.type === 'blockSank') f.fills++;
    }
  }
  if (s.status !== 'won') throw new Error(`the solution does not win (status ${s.status})`);
  f.interactions = f.pushes + f.keys + f.doors;
  return f;
}

export interface TimeRule {
  /** seconds per move */
  perMove: number;
  /** extra seconds per direction change */
  perTurn: number;
  /** floor: never less than this many seconds per move (human input rate) */
  minPerMove: number;
}

/**
 * Gold-time rule, from player statistics of an earlier version of the game (same rules, same
 * 18×18 boards, a clock that only starts when the player chooses, the map visible beforehand).
 * 238 maps with at least 5 finishers were solved (exact search, or best known solution) and the
 * mean of their three best times fitted against the solution's shape, minimizing the relative
 * error: ≈ 0.043 s × (moves + 6.5 × turns) on the 163 maps with a proven optimal solution, within
 * ×1.2 of the real value on half of them (×1.5 on 80%); pushes, keys and doors add nothing
 * measurable once turns are counted. Rounded up (+10–20%) to 1/20 s per move and 0.3 s per turn,
 * a good player (one who placed around the top three on most maps) earns gold on ~60% of the
 * maps and silver on most others, the record holder gold on ~85%; with the derived silver
 * (×1.25) and bronze (×1.5), the median finisher of a map reaches gold on ~20% of the maps and at
 * least bronze on ~60%. The levels of this game that come from that earlier version are harder
 * than the average map: their recorded times are 0.9–2.3× this rule (median ~1.1).
 *
 * The earlier game moved the player at once on each key press, and ours accepts the next move
 * before the animation of the previous one ends, so the animation is not a floor. The floor is
 * the input rate instead: 10 moves per second (our default key repeat; three quarters of the
 * record times on maps with many turns are slower than that). It only matters for levels made of
 * long straight runs.
 */
export const TIME_RULE: Readonly<TimeRule> = {
  perMove: 0.05,
  perTurn: 0.3,
  minPerMove: 0.1,
};

/** time (seconds, unrounded) of a good player on a level whose best solution has features `f` */
export function estimateTime(f: SolutionFeatures, rule: TimeRule = TIME_RULE): number {
  return Math.max(rule.perMove * f.moves + rule.perTurn * f.turns, rule.minPerMove * f.moves);
}

/** rounding to a readable threshold: whole seconds below a minute, 5 s steps above */
export function niceSeconds(t: number): number {
  return t < 60 ? Math.max(1, Math.round(t)) : Math.round(t / 5) * 5;
}

export function goldTimeFor(f: SolutionFeatures, rule: TimeRule = TIME_RULE): number {
  return niceSeconds(estimateTime(f, rule));
}

export const TIMES_USAGE = 'usage: times [<id…>] [--from <solutions dir>] [--apply] [--force]';

export interface TimesArgs {
  ids: string[] | 'all';
  apply: boolean;
  force: boolean;
  /** solutions read from this folder instead of levels/solutions (e.g. the gold reference
   * solutions of levels whose saved solution is the shorter platinum one) */
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
 * Table of the proposed goldTime of each level (from its saved solution); with `apply`, writes
 * goldTime into the .tmx when it has none, or replaces it with `force`.
 */
export function timesCommand(dir: string, o: TimesArgs): CommandResult {
  const pack = loadPack(dir);
  const lines = [...pack.errors];
  let ok = pack.errors.length === 0;
  const byId = new Map(pack.levels.map((l) => [l.id, l]));
  const wanted = o.ids === 'all' ? pack.levels.map((l) => l.id) : o.ids;
  lines.push('level   moves turns inter.  estimate  goldTime  current');
  for (const id of wanted) {
    const level = byId.get(id);
    if (!level) {
      lines.push(`${id}: unknown level`);
      ok = false;
      continue;
    }
    const file = join(o.from ?? join(dir, 'solutions'), `${id}.txt`);
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
    const gold = niceSeconds(est);
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
      `${id.padEnd(7)} ${String(f.moves).padStart(5)} ${String(f.turns).padStart(5)} ${String(f.interactions).padStart(6)}  ${est.toFixed(1).padStart(8)}  ${String(gold).padStart(8)}  ${String(current ?? '—').padStart(7)}${note}`,
    );
  }
  return { ok, lines };
}
