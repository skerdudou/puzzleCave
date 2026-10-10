import type {
  LevelData,
  LevelObject,
  ObjKind,
  Pos,
  Terrain,
  ThresholdOverrides,
  TileKind,
} from '@puzzlecave/core';
import { parseTileset, tilesetKinds } from './tileset';
import { arr, properties, str, xmlParser, type XmlNode } from './xml';

const TERRAINS = new Set<TileKind>(['floor', 'gravel', 'water', 'wall', 'exit']);
const THRESHOLD_KEYS: (keyof ThresholdOverrides)[] = [
  'goldMoves',
  'silverMoves',
  'bronzeMoves',
  'goldTime',
  'silverTime',
  'bronzeTime',
  'platinumTime',
];
const FLIP_MASK = 0x1fffffff;

export function parseTmx(
  xml: string,
  id: string,
  readTileset: (source: string) => string,
): LevelData {
  const doc = xmlParser.parse(xml) as XmlNode;
  const map = arr(doc.map)[0];
  if (!map) throw new Error('file without <map>');
  const width = Number(str(map.width));
  const height = Number(str(map.height));
  const tw = Number(str(map.tilewidth));
  const th = Number(str(map.tileheight));

  const sets = arr(map.tileset)
    .map((ts) => {
      const source = str(ts.source);
      const kinds = source ? parseTileset(readTileset(source)) : tilesetKinds(ts);
      return { firstgid: Number(str(ts.firstgid)), kinds };
    })
    .sort((a, b) => b.firstgid - a.firstgid);

  const kindOf = (rawGid: number, where: string): TileKind => {
    const gid = (rawGid >>> 0) & FLIP_MASK;
    if (gid === 0) throw new Error(`empty cell ${where}`);
    const set = sets.find((s) => s.firstgid <= gid);
    const kind = set?.kinds.get(gid - set.firstgid);
    if (!kind) throw new Error(`tile ${gid} without a kind property ${where}`);
    return kind;
  };

  const layers = arr(map.layer);
  const layer = layers.find((l) => str(l.name) === 'terrain') ?? layers[0];
  if (!layer) throw new Error('no tile layer');
  const data = arr(layer.data)[0];
  const enc = str(data?.encoding) ?? 'xml';
  if (enc !== 'csv') {
    throw new Error(
      `layer encoding "${enc}" not supported: in Tiled, Map > Map Properties > Tile Layer Format = CSV`,
    );
  }
  const cells = (str(data?.['#text']) ?? '')
    .split(',')
    .map((v) => v.trim())
    .filter((v) => v !== '')
    .map(Number);
  if (cells.length !== width * height) {
    throw new Error(`terrain layer: ${cells.length} cells instead of ${width * height}`);
  }

  const terrain: Terrain[] = [];
  const objects: LevelObject[] = [];
  const starts: Pos[] = [];
  const place = (kind: TileKind, x: number, y: number) => {
    if (kind === 'start') starts.push({ x, y });
    else objects.push({ x, y, kind: kind as ObjKind });
  };
  cells.forEach((gid, i) => {
    const x = i % width;
    const y = Math.floor(i / width);
    const kind = kindOf(gid, `at (${x},${y})`);
    if (TERRAINS.has(kind)) terrain.push(kind as Terrain);
    else {
      terrain.push('floor');
      place(kind, x, y);
    }
  });

  for (const group of arr(map.objectgroup)) {
    for (const o of arr(group.object)) {
      const gidStr = str(o.gid);
      if (!gidStr) continue;
      const x = Math.round(Number(str(o.x) ?? 0) / tw);
      const y = Math.round(Number(str(o.y) ?? 0) / th) - 1;
      const kind = kindOf(Number(gidStr), `(object ${str(o.id)})`);
      if (TERRAINS.has(kind)) {
        throw new Error(`object ${str(o.id)}: a terrain tile (${kind}) cannot be an object`);
      }
      place(kind, x, y);
    }
  }
  if (starts.length !== 1) throw new Error(`exactly one start is required, found ${starts.length}`);

  const props = properties(map);
  const thresholds: ThresholdOverrides = {};
  for (const k of THRESHOLD_KEYS) {
    const v = props.get(k);
    if (v !== undefined && v !== '') thresholds[k] = Number(v);
  }
  const author = props.get('author');
  return {
    id,
    name: props.get('name') || id,
    ...(author ? { author } : {}),
    width,
    height,
    terrain,
    objects,
    start: starts[0]!,
    initialKeys: Number(props.get('initialKeys') ?? 0),
    platinum: props.get('platinum') === 'true',
    thresholds,
  };
}
