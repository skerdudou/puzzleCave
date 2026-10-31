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
