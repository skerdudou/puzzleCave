import type { LevelRecord, Medal } from '@puzzlecave/core';
import { isLang, type Lang } from './i18n';

export interface Settings {
  sound: boolean;
  lang: Lang | null;
  swipeThreshold: number;
  repeatRate: number;
}
export interface SaveData {
  version: 1;
  settings: Settings;
  levels: Record<string, LevelRecord>;
}
export interface KV {
  getItem(k: string): string | null;
  setItem(k: string, v: string): void;
}

export const SAVE_KEY = 'puzzlecave.save.v1';
export const CORRUPT_KEY = 'puzzlecave.save.corrupt';

export function defaultSave(): SaveData {
  return {
    version: 1,
    settings: { sound: true, lang: null, swipeThreshold: 30, repeatRate: 10 },
    levels: {},
  };
}

export function browserStorage(): KV | null {
  try {
    const s = globalThis.localStorage;
    s.setItem('__pc_test', '1');
    s.removeItem('__pc_test');
    return s;
  } catch {
    return null;
  }
}

function clampNumber(v: unknown, lo: number, hi: number, fallback: number): number {
  return typeof v === 'number' && Number.isFinite(v) ? Math.min(hi, Math.max(lo, v)) : fallback;
}

function sanitiseSettings(raw: unknown): Settings {
  const d = defaultSave().settings;
  const s: Record<string, unknown> =
    typeof raw === 'object' && raw !== null && !Array.isArray(raw)
      ? (raw as Record<string, unknown>)
      : {};
  const lang = isLang(s.lang) || s.lang === null ? s.lang : d.lang;
  return {
    sound: typeof s.sound === 'boolean' ? s.sound : d.sound,
    lang,
    swipeThreshold: clampNumber(s.swipeThreshold, 10, 80, d.swipeThreshold),
    repeatRate: clampNumber(s.repeatRate, 4, 20, d.repeatRate),
  };
}

const isRecord = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v);
const isMedal = (v: unknown): v is Medal => v === 'gold' || v === 'silver' || v === 'bronze';
const isCount = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v) && v >= 0;

function sanitiseRecord(raw: unknown): LevelRecord | null {
  if (!isRecord(raw)) return null;
  const m = isRecord(raw.medals) ? raw.medals : {};
  const medals: LevelRecord['medals'] = {};
  if (isMedal(m.moves)) medals.moves = m.moves;
  if (isMedal(m.time)) medals.time = m.time;
  if (typeof m.platinum === 'boolean') medals.platinum = m.platinum;
  const rec: LevelRecord = { completed: raw.completed === true, medals };
  if (isCount(raw.bestMoves)) rec.bestMoves = raw.bestMoves;
  if (isCount(raw.bestTimeMs)) rec.bestTimeMs = raw.bestTimeMs;
  return rec;
}

function sanitiseLevels(raw: Record<string, unknown>): Record<string, LevelRecord> {
  const out: Record<string, LevelRecord> = {};
  for (const [id, r] of Object.entries(raw)) {
    const rec = sanitiseRecord(r);
    if (rec) out[id] = rec;
  }
  return out;
}

export class SaveStore {
  private readonly storage: KV | null;
  constructor(storage: KV | null) {
    this.storage = storage;
  }

  load(): SaveData {
    if (!this.storage) return defaultSave();
    let raw: string | null = null;
    try {
      raw = this.storage.getItem(SAVE_KEY);
      if (raw === null) return defaultSave();
      const obj = JSON.parse(raw) as Partial<SaveData>;
      const levels: unknown = obj.levels;
      if (
        obj.version !== 1 ||
        typeof levels !== 'object' ||
        levels === null ||
        Array.isArray(levels)
      ) {
        throw new Error('format');
      }
      return {
        version: 1,
        settings: sanitiseSettings(obj.settings),
        levels: sanitiseLevels(levels as Record<string, unknown>),
      };
    } catch {
      try {
        if (raw !== null) this.storage.setItem(CORRUPT_KEY, raw);
      } catch {
        /* storage unusable: no copy */
      }
      return defaultSave();
    }
  }

  save(d: SaveData): boolean {
    if (!this.storage) return false;
    try {
      this.storage.setItem(SAVE_KEY, JSON.stringify(d));
      return true;
    } catch {
      return false;
    }
  }
}
