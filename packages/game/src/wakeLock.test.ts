import { expect, test } from 'vitest';
import { keepAwake } from './wakeLock';

/** A fake Wake Lock: how many locks are held, and the document's visibility. */
function fakes() {
  let held = 0;
  let requests = 0;
  const listeners = new Set<() => void>();
  const doc = {
    visibilityState: 'visible',
    addEventListener: (_: 'visibilitychange', fn: () => void) => void listeners.add(fn),
    removeEventListener: (_: 'visibilitychange', fn: () => void) => void listeners.delete(fn),
  };
  const nav = {
    wakeLock: {
      request: async () => {
        requests++;
        held++;
        return { release: async () => void held-- };
      },
    },
  };
  const show = (state: 'visible' | 'hidden') => {
    doc.visibilityState = state;
    for (const fn of listeners) fn();
  };
  return { nav, doc, show, held: () => held, requests: () => requests, listeners };
}

const settle = () => new Promise((r) => setTimeout(r, 0));

test('held until released; the listener goes with it', async () => {
  const f = fakes();
  const awake = keepAwake(f.nav, f.doc);
  await settle();
  expect(f.held()).toBe(1);
  awake.release();
  await settle();
  expect(f.held()).toBe(0);
  expect(f.listeners.size).toBe(0);
});

test('asked for again when the page comes back (the browser drops it when hidden)', async () => {
  const f = fakes();
  keepAwake(f.nav, f.doc);
  await settle();
  f.show('hidden');
  f.show('visible');
  await settle();
  expect(f.requests()).toBe(2);
});

test('a lock granted after release() is let go at once', async () => {
  const f = fakes();
  const awake = keepAwake(f.nav, f.doc);
  awake.release();
  await settle();
  expect(f.held()).toBe(0);
});

test('no Wake Lock API, or refused: nothing happens', async () => {
  const f = fakes();
  expect(() => keepAwake({}, f.doc).release()).not.toThrow();
  const refusing = { wakeLock: { request: () => Promise.reject(new Error('no')) } };
  keepAwake(refusing, f.doc);
  await settle();
});
