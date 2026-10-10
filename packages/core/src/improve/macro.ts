// Tools on the solutions of the "best known" stage: normalization, splitting at interactions,
// intermediate state seen as a level. The searches (findSolution, windows) use the structures of
// the compact engine (compactModel, compactStore).
import { initialState } from '../state';
import { step } from '../step';
import type { Dir, GameState, LevelData, LevelObject, Status } from '../types';

/**
 * Moves that have an effect (the move counter advances), up to and including victory or drowning.
 * A move without effect only changes the orientation, which affects nothing: the game is the same.
 */
export function normalizeMoves(
  level: LevelData,
  moves: readonly Dir[],
): { moves: Dir[]; status: Status } {
  let s = initialState(level, 'normal');
  const kept: Dir[] = [];
  for (const m of moves) {
    if (s.status !== 'playing') break;
    const next = step(s, m).state;
    if (next.moves !== s.moves) kept.push(m);
    s = next;
  }
  return { moves: kept, status: s.status };
}

/**
 * Splitting of a solution at interactions: idx[k] = number of moves played right after the k-th
 * interaction (idx[0] = 0, start), states[k] = corresponding state (move counter reset to 0).
 */
export function checkpoints(
  level: LevelData,
  moves: readonly Dir[],
): { idx: number[]; states: GameState[] } {
  let s = initialState(level, 'normal');
  const idx = [0];
  const states: GameState[] = [s];
  moves.forEach((m, i) => {
    const r = step(s, m);
    s = r.state;
    if (r.events.some((e) => e.type !== 'moved' && e.type !== 'turned')) {
      idx.push(i + 1);
      states.push({ ...s, moves: 0 });
    }
  });
  return { idx, states };
}

/** Level whose initial state is s (filled waters turned into floor, remaining objects, pocket keys). */
export function stateAsLevel(level: LevelData, s: GameState): LevelData {
  const objects: LevelObject[] = [];
  s.objects.forEach((o, i) => {
    if (o !== null) objects.push({ x: i % s.width, y: Math.floor(i / s.width), kind: o });
  });
  return {
    ...level,
    terrain: s.terrain.slice(),
    objects,
    start: { x: s.player.x, y: s.player.y },
    initialKeys: s.keys,
  };
}
