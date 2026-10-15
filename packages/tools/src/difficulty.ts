import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  CompactModel,
  DIRS,
  DeadlockAnalysis,
  deriveStages,
  initialState,
  parseMoves,
  solve,
  step,
  type Dir,
  type GameState,
  type LevelData,
  type LevelObject,
} from '@puzzlecave/core';
import { loadPack } from '@puzzlecave/tiled';
import type { CommandResult } from './commands';

/**
 * What a level asks of the player's head rather than of their fingers, measured on its saved
 * (optimal or best known) solution. See `difficultyScore` for how the parts are combined.
 */
export interface DifficultyFeatures {
  moves: number;
  /** pushes + keys picked + doors opened */
  interactions: number;
  pushes: number;
  fills: number;
  keys: number;
  doors: number;
  /**
   * actions: interactions grouped into runs — pushing the same block on in the same direction,
   * move after move, is one action (one decision); each key and each door is one action
   */
  actions: number;
  /**
   * episodes: interactions grouped by the object handled — any number of pushes of the same
   * block in a row (walking around it to push it another way included) is one episode, each key
   * and each door is one; a measure of how many times the player picks what to do next
   */
  episodes: number;
  /**
   * actions that cannot be taken back: a fill, a door opened, or a push run whose block the
   * player cannot push straight back right after it (they cannot reach the cell behind it, or
   * the block cannot go back)
   */
  irreversible: number;
  /** events of the solution (key, water filled, door, exit): `deriveStages` */
  stages: number;
  /** macro-states along the solution: one before each interaction and before the exit */
  decisionPoints: number;
  /** mean number of distinct interactions available at a decision point (macro branching) */
  branching: number;
  /** decision points whose alternatives were tested for traps (evenly spaced sample) */
  sampled: number;
  /** alternative interactions tested (each distinct one once) */
  alternatives: number;
  /** of them, those after which the level can no longer be won */
  traps: number;
  /** traps / (alternatives + TRAP_PRIOR): the share of losing alternatives, damped when few */
  trapRate: number;
  /** macro-states the exact solver explored (up to its cap) */
  solverStates: number;
  /** the exact solver finished within its cap */
  solverDone: boolean;
  /** share of the moves that are plain walking (no interaction) */
  walkShare: number;
}

export interface DifficultyOptions {
  /** decision points tested for traps (evenly spaced along the solution), 40 by default */
  trapPoints?: number;
  /** macro-state cap of each trap test, 5,000 by default */
  trapStates?: number;
  /** time cap of each trap test, 250 ms by default */
  trapTimeoutMs?: number;
  /** macro-state cap of the solver-effort measure, 1,000,000 by default */
  solverStates?: number;
  /** time cap of the solver-effort measure, 30 s by default */
  solverTimeoutMs?: number;
}

/** the state as a level of its own (start = player, keys in pocket = initial keys) */
export function stateAsLevel(s: GameState, id = 'state'): LevelData {
  const objects: LevelObject[] = [];
  s.objects.forEach((kind, i) => {
    if (kind) objects.push({ x: i % s.width, y: Math.floor(i / s.width), kind });
  });
  return {
    id,
    name: id,
    width: s.width,
    height: s.height,
    terrain: [...s.terrain],
    objects,
    start: s.player,
    initialKeys: s.keys,
    thresholds: {},
  };
}

const keyText = (k: ArrayLike<number>) => Array.from(k).join(',');

/**
 * Measures `level` on its winning solution `moves` (throws if a move is refused or the solution
 * does not win).
 */
export function measureDifficulty(
  level: LevelData,
  moves: readonly Dir[],
  o: DifficultyOptions = {},
): DifficultyFeatures {
  const trapPoints = o.trapPoints ?? 40;
  const model = new CompactModel(level);
  const dead = new DeadlockAnalysis(model);
  const { width } = level;
  const cell = (p: { x: number; y: number }) => p.y * width + p.x;

  /** distinct successor keys of a state (and their edges) */
  const successors = (s: GameState): Map<string, number[]> => {
    model.load(model.encode(s));
    const out = new Map<string, number[]>();
    model.expand({
      succ: (edge, _walk, _cell, won) => {
        const k = won ? 'won' : keyText(model.next);
        const edges = out.get(k);
        if (edges) edges.push(edge);
        else out.set(k, [edge]);
        return true;
      },
    });
    return out;
  };

  const f: DifficultyFeatures = {
    moves: 0,
    interactions: 0,
    pushes: 0,
    fills: 0,
    keys: 0,
    doors: 0,
    actions: 0,
    episodes: 0,
    irreversible: 0,
    stages: 0,
    decisionPoints: 0,
    branching: 0,
    sampled: 0,
    alternatives: 0,
    traps: 0,
    trapRate: 0,
    solverStates: 0,
    solverDone: false,
    walkShare: 0,
  };

  // decision points: the state before each interaction, the successor taken and the others
  const points: { state: GameState; taken: string }[] = [];
  let branchSum = 0;
  let s = initialState(level);
  /** the push run in progress: block cell and direction of its last push, irreversible so far */
  let run: { at: number; dir: Dir; fill: boolean } | undefined;
  const closeRun = (after: GameState) => {
    if (!run) return;
    let back = run.fill;
    if (!back) {
      // can the player push the block straight back (standing beyond it, moving the other way)?
      const d = DIRS.indexOf(run.dir);
      const beyond = model.nb[run.at * 4 + d]!;
      const edge = beyond * 4 + (d ^ 1);
      back = beyond < 0 || ![...successors(after).values()].some((e) => e.includes(edge));
    }
    if (back) f.irreversible++;
    run = undefined;
  };
  // block identities (the block that started on a cell), for the episodes
  const blockId = new Map<number, number>();
  s.objects.forEach((o, i) => {
    if (o === 'block') blockId.set(i, i);
  });
  let handled = '';
  const handle = (what: string) => {
    if (what !== handled) f.episodes++;
    handled = what;
  };
  for (const dir of moves) {
    const r = step(s, dir);
    if (r.state.moves === s.moves) throw new Error(`move ${f.moves + 1} (${dir}) is refused`);
    f.moves++;
    const interacts = r.events.some(
      (e) =>
        e.type === 'pushed' ||
        e.type === 'keyPicked' ||
        e.type === 'doorOpened' ||
        e.type === 'won',
    );
    if (interacts) {
      const succ = successors(s);
      branchSum += succ.size;
      f.decisionPoints++;
      const won = r.state.status === 'won';
      points.push({ state: s, taken: won ? 'won' : keyText(model.encode(r.state)) });
    }
    const push = r.events.find((e) => e.type === 'pushed');
    const continues =
      push !== undefined && run !== undefined && run.dir === dir && run.at === cell(push.from);
    if (run && !continues) closeRun(s);
    for (const e of r.events) {
      if (e.type === 'pushed') {
        f.pushes++;
        const id = blockId.get(cell(e.from))!;
        blockId.delete(cell(e.from));
        blockId.set(cell(e.to), id);
        handle(`b${id}`);
        if (!continues) {
          f.actions++;
          run = { at: cell(e.to), dir, fill: false };
        } else run!.at = cell(e.to);
      } else if (e.type === 'blockSank') {
        f.fills++;
        blockId.delete(cell(e.at));
        run!.fill = true;
      } else if (e.type === 'keyPicked') {
        f.keys++;
        f.actions++;
        handle(`k${cell(e.at)}`);
      } else if (e.type === 'doorOpened') {
        f.doors++;
        f.actions++;
        handle(`d${cell(e.at)}`);
        f.irreversible++;
      }
    }
    s = r.state;
  }
  if (s.status !== 'won') throw new Error(`the solution does not win (status ${s.status})`);
  closeRun(s);
  f.interactions = f.pushes + f.keys + f.doors;
  f.stages = deriveStages(level, moves).length;
  f.branching = f.decisionPoints ? branchSum / f.decisionPoints : 0;
  f.walkShare = f.moves ? (f.moves - f.interactions) / f.moves : 0;

  // traps: alternatives after which the level is lost (static dead test, then a small search)
  const verdict = new Map<string, boolean>();
  const picked =
    points.length <= trapPoints
      ? points
      : Array.from(
          { length: trapPoints },
          (_, i) => points[Math.floor((i * points.length) / trapPoints)]!,
        );
  for (const p of picked) {
    f.sampled++;
    for (const k of successors(p.state).keys()) {
      if (k === 'won' || k === p.taken || verdict.has(k)) continue;
      const key = Uint32Array.from(k.split(',').map(Number));
      model.load(key);
      let lost = dead.dead();
      if (!lost) {
        const r = solve(stateAsLevel(model.decode(key)), {
          maxStates: o.trapStates ?? 5000,
          timeoutMs: o.trapTimeoutMs ?? 250,
          maxMemoryMb: 64,
        });
        lost = r.status === 'unsolvable';
      }
      verdict.set(k, lost);
      f.alternatives++;
      if (lost) f.traps++;
    }
  }
  f.trapRate = f.traps / (f.alternatives + TRAP_PRIOR);

  const r = solve(level, {
    maxStates: o.solverStates ?? 1_000_000,
    timeoutMs: o.solverTimeoutMs ?? 30_000,
    maxMemoryMb: 1024,
  });
  f.solverStates = r.explored;
  f.solverDone = r.status === 'solved';
  return f;
}

/** the trap rate counts this many extra safe alternatives (a few alternatives say little) */
export const TRAP_PRIOR = 10;

/** weighted parts of the score (their sum), for the table and the documentation */
export function difficultyParts(f: DifficultyFeatures): Record<string, number> {
  return {
    episodes: 10 * Math.log2(1 + f.episodes),
    irreversible: 5 * Math.log2(1 + f.irreversible),
    branching: 4 * Math.log2(Math.max(1, f.branching)),
    solver: 2 * Math.log10(Math.max(1, f.solverStates)),
    traps: 20 * f.trapRate,
    walk: 2 * Math.log2(1 + f.moves - f.interactions),
  };
}

/**
 * Difficulty score: what the level makes the player think about, much more than how far they
 * walk.
 *
 *     score = 10·log2(1 + episodes) + 5·log2(1 + irreversible) + 4·log2(branching)
 *           + 2·log10(solver states) + 20·trapRate + 2·log2(1 + walking moves)
 *
 * - episodes: how many times the player picks the next thing to handle (a block, a key, a door);
 *   with irreversible (commitments: fills, doors, pushes that cannot be pushed back) on a log
 *   scale, so the 40th decision of a long level adds less than the 4th of a small one;
 * - branching: how many different interactions are open at each point of the solution;
 * - solver states: how hard the level is for an exhaustive search (a hint at how hidden the
 *   route is), capped by the measuring budget (1 M: at most 12 points);
 * - trapRate: share of the alternatives that lose the level (`traps / (alternatives + 10)`):
 *   a level where wrong moves are fatal scores higher (on large levels the small searches rarely
 *   prove a loss, so it is mostly 0 there);
 * - walking moves (moves without interaction) weigh a fifth of the episodes on the same log
 *   scale: a long walk makes a level longer, hardly harder.
 */
export function difficultyScore(f: DifficultyFeatures): number {
  return Object.values(difficultyParts(f)).reduce((a, b) => a + b, 0);
}

export const DIFFICULTY_USAGE =
  'usage: difficulty [<id…>] [--trap-points n] [--trap-states n] [--solver-states n] [--solver-timeout s]';

export interface DifficultyArgs extends DifficultyOptions {
  ids: string[] | 'all';
}

export function parseDifficultyArgs(args: string[]): DifficultyArgs | { error: string } {
  const out: DifficultyArgs = { ids: 'all' };
  const ids: string[] = [];
  const num = (name: string, v: string | undefined): number | { error: string } => {
    const n = Number(v);
    return v === undefined || !Number.isFinite(n) || n <= 0
      ? { error: `${name} needs a positive number\n${DIFFICULTY_USAGE}` }
      : n;
  };
  for (let i = 0; i < args.length; i++) {
    const a = args[i]!;
    const opt = {
      '--trap-points': 'trapPoints',
      '--trap-states': 'trapStates',
      '--solver-states': 'solverStates',
      '--solver-timeout': 'solverTimeoutMs',
    }[a] as keyof DifficultyOptions | undefined;
    if (opt) {
      const n = num(a, args[++i]);
      if (typeof n !== 'number') return n;
      out[opt] = opt === 'solverTimeoutMs' ? n * 1000 : Math.floor(n);
    } else if (a === '--all') continue;
    else if (a.startsWith('--')) return { error: `unknown option ${a}\n${DIFFICULTY_USAGE}` };
    else ids.push(a);
  }
  if (ids.length) out.ids = ids;
  return out;
}

const fmt = (v: number, d = 0) => v.toFixed(d);

/**
 * Table of the levels sorted by difficulty score (easiest first), with their chapter, from their
 * saved solutions.
 */
export function difficultyCommand(
  dir: string,
  o: DifficultyArgs,
  log: (line: string) => void = () => {},
): CommandResult {
  const pack = loadPack(dir);
  const lines = [...pack.errors];
  let ok = pack.errors.length === 0;
  const byId = new Map(pack.levels.map((l) => [l.id, l]));
  const chapterOf = new Map<string, string>();
  for (const ch of pack.chapters) for (const id of ch.levels) chapterOf.set(id, ch.id);
  const wanted = o.ids === 'all' ? pack.chapters.flatMap((c) => c.levels) : o.ids;
  const rows: { id: string; f: DifficultyFeatures; score: number }[] = [];
  for (const id of wanted) {
    const level = byId.get(id);
    if (!level) {
      lines.push(`${id}: unknown level`);
      ok = false;
      continue;
    }
    const file = join(dir, 'solutions', `${id}.txt`);
    if (!existsSync(file)) {
      lines.push(`${id}: no saved solution — skipped`);
      continue;
    }
    try {
      const t0 = performance.now();
      const f = measureDifficulty(level, parseMoves(readFileSync(file, 'utf8')), o);
      rows.push({ id, f, score: difficultyScore(f) });
      log(`${id} measured in ${((performance.now() - t0) / 1000).toFixed(1)} s`);
    } catch (err) {
      lines.push(`${id}: ${(err as Error).message}`);
      ok = false;
    }
  }
  rows.sort((a, b) => a.score - b.score);
  lines.push(
    'rank level  chapter  score  moves walk% episodes actions irrev. stages branch traps/alt  solver states',
  );
  rows.forEach(({ id, f, score }, i) => {
    const level = byId.get(id)!;
    lines.push(
      [
        String(i + 1).padStart(4),
        id.padEnd(6),
        (chapterOf.get(id) ?? '—').padEnd(8),
        fmt(score, 1).padStart(5),
        String(f.moves).padStart(6),
        fmt(100 * f.walkShare).padStart(5),
        String(f.episodes).padStart(8),
        String(f.actions).padStart(7),
        String(f.irreversible).padStart(6),
        String(f.stages).padStart(6),
        fmt(f.branching, 1).padStart(6),
        `${f.traps}/${f.alternatives}`.padStart(9),
        `${f.solverDone ? '' : '≥'}${f.solverStates}`.padStart(14),
        ` ${level.name}`,
      ].join(' '),
    );
  });
  return { ok, lines };
}
