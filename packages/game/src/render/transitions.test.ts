import { expect, test, vi } from 'vitest';

vi.mock('phaser', () => ({ default: {} }));
const { fades } = await import('./transitions');

test('a fade from one screen to another, none on a restart or the first screen', () => {
  expect(fades('Menu', 'Select')).toBe(true);
  expect(fades('Select', 'Select')).toBe(false);
  expect(fades(undefined, 'Menu')).toBe(false);
});
