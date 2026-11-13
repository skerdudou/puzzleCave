import { setDebug } from './debug';
import { t } from './i18n';
import { CONFIRM_MS } from './twoPress';
import { COLORS, FONT } from './ui';

export interface ImportReplayOptions {
  title: string;
  /** The level already has a saved replay: Import asks twice. */
  replace: boolean;
  /** Tries the pasted text; false keeps the page open (the text was not a replay). */
  onImport(text: string): boolean;
  onBack(): void;
}

/**
 * Where a replay copied with Export is pasted back, as a page over the game (like journalPage.ts):
 * a text box to paste into, which a phone's keyboard and paste menu serve better than the canvas.
 * Escape or Back goes back to the replay.
 */
export function showImportReplay(opts: ImportReplayOptions): void {
  if (document.getElementById('import-replay')) return;
  const page = document.createElement('div');
  page.id = 'import-replay';
  Object.assign(page.style, {
    position: 'fixed',
    inset: '0',
    display: 'flex',
    flexDirection: 'column',
    background: '#1d1b26',
    color: COLORS.text,
    font: `13px ${FONT}`,
    zIndex: '30',
    padding: '12px',
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
  title.textContent = opts.title;
  Object.assign(title.style, { color: COLORS.accent, flex: '1 1 100%' });
  const hint = document.createElement('div');
  hint.textContent = t('importReplayHint');
  Object.assign(hint.style, { flex: '1 1 100%' });
  bar.append(title, hint);

  const text = document.createElement('textarea');
  text.id = 'import-replay-text';
  text.spellcheck = false;
  Object.assign(text.style, {
    flex: '1',
    minHeight: '0',
    resize: 'none',
    boxSizing: 'border-box',
    color: COLORS.text,
    background: COLORS.panel,
    border: `1px solid ${COLORS.focus}`,
    borderRadius: '4px',
    padding: '8px',
    font: '12px ui-monospace, Menlo, Consolas, monospace',
    lineHeight: '1.45',
  });

  const button = (label: string, fn: (b: HTMLButtonElement) => void) => {
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
    b.addEventListener('click', () => fn(b));
    return b;
  };
  let armed = false;
  let expiry: ReturnType<typeof setTimeout> | undefined;
  const importLabel = t('replayImport');
  const atRest = (b: HTMLButtonElement) => {
    armed = false;
    clearTimeout(expiry);
    b.textContent = importLabel;
    b.style.color = COLORS.text;
  };
  const importButton = button(importLabel, (b) => {
    // over the level's saved replay: asked first, like the other two-press buttons (twoPress.ts),
    // and no longer after CONFIRM_MS
    if (opts.replace && !armed) {
      armed = true;
      // "Sure?" in a button of the same size (at least: a longer word grows it)
      b.style.minWidth = `${b.offsetWidth}px`;
      b.textContent = t('confirmReset');
      b.style.color = '#ff8080';
      expiry = setTimeout(() => atRest(b), CONFIRM_MS);
      return;
    }
    atRest(b);
    opts.onImport(text.value);
  });
  const buttons = document.createElement('div');
  Object.assign(buttons.style, { display: 'flex', gap: '8px', marginTop: '8px' });
  buttons.append(importButton, button(t('back'), opts.onBack));

  page.append(bar, text, buttons);
  document.body.append(page);
  text.focus();
  setDebug({ importReplayOpen: true });
}

/** The page goes (the Import screen is left). */
export function hideImportReplay(): void {
  document.getElementById('import-replay')?.remove();
  setDebug({ importReplayOpen: false });
}
