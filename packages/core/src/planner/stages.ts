// Hand-written sub-goal plans: a stages file lists, in order, the events a solution goes
// through (take a key, fill a water, open a door, put a block somewhere, reach a cell, exit) with
// the blocks each stage may move. Each stage is one restricted search (subgoal.ts: everything not
// allowed is a wall) from the end state of the previous one; the chained moves are replayed with
// the real rules. Complements the automatic planner (plan.ts) when its event order is not the
// one wanted: the order is given, only the moves are searched.
//
// Format: one stage per line, `#` starts a comment. A line is a list of clauses, each a keyword
// followed by cells `x,y`:
//   goals (all must hold at the end of the stage; at least one):
//     key x,y…    those keys are taken          water x,y…  those waters are filled
//     door x,y…   those doors are open          at x,y…     a block stands on each cell
//     reach x,y…  the player can walk to them   exit        the player reaches the exit (alone)
//     player x,y  the stage ends with the player on x,y (cell of its last push, key or door)
//   permissions (everything else is frozen; cells are those at the start of the stage):
//     blocks x,y… blocks that may move          doors x,y…  doors that may be opened
//     waters x,y… | waters all   waters a block may fill
//   the waters of `water` and the doors of `door` are allowed implicitly.
//   option: max N   macro-state limit of this stage's search
import { BLOCK, CompactModel, DOOR, KEY, WATER } from '../compactModel';
import { replay } from '../replay';
import { initialState } from '../state';
import { step } from '../step';
import type { Dir, GameState, LevelData } from '../types';
import { reachSubgoal, type Goal } from './subgoal';

export interface Stage {
  /** goals */
  keys: number[];
  waters: number[];
  doors: number[];
  at: number[];
  reach: number[];
  /** at most one cell */
  player: number[];
  exit: boolean;
  /** permissions */
  blocks: number[];
  allowDoors: number[];
  allowWaters: number[] | 'all';
  /** macro-state limit of this stage (else the run's default) */
  maxStates?: number;
  /** source line (1-based), for messages */
  line?: number;
  /** trailing comment (kept by format) */
  comment?: string;
}

/** clauses holding a list of cells (`waters` apart: it also takes `all`) */
const FIELD = {
  key: 'keys',
  water: 'waters',
  door: 'doors',
  at: 'at',
  reach: 'reach',
  player: 'player',
  blocks: 'blocks',
  doors: 'allowDoors',
} as const;
type Clause = keyof typeof FIELD | 'waters';
const isClause = (tok: string): tok is Clause => tok === 'waters' || tok in FIELD;

export function emptyStage(): Stage {
  return {
    keys: [],
    waters: [],
    doors: [],
    at: [],
    reach: [],
    player: [],
    exit: false,
    blocks: [],
    allowDoors: [],
    allowWaters: [],
  };
}

/** Parses a stages file for a level of the given size; throws `line N: …` on a syntax error. */
export function parseStages(text: string, width: number, height: number): Stage[] {
  const stages: Stage[] = [];
  text.split(/\r?\n/).forEach((raw, i) => {
    const line = i + 1;
    const hash = raw.indexOf('#');
    const body = (hash < 0 ? raw : raw.slice(0, hash)).trim();
    if (body === '') return;
    const fail = (msg: string): never => {
      throw new Error(`line ${line}: ${msg}`);
    };
    const st = emptyStage();
    st.line = line;
    const comment = hash < 0 ? '' : raw.slice(hash + 1).trim();
    if (comment) st.comment = comment;
    let clause: Clause | 'max' | 'exit' | undefined;
    let count = 0;
    const close = () => {
      if (clause && clause !== 'exit' && count === 0)
        fail(`"${clause}" needs ${clause === 'max' ? 'a number' : 'cells'}`);
    };
    for (const tok of body.split(/\s+/)) {
      if (isClause(tok)) {
        close();
        clause = tok;
        count = 0;
      } else if (tok === 'exit') {
        close();
        st.exit = true;
        clause = 'exit';
      } else if (tok === 'max') {
        close();
        clause = 'max';
        count = 0;
      } else if (clause === 'max') {
        const n = Number(tok);
        if (count > 0 || !Number.isInteger(n) || n <= 0) fail(`bad "max" value "${tok}"`);
        st.maxStates = n;
        count++;
      } else if (clause === 'waters' && tok === 'all') {
        if (count > 0) fail('"waters all" takes no cells');
        st.allowWaters = 'all';
        count++;
      } else {
        const m = /^(\d+),(\d+)$/.exec(tok);
        if (!m) return fail(`unexpected "${tok}"`);
        if (!clause || clause === 'exit') return fail(`cell "${tok}" outside a clause`);
        const x = Number(m[1]);
        const y = Number(m[2]);
        if (x >= width || y >= height) fail(`cell ${tok} outside the ${width}×${height} map`);
        const c = y * width + x;
        if (clause === 'waters') {
          if (st.allowWaters === 'all') fail('"waters all" takes no cells');
          else st.allowWaters.push(c);
        } else st[FIELD[clause]].push(c);
        count++;
      }
    }
    close();
    if (st.player.length > 1) fail('"player" takes one cell');
    const goals =
      st.keys.length + st.waters.length + st.doors.length + st.at.length + st.player.length;
    if (!st.exit && goals + st.reach.length === 0)
      fail('no goal (key, water, door, at, reach, player, exit)');
    if (st.exit && goals + st.reach.length > 0) fail('"exit" cannot be combined with other goals');
    stages.push(st);
  });
  return stages;
}

const cellText = (c: number, width: number) => `${c % width},${Math.floor(c / width)}`;

/** One stage as a line of the stages file (inverse of parseStages). */
export function formatStage(st: Stage, width: number): string {
  const parts: string[] = [];
  const clause = (kw: string, cells: number[]) => {
    if (cells.length) parts.push(`${kw} ${cells.map((c) => cellText(c, width)).join(' ')}`);
  };
  if (st.exit) parts.push('exit');
  clause('key', st.keys);
  clause('water', st.waters);
  clause('door', st.doors);
  clause('at', st.at);
  clause('reach', st.reach);
  clause('player', st.player);
  clause('blocks', st.blocks);
  clause('doors', st.allowDoors);
  if (st.allowWaters === 'all') parts.push('waters all');
  else clause('waters', st.allowWaters);
  if (st.maxStates !== undefined) parts.push(`max ${st.maxStates}`);
  return parts.join('  ') + (st.comment ? `  # ${st.comment}` : '');
}

export function formatStages(stages: Stage[], width: number): string {
  return stages.map((st) => formatStage(st, width) + '\n').join('');
}

/**
 * Stages of an existing solution: a stage ends at each event (key taken, water filled, door
 * opened, exit). Each stage allows the blocks moved in its segment, and pins the end of the
 * segment (`at` on the blocks moved and still present, `player` on the player's cell): each
 * rebuilt stage ends where the original segment did (keys taken on the way aside), in at most as
 * many moves since its search is the shortest. The comment gives the segment length.
 */
export function deriveStages(level: LevelData, moves: readonly Dir[]): Stage[] {
  const { width } = level;
  let s: GameState = initialState(level);
  // block identities: id per cell, start cell of each id in the current segment
  const idAt = new Map<number, number>();
  let nextId = 0;
  s.objects.forEach((o, i) => {
    if (o === 'block') idAt.set(i, nextId++);
  });
  const stages: Stage[] = [];
  let moved = new Map<number, number>(); // id → cell at the segment start
  let st = emptyStage();
  let length = 0;
  const cellOf = (p: { x: number; y: number }) => p.y * width + p.x;
  for (const d of moves) {
    if (s.status !== 'playing') break;
    const r = step(s, d);
    let event = false;
    for (const e of r.events) {
      if (e.type === 'pushed') {
        const from = cellOf(e.from);
        const id = idAt.get(from)!;
        idAt.delete(from);
        if (!moved.has(id)) moved.set(id, from);
        idAt.set(cellOf(e.to), id);
      } else if (e.type === 'blockSank') {
        idAt.delete(cellOf(e.at));
        st.waters.push(cellOf(e.at));
        event = true;
      } else if (e.type === 'keyPicked') {
        st.keys.push(cellOf(e.at));
        event = true;
      } else if (e.type === 'doorOpened') {
        st.doors.push(cellOf(e.at));
        event = true;
      } else if (e.type === 'won') {
        st.exit = true;
        event = true;
      }
    }
    if (r.state.moves !== s.moves) length++;
    s = r.state;
    if (!event) continue;
    st.blocks = [...moved.values()].sort((a, b) => a - b);
    if (!st.exit) {
      const ids = new Set(moved.keys());
      for (const [c, id] of idAt) if (ids.has(id)) st.at.push(c);
      st.at.sort((a, b) => a - b);
      st.player.push(cellOf(s.player));
    }
    st.comment = `${length} moves`;
    stages.push(st);
    st = emptyStage();
    moved = new Map();
    length = 0;
  }
  if (s.status !== 'won') throw new Error('the solution does not win');
  return stages;
}

export interface StageReport {
  /** 1-based index in the file, source line */
  index: number;
  line?: number;
  moves: number;
  explored: number;
  ms: number;
}

export interface RunStagesOptions {
  /** default macro-state limit per stage */
  maxStates?: number;
  /** wall-clock limit per stage */
  timeoutMs?: number;
  maxMemoryMb?: number;
  now?: () => number;
}

export type RunStagesResult =
  | { status: 'won'; moves: Dir[]; stages: StageReport[] }
  | {
      status: 'failed';
      /** 1-based index of the failing stage (stages.length + 1: the plan does not win) */
      index: number;
      line?: number;
      reason: string;
      /** moves of the stages that succeeded */
      moves: Dir[];
      stages: StageReport[];
    };

/**
 * Goal of a stage on a compact model (the restricted one or the real one). `at` cells holding a
 * frozen block (a wall in the restricted model) are satisfied by it.
 */
function stageGoal(st: Stage, s: GameState): Goal {
  const at = st.at.filter((c) => s.objects[c] !== 'block' || st.blocks.includes(c));
  return (m) => {
    for (const c of st.keys) if (m.grid[c] === KEY) return false;
    for (const c of st.waters) if (m.grid[c] === WATER) return false;
    for (const c of st.doors) if (m.grid[c] === DOOR) return false;
    for (const c of at) if (m.grid[c] !== BLOCK) return false;
    for (const c of st.player) if (m.player !== c) return false;
    if (st.reach.length) {
      m.explore();
      for (const c of st.reach) if (!m.reached(c)) return false;
    }
    return true;
  };
}

/** Runs the stages in order from the level start; the result is replayed with the real rules. */
export function runStages(
  level: LevelData,
  stages: Stage[],
  opts: RunStagesOptions = {},
): RunStagesResult {
  const now = opts.now ?? (() => performance.now());
  const { width } = level;
  const name = (c: number) => `(${cellText(c, width)})`;
  const reports: StageReport[] = [];
  const moves: Dir[] = [];
  let s = initialState(level);
  const fail = (index: number, line: number | undefined, reason: string): RunStagesResult => ({
    status: 'failed',
    index,
    ...(line !== undefined ? { line } : {}),
    reason,
    moves,
    stages: reports,
  });
  for (let i = 0; i < stages.length; i++) {
    const st = stages[i]!;
    const t0 = now();
    const index = i + 1;
    if (s.status === 'won') return fail(index, st.line, 'the level is already won');
    // cells must hold what the clauses say
    for (const c of st.blocks)
      if (s.objects[c] !== 'block') return fail(index, st.line, `no block at ${name(c)}`);
    for (const c of st.keys)
      if (level.objects.every((o) => o.kind !== 'key' || o.y * width + o.x !== c))
        return fail(index, st.line, `no key at ${name(c)} in the level`);
    for (const c of [...st.doors, ...st.allowDoors])
      if (level.objects.every((o) => o.kind !== 'door' || o.y * width + o.x !== c))
        return fail(index, st.line, `no door at ${name(c)} in the level`);
    for (const c of st.allowWaters === 'all' ? st.waters : [...st.waters, ...st.allowWaters])
      if (level.terrain[c] !== 'water') return fail(index, st.line, `no water at ${name(c)}`);
    const goal = stageGoal(st, s);
    const report = (moves: number, explored: number): StageReport => ({
      index,
      ...(st.line !== undefined ? { line: st.line } : {}),
      moves,
      explored,
      ms: now() - t0,
    });
    if (!st.exit) {
      const real = new CompactModel(level);
      real.load(real.encode(s));
      if (goal(real)) {
        reports.push(report(0, 0));
        continue;
      }
    }
    const r = reachSubgoal(
      s,
      {
        free: st.blocks,
        doors: [...st.doors, ...st.allowDoors],
        waters: st.allowWaters === 'all' ? 'all' : [...st.waters, ...st.allowWaters],
      },
      goal,
      {
        maxStates: st.maxStates ?? opts.maxStates ?? 200_000,
        win: st.exit,
        ...(opts.timeoutMs !== undefined ? { timeoutMs: opts.timeoutMs } : {}),
        ...(opts.maxMemoryMb !== undefined ? { maxMemoryMb: opts.maxMemoryMb } : {}),
        now,
      },
    );
    if (!r.ok) {
      let reason = r.timedOut
        ? `timeout after ${r.explored} macro-states`
        : r.full
          ? `state limit reached (${r.explored} macro-states; raise it with "max N" or --max-states)`
          : `unreachable (all ${r.explored} macro-states explored)`;
      if (!r.timedOut && !r.full && r.touched.length)
        reason += `; frozen blocks the player could push: ${r.touched
          .sort((a, b) => a - b)
          .map((c) => cellText(c, width))
          .join(' ')}`;
      return fail(index, st.line, reason);
    }
    moves.push(...r.moves);
    s = r.state;
    reports.push(report(r.moves.length, r.explored));
  }
  if (replay(level, moves).status !== 'won')
    return fail(stages.length + 1, undefined, 'the stages end without reaching the exit');
  return { status: 'won', moves, stages: reports };
}
