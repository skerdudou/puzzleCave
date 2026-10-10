import { DIRS, initialState } from './state';
import { step } from './step';
import type { SolveOptions, SolveResult } from './solver';
import type { Dir, GameState, LevelData } from './types';

// Original BFS (one state per move): simple but memory-hungry, kept as a reference for testing the solver
const OBJ_CHAR = { key: 'k', door: 'd', block: 'b' } as const;

export function solveNaive(level: LevelData, opts: SolveOptions = {}): SolveResult {
  const maxStates = opts.maxStates ?? 3_000_000;
  const timeoutMs = opts.timeoutMs ?? 60_000;
  const now = opts.now ?? (() => performance.now());
  const t0 = now();

  const start = initialState(level, 'normal');
  const waterCells = start.terrain.flatMap((t, i) => (t === 'water' ? [i] : []));
  // facing is not part of the key: it does not affect the possible moves
  const keyOf = (s: GameState): string => {
    let k = `${s.player.x},${s.player.y},${s.keys}|`;
    for (const o of s.objects) k += o === null ? '.' : OBJ_CHAR[o];
    k += '|';
    for (const i of waterCells) k += s.terrain[i] === 'water' ? '1' : '0';
    return k;
  };

  const seen = new Set<string>([keyOf(start)]);
  const parent: number[] = [-1];
  const via: Dir[] = ['up'];
  const queue: (GameState | undefined)[] = [start];
  const ids: number[] = [0];

  const rebuild = (id: number): Dir[] => {
    const moves: Dir[] = [];
    for (let i = id; i > 0; i = parent[i]!) moves.push(via[i]!);
    return moves.reverse();
  };

  // level-order BFS: when a state of depth d is processed, all those of depth < d have
  // been expanded without winning, so no solution has ≤ d moves (cur.moves bound, conservative)
  for (let head = 0; head < queue.length; head++) {
    const cur = queue[head]!;
    const curId = ids[head]!;
    queue[head] = undefined;
    if ((head & 1023) === 0 && now() - t0 > timeoutMs)
      return { status: 'timeout', explored: seen.size, lowerBound: cur.moves };
    for (const dir of DIRS) {
      const next = step(cur, dir).state;
      if (next.moves === cur.moves || next.status === 'drowned') continue;
      if (next.status === 'won') {
        parent.push(curId);
        via.push(dir);
        return { status: 'solved', moves: rebuild(parent.length - 1), explored: seen.size };
      }
      const key = keyOf(next);
      if (seen.has(key)) continue;
      if (seen.size >= maxStates)
        return { status: 'timeout', explored: seen.size, lowerBound: cur.moves };
      seen.add(key);
      parent.push(curId);
      via.push(dir);
      queue.push(next);
      ids.push(parent.length - 1);
    }
  }
  return { status: 'unsolvable', explored: seen.size };
}
