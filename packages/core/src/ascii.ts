import type { GameState, LevelData, LevelObject, ObjKind, Pos, Terrain } from './types';

export type AsciiOptions = Partial<
  Pick<LevelData, 'id' | 'name' | 'author' | 'initialKeys' | 'thresholds'>
>;

const LEGEND: Record<string, { terrain: Terrain; obj?: ObjKind; start?: true }> = {
  '.': { terrain: 'floor' },
  ',': { terrain: 'gravel' },
  '~': { terrain: 'water' },
  '#': { terrain: 'wall' },
  E: { terrain: 'exit' },
  '@': { terrain: 'floor', start: true },
  k: { terrain: 'floor', obj: 'key' },
  D: { terrain: 'floor', obj: 'door' },
  B: { terrain: 'floor', obj: 'block' },
};

const TERRAIN_CHAR: Record<Terrain, string> = {
  floor: '.',
  gravel: ',',
  water: '~',
  wall: '#',
  exit: 'E',
};
const OBJ_CHAR: Record<ObjKind, string> = { key: 'k', door: 'D', block: 'B' };

export function fromAscii(rows: string[], opts: AsciiOptions = {}): LevelData {
  const width = rows[0]?.length ?? 0;
  const terrain: Terrain[] = [];
  const objects: LevelObject[] = [];
  const starts: Pos[] = [];
  rows.forEach((row, y) => {
    if (row.length !== width) throw new Error(`row ${y}: length ${row.length} ≠ ${width}`);
    [...row].forEach((ch, x) => {
      const cell = LEGEND[ch];
      if (!cell) throw new Error(`unknown character "${ch}" at (${x},${y})`);
      terrain.push(cell.terrain);
      if (cell.obj) objects.push({ x, y, kind: cell.obj });
      if (cell.start) starts.push({ x, y });
    });
  });
  if (starts.length !== 1) {
    throw new Error(`expected exactly one start (@), found ${starts.length}`);
  }
  return {
    id: opts.id ?? 'ascii',
    name: opts.name ?? opts.id ?? 'ascii',
    ...(opts.author !== undefined ? { author: opts.author } : {}),
    width,
    height: rows.length,
    terrain,
    objects,
    start: starts[0]!,
    initialKeys: opts.initialKeys ?? 0,
    thresholds: opts.thresholds ?? {},
  };
}

export function toAscii(s: GameState): string[] {
  const rows: string[] = [];
  for (let y = 0; y < s.height; y++) {
    let row = '';
    for (let x = 0; x < s.width; x++) {
      const i = y * s.width + x;
      const obj = s.objects[i] ?? null;
      if (s.player.x === x && s.player.y === y) row += '@';
      else if (obj) row += OBJ_CHAR[obj];
      else row += TERRAIN_CHAR[s.terrain[i]!];
    }
    rows.push(row);
  }
  return rows;
}
