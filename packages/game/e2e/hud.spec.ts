import { expect, test, type Page } from '@playwright/test';

type Box = { x: number; y: number; w: number; h: number };
type Pc = {
  scene?: string;
  levelId?: string;
  dpad?: unknown;
  hudName?: string;
  hudIcons?: Record<string, string> | null;
  hudLayout?: { name: Box; buttons: Box[]; counters: Box[] };
  hudSide?: boolean;
  boardLayout?: { x: number; width: number };
};
const debug = (page: Page): Promise<Pc> =>
  page.evaluate(() => (window as unknown as { __pc?: Pc }).__pc ?? {});

const overlap = (a: Box, b: Box) =>
  a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;

async function startPc01(page: Page): Promise<Pc> {
  await page.goto('/');
  await expect.poll(async () => (await debug(page)).scene).toBe('Menu');
  await page.keyboard.press('Enter');
  await expect.poll(async () => (await debug(page)).scene).toBe('Select');
  await page.keyboard.press('Enter');
  await expect.poll(async () => (await debug(page)).scene).toBe('Game');
  await expect.poll(async () => (await debug(page)).dpad).toBeTruthy();
  return debug(page);
}

/** the HUD fits: nothing overlaps, everything on the screen, buttons big enough for a finger */
function checkLayout(pc: Pc, width: number): void {
  const { name, buttons, counters } = pc.hudLayout!;
  const all = [name, ...buttons, ...counters];
  for (let i = 0; i < all.length; i++) {
    expect(all[i]!.x).toBeGreaterThanOrEqual(0);
    expect(all[i]!.x + all[i]!.w).toBeLessThanOrEqual(width);
    for (let j = i + 1; j < all.length; j++)
      expect(overlap(all[i]!, all[j]!), `${i}/${j}`).toBe(false);
  }
  for (const b of buttons) {
    expect(b.w).toBeGreaterThanOrEqual(44);
    expect(b.h).toBeGreaterThanOrEqual(44);
  }
}

test.describe('small phone, 320 px', () => {
  test.use({ viewport: { width: 320, height: 740 }, hasTouch: true, deviceScaleFactor: 2 });
  test("the level's name is shown in full beside the buttons", async ({ page }) => {
    const pc = await startPc01(page);
    expect(pc.levelId).toBe('pc-01');
    expect(pc.hudName).toBe('First Lesson');
    checkLayout(pc, 320);
  });
});

test.describe('narrow screen, 270 px', () => {
  test.use({ viewport: { width: 270, height: 640 }, hasTouch: true, deviceScaleFactor: 2 });
  test('Undo and Restart become icons to leave the name its room, nothing overlaps', async ({
    page,
  }) => {
    const pc = await startPc01(page);
    expect(pc.hudName).toBe('First Lesson');
    // the words are kept (the buttons' names)
    expect(pc.hudIcons).toEqual({ undo: 'Undo', restart: 'Restart' });
    checkLayout(pc, 270);
  });
});

test.describe('very narrow screen, 220 px', () => {
  test.use({ viewport: { width: 220, height: 640 }, hasTouch: true, deviceScaleFactor: 2 });
  test('a name too long for the room is cut with an ellipsis, nothing overlaps', async ({
    page,
  }) => {
    const pc = await startPc01(page);
    expect(pc.hudName).toMatch(/…$/);
    expect('First Lesson'.startsWith(pc.hudName!.slice(0, -1))).toBe(true);
    expect(pc.hudName!.length).toBeGreaterThan(1);
    checkLayout(pc, 220);
  });
});

test.describe('landscape phone, 740 × 360', () => {
  test.use({ viewport: { width: 740, height: 360 }, hasTouch: true, deviceScaleFactor: 2 });
  test('a column on the left: name, counters and buttons one under the other', async ({ page }) => {
    const pc = await startPc01(page);
    expect(pc.hudName).toBe('First Lesson');
    expect(pc.hudSide).toBe(true);
    checkLayout(pc, 740);
    // all of it in the column, the board right of it (device px over 2)
    const { name, buttons, counters } = pc.hudLayout!;
    for (const b of [name, ...buttons, ...counters]) expect(b.x + b.w).toBeLessThanOrEqual(128);
    expect(pc.boardLayout!.x / 2).toBeGreaterThanOrEqual(128);
  });
});
