// Random level generators for the solver tests (not exported by the package).
import type { LevelData, LevelObject, ObjKind, Terrain } from './types';
import { validateLevel } from './validate';

export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Stage 1 generator: sampling with replacement, some of the levels are invalid. */
export function randomLevel(rnd: () => number, n: number): LevelData {
  const width = 5 + Math.floor(rnd() * 2);
  const height = 5 + Math.floor(rnd() * 2);
  const int = (k: number) => Math.floor(rnd() * k);
  const terrain: Terrain[] = Array.from({ length: width * height }, () => {
    const r = rnd();
    return r < 0.55 ? 'floor' : r < 0.7 ? 'wall' : r < 0.82 ? 'gravel' : 'water';
  });
  const cell = () => ({ x: int(width), y: int(height) });
  const exit = cell();
  terrain[exit.y * width + exit.x] = 'exit';
  const start = cell();
  const objects: LevelObject[] = [];
  // half of the time, the exit is only reachable through a door: a key is needed first
  let doors = int(3);
  if (rnd() < 0.5) {
    const around = [
      { x: exit.x - 1, y: exit.y },
      { x: exit.x + 1, y: exit.y },
      { x: exit.x, y: exit.y - 1 },
      { x: exit.x, y: exit.y + 1 },
    ].filter((p) => p.x >= 0 && p.y >= 0 && p.x < width && p.y < height);
    const gate = int(around.length);
    around.forEach((p, i) => (terrain[p.y * width + p.x] = i === gate ? 'floor' : 'wall'));
    objects.push({ ...around[gate]!, kind: 'door' });
    doors = Math.min(doors, 1);
  }
  const add = (kind: ObjKind, count: number) => {
    for (let i = 0; i < count; i++) {
      let p = cell();
      for (let t = 0; t < 4 && terrain[p.y * width + p.x] !== 'floor'; t++) p = cell();
      objects.push({ ...p, kind });
    }
  };
  add('block', int(4));
  add('key', int(3));
  add('door', doors);
  return {
    id: `rnd-${n}`,
    name: `rnd-${n}`,
    width,
    height,
    terrain,
    objects,
    start,
    initialKeys: int(3) - 1,
    platinum: false,
    thresholds: {},
  };
}

/**
 * Stage 2 generator: always-valid levels (objects on distinct free floor or gravel tiles), with
 * doors in front of the exit half of the time, start on water ~1 time in 6, initial keys from
 * -2 to 2.
 */
export function validRandomLevel(rnd: () => number, n: number): LevelData {
  const int = (k: number) => Math.floor(rnd() * k);
  const width = 4 + int(4);
  const height = 4 + int(3);
  const terrain: Terrain[] = Array.from({ length: width * height }, () => {
    const r = rnd();
    return r < 0.52 ? 'floor' : r < 0.67 ? 'wall' : r < 0.8 ? 'gravel' : 'water';
  });
  const at = (x: number, y: number) => y * width + x;
  const exit = { x: int(width), y: int(height) };
  terrain[at(exit.x, exit.y)] = 'exit';
  const used = new Set<number>([at(exit.x, exit.y)]);
  const objects: LevelObject[] = [];
  if (rnd() < 0.5) {
    const around = [
      { x: exit.x - 1, y: exit.y },
      { x: exit.x + 1, y: exit.y },
      { x: exit.x, y: exit.y - 1 },
      { x: exit.x, y: exit.y + 1 },
    ].filter((p) => p.x >= 0 && p.y >= 0 && p.x < width && p.y < height);
    const gate = int(around.length);
    around.forEach((p, i) => (terrain[at(p.x, p.y)] = i === gate ? 'floor' : 'wall'));
    objects.push({ ...around[gate]!, kind: 'door' });
    used.add(at(around[gate]!.x, around[gate]!.y));
  }
  const free = () => {
    for (let t = 0; t < 50; t++) {
      const x = int(width);
      const y = int(height);
      const i = at(x, y);
      if (!used.has(i) && (terrain[i] === 'floor' || terrain[i] === 'gravel')) {
        used.add(i);
        return { x, y };
      }
    }
    return undefined;
  };
  let start = free();
  if (!start) {
    start = { x: exit.x === 0 ? 1 % width : 0, y: exit.y };
    terrain[at(start.x, start.y)] = 'floor';
  }
  if (rnd() < 0.17) terrain[at(start.x, start.y)] = 'water';
  const add = (kind: ObjKind, count: number) => {
    for (let i = 0; i < count; i++) {
      const p = free();
      if (p) objects.push({ ...p, kind });
    }
  };
  add('block', int(5));
  add('key', int(4));
  add('door', int(3));
  return {
    id: `vrnd-${n}`,
    name: `vrnd-${n}`,
    width,
    height,
    terrain,
    objects,
    start,
    initialKeys: int(5) - 2,
    platinum: false,
    thresholds: {},
  };
}

/** Valid levels from the stage 1 generator (sample for the "best known" pipeline tests). */
export function sampleLevels(count = 1000, seed = 20261010): LevelData[] {
  const rnd = mulberry32(seed);
  const levels: LevelData[] = [];
  for (let n = 0; n < count; n++) {
    const level = randomLevel(rnd, n);
    if (validateLevel(level).length === 0) levels.push(level);
  }
  return levels;
}
