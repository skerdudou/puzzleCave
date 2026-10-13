import type { LevelData, Terrain } from './types';

const NO_OBJECT_ON = new Set<Terrain>(['wall', 'water', 'exit']);

export function validateLevel(l: LevelData): string[] {
  const e: string[] = [];
  if (!l.id) e.push('empty id');
  const { width: w, height: h } = l;
  if (!Number.isInteger(w) || !Number.isInteger(h) || w < 1 || h < 1) {
    e.push(`invalid dimensions (${w}x${h})`);
    return e;
  }
  if (l.terrain.length !== w * h) {
    e.push(`terrain: ${l.terrain.length} tiles instead of ${w * h}`);
    return e;
  }
  const inside = (x: number, y: number) =>
    Number.isInteger(x) && Number.isInteger(y) && x >= 0 && y >= 0 && x < w && y < h;
  const at = (x: number, y: number) => l.terrain[y * w + x]!;

  if (!inside(l.start.x, l.start.y)) {
    e.push(`start outside the map (${l.start.x},${l.start.y})`);
  } else {
    const t = at(l.start.x, l.start.y);
    if (t === 'wall') e.push(`start on ${t}`);
  }

  const seen = new Set<number>();
  for (const o of l.objects) {
    if (!inside(o.x, o.y)) {
      e.push(`object ${o.kind} outside the map (${o.x},${o.y})`);
      continue;
    }
    const i = o.y * w + o.x;
    if (seen.has(i)) e.push(`two objects at (${o.x},${o.y})`);
    seen.add(i);
    if (o.x === l.start.x && o.y === l.start.y) e.push(`object ${o.kind} on the start`);
    const t = at(o.x, o.y);
    if (NO_OBJECT_ON.has(t)) e.push(`object ${o.kind} on ${t} at (${o.x},${o.y})`);
  }

  if (!l.terrain.includes('exit')) e.push('no exit');
  if (!Number.isInteger(l.initialKeys)) e.push('initial keys not an integer');
  for (const [name, v] of Object.entries(l.thresholds)) {
    if (v !== undefined && !(Number.isFinite(v) && v > 0))
      e.push(`invalid threshold ${name} (${v})`);
  }
  const { goldMoves: gold, platinumMoves: plat } = l.thresholds;
  if (plat !== undefined && gold === undefined) e.push('platinumMoves without goldMoves');
  if (plat !== undefined && gold !== undefined && plat > gold)
    e.push(`platinumMoves (${plat}) > goldMoves (${gold})`);
  return e;
}

export function assertValidLevel(l: LevelData): void {
  const e = validateLevel(l);
  if (e.length) throw new Error(`Invalid level "${l.id}":\n- ${e.join('\n- ')}`);
}
