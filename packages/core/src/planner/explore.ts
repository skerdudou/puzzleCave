// "Explore starting points": the improve pipeline only replaces windows of a solution by shorter
// paths to the same state, so it never changes the order of the events. This module cuts a
// winning solution into its events (one unit per key taken, water filled, door opened, exit),
// generates variants of that event plan (stages reordered, merged, split or dropped, end pins
// dropped, an extra water filled with a block the solution never pushes) and rebuilds each
// variant with the exact per-stage searches of `runStages` (restricted Dijkstra, everything not
// allowed is a wall). The rebuilds are cheap: a local search ranks hundreds of variants by
// length, then the windows of `improve` run on the few best ones and the shortest result is kept.
// A systematic structural pass comes first in each round: every stage dropped in turn, then
// windows of up to 6 consecutive stages merged into one wide search (all their blocks free, plus
// a few neighbours, every water allowed, door goals optional), first improvement kept.
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
  /**
   * wide merge of a window of stages (structural pass): every water may be filled, these extra
   * blocks (identities) are free as well, the door goals are only allowed (not required) with
   * doorsOptional, and the search has the merge limits (times scale, 1 by default)
   */
  wide?: { blocks: number[]; doorsOptional: boolean; scale?: number };
}

export interface ExploreModel {
  level: LevelData;
  segments: Segment[];
  /** start cell of each block identity */
  blockStart: number[];
  /** (water, block) pairs for extra fills: waters left unfilled, blocks never pushed, nearby */
  extras: { water: number; block: number }[];
  /** cell of each block identity at the start of each segment (−1: sank) */
  cellsBefore: number[][];
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
  const cellsBefore: number[][] = [];
  const snapshot = () => {
    const cells = blockStart.map(() => -1);
    for (const [c, id] of idAt) cells[id] = c;
    return cells;
  };
  cellsBefore.push(snapshot());
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
    cellsBefore.push(snapshot());
    seg = newSegment();
    moved = new Set();
  }
  if (s.status !== 'won') throw new Error('the solution does not win');
  cellsBefore.length = segments.length;
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
  return { level, segments, blockStart, extras, cellsBefore };
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
  u.extra
    ? [u.extra.block]
    : [...new Set([...u.segs.flatMap((i) => m.segments[i]!.ids), ...(u.wide?.blocks ?? [])])];

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
  const wide = u.wide
    ? ` [wide${u.wide.blocks.length ? ` +${u.wide.blocks.map((id) => cell(m.blockStart[id]!)).join(' ')}` : ''}${u.wide.doorsOptional ? ' doors optional' : ''}${u.wide.scale !== undefined && u.wide.scale < 1 ? ` limits ×${u.wide.scale}` : ''}]`
    : '';
  return parts.join(' + ') + pins + wide;
}

const unitSig = (u: Unit) =>
  u.extra
    ? `x${u.extra.water}:${u.extra.block}`
    : `${u.segs.join('.')}${u.pinPlayer ? 'p' : ''}${u.pinAt ? 'a' : ''}${u.wide ? `w${u.wide.blocks.join('.')}${u.wide.doorsOptional ? 'o' : ''}s${u.wide.scale ?? 1}` : ''}`;

export interface RebuildOptions {
  /** macro-states per stage (200,000 by default) */
  maxStates?: number;
  /**
   * in the rebuilds that ask for it (the plan as is, the structural pass), a stage stopped by
   * its macro-state cap or its time limit is searched again with 4× the cap and the time, up to
   * this many macro-states (3,200,000 by default; not above maxStates: no retry)
   */
  maxStatesLimit?: number;
  /** wall-clock limit per stage (10 s by default) */
  stageTimeoutMs?: number;
  /** memory budget of each stage search, MB (256 by default) */
  maxMemoryMb?: number;
  /** memory budget of the retried and the wide merged searches, MB (1,024 by default) */
  largeMemoryMb?: number;
  /** macro-states of a wide merged stage (2,000,000 by default) */
  mergeStates?: number;
  /** wall-clock limit of a wide merged stage (60 s by default) */
  mergeTimeoutMs?: number;
  now?: () => number;
  /**
   * polled between stages and during each search (through its clock): once true, the rebuild
   * stops with `failed: 'cancelled'` and nothing it was computing goes into the memo
   */
  cancelled?: () => boolean;
}

interface StepResult {
  ok: boolean;
  moves: Dir[];
  /** encoded end state */
  end?: Uint32Array;
  /** cells of the unit's blocks at the end (−1: sank) */
  after?: number[];
  /** failed on a cap that a retry may raise */
  retry?: boolean;
}

/**
 * Rebuilds variants of one solution's event plan, with a memo of every stage search (keyed by
 * start state, stage and block cells): variants share most of their stages.
 */
export class Rebuilder {
  readonly model: CompactModel;
  private memo = new Map<string, StepResult>();
  searches = 0;
  /** stage searches run again with a larger cap */
  retries = 0;

  constructor(
    readonly m: ExploreModel,
    private opts: RebuildOptions = {},
  ) {
    this.model = new CompactModel(m.level);
  }

  /**
   * moves of the variant, or why it fails; `bound`: give up once longer; `retry`: a stage
   * stopped by a cap is searched again with larger caps (maxStatesLimit)
   */
  rebuild(order: Unit[], bound = Infinity, retry = false): { moves: Dir[] } | { failed: string } {
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
      if (!r || (retry && r.retry)) {
        if (this.opts.cancelled?.()) return { failed: 'cancelled' };
        r = this.runUnit(s, u, ids, cells, retry);
        // a search cut short by a cancellation is not a result: never memoised
        if (this.opts.cancelled?.()) return { failed: 'cancelled' };
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

  private runUnit(
    s: GameState,
    u: Unit,
    ids: number[],
    cells: number[],
    retry: boolean,
  ): StepResult {
    const { m, opts } = this;
    const width = m.level.width;
    const st: Stage = emptyStage();
    const doors: number[] = [];
    if (u.extra) st.waters.push(u.extra.water);
    else
      for (const i of u.segs) {
        const g = m.segments[i]!;
        st.keys.push(...g.keys);
        st.waters.push(...g.waters);
        doors.push(...g.doors);
        if (!u.wide?.doorsOptional) st.doors.push(...g.doors);
        st.exit ||= g.exit;
      }
    st.blocks = cells;
    if (!st.exit && !u.extra) {
      const last = Math.max(...u.segs);
      if (u.pinPlayer) st.player.push(m.segments[last]!.endPlayer);
      if (u.pinAt)
        for (const id of ids) {
          // cell after the last segment of the unit that pushes this block (none: a neighbour
          // of a wide merge, not pinned)
          const seg = [...u.segs]
            .sort((a, b) => b - a)
            .find((i) => m.segments[i]!.ids.includes(id));
          const c = seg === undefined ? undefined : m.segments[seg]!.endAt.get(id);
          if (c !== undefined) st.at.push(c);
        }
    }
    const goal = stageGoal(st, s);
    let moves: Dir[] = [];
    if (st.exit || !goal(loaded(this.model, s))) {
      const scale = u.wide?.scale ?? 1;
      const baseCap = u.wide
        ? Math.max(1, Math.floor((opts.mergeStates ?? 2_000_000) * scale))
        : (opts.maxStates ?? 200_000);
      const baseTime = u.wide
        ? (opts.mergeTimeoutMs ?? 60_000) * scale
        : (opts.stageTimeoutMs ?? 10_000);
      const limit = u.wide ? baseCap : Math.max(baseCap, opts.maxStatesLimit ?? 3_200_000);
      // a cancellation stops the search through its clock (checked every 256 pops)
      const cancelled = opts.cancelled;
      const clock = opts.now ?? (() => performance.now());
      const now = cancelled ? () => (cancelled() ? Infinity : clock()) : opts.now;
      let cap = baseCap;
      for (;;) {
        if (cancelled?.()) return { ok: false, moves: [] };
        this.searches++;
        const large = u.wide || cap > baseCap;
        const mem = large ? (opts.largeMemoryMb ?? 1024) : opts.maxMemoryMb;
        const r = reachSubgoal(
          s,
          { free: st.blocks, doors, waters: u.wide ? 'all' : st.waters },
          goal,
          {
            maxStates: cap,
            win: st.exit,
            timeoutMs: (baseTime * cap) / baseCap,
            ...(mem !== undefined ? { maxMemoryMb: mem } : {}),
            ...(now ? { now } : {}),
          },
        );
        if (r.ok) {
          moves = r.moves;
          break;
        }
        const capped = r.full || r.timedOut;
        if (!capped || cap >= limit) return { ok: false, moves: [] };
        if (!retry) return { ok: false, moves: [], retry: true };
        cap = Math.min(cap * 4, limit);
        this.retries++;
      }
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
  | 'moveChain'
  | 'reverse'
  | 'blockSwap'
  | 'merge'
  | 'split'
  | 'pinPlayer'
  | 'pinAt'
  | 'addWater'
  | 'dropWater'
  | 'drop'
  | 'restore';

const KINDS: MutationKind[] = [
  'swap',
  'swap',
  'move',
  'move',
  'moveChain',
  'reverse',
  'blockSwap',
  'merge',
  'split',
  'pinPlayer',
  'pinAt',
  'addWater',
  'dropWater',
  'drop',
  'restore',
];

/**
 * A random neighbour of the plan (null if the drawn mutation does not apply). The exit unit
 * stays last; merged units hold at most 4 blocks. A unit may be dropped (its events are then
 * not required: a useless fill, a door or key the rest does without) and restored later.
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
  if (n < 2 && !['pinPlayer', 'pinAt', 'addWater', 'drop', 'restore'].includes(kind)) return null;
  switch (kind) {
    case 'swap': {
      const i = int(n - 1);
      [o[i], o[i + 1]] = [o[i + 1]!, o[i]!];
      return o;
    }
    case 'move': {
      // mostly short moves (up to 8 places), else anywhere in the plan
      const i = int(n);
      const j =
        rnd() < 0.6
          ? Math.max(0, Math.min(n - 1, i + (1 + int(8)) * (rnd() < 0.5 ? -1 : 1)))
          : int(n);
      if (j === i) return null;
      const [u] = o.splice(i, 1);
      o.splice(j, 0, u!);
      return o;
    }
    case 'moveChain': {
      // a chain of 2 to 6 consecutive units moved anywhere
      const len = 2 + int(Math.min(5, n - 2));
      if (len >= n) return null;
      const i = int(n - len + 1);
      const chain = o.splice(i, len);
      const j = int(n - len + 1);
      if (j === i) return null;
      o.splice(j, 0, ...chain);
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
      if (n < 1) return null;
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
    case 'drop': {
      // any stage of the plan but the exit (extras: dropWater)
      if (n < 1) return null;
      const i = int(n);
      if (o[i]!.extra) return null;
      o.splice(i, 1);
      return o;
    }
    case 'restore': {
      // a dropped segment back, as its own unit, at its original rank or anywhere
      const present = new Set(o.flatMap((u) => u.segs));
      const missing = m.segments.map((_, i) => i).filter((i) => !present.has(i));
      if (!missing.length) return null;
      const seg = missing[int(missing.length)]!;
      let at = o.findIndex((u) => u.segs.length > 0 && Math.min(...u.segs) > seg);
      if (at < 0 || at > n || rnd() < 0.3) at = int(n + 1);
      o.splice(at, 0, { segs: [seg], pinPlayer: true, pinAt: true });
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
  /** rebuilder of the model to reuse (its memo), e.g. the structural pass's */
  rebuilder?: Rebuilder;
}

export interface ScreenResult {
  /** rebuild of the original plan (fails if a stage limit is hit, even after retries) */
  base?: Dir[];
  /** shortest distinct variants, shortest first */
  kept: Variant[];
  tried: number;
  feasible: number;
  searches: number;
  retries: number;
}

/**
 * Local search over event plans from the solution's own plan: each step draws a random
 * mutation (one or two), rebuilds it, and moves there when it is not longer; after 150 steps
 * without progress it restarts from a random kept variant. The first variants are the plan
 * itself (with stage retries on a cap) and the plan with all player pins, then all pins, dropped.
 */
export function screenVariants(m: ExploreModel, o: ScreenOptions): ScreenResult {
  const now = o.now ?? (() => performance.now());
  const deadline = now() + o.timeoutMs;
  const rnd = prng(o.seed ?? 1);
  const rb = o.rebuilder ?? new Rebuilder(m, o);
  const searches0 = rb.searches;
  const retries0 = rb.retries;
  const exclude = new Set((o.exclude ?? []).map((v) => v.join('')));
  const kept = new Map<string, Variant>();
  const res: ScreenResult = { kept: [], tried: 0, feasible: 0, searches: 0, retries: 0 };
  const worstKept = () =>
    kept.size < o.keep ? Infinity : Math.max(...[...kept.values()].map((v) => v.moves.length));
  const consider = (order: Unit[], bound: number, retry = false): Dir[] | undefined => {
    res.tried++;
    const r = rb.rebuild(order, bound, retry);
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
  const start = consider(base, Infinity, true);
  if (start) res.base = start;
  let cur = base;
  let curLen = start ? start.length : Infinity;
  for (const variant of [
    base.map((u) => ({ ...u, pinPlayer: false })),
    base.map((u) => ({ ...u, pinPlayer: false, pinAt: false })),
  ]) {
    if (res.tried >= o.variants || now() > deadline) break;
    const r = consider(variant, Infinity, true);
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
  res.searches = rb.searches - searches0;
  res.retries = rb.retries - retries0;
  return res;
}

// ---- structural pass: every stage dropped, windows of stages merged into wide searches ----

export interface PassOptions extends RebuildOptions {
  /** wall-clock limit of the pass */
  timeoutMs: number;
  /** largest window of consecutive stages merged into one wide search (6 by default; < 2: none) */
  window?: number;
  /**
   * blocks freed besides those of a merged window: the closest ones (≤ 4 cells from its goals
   * and blocks) it does not move (2 by default; 0: none)
   */
  neighbours?: number;
  /**
   * when every candidate failed, the pass widens again up to this many times (5 by default):
   * level i merges windows up to window + 2i stages with neighbours + 4i neighbour blocks taken
   * up to 4 + 2i cells away, with min(1, 2^(i − 2)) of the merge limits (a quick first sweep)
   */
  widen?: number;
  /** candidate plans already rebuilt (by their text), skipped; the pass adds its own */
  tried?: Set<string>;
  /** rebuilds the candidates (in this thread, one at a time, by default: inlineRunner) */
  runner?: CandidateRunner;
  log?: (line: string) => void;
}

/** a rebuilt candidate: its moves, or why it failed ('cancelled': stopped before its end) */
export type CandidateOutcome = { moves: Dir[] } | { failed: string };

/**
 * Rebuilds the candidates of the structural pass, possibly several at once (worker threads in
 * @puzzlecave/tools). Each candidate is an independent rebuild, with stage retries, of a plan of
 * the solution given to the last `reset`.
 */
export interface CandidateRunner {
  /** candidates rebuilt at once */
  readonly width: number;
  /** the next candidates are plans of this solution (segmentSolution of it) */
  reset(solution: readonly Dir[]): void;
  /** rebuilds a plan, giving up once longer than bound; cancel: stop it as soon as possible */
  run(order: Unit[], bound: number): { result: Promise<CandidateOutcome>; cancel: () => void };
  /** stage searches and retries so far (all candidates) */
  stats(): { searches: number; retries: number };
  /** in-thread runner: its rebuilder of the current solution (its memo is reused) */
  rebuilder?(): Rebuilder | undefined;
}

/** the sequential runner: one Rebuilder in this thread, one candidate at a time */
export function inlineRunner(level: LevelData, o: RebuildOptions = {}): CandidateRunner {
  let rb: Rebuilder | undefined;
  let searches = 0;
  let retries = 0;
  return {
    width: 1,
    reset(solution) {
      searches += rb?.searches ?? 0;
      retries += rb?.retries ?? 0;
      rb = new Rebuilder(segmentSolution(level, solution), o);
    },
    run(order, bound) {
      if (!rb) throw new Error('inlineRunner: reset first');
      return { result: Promise.resolve(rb.rebuild(order, bound, true)), cancel: () => {} };
    },
    stats: () => ({
      searches: searches + (rb?.searches ?? 0),
      retries: retries + (rb?.retries ?? 0),
    }),
    rebuilder: () => rb,
  };
}

export interface PassResult {
  /** the shortest solution found (the input if nothing beats it) */
  moves: Dir[];
  /** each candidate that shortened the solution, in order */
  gains: { what: string; before: number; after: number }[];
  /** candidates rebuilt */
  tried: number;
  /** every candidate of the last solution has been tried */
  exhausted: boolean;
  searches: number;
  retries: number;
  /** model and rebuilder of the returned solution (to reuse their memo) */
  model: ExploreModel;
  rebuilder: Rebuilder;
}

interface Candidate {
  what: string;
  order: Unit[];
}

/** blocks alive at the start of the window, not moved in it, closest to its goals and blocks */
function neighbourBlocks(m: ExploreModel, segs: number[], count: number, reach: number): number[] {
  if (count <= 0) return [];
  const w = m.level.width;
  const cells = m.cellsBefore[segs[0]!]!;
  const inside = new Set(segs.flatMap((i) => m.segments[i]!.ids));
  const targets = [
    ...segs.flatMap((i) => {
      const g = m.segments[i]!;
      return [...g.keys, ...g.waters, ...g.doors];
    }),
    ...[...inside].map((id) => cells[id]!).filter((c) => c >= 0),
  ];
  if (!targets.length) return [];
  return cells
    .map((c, id) => ({ id, c }))
    .filter((e) => e.c >= 0 && !inside.has(e.id))
    .map((e) => ({ id: e.id, d: Math.min(...targets.map((t) => manhattan(e.c, t, w))) }))
    .filter((e) => e.d <= reach)
    .sort((a, b) => a.d - b.d || a.id - b.id)
    .slice(0, count)
    .map((e) => e.id);
}

/**
 * Candidate plans of the structural pass, from the end of the plan backwards (a change late in
 * the plan only rebuilds a short suffix): at each stage, the stage dropped, the stages from
 * there to the exit merged with it (when at most `window`, door goals optional, without and
 * with neighbour blocks), then every window of 2…window stages starting there merged (pinned
 * end, free end, free end with optional doors, free end with neighbour blocks).
 */
function* passCandidates(
  m: ExploreModel,
  window: number,
  neighbours: number,
  reach = 4,
  scale = 1,
): Generator<Candidate> {
  const base = baseOrder(m);
  const n = base.length;
  const text = (u: Unit) => unitText(m, u);
  const merged = (from: number, k: number, pinned: boolean, wide: Unit['wide']): Unit => ({
    segs: base.slice(from, from + k).flatMap((u) => u.segs),
    pinPlayer: pinned,
    pinAt: pinned,
    ...(wide ? { wide } : {}),
  });
  const splice = (from: number, k: number, u: Unit) => [
    ...base.slice(0, from),
    u,
    ...base.slice(from + k),
  ];
  for (let from = n - 2; from >= 0; from--) {
    yield {
      what: `drop ${text(base[from]!)}`,
      order: [...base.slice(0, from), ...base.slice(from + 1)],
    };
    const toExit = n - from;
    if (toExit <= window) {
      const segs = base.slice(from).flatMap((u) => u.segs);
      const nb = neighbourBlocks(m, segs, neighbours, reach);
      for (const blocks of nb.length ? [[], nb] : [[]]) {
        const u = merged(from, toExit, false, { blocks, doorsOptional: true, scale });
        yield { what: `merge ${text(u)}`, order: splice(from, toExit, u) };
      }
    }
    for (let k = 2; k <= window && from + k <= n - 1; k++) {
      const segs = base.slice(from, from + k).flatMap((u) => u.segs);
      const hasDoors = segs.some((i) => m.segments[i]!.doors.length > 0);
      const nb = neighbourBlocks(m, segs, neighbours, reach);
      const units: Unit[] = [
        merged(from, k, true, { blocks: [], doorsOptional: false, scale }),
        merged(from, k, false, { blocks: [], doorsOptional: false, scale }),
        ...(hasDoors ? [merged(from, k, false, { blocks: [], doorsOptional: true, scale })] : []),
        ...(nb.length
          ? [merged(from, k, false, { blocks: nb, doorsOptional: hasDoors, scale })]
          : []),
      ];
      for (const u of units) yield { what: `merge ${text(u)}`, order: splice(from, k, u) };
    }
  }
}

/**
 * Systematic structural changes of the solution's own plan, first improvement: each candidate
 * (passCandidates) is rebuilt with stage retries and kept when shorter; the pass then starts
 * again from the new solution (candidates already tried are skipped), until every candidate
 * failed or the time is up.
 *
 * With a runner wider than 1, up to `width` candidates are rebuilt at once, in the order of the
 * sequence, and their results are committed in that order: the gain kept is the one of the
 * lowest candidate index, as in the sequential pass, whatever the width. A gain cancels the
 * candidates after it (their results could not be kept); those before it still run to their end
 * and win if they improve too. Only committed candidates join `tried`, so the set is the one of
 * the sequential pass. At the deadline no new candidate starts and those under way finish (as
 * the sequential pass finishes its current candidate). Search time limits stay the only source
 * of differences with the sequential pass (a search slowed down by the other threads may stop
 * where it would have finished).
 */
export async function structuralPass(
  level: LevelData,
  solution: readonly Dir[],
  o: PassOptions,
): Promise<PassResult> {
  const now = o.now ?? (() => performance.now());
  const t0 = now();
  const deadline = t0 + o.timeoutMs;
  const tried = o.tried ?? new Set<string>();
  const log = o.log ?? (() => {});
  const runner = o.runner ?? inlineRunner(level, o);
  const stats0 = runner.stats();
  let cur = solution.slice();
  let m = segmentSolution(level, cur);
  runner.reset(cur);
  const res = { gains: [] as PassResult['gains'], tried: 0, exhausted: false };
  const window = o.window ?? 6;
  const neighbours = o.neighbours ?? 2;
  const widen = o.widen ?? 5;
  let nextLog = now() + 60_000;
  for (;;) {
    const { better, timedOut } = await sweep();
    if (!better) {
      res.exhausted = !timedOut;
      break;
    }
    res.gains.push({ what: better.what, before: cur.length, after: better.moves.length });
    log(`pass: ${cur.length} → ${better.moves.length} moves: ${better.what}`);
    cur = better.moves;
    m = segmentSolution(level, cur);
    runner.reset(cur);
  }
  const stats = runner.stats();
  const rebuilder = runner.rebuilder?.() ?? new Rebuilder(m, o);
  return {
    ...res,
    moves: cur,
    searches: stats.searches - stats0.searches,
    retries: stats.retries - stats0.retries,
    model: rebuilder.m,
    rebuilder,
  };

  /** the candidates of the current solution, level after level, up to the first gain */
  async function sweep(): Promise<{ better?: { what: string; moves: Dir[] }; timedOut: boolean }> {
    // widening levels reached, logged once per level and solution (later rounds go through the
    // levels again); marked as the results are committed, as the sequential pass would
    let reached = 0;
    const reach = (lv: number) => {
      for (; reached < lv;) {
        const mark = `#level ${++reached} ${cur.join('')}`;
        if (tried.has(mark)) continue;
        tried.add(mark);
        log(`pass: widened to level ${reached} from ${cur.length} moves`);
      }
    };
    const sequence = (function* () {
      for (let lv = 0; lv <= widen; lv++) {
        for (const c of passCandidates(
          m,
          window + 2 * lv,
          neighbours + 4 * lv,
          4 + 2 * lv,
          // the first levels sweep with smaller search limits (¼, ½), the later ones with all
          Math.min(1, 2 ** (lv - 2)),
        ))
          yield { ...c, lv };
      }
    })();
    interface Job {
      index: number;
      key: string;
      what: string;
      lv: number;
      cancel: () => void;
      out?: CandidateOutcome;
    }
    const jobs: Job[] = [];
    const running = new Set<Job>();
    // keys started in this sweep (the same candidate comes back at later levels)
    const started = new Set<string>();
    const improves = (out: CandidateOutcome | undefined): out is { moves: Dir[] } =>
      out !== undefined && 'moves' in out && out.moves.length < cur.length;
    // lowest index of a finished candidate that improves
    let best = Infinity;
    let commit = 0;
    let ended = false;
    let timedOut = false;
    let better: { what: string; moves: Dir[] } | undefined;
    let wake = () => {};
    for (;;) {
      while (!ended && !timedOut && best === Infinity && running.size < runner.width) {
        if (now() > deadline) {
          timedOut = true;
          break;
        }
        const next = sequence.next();
        if (next.done) {
          ended = true;
          break;
        }
        const c = next.value;
        const key = c.order.map((u) => unitText(m, u)).join(' | ');
        if (tried.has(key) || started.has(key)) continue;
        started.add(key);
        const handle = runner.run(c.order, cur.length - 1);
        const job: Job = { index: jobs.length, key, what: c.what, lv: c.lv, cancel: handle.cancel };
        jobs.push(job);
        running.add(job);
        void handle.result
          .catch((err: unknown) => ({ failed: `error: ${String(err)}` }))
          .then((out) => {
            job.out = out;
            running.delete(job);
            if (improves(out) && job.index < best) {
              best = job.index;
              // the candidates after it can no longer be kept
              for (const j of running) if (j.index > best) j.cancel();
            }
            wake();
          });
      }
      // results in the order of the sequence
      while (!better && commit < jobs.length && jobs[commit]!.out) {
        const job = jobs[commit++]!;
        reach(job.lv);
        tried.add(job.key);
        res.tried++;
        if (now() > nextLog) {
          nextLog = now() + 60_000;
          log(
            `pass: ${res.tried} candidates in ${((now() - t0) / 1000).toFixed(0)} s, level ${job.lv}, at ${job.what}${runner.width > 1 ? ` (${running.size} under way)` : ''}`,
          );
        }
        if (improves(job.out)) better = { what: job.what, moves: job.out.moves };
      }
      if (!running.size && (better || ended || timedOut)) {
        // every level gone through without a gain
        if (!better && ended) reach(widen);
        break;
      }
      await new Promise<void>((resolve) => (wake = resolve));
    }
    return better ? { better, timedOut } : { timedOut };
  }
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
   * share of the duration spent screening in a round (0.3 by default, of what the structural
   * pass leaves); each improved variant gets at most (1 − share) / improveTop of the duration
   */
  screenFraction?: number;
  /** share of a round's duration given to the structural pass (0.3 by default; 0: no pass) */
  passFraction?: number;
  /** largest window of merged stages in the structural pass (6 by default) */
  window?: number;
  /** neighbour blocks freed in a merged window (2 by default) */
  neighbours?: number;
  /** widening levels of the structural pass (5 by default) */
  widen?: number;
  /** rebuilds the candidates of the structural pass (in this thread by default) */
  runner?: CandidateRunner;
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
  /** stage searches run again with a larger cap */
  retries: number;
  /** shortest variant of the first round, before improve */
  bestScreened?: number;
  /** gains of the structural pass: round, candidate, length before → after */
  passGains: { round: number; what: string; before: number; after: number }[];
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
 * Explores starting points around a winning solution, in rounds: the structural pass on the
 * current best solution (its result then gets improve's windows and spare keys), screening of
 * event-plan variants, then improve windows on the shortest few. A round that finds a shorter
 * solution makes it the next round's starting point; otherwise the next round draws other
 * variants (another seed), never improving a variant twice. Returns the shortest solution seen.
 */
export async function exploreLevel(
  level: LevelData,
  solution: readonly Dir[],
  o: ExploreOptions,
): Promise<ExploreResult> {
  const now = o.now ?? (() => performance.now());
  const t0 = now();
  const end = t0 + o.timeoutMs;
  const log = o.log ?? (() => {});
  const top = o.improveTop ?? 3;
  const screenShare = o.screenFraction ?? 0.3;
  const passShare = o.passFraction ?? 0.3;
  const improve = o.improve ?? ((lv, mv, ms) => polish(lv, mv, ms, o.maxMemoryMb, now));
  const res: ExploreResult = {
    initialLength: solution.length,
    rounds: 0,
    tried: 0,
    feasible: 0,
    searches: 0,
    retries: 0,
    passGains: [],
    improved: [],
    moves: solution.slice(),
    ms: 0,
  };
  // variants already improved: never twice
  const done: Dir[][] = [];
  // candidates of the structural pass already rebuilt
  const tried = new Set<string>();
  const cap = (o.timeoutMs * (1 - screenShare) * (1 - passShare)) / top;
  const accept = (moves: Dir[]) => {
    if (moves.length < res.moves.length && replay(level, moves).status === 'won') res.moves = moves;
  };
  while (now() < end) {
    const round = ++res.rounds;
    let reuse: { m: ExploreModel; rb: Rebuilder } | undefined;
    let passDone = true;
    if (passShare > 0) {
      const p0 = now();
      const ps = await structuralPass(level, res.moves, {
        ...o,
        timeoutMs: Math.min(o.timeoutMs, end - p0) * passShare,
        tried,
        log,
        now,
      });
      res.searches += ps.searches;
      res.retries += ps.retries;
      passDone = ps.exhausted;
      for (const g of ps.gains) res.passGains.push({ round, ...g });
      log(
        `round ${round} pass from ${res.moves.length} moves: ${ps.tried} candidates, ${ps.gains.length} gain(s) → ${ps.moves.length}${ps.exhausted ? ', all tried' : ''} in ${((now() - p0) / 1000).toFixed(1)} s`,
      );
      if (ps.moves.length < res.moves.length) {
        accept(ps.moves);
        // spare keys and windows on the merged solution (a door made useless frees a key)
        const left = end - now();
        if (left > 0) {
          const t1 = now();
          const out = improve(level, ps.moves, Math.min(cap, left));
          const ms = now() - t1;
          done.push(ps.moves);
          res.improved.push({ round, before: ps.moves.length, after: out.length, ms });
          log(
            `round ${round}, pass result: ${ps.moves.length} → ${out.length} moves (${(ms / 1000).toFixed(1)} s)`,
          );
          accept(out);
        }
      }
      if (res.moves === ps.moves) reuse = { m: ps.model, rb: ps.rebuilder };
    }
    if (now() >= end) break;
    const cur = res.moves;
    const m = reuse?.m ?? segmentSolution(level, cur);
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
      ...(reuse ? { rebuilder: reuse.rb } : {}),
    });
    res.tried += sc.tried;
    res.feasible += sc.feasible;
    res.searches += sc.searches;
    res.retries += sc.retries;
    if (round === 1) {
      if (sc.base) res.baseLength = sc.base.length;
      if (sc.kept.length) res.bestScreened = sc.kept[0]!.moves.length;
    }
    log(
      `round ${round} from ${cur.length} moves: ${m.segments.length} events, ${sc.tried} variants (${sc.feasible} feasible, ${sc.searches} stage searches, ${sc.retries} retried) in ${((now() - r0) / 1000).toFixed(1)} s; plan rebuilt ${sc.base?.length ?? 'failed'}, kept ${sc.kept.map((v) => v.moves.length).join(' ') || 'none'}`,
    );
    if (!sc.kept.length) {
      if (passDone) break;
      continue;
    }
    // a variant shorter than the best wins as it is (rebuilt and replayed), even unimproved
    accept(sc.kept[0]!.moves);
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
      accept(out);
    }
  }
  res.ms = now() - t0;
  return res;
}
