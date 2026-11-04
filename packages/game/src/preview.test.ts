import { afterEach, expect, test, vi } from 'vitest';

// src/preview.ts reads the build's environment when it is loaded: each test loads it afresh
const load = () => import('./preview');
afterEach(() => {
  vi.unstubAllEnvs();
  vi.resetModules();
});

test('the release build: the release save keys, no commit', async () => {
  vi.stubEnv('VITE_PREVIEW', '');
  vi.stubEnv('VITE_PREVIEW_SHA', 'abc1234');
  const p = await load();
  expect(p.PREVIEW).toBe(false);
  expect(p.PREVIEW_SHA).toBe('');
  expect(p.SAVE_KEYS).toEqual({ save: 'puzzlecave.save.v1', corrupt: 'puzzlecave.save.corrupt' });
});

test('the preview build (VITE_PREVIEW=1): save keys of its own, its commit', async () => {
  vi.stubEnv('VITE_PREVIEW', '1');
  vi.stubEnv('VITE_PREVIEW_SHA', 'abc1234');
  const p = await load();
  expect(p.PREVIEW).toBe(true);
  expect(p.PREVIEW_SHA).toBe('abc1234');
  expect(p.SAVE_KEYS).toEqual({
    save: 'puzzlecave.preview.save.v1',
    corrupt: 'puzzlecave.preview.save.corrupt',
  });
});

const memory = () => {
  const m = new Map<string, string>();
  return {
    m,
    getItem: (k: string) => m.get(k) ?? null,
    setItem: (k: string, v: string) => void m.set(k, v),
  };
};

test('preview author mode: off at first, ?dev turns it on and is remembered, ?dev=0 off', async () => {
  const { previewDevMode, PREVIEW_DEV_KEY } = await load();
  const s = memory();
  expect(previewDevMode('', s)).toBe(false);
  expect(previewDevMode('?dev', s)).toBe(true);
  expect(s.m.get(PREVIEW_DEV_KEY)).toBe('1');
  expect(previewDevMode('', s)).toBe(true);
  expect(previewDevMode('?lang=fr&dev=1', s)).toBe(true);
  expect(previewDevMode('?dev=0', s)).toBe(false);
  expect(previewDevMode('', s)).toBe(false);
});

test('preview author mode without storage: the parameter alone, for this visit', async () => {
  const { previewDevMode } = await load();
  expect(previewDevMode('?dev', null)).toBe(true);
  expect(previewDevMode('', null)).toBe(false);
  const blocked = () => {
    throw new Error('blocked');
  };
  const throwing = { getItem: blocked, setItem: blocked };
  expect(previewDevMode('?dev', throwing)).toBe(true);
  expect(previewDevMode('', throwing)).toBe(false);
});
