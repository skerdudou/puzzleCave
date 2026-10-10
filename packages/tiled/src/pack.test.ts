import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, join } from 'node:path';
import { expect, test } from 'vitest';
import { fromAscii } from '@puzzlecave/core';
import { loadPack, TILE_ORDER, writeTmx } from './index';

const TSX = `<?xml version="1.0" encoding="UTF-8"?>\n<tileset name="pc" tilewidth="16" tileheight="16">${TILE_ORDER.map((k, i) => `<tile id="${i}"><properties><property name="kind" value="${k}"/></properties></tile>`).join('')}</tileset>`;

function fixture(files: Record<string, string>): string {
  const dir = mkdtempSync(join(tmpdir(), 'pc-pack-'));
  for (const [name, content] of Object.entries(files)) writeFileSync(join(dir, name), content);
  return dir;
}
const chapters = (levels: string[]) =>
  JSON.stringify([{ id: 'c1', name: { fr: 'Un', en: 'One' }, unlockAfter: 0, levels }]);
const emptyCell = (xml: string) =>
  xml.replace(/<data encoding="csv">\n(\d+)/, '<data encoding="csv">\n0');

test('loads levels and chapters, lists the files to watch', () => {
  const dir = fixture({
    'tileset.tsx': TSX,
    'a.tmx': writeTmx(fromAscii(['@E'], { id: 'a' })),
    'chapters.json': chapters(['a']),
  });
  const pack = loadPack(dir);
  expect(pack.errors).toEqual([]);
  expect(pack.levels.map((l) => l.id)).toEqual(['a']);
  expect(pack.chapters[0]?.levels).toEqual(['a']);
  expect(pack.files.map((f) => basename(f)).sort()).toEqual([
    'a.tmx',
    'chapters.json',
    'tileset.tsx',
  ]);
});

test('collects errors per file', () => {
  const dir = fixture({
    'tileset.tsx': TSX,
    'bad.tmx': emptyCell(writeTmx(fromAscii(['@E'], { id: 'bad' }))),
    'nox.tmx': writeTmx(fromAscii(['@.'], { id: 'nox' })),
    'chapters.json': chapters(['bad', 'nox', 'ghost']),
  });
  const { errors } = loadPack(dir);
  expect(errors).toContainEqual(expect.stringMatching(/^bad\.tmx: empty cell/));
  expect(errors).toContainEqual(expect.stringMatching(/^nox\.tmx: no exit/));
  expect(errors).toContainEqual(expect.stringMatching(/unknown level "ghost"/));
});

test('chapters.json missing', () => {
  const dir = fixture({ 'tileset.tsx': TSX, 'a.tmx': writeTmx(fromAscii(['@E'], { id: 'a' })) });
  expect(loadPack(dir).errors).toContainEqual(expect.stringMatching(/chapters\.json missing/));
});
