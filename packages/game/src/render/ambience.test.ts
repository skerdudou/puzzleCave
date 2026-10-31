import { describe, expect, test, vi } from 'vitest';

// `../levels` imports the Vite-only `virtual:levels`; the root vitest config has no plugin, so stub it.
vi.mock('../levels', () => {
  const chapters = ['easy', 'medium', 'hard', 'expert', 'other'].map((id) => ({
    id,
    levels: [`${id}-1`, `${id}-2`],
  }));
  return {
    chapters,
    locate(id: string) {
      for (let ci = 0; ci < chapters.length; ci++) {
        const li = chapters[ci]!.levels.indexOf(id);
        if (li >= 0) return { chapterIndex: ci, levelIndex: li };
      }
      return null;
    },
  };
});

import { chapters } from '../levels';
import {
  BOARD_LIGHT_CUT,
  DARK_OUTSIDE,
  chapterTint,
  initMotes,
  lightRadius,
  mixTowards,
  moteAlpha,
  motePosition,
  rockStones,
  vignetteRadii,
} from './ambience';

const screen = { x: 0, y: 0, w: 400, h: 225 };
const board = { x: 100, y: 50, w: 160, h: 112 };
// distance from a stone's nominal centre (jitter is at most 2 px) to the board
const distToBoard = (sx: number, sy: number, b: typeof board) => {
  const cx = sx + 8,
    cy = sy + 8;
  return Math.hypot(
    Math.max(b.x - cx, 0, cx - (b.x + b.w)),
    Math.max(b.y - cy, 0, cy - (b.y + b.h)),
  );
};

describe('rockStones', () => {
  test('is deterministic', () => {
    expect(rockStones(screen, board)).toEqual(rockStones(screen, board));
  });
  test('no stone centre inside the board, alphas in (0.02, 1]', () => {
    const stones = rockStones(screen, board);
    expect(stones.length).toBeGreaterThan(50);
    for (const s of stones) {
      const inside =
        s.x + 8 > board.x &&
        s.x + 8 < board.x + board.w &&
        s.y + 8 > board.y &&
        s.y + 8 < board.y + board.h;
      expect(inside).toBe(false);
      expect(s.alpha).toBeGreaterThan(0.02);
      expect(s.alpha).toBeLessThanOrEqual(1);
    }
  });
  test('brighter near the board than far away; nothing beyond 150 px', () => {
    const stones = rockStones(screen, board);
    const mean = (a: number[]) => a.reduce((p, c) => p + c, 0) / a.length;
    const near = stones.filter((s) => distToBoard(s.x, s.y, board) <= 20).map((s) => s.alpha);
    const far = stones.filter((s) => distToBoard(s.x, s.y, board) >= 96).map((s) => s.alpha);
    expect(near.length).toBeGreaterThan(0);
    expect(far.length).toBeGreaterThan(0);
    expect(mean(near)).toBeGreaterThan(mean(far));
    for (const s of stones) expect(distToBoard(s.x, s.y, board)).toBeLessThan(150 + 12);
  });
  test('works with a fractional board', () => {
    const stones = rockStones(screen, { x: 10.5, y: 20.25, w: 150.5, h: 100.75 });
    expect(stones.length).toBeGreaterThan(0);
    for (const s of stones) expect(Number.isFinite(s.alpha + s.x + s.y)).toBe(true);
  });
});

describe('light', () => {
  test('lightRadius', () => {
    expect(lightRadius(0, true)).toBe(78);
    for (let t = 0; t <= 10; t += 0.1)
      expect(Math.abs(lightRadius(t, false) - 78)).toBeLessThanOrEqual(2.5);
  });
  test('board darkness stays low', () => {
    expect(DARK_OUTSIDE * (1 - BOARD_LIGHT_CUT)).toBeLessThanOrEqual(0.3);
  });
});

describe('dust', () => {
  test('initMotes is deterministic and inside the screen', () => {
    const m = initMotes(400, 225);
    expect(m).toHaveLength(46);
    expect(initMotes(400, 225)).toEqual(m);
    for (const p of m) {
      expect(p.x).toBeGreaterThanOrEqual(0);
      expect(p.x).toBeLessThan(400);
      expect(p.y).toBeGreaterThanOrEqual(0);
      expect(p.y).toBeLessThan(225);
    }
  });
  test('motePosition stays in bounds; reduced motion is static', () => {
    for (const m of initMotes(400, 225)) {
      for (let t = 0; t <= 100; t += 0.37) {
        const [x, y] = motePosition(m, t, 400, 225, false);
        expect(x).toBeGreaterThanOrEqual(0);
        expect(x).toBeLessThan(400);
        expect(y).toBeGreaterThanOrEqual(0);
        expect(y).toBeLessThan(225);
      }
      expect(motePosition(m, 0, 400, 225, true)).toEqual(motePosition(m, 77, 400, 225, true));
    }
  });
  test('moteAlpha', () => {
    expect(moteAlpha(0, true)).toBe(0.75);
    expect(moteAlpha(1000, true)).toBeCloseTo(0.325);
    expect(moteAlpha(5, false)).toBe(0.5);
  });
});

describe('tint', () => {
  test('chapterTint per chapter', () => {
    const want: Record<string, number> = {
      easy: 0x4f9a5a,
      medium: 0x4a6fa5,
      hard: 0xc8643c,
      expert: 0x8a6ee0,
    };
    for (const [id, c] of Object.entries(want)) {
      const ch = chapters.find((x: { id: string }) => x.id === id);
      expect(ch).toBeDefined();
      expect(chapterTint(ch!.levels[0]!)).toBe(c);
    }
    expect(
      chapterTint(chapters.find((x: { id: string }) => x.id === 'other')!.levels[0]!),
    ).toBeNull();
    expect(chapterTint('nope')).toBeNull();
  });
  test('mixTowards', () => {
    expect(mixTowards(0x000000, 0)).toBe(0xffffff);
    expect(mixTowards(0x4a6fa5, 1)).toBe(0x4a6fa5);
  });
});

describe('vignetteRadii', () => {
  // the darkest a board corner can get: the board's own darkness, then the vignette over it
  const cornerDarkness = (W: number, H: number, b: { w: number; h: number }) => {
    const { inner, outer } = vignetteRadii(W, H, b);
    const d = Math.hypot(b.w / 2, b.h / 2);
    const v = 0.6 * Math.min(1, Math.max(0, (d - inner) / (outer - inner)));
    const dark = DARK_OUTSIDE * (1 - BOARD_LIGHT_CUT);
    return 1 - (1 - dark) * (1 - v);
  };

  test('the spec radii around a small board', () => {
    expect(vignetteRadii(640, 360, { w: 96, h: 80 })).toEqual({
      inner: 360 * 0.35,
      outer: 640 * 0.72,
    });
  });

  test('never reaches into the board: a board corner stays within ~30 % darkness', () => {
    // Gold Teeth (17×18) at 1280×720, scale 2; a wide board on a phone in landscape; a tall one in portrait
    const cases = [
      [640, 360, 272, 288],
      [370, 180, 288, 176],
      [360, 740, 256, 400],
    ] as const;
    for (const [W, H, w, h] of cases) {
      const r = vignetteRadii(W, H, { w, h });
      expect(r.inner).toBeGreaterThanOrEqual(Math.hypot(w / 2, h / 2));
      expect(r.outer).toBeGreaterThan(r.inner);
      expect(cornerDarkness(W, H, { w, h })).toBeLessThanOrEqual(0.3);
    }
  });
});
