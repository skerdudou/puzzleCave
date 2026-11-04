// The banner over a level as it starts (pure, no Phaser): master mode's rules, the keys the
// player starts with when not 0.
import { formatTime } from './format';
import { t } from './i18n';

export interface IntroInfo {
  master: boolean;
  /** master mode: its time limit, ms (none without time medals) */
  timeLimitMs?: number;
  /** the player has already won a level in master mode: the rules on one short line */
  masterVeteran: boolean;
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
  const lines: string[] = [];
  if (i.master) {
    const time = i.timeLimitMs === undefined ? undefined : formatTime(i.timeLimitMs);
    if (i.masterVeteran) lines.push(time ? `${t('masterShort')} · ≤ ${time}` : t('masterShort'));
    else {
      lines.push(t('masterRules'));
      if (time) lines.push(t('masterTimeRule', { time }));
    }
  }
  const keys = keysLine(i.initialKeys);
  if (keys) lines.push(keys);
  return lines;
}
