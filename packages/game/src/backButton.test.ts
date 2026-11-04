import { expect, test } from 'vitest';
import {
  BackHistory,
  LEAVE_WINDOW_MS,
  LeaveGate,
  RESERVE,
  backAction,
  type HistoryLike,
} from './backButton';

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

/** A browser history: the page before the game (-1), the game's own entry (0) and its pushes. */
class FakeHistory implements HistoryLike {
  entries: unknown[] = [null];
  index = 0;
  pushes = 0;
  left = false;
  get state(): unknown {
    return this.entries[this.index];
  }
  pushState(state: unknown): void {
    this.entries = this.entries.slice(0, this.index + 1);
    this.entries.push(state);
    this.index++;
    this.pushes++;
  }
  go(delta: number): void {
    const to = this.index + delta;
    if (to < 0) this.left = true;
    else this.index = to;
  }
}

test('Back answers from the reserve: never a push on a Back, the menu warns then leaves', () => {
  const h = new FakeHistory();
  const b = new BackHistory(h);
  b.topUp(); // a tap (a user gesture)
  expect(h.index).toBe(RESERVE);
  const back = (scene: string, now: number) => (h.go(-1), b.popped(scene, now));
  const pushes = h.pushes;
  // the bug: in a level, Back to the selection, Back to the menu, Back at once
  expect(back('Game', 0)).toBe('escape');
  expect(back('Select', 100)).toBe('escape');
  expect(back('Menu', 200)).toBe('warn');
  expect(h.left).toBe(false);
  expect(back('Menu', 300)).toBe('leave');
  expect(h.left).toBe(true);
  expect(h.pushes).toBe(pushes);
});

test('the reserve is topped up on the next gesture; Forward is not a Back', () => {
  const h = new FakeHistory();
  const b = new BackHistory(h);
  b.topUp();
  h.go(-1);
  expect(b.popped('Select', 0)).toBe('escape');
  b.topUp();
  expect(h.index).toBe(RESERVE);
  h.go(-2);
  b.popped('Select', 0);
  h.go(1);
  expect(b.popped('Select', 0)).toBe('forward');
});

test('a late second Back on the menu warns again', () => {
  const h = new FakeHistory();
  const b = new BackHistory(h);
  b.topUp();
  h.go(-1);
  expect(b.popped('Menu', 0)).toBe('warn');
  h.go(-1);
  expect(b.popped('Menu', LEAVE_WINDOW_MS + 1)).toBe('warn');
  expect(h.left).toBe(false);
});
