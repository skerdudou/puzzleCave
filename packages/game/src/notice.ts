import { t } from './i18n';
import { setDebug } from './debug';
import { COLORS, FONT, uiScale } from './ui';

/** A short line over the top of the play area for a few seconds; it never takes a touch. */
export function showNotice(text: string, color: string = COLORS.text): void {
  const el = document.createElement('div');
  el.textContent = text;
  el.setAttribute('role', 'status');
  // CSS px, grown with the interface like the canvas' texts
  const s = (n: number) => `${Math.round(n * uiScale())}px`;
  Object.assign(el.style, {
    position: 'fixed',
    top: `calc(env(safe-area-inset-top, 0px) + ${s(104)})`,
    left: '50%',
    transform: 'translateX(-50%)',
    maxWidth: 'calc(100vw - 32px)',
    boxSizing: 'border-box',
    padding: `${s(6)} ${s(12)}`,
    borderRadius: s(6),
    background: 'rgba(0, 0, 0, 0.75)',
    color,
    font: `${s(13)} ${FONT}`,
    textAlign: 'center',
    pointerEvents: 'none',
    transition: 'opacity 0.5s',
    zIndex: '10',
  } satisfies Partial<CSSStyleDeclaration>);
  document.body.append(el);
  setDebug({ notice: text });
  setTimeout(() => (el.style.opacity = '0'), 6000);
  setTimeout(() => el.remove(), 6600);
}

/**
 * A small box in the middle of the screen while a new version is put in place: shown before the
 * reload, and again by the new page until the screen it comes back to is drawn.
 */
export function showUpdating(): void {
  if (document.getElementById('updating')) return;
  const el = document.createElement('div');
  el.id = 'updating';
  el.textContent = t('updating');
  el.setAttribute('role', 'status');
  const s = (n: number) => `${Math.round(n * uiScale())}px`;
  Object.assign(el.style, {
    position: 'fixed',
    top: '50%',
    left: '50%',
    transform: 'translate(-50%, -50%)',
    maxWidth: 'calc(100vw - 32px)',
    boxSizing: 'border-box',
    padding: `${s(10)} ${s(16)}`,
    borderRadius: s(6),
    background: 'rgba(29, 27, 38, 0.92)',
    border: `1px solid ${COLORS.focus}`,
    color: COLORS.text,
    font: `${s(13)} ${FONT}`,
    textAlign: 'center',
    pointerEvents: 'none',
    zIndex: '20',
  } satisfies Partial<CSSStyleDeclaration>);
  document.body.append(el);
  setDebug({ updating: true });
}

/** The box goes (the screen is drawn by the new version). */
export function hideUpdating(): void {
  document.getElementById('updating')?.remove();
  setDebug({ updating: false });
}

/** The toasts waiting for the one on screen to go. */
const toasts: string[] = [];
let toastShown = false;
/** How long a toast stays, ms (its fade included). */
export const TOAST_MS = 3200;

/**
 * An achievement earned: a gold toast at the top of the screen. Several in a row are shown one
 * after the other.
 */
export function showToast(text: string): void {
  toasts.push(text);
  if (!toastShown) nextToast();
}

function nextToast(): void {
  const text = toasts.shift();
  if (text === undefined) {
    toastShown = false;
    return;
  }
  toastShown = true;
  const el = document.createElement('div');
  el.textContent = `★ ${text} ★`;
  el.setAttribute('role', 'status');
  const s = (n: number) => `${Math.round(n * uiScale())}px`;
  Object.assign(el.style, {
    position: 'fixed',
    top: `calc(env(safe-area-inset-top, 0px) + ${s(12)})`,
    left: '50%',
    transform: 'translateX(-50%)',
    maxWidth: 'calc(100vw - 32px)',
    boxSizing: 'border-box',
    padding: `${s(8)} ${s(14)}`,
    border: `${s(2)} solid ${COLORS.accent}`,
    background: 'rgba(20, 14, 4, 0.9)',
    color: COLORS.accent,
    font: `${s(13)} ${FONT}`,
    textAlign: 'center',
    pointerEvents: 'none',
    transition: 'opacity 0.4s',
    zIndex: '11',
  } satisfies Partial<CSSStyleDeclaration>);
  document.body.append(el);
  setDebug({ toast: text });
  setTimeout(() => (el.style.opacity = '0'), TOAST_MS - 400);
  setTimeout(() => {
    el.remove();
    nextToast();
  }, TOAST_MS);
}
