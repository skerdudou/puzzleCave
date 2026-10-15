import { expect, test, vi } from 'vitest';
import { CHECK_INTERVAL_MS, MIN_CHECK_GAP_MS, UpdateGate, checkDue } from './updateGate';

const gate = () => {
  const apply = vi.fn();
  const notify = vi.fn();
  return { g: new UpdateGate(apply, notify), apply, notify };
};

test.each(['Menu', 'Select', 'Options', 'Result', 'Boot'])(
  'ready on %s: applied at once, no notice',
  (scene) => {
    const { g, apply, notify } = gate();
    g.enter(scene);
    g.ready();
    expect(apply).toHaveBeenCalledTimes(1);
    expect(notify).not.toHaveBeenCalled();
    expect(g.pending).toBe(false);
  },
);

test('ready before any scene (start-up): applied at once', () => {
  const { g, apply } = gate();
  g.ready();
  expect(apply).toHaveBeenCalledTimes(1);
});

test.each(['Game', 'Replay'])(
  'ready during a level (%s): a notice, applied at the next menu',
  (scene) => {
    const { g, apply, notify } = gate();
    g.enter('Select');
    g.enter(scene);
    g.ready();
    expect(apply).not.toHaveBeenCalled();
    expect(notify).toHaveBeenCalledTimes(1);
    expect(g.pending).toBe(true);
    // restarting the level, then its result screen: still waiting (the medals are shown)
    g.enter(scene);
    g.enter('Result');
    expect(apply).not.toHaveBeenCalled();
    // the next level from the result screen: still waiting, no second notice
    g.enter('Game');
    g.ready();
    expect(notify).toHaveBeenCalledTimes(1);
    expect(apply).not.toHaveBeenCalled();
    // back to the level list: applied
    g.enter('Select');
    expect(apply).toHaveBeenCalledTimes(1);
    expect(g.pending).toBe(false);
  },
);

test('a waiting update is applied on the menu or the options too', () => {
  for (const menu of ['Menu', 'Options']) {
    const { g, apply } = gate();
    g.enter('Game');
    g.ready();
    g.enter(menu);
    expect(apply).toHaveBeenCalledTimes(1);
  }
});

test('applied once only', () => {
  const { g, apply } = gate();
  g.enter('Menu');
  g.ready();
  g.ready();
  g.enter('Select');
  expect(apply).toHaveBeenCalledTimes(1);
});

test('checks: every 30 minutes, and on return at most once a minute', () => {
  expect(CHECK_INTERVAL_MS).toBe(30 * 60 * 1000);
  expect(checkDue(1000 + MIN_CHECK_GAP_MS, 1000)).toBe(true);
  expect(checkDue(1000 + MIN_CHECK_GAP_MS - 1, 1000)).toBe(false);
  expect(checkDue(5000, 0, 1000)).toBe(true);
});
