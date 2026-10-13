import { FREE, KEY, type CompactModel } from '../compactModel';

/** keys in pocket are stored with this offset in the high half of word 0 (see CompactModel) */
const KEYS_OFFSET = 0x8000;

const masks = new WeakMap<CompactModel, Uint32Array>();

/** bits of the keys in a macro-state key (word 0, player and pocket, excluded) */
function keyMask(m: CompactModel): Uint32Array {
  let mask = masks.get(m);
  if (!mask) {
    mask = new Uint32Array(m.words);
    for (let f = 0; f < m.fixedCount; f++) {
      if (!m.fixedIsKey[f]) continue;
      const bit = m.fixedBit[m.fixedCell[f]!]!;
      mask[bit >>> 5]! |= 1 << (bit & 31);
    }
    masks.set(m, mask);
  }
  return mask;
}

/**
 * Key closure of the macro-state `key` (modified in place), computed with the model `m` (its
 * loaded state is overwritten): the player walks to the nearest key reachable without pushing or
 * opening anything, picks it up, and repeats until no key is reachable (a key on an exit is left:
 * stepping on it wins). Returns the number of moves of that tour (0 if no key was reachable,
 * `key` unchanged) and appends its directions (0–3, DIRS order) to `out` if given.
 *
 * Picking a key up never hurts: the key cell becomes floor (the walking region only grows and
 * still contains the old one — unless the player stands on unfilled water, which is left alone)
 * and the pocket gains a key (clamped to the remaining doors, like expand). Every continuation of the original state is thus still available, so a search over
 * closed states stays complete; it is not optimal (the tour can take keys that were never needed).
 */
export function closeKeys(m: CompactModel, key: Uint32Array, out?: number[]): number {
  // fast path: no key left on the board
  const mask = keyMask(m);
  let any = 0;
  for (let w = 1; w < mask.length; w++) any |= key[w]! & mask[w]!;
  if (any === 0) return 0;
  m.load(key);
  const { grid, nb, order, isExit, fixedBit } = m;
  // a player standing on unfilled water (allowed start) could never come back: leave it there
  if (grid[m.player] !== FREE) return 0;
  const cap = m.doorsLeft + KEYS_OFFSET;
  let keysWord = key[0]! >>> 16;
  let cost = 0;
  for (;;) {
    const reached = m.explore();
    // first tile in BFS order with a key next to it: the nearest key (ties: BFS order)
    let from = -1;
    let dir = -1;
    for (let h = 0; h < reached && from < 0; h++) {
      const c = order[h]!;
      for (let d = 0; d < 4; d++) {
        const x = nb[c * 4 + d]!;
        if (x >= 0 && grid[x] === KEY && !isExit[x]) {
          from = c;
          dir = d;
          break;
        }
      }
    }
    if (from < 0) break;
    const target = nb[from * 4 + dir]!;
    cost += m.dist[from]! + 1;
    if (out) out.push(...m.walkTo(from), dir);
    grid[target] = FREE;
    const bit = fixedBit[target]!;
    key[bit >>> 5]! &= ~(1 << (bit & 31));
    keysWord = Math.min(keysWord + 1, cap);
    m.player = target;
  }
  if (cost > 0) key[0] = (m.player | (keysWord << 16)) >>> 0;
  return cost;
}
