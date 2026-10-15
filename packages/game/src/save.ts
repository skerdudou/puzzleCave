import type { LevelRecord, Medal } from '@puzzlecave/core';
import { isLang, type Lang } from './i18n';
import { DRAG_STEP_DEFAULT, OLD_DRAG_STEP_DEFAULT, nearestDragStep } from './input/drag';
import { isTouchControl, type TouchControl } from './input/tapZones';

export interface Settings {
  /** the music (the name is older than the sound effects) */
  sound: boolean;
  /** sound effects */
  sfx: boolean;
  lang: Lang | null;
  /** continuous drag: CSS pixels per move (one of DRAG_STEPS) */
  dragStep: number;
  /**
   * The default dragStep when this save was written: a dragStep still equal to it follows the
   * default when it changes (a value the player chose stays).
   */
  dragStepDefault: number;
  vibration: boolean;
  repeatRate: number;
  /** touch control: continuous drag (default) or tap zones; the d-pad works with both */
  touchControl: TouchControl;
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
/** The save format written by this version of the game. */
export const SAVE_VERSION = 1;

/**
 * Turns a save of version `n` (the key) into one of version `n + 1`. A new format adds its step
 * here and raises SAVE_VERSION (and SaveData's `version`): older saves are carried over, never
 * reset. A field added with a default needs no step: the sanitising fills it in.
 */
export type Migration = (save: Record<string, unknown>) => Record<string, unknown>;
export const MIGRATIONS: Readonly<Record<number, Migration>> = {};

/** A parsed save brought to version `target`; throws on an unknown (or newer) version. */
export function migrate(
  save: Record<string, unknown>,
  migrations: Readonly<Record<number, Migration>> = MIGRATIONS,
  target: number = SAVE_VERSION,
): Record<string, unknown> {
  let s = save;
  for (;;) {
    const v = s.version;
    if (typeof v !== 'number' || !Number.isInteger(v) || v < 1 || v > target)
      throw new Error('version');
    if (v === target) return s;
    const step = migrations[v];
    if (!step) throw new Error(`no migration from version ${v}`);
    s = { ...step(s), version: v + 1 };
  }
}

/** A save read from its JSON text (stored, or a file the player imports); throws if unusable. */
export function parseSave(raw: string): SaveData {
  const parsed: unknown = JSON.parse(raw);
  if (!isRecord(parsed)) throw new Error('format');
  const obj = migrate(parsed);
  if (!isRecord(obj.levels)) throw new Error('format');
  return {
    version: 1,
    settings: sanitiseSettings(obj.settings),
    levels: sanitiseLevels(obj.levels),
  };
}

/** The save as a file for the player to keep (Options › Export). */
export function exportSave(d: SaveData): string {
  return JSON.stringify(d, null, 2);
}

export function defaultSave(): SaveData {
  return {
    version: 1,
    settings: {
      sound: true,
      sfx: true,
      lang: null,
      dragStep: DRAG_STEP_DEFAULT,
      dragStepDefault: DRAG_STEP_DEFAULT,
      repeatRate: 10,
      vibration: true,
      touchControl: 'drag',
    },
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
  const isNum = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
  // the default the save was written with (saves from before the field: the old one)
  const savedDefault = isNum(s.dragStepDefault) ? s.dragStepDefault : OLD_DRAG_STEP_DEFAULT;
  return {
    sound: typeof s.sound === 'boolean' ? s.sound : d.sound,
    sfx: typeof s.sfx === 'boolean' ? s.sfx : d.sfx,
    lang,
    // older saves had a swipe threshold instead: they get the default distance; a distance
    // left at the default of its time follows the current default
    dragStep:
      isNum(s.dragStep) && s.dragStep !== savedDefault ? nearestDragStep(s.dragStep) : d.dragStep,
    dragStepDefault: d.dragStepDefault,
    repeatRate: clampNumber(s.repeatRate, 4, 20, d.repeatRate),
    vibration: typeof s.vibration === 'boolean' ? s.vibration : d.vibration,
    touchControl: touchControlOf(s),
  };
}

/**
 * The touch control of a save. Older saves had optional tap zones next to the drag (`tapZones`:
 * 'off', or centred on the screen or on the player): any zones on → tap zones; else the drag.
 */
function touchControlOf(s: Record<string, unknown>): TouchControl {
  if (isTouchControl(s.touchControl)) return s.touchControl;
  return s.tapZones === 'screen' || s.tapZones === 'player' ? 'tap' : 'drag';
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
  if (isCount(raw.masterBestMoves)) rec.masterBestMoves = raw.masterBestMoves;
  if (isCount(raw.masterBestTimeMs)) rec.masterBestTimeMs = raw.masterBestTimeMs;
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
      return parseSave(raw);
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
