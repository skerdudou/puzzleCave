import { expect, test, type CDPSession, type Page } from '@playwright/test';
import { zoneAt, zoneDir, type Box, type TouchControl } from '../src/input/tapZones';

// A phone: touch screen, portrait, 2 device pixels per CSS pixel.
test.use({ viewport: { width: 390, height: 740 }, hasTouch: true, deviceScaleFactor: 2 });

type Pt = [number, number];
type Pc = {
  scene?: string;
  moves?: number;
  attempts?: number;
  player?: { x: number; y: number };
  touchControl?: TouchControl;
  zoneMoves?: number;
  zoneArea?: Box | null;
  zoneCentre?: Pt | null;
  zoneFlash?: string | null;
  zoneFlashPoints?: Pt[] | null;
  dpad?: Record<string, Pt> | null;
  hudButtons?: Record<string, Pt> | null;
  hudLayout?: { name: Box; buttons: Box[]; counters: Box[] };
  buttons?: Record<string, Pt>;
};
const debug = (page: Page): Promise<Pc> =>
  page.evaluate(() => (window as unknown as { __pc?: Pc }).__pc ?? {});
const vibrations = (page: Page) =>
  page.evaluate(() => (window as unknown as { __vib: number[][] }).__vib);
const savedSettings = (page: Page) =>
  page.evaluate(
    () =>
      (
        JSON.parse(localStorage.getItem('puzzlecave.save.v1') ?? '{}') as {
          settings?: Record<string, unknown>;
        }
      ).settings ?? {},
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

/** a save with these settings (before the game loads) */
async function withSettings(page: Page, settings: Record<string, unknown>): Promise<void> {
  await page.addInitScript((s) => {
    localStorage.setItem(
      'puzzlecave.save.v1',
      JSON.stringify({ version: 1, settings: s, levels: {} }),
    );
  }, settings);
}
const tapMode = (page: Page) => withSettings(page, { touchControl: 'tap' });

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
  async to(x: number, y: number, n = 6): Promise<void> {
    const [x0, y0] = [this.x, this.y];
    for (let i = 1; i <= n; i++) {
      this.x = x0 + ((x - x0) * i) / n;
      this.y = y0 + ((y - y0) * i) / n;
      await this.cdp.send('Input.dispatchTouchEvent', {
        type: 'touchMove',
        touchPoints: [{ x: this.x, y: this.y, id: 1 }],
      });
    }
  }
  async up(): Promise<void> {
    await this.cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  }
  async cancel(): Promise<void> {
    await this.cdp.send('Input.dispatchTouchEvent', { type: 'touchCancel', touchPoints: [] });
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
  const [cx, cy] = (await debug(page)).zoneCentre!;
  const v = { up: [0, -1], down: [0, 1], left: [-1, 0], right: [1, 0] }[dir];
  return [cx + v[0]! * dist, cy + v[1]! * dist] as const;
}

const zoneMoves = async (page: Page) => (await debug(page)).zoneMoves;
const player = async (page: Page) => (await debug(page)).player;
/** the d-pad's whole bounds, CSS px (its buttons are 56 px squares) */
async function dpadBox(page: Page): Promise<Box> {
  const c = Object.values((await debug(page)).dpad!);
  const xs = c.map(([x]) => x);
  const ys = c.map(([, y]) => y);
  const x = Math.min(...xs) - 28;
  const y = Math.min(...ys) - 28;
  return { x, y, w: Math.max(...xs) + 28 - x, h: Math.max(...ys) + 28 - y };
}
/** the bottom of the header, CSS px */
async function headerBottom(page: Page): Promise<number> {
  const l = (await debug(page)).hudLayout!;
  return Math.max(...[l.name, ...l.buttons, ...l.counters].map((b) => b.y + b.h));
}

test('drag mode (the default): a tap in a zone moves nothing', async ({ page }) => {
  const f = await startPc01(page);
  expect((await debug(page)).touchControl).toBe('drag');
  await f.tap(...(await zonePoint(page, 'right')));
  // a d-pad tap afterwards: only its move (a zone move, handled first, would show too)
  await f.tap(...(await debug(page)).dpad!.right!);
  await expect.poll(async () => (await debug(page)).moves).toBe(1);
  expect(await player(page)).toEqual({ x: 2, y: 1 });
  expect(await zoneMoves(page)).toBe(0);
});

test('tap mode: a press moves at once, before the finger is lifted', async ({ page }) => {
  await tapMode(page);
  const f = await startPc01(page);
  await f.down(...(await zonePoint(page, 'right')));
  await expect.poll(() => player(page)).toEqual({ x: 2, y: 1 });
  expect(await zoneMoves(page)).toBeGreaterThanOrEqual(1);
  // the pressed triangle is lit while the finger is down, then fades
  expect((await debug(page)).zoneFlash).toBe('right');
  await f.up();
  await expect.poll(async () => (await debug(page)).zoneFlash).toBeNull();
});

test('tap mode: a tap in each triangle moves that way; diagonal and centre do nothing', async ({
  page,
}) => {
  await tapMode(page);
  const f = await startPc01(page);
  // to (4, 4), where up, down, left and right are all open:
  // the block sinks, key, door, then along the third row and down
  for (const k of [...'RRRRRRRRDDLLLLLD'])
    await page.keyboard.press({ R: 'ArrowRight', D: 'ArrowDown', L: 'ArrowLeft' }[k]!);
  await expect.poll(() => player(page)).toEqual({ x: 4, y: 4 });
  const moves0 = (await debug(page)).moves!;

  await f.tap(...(await zonePoint(page, 'up')));
  await expect.poll(() => player(page)).toEqual({ x: 4, y: 3 });
  await f.tap(...(await zonePoint(page, 'left')));
  await expect.poll(() => player(page)).toEqual({ x: 3, y: 3 });
  await f.tap(...(await zonePoint(page, 'right')));
  await expect.poll(() => player(page)).toEqual({ x: 4, y: 3 });
  await f.tap(...(await zonePoint(page, 'down')));
  await expect.poll(() => player(page)).toEqual({ x: 4, y: 4 });
  expect((await debug(page)).moves).toBe(moves0 + 4);
  expect(await zoneMoves(page)).toBe(4);

  // on a diagonal, and in the dead circle at the centre: nothing…
  const [cx, cy] = (await debug(page)).zoneCentre!;
  await f.tap(cx + 90, cy + 90);
  await f.tap(cx - 70, cy - 70);
  await f.tap(cx + 5, cy - 6);
  // …as a following tap shows: one zone move more, its own
  await f.tap(...(await zonePoint(page, 'down')));
  await expect.poll(() => player(page)).toEqual({ x: 4, y: 5 });
  expect(await zoneMoves(page)).toBe(5);
  expect((await debug(page)).moves).toBe(moves0 + 5);
});

test('tap mode: holding repeats like the d-pad (one vibration), until lifted or cancelled', async ({
  page,
}) => {
  await recordVibrations(page);
  await tapMode(page);
  const f = await startPc01(page);
  // up from the start is a wall: each repeated attempt bumps
  await f.down(...(await zonePoint(page, 'up')));
  await expect.poll(() => zoneMoves(page)).toBeGreaterThanOrEqual(3);
  await f.up();
  const n = (await zoneMoves(page))!;
  // one press against the wall: one short vibration, not one per repeat
  expect(await vibrations(page)).toEqual([[10]]);
  // lifted: the repeat has stopped, the next tap makes exactly one move more
  await f.tap(...(await zonePoint(page, 'right')));
  await expect.poll(() => player(page)).toEqual({ x: 2, y: 1 });
  expect(await zoneMoves(page)).toBe(n + 1);
  expect((await debug(page)).moves).toBe(1);

  // a cancelled touch stops the repeat too; a new press vibrates again
  await f.down(...(await zonePoint(page, 'up')));
  await expect.poll(() => zoneMoves(page)).toBeGreaterThanOrEqual(n + 4);
  await f.cancel();
  await f.tap(...(await zonePoint(page, 'left')));
  await expect.poll(() => player(page)).toEqual({ x: 1, y: 1 });
  expect((await debug(page)).moves).toBe(2);
  expect(await vibrations(page)).toEqual([[10], [10]]);
});

test('tap mode: no drag; a finger sliding off its triangle stops, and presses nothing else', async ({
  page,
}) => {
  await tapMode(page);
  const f = await startPc01(page);
  // left of the start is a wall (a bump), then the finger slides over to the "right" triangle
  await f.down(...(await zonePoint(page, 'left')));
  await expect.poll(() => zoneMoves(page)).toBeGreaterThanOrEqual(1);
  await f.to(...(await zonePoint(page, 'right')));
  await f.up();
  // no step right, neither from the slide (no drag) nor from the triangle it ended on
  expect(await player(page)).toEqual({ x: 1, y: 1 });
  expect((await debug(page)).moves).toBe(0);
  // the repeat has stopped: a d-pad tap now is the only move
  await f.tap(...(await debug(page)).dpad!.right!);
  await expect.poll(() => player(page)).toEqual({ x: 2, y: 1 });
  expect((await debug(page)).moves).toBe(1);
});

test('tap mode: a tap on the d-pad or on Restart is not a zone tap', async ({ page }) => {
  await tapMode(page);
  const f = await startPc01(page);
  await f.tap(...(await debug(page)).dpad!.right!);
  await expect.poll(async () => (await debug(page)).moves).toBe(1);
  expect(await player(page)).toEqual({ x: 2, y: 1 });
  await f.tap(...(await debug(page)).hudButtons!.restart!);
  await expect.poll(async () => (await debug(page)).moves).toBe(0);
  expect(await player(page)).toEqual({ x: 1, y: 1 });
  expect(await zoneMoves(page)).toBe(0);
});

test('tap mode: the zones keep 24 px away from the header and the d-pad; presses there do nothing', async ({
  page,
}) => {
  await tapMode(page);
  const f = await startPc01(page);
  const area = (await debug(page)).zoneArea!;
  const pad = await dpadBox(page);
  const top = await headerBottom(page);
  // the area: under the header and above the d-pad, 24 px from both, centred X
  expect(area.y).toBeCloseTo(top + 24, 0);
  expect(area.y + area.h).toBeCloseTo(pad.y - 24, 0);
  expect((await debug(page)).zoneCentre).toEqual([area.x + area.w / 2, area.y + area.h / 2]);

  // just under Undo (in the header's margin) and beside the d-pad (in its margin): nothing,
  // though both points are in a triangle of the X
  const undo = (await debug(page)).hudLayout!.buttons.at(-1)!; // the last one drawn: Undo
  const underUndo: Pt = [undo.x + undo.w / 2, top + 12];
  const besidePad: Pt = [pad.x - 16, pad.y + 30];
  const [cx, cy] = (await debug(page)).zoneCentre!;
  for (const p of [underUndo, besidePad]) {
    // seen from the centre, without the clipping, they would be zone presses
    expect(zoneDir(p[0] - cx, p[1] - cy), `${p}`).not.toBeNull();
    expect(zoneAt(p[0], p[1], area), `${p}`).toBeNull();
    await f.tap(...p);
  }
  // inside the area, close to the d-pad: a zone again ("down" is a wall: a bump, no move)
  await f.tap(area.x + area.w / 2, area.y + area.h - 4);
  await expect.poll(() => zoneMoves(page)).toBe(1);
  expect((await debug(page)).moves).toBe(0);
  expect(await player(page)).toEqual({ x: 1, y: 1 });
});

test('tap mode: the lit triangle stays inside the area (never over the d-pad or the header)', async ({
  page,
}) => {
  await tapMode(page);
  const f = await startPc01(page);
  const area = (await debug(page)).zoneArea!;
  const inside = (pts: Pt[]) =>
    pts.every(
      ([x, y]) =>
        x >= area.x - 0.01 &&
        x <= area.x + area.w + 0.01 &&
        y >= area.y - 0.01 &&
        y <= area.y + area.h + 0.01,
    );
  for (const dir of ['down', 'up'] as const) {
    await f.down(...(await zonePoint(page, dir, area.h / 2 - 10)));
    await expect.poll(async () => (await debug(page)).zoneFlash).toBe(dir);
    const pts = (await debug(page)).zoneFlashPoints!;
    expect(inside(pts), dir).toBe(true);
    await f.up();
  }
});

test.describe('landscape', () => {
  test.use({ viewport: { width: 740, height: 360 } });
  test('tap mode: the zones stop 24 px left of the d-pad column', async ({ page }) => {
    await tapMode(page);
    const f = await startPc01(page);
    const area = (await debug(page)).zoneArea!;
    const pad = await dpadBox(page);
    expect(area.x + area.w).toBeCloseTo(pad.x - 24, 0);
    expect(area.y).toBeCloseTo((await headerBottom(page)) + 24, 0);
    expect(area.y + area.h).toBe(360);
    // left of the d-pad, within the margin: nothing; further left: "right" (a step)
    await f.tap(pad.x - 12, pad.y + pad.h / 2);
    await f.tap(area.x + area.w - 10, area.y + area.h / 2);
    await expect.poll(() => player(page)).toEqual({ x: 2, y: 1 });
    expect(await zoneMoves(page)).toBe(1);
  });
});

test('options: the touch control switches, hides the drag distance, is saved and used', async ({
  page,
}) => {
  await page.goto('/');
  await expect.poll(async () => (await debug(page)).scene).toBe('Menu');
  await page.touchscreen.tap(390 / 2, 740 / 2 + 56); // Options, under Play
  await expect.poll(async () => (await debug(page)).scene).toBe('Options');
  const buttons = async () => (await debug(page)).buttons!;
  expect(await buttons()).toHaveProperty('drag-plus');
  const [x, y] = (await buttons()).touchControl!;
  await page.touchscreen.tap(x, y);
  await expect.poll(async () => (await savedSettings(page)).touchControl).toBe('tap');
  // the drag distance only matters to the drag: not shown in tap mode
  await expect.poll(async () => Object.keys(await buttons())).not.toContain('drag-plus');
  await page.reload();
  await expect.poll(async () => (await debug(page)).scene).toBe('Menu');
  expect((await savedSettings(page)).touchControl).toBe('tap');
  await page.keyboard.press('Enter');
  await expect.poll(async () => (await debug(page)).scene).toBe('Select');
  await page.keyboard.press('Enter');
  await expect.poll(async () => (await debug(page)).scene).toBe('Game');
  expect((await debug(page)).touchControl).toBe('tap');
});

test('an old save with tap zones around the player plays in tap mode', async ({ page }) => {
  await withSettings(page, { tapZones: 'player' });
  const f = await startPc01(page);
  expect((await debug(page)).touchControl).toBe('tap');
  await f.tap(...(await zonePoint(page, 'right')));
  await expect.poll(() => player(page)).toEqual({ x: 2, y: 1 });
});
