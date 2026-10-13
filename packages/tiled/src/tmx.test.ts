import { expect, test } from 'vitest';
import { parseTileset, parseTmx, TILE_ORDER } from './index';

const TSX = `<?xml version="1.0" encoding="UTF-8"?>
<tileset version="1.10" name="pc" tilewidth="16" tileheight="16" tilecount="9" columns="9">
 <image source="tileset.png" width="144" height="16"/>
${TILE_ORDER.map((k, i) => ` <tile id="${i}"><properties><property name="kind" value="${k}"/></properties></tile>`).join('\n')}
</tileset>`;
const read = () => TSX;
// gid = 1 + TILE_ORDER index: floor 1, gravel 2, water 3, wall 4, exit 5, start 6, key 7, door 8, block 9
const tmx = (
  data: string,
  objects = '',
  props = '',
  enc = 'csv',
  w = 3,
  h = 2,
) => `<?xml version="1.0" encoding="UTF-8"?>
<map version="1.10" orientation="orthogonal" width="${w}" height="${h}" tilewidth="16" tileheight="16">
 <properties>${props}</properties>
 <tileset firstgid="1" source="tileset.tsx"/>
 <layer id="1" name="terrain" width="${w}" height="${h}"><data encoding="${enc}">
${data}
</data></layer>
 <objectgroup id="2" name="objects">${objects}</objectgroup>
</map>`;

test('parseTileset reads the kind property', () => {
  const m = parseTileset(TSX);
  expect(m.get(0)).toBe('floor');
  expect(m.get(8)).toBe('block');
});

test('CSV terrain + objects anchored at the bottom left + properties', () => {
  const l = parseTmx(
    tmx(
      '1,2,3,\n4,1,5',
      '<object id="1" gid="6" x="0" y="16" width="16" height="16"/><object id="2" gid="7" x="16" y="32" width="16" height="16"/>',
      '<property name="name" value="Essai"/><property name="initialKeys" type="int" value="-2"/><property name="platinum" type="bool" value="true"/><property name="goldMoves" type="int" value="12"/><property name="platinumMoves" type="int" value="10"/><property name="goldTime" type="float" value="7.5"/>',
    ),
    'essai',
    read,
  );
  expect(l).toEqual({
    id: 'essai',
    name: 'Essai',
    width: 3,
    height: 2,
    terrain: ['floor', 'gravel', 'water', 'wall', 'floor', 'exit'],
    objects: [{ x: 1, y: 1, kind: 'key' }],
    start: { x: 0, y: 0 },
    initialKeys: -2,
    thresholds: { goldMoves: 12, platinumMoves: 10, goldTime: 7.5 },
  });
});

test('objects painted directly in the tile layer', () => {
  const l = parseTmx(tmx('6,7,8,\n9,1,5'), 'p', read);
  expect(l.start).toEqual({ x: 0, y: 0 });
  expect(l.terrain.slice(0, 4)).toEqual(['floor', 'floor', 'floor', 'floor']);
  expect(l.objects).toEqual([
    { x: 1, y: 0, kind: 'key' },
    { x: 2, y: 0, kind: 'door' },
    { x: 0, y: 1, kind: 'block' },
  ]);
});

test('flip/rotation bits ignored', () => {
  const flipped = (4 | 0x80000000) >>> 0; // horizontally flipped wall
  const l = parseTmx(tmx(`6,1,1,\n${flipped},1,5`), 'f', read);
  expect(l.terrain[3]).toBe('wall');
});

test('non-square map accepted', () => {
  const l = parseTmx(tmx('6,1,1,1,5', '', '', 'csv', 5, 1), 'r', read);
  expect([l.width, l.height]).toEqual([5, 1]);
});

test('non-CSV encoding: explicit message', () => {
  expect(() => parseTmx(tmx('AAAA', '', '', 'base64'), 'b', read)).toThrow(/CSV/);
});

test('empty cell and missing/multiple start rejected', () => {
  expect(() => parseTmx(tmx('6,0,1,\n1,1,5'), 'v', read)).toThrow(/empty cell at \(1,0\)/);
  expect(() => parseTmx(tmx('1,1,1,\n1,1,5'), 'n', read)).toThrow(/exactly one start/);
  expect(() => parseTmx(tmx('6,6,1,\n1,1,5'), 'm', read)).toThrow(/exactly one start/);
});

test('terrain placed as an object rejected', () => {
  expect(() =>
    parseTmx(tmx('6,1,1,\n1,1,5', '<object id="1" gid="4" x="16" y="16"/>'), 'o', read),
  ).toThrow(/terrain/);
});
