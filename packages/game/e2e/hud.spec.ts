import { expect, test, type Page } from '@playwright/test';

type Box = { x: number; y: number; w: number; h: number };
type Pc = {
  scene?: string;
  levelId?: string;
  dpad?: unknown;
  hudName?: string;
  hudLayout?: { name: Box; buttons: Box[]; counters: Box[] };
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
    expect(pc.hudName).toBe('Five Lessons');
    checkLayout(pc, 320);
  });
});

test.describe('very narrow screen, 280 px', () => {
  test.use({ viewport: { width: 280, height: 640 }, hasTouch: true, deviceScaleFactor: 2 });
  test('a name too long for the room is cut with an ellipsis, nothing overlaps', async ({
    page,
  }) => {
    const pc = await startPc01(page);
    expect(pc.hudName).toMatch(/…$/);
    expect('Five Lessons'.startsWith(pc.hudName!.slice(0, -1))).toBe(true);
    expect(pc.hudName!.length).toBeGreaterThan(1);
    checkLayout(pc, 280);
  });
});

test.describe('landscape phone, 740 × 360', () => {
  test.use({ viewport: { width: 740, height: 360 }, hasTouch: true, deviceScaleFactor: 2 });
  test('one row: counters, name and buttons side by side', async ({ page }) => {
    const pc = await startPc01(page);
    expect(pc.hudName).toBe('Five Lessons');
    checkLayout(pc, 740);
  });
});
