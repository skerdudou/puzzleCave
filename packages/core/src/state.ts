import type { Dir, GameState, LevelData, Mode, ObjKind, Pos } from './types';

export const DIRS: readonly Dir[] = ['up', 'down', 'left', 'right'];

export const DELTA: Record<Dir, Pos> = {
  up: { x: 0, y: -1 },
  down: { x: 0, y: 1 },
  left: { x: -1, y: 0 },
  right: { x: 1, y: 0 },
};

export function idx(s: { width: number }, p: Pos): number {
  return p.y * s.width + p.x;
}

export function inBounds(s: { width: number; height: number }, p: Pos): boolean {
  return p.x >= 0 && p.y >= 0 && p.x < s.width && p.y < s.height;
}

export function initialState(level: LevelData, mode: Mode = 'normal'): GameState {
  const objects = new Array<ObjKind | null>(level.width * level.height).fill(null);
  for (const o of level.objects) objects[idx(level, o)] = o.kind;
  return {
    width: level.width,
    height: level.height,
    terrain: [...level.terrain],
    objects,
    player: { x: level.start.x, y: level.start.y },
    facing: 'down',
    keys: level.initialKeys,
    moves: 0,
    status: 'playing',
    mode,
  };
}
