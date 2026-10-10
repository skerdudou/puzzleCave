import { expect, test } from 'vitest';
import { LANGS, detectLang, messages, nextLang, setLang, t } from './i18n';

test('detectLang picks the first supported language of the browser preferences, else English', () => {
  expect(detectLang(['fr-FR', 'en'])).toBe('fr');
  expect(detectLang(['en-US', 'fr'])).toBe('en');
  expect(detectLang(['de-DE', 'fr-CH', 'en'])).toBe('de');
  expect(detectLang(['pt-BR', 'es-MX', 'it'])).toBe('es');
  expect(detectLang(['it'])).toBe('it');
  expect(detectLang(['pt-BR', 'ja'])).toBe('en');
  expect(detectLang(['FR'])).toBe('fr');
  expect(detectLang([])).toBe('en');
});

test('every language has every message, with the same placeholders as English', () => {
  expect(LANGS).toEqual(['en', 'fr', 'de', 'es', 'it']);
  const holes = (s: string) => [...s.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort();
  const en = messages('en');
  for (const lang of LANGS) {
    const dict = messages(lang);
    expect(Object.keys(dict).sort(), lang).toEqual(Object.keys(en).sort());
    for (const [k, v] of Object.entries(dict)) {
      expect(v.trim(), `${lang}.${k}`).not.toBe('');
      expect(holes(v), `${lang}.${k}`).toEqual(holes(en[k as keyof typeof en]));
    }
  }
});

test('the language option cycles through every language', () => {
  const seen = [LANGS[0]!];
  for (let i = 1; i < LANGS.length; i++) seen.push(nextLang(seen[i - 1]!));
  expect(seen).toEqual(LANGS);
  expect(nextLang(LANGS[LANGS.length - 1]!)).toBe(LANGS[0]);
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
