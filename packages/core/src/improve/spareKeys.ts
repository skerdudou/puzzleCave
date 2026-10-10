import { solve } from '../solver';
import type { Dir, GameState, LevelData } from '../types';
import type { ExactEngine, WindowEngine } from './engine';
import { checkpoints, normalizeMoves } from './macro';
import { windowSearch } from './reoptimize';
import { searchWindow } from './window';

export interface SpareKeysOptions {
  /** total duration of the pass */
  timeoutMs: number;
  now?: () => number;
  /** macro-states per window (2,000,000 by default) */
  maxStatesPerWindow?: number;
  /** memory cap of each window (MB) */
  maxMemoryMb?: number;
  /** largest window, in interactions (32 by default; windows of 2, 4, 8… around the pickup) */
  maxWindow?: number;
  /** exact engine of the windows that reach victory; `solve` by default */
  exact?: ExactEngine;
  /** engine of the internal windows; `searchWindow` by default */
  window?: WindowEngine;
}

export interface SpareKeysResult {
  moves: Dir[];
  /** key pickups removed */
  dropped: number;
  /** windows searched */
  windows: number;
  /** replacements discarded because the resulting solution did not win or was not shorter */
  rejected: number;
  timedOut: boolean;
}

/**
 * Interactions (indices of `checkpoints`) that pick up a key the rest of the solution never needs:
 * from the pickup to the end, the keys in hand never drop below 1, so with one key fewer they
 * never go below 0 and every later door still opens.
 */
export function droppablePickups(level: LevelData, moves: readonly Dir[]): number[] {
  return droppable(checkpoints(level, moves).states);
}

function droppable(states: readonly GameState[]): number[] {
  const out: number[] = [];
  let min = Infinity;
  for (let k = states.length - 1; k > 0; k--) {
    min = Math.min(min, states[k]!.keys);
    if (states[k]!.keys > states[k - 1]!.keys && min >= 1) out.push(k);
  }
  return out.reverse();
}

/**
 * Spare keys: the window pass replaces a piece of the solution by a shorter path to exactly the
 * same state, keys in hand and keys on the ground included, so it never drops a useless key
 * pickup. For each droppable pickup (see droppablePickups), windows of 2, 4, 8… interactions
 * around it look for a path to the original state at the window's end, but with that key still on
 * the ground and one key fewer in hand; the window engine prunes any state where that key is
 * picked up. Each candidate is replayed as a whole and kept only if it wins and is strictly
 * shorter; the best saving among the pickups is applied, then everything is recomputed (greedy,
 * one key at a time).
 */
export function spareKeys(
  level: LevelData,
  initial: readonly Dir[],
  opts: SpareKeysOptions,
): SpareKeysResult {
  const now = opts.now ?? (() => performance.now());
  const deadline = now() + opts.timeoutMs;
  const maxWindow = opts.maxWindow ?? 32;
  const search = windowSearch(level, deadline, {
    ...(opts.maxMemoryMb !== undefined ? { maxMemoryMb: opts.maxMemoryMb } : {}),
    now,
    maxStatesPerWindow: opts.maxStatesPerWindow ?? 2_000_000,
    exact: opts.exact ?? solve,
    window: opts.window ?? searchWindow,
  });
  const start = normalizeMoves(level, initial);
  if (start.status !== 'won')
    throw new Error(`the starting solution does not win (${start.status})`);
  let moves = start.moves;
  const out = { dropped: 0, windows: 0, rejected: 0, timedOut: false };
  // key cells whose pickup could not be removed (not retried)
  const failed = new Set<number>();

  for (;;) {
    const { idx, states } = checkpoints(level, moves);
    const count = idx.length - 1;
    let best: Dir[] | undefined;
    for (const p of droppable(states)) {
      const { x, y } = states[p]!.player;
      const cell = y * level.width + x;
      if (failed.has(cell)) continue;
      /** target of a window ending at b: the key still on the ground, one key fewer in hand */
      const target = (b: number): GameState | undefined => {
        const s = states[b]!;
        if (s.status === 'won') return s;
        if (s.objects[cell] !== null || s.player.x + s.player.y * level.width === cell) return;
        const objects = s.objects.slice();
        objects[cell] = 'key';
        return { ...s, objects, keys: s.keys - 1 };
      };
      let found: Dir[] | undefined;
      let previous = '';
      for (let size = 2; size <= maxWindow; size *= 2) {
        let b = Math.min(count, Math.max(0, p - size / 2) + size);
        const a = Math.max(0, b - size);
        let goal = target(b);
        while (!goal && b < count) goal = target(++b);
        if (!goal || `${a}-${b}` === previous) break;
        previous = `${a}-${b}`;
        if (now() >= deadline) {
          out.timedOut = true;
          break;
        }
        out.windows++;
        const r = search(states[a]!, goal, idx[b]! - idx[a]!);
        if (r.status === 'limit') break;
        if (r.status === 'none') continue;
        const cand = normalizeMoves(level, [
          ...moves.slice(0, idx[a]!),
          ...r.moves,
          ...moves.slice(idx[b]!),
        ]);
        if (cand.status === 'won' && cand.moves.length < moves.length) {
          found = cand.moves;
          break;
        }
        out.rejected++;
      }
      if (!found) failed.add(cell);
      else if (!best || found.length < best.length) best = found;
      if (out.timedOut) break;
    }
    if (!best) break;
    moves = best;
    out.dropped++;
    if (out.timedOut) break;
  }
  return { moves, ...out };
}
