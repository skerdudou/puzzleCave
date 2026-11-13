import { expect, test } from 'vitest';
import { arrowLevels, arrowTarget, arrowTargetOpen } from './selectNav';

// 13 levels in rows of 6: 0-5, 6-11, 12
const at = (key: string, li: number, prevN?: number, nextN?: number) =>
  arrowTarget(key, li, 13, 6, prevN, nextN);

test('inside the grid: one level, or one row', () => {
  expect(at('ArrowRight', 3)).toEqual({ chapter: 0, li: 4 });
  expect(at('ArrowLeft', 3)).toEqual({ chapter: 0, li: 2 });
  expect(at('ArrowDown', 3)).toEqual({ chapter: 0, li: 9 });
  expect(at('ArrowUp', 9)).toEqual({ chapter: 0, li: 3 });
  // the end of a row goes on to the next one
  expect(at('ArrowRight', 5)).toEqual({ chapter: 0, li: 6 });
});

test('→ after the last level: the next chapter, its first level', () => {
  expect(at('ArrowRight', 12, 11, 12)).toEqual({ chapter: 1, li: 0 });
  expect(at('ArrowRight', 12, 11)).toBeNull();
});

test('← before the first level: the previous chapter, its last level', () => {
  expect(at('ArrowLeft', 0, 11, 12)).toEqual({ chapter: -1, li: 10 });
  expect(at('ArrowLeft', 0, undefined, 12)).toBeNull();
});

test('↓: a short last row is reached from the row above, then the next chapter, same column', () => {
  expect(at('ArrowDown', 9, 11, 12)).toEqual({ chapter: 0, li: 12 });
  expect(at('ArrowDown', 12, 11, 12)).toEqual({ chapter: 1, li: 0 });
  expect(at('ArrowDown', 3, 11, 12)).toEqual({ chapter: 0, li: 9 });
  // from the full row over a short last one: that row's own column has no level below
  expect(at('ArrowDown', 9, 11)).toEqual({ chapter: 0, li: 12 });
  // 12 levels: the last row is full, column 4 goes to the next chapter's column 4 (or its last)
  expect(arrowTarget('ArrowDown', 10, 12, 6, 11, 9)).toEqual({ chapter: 1, li: 4 });
  expect(arrowTarget('ArrowDown', 10, 12, 6, 11, 3)).toEqual({ chapter: 1, li: 2 });
  expect(arrowTarget('ArrowDown', 10, 12, 6, 11, undefined)).toBeNull();
});

test('↑ over the first row: the previous chapter, the last level in that column', () => {
  // 11 levels before: 0-5, 6-10; column 3 → 9, column 5 (none on the short row) → 5
  expect(at('ArrowUp', 3, 11, 12)).toEqual({ chapter: -1, li: 9 });
  expect(at('ArrowUp', 5, 11, 12)).toEqual({ chapter: -1, li: 5 });
  expect(at('ArrowUp', 5, undefined, 12)).toBeNull();
  // a previous chapter of fewer levels than a row
  expect(at('ArrowUp', 5, 3, 12)).toEqual({ chapter: -1, li: 0 });
});

test('other keys: nothing', () => {
  expect(at('Enter', 3, 11, 12)).toBeNull();
});

test('the arrows stop at the last open level: the locked ones after it are skipped', () => {
  const open = (n: number, total = 13) => Array.from({ length: total }, (_, i) => i < n);
  expect(arrowLevels(open(2))).toBe(2);
  expect(arrowLevels(open(13))).toBe(13);
  // a level already finished after a locked one stays open: up to it
  expect(arrowLevels([true, true, false, true, false])).toBe(4);
  // at least one (a chapter's lock, or nothing open)
  expect(arrowLevels([false, false])).toBe(1);
  // → on the last open level goes on to the next chapter, ↓ under it too
  const n = arrowLevels(open(8));
  expect(arrowTarget('ArrowRight', 7, n, 6, undefined, 5)).toEqual({ chapter: 1, li: 0 });
  expect(arrowTarget('ArrowDown', 1, n, 6, undefined, 5)).toEqual({ chapter: 0, li: 7 });
  expect(arrowTarget('ArrowDown', 7, n, 6, undefined, 5)).toEqual({ chapter: 1, li: 1 });
  // ← from the next chapter: the last open level of this one
  expect(arrowTarget('ArrowLeft', 0, 5, 6, n, undefined)).toEqual({ chapter: -1, li: 7 });
});

test('locked levels among open ones are skipped, the arrow going on the same way', () => {
  // this chapter: rows of 6, levels 2 and 3 locked (0-based), the others up to 10 open (10 the
  // last open one: the arrows go through 11 levels); the chapters beside: 13 levels, all open
  const here = (li: number) => li <= 10 && li !== 2 && li !== 3;
  const open = (chapter: -1 | 0 | 1, li: number) => (chapter === 0 ? here(li) : true);
  const go = (key: string, li: number, isOpen = open) =>
    arrowTargetOpen(key, li, 11, 6, 13, 13, isOpen);
  // → from 1: past 2 and 3, to 4; ← from 4: back to 1
  expect(go('ArrowRight', 1)).toEqual({ chapter: 0, li: 4 });
  expect(go('ArrowLeft', 4)).toEqual({ chapter: 0, li: 1 });
  // ↑ from 8 (column 2): 2 is locked, on to the chapter before, its last row in that column
  expect(go('ArrowUp', 8)).toEqual({ chapter: -1, li: 8 });
  // ↓ from 9 (column 3): no level under it (10 is the last), the next chapter's column 3
  expect(go('ArrowDown', 9)).toEqual({ chapter: 1, li: 3 });
  // open levels: as arrowTarget
  expect(go('ArrowRight', 4)).toEqual({ chapter: 0, li: 5 });
  // the chapter beside locked where the arrow lands: the nearest open level before it
  const nextLocked = (chapter: -1 | 0 | 1, li: number) =>
    chapter === 1 ? li < 2 : open(chapter, li);
  expect(go('ArrowDown', 9, nextLocked)).toEqual({ chapter: 1, li: 1 });
});
