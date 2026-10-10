import { DELTA, DIRS } from './state';
import type { GameState, Terrain } from './types';

export const UNREACHABLE = 0x3fffffff;

/** BFS distances (in moves) from `sources`, without crossing `blocked` tiles. */
function distances(
  width: number,
  height: number,
  sources: readonly number[],
  blocked: (i: number) => boolean,
): Int32Array {
  const d = new Int32Array(width * height).fill(UNREACHABLE);
  const queue = [...sources];
  for (const s of sources) d[s] = 0;
  for (let head = 0; head < queue.length; head++) {
    const c = queue[head]!;
    const cx = c % width;
    const cy = (c - cx) / width;
    for (const dir of DIRS) {
      const nx = cx + DELTA[dir].x;
      const ny = cy + DELTA[dir].y;
      if (nx < 0 || ny < 0 || nx >= width || ny >= height) continue;
      const n = ny * width + nx;
      if (d[n] !== UNREACHABLE || blocked(n)) continue;
      d[n] = d[c]! + 1;
      queue.push(n);
    }
  }
  return d;
}

/**
 * Admissible and consistent lower bounds on the number of moves left to the exit, computed on the
 * "relaxed" map where only walls stop movement (water, blocks, doors, gravel are passable).
 */
export class RemainingBound {
  private readonly width: number;
  private readonly height: number;
  private readonly terrain: readonly Terrain[];
  private readonly exits: number[];
  /** relaxed distance to the nearest exit */
  readonly toExit: Int32Array;
  /** relaxed distance from each initial key tile */
  private readonly fromKey = new Map<number, Int32Array>();
  /** tiles from which the exit is reachable without crossing a door, per set of remaining doors */
  private readonly withoutDoors = new Map<string, Int32Array>();

  constructor(start: GameState) {
    const { width, height, terrain } = start;
    this.width = width;
    this.height = height;
    this.terrain = terrain;
    const wall = (i: number) => terrain[i] === 'wall';
    this.exits = terrain.flatMap((t, i) => (t === 'exit' ? [i] : []));
    this.toExit = distances(width, height, this.exits, wall);
    start.objects.forEach((o, i) => {
      if (o === 'key') this.fromKey.set(i, distances(width, height, [i], wall));
    });
  }

  /**
   * With no key in pocket, if every route to the exit goes through a door, a key must be
   * visited first: min over the remaining keys of (player → key) + (key → exit).
   */
  strong(s: GameState): number {
    const p = s.player.y * this.width + s.player.x;
    const direct = this.toExit[p]!;
    if (s.keys > 0 || direct === UNREACHABLE || this.reachesExitWithoutDoor(s, p)) return direct;
    let bound = UNREACHABLE;
    s.objects.forEach((o, i) => {
      if (o === 'key') bound = Math.min(bound, this.fromKey.get(i)![p]! + this.toExit[i]!);
    });
    return bound;
  }

  private reachesExitWithoutDoor(s: GameState, p: number): boolean {
    const doors: number[] = [];
    s.objects.forEach((o, i) => {
      if (o === 'door') doors.push(i);
    });
    const id = doors.join(',');
    let region = this.withoutDoors.get(id);
    if (!region) {
      const isDoor = new Uint8Array(s.objects.length);
      for (const i of doors) isDoor[i] = 1;
      const blocked = (i: number) => this.terrain[i] === 'wall' || isDoor[i] === 1;
      region = distances(this.width, this.height, this.exits, blocked);
      this.withoutDoors.set(id, region);
    }
    return region[p] !== UNREACHABLE;
  }
}
