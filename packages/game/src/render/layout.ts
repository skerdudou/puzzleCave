export interface BoardLayout {
  scale: number;
  x: number;
  y: number;
  width: number;
  height: number;
}

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
  const scale = Math.max(1, Math.floor(Math.min(viewW / (cols * tile), availH / (rows * tile))));
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
