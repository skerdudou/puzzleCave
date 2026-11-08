import { setDebug } from './debug';
import { COLORS, FONT } from './ui';
import { LOG_KEY, logText } from './updateLog';

/**
 * The preview's update journal, as a page over the game (main menu › Journal): the lines, latest
 * first, to read or screenshot; Share sends them as text (to oneself by mail, a message…), to
 * pass them on from a phone. Escape or Close goes back to the menu.
 */
export function showJournal(close: () => void): void {
  if (document.getElementById('journal')) return;
  const page = document.createElement('div');
  page.id = 'journal';
  Object.assign(page.style, {
    position: 'fixed',
    inset: '0',
    display: 'flex',
    flexDirection: 'column',
    background: '#1d1b26',
    color: COLORS.text,
    font: `13px ${FONT}`,
    zIndex: '30',
    padding: '12px 12px 0',
    boxSizing: 'border-box',
  } satisfies Partial<CSSStyleDeclaration>);

  const bar = document.createElement('div');
  Object.assign(bar.style, {
    display: 'flex',
    flexWrap: 'wrap',
    gap: '8px',
    alignItems: 'center',
    marginBottom: '8px',
  });
  const title = document.createElement('div');
  title.textContent = 'Journal des mises à jour';
  Object.assign(title.style, { color: COLORS.accent, flex: '1 1 100%' });
  bar.append(title);

  const text = document.createElement('pre');
  const fill = () => {
    const t = logText();
    text.textContent = t || '(vide)';
    setDebug({ journalLines: t ? t.split('\n').length : 0 });
  };
  Object.assign(text.style, {
    flex: '1',
    overflow: 'auto',
    margin: '0',
    padding: '8px 0 24px',
    whiteSpace: 'pre-wrap',
    wordBreak: 'break-word',
    font: '12px ui-monospace, Menlo, Consolas, monospace',
    lineHeight: '1.45',
    userSelect: 'text',
  });

  const button = (label: string, fn: () => void) => {
    const b = document.createElement('button');
    b.textContent = label;
    Object.assign(b.style, {
      font: `13px ${FONT}`,
      color: COLORS.text,
      background: COLORS.panel,
      border: `1px solid ${COLORS.focus}`,
      borderRadius: '4px',
      padding: '10px 14px',
      minHeight: '44px',
    });
    b.addEventListener('click', fn);
    bar.append(b);
    return b;
  };
  if (typeof navigator.share === 'function')
    button('Partager', () => {
      void navigator.share({ title: 'puzzleCave preview — journal', text: logText() }).catch(() => {
        /* cancelled */
      });
    });
  button('Effacer', () => {
    try {
      localStorage.removeItem(LOG_KEY);
    } catch {
      /* nothing kept anyway */
    }
    fill();
  });
  button('Fermer', close);

  fill();
  page.append(bar, text);
  document.body.append(page);
  setDebug({ journalOpen: true });
}

/** The page goes (the Journal screen is left). */
export function hideJournal(): void {
  document.getElementById('journal')?.remove();
  setDebug({ journalOpen: false });
}
