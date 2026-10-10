import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { validateChapters, validateLevel, type Chapter, type LevelData } from '@puzzlecave/core';
import { parseTmx } from './tmx';

export interface LevelPack {
  levels: LevelData[];
  chapters: Chapter[];
  errors: string[];
  files: string[];
}

export function loadPack(dir: string): LevelPack {
  const levels: LevelData[] = [];
  const errors: string[] = [];
  const files = new Set<string>();
  const tmxFiles = existsSync(dir)
    ? readdirSync(dir)
        .filter((f) => f.endsWith('.tmx'))
        .sort()
    : [];

  for (const file of tmxFiles) {
    const path = join(dir, file);
    files.add(path);
    const id = file.slice(0, -'.tmx'.length);
    try {
      const level = parseTmx(readFileSync(path, 'utf8'), id, (source) => {
        const tsPath = resolve(dirname(path), source);
        files.add(tsPath);
        return readFileSync(tsPath, 'utf8');
      });
      const errs = validateLevel(level);
      if (errs.length) errors.push(...errs.map((e) => `${file}: ${e}`));
      else levels.push(level);
    } catch (err) {
      errors.push(`${file}: ${(err as Error).message}`);
    }
  }

  let chapters: Chapter[] = [];
  const chaptersPath = join(dir, 'chapters.json');
  if (existsSync(chaptersPath)) {
    files.add(chaptersPath);
    try {
      const raw: unknown = JSON.parse(readFileSync(chaptersPath, 'utf8'));
      const ids = new Set(tmxFiles.map((f) => f.slice(0, -'.tmx'.length)));
      const errs = validateChapters(raw, ids);
      if (errs.length) errors.push(...errs.map((e) => `chapters.json: ${e}`));
      else chapters = raw as Chapter[];
    } catch (err) {
      errors.push(`chapters.json: ${(err as Error).message}`);
    }
  } else if (tmxFiles.length) {
    errors.push('chapters.json missing');
  }

  return { levels, chapters, errors, files: [...files] };
}
