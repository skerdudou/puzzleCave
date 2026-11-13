/**
 * The arrow keys on the level list (SelectScene): they move in the grid of levels and, past its
 * first or last level, row or column, on to the chapter beside, as the eye reads it: → after the
 * last level, the next chapter's first; ← before the first, the previous one's last; ↓ under the
 * last row, the next chapter's first row in that column; ↑ over the first row, the previous
 * chapter's last level in that column.
 */

/**
 * How many of a chapter's levels the arrows go through: up to its last open level (the locked
 * ones after it are skipped, as if the grid ended there), at least one. `open`: each level's.
 */
export function arrowLevels(open: readonly boolean[]): number {
  return Math.max(1, open.lastIndexOf(true) + 1);
}

/** Where an arrow goes: `chapter` -1, 0 (this one) or 1, and the level picked there. */
export interface ArrowTarget {
  chapter: -1 | 0 | 1;
  li: number;
}

/**
 * `li` picked among `n` levels in rows of `cols`; `prevN`, `nextN`: the levels of the chapters
 * beside (undefined: none that way). null: nowhere to go.
 */
export function arrowTarget(
  key: string,
  li: number,
  n: number,
  cols: number,
  prevN: number | undefined,
  nextN: number | undefined,
): ArrowTarget | null {
  const col = li % cols;
  const lastRow = Math.floor((n - 1) / cols);
  const here = (to: number): ArrowTarget => ({ chapter: 0, li: to });
  switch (key) {
    case 'ArrowRight':
      if (li + 1 < n) return here(li + 1);
      return nextN ? { chapter: 1, li: 0 } : null;
    case 'ArrowLeft':
      if (li > 0) return here(li - 1);
      return prevN ? { chapter: -1, li: prevN - 1 } : null;
    case 'ArrowDown':
      // a short last row: the row above goes down to its last level
      if (Math.floor(li / cols) < lastRow) return here(Math.min(li + cols, n - 1));
      return nextN ? { chapter: 1, li: Math.min(col, nextN - 1) } : null;
    case 'ArrowUp': {
      if (li >= cols) return here(li - cols);
      if (!prevN) return null;
      const to = Math.floor((prevN - 1) / cols) * cols + col;
      return { chapter: -1, li: to < prevN ? to : Math.max(0, to - cols) };
    }
    default:
      return null;
  }
}
