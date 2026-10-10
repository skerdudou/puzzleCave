import type { LevelData, ThresholdOverrides, TileKind } from '@puzzlecave/core';
import { TILE_ORDER } from './tileset';

const esc = (s: string) =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const gidOf = (k: TileKind) => TILE_ORDER.indexOf(k) + 1;

function propLine(name: string, value: string | number | boolean): string {
  const type =
    typeof value === 'boolean'
      ? 'bool'
      : typeof value === 'number'
        ? Number.isInteger(value)
          ? 'int'
          : 'float'
        : undefined;
  return `  <property name="${esc(name)}"${type ? ` type="${type}"` : ''} value="${esc(String(value))}"/>`;
}

export function writeTmx(level: LevelData, tilesetSource = 'tileset.tsx'): string {
  const { width: w, height: h } = level;
  const props: string[] = [propLine('name', level.name)];
  if (level.author) props.push(propLine('author', level.author));
  if (level.initialKeys !== 0) props.push(propLine('initialKeys', level.initialKeys));
  if (level.platinum) props.push(propLine('platinum', true));
  for (const [k, v] of Object.entries(level.thresholds) as [
    keyof ThresholdOverrides,
    number | undefined,
  ][]) {
    if (v !== undefined) props.push(propLine(k, v));
  }
  const rows: string[] = [];
  for (let y = 0; y < h; y++)
    rows.push(
      level.terrain
        .slice(y * w, (y + 1) * w)
        .map(gidOf)
        .join(','),
    );
  const objs = [{ ...level.start, kind: 'start' as TileKind }, ...level.objects].map(
    (o, i) =>
      `  <object id="${i + 1}" gid="${gidOf(o.kind)}" x="${o.x * 16}" y="${(o.y + 1) * 16}" width="16" height="16"/>`,
  );
  return `<?xml version="1.0" encoding="UTF-8"?>
<map version="1.10" tiledversion="1.11.2" orientation="orthogonal" renderorder="right-down" width="${w}" height="${h}" tilewidth="16" tileheight="16" infinite="0" nextlayerid="3" nextobjectid="${objs.length + 1}">
 <properties>
${props.join('\n')}
 </properties>
 <tileset firstgid="1" source="${esc(tilesetSource)}"/>
 <layer id="1" name="terrain" width="${w}" height="${h}">
  <data encoding="csv">
${rows.join(',\n')}
</data>
 </layer>
 <objectgroup id="2" name="objects">
${objs.join('\n')}
 </objectgroup>
</map>
`;
}

export function setMapProperty(
  xml: string,
  name: string,
  value: string | number | boolean,
): string {
  const line = propLine(name, value);
  const existing = new RegExp(`^[ \\t]*<property name="${name}"[^>]*/>[ \\t]*$`, 'm');
  const mapOpen = /<map\b[^>]*>/.exec(xml);
  if (!mapOpen) throw new Error('file without <map>');
  const afterMap = mapOpen.index + mapOpen[0].length;
  const rel = xml.slice(afterMap).search(/<(tileset|layer|objectgroup|properties)\b/);
  const start = afterMap + rel;
  if (rel >= 0 && xml.startsWith('<properties>', start)) {
    const end = xml.indexOf('</properties>', start);
    const block = xml.slice(start, end);
    const replaced = existing.test(block)
      ? block.replace(existing, line)
      : `${block.trimEnd()}\n${line}\n `;
    return xml.slice(0, start) + replaced + xml.slice(end);
  }
  return `${xml.slice(0, afterMap)}\n <properties>\n${line}\n </properties>${xml.slice(afterMap)}`;
}
