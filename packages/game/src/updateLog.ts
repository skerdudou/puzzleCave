import { PREVIEW, PREVIEW_SHA } from './preview';

/**
 * The preview's update journal: what the service worker and the update gate did (checks, new
 * versions found, applied, reloads), kept in localStorage across reloads and shared by the
 * preview's tabs (each line says which tab), to understand an update that came when it should
 * not have. Read from the main menu's Journal button. Nothing is kept in the release.
 */

export const LOG_KEY = 'puzzlecave.preview.updatelog';
/** The journal keeps this many lines, the latest. */
export const LOG_MAX = 80;

export interface LogLine {
  /** when, ms since 1970 */
  t: number;
  /** the tab (a short id kept for the tab's life, reloads included) */
  tab: string;
  /** the version that wrote the line */
  v: string;
  /** the screen shown then, if any */
  scene: string;
  /** what happened */
  what: string;
}

interface Store {
  getItem(k: string): string | null;
  setItem(k: string, v: string): void;
}

/** The lines kept, oldest first (none when unreadable). */
export function readLog(store: Store | null): LogLine[] {
  try {
    const raw = store?.getItem(LOG_KEY);
    const v: unknown = raw ? JSON.parse(raw) : [];
    return Array.isArray(v) ? (v as LogLine[]) : [];
  } catch {
    return [];
  }
}

/** Adds a line, keeping the latest `max`. */
export function appendLog(store: Store | null, line: LogLine, max = LOG_MAX): void {
  if (!store) return;
  try {
    store.setItem(LOG_KEY, JSON.stringify([...readLog(store), line].slice(-max)));
  } catch {
    /* storage full or blocked: not kept */
  }
}

const pad = (n: number, w = 2) => String(n).padStart(w, '0');

/** One line as text: "2026-11-07 21:24:38.120 [tab k3f] d15be5a Options — what". */
export function formatLine(l: LogLine): string {
  const d = new Date(l.t);
  const day = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  const time = `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}.${pad(d.getMilliseconds(), 3)}`;
  return `${day} ${time} [tab ${l.tab}] ${l.v} ${l.scene || '-'} — ${l.what}`;
}

const storage = (): Storage | null => {
  try {
    return typeof localStorage === 'undefined' ? null : localStorage;
  } catch {
    return null;
  }
};

/** This tab's id: kept in sessionStorage, so a reload keeps it and another tab has its own. */
const tabId: string = (() => {
  const make = () => Math.random().toString(36).slice(2, 5);
  try {
    const k = 'puzzlecave.preview.tab';
    const id = sessionStorage.getItem(k) ?? make();
    sessionStorage.setItem(k, id);
    return id;
  } catch {
    return make();
  }
})();

/** The screen shown now, told by pwa.ts (the journal has no access to Phaser). */
let currentScene = '';
export const logScene = (scene: string): void => {
  currentScene = scene;
};

/** Writes a line to the preview's journal (nothing in the release). */
export function logUpdate(what: string): void {
  if (!PREVIEW) return;
  appendLog(storage(), {
    t: Date.now(),
    tab: tabId,
    v: PREVIEW_SHA || '?',
    scene: currentScene,
    what,
  });
}

/** The journal as text, latest line first. */
export const logText = (): string =>
  readLog(storage()).slice().reverse().map(formatLine).join('\n');
