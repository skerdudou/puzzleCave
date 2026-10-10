export interface BoardLayout {
  scale: number;
  x: number;
  y: number;
  width: number;
  height: number;
}

/** Small levels are never drawn bigger than a board of this many cells per side would be. */
export const MAX_ZOOM_CELLS = 12;

export function boardLayout(
  viewW: number,
  viewH: number,
  cols: number,
  rows: number,
  tile: number,
  reserveTop: number,
  reserveBottom: number,
): BoardLayout {
  const availH = Math.max(1, viewH - reserveTop - reserveBottom);
  const fit = (c: number, r: number) => Math.min(viewW / (c * tile), availH / (r * tile));
  const zoomCap = fit(Math.max(cols, MAX_ZOOM_CELLS), Math.max(rows, MAX_ZOOM_CELLS));
  const scale = Math.max(1, Math.floor(Math.min(fit(cols, rows), zoomCap)));
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
