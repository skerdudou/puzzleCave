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
