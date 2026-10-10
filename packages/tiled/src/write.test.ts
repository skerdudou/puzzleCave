import { expect, test } from 'vitest';
import { fromAscii } from '@puzzlecave/core';
import { parseTmx, setMapProperty, TILE_ORDER, writeTmx } from './index';

const TSX = `<tileset name="pc" tilewidth="16" tileheight="16">${TILE_ORDER.map((k, i) => `<tile id="${i}"><properties><property name="kind" value="${k}"/></properties></tile>`).join('')}</tileset>`;
const read = () => TSX;

test('writeTmx → parseTmx gives back the same level', () => {
  const level = fromAscii(['@k,.', '~BDE'], {
    id: 'rt',
    name: 'Round trip',
    author: 'moineau',
    initialKeys: -1,
    platinum: true,
    thresholds: { goldMoves: 9 },
  });
  expect(parseTmx(writeTmx(level), 'rt', read)).toEqual(level);
});

test('setMapProperty adds then replaces a property', () => {
  let xml = writeTmx(fromAscii(['@E'], { id: 'p' }));
  xml = setMapProperty(xml, 'goldMoves', 1);
  expect(parseTmx(xml, 'p', read).thresholds.goldMoves).toBe(1);
  xml = setMapProperty(xml, 'goldMoves', 3);
  expect(parseTmx(xml, 'p', read).thresholds.goldMoves).toBe(3);
  expect(xml.match(/name="goldMoves"/g)).toHaveLength(1);
});

test('setMapProperty creates <properties> when missing', () => {
  const xml = writeTmx(fromAscii(['@E'], { id: 'q' })).replace(
    / <properties>[\s\S]*?<\/properties>\n/,
    '',
  );
  expect(xml).not.toContain('<properties>');
  expect(parseTmx(setMapProperty(xml, 'platinum', true), 'q', read).platinum).toBe(true);
});
