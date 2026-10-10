import type { GameState, ObjKind, Terrain } from './types';

const KEYS_OFFSET = 0x4000;
const WORD = 16;

/**
 * Compact key of a macro-state, a string of 16-bit codes: player, keys in pocket, bitset of the
 * keys/doors still present (they never move), bitset of filled water, then the block tiles in
 * reading order.
 */
export class StateCodec {
  private readonly start: GameState;
  private readonly fixed: number[] = [];
  private readonly fixedKind: ObjKind[] = [];
  private readonly water: number[];
  private readonly fixedWords: number;
  private readonly waterWords: number;

  constructor(start: GameState) {
    this.start = start;
    start.objects.forEach((o, i) => {
      if (o === 'key' || o === 'door') {
        this.fixed.push(i);
        this.fixedKind.push(o);
      }
    });
    this.water = start.terrain.flatMap((t, i) => (t === 'water' ? [i] : []));
    this.fixedWords = Math.ceil(this.fixed.length / WORD);
    this.waterWords = Math.ceil(this.water.length / WORD);
  }

  encode(s: GameState): string {
    const codes = [s.player.y * s.width + s.player.x, s.keys + KEYS_OFFSET];
    pushBits(codes, this.fixed, (i) => s.objects[i] !== null);
    pushBits(codes, this.water, (i) => s.terrain[i] !== 'water');
    s.objects.forEach((o, i) => {
      if (o === 'block') codes.push(i);
    });
    return String.fromCharCode(...codes);
  }

  decode(key: string): GameState {
    const { start } = this;
    const objects = new Array<ObjKind | null>(start.objects.length).fill(null);
    const terrain: Terrain[] = start.terrain.slice();
    let j = 2;
    readBits(key, j, this.fixed, (i, n) => (objects[i] = this.fixedKind[n]!));
    j += this.fixedWords;
    readBits(key, j, this.water, (i) => (terrain[i] = 'floor'));
    for (j += this.waterWords; j < key.length; j++) objects[key.charCodeAt(j)] = 'block';
    const p = key.charCodeAt(0);
    return {
      ...start,
      terrain,
      objects,
      keys: key.charCodeAt(1) - KEYS_OFFSET,
      player: { x: p % start.width, y: Math.floor(p / start.width) },
    };
  }
}

function pushBits(codes: number[], cells: readonly number[], set: (cell: number) => boolean): void {
  for (let w = 0; w * WORD < cells.length; w++) {
    let word = 0;
    for (let b = 0; b < WORD && w * WORD + b < cells.length; b++)
      if (set(cells[w * WORD + b]!)) word |= 1 << b;
    codes.push(word);
  }
}

function readBits(
  key: string,
  at: number,
  cells: readonly number[],
  onSet: (cell: number, n: number) => void,
): void {
  cells.forEach((cell, n) => {
    if ((key.charCodeAt(at + Math.floor(n / WORD)) >> (n % WORD)) & 1) onSet(cell, n);
  });
}
