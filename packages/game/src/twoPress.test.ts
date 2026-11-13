import { beforeEach, expect, test, vi } from 'vitest';
import type Phaser from 'phaser';

const debug: Record<string, unknown> = {};
vi.mock('./debug', () => ({
  setDebug: (patch: Record<string, unknown>) => Object.assign(debug, patch),
}));

import { setLang, t } from './i18n';
import { TwoPress } from './twoPress';

/** A button that only keeps its text and colour. */
function fakeButton(label: string) {
  const b = {
    text: label,
    color: 'rest',
    setText(s: string) {
      b.text = s;
      return b;
    },
    setColor(c: string) {
      b.color = c;
      return b;
    },
  };
  return b;
}
const asText = (b: ReturnType<typeof fakeButton>) => b as unknown as Phaser.GameObjects.Text;

beforeEach(() => {
  setLang('en');
  for (const k of Object.keys(debug)) delete debug[k];
});

test('a first press asks, a second one acts and puts the label back', () => {
  const press = new TwoPress('rest');
  const a = fakeButton('Delete');
  expect(press.arm('a', asText(a), 'Delete')).toBe(false);
  expect(a.text).toBe(t('confirmReset'));
  expect(a.color).toBe('#ff8080');
  expect(debug.armed).toBe('a');
  expect(press.arm('a', asText(a), 'Delete')).toBe(true);
  expect(a.text).toBe('Delete');
  expect(a.color).toBe('rest');
  expect(debug.armed).toBe(null);
});

test('another button asking puts the first one back', () => {
  const press = new TwoPress('rest');
  const a = fakeButton('Save');
  const b = fakeButton('Delete');
  expect(press.arm('a', asText(a), 'Save')).toBe(false);
  expect(press.arm('b', asText(b), 'Delete')).toBe(false);
  expect(a.text).toBe('Save');
  expect(a.color).toBe('rest');
  expect(b.text).toBe(t('confirmReset'));
  expect(debug.armed).toBe('b');
});

test('reset puts an asking button back', () => {
  const press = new TwoPress('rest');
  const a = fakeButton('Save');
  press.arm('a', asText(a), 'Save');
  press.reset();
  expect(a.text).toBe('Save');
  expect(a.color).toBe('rest');
  expect(debug.armed).toBe(null);
  // asking again from scratch
  expect(press.arm('a', asText(a), 'Save')).toBe(false);
});
