// "Explore starting points": the improve pipeline only replaces windows of a solution by shorter
// paths to the same state, so it never changes the order of the events. This module cuts a
// winning solution into its events (one unit per key taken, water filled, door opened, exit),
// generates variants of that event plan (stages reordered, merged or split, end pins dropped,
// an extra water filled with a block the solution never pushes) and rebuilds each variant with
// the exact per-stage searches of `runStages` (restricted Dijkstra, everything not allowed is a
// wall). The rebuilds are cheap: a local search ranks hundreds of variants by length, then the
// windows of `improve` run on the few best ones and the shortest result is kept.
//
// Blocks are tracked by identity (the block that started on a cell), not by cell: a stage moved
// earlier or later still names the same blocks, wherever they stand when it runs. A stage's end
// pins are those of the original solution (`at`: the cells its blocks occupied at the end of its
// segment; `player`: the player's cell), each of which a variant may drop.
import { CompactModel } from '../compactModel';
import { reoptimize } from '../improve/reoptimize';
import { spareKeys } from '../improve/spareKeys';
import { replay } from '../replay';
import { initialState } from '../state';
import { step } from '../step';
import type { Dir, GameState, LevelData } from '../types';
import { emptyStage, stageGoal, type Stage } from './stages';
import { reachSubgoal } from './subgoal';

/** one event of the original solution and the segment of moves that leads to it */
export interface Segment {
  keys: number[];
  waters: number[];
  doors: number[];
  exit: boolean;
  /** identities of the blocks pushed in the segment */
  ids: number[];
  /** cell of each pushed block at the end of the segment (absent: sank) */
  endAt: Map<number, number>;
  /** player cell at the end of the segment */
  endPlayer: number;
  /** moves of the segment */
  length: number;
}

/** a stage of a variant: one or more segments (merged: searched together), or an extra water */
export interface Unit {
  segs: number[];
  pinPlayer: boolean;
  pinAt: boolean;
  /** extra stage: fill this water with that block (identity), no pin */
  extra?: { water: number; block: number };
}

export interface ExploreModel {
  level: LevelData;
  segments: Segment[];
  /** start cell of each block identity */
  blockStart: number[];
  /** (water, block) pairs for extra fills: waters left unfilled, blocks never pushed, nearby */
  extras: { water: number; block: number }[];
}

const cellOf = (p: { x: number; y: number }, width: number) => p.y * width + p.x;

/** Cuts a winning solution into its events (as deriveStages), with block identities. */
export function segmentSolution(level: LevelData, moves: readonly Dir[]): ExploreModel {
  const { width } = level;
  let s: GameState = initialState(level);
  const blockStart: number[] = [];
  const idAt = new Map<number, number>();
  s.objects.forEach((o, i) => {
    if (o === 'block') {
      idAt.set(i, blockStart.length);
      blockStart.push(i);
    }
  });
  const pushed = new Set<number>();
  const segments: Segment[] = [];
  let moved = new Set<number>();
  let seg: Segment = newSegment();
  for (const d of moves) {
    if (s.status !== 'playing') break;
    const r = step(s, d);
    let event = false;
    for (const e of r.events) {
      if (e.type === 'pushed') {
        const from = cellOf(e.from, width);
        const id = idAt.get(from)!;
        idAt.delete(from);
        moved.add(id);
        pushed.add(id);
        idAt.set(cellOf(e.to, width), id);
      } else if (e.type === 'blockSank') {
        idAt.delete(cellOf(e.at, width));
        seg.waters.push(cellOf(e.at, width));
        event = true;
      } else if (e.type === 'keyPicked') {
        seg.keys.push(cellOf(e.at, width));
        event = true;
      } else if (e.type === 'doorOpened') {
        seg.doors.push(cellOf(e.at, width));
        event = true;
      } else if (e.type === 'won') {
        seg.exit = true;
        event = true;
      }
    }
    if (r.state.moves !== s.moves) seg.length++;
    s = r.state;
    if (!event) continue;
    seg.ids = [...moved].sort((a, b) => a - b);
    for (const [c, id] of idAt) if (moved.has(id)) seg.endAt.set(id, c);
    seg.endPlayer = cellOf(s.player, width);
    segments.push(seg);
    seg = newSegment();
    moved = new Set();
  }
  if (s.status !== 'won') throw new Error('the solution does not win');
  // extra fills: each water still unfilled at the end, with the 3 closest never-pushed blocks
  const extras: { water: number; block: number }[] = [];
  for (let c = 0; c < s.terrain.length; c++) {
    if (s.terrain[c] !== 'water') continue;
    const near = blockStart
      .map((b, id) => ({ id, d: manhattan(b, c, width) }))
      .filter((e) => !pushed.has(e.id) && e.d <= 6)
      .sort((a, b) => a.d - b.d)
      .slice(0, 3);
    for (const e of near) extras.push({ water: c, block: e.id });
  }
  return { level, segments, blockStart, extras };
}

function newSegment(): Segment {
  return {
    keys: [],
    waters: [],
    doors: [],
    exit: false,
    ids: [],
    endAt: new Map(),
    endPlayer: -1,
    length: 0,
  };
}

const manhattan = (a: number, b: number, w: number) =>
  Math.abs((a % w) - (b % w)) + Math.abs(Math.floor(a / w) - Math.floor(b / w));

/** the original event order, one unit per segment, all pins on */
export function baseOrder(m: ExploreModel): Unit[] {
  return m.segments.map((_, i) => ({ segs: [i], pinPlayer: true, pinAt: true }));
}

const unitIds = (m: ExploreModel, u: Unit): number[] =>
  u.extra ? [u.extra.block] : [...new Set(u.segs.flatMap((i) => m.segments[i]!.ids))];

export function unitText(m: ExploreModel, u: Unit): string {
  const w = m.level.width;
  const cell = (c: number) => `${c % w},${Math.floor(c / w)}`;
  if (u.extra) return `+water ${cell(u.extra.water)}`;
  const parts = u.segs.map((i) => {
    const s = m.segments[i]!;
    if (s.exit) return 'exit';
    return [
      ...s.keys.map((c) => `key ${cell(c)}`),
      ...s.waters.map((c) => `water ${cell(c)}`),
      ...s.doors.map((c) => `door ${cell(c)}`),
    ].join(' ');
  });
  const pins = (u.pinPlayer ? '' : ' -player') + (u.pinAt ? '' : ' -at');
  return parts.join(' + ') + pins;
}

const unitSig = (u: Unit) =>
  u.extra
    ? `x${u.extra.water}:${u.extra.block}`
    : `${u.segs.join('.')}${u.pinPlayer ? 'p' : ''}${u.pinAt ? 'a' : ''}`;

export interface RebuildOptions {
  /** macro-states per stage (200,000 by default) */
  maxStates?: number;
  /** wall-clock limit per stage (10 s by default) */
  stageTimeoutMs?: number;
  maxMemoryMb?: number;
  now?: () => number;
}

interface StepResult {
  ok: boolean;
  moves: Dir[];
  /** encoded end state */
  end?: Uint32Array;
  /** cells of the unit's blocks at the end (−1: sank) */
  after?: number[];
}

/**
 * Rebuilds variants of one solution's event plan, with a memo of every stage search (keyed by
 * start state, stage and block cells): variants share most of their stages.
 */
export class Rebuilder {
  readonly model: CompactModel;
  private memo = new Map<string, StepResult>();
  searches = 0;

  constructor(
    readonly m: ExploreModel,
    private opts: RebuildOptions = {},
  ) {
    this.model = new CompactModel(m.level);
  }

  /** moves of the variant, or why it fails; `bound`: give up once longer */
  rebuild(order: Unit[], bound = Infinity): { moves: Dir[] } | { failed: string } {
    const { m, model } = this;
    let s: GameState = initialState(m.level);
    const idCell = m.blockStart.slice();
    const moves: Dir[] = [];
    for (let k = 0; k < order.length; k++) {
      const u = order[k]!;
      // a block that has already sunk (moved earlier by a reordered stage) is simply not free
      const ids = unitIds(m, u).filter((id) => idCell[id]! >= 0);
      if (u.extra && !ids.length) return { failed: `stage ${k + 1}: its block has sunk` };
      const cells = ids.map((id) => idCell[id]!);
      const key = `${model.encode(s).join(',')}|${unitSig(u)}|${cells.join(',')}`;
      let r = this.memo.get(key);
      if (!r) {
        r = this.runUnit(s, u, ids, cells);
        if (this.memo.size >= 300_000) this.memo.clear();
        this.memo.set(key, r);
      }
      if (!r.ok) return { failed: `stage ${k + 1} (${unitText(m, u)})` };
      moves.push(...r.moves);
      if (moves.length > bound) return { failed: 'bound' };
      s = model.decode(r.end!);
      ids.forEach((id, j) => (idCell[id] = r.after![j]!));
    }
    if (replay(m.level, moves).status !== 'won') return { failed: 'does not win' };
    return { moves };
  }

  private runUnit(s: GameState, u: Unit, ids: number[], cells: number[]): StepResult {
    const { m } = this;
    const width = m.level.width;
    const st: Stage = emptyStage();
    if (u.extra) st.waters.push(u.extra.water);
    else
      for (const i of u.segs) {
        const g = m.segments[i]!;
        st.keys.push(...g.keys);
        st.waters.push(...g.waters);
        st.doors.push(...g.doors);
        st.exit ||= g.exit;
      }
    st.blocks = cells;
    if (!st.exit && !u.extra) {
      const last = Math.max(...u.segs);
      if (u.pinPlayer) st.player.push(m.segments[last]!.endPlayer);
      if (u.pinAt)
        for (const id of ids) {
          // cell after the last segment of the unit that pushes this block
          const seg = [...u.segs]
            .sort((a, b) => b - a)
            .find((i) => m.segments[i]!.ids.includes(id));
          const c = m.segments[seg!]!.endAt.get(id);
          if (c !== undefined) st.at.push(c);
        }
    }
    const goal = stageGoal(st, s);
    let moves: Dir[] = [];
    if (st.exit || !goal(loaded(this.model, s))) {
      this.searches++;
      const r = reachSubgoal(s, { free: st.blocks, doors: st.doors, waters: st.waters }, goal, {
        maxStates: this.opts.maxStates ?? 200_000,
        win: st.exit,
        timeoutMs: this.opts.stageTimeoutMs ?? 10_000,
        ...(this.opts.maxMemoryMb !== undefined ? { maxMemoryMb: this.opts.maxMemoryMb } : {}),
        ...(this.opts.now ? { now: this.opts.now } : {}),
      });
      if (!r.ok) return { ok: false, moves: [] };
      moves = r.moves;
    }
    // follow the unit's blocks along the moves (the others are walls: they never move)
    const at = new Map(cells.map((c, j) => [c, j]));
    const after = cells.slice();
    let cur = s;
    for (const d of moves) {
      const r = step(cur, d);
      for (const e of r.events) {
        if (e.type === 'pushed') {
          const j = at.get(cellOf(e.from, width))!;
          at.delete(cellOf(e.from, width));
          at.set(cellOf(e.to, width), j);
          after[j] = cellOf(e.to, width);
        } else if (e.type === 'blockSank') {
          const c = cellOf(e.at, width);
          const j = at.get(c)!;
          at.delete(c);
          after[j] = -1;
        }
      }
      cur = r.state;
    }
    return { ok: true, moves, end: this.model.encode(cur), after };
  }
}

function loaded(model: CompactModel, s: GameState): CompactModel {
  model.load(model.encode(s));
  return model;
}

// ---- local search over event plans ----

/** small deterministic PRNG (mulberry32) */
export function prng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export type MutationKind =
  | 'swap'
  | 'move'
  | 'reverse'
  | 'blockSwap'
  | 'merge'
  | 'split'
  | 'pinPlayer'
  | 'pinAt'
  | 'addWater'
  | 'dropWater';

const KINDS: MutationKind[] = [
  'swap',
  'swap',
  'move',
  'move',
  'reverse',
  'blockSwap',
  'merge',
  'split',
  'pinPlayer',
  'pinAt',
  'addWater',
  'dropWater',
];

/**
 * A random neighbour of the plan (null if the drawn mutation does not apply). The exit unit
 * stays last; merged units hold at most 4 blocks.
 */
export function mutate(
  m: ExploreModel,
  order: Unit[],
  rnd: () => number,
  kind: MutationKind = KINDS[Math.floor(rnd() * KINDS.length)]!,
): Unit[] | null {
  const n = order.length - 1; // movable units (the exit stays last)
  const int = (k: number) => Math.floor(rnd() * k);
  const o = order.slice();
  if (n < 2 && kind !== 'pinPlayer' && kind !== 'pinAt' && kind !== 'addWater') return null;
  switch (kind) {
    case 'swap': {
      const i = int(n - 1);
      [o[i], o[i + 1]] = [o[i + 1]!, o[i]!];
      return o;
    }
    case 'move': {
      const i = int(n);
      const off = (1 + int(8)) * (rnd() < 0.5 ? -1 : 1);
      const j = Math.max(0, Math.min(n - 1, i + off));
      if (j === i) return null;
      const [u] = o.splice(i, 1);
      o.splice(j, 0, u!);
      return o;
    }
    case 'reverse': {
      const len = 2 + int(Math.min(11, n - 1));
      const i = int(n - len + 1);
      const part = o.slice(i, i + len).reverse();
      o.splice(i, len, ...part);
      return o;
    }
    case 'blockSwap': {
      const a = 1 + int(6);
      const b = 1 + int(6);
      if (a + b > n) return null;
      const i = int(n - a - b + 1);
      const first = o.slice(i, i + a);
      const second = o.slice(i + a, i + a + b);
      o.splice(i, a + b, ...second, ...first);
      return o;
    }
    case 'merge': {
      const i = int(n - 1);
      const x = o[i]!;
      const y = o[i + 1]!;
      if (x.extra || y.extra) return null;
      const merged: Unit = {
        segs: [...x.segs, ...y.segs],
        pinPlayer: y.pinPlayer,
        pinAt: x.pinAt && y.pinAt,
      };
      if (unitIds(m, merged).length > 4) return null;
      o.splice(i, 2, merged);
      return o;
    }
    case 'split': {
      const multi = o.map((u, i) => (u.segs.length > 1 ? i : -1)).filter((i) => i >= 0);
      if (!multi.length) return null;
      const i = multi[int(multi.length)]!;
      const u = o[i]!;
      const cut = 1 + int(u.segs.length - 1);
      o.splice(
        i,
        1,
        { ...u, segs: u.segs.slice(0, cut), pinPlayer: true },
        { ...u, segs: u.segs.slice(cut) },
      );
      return o;
    }
    case 'pinPlayer':
    case 'pinAt': {
      const i = int(n);
      const u = o[i]!;
      if (u.extra) return null;
      o[i] = kind === 'pinPlayer' ? { ...u, pinPlayer: !u.pinPlayer } : { ...u, pinAt: !u.pinAt };
      return o;
    }
    case 'addWater': {
      const used = new Set(o.flatMap((u) => unitIds(m, u)));
      const filled = new Set(o.flatMap((u) => (u.extra ? [u.extra.water] : [])));
      const free = m.extras.filter((e) => !used.has(e.block) && !filled.has(e.water));
      if (!free.length) return null;
      const extra = free[int(free.length)]!;
      o.splice(int(n + 1), 0, { segs: [], pinPlayer: false, pinAt: false, extra });
      return o;
    }
    case 'dropWater': {
      const xs = o.map((u, i) => (u.extra ? i : -1)).filter((i) => i >= 0);
      if (!xs.length) return null;
      o.splice(xs[int(xs.length)]!, 1);
      return o;
    }
  }
}

export interface Variant {
  moves: Dir[];
  order: Unit[];
}

export interface ScreenOptions extends RebuildOptions {
  /** variants rebuilt at most */
  variants: number;
  /** wall-clock limit of the screening */
  timeoutMs: number;
  /** variants kept (the shortest, distinct) */
  keep: number;
  seed?: number;
  /** solutions never kept (the input solution, variants already improved) */
  exclude?: readonly (readonly Dir[])[];
}

export interface ScreenResult {
  /** rebuild of the original plan (fails if a stage limit is hit) */
  base?: Dir[];
  /** shortest distinct variants, shortest first */
  kept: Variant[];
  tried: number;
  feasible: number;
  searches: number;
}

/**
 * Local search over event plans from the solution's own plan: each step draws a random
 * mutation (one or two), rebuilds it, and moves there when it is not longer; after 150 steps
 * without progress it restarts from a random kept variant. The first variants are the plan
 * itself and the plan with all player pins, then all pins, dropped.
 */
export function screenVariants(m: ExploreModel, o: ScreenOptions): ScreenResult {
  const now = o.now ?? (() => performance.now());
  const deadline = now() + o.timeoutMs;
  const rnd = prng(o.seed ?? 1);
  const rb = new Rebuilder(m, o);
  const exclude = new Set((o.exclude ?? []).map((v) => v.join('')));
  const kept = new Map<string, Variant>();
  const res: ScreenResult = { kept: [], tried: 0, feasible: 0, searches: 0 };
  const worstKept = () =>
    kept.size < o.keep ? Infinity : Math.max(...[...kept.values()].map((v) => v.moves.length));
  const consider = (order: Unit[], bound: number): Dir[] | undefined => {
    res.tried++;
    const r = rb.rebuild(order, bound);
    if (!('moves' in r)) return undefined;
    res.feasible++;
    const text = r.moves.join('');
    if (!exclude.has(text) && !kept.has(text) && r.moves.length < worstKept()) {
      kept.set(text, { moves: r.moves, order });
      if (kept.size > o.keep) {
        let worst = '';
        let len = -1;
        for (const [k, v] of kept)
          if (v.moves.length > len) {
            len = v.moves.length;
            worst = k;
          }
        kept.delete(worst);
      }
    }
    return r.moves;
  };
  const base = baseOrder(m);
  const start = consider(base, Infinity);
  if (start) res.base = start;
  let cur = base;
  let curLen = start ? start.length : Infinity;
  for (const variant of [
    base.map((u) => ({ ...u, pinPlayer: false })),
    base.map((u) => ({ ...u, pinPlayer: false, pinAt: false })),
  ]) {
    if (res.tried >= o.variants || now() > deadline) break;
    const r = consider(variant, Infinity);
    if (r && r.length < curLen) {
      cur = variant;
      curLen = r.length;
    }
  }
  let stale = 0;
  // draws that do not apply (tiny plans) count too, so that the loop always ends
  for (
    let draws = 0;
    res.tried < o.variants && draws < 20 * o.variants && now() < deadline;
    draws++
  ) {
    let next = mutate(m, cur, rnd);
    if (next && rnd() < 0.3) next = mutate(m, next, rnd) ?? next;
    if (!next) continue;
    const r = consider(next, Math.max(curLen, worstKept()));
    if (r && r.length <= curLen) {
      if (r.length < curLen) stale = 0;
      cur = next;
      curLen = r.length;
    } else if (++stale >= 150 && kept.size) {
      const all = [...kept.values()];
      const v = all[Math.floor(rnd() * all.length)]!;
      cur = v.order;
      curLen = v.moves.length;
      stale = 0;
    }
  }
  res.kept = [...kept.values()].sort((a, b) => a.moves.length - b.moves.length);
  res.searches = rb.searches;
  return res;
}

// ---- whole exploration ----

export interface ExploreOptions extends RebuildOptions {
  /** total duration */
  timeoutMs: number;
  /** variants rebuilt at most per round (1,000,000 by default: the time limits first) */
  variants?: number;
  /** variants given to improve per round (3 by default) */
  improveTop?: number;
  /**
   * share of the duration spent screening in a round (0.3 by default); each improved variant
   * gets at most (1 − share) / improveTop of the duration
   */
  screenFraction?: number;
  seed?: number;
  /** windows of improve on one variant; `polish` by default */
  improve?: (level: LevelData, moves: Dir[], timeoutMs: number) => Dir[];
  log?: (line: string) => void;
}

export interface ExploreResult {
  initialLength: number;
  /** screening + improve rounds run */
  rounds: number;
  /** rebuild of the solution's own plan */
  baseLength?: number;
  tried: number;
  feasible: number;
  searches: number;
  /** shortest variant of the first round, before improve */
  bestScreened?: number;
  /** each variant given to improve: round, length before → after */
  improved: { round: number; before: number; after: number; ms: number }[];
  /** shortest solution seen (the input if nothing beats it) */
  moves: Dir[];
  ms: number;
}

/**
 * Windows of improve without its proof: reoptimize (75 % of the time), then spare keys and
 * windows again when a pickup was dropped. Never longer than the input.
 */
export function polish(
  level: LevelData,
  moves: Dir[],
  timeoutMs: number,
  maxMemoryMb?: number,
  now: () => number = () => performance.now(),
): Dir[] {
  const t0 = now();
  const left = (f: number) => Math.max(0, t0 + f * timeoutMs - now());
  const mem = maxMemoryMb !== undefined ? { maxMemoryMb } : {};
  let best = reoptimize(level, moves, { timeoutMs: left(0.75), now, ...mem }).moves;
  const sk = spareKeys(level, best, { timeoutMs: left(0.9), now, ...mem });
  best = sk.moves;
  if (sk.dropped > 0) best = reoptimize(level, best, { timeoutMs: left(1), now, ...mem }).moves;
  return best.length <= moves.length ? best : moves;
}

/**
 * Explores starting points around a winning solution, in rounds: screening of event-plan
 * variants of the current best solution, then improve windows on the shortest few. A round that
 * finds a shorter solution makes it the next round's starting point; otherwise the next round
 * draws other variants (another seed), never improving a variant twice. Returns the shortest
 * solution seen.
 */
export function exploreLevel(
  level: LevelData,
  solution: readonly Dir[],
  o: ExploreOptions,
): ExploreResult {
  const now = o.now ?? (() => performance.now());
  const t0 = now();
  const end = t0 + o.timeoutMs;
  const log = o.log ?? (() => {});
  const top = o.improveTop ?? 3;
  const screenShare = o.screenFraction ?? 0.3;
  const improve = o.improve ?? ((lv, mv, ms) => polish(lv, mv, ms, o.maxMemoryMb, now));
  const res: ExploreResult = {
    initialLength: solution.length,
    rounds: 0,
    tried: 0,
    feasible: 0,
    searches: 0,
    improved: [],
    moves: solution.slice(),
    ms: 0,
  };
  // variants already improved: never twice
  const done: Dir[][] = [];
  while (now() < end) {
    const round = ++res.rounds;
    const cur = res.moves;
    const m = segmentSolution(level, cur);
    const r0 = now();
    const sc = screenVariants(m, {
      ...o,
      variants: o.variants ?? 1_000_000,
      // later rounds keep the same share of what is left for improve
      timeoutMs: Math.min(o.timeoutMs, end - r0) * screenShare,
      keep: top,
      seed: (o.seed ?? 1) + round - 1,
      exclude: [cur, ...done],
      now,
    });
    res.tried += sc.tried;
    res.feasible += sc.feasible;
    res.searches += sc.searches;
    if (round === 1) {
      if (sc.base) res.baseLength = sc.base.length;
      if (sc.kept.length) res.bestScreened = sc.kept[0]!.moves.length;
    }
    log(
      `round ${round} from ${cur.length} moves: ${m.segments.length} events, ${sc.tried} variants (${sc.feasible} feasible, ${sc.searches} stage searches) in ${((now() - r0) / 1000).toFixed(1)} s; plan rebuilt ${sc.base?.length ?? 'failed'}, kept ${sc.kept.map((v) => v.moves.length).join(' ') || 'none'}`,
    );
    if (!sc.kept.length) break;
    // a variant shorter than the best wins as it is (rebuilt and replayed), even unimproved
    if (sc.kept[0]!.moves.length < res.moves.length) res.moves = sc.kept[0]!.moves;
    const cap = (o.timeoutMs * (1 - screenShare)) / top;
    for (let i = 0; i < sc.kept.length; i++) {
      const v = sc.kept[i]!;
      const left = end - now();
      if (left <= 0) break;
      const t1 = now();
      const out = improve(level, v.moves, Math.min(cap, left / (sc.kept.length - i)));
      const ms = now() - t1;
      done.push(v.moves);
      res.improved.push({ round, before: v.moves.length, after: out.length, ms });
      log(
        `round ${round}, variant ${i + 1}: ${v.moves.length} → ${out.length} moves (${(ms / 1000).toFixed(1)} s): ${v.order.map((u) => unitText(m, u)).join(' | ')}`,
      );
      if (out.length < res.moves.length && replay(level, out).status === 'won') res.moves = out;
    }
  }
  res.ms = now() - t0;
  return res;
}
