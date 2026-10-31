import {
  bestMasterMedal,
  masterMedalFor,
  type LevelRecord,
  type MasterMedal,
  type Medal,
  type Thresholds,
} from '@puzzlecave/core';
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
  /** cave ambience: the torch's light around the player */
  torchlight: boolean;
  /** cave ambience: drifting dust motes */
  dust: boolean;
}
export interface SaveData {
  version: 2;
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
export const SAVE_VERSION = 2;

/** What the migrations may need to know about the game's levels. */
export interface SaveContext {
  /** a level's thresholds when it has master mode; undefined otherwise (or an unknown level) */
  masterThresholds(levelId: string): Thresholds | undefined;
}
/** No level known: a migration derives nothing from the thresholds. */
export const NO_LEVELS: SaveContext = { masterThresholds: () => undefined };

/**
 * Turns a save of version `n` (the key) into one of version `n + 1`. A new format adds its step
 * here and raises SAVE_VERSION (and SaveData's `version`): older saves are carried over, never
 * reset. A field added with a default needs no step: the sanitising fills it in.
 */
export type Migration = (
  save: Record<string, unknown>,
  ctx: SaveContext,
) => Record<string, unknown>;
export const MIGRATIONS: Readonly<Record<number, Migration>> = {
  1: masterMedals,
};

/**
 * Version 1 → 2: master mode's single platinum medal (`medals.platinum: true`) became two,
 * master and grand master (`medals.master`). A platinum is a grand master; a level's best master
 * run (`masterBestMoves`) also earns the medal it qualifies for under the level's current limits
 * (a master run within gold, short of platinum, earns master). That run's time is unknown
 * (`masterBestTimeMs` is a separate minimum, maybe of another run): on a level with time medals it
 * earns master at most, as grand master also needs the silver time.
 */
function masterMedals(save: Record<string, unknown>, ctx: SaveContext): Record<string, unknown> {
  if (!isRecord(save.levels)) return save;
  const levels: Record<string, unknown> = {};
  for (const [id, raw] of Object.entries(save.levels)) {
    if (!isRecord(raw) || !isRecord(raw.medals)) {
      levels[id] = raw;
      continue;
    }
    const { platinum, ...medals } = raw.medals;
    const th = ctx.masterThresholds(id);
    const derived =
      th && isCount(raw.masterBestMoves)
        ? masterMedalFor(th, raw.masterBestMoves, Infinity)
        : undefined;
    const master = bestMasterMedal(platinum === true ? 'grandMaster' : undefined, derived);
    if (master) medals.master = master;
    levels[id] = { ...raw, medals };
  }
  return { ...save, levels };
}

/** A parsed save brought to version `target`; throws on an unknown (or newer) version. */
export function migrate(
  save: Record<string, unknown>,
  migrations: Readonly<Record<number, Migration>> = MIGRATIONS,
  target: number = SAVE_VERSION,
  ctx: SaveContext = NO_LEVELS,
): Record<string, unknown> {
  let s = save;
  for (;;) {
    const v = s.version;
    if (typeof v !== 'number' || !Number.isInteger(v) || v < 1 || v > target)
      throw new Error('version');
    if (v === target) return s;
    const step = migrations[v];
    if (!step) throw new Error(`no migration from version ${v}`);
    s = { ...step(s, ctx), version: v + 1 };
  }
}

/** A save read from its JSON text (stored, or a file the player imports); throws if unusable. */
export function parseSave(raw: string, ctx: SaveContext = NO_LEVELS): SaveData {
  const parsed: unknown = JSON.parse(raw);
  if (!isRecord(parsed)) throw new Error('format');
  const obj = migrate(parsed, MIGRATIONS, SAVE_VERSION, ctx);
  if (!isRecord(obj.levels)) throw new Error('format');
  return {
    version: 2,
    settings: sanitiseSettings(obj.settings),
    levels: sanitiseLevels(obj.levels),
  };
}

/** First line of an exported file; the encoded save follows on the next one. */
export const EXPORT_HEADER = 'puzzlecave-save-1';

/**
 * The save as a file for the player to keep (Options › Export): not readable as it is, and with a
 * hash that importSave checks. It stops a quick edit by hand, nothing more: the key is in the
 * game's code.
 */
export function exportSave(d: SaveData): string {
  const json = new TextEncoder().encode(JSON.stringify(d));
  const bytes = new Uint8Array(4 + json.length);
  new DataView(bytes.buffer).setUint32(0, fnv1a(json));
  bytes.set(json, 4);
  scramble(bytes);
  return `${EXPORT_HEADER}\n${toBase64(bytes)}\n`;
}

/** A file from Export read back (Options › Import); throws if unusable or changed. */
export function importSave(text: string, ctx: SaveContext = NO_LEVELS): SaveData {
  const [head, body, ...rest] = text.trim().split(/\r?\n/);
  if (head !== EXPORT_HEADER || body === undefined || rest.length > 0) throw new Error('format');
  const bytes = fromBase64(body);
  if (bytes.length < 4) throw new Error('format');
  scramble(bytes);
  const json = bytes.subarray(4);
  if (new DataView(bytes.buffer).getUint32(0) !== fnv1a(json)) throw new Error('hash');
  return parseSave(new TextDecoder('utf-8', { fatal: true }).decode(json), ctx);
}

/** 32-bit FNV-1a of the bytes, salted so that a plain FNV-1a does not match. */
function fnv1a(bytes: Uint8Array): number {
  let h = 0x811c9dc5 ^ 0x5ca1ab1e;
  for (const b of bytes) h = Math.imul(h ^ b, 0x01000193);
  return h >>> 0;
}

/** XORs the bytes with a fixed xorshift32 stream, in place: applied twice, it gives them back. */
function scramble(bytes: Uint8Array): void {
  let x = 0x9e3779b9;
  for (let i = 0; i < bytes.length; i++) {
    x ^= x << 13;
    x ^= x >>> 17;
    x ^= x << 5;
    bytes[i]! ^= x & 0xff;
  }
}

function toBase64(bytes: Uint8Array): string {
  let s = '';
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s);
}

/** Throws on text that is not base64 (atob does). */
function fromBase64(text: string): Uint8Array {
  return Uint8Array.from(atob(text), (c) => c.charCodeAt(0));
}

export function defaultSave(): SaveData {
  return {
    version: 2,
    settings: {
      sound: true,
      sfx: true,
      lang: null,
      dragStep: DRAG_STEP_DEFAULT,
      dragStepDefault: DRAG_STEP_DEFAULT,
      repeatRate: 10,
      vibration: true,
      touchControl: 'drag',
      torchlight: true,
      dust: true,
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
    torchlight: typeof s.torchlight === 'boolean' ? s.torchlight : d.torchlight,
    dust: typeof s.dust === 'boolean' ? s.dust : d.dust,
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
const isMasterMedal = (v: unknown): v is MasterMedal => v === 'master' || v === 'grandMaster';
const isCount = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v) && v >= 0;

function sanitiseRecord(raw: unknown): LevelRecord | null {
  if (!isRecord(raw)) return null;
  const m = isRecord(raw.medals) ? raw.medals : {};
  const medals: LevelRecord['medals'] = {};
  if (isMedal(m.moves)) medals.moves = m.moves;
  if (isMedal(m.time)) medals.time = m.time;
  if (isMasterMedal(m.master)) medals.master = m.master;
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
  private readonly ctx: SaveContext;
  constructor(storage: KV | null, ctx: SaveContext = NO_LEVELS) {
    this.storage = storage;
    this.ctx = ctx;
  }

  load(): SaveData {
    if (!this.storage) return defaultSave();
    let raw: string | null = null;
    try {
      raw = this.storage.getItem(SAVE_KEY);
      if (raw === null) return defaultSave();
      return parseSave(raw, this.ctx);
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
