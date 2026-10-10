import { expect, test } from 'vitest';
import { CORRUPT_KEY, SAVE_KEY, SaveStore, defaultSave, type KV } from './save';

const mem = (init: Record<string, string> = {}): KV & { data: Record<string, string> } => {
  const data = { ...init };
  return { data, getItem: (k) => data[k] ?? null, setItem: (k, v) => void (data[k] = v) };
};

test('no storage: default save, save returns false', () => {
  const s = new SaveStore(null);
  expect(s.load()).toEqual(defaultSave());
  expect(s.save(defaultSave())).toBe(false);
});

test('round trip', () => {
  const kv = mem();
  const d = defaultSave();
  d.levels['pc-01'] = { completed: true, bestMoves: 12, medals: { moves: 'gold' } };
  d.settings.sound = false;
  expect(new SaveStore(kv).save(d)).toBe(true);
  expect(new SaveStore(kv).load()).toEqual(d);
});

test('corrupted content: set aside, start from scratch', () => {
  const kv = mem({ [SAVE_KEY]: '{oups' });
  expect(new SaveStore(kv).load()).toEqual(defaultSave());
  expect(kv.data[CORRUPT_KEY]).toBe('{oups');
});

test('wrong version: set aside', () => {
  const kv = mem({ [SAVE_KEY]: JSON.stringify({ version: 99 }) });
  expect(new SaveStore(kv).load()).toEqual(defaultSave());
  expect(kv.data[CORRUPT_KEY]).toBeDefined();
});

test('missing settings filled with defaults', () => {
  const kv = mem({
    [SAVE_KEY]: JSON.stringify({ version: 1, settings: { sound: false }, levels: {} }),
  });
  expect(new SaveStore(kv).load().settings).toEqual({ ...defaultSave().settings, sound: false });
});

test('storage that throws: no error propagated', () => {
  const boom: KV = {
    getItem: () => {
      throw new Error('SecurityError');
    },
    setItem: () => {
      throw new Error('QuotaExceeded');
    },
  };
  const s = new SaveStore(boom);
  expect(s.load()).toEqual(defaultSave());
  expect(s.save(defaultSave())).toBe(false);
});

test.each([
  [0, 4],
  ['abc', 10],
  [999, 20],
])('repeatRate %j → %i (clamped, default if non-numeric)', (raw, expected) => {
  const kv = mem({
    [SAVE_KEY]: JSON.stringify({ version: 1, settings: { repeatRate: raw }, levels: {} }),
  });
  expect(new SaveStore(kv).load().settings.repeatRate).toBe(expected);
});

test('invalid settings replaced by defaults', () => {
  const kv = mem({
    [SAVE_KEY]: JSON.stringify({
      version: 1,
      settings: { sound: 'yes', lang: 'xx', swipeThreshold: 1000 },
      levels: {},
    }),
  });
  expect(new SaveStore(kv).load().settings).toEqual({
    sound: true,
    lang: null,
    swipeThreshold: 80,
    repeatRate: 10,
  });
});

test.each(['en', 'fr', 'de', 'es', 'it'])('language %s is kept', (lang) => {
  const kv = mem({ [SAVE_KEY]: JSON.stringify({ version: 1, settings: { lang }, levels: {} }) });
  expect(new SaveStore(kv).load().settings.lang).toBe(lang);
});

test('levels that is not an object: set aside', () => {
  const kv = mem({ [SAVE_KEY]: JSON.stringify({ version: 1, settings: {}, levels: [] }) });
  expect(new SaveStore(kv).load()).toEqual(defaultSave());
  expect(kv.data[CORRUPT_KEY]).toBeDefined();
});

const loadLevels = (levels: unknown) =>
  new SaveStore(mem({ [SAVE_KEY]: JSON.stringify({ version: 1, settings: {}, levels }) })).load()
    .levels;

test('level record without medals: medals {} by default', () => {
  expect(loadLevels({ 'pc-01': { completed: true } })).toEqual({
    'pc-01': { completed: true, medals: {} },
  });
});

test('record that is not an object: ignored', () => {
  expect(loadLevels({ x: 5, y: null, z: [], ok: { completed: false, medals: {} } })).toEqual({
    ok: { completed: false, medals: {} },
  });
});

test('invalid fields of a record: removed', () => {
  const levels = loadLevels({
    a: {
      completed: 'oui',
      bestMoves: -3,
      bestTimeMs: 'x',
      medals: { moves: 'diamond', time: 'silver', platinum: 'yes' },
    },
    b: {
      completed: true,
      bestMoves: 12,
      bestTimeMs: 3400,
      medals: { moves: 'gold', platinum: true },
    },
    c: { completed: true, bestMoves: null, medals: 7 },
  });
  expect(levels.a).toEqual({ completed: false, medals: { time: 'silver' } });
  expect(levels.b).toEqual({
    completed: true,
    bestMoves: 12,
    bestTimeMs: 3400,
    medals: { moves: 'gold', platinum: true },
  });
  expect(levels.c).toEqual({ completed: true, medals: {} });
});
