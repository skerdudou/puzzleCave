// The banner over a level as it starts (pure, no Phaser): the keys the player starts with when
// not 0. (Master mode's rules are not repeated there: the box of the select screen gives them.)
import { t } from './i18n';

export interface IntroInfo {
  initialKeys: number;
}

/** The keys at start, said when not 0 ("Keys at start: -12 · Pick up 13 keys…"); else null. */
export function keysLine(initialKeys: number): string | null {
  if (initialKeys === 0) return null;
  const start = t('keysStart', { n: initialKeys });
  // a door opens only with more than 0 keys
  return initialKeys > 0 ? start : `${start} · ${t('keysDebt', { need: 1 - initialKeys })}`;
}

/** The banner's lines, without its hint; none: no banner. */
export function introLines(i: IntroInfo): string[] {
  const keys = keysLine(i.initialKeys);
  return keys ? [keys] : [];
}
