import { MinHeap } from './heap';
import { RemainingBound, UNREACHABLE } from './solverBound';
import { StateCodec } from './solverKey';
import { DELTA, DIRS, initialState } from './state';
import { step } from './step';
import type { SolveOptions, SolveResult } from './solver';
import type { Dir, GameState, LevelData } from './types';

/** priority = (cost + bound) * TIE_SPAN - cost: on ties, the most advanced first */
const TIE_SPAN = 1 << 16;
/** a V8 Map cannot exceed 2^24 entries (RangeError beyond) */
const MAX_MAP_SIZE = 16_000_000;

/**
 * v2 engine (stage 1): kept as a test reference for the compact engine (solver.ts); ignores
 * maxMemoryMb (V8 heap only).
 *
 * Macro-search: a macro-state is (remaining objects, filled water, keys, player position).
 * From each one, a BFS gives the area reachable without interaction; each interaction (exit,
 * key, door, push) is played by step() and costs the walk + 1 move. Dijkstra on the number of
 * moves, guided by a consistent lower bound (A*): the first exit to leave the heap is an
 * optimal solution.
 *
 * Lower bound on timeout: the largest f = cost + lower bound popped from the heap.
 * Let C* be the optimum. Invariant: while the search runs, the heap holds an entry with
 * f ≤ C* — either a macro-state of an optimal path with its optimal cost (both lower bounds are
 * admissible, the weak one ≤ the strong one, and the strong one is consistent: a macro-state is
 * only closed with its optimal cost, so the first non-closed state of an optimal path was
 * pushed with its optimal cost), or the goal already found with cost bestGoal = C*. The only
 * entries never pushed or dropped without successors are: successors with f ≥ bestGoal (if one
 * is on an optimal path, then bestGoal = C* and the goal stays in the heap as a witness),
 * UNREACHABLE states (on no path), stale entries (cost > best known: another entry of the same
 * state, with a smaller cost, is in the heap or already processed); lazy re-pushing with the
 * strong bound replaces the entry by an entry of the same state with f still ≤ C*. Every entry
 * popped is the heap minimum, hence has f ≤ C* (priority = f·TIE_SPAN − cost with
 * cost < TIE_SPAN: a smaller f always gives a smaller priority). The maximum of the popped f is
 * therefore ≤ C*. It grows with maxStates: the search is deterministic and maxStates only
 * interrupts it.
 */
export function solveV2(level: LevelData, opts: SolveOptions = {}): SolveResult {
  const maxStates = Math.min(opts.maxStates ?? 3_000_000, MAX_MAP_SIZE);
  const timeoutMs = opts.timeoutMs ?? 60_000;
  const now = opts.now ?? (() => performance.now());
  const t0 = now();

  const start = initialState(level, 'normal');
  const { width, height } = start;
  const codec = new StateCodec(start);
  const bound = new RemainingBound(start);

  // area reachable without interaction: distance, arrival direction, tiles in BFS order
  const dist = new Int32Array(width * height);
  const via = new Int8Array(width * height);
  const order = new Int32Array(width * height);
  const explore = (s: GameState): number => {
    const origin = s.player.y * width + s.player.x;
    dist.fill(-1);
    dist[origin] = 0;
    order[0] = origin;
    let tail = 1;
    for (let head = 0; head < tail; head++) {
      const c = order[head]!;
      const cx = c % width;
      const cy = (c - cx) / width;
      for (let d = 0; d < 4; d++) {
        const nx = cx + DELTA[DIRS[d]!].x;
        const ny = cy + DELTA[DIRS[d]!].y;
        if (nx < 0 || ny < 0 || nx >= width || ny >= height) continue;
        const n = ny * width + nx;
        const t = s.terrain[n];
        if (dist[n] !== -1 || (t !== 'floor' && t !== 'gravel') || s.objects[n] !== null) continue;
        dist[n] = dist[c]! + 1;
        via[n] = d;
        order[tail++] = n;
      }
    }
    return tail;
  };
  const walkTo = (c: number): Dir[] => {
    const path: Dir[] = [];
    while (dist[c] !== 0) {
      const dir = DIRS[via[c]!]!;
      path.push(dir);
      c -= DELTA[dir].y * width + DELTA[dir].x;
    }
    return path.reverse();
  };

  // search nodes: macro-state key ('' = goal), parent, edge (interaction tile * 4 +
  // direction), cost, and whether the priority already uses the strong bound
  const nodeKey: string[] = [];
  const nodeParent: number[] = [];
  const nodeEdge: number[] = [];
  const nodeCost: number[] = [];
  const nodeStrong: boolean[] = [];
  const heap = new MinHeap();
  const push = (id: number, h: number) =>
    heap.push((nodeCost[id]! + h) * TIE_SPAN - nodeCost[id]!, id);
  const addNode = (
    key: string,
    parent: number,
    edge: number,
    cost: number,
    player: number,
  ): void => {
    nodeKey.push(key);
    nodeParent.push(parent);
    nodeEdge.push(edge);
    nodeCost.push(cost);
    nodeStrong.push(false);
    // cheap bound at insertion; the strong bound is computed when popped from the heap
    push(nodeKey.length - 1, bound.toExit[player]!);
  };

  // the walk of each edge is recomputed by the parent state's BFS
  const rebuild = (id: number): Dir[] => {
    const edges: number[] = [];
    for (let i = id; i > 0; i = nodeParent[i]!) edges.push(i);
    const moves: Dir[] = [];
    for (const i of edges.reverse()) {
      explore(codec.decode(nodeKey[nodeParent[i]!]!));
      moves.push(...walkTo(nodeEdge[i]! >> 2), DIRS[nodeEdge[i]! & 3]!);
    }
    return moves;
  };

  // best known cost per macro-state; -1 = closed (final cost)
  const best = new Map<string, number>();
  const startKey = codec.encode(start);
  best.set(startKey, 0);
  addNode(startKey, -1, 0, 0, startKey.charCodeAt(0));
  let bestGoal = Infinity;
  // largest f popped from the heap (see the proof above)
  let lowerBound = 0;

  for (let pops = 0; heap.size > 0; pops++) {
    if ((pops & 255) === 0 && now() - t0 > timeoutMs)
      return { status: 'timeout', explored: best.size, lowerBound };
    const [priority, id] = heap.pop();
    const key = nodeKey[id]!;
    const cost = nodeCost[id]!;
    // exact f (priority = f·TIE_SPAN − cost); a cost ≥ TIE_SPAN would skew the order by f, and an
    // "unreachable" f only comes from an unsolvable level: these values are ignored (safe bound)
    const f = (priority + cost) / TIE_SPAN;
    if (cost < TIE_SPAN && f < UNREACHABLE && f > lowerBound) lowerBound = f;
    if (key === '') return { status: 'solved', moves: rebuild(id), explored: best.size };
    if (best.get(key) !== cost) continue;

    const s = codec.decode(key);
    if (!nodeStrong[id]) {
      nodeStrong[id] = true;
      const h = bound.strong(s);
      if (h === UNREACHABLE) {
        best.set(key, -1);
        continue;
      }
      if (h > bound.toExit[key.charCodeAt(0)]!) {
        push(id, h);
        continue;
      }
    }
    best.set(key, -1);

    const reached = explore(s);
    for (let k = 0; k < reached; k++) {
      const c = order[k]!;
      const cx = c % width;
      const cy = (c - cx) / width;
      for (let d = 0; d < 4; d++) {
        const nx = cx + DELTA[DIRS[d]!].x;
        const ny = cy + DELTA[DIRS[d]!].y;
        if (nx < 0 || ny < 0 || nx >= width || ny >= height) continue;
        const n = ny * width + nx;
        // an exit is never inside the area, even if the player started on it
        if (s.objects[n] === null && s.terrain[n] !== 'exit') continue;
        const next = step({ ...s, player: { x: cx, y: cy }, moves: 0 }, DIRS[d]!).state;
        if (next.moves === 0 || next.status === 'drowned') continue;
        const nextCost = cost + dist[c]! + 1;
        if (next.status === 'won') {
          if (nextCost >= bestGoal) continue;
          bestGoal = nextCost;
          addNode('', id, c * 4 + d, nextCost, n);
          continue;
        }
        if (nextCost + bound.toExit[n]! >= bestGoal) continue;
        const nextKey = codec.encode(next);
        const known = best.get(nextKey);
        if (known !== undefined && known <= nextCost) continue;
        if (known === undefined && best.size >= maxStates)
          return { status: 'timeout', explored: best.size, lowerBound };
        best.set(nextKey, nextCost);
        addNode(nextKey, id, c * 4 + d, nextCost, n);
      }
    }
  }
  return { status: 'unsolvable', explored: best.size };
}
