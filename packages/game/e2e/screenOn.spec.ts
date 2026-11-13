import { expect, test, type Page } from '@playwright/test';

const debug = (page: Page) =>
  page.evaluate(() => (window as unknown as { __pc?: Record<string, unknown> }).__pc ?? {});
const field = async (page: Page, k: string) => (await debug(page))[k];

test('the screen is kept on while the clock goes: from the first move, not after a restart', async ({
  page,
}) => {
  await page.goto('/');
  await expect.poll(() => field(page, 'scene')).toBe('Menu');
  await page.keyboard.press('Enter');
  await expect.poll(() => field(page, 'scene')).toBe('Select');
  await page.keyboard.press('Enter');
  await expect.poll(() => field(page, 'scene')).toBe('Game');
  await page.keyboard.press('Space'); // the level's banner
  // before the first move: the phone sleeps as it would
  await page.waitForTimeout(300);
  expect(await field(page, 'screenKeptOn')).toBeFalsy();
  await page.keyboard.press('ArrowRight');
  await expect.poll(() => field(page, 'screenKeptOn')).toBe(true);
  // a restart: a new clock, not started until the next move
  await page.keyboard.press('KeyR');
  await expect.poll(() => field(page, 'screenKeptOn')).toBe(false);
});
