import { describe, expect, test } from 'vitest';
import { fromAscii, initialState, type LevelData } from '@puzzlecave/core';
import { mulberry32, sampleLevels, validRandomLevel } from '../../core/src/testLevels';
import { emulateSuccessors } from './emulate';
import { MAX_SIDE, gpuUnsupported, makeLayout, planBuffers } from './layout';

const sortSucc = <T extends { edge: number }>(a: T[]) => [...a].sort((x, y) => x.edge - y.edge);

/** Walks up to `limit` macro-states and compares the emulation of the GPU tables with the compact model. */
function compareOn(level: LevelData, limit: number): number {
  const L = makeLayout(level);
  const model = L.model;
  const start = model.encode(initialState(level));
  const seen = new Set<string>([start.join(',')]);
  const queue = [[...start]];
  let checked = 0;
  for (let head = 0; head < queue.length && head < limit; head++) {
    const key = Uint32Array.from(queue[head]!);
    const ref = model.successors(key);
    expect(sortSucc(emulateSuccessors(L, key)), level.id).toEqual(sortSucc(ref));
    checked++;
    for (const r of ref) {
      if (r.won) continue;
      const k = r.next.join(',');
      if (!seen.has(k)) {
        seen.add(k);
        queue.push(r.next);
      }
    }
  }
  return checked;
}

describe('GPU tables', () => {
  test('encode each cell like the compact model', () => {
    const level = fromAscii(['@kB~E', '#D#.#', '#.k.#']);
    const L = makeLayout(level);
    const m = L.model;
    for (let c = 0; c < m.n; c++) {
      const i0 = L.table[c]!;
      const i1 = L.table[L.offInfo1 + c]!;
      expect(i0 & 7, `base ${c}`).toBe(m.base[c]);
      expect((i0 >>> 3) & 1, `holds ${c}`).toBe(m.holdsBlock[c]);
      const rel = (abs: number) => (abs < 0 ? 0 : abs - 32 + 1);
      expect(i0 >>> 16, `fixed ${c}`).toBe(rel(m.fixedBit[c]!));
      expect(i1 & 0xffff, `water ${c}`).toBe(rel(m.waterBit[c]!));
      expect(i1 >>> 16, `block ${c}`).toBe(rel(m.blockBit[c]!));
    }
    for (let b = 0; b < m.bitCell.length; b++) {
      expect(L.table[L.offBit + b]! & 0xffff).toBe(m.bitCell[b]);
      expect(L.table[L.offBit + b]! >>> 16).toBe(m.bitCode[b]);
    }
    expect(L.words).toBe(m.words);
  });

  test('relaxed distance to the exit (only walls stop)', () => {
    const L = makeLayout(fromAscii(['@.~#E', '..B..']));
    expect(Array.from(L.toExit)).toEqual([6, 5, 4, 0x3fffffff, 0, 5, 4, 3, 2, 1]);
  });

  test('walk rows, exit rows and door mask', () => {
    const L = makeLayout(fromAscii(['@.D#', 'k.~E']));
    expect(Array.from(L.walkRows)).toEqual([0b0111, 0b0011]);
    expect(Array.from(L.exitRows)).toEqual([0, 0b1000]);
    // bits: key/door first (door (2,0) then key (0,1)), then water
    const m = L.model;
    const door = m.fixedBit[2]! - 32;
    expect(L.doorMask[1]).toBe(1 << door);
    // copied into the tbl buffer (the shader only depends on the word count)
    expect(Array.from(L.table.subarray(L.offWalk, L.offWalk + 2))).toEqual([0b0111, 0b0011]);
    expect(Array.from(L.table.subarray(L.offExitRows, L.offExitRows + 2))).toEqual([0, 0b1000]);
    expect(Array.from(L.table.subarray(L.offDoor, L.offDoor + L.words))).toEqual(
      Array.from(L.doorMask),
    );
    expect(L.table.length).toBe(L.offDoor + L.words);
  });

  test('kernel emulation = compact model successors (random levels)', () => {
    const rnd = mulberry32(7);
    let checked = 0;
    for (let n = 0; n < 200; n++) checked += compareOn(validRandomLevel(rnd, n), 200);
    for (const level of sampleLevels()) checked += compareOn(level, 30);
    expect(checked).toBeGreaterThan(5000);
  });

  test('inert objects, object on the exit, start on water', () => {
    const onExit: LevelData = {
      ...fromAscii(['@.B.', '##.#', '##E#']),
      objects: [
        { x: 2, y: 0, kind: 'block' },
        { x: 2, y: 2, kind: 'key' },
        // inert: key on a wall
        { x: 0, y: 1, kind: 'key' },
      ],
    };
    expect(compareOn(onExit, 50)).toBeGreaterThan(1);
    // start on water, inert block placed on water
    const water = fromAscii(['@~k.DE', '.~B~~.'], { initialKeys: 0 });
    const level = {
      ...water,
      start: { x: 1, y: 0 },
      objects: [...water.objects, { x: 3, y: 1, kind: 'block' as const }],
    };
    expect(compareOn(level, 50)).toBeGreaterThan(1);
  });
});

describe('GPU engine limits', () => {
  test('map up to 32 × 32', () => {
    expect(gpuUnsupported(fromAscii(['@' + '.'.repeat(MAX_SIDE - 2) + 'E']))).toBeUndefined();
    expect(gpuUnsupported(fromAscii(['@' + '.'.repeat(MAX_SIDE - 1) + 'E']))).toMatch(/width/);
    const tall = fromAscii(['@', ...Array.from({ length: MAX_SIDE }, () => '.'), 'E']);
    expect(gpuUnsupported(tall)).toMatch(/height/);
  });
});

describe('buffer plan', () => {
  const MB = 1024 ** 2;
  const check = (words: number, budget: number, maxBinding = 2 ** 31) => {
    const p = planBuffers(words, budget, { maxBinding })!;
    expect(p).toBeDefined();
    expect(p.bytes).toBeLessThanOrEqual(budget);
    expect(p.storeCap).toBeLessThanOrEqual(Math.floor(p.tableSize * 0.75));
    expect(p.tableSize & (p.tableSize - 1)).toBe(0);
    for (const k of p.banks) expect(p.storeCap * k * 4).toBeLessThanOrEqual(maxBinding);
    expect(p.candCap * p.stride * 4).toBeLessThanOrEqual(maxBinding);
    expect(p.banks.reduce((a, b) => a + b, 0)).toBe(words);
    return p;
  };

  test('fits in the budget, table loaded at 75% at most', () => {
    for (const words of [1, 2, 3, 5, 10, 40])
      for (const mb of [16, 64, 512, 4096, 10_000]) check(words, mb * MB);
  });

  test('more budget, more states; ~60–100 bytes per state for 5 words', () => {
    const a = check(5, 512 * MB);
    const b = check(5, 4096 * MB);
    expect(b.storeCap).toBeGreaterThan(a.storeCap * 4);
    const perState = b.bytes / b.storeCap;
    expect(perState).toBeGreaterThan(40);
    expect(perState).toBeLessThan(110);
  });

  test('2 GiB cap per buffer and state limit', () => {
    const p = check(40, 10_000 * MB, 256 * MB);
    expect(p.storeCap * Math.max(...p.banks) * 4).toBeLessThanOrEqual(256 * MB);
    expect(planBuffers(5, 4096 * MB, { maxBinding: 2 ** 31, maxStates: 1000 })!.storeCap).toBe(
      1000,
    );
  });

  test('budget too small: no plan', () => {
    expect(planBuffers(5, 64 * 1024, { maxBinding: 2 ** 31 })).toBeUndefined();
  });
});
