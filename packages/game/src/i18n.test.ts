import { expect, test } from 'vitest';
import { detectLang, setLang, t } from './i18n';

test('detectLang', () => {
  expect(detectLang(['fr-FR', 'en'])).toBe('fr');
  expect(detectLang(['en-US', 'fr'])).toBe('en');
  expect(detectLang([])).toBe('en');
});

test('t traduit et interpole', () => {
  setLang('fr');
  expect(t('play')).toBe('Jouer');
  expect(t('help', { dirs: 'ZQSD' })).toContain('ZQSD');
  setLang('en');
  expect(t('play')).toBe('Play');
});

test('lockedHint explains what to do to unlock', () => {
  setLang('fr');
  expect(t('lockedHint', { n: 3 })).toBe('Réussis 3 niveaux du chapitre précédent');
  setLang('en');
  expect(t('lockedHint', { n: 3 })).toBe('Complete 3 levels of the previous chapter');
  setLang('fr');
});

test('lockedHintOne au singulier', () => {
  setLang('fr');
  expect(t('lockedHintOne')).toBe('Réussis 1 niveau du chapitre précédent');
  setLang('en');
  expect(t('lockedHintOne')).toBe('Complete 1 level of the previous chapter');
  setLang('fr');
});
