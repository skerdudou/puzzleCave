import { beforeEach, expect, test, vi } from 'vitest';
import type Phaser from 'phaser';

const debug: Record<string, unknown> = {};
vi.mock('./debug', () => ({
  setDebug: (patch: Record<string, unknown>) => Object.assign(debug, patch),
}));

import { setLang, t } from './i18n';
import { CONFIRM_MS, TwoPress } from './twoPress';

/**
 * A button that keeps its text, colour, padding and data; its size as a text's: 10 px a
 * character and 20 high, plus its padding.
 */
function fakeButton(label: string) {
  const data: Record<string, unknown> = {};
  const b = {
    text: label,
    color: 'rest',
    padding: { left: 8, top: 4, right: 8, bottom: 4 },
    get width() {
      return b.text.length * 10 + b.padding.left + b.padding.right;
    },
    get height() {
      return 20 + b.padding.top + b.padding.bottom;
    },
    setText(s: string) {
      b.text = s;
      return b;
    },
    setColor(c: string) {
      b.color = c;
      return b;
    },
    setPadding(left: number, top: number, right: number, bottom: number) {
      b.padding = { left, top, right, bottom };
      return b;
    },
    getData: (k: string) => data[k],
    setData(k: string, v: unknown) {
      data[k] = v;
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

test('a button stops asking by itself after a few seconds', () => {
  vi.useFakeTimers();
  try {
    const press = new TwoPress('rest');
    const a = fakeButton('Delete');
    expect(press.arm('a', asText(a), 'Delete')).toBe(false);
    vi.advanceTimersByTime(CONFIRM_MS - 1);
    expect(a.text).toBe(t('confirmReset'));
    vi.advanceTimersByTime(1);
    expect(a.text).toBe('Delete');
    expect(a.color).toBe('rest');
    expect(debug.armed).toBe(null);
    // a press after that asks again
    expect(press.arm('a', asText(a), 'Delete')).toBe(false);
    // a second press in time acts, and nothing expires later
    expect(press.arm('a', asText(a), 'Delete')).toBe(true);
    a.setText('changed');
    vi.advanceTimersByTime(CONFIRM_MS);
    expect(a.text).toBe('changed');
  } finally {
    vi.useRealTimers();
  }
});

test('a button gone with its screen is not put back', () => {
  vi.useFakeTimers();
  try {
    const press = new TwoPress('rest');
    const a = Object.assign(fakeButton('Delete'), { active: true });
    press.arm('a', asText(a), 'Delete');
    a.active = false;
    vi.advanceTimersByTime(CONFIRM_MS);
    expect(a.text).toBe(t('confirmReset'));
    expect(debug.armed).toBe(null);
  } finally {
    vi.useRealTimers();
  }
});

test('the button keeps its size while it asks, and its padding once put back', () => {
  const press = new TwoPress('rest');
  const a = fakeButton('Delete everything');
  const [w, h] = [a.width, a.height];
  press.arm('a', asText(a), 'Delete everything');
  expect(a.text).toBe(t('confirmReset'));
  expect([a.width, a.height]).toEqual([w, h]);
  press.reset();
  expect(a.padding).toEqual({ left: 8, top: 4, right: 8, bottom: 4 });
  expect([a.width, a.height]).toEqual([w, h]);
  // a label shorter than "Sure?": the button grows while it asks, then is as it was
  const s = fakeButton('X');
  const sw = s.width;
  press.arm('s', asText(s), 'X');
  expect(s.width).toBeGreaterThan(sw);
  press.reset();
  expect(s.width).toBe(sw);
});
