import { expect, test } from 'vitest';
import { detectLang, setLang, t } from './i18n';

test('detectLang picks the first supported language of the browser preferences, else English', () => {
  expect(detectLang(['fr-FR', 'en'])).toBe('fr');
  expect(detectLang(['en-US', 'fr'])).toBe('en');
  expect(detectLang(['de-DE', 'fr-CH', 'en'])).toBe('fr');
  expect(detectLang(['de-DE', 'es'])).toBe('en');
  expect(detectLang(['FR'])).toBe('fr');
  expect(detectLang([])).toBe('en');
});

test('t translates and interpolates', () => {
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

test('lockedHintOne is singular', () => {
  setLang('fr');
  expect(t('lockedHintOne')).toBe('Réussis 1 niveau du chapitre précédent');
  setLang('en');
  expect(t('lockedHintOne')).toBe('Complete 1 level of the previous chapter');
  setLang('fr');
});
