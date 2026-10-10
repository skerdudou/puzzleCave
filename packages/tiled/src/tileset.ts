import type { TileKind } from '@puzzlecave/core';
import { arr, properties, str, xmlParser, type XmlNode } from './xml';

export const TILE_ORDER: readonly TileKind[] = [
  'floor',
  'gravel',
  'water',
  'wall',
  'exit',
  'start',
  'key',
  'door',
  'block',
];
const KINDS = new Set<string>(TILE_ORDER);

export function tilesetKinds(node: XmlNode): Map<number, TileKind> {
  const m = new Map<number, TileKind>();
  for (const tile of arr(node.tile)) {
    const kind = properties(tile).get('kind');
    if (kind === undefined) continue;
    if (!KINDS.has(kind)) throw new Error(`tile ${str(tile.id)}: unknown kind "${kind}"`);
    m.set(Number(str(tile.id)), kind as TileKind);
  }
  return m;
}

export function parseTileset(xml: string): Map<number, TileKind> {
  const doc = xmlParser.parse(xml) as XmlNode;
  const ts = arr(doc.tileset)[0];
  if (!ts) throw new Error('tileset file without <tileset>');
  return tilesetKinds(ts);
}
