import { expect, test } from 'vitest';
import {
  CORRUPT_KEY,
  SAVE_KEY,
  SAVE_VERSION,
  SaveStore,
  defaultSave,
  exportSave,
  migrate,
  parseSave,
  type KV,
  type SaveContext,
} from './save';
import { isMasterUnlocked, resolveThresholds } from '@puzzlecave/core';

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
      settings: { sound: 'yes', lang: 'xx', dragStep: 'far', vibration: 0, touchControl: 'x' },
      levels: {},
    }),
  });
  expect(new SaveStore(kv).load().settings).toEqual({
    sound: true,
    sfx: true,
    lang: null,
    dragStep: 40,
    dragStepDefault: 40,
    repeatRate: 10,
    vibration: true,
    touchControl: 'drag',
  });
});

test('a save from before the drag, vibration and touch control options: defaults (40 px, on, drag)', () => {
  const kv = mem({
    [SAVE_KEY]: JSON.stringify({
      version: 1,
      settings: { sound: false, lang: 'fr', swipeThreshold: 45, repeatRate: 12 },
      levels: {},
    }),
  });
  expect(new SaveStore(kv).load().settings).toEqual({
    sound: false,
    sfx: true,
    lang: 'fr',
    dragStep: 40,
    dragStepDefault: 40,
    repeatRate: 12,
    vibration: true,
    touchControl: 'drag',
  });
});

test.each([
  [16, 16],
  [33, 32],
  [1000, 80],
  [-5, 16],
])('dragStep %j → %i (snapped to an offered distance)', (raw, expected) => {
  const kv = mem({
    [SAVE_KEY]: JSON.stringify({ version: 1, settings: { dragStep: raw }, levels: {} }),
  });
  expect(new SaveStore(kv).load().settings.dragStep).toBe(expected);
});

test('a drag distance left at the old default (24 px) follows the new one; a chosen one stays', () => {
  const load = (settings: object) =>
    new SaveStore(mem({ [SAVE_KEY]: JSON.stringify({ version: 1, settings, levels: {} }) })).load()
      .settings.dragStep;
  // saves from before the field: their default was 24 px
  expect(load({ dragStep: 24 })).toBe(40);
  expect(load({ dragStep: 20 })).toBe(20);
  expect(load({ dragStep: 32 })).toBe(32);
  // written since: 24 px is a choice now, kept
  expect(load({ dragStep: 24, dragStepDefault: 40 })).toBe(24);
  expect(load({ dragStep: 40, dragStepDefault: 40 })).toBe(40);
  // a later default change moves the players still at 40 px
  expect(load({ dragStep: 40, dragStepDefault: 48 })).toBe(40);
  expect(load({ dragStep: 48, dragStepDefault: 48 })).toBe(40);
  // round trip: the migrated save keeps its value
  const kv = mem({
    [SAVE_KEY]: JSON.stringify({ version: 1, settings: { dragStep: 24 }, levels: {} }),
  });
  const d = new SaveStore(kv).load();
  d.settings.dragStep = 24; // chosen again by the player
  new SaveStore(kv).save(d);
  expect(new SaveStore(kv).load().settings.dragStep).toBe(24);
});

test('master records are kept', () => {
  const rec = { completed: true, medals: {}, masterBestMoves: 31, masterBestTimeMs: 9000 };
  const kv = mem({
    [SAVE_KEY]: JSON.stringify({
      version: 1,
      settings: {},
      levels: { a: rec, b: { ...rec, masterBestMoves: 'x' } },
    }),
  });
  const { levels } = new SaveStore(kv).load();
  expect(levels.a).toEqual(rec);
  expect(levels.b).toEqual({ completed: true, medals: {}, masterBestTimeMs: 9000 });
});

test.each(['drag', 'tap'])('touch control %s is kept', (touchControl) => {
  const kv = mem({
    [SAVE_KEY]: JSON.stringify({ version: 1, settings: { touchControl }, levels: {} }),
  });
  expect(new SaveStore(kv).load().settings.touchControl).toBe(touchControl);
});

test.each([
  ['screen', 'tap'],
  ['player', 'tap'],
  ['off', 'drag'],
  ['centre', 'drag'],
  [undefined, 'drag'],
  [3, 'drag'],
])('old tap zones %j → touch control %s', (tapZones, expected) => {
  const kv = mem({
    [SAVE_KEY]: JSON.stringify({ version: 1, settings: { tapZones }, levels: {} }),
  });
  const { settings } = new SaveStore(kv).load();
  expect(settings.touchControl).toBe(expected);
  expect(settings).not.toHaveProperty('tapZones');
});

test('a touch control already saved wins over old tap zones', () => {
  const kv = mem({
    [SAVE_KEY]: JSON.stringify({
      version: 1,
      settings: { tapZones: 'screen', touchControl: 'drag' },
      levels: {},
    }),
  });
  expect(new SaveStore(kv).load().settings.touchControl).toBe('drag');
});

test('vibration off is kept', () => {
  const kv = mem({
    [SAVE_KEY]: JSON.stringify({ version: 1, settings: { vibration: false }, levels: {} }),
  });
  expect(new SaveStore(kv).load().settings.vibration).toBe(false);
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
    medals: { moves: 'gold', master: 'grandMaster' },
  });
  expect(levels.c).toEqual({ completed: true, medals: {} });
});

test('save from before master mode: medals kept, master mode open where gold or a master medal', () => {
  const levels = loadLevels({
    // gold earned under an older, higher threshold stays gold
    'pc-04': { completed: true, bestMoves: 300, medals: { moves: 'gold' } },
    // platinum of the former drowning challenge (no gold): a grand master, it opens master mode
    'pc-06': { completed: true, bestMoves: 250, medals: { moves: 'bronze', platinum: true } },
    'pc-09': { completed: true, bestMoves: 600, medals: { moves: 'silver' } },
  });
  expect(levels['pc-04']!.medals).toEqual({ moves: 'gold' });
  expect(levels['pc-06']!.medals).toEqual({ moves: 'bronze', master: 'grandMaster' });
  expect(isMasterUnlocked(levels['pc-04'])).toBe(true);
  expect(isMasterUnlocked(levels['pc-06'])).toBe(true);
  expect(isMasterUnlocked(levels['pc-09'])).toBe(false);
});

test('migrate: each step in turn up to the current version', () => {
  const steps = {
    1: (s: Record<string, unknown>) => ({ ...s, a: 1 }),
    2: (s: Record<string, unknown>) => ({ ...s, b: (s.a as number) + 1 }),
  };
  expect(migrate({ version: 1 }, steps, 3)).toEqual({ version: 3, a: 1, b: 2 });
  expect(migrate({ version: 3, z: 0 }, steps, 3)).toEqual({ version: 3, z: 0 });
});

test.each([[{ version: 4 }], [{ version: 0 }], [{ version: '1' }], [{}]])(
  'migrate: %j is refused (unknown or newer version)',
  (save) => {
    expect(() => migrate(save, {}, 3)).toThrow();
  },
);

test('migrate: a missing step is refused rather than skipped', () => {
  expect(() => migrate({ version: 1 }, {}, 2)).toThrow();
});

test('export then import gives the same save', () => {
  const d = defaultSave();
  d.levels['pc-01'] = { completed: true, bestMoves: 12, medals: { moves: 'gold' } };
  d.settings.sfx = false;
  expect(parseSave(exportSave(d))).toEqual(d);
});

test.each(['', 'null', '[]', '{"version":1}', '{"version":3,"levels":{}}'])(
  'an unusable file is refused: %s',
  (raw) => {
    expect(() => parseSave(raw)).toThrow();
  },
);

// version 1 → 2: platinum became master / grand master
const ctx: SaveContext = {
  masterThresholds: (id) =>
    id === 'pc-14'
      ? resolveThresholds({ goldMoves: 610, platinumMoves: 538 })
      : id === 'timed'
        ? resolveThresholds({ goldMoves: 610, platinumMoves: 538, goldTime: 85 })
        : undefined,
};
const v1 = (levels: unknown) => JSON.stringify({ version: 1, settings: {}, levels });

test('version 1: a platinum becomes a grand master, the platinum field goes', () => {
  const d = parseSave(
    v1({ x: { completed: true, masterBestMoves: 9, medals: { moves: 'gold', platinum: true } } }),
  );
  expect(d.version).toBe(SAVE_VERSION);
  expect(d.levels.x!.medals).toEqual({ moves: 'gold', master: 'grandMaster' });
  expect(isMasterUnlocked(d.levels.x)).toBe(true);
});

test.each([
  [500, 'grandMaster'],
  [538, 'grandMaster'],
  [539, 'master'],
  [610, 'master'],
  [611, undefined],
])('version 1: best master run of %i moves (gold 610, platinum 538) → %s', (moves, medal) => {
  const d = parseSave(
    v1({ 'pc-14': { completed: true, masterBestMoves: moves, medals: { moves: 'gold' } } }),
    ctx,
  );
  expect(d.levels['pc-14']!.medals.master).toBe(medal);
});

test('version 1: with time medals, the best master run (time unknown) earns master at most', () => {
  // masterBestTimeMs is a separate minimum, maybe of another run: no grand master derived from it
  const d = parseSave(
    v1({
      timed: { completed: true, masterBestMoves: 500, masterBestTimeMs: 1_000, medals: {} },
      gm: { completed: true, masterBestMoves: 500, medals: { platinum: true } },
    }),
    { masterThresholds: (id) => ctx.masterThresholds(id === 'gm' ? 'timed' : id) },
  );
  expect(d.levels.timed!.medals.master).toBe('master');
  // a platinum earned before stays grand master
  expect(d.levels.gm!.medals.master).toBe('grandMaster');
});

test('version 1: a platinum is kept whatever the best master run says', () => {
  const d = parseSave(
    v1({ 'pc-14': { completed: true, masterBestMoves: 700, medals: { platinum: true } } }),
    ctx,
  );
  expect(d.levels['pc-14']!.medals.master).toBe('grandMaster');
});

test('version 1: nothing derived for a level without master mode, unknown, or without a master run', () => {
  const d = parseSave(
    v1({
      'pc-01': { completed: true, masterBestMoves: 5, medals: { moves: 'gold' } },
      'pc-14': { completed: true, bestMoves: 500, medals: { moves: 'gold' } },
    }),
    ctx,
  );
  expect(d.levels['pc-01']!.medals).toEqual({ moves: 'gold' });
  expect(d.levels['pc-14']!.medals).toEqual({ moves: 'gold' });
});

test('version 1 through the store: migrated on load, written back as version 2', () => {
  const kv = mem({
    [SAVE_KEY]: v1({ 'pc-14': { completed: true, masterBestMoves: 600, medals: {} } }),
  });
  const store = new SaveStore(kv, ctx);
  const d = store.load();
  expect(d.levels['pc-14']!.medals).toEqual({ master: 'master' });
  store.save(d);
  expect(JSON.parse(kv.data[SAVE_KEY]!)).toMatchObject({
    version: 2,
    levels: { 'pc-14': { medals: { master: 'master' } } },
  });
});

test('version 2: a grand master earned before the silver time rule is kept', () => {
  // best master time above the silver time (106.25 s): the medal is not taken back
  const raw = JSON.stringify({
    version: 2,
    settings: {},
    levels: {
      timed: {
        completed: true,
        masterBestMoves: 538,
        masterBestTimeMs: 120_000,
        medals: { moves: 'gold', master: 'grandMaster' },
      },
    },
  });
  expect(parseSave(raw, ctx).levels.timed!.medals.master).toBe('grandMaster');
});

test('version 2: an invalid master medal is dropped', () => {
  const raw = JSON.stringify({
    version: 2,
    settings: {},
    levels: { a: { completed: true, medals: { master: 'platinum', platinum: true } } },
  });
  expect(parseSave(raw).levels.a!.medals).toEqual({});
});
