import { expect, test, type CDPSession, type Page } from '@playwright/test';
import { zoneDir, type TapZoneMode } from '../src/input/tapZones';

// A phone: touch screen, portrait, 2 device pixels per CSS pixel.
test.use({ viewport: { width: 390, height: 740 }, hasTouch: true, deviceScaleFactor: 2 });

type Pt = [number, number];
type Pc = {
  scene?: string;
  moves?: number;
  player?: { x: number; y: number };
  tapZones?: TapZoneMode;
  zoneMoves?: number;
  zoneCentres?: { screen: Pt; player: Pt };
  dpad?: Record<string, Pt> | null;
  hudButtons?: Record<string, Pt> | null;
  hudLayout?: { buttons: { x: number; y: number; w: number; h: number }[] };
  buttons?: Record<string, Pt>;
};
const debug = (page: Page): Promise<Pc> =>
  page.evaluate(() => (window as unknown as { __pc?: Pc }).__pc ?? {});
const vibrations = (page: Page) =>
  page.evaluate(() => (window as unknown as { __vib: number[][] }).__vib);
const savedZones = (page: Page) =>
  page.evaluate(
    () =>
      (
        JSON.parse(localStorage.getItem('puzzlecave.save.v1') ?? '{}') as {
          settings?: { tapZones?: string };
        }
      ).settings?.tapZones,
  );

/** navigator.vibrate replaced by a recorder (window.__vib) */
async function recordVibrations(page: Page): Promise<void> {
  await page.addInitScript(() => {
    const w = window as unknown as { __vib: unknown[] };
    w.__vib = [];
    Object.defineProperty(Navigator.prototype, 'vibrate', {
      configurable: true,
      value: (p: unknown) => (w.__vib.push(p), true),
    });
  });
}

/** a save with the tap zones set (before the game loads) */
async function withZones(page: Page, mode: TapZoneMode): Promise<void> {
  await page.addInitScript((tapZones) => {
    localStorage.setItem(
      'puzzlecave.save.v1',
      JSON.stringify({ version: 1, settings: { tapZones }, levels: {} }),
    );
  }, mode);
}

/** Real touch events (Chromium DevTools protocol): one finger, CSS pixels. */
class Finger {
  private x = 0;
  private y = 0;
  constructor(private readonly cdp: CDPSession) {}
  static async on(page: Page): Promise<Finger> {
    return new Finger(await page.context().newCDPSession(page));
  }
  async down(x: number, y: number): Promise<void> {
    [this.x, this.y] = [x, y];
    await this.cdp.send('Input.dispatchTouchEvent', {
      type: 'touchStart',
      touchPoints: [{ x, y, id: 1 }],
    });
  }
  async by(dx: number, dy: number, n = 12): Promise<void> {
    const [x0, y0] = [this.x, this.y];
    for (let i = 1; i <= n; i++) {
      this.x = x0 + (dx * i) / n;
      this.y = y0 + (dy * i) / n;
      await this.cdp.send('Input.dispatchTouchEvent', {
        type: 'touchMove',
        touchPoints: [{ x: this.x, y: this.y, id: 1 }],
      });
    }
  }
  async up(): Promise<void> {
    await this.cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  }
  async tap(x: number, y: number): Promise<void> {
    await this.down(x, y);
    await this.up();
  }
}

/** pc-01, first row: @ . B . ~ . k . . (walls above and below the start) */
async function startPc01(page: Page): Promise<Finger> {
  await page.goto('/');
  await expect.poll(async () => (await debug(page)).scene).toBe('Menu');
  await page.keyboard.press('Enter');
  await expect.poll(async () => (await debug(page)).scene).toBe('Select');
  await page.keyboard.press('Enter');
  await expect.poll(async () => (await debug(page)).scene).toBe('Game');
  // the d-pad and the buttons are drawn: they answer taps
  await expect.poll(async () => (await debug(page)).dpad).toBeTruthy();
  return Finger.on(page);
}

/** a point `dist` CSS px from the zone centre, in the direction `dir` */
async function zonePoint(page: Page, dir: 'up' | 'down' | 'left' | 'right', dist = 110) {
  const [cx, cy] = (await debug(page)).zoneCentres!.screen;
  const v = { up: [0, -1], down: [0, 1], left: [-1, 0], right: [1, 0] }[dir];
  return [cx + v[0]! * dist, cy + v[1]! * dist] as const;
}

const zoneMoves = async (page: Page) => (await debug(page)).zoneMoves;

test('option off: a tap in a zone moves nothing', async ({ page }) => {
  const f = await startPc01(page);
  expect((await debug(page)).tapZones).toBe('off');
  await f.tap(...(await zonePoint(page, 'right')));
  // a d-pad tap afterwards: only its move (a zone move, handled first, would show too)
  await f.tap(...(await debug(page)).dpad!.right!);
  await expect.poll(async () => (await debug(page)).moves).toBe(1);
  expect((await debug(page)).player).toEqual({ x: 2, y: 1 });
  expect(await zoneMoves(page)).toBe(0);
});

test('screen-centred: a tap in each triangle moves that way; diagonal and centre do nothing', async ({
  page,
}) => {
  await withZones(page, 'screen');
  const f = await startPc01(page);
  // to (4, 4), where up, down, left and right are all open:
  // the block sinks, key, door, then along the third row and down
  for (const k of [...'RRRRRRRRDDLLLLLD'])
    await page.keyboard.press({ R: 'ArrowRight', D: 'ArrowDown', L: 'ArrowLeft' }[k]!);
  await expect.poll(async () => (await debug(page)).player).toEqual({ x: 4, y: 4 });
  const moves0 = (await debug(page)).moves!;
  const player = async () => (await debug(page)).player;

  await f.tap(...(await zonePoint(page, 'up')));
  await expect.poll(player).toEqual({ x: 4, y: 3 });
  await f.tap(...(await zonePoint(page, 'left')));
  await expect.poll(player).toEqual({ x: 3, y: 3 });
  await f.tap(...(await zonePoint(page, 'right')));
  await expect.poll(player).toEqual({ x: 4, y: 3 });
  await f.tap(...(await zonePoint(page, 'down')));
  await expect.poll(player).toEqual({ x: 4, y: 4 });
  expect((await debug(page)).moves).toBe(moves0 + 4);
  expect(await zoneMoves(page)).toBe(4);

  // on a diagonal, and in the dead circle at the centre: nothing…
  const [cx, cy] = (await debug(page)).zoneCentres!.screen;
  await f.tap(cx + 90, cy + 90);
  await f.tap(cx - 70, cy - 70);
  await f.tap(cx + 5, cy - 6);
  // …as a following tap shows: one zone move more, its own
  await f.tap(...(await zonePoint(page, 'down')));
  await expect.poll(player).toEqual({ x: 4, y: 5 });
  expect(await zoneMoves(page)).toBe(5);
  expect((await debug(page)).moves).toBe(moves0 + 5);
});

test('screen-centred: holding a finger still repeats, until lifted', async ({ page }) => {
  await recordVibrations(page);
  await withZones(page, 'screen');
  const f = await startPc01(page);
  // up from the start is a wall: each repeated attempt bumps
  await f.down(...(await zonePoint(page, 'up')));
  await expect.poll(() => zoneMoves(page)).toBeGreaterThanOrEqual(3);
  await f.up();
  const n = (await zoneMoves(page))!;
  expect(n).toBeGreaterThanOrEqual(3);
  // one press against the wall: one short vibration, not one per repeat
  expect(await vibrations(page)).toEqual([[10]]);
  // lifted: the repeat has stopped, the next tap makes exactly one move more
  await f.tap(...(await zonePoint(page, 'right')));
  await expect.poll(async () => (await debug(page)).player).toEqual({ x: 2, y: 1 });
  expect(await zoneMoves(page)).toBe(n + 1);
  expect((await debug(page)).moves).toBe(1);
});

test('screen-centred: a drag that starts in a zone is only a drag', async ({ page }) => {
  await withZones(page, 'screen');
  const f = await startPc01(page);
  const [x, y] = await zonePoint(page, 'left');
  await f.down(x, y);
  // 2 steps of 40 px (the first touchmove is already past the tap slop): 2 moves, a push
  await f.by(2 * 40 + 4, 0, 4);
  await f.up();
  await expect.poll(async () => (await debug(page)).moves).toBe(2);
  expect((await debug(page)).player).toEqual({ x: 3, y: 1 });
  expect(await zoneMoves(page)).toBe(0);
  // no tap on the drag's release either: a tap now is the 3rd move
  await f.tap(x, y);
  await expect.poll(async () => (await debug(page)).moves).toBe(3);
  expect((await debug(page)).player).toEqual({ x: 2, y: 1 });
  expect(await zoneMoves(page)).toBe(1);
});

test('screen-centred: a tap on the d-pad or on Restart is not a zone tap', async ({ page }) => {
  await withZones(page, 'screen');
  const f = await startPc01(page);
  await f.tap(...(await debug(page)).dpad!.right!);
  await expect.poll(async () => (await debug(page)).moves).toBe(1);
  expect((await debug(page)).player).toEqual({ x: 2, y: 1 });
  await f.tap(...(await debug(page)).hudButtons!.restart!);
  await expect.poll(async () => (await debug(page)).moves).toBe(0);
  expect((await debug(page)).player).toEqual({ x: 1, y: 1 });
  expect(await zoneMoves(page)).toBe(0);
});

test('screen-centred: a press that just misses Undo or the d-pad does nothing', async ({
  page,
}) => {
  await withZones(page, 'screen');
  const f = await startPc01(page);
  await f.tap(...(await debug(page)).dpad!.right!);
  await expect.poll(async () => (await debug(page)).moves).toBe(1);
  const layout = (await debug(page)).hudLayout!;
  const undo = layout.buttons.at(-1)!; // the last one drawn from the right: Undo
  // just under Undo, and just left of the d-pad's left button: no zone tap, no undo
  await f.tap(undo.x + undo.w / 2, undo.y + undo.h + 12);
  const [lx, ly] = (await debug(page)).dpad!.left!;
  const half = 28; // the d-pad's half size, CSS px
  const beside: Pt = [lx - half - 16, ly];
  const [cx, cy] = (await debug(page)).zoneCentres!.screen;
  // (that point is in the "down" triangle: without the margin it would be a step)
  expect(zoneDir(beside[0] - cx, beside[1] - cy)).toBe('down');
  await f.tap(...beside);
  // further from the d-pad, the same triangle is a zone again: its step comes alone
  await f.tap(lx - half - 40, ly);
  await expect.poll(() => zoneMoves(page)).toBe(1);
  expect((await debug(page)).moves).toBe(1); // down is a wall: a bump, no move
  expect((await debug(page)).player).toEqual({ x: 2, y: 1 });
});

test('player-centred: a tap just left of the player moves left, though "up" from the screen centre', async ({
  page,
}) => {
  await withZones(page, 'player');
  const f = await startPc01(page);
  for (let i = 0; i < 4; i++) await page.keyboard.press('ArrowRight'); // the block sinks
  await expect.poll(async () => (await debug(page)).player).toEqual({ x: 5, y: 1 });
  const { screen, player } = (await debug(page)).zoneCentres!;
  const p: Pt = [player[0] - 30, player[1]];
  // the point is in the screen's "up" triangle, and left of the player
  expect(zoneDir(p[0] - screen[0], p[1] - screen[1])).toBe('up');
  expect(zoneDir(p[0] - player[0], p[1] - player[1])).toBe('left');
  await f.tap(...p);
  await expect.poll(async () => (await debug(page)).player).toEqual({ x: 4, y: 1 });
  expect(await zoneMoves(page)).toBe(1);
  // the zones follow the player: a tap left of its new position moves left again
  const moved = (await debug(page)).zoneCentres!.player;
  expect(moved[0]).toBeLessThan(player[0]);
  await f.tap(moved[0] - 30, moved[1]);
  await expect.poll(async () => (await debug(page)).player).toEqual({ x: 3, y: 1 });
});

test('options: the tap zones setting cycles, is saved and used by the game', async ({ page }) => {
  await page.goto('/');
  await expect.poll(async () => (await debug(page)).scene).toBe('Menu');
  await page.touchscreen.tap(390 / 2, 740 / 2 + 56); // Options, under Play
  await expect.poll(async () => (await debug(page)).scene).toBe('Options');
  const tap = async () => {
    const [x, y] = (await debug(page)).buttons!.tapZones!;
    await page.touchscreen.tap(x, y);
  };
  await tap();
  await expect.poll(() => savedZones(page)).toBe('screen');
  await tap();
  await expect.poll(() => savedZones(page)).toBe('player');
  await page.reload();
  await expect.poll(async () => (await debug(page)).scene).toBe('Menu');
  expect(await savedZones(page)).toBe('player');
  await page.keyboard.press('Enter');
  await expect.poll(async () => (await debug(page)).scene).toBe('Select');
  await page.keyboard.press('Enter');
  await expect.poll(async () => (await debug(page)).scene).toBe('Game');
  expect((await debug(page)).tapZones).toBe('player');
});
