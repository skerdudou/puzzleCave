// The sunken shore: water sits about 2 px below the floor (a dark bank face and its shadow under a
// bank to the north, softer shadow along banks to the west and east and at an inner corner under
// one, a light lip along a bank to the south). One water texture per shore (public/textures/
// WATER_*.png), chosen by the neighbours like the walls' (autotile.ts).

/** Which neighbours of a water cell are not water (the edge of the board counts as a bank). */
export interface Shore {
  n: boolean;
  w: boolean;
  e: boolean;
  s: boolean;
  /** the corners above: only told apart where both sides beside them are water */
  nw: boolean;
  ne: boolean;
}

/** The shore of the water cell at (x, y); `isWater` false outside the board. */
export function shoreAt(isWater: (x: number, y: number) => boolean, x: number, y: number): Shore {
  const n = !isWater(x, y - 1);
  const w = !isWater(x - 1, y);
  const e = !isWater(x + 1, y);
  return {
    n,
    w,
    e,
    s: !isWater(x, y + 1),
    nw: !n && !w && !isWater(x - 1, y - 1),
    ne: !n && !e && !isWater(x + 1, y - 1),
  };
}

/** The texture of a shore: WATER, or WATER_ and its banks (NWES) and corners (cNW, cNE). */
export function shoreTexture(s: Shore): string {
  const sides = (s.n ? 'N' : '') + (s.w ? 'W' : '') + (s.e ? 'E' : '') + (s.s ? 'S' : '');
  const parts = ['WATER', sides, s.nw ? 'cNW' : '', s.ne ? 'cNE' : ''].filter(Boolean);
  return parts.join('_');
}

/** Every shore a water cell can have (the corners only where they count). */
export function allShores(): Shore[] {
  const out: Shore[] = [];
  for (let m = 0; m < 64; m++) {
    const s: Shore = {
      n: !!(m & 1),
      w: !!(m & 2),
      e: !!(m & 4),
      s: !!(m & 8),
      nw: !!(m & 16),
      ne: !!(m & 32),
    };
    if (s.nw && (s.n || s.w)) continue;
    if (s.ne && (s.n || s.e)) continue;
    out.push(s);
  }
  return out;
}

/** The water texture names of every shore (loaded with the other textures). */
export const SHORE_TEXTURES = allShores().map(shoreTexture);
