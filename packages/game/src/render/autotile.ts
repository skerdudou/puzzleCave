export function wallMask(isWall: (x: number, y: number) => boolean, x: number, y: number): number {
  return (
    (isWall(x, y - 1) ? 1 : 0) |
    (isWall(x - 1, y) ? 2 : 0) |
    (isWall(x + 1, y) ? 4 : 0) |
    (isWall(x, y + 1) ? 8 : 0)
  );
}

export function wallTexture(mask: number): string {
  if (mask === 0) return 'WALL';
  return (
    'WALL_' +
    (mask & 1 ? 'N' : '') +
    (mask & 2 ? 'W' : '') +
    (mask & 4 ? 'E' : '') +
    (mask & 8 ? 'S' : '')
  );
}
