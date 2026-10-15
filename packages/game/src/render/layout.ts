export interface BoardLayout {
  scale: number;
  x: number;
  y: number;
  width: number;
  height: number;
}

/** Small levels are never drawn bigger than a board of this many cells per side would be. */
export const MAX_ZOOM_CELLS = 12;

/**
 * Whole-number zoom keeps every art pixel the same size, which shows on a screen of ordinary
 * density but costs up to a third of the space. From 2 device pixels per CSS pixel (phones,
 * tablets, retina screens) an art pixel that is one device pixel wider than its neighbour cannot
 * be seen, so the board fills the space instead.
 */
export const fractionalZoom = (devicePixelRatio: number): boolean => devicePixelRatio >= 2;

/**
 * Where the board goes and its zoom. `fractional`: any zoom, but a cell stays a whole number of
 * device pixels (the grid stays sharp); otherwise a whole zoom of at least 1.
 */
export function boardLayout(
  viewW: number,
  viewH: number,
  cols: number,
  rows: number,
  tile: number,
  reserveTop: number,
  reserveBottom: number,
  fractional = false,
): BoardLayout {
  const availH = Math.max(1, viewH - reserveTop - reserveBottom);
  const fit = (c: number, r: number) => Math.min(viewW / (c * tile), availH / (r * tile));
  const zoomCap = fit(Math.max(cols, MAX_ZOOM_CELLS), Math.max(rows, MAX_ZOOM_CELLS));
  const zoom = Math.min(fit(cols, rows), zoomCap);
  const scale = fractional
    ? Math.max(1, Math.floor(zoom * tile)) / tile
    : Math.max(1, Math.floor(zoom));
  const width = cols * tile * scale;
  const height = rows * tile * scale;
  return {
    scale,
    x: Math.floor((viewW - width) / 2),
    y: reserveTop + Math.floor((availH - height) / 2),
    width,
    height,
  };
}
