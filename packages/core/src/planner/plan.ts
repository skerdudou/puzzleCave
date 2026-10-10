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
  /** macro-states of each restricted search */
  maxSubStates?: number;
  /** blocks unfrozen for one event, at most */
  maxFree?: number;
  /** restricted searches tried per event (growing sets of unfrozen blocks) */
  maxTries?: number;
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
}

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

const INF = 0x3fffffff;

export function planSolution(level: LevelData, opts: PlanOptions): PlanResult {
  const now = opts.now ?? (() => performance.now());
  const t0 = now();
  const maxFree = opts.maxFree ?? 3;
  const maxTries = opts.maxTries ?? 60;
  const maxSubStates = opts.maxSubStates ?? 5_000;
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
  const sub = (s: GameState, r: Restriction, goal: Goal, win = false) => {
    stats.subSearches++;
    const res = reachSubgoal(s, r, goal, { maxStates: maxSubStates, win });
    stats.subStates += res.explored;
    return res;
  };
  /**
   * Event realised with the smallest set of unfrozen blocks: starts with none, then adds, one at
   * a time, the frozen blocks the player could push during a failed search. Sets are tried by
   * size, then by distance of their blocks to the target cells (closest first).
   */
  const withUnfreeze = (
    s: GameState,
    base: Restriction,
    goal: Goal,
    targets: number[],
    win: boolean,
    limitFree: number,
    limitTries: number,
  ) => {
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
    const seen = new Set<string>(['']);
    const queue: { free: number[]; score: number }[] = [{ free: [], score: 0 }];
    for (let tries = 0; queue.length > 0 && tries < limitTries; tries++) {
      let bi = 0;
      for (let i = 1; i < queue.length; i++) {
        const a = queue[i]!;
        const b = queue[bi]!;
        if (a.free.length < b.free.length || (a.free.length === b.free.length && a.score < b.score))
          bi = i;
      }
      const { free, score } = queue.splice(bi, 1)[0]!;
      const res = sub(s, { ...base, free }, goal, win);
      if (res.ok) return { ...res, free };
      if (free.length >= limitFree) continue;
      for (const t of res.touched) {
        const f = [...free, t].sort((a, b) => a - b);
        const k = f.join(',');
        if (seen.has(k)) continue;
        seen.add(k);
        queue.push({ free: f, score: score + far(t) });
      }
    }
    return undefined;
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

  // open list (small: a sorted insertion is enough)
  const open: { prio: number[]; node: Node }[] = [];
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
    const prio = order === 'h' ? [h, w, node.cost] : [w, h, node.cost];
    let i = open.length;
    while (i > 0 && less(prio, open[i - 1]!.prio)) i--;
    open.splice(i, 0, { prio, node });
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
        const r = sub(cur.state, {}, (m) => m.grid[k] !== KEY);
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
    const { node, prio } = open.shift()!;
    stats.expanded++;
    const s = node.state;
    log?.(
      `#${stats.expanded} w=${prio[0]} h=${prio[1]} cost=${node.cost} keys=${s.keys} open=${open.length} ${node.event}`,
    );
    // reach the exit: every door allowed
    const doorsLeft = doorCells.filter((d) => s.objects[d] === 'door');
    const win = withUnfreeze(
      s,
      { doors: doorsLeft },
      () => false,
      exitCells,
      true,
      Math.min(2, maxFree),
      20,
    );
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
    const add = (r: { moves: Dir[]; state: GameState; free: number[] } | undefined, ev: string) => {
      if (!r) return;
      const free = r.free.length ? ` (free ${r.free.map(name).join(' ')})` : '';
      let c = child(node, r.moves, r.state, ev + free);
      if (autoKeys) c = closeKeys(c);
      children.push(c);
    };
    // take a key (any water may be filled on the way); with automatic keys, only those behind
    // an obstacle are left, and they still need an event
    for (const k of keyCells) {
      if (s.objects[k] !== 'key' || timeout()) continue;
      add(
        withUnfreeze(s, { waters: 'all' }, (m) => m.grid[k] !== KEY, [k], false, maxFree, maxTries),
        `key ${name(k)}`,
      );
    }
    // open a door next to the region
    // only if it is useful: on a route to the exit with the fewest doors, or a key behind it
    // (keys are exact: a door opened for nothing costs a key the exit needs)
    const usefulDoor = (d: number): boolean => {
      if (distDoor[d]! + distDoorExit[d]! - 1 === minExit(distDoor)) return true;
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
    if (s.keys > 0) {
      load(s);
      bfs01(distDoor, 0, 1);
      bfs01(distDoorExit, 0, 1, true);
    }
    if (s.keys > 0)
      for (const d of doorsLeft) {
        if (!touches(d) || !usefulDoor(d) || timeout()) continue;
        const r = sub(s, { doors: [d] }, (m) => m.grid[d] !== DOOR);
        if (r.ok) add({ ...r, free: [] }, `door ${name(d)}`);
      }
    // fill a water next to the region, or close to a block the player can push
    const pushable = blockCellsTouching(true);
    const manhattan = (a: number, b: number) =>
      Math.abs((a % width) - (b % width)) + Math.abs(Math.floor(a / width) - Math.floor(b / width));
    const near = (w: number) =>
      touches(w) || pushable.some((b) => manhattan(b, w) <= 4 && analysis.canFill(b, w));
    for (const w of waterCells) {
      if (s.terrain[w] !== 'water' || !near(w) || timeout()) continue;
      add(
        withUnfreeze(s, { waters: [w] }, (m) => m.grid[w] !== WATER, [w], false, 1, maxTries),
        `fill ${name(w)}`,
      );
    }
    // move one block next to the region so that the region grows (clear a corridor)
    for (const b of cells.length ? blockCellsTouching(false) : []) {
      if (timeout()) break;
      const r = sub(s, { free: [b] }, (m) => {
        const k = m.explore();
        for (let i = 0; i < k; i++) {
          const c = m.order[i]!;
          if (!inRegion[c]) return true;
        }
        return false;
      });
      if (r.ok) add({ ...r, free: [b] }, `move ${name(b)}`);
    }
    for (const c of children) push(c);
  }
  return { status: 'failed', reason: 'exhausted', ...stats };
}
