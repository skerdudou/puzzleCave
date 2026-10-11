// High level of the event planner: best-first search over sequences of events (take a key, open a
// door, fill a water, reach the exit), each realised by a small restricted Dijkstra (subgoal.ts)
// in which every block not explicitly unfrozen is a wall. Automates the "sub-goal" method that
// solved the hard levels by hand: resources are exact, so each event only moves the few blocks it
// needs and leaves the others where they are.
import { BLOCK, CompactModel, DOOR, KEY, WALL, WATER } from '../compactModel';
import { DeadlockAnalysis } from '../deadlock';
import { replay } from '../replay';
import { initialState } from '../state';
import type { Dir, GameState, LevelData } from '../types';
import { reachSubgoal, type Goal, type Restriction } from './subgoal';

export interface PlanOptions {
  timeoutMs: number;
  now?: () => number;
  /** macro-states of each restricted search (5,000) */
  maxSubStates?: number;
  /** blocks unfrozen to take a key, at most (3) */
  maxFree?: number;
  /** restricted searches tried per key or fill event (growing sets of unfrozen blocks) (60) */
  maxTries?: number;
  /** blocks unfrozen to fill a water, at most (1) */
  fillFree?: number;
  /** blocks unfrozen to reach the exit, at most (2), and restricted searches tried (20) */
  exitFree?: number;
  exitTries?: number;
  /** macro-states of all the restricted searches of one event attempt, at most (8,000) */
  attemptStates?: number;
  /**
   * realisations kept per event (1): other end states of the same event (different block
   * placements, other unfrozen sets), each a child event state
   */
  alternatives?: number;
  /**
   * widening levels (1): an event state whose expansion hit a cap is queued again one level
   * higher, behind the states of the same estimate and lower novelty; at level L every
   * free-block limit grows by L, the tries and macro-states (per search and per attempt) are
   * multiplied by 2^L, and from allDoorsLevel on every door may be opened
   */
  widen?: number;
  /**
   * skip the events a relaxed reachability test rules out (true): key not reachable with blocks
   * and fillable waters passable; water no block of the region can reach
   * (DeadlockAnalysis.canFill); exit behind water, or behind more doors than keys in pocket
   */
  prechecks?: boolean;
  /**
   * events may take the keys on their way (false by default: the other keys are walls, taking
   * a key is a key event; each key taken on the way multiplies the macro-states of the
   * restricted searches)
   */
  sideKeys?: boolean;
  /**
   * widening level from which every door next to the region may be opened (1); below it, only
   * the useful ones (on a route with the fewest doors, or with a key behind)
   */
  allDoorsLevel?: number;
  /**
   * 'explicit': taking a key is an event like the others; 'auto': after each event, every key
   * reachable without moving anything is taken at once (key closure: never worse for winning)
   */
  keys?: 'explicit' | 'auto';
  /** discard event states DeadlockAnalysis proves lost (true by default) */
  deadPruning?: boolean;
  /** progress lines */
  log?: (line: string) => void;
  /** start from this state instead of the level start (the plan then starts there) */
  start?: GameState;
  /** open list order: novelty first (BFWS, 'novelty') or estimate first ('h', default) */
  order?: 'h' | 'novelty';
}

export interface PlanStats {
  /** event states expanded / generated */
  expanded: number;
  generated: number;
  /** restricted searches and their macro-states */
  subSearches: number;
  subStates: number;
  /** event states found dead / already seen */
  dead: number;
  duplicates: number;
  /** event states queued again one widening level higher */
  widened: number;
  /** events skipped by the relaxed reachability prechecks */
  prechecked: number;
  /** per event kind: where the work goes and which cap stops it */
  kinds: Record<EventKind, KindStats>;
}

export type EventKind = 'exit' | 'key' | 'door' | 'fill' | 'move';

export interface KindStats {
  /** events attempted / realised */
  attempts: number;
  realised: number;
  /** restricted searches and their macro-states */
  searches: number;
  states: number;
  /** restricted searches stopped by maxSubStates */
  full: number;
  /** attempts abandoned with block sets still queued (maxTries reached) */
  triesCapped: number;
  /** attempts where a set of maxFree blocks had touched blocks that were not added */
  freeCapped: number;
}

const kindStats = (): KindStats => ({
  attempts: 0,
  realised: 0,
  searches: 0,
  states: 0,
  full: 0,
  triesCapped: 0,
  freeCapped: 0,
});

export type PlanResult =
  | ({ status: 'solved'; moves: Dir[]; events: string[] } & PlanStats)
  | ({ status: 'failed'; reason: 'exhausted' | 'timeout' } & PlanStats);

interface Node {
  state: GameState;
  parent: Node | undefined;
  segment: Dir[];
  event: string;
  cost: number;
}

/** limits of one expansion (they grow with the widening level) */
interface Caps {
  subStates: number;
  keyFree: number;
  fillFree: number;
  exitFree: number;
  tries: number;
  exitTries: number;
  attemptStates: number;
}

interface Realisation {
  moves: Dir[];
  state: GameState;
  free: number[];
}

const INF = 0x3fffffff;

export function planSolution(level: LevelData, opts: PlanOptions): PlanResult {
  const now = opts.now ?? (() => performance.now());
  const t0 = now();
  const capsAt = (lv: number): Caps => ({
    subStates: (opts.maxSubStates ?? 5_000) * 2 ** lv,
    keyFree: (opts.maxFree ?? 3) + lv,
    fillFree: (opts.fillFree ?? 1) + lv,
    exitFree: (opts.exitFree ?? 2) + lv,
    tries: (opts.maxTries ?? 60) * 2 ** lv,
    exitTries: (opts.exitTries ?? 20) * 2 ** lv,
    attemptStates: (opts.attemptStates ?? 8_000) * 2 ** lv,
  });
  const widen = opts.widen ?? 1;
  const alternatives = Math.max(1, opts.alternatives ?? 1);
  const prechecks = opts.prechecks !== false;
  /** keys taken on the way by events other than their own: all, or none (they are walls) */
  const sideKeys = opts.sideKeys === true;
  const side: Restriction = sideKeys ? {} : { keys: [] };
  const autoKeys = opts.keys === 'auto';
  const order = opts.order ?? 'h';
  const log = opts.log;
  const model = new CompactModel(level);
  const { n, nb, width } = model;
  const analysis = new DeadlockAnalysis(model);
  const dead = opts.deadPruning === false ? undefined : analysis;
  const stats: PlanStats = {
    expanded: 0,
    generated: 0,
    subSearches: 0,
    subStates: 0,
    dead: 0,
    duplicates: 0,
    widened: 0,
    prechecked: 0,
    kinds: {
      exit: kindStats(),
      key: kindStats(),
      door: kindStats(),
      fill: kindStats(),
      move: kindStats(),
    },
  };
  const name = (c: number) => `(${c % width},${Math.floor(c / width)})`;
  const doorCells: number[] = [];
  const keyCells: number[] = [];
  for (let f = 0; f < model.fixedCount; f++)
    (model.fixedIsKey[f] ? keyCells : doorCells).push(model.fixedCell[f]!);
  const waterCells: number[] = [];
  for (let c = 0; c < n; c++) if (model.base[c] === WATER) waterCells.push(c);
  const exitCells: number[] = [];
  for (let c = 0; c < n; c++) if (model.isExit[c]) exitCells.push(c);

  // --- restricted searches -------------------------------------------------------------------
  let caps = capsAt(0);
  /** a cap stopped something during the current expansion (the state is worth widening) */
  let capped = false;
  const sub = (kind: EventKind, s: GameState, r: Restriction, goal: Goal, win = false, alt = 1) => {
    stats.subSearches++;
    const res = reachSubgoal(s, r, goal, { maxStates: caps.subStates, win, alternatives: alt });
    stats.subStates += res.explored;
    const k = stats.kinds[kind];
    k.searches++;
    k.states += res.explored;
    if (!res.ok && res.full) {
      k.full++;
      capped = true;
    }
    return res;
  };
  /**
   * Event realised with the smallest set of unfrozen blocks: starts with none, then adds, one at
   * a time, the frozen blocks the player could push during a failed search. Sets are tried by
   * size, then by distance of their blocks to the target cells (closest first). With
   * alternatives, the first successful set also gives other end states, then the other sets of
   * the same size are tried (within the tries) until enough distinct end states are found.
   */
  const withUnfreeze = (
    kind: EventKind,
    s: GameState,
    base: Restriction,
    goal: Goal,
    targets: number[],
    win: boolean,
    limitFree: number,
    limitTries: number,
    /** blocks to start from, one per set, instead of the empty set (needs at least one) */
    start?: number[],
  ): Realisation[] => {
    const ks = stats.kinds[kind];
    ks.attempts++;
    const want = win ? 1 : alternatives;
    let freeCapped = false;
    const far = (c: number) => {
      let best = INF;
      for (const t of targets)
        best = Math.min(
          best,
          Math.abs((c % width) - (t % width)) +
            Math.abs(Math.floor(c / width) - Math.floor(t / width)),
        );
      return best;
    };
    const out: Realisation[] = [];
    const boards = new Set<string>();
    const keep = (moves: Dir[], state: GameState, free: number[]) => {
      const b = state.objects.join() + state.terrain.join() + state.keys;
      if (boards.has(b)) return;
      boards.add(b);
      out.push({ moves, state, free });
    };
    let solvedSize = -1;
    const seen = new Set<string>(['']);
    // starting sets: the empty one, or the candidate blocks one by one (closest first)
    const queue: { free: number[]; score: number }[] = start
      ? start.map((b) => ({ free: [b], score: far(b) }))
      : [{ free: [], score: 0 }];
    for (const q of queue) seen.add(q.free.join(','));
    let tries = 0;
    // macro-states of all the searches of this attempt
    let spent = 0;
    const budget = caps.attemptStates;
    for (; queue.length > 0 && tries < limitTries && spent < budget; tries++) {
      let bi = 0;
      for (let i = 1; i < queue.length; i++) {
        const a = queue[i]!;
        const b = queue[bi]!;
        if (a.free.length < b.free.length || (a.free.length === b.free.length && a.score < b.score))
          bi = i;
      }
      const { free, score } = queue.splice(bi, 1)[0]!;
      if (solvedSize >= 0 && free.length > solvedSize) break;
      const res = sub(kind, s, { ...base, free }, goal, win, want - out.length);
      spent += res.explored;
      if (res.ok) {
        keep(res.moves, res.state, free);
        for (const m of res.more ?? []) keep(m.moves, m.state, free);
        if (out.length >= want) break;
        solvedSize = free.length;
        continue;
      }
      if (free.length >= limitFree) {
        if (res.touched.length > 0) freeCapped = true;
        continue;
      }
      for (const t of res.touched) {
        const f = [...free, t].sort((a, b) => a - b);
        const k = f.join(',');
        if (seen.has(k)) continue;
        seen.add(k);
        queue.push({ free: f, score: score + far(t) });
      }
    }
    if (out.length > 0) {
      ks.realised++;
      return out;
    }
    if (queue.length > 0 && (tries >= limitTries || spent >= budget)) {
      ks.triesCapped++;
      capped = true;
    }
    if (freeCapped) {
      ks.freeCapped++;
      capped = true;
    }
    return out;
  };

  // --- event-state evaluation ----------------------------------------------------------------
  const load = (s: GameState) => {
    model.load(model.encode(s));
  };
  /** player region of the loaded state (cells walkable without interaction) */
  const region = (): number[] => {
    const k = model.explore();
    return Array.from(model.order.subarray(0, k));
  };
  /** 0-1 distances from the player (entering a water costs wc, a door dc), movable blocks free */
  const deque = new Int32Array(2 * n + 2);
  const bfs01 = (dist: Int32Array, wc: number, dc: number, fromExits = false): void => {
    const { grid } = model;
    dist.fill(INF);
    let head = n;
    let tail = n;
    for (const c of fromExits ? exitCells : [model.player]) {
      dist[c] = 0;
      deque[tail++] = c;
    }
    while (head < tail) {
      const c = deque[head++]!;
      if (model.isExit[c] && !fromExits) continue;
      for (let d = 0; d < 4; d++) {
        const m = nb[c * 4 + d]!;
        if (m < 0) continue;
        const g = grid[m]!;
        if (g === WALL || (g === BLOCK && analysis.immovable[m])) continue;
        const w = g === WATER ? wc : g === DOOR ? dc : 0;
        const nd = dist[c]! + w;
        if (nd >= dist[m]!) continue;
        dist[m] = nd;
        if (w === 0) deque[--head] = m;
        else deque[tail++] = m;
      }
    }
  };
  const distWater = new Int32Array(n);
  const distDoor = new Int32Array(n);
  const distBoth = new Int32Array(n);
  const distDoorExit = new Int32Array(n);
  const minExit = (dist: Int32Array) => {
    let best = INF;
    for (const e of exitCells) best = Math.min(best, dist[e]!);
    return best;
  };
  /**
   * Remaining effort (guide only): waters on the cheapest route to an exit, plus the keys still to
   * collect (doors on the route with fewest doors, minus the pocket), each counted with the waters
   * and doors on the way to it (the cheapest keys).
   */
  const estimate = (): number => {
    bfs01(distWater, 1, 0);
    bfs01(distDoor, 0, 1);
    const wExit = minExit(distWater);
    const dExit = minExit(distDoor);
    if (wExit >= INF || dExit >= INF) return INF;
    const need = Math.max(0, dExit - model.keys);
    if (need === 0) return wExit;
    bfs01(distBoth, 1, 1);
    const costs: number[] = [];
    for (const k of keyCells)
      if (model.grid[k] === KEY && distBoth[k]! < INF) costs.push(distBoth[k]!);
    if (costs.length < need) return INF;
    costs.sort((a, b) => a - b);
    let h = wExit + need;
    for (let i = 0; i < need; i++) h += costs[i]!;
    return h;
  };

  // novelty (BFWS) per estimate: atoms = region cells, filled waters, consumed keys/doors, pocket
  const atomCount = 2 * n + model.fixedCount + 17;
  const seen1 = new Map<number, Uint8Array>();
  const seen2 = new Map<number, Uint8Array>();
  const atomsOf = (cells: number[]): number[] => {
    const { grid } = model;
    const atoms = cells.slice();
    for (const w of waterCells) if (grid[w] !== WATER) atoms.push(n + w);
    for (let f = 0; f < model.fixedCount; f++) {
      const g = grid[model.fixedCell[f]!];
      if (g !== KEY && g !== DOOR) atoms.push(2 * n + f);
    }
    atoms.push(2 * n + model.fixedCount + Math.max(0, Math.min(16, model.keys)));
    return atoms;
  };
  const novelty = (atoms: number[], h: number): number => {
    let one = seen1.get(h);
    let two = seen2.get(h);
    if (!one || !two) {
      seen1.set(h, (one = new Uint8Array(atomCount)));
      seen2.set(h, (two = new Uint8Array(Math.ceil((atomCount * atomCount) / 8))));
    }
    let w = 3;
    for (const a of atoms)
      if (!one[a]) {
        one[a] = 1;
        w = 1;
      }
    for (let i = 0; i < atoms.length; i++)
      for (let j = i + 1; j < atoms.length; j++) {
        const p = atoms[i]! * atomCount + atoms[j]!;
        if (two[p >> 3]! & (1 << (p & 7))) continue;
        two[p >> 3]! |= 1 << (p & 7);
        if (w > 2) w = 2;
      }
    return w;
  };

  const visited = new Set<string>();
  const signature = (cells: number[]): string => {
    const key = model.cur.slice();
    let rep = INF;
    for (const c of cells) if (c < rep) rep = c;
    key[0] = ((key[0]! & 0xffff0000) | rep) >>> 0;
    return key.join(',');
  };

  // open list (small: a sorted insertion is enough); level: widening level of the expansion.
  // Order: estimate then novelty (or the reverse), the widening level adding to the second key
  // (a widened state competes with the states of lower novelty), then level, then moves
  const open: { prio: number[]; node: Node; level: number; h: number; w: number }[] = [];
  const insert = (h: number, w: number, node: Node, lv: number) => {
    const prio = order === 'h' ? [h, w + lv, lv, node.cost] : [w, h + lv, lv, node.cost];
    let i = open.length;
    while (i > 0 && less(prio, open[i - 1]!.prio)) i--;
    open.splice(i, 0, { prio, node, level: lv, h, w });
  };
  const push = (node: Node): void => {
    stats.generated++;
    load(node.state);
    if (dead?.dead()) {
      stats.dead++;
      return;
    }
    const cells = region();
    const sig = signature(cells);
    if (visited.has(sig)) {
      stats.duplicates++;
      return;
    }
    visited.add(sig);
    const h = estimate();
    if (h >= INF) {
      stats.dead++;
      return;
    }
    const w = novelty(atomsOf(cells), h);
    insert(h, w, node, 0);
  };
  const less = (a: number[], b: number[]) => {
    for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return a[i]! < b[i]!;
    return false;
  };
  const child = (parent: Node, segment: Dir[], state: GameState, event: string): Node => ({
    state,
    parent,
    segment,
    event,
    cost: parent.cost + segment.length,
  });

  /** key closure: every key reachable without moving anything is taken */
  const closeKeys = (node: Node): Node => {
    let cur = node;
    for (let changed = true; changed;) {
      changed = false;
      for (const k of keyCells) {
        if (cur.state.objects[k] !== 'key') continue;
        const r = sub('key', cur.state, {}, (m) => m.grid[k] !== KEY);
        if (!r.ok) continue;
        cur = child(cur, r.moves, r.state, `auto key ${name(k)}`);
        changed = true;
      }
    }
    return cur;
  };

  const path = (node: Node) => {
    const chain: Node[] = [];
    for (let x: Node | undefined = node; x; x = x.parent) chain.push(x);
    chain.reverse();
    return {
      moves: chain.flatMap((x) => x.segment),
      events: chain.slice(1).map((x) => `${x.event} [${x.segment.length}]`),
    };
  };

  /**
   * relaxed player region of the loaded state (prechecks): blocks passable, doors walls (or
   * passable), the waters of `watersPass` passable, the others walls, exits not entered (an
   * over-approximation of the restricted searches allowing those waters and doors)
   */
  const relaxed = new Uint8Array(n);
  const relaxedQueue = new Int32Array(n);
  const relaxedRegion = (watersPass: Uint8Array | null, doorsPass = false): Uint8Array => {
    const { grid } = model;
    relaxed.fill(0);
    let tail = 0;
    relaxed[model.player] = 1;
    relaxedQueue[tail++] = model.player;
    for (let head = 0; head < tail; head++) {
      const c = relaxedQueue[head]!;
      for (let d = 0; d < 4; d++) {
        const m = nb[c * 4 + d]!;
        if (m < 0 || relaxed[m] || model.isExit[m]) continue;
        const g = grid[m]!;
        if (g === WALL || (g === DOOR && !doorsPass) || (g === WATER && !watersPass?.[m])) continue;
        relaxed[m] = 1;
        relaxedQueue[tail++] = m;
      }
    }
    return relaxed;
  };

  let root: Node = {
    state: opts.start ?? initialState(level),
    parent: undefined,
    segment: [],
    event: 'start',
    cost: 0,
  };
  if (autoKeys) root = closeKeys(root);
  push(root);

  const timeout = () => now() - t0 > opts.timeoutMs;
  while (open.length > 0) {
    if (timeout()) return { status: 'failed', reason: 'timeout', ...stats };
    const { node, level: lv, h: nodeH, w: nodeW } = open.shift()!;
    caps = capsAt(lv);
    capped = false;
    stats.expanded++;
    const s = node.state;
    log?.(
      `#${stats.expanded} h=${nodeH} level=${lv} w=${nodeW} cost=${node.cost} keys=${s.keys} open=${open.length} ${node.event}`,
    );
    // reach the exit: first only the doors on a route with the fewest doors, then every door
    const doorsLeft = doorCells.filter((d) => s.objects[d] === 'door');
    load(s);
    bfs01(distDoor, 0, 1);
    bfs01(distDoorExit, 0, 1, true);
    const fewest = minExit(distDoor);
    const routeDoors = doorsLeft.filter((d) => distDoor[d]! + distDoorExit[d]! - 1 === fewest);
    const exitTry = (doors: number[]) =>
      withUnfreeze(
        'exit',
        s,
        { doors, ...side },
        () => false,
        exitCells,
        true,
        caps.exitFree,
        caps.exitTries,
      )[0];
    // precheck: the exit event fills no water, so some route must be free of water; without
    // side keys, the keys in pocket must cover the doors of a route
    bfs01(distWater, 1, 0);
    const exitShut =
      prechecks && (minExit(distWater) > 0 || (!sideKeys && fewest > Math.max(0, s.keys)));
    if (exitShut) stats.prechecked++;
    const win = exitShut
      ? undefined
      : (exitTry(routeDoors) ??
        (routeDoors.length < doorsLeft.length ? exitTry(doorsLeft) : undefined));
    if (win) {
      const done = child(node, win.moves, win.state, `exit (free ${win.free.map(name).join(' ')})`);
      const p = path(done);
      if (!opts.start && replay(level, p.moves).status !== 'won')
        throw new Error('planner: plan does not win');
      return { status: 'solved', moves: p.moves, events: p.events, ...stats };
    }
    load(s);
    const cells = region();
    const inRegion = new Uint8Array(n);
    for (const c of cells) inRegion[c] = 1;
    const touches = (c: number) => {
      for (let d = 0; d < 4; d++) {
        const m = nb[c * 4 + d]!;
        if (m >= 0 && inRegion[m]) return true;
      }
      return false;
    };
    /** blocks next to the region that the player could push (room behind) */
    const blockCellsTouching = (intoWater: boolean): number[] => {
      const out = new Set<number>();
      for (const c of cells)
        for (let d = 0; d < 4; d++) {
          const b = nb[c * 4 + d]!;
          if (b < 0 || s.objects[b] !== 'block') continue;
          const behind = nb[b * 4 + d]!;
          if (behind < 0 || s.objects[behind] !== null) continue;
          if (s.terrain[behind] === 'floor' || (intoWater && s.terrain[behind] === 'water'))
            out.add(b);
        }
      return [...out];
    };
    const children: Node[] = [];
    const add = (rs: Realisation[], ev: string) => {
      for (const r of rs) {
        const free = r.free.length ? ` (free ${r.free.map(name).join(' ')})` : '';
        let c = child(node, r.moves, r.state, ev + free);
        if (autoKeys) c = closeKeys(c);
        children.push(c);
      }
    };
    /** a single restricted search with its alternatives, as realisations */
    const single = (kind: EventKind, r: Restriction, goal: Goal): Realisation[] => {
      const ks = stats.kinds[kind];
      ks.attempts++;
      const res = sub(kind, s, r, goal, false, alternatives);
      if (!res.ok) return [];
      ks.realised++;
      const free = [...(r.free ?? [])];
      return [res, ...(res.more ?? [])].map((x) => ({ moves: x.moves, state: x.state, free }));
    };
    // take a key (any water may be filled on the way); with automatic keys, only those behind
    // an obstacle are left, and they still need an event
    load(s);
    const blocksNow: number[] = [];
    for (let c = 0; c < n; c++) if (s.objects[c] === 'block') blocksNow.push(c);
    // waters some block can still reach (relaxed block moves): the others stay walls
    const fillableWater = new Uint8Array(n);
    for (const w of waterCells)
      if (s.terrain[w] === 'water' && blocksNow.some((b) => analysis.canFill(b, w)))
        fillableWater[w] = 1;
    const keyReach = prechecks ? relaxedRegion(fillableWater).slice() : undefined;
    for (const k of keyCells) {
      if (s.objects[k] !== 'key' || timeout()) continue;
      if (keyReach && !keyReach[k]) {
        stats.prechecked++;
        continue;
      }
      add(
        withUnfreeze(
          'key',
          s,
          { waters: 'all', ...(sideKeys ? {} : { keys: [k] }) },
          (m) => m.grid[k] !== KEY,
          [k],
          false,
          caps.keyFree,
          caps.tries,
        ),
        `key ${name(k)}`,
      );
    }
    // open a door next to the region
    // only if it is useful: on a route to the exit with the fewest doors, or a key behind it
    // (keys are exact: a door opened for nothing costs a key the exit needs)
    const usefulDoor = (d: number): boolean => {
      if (distDoor[d]! + distDoorExit[d]! - 1 === fewest) return true;
      const seenD = new Uint8Array(n);
      const q = [d];
      seenD[d] = 1;
      for (let h = 0; h < q.length; h++) {
        const c = q[h]!;
        for (let k = 0; k < 4; k++) {
          const m = nb[c * 4 + k]!;
          if (m < 0 || seenD[m] || inRegion[m]) continue;
          const g = model.grid[m];
          if (g === WALL || g === DOOR) continue;
          if (g === KEY) return true;
          seenD[m] = 1;
          q.push(m);
        }
      }
      return false;
    };
    if (s.keys > 0)
      for (const d of doorsLeft) {
        // widened states also try the other doors (one may give access to blocks)
        if (!touches(d) || timeout()) continue;
        if (!usefulDoor(d)) {
          if (lv < (opts.allDoorsLevel ?? 1)) {
            capped = true;
            continue;
          }
        }
        add(
          single('door', { doors: [d], ...side }, (m) => m.grid[d] !== DOOR),
          `door ${name(d)}`,
        );
      }
    // fill a water next to the region, or close to a block the player can push
    const pushable = blockCellsTouching(true);
    const manhattan = (a: number, b: number) =>
      Math.abs((a % width) - (b % width)) + Math.abs(Math.floor(a / width) - Math.floor(b / width));
    const near = (w: number) =>
      touches(w) || pushable.some((b) => manhattan(b, w) <= 4 && analysis.canFill(b, w));
    load(s);
    // a fill may open the doors next to its water (a water behind a door is filled through it)
    const doorsNextTo = (w: number): number[] => {
      const out: number[] = [];
      for (let d = 0; d < 4; d++) {
        const m = nb[w * 4 + d]!;
        if (m >= 0 && s.objects[m] === 'door') out.push(m);
      }
      return out;
    };
    const fillReach = prechecks ? relaxedRegion(null, s.keys > 0) : undefined;
    /**
     * precheck: the blocks of the relaxed region that can reach w (relaxed block moves), w being
     * next to the region; the fill search starts from them one by one (a fill with no unfrozen
     * block cannot succeed)
     */
    const fillers = (w: number): number[] => {
      let adjacent = false;
      for (let d = 0; d < 4 && !adjacent; d++) {
        const m = nb[w * 4 + d]!;
        if (m >= 0 && fillReach![m]) adjacent = true;
      }
      if (!adjacent) return [];
      return blocksNow.filter((c) => fillReach![c] && analysis.canFill(c, w));
    };
    for (const w of waterCells) {
      if (s.terrain[w] !== 'water' || timeout()) continue;
      const doors = s.keys > 0 ? doorsNextTo(w) : [];
      if (!near(w) && !doors.some(touches)) continue;
      const start = fillReach ? fillers(w) : undefined;
      if (start && start.length === 0) {
        stats.prechecked++;
        continue;
      }
      add(
        withUnfreeze(
          'fill',
          s,
          { waters: [w], doors, ...side },
          (m) => m.grid[w] !== WATER,
          [w],
          false,
          caps.fillFree,
          caps.tries,
          start,
        ),
        `fill ${name(w)}`,
      );
    }
    // move one block next to the region so that the region grows (clear a corridor)
    for (const b of cells.length ? blockCellsTouching(false) : []) {
      if (timeout()) break;
      add(
        single('move', { free: [b], ...side }, (m) => {
          const k = m.explore();
          for (let i = 0; i < k; i++) {
            const c = m.order[i]!;
            if (!inRegion[c]) return true;
          }
          return false;
        }),
        `move ${name(b)}`,
      );
    }
    for (const c of children) push(c);
    // widening: a cap stopped an event, so the state is queued again with larger caps, behind
    // the states of the same estimate and lower novelty
    if (capped && lv < widen && !timeout()) {
      stats.widened++;
      insert(nodeH, nodeW, node, lv + 1);
    }
  }
  return { status: 'failed', reason: 'exhausted', ...stats };
}
