import { expect, test, vi } from 'vitest';
import { CHECK_INTERVAL_MS, MIN_CHECK_GAP_MS, UpdateGate, checkDue } from './updateGate';

const gate = () => {
  const apply = vi.fn();
  return { g: new UpdateGate(apply), apply };
};

test.each(['Menu', 'Select', 'Options', 'Achievements'])(
  "ready while on %s: nothing happens under the player's fingers",
  (scene) => {
    const { g, apply } = gate();
    g.enter(scene);
    g.ready();
    expect(apply).not.toHaveBeenCalled();
    expect(g.pending).toBe(true);
    // the same screen restarted (a resize): still nothing
    g.enter(scene);
    expect(apply).not.toHaveBeenCalled();
  },
);

test('going to another menu screen: applied, coming back to that screen', () => {
  const { g, apply } = gate();
  g.enter('Menu');
  g.ready();
  g.enter('Select');
  expect(apply).toHaveBeenCalledWith('Select', true);
  expect(g.pending).toBe(false);
});

test.each(['Game', 'Replay', 'Result'])(
  'ready on %s: waits through levels and results, applied at the next menu screen',
  (scene) => {
    const { g, apply } = gate();
    g.enter('Select');
    g.enter(scene);
    g.ready();
    g.enter('Game');
    g.enter('Result');
    g.enter('Game');
    expect(apply).not.toHaveBeenCalled();
    g.enter('Select');
    expect(apply).toHaveBeenCalledWith('Select', true);
  },
);

test('the game going to the background on a menu screen: applied there, nothing shown', () => {
  const { g, apply } = gate();
  g.enter('Options');
  g.ready();
  g.hidden();
  expect(apply).toHaveBeenCalledWith('Options', false);
});

test.each(['Game', 'Replay', 'Result'])(
  'the game going to the background on %s: still waiting',
  (scene) => {
    const { g, apply } = gate();
    g.enter(scene);
    g.ready();
    g.hidden();
    expect(apply).not.toHaveBeenCalled();
    expect(g.pending).toBe(true);
  },
);

test('nothing waiting: going to the background or changing screen does nothing', () => {
  const { g, apply } = gate();
  g.enter('Menu');
  g.hidden();
  g.enter('Select');
  expect(apply).not.toHaveBeenCalled();
});

test('applied once only', () => {
  const { g, apply } = gate();
  g.enter('Menu');
  g.ready();
  g.enter('Select');
  g.ready();
  g.enter('Options');
  g.hidden();
  expect(apply).toHaveBeenCalledTimes(1);
});

test('checks: every 30 minutes, and on return at most once a minute', () => {
  expect(CHECK_INTERVAL_MS).toBe(30 * 60 * 1000);
  expect(checkDue(1000 + MIN_CHECK_GAP_MS, 1000)).toBe(true);
  expect(checkDue(1000 + MIN_CHECK_GAP_MS - 1, 1000)).toBe(false);
  expect(checkDue(5000, 0, 1000)).toBe(true);
});
