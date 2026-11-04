import { expect, test } from 'vitest';
import { backAction } from './backButton';

test('Back leaves the game from the menu, else goes back a screen like Escape', () => {
  expect(backAction('Menu')).toBe('leave');
  expect(backAction('Boot')).toBe('leave');
  expect(backAction(undefined)).toBe('leave');
  for (const s of ['Select', 'Game', 'Result', 'Options', 'Achievements', 'Replay'])
    expect(backAction(s)).toBe('escape');
});
