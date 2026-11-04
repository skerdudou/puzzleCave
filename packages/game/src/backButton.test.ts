import { expect, test } from 'vitest';
import { LEAVE_WINDOW_MS, LeaveGate, backAction } from './backButton';

test('Back leaves the game from the menu, else goes back a screen like Escape', () => {
  expect(backAction('Menu')).toBe('leave');
  expect(backAction('Boot')).toBe('leave');
  expect(backAction(undefined)).toBe('leave');
  for (const s of ['Select', 'Game', 'Result', 'Options', 'Achievements', 'Replay'])
    expect(backAction(s)).toBe('escape');
});

test('Back on the menu: a second press soon after leaves, a late one warns again', () => {
  const g = new LeaveGate();
  expect(g.press(1000)).toBe(false);
  expect(g.press(1000 + LEAVE_WINDOW_MS)).toBe(true);
  expect(g.press(10_000)).toBe(false);
  expect(g.press(10_000 + LEAVE_WINDOW_MS + 1)).toBe(false);
  expect(g.press(10_000 + LEAVE_WINDOW_MS + 2)).toBe(true);
});
