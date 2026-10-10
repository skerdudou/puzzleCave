import { expect, test, type Page } from '@playwright/test';

const debug = (page: Page) =>
  page.evaluate(() => (window as unknown as { __pc?: Record<string, unknown> }).__pc ?? {});
const button = async (page: Page, id: string) =>
  ((await debug(page)).buttons as Record<string, [number, number]>)[id]!;

test('the language is picked from a drop-down list', async ({ page }) => {
  await page.goto('/');
  await expect.poll(async () => (await debug(page)).scene).toBe('Menu');
  await page.mouse.click(640, 360 + 56); // Options button, under Play (1280×720 viewport)
  await expect.poll(async () => (await debug(page)).scene).toBe('Options');
  expect((await debug(page)).lang).toBe('en');

  const [lx, ly] = await button(page, 'lang');
  await page.mouse.click(lx, ly);
  await expect.poll(async () => (await debug(page)).langMenuOpen).toBe(true);
  const [dx, dy] = await button(page, 'lang-de');
  await page.mouse.click(dx, dy);
  await expect.poll(async () => (await debug(page)).lang).toBe('de');
  expect((await debug(page)).langMenuOpen).toBe(false);

  // Escape closes an open list without leaving Options
  const [lx2, ly2] = await button(page, 'lang');
  await page.mouse.click(lx2, ly2);
  await expect.poll(async () => (await debug(page)).langMenuOpen).toBe(true);
  await page.keyboard.press('Escape');
  await expect.poll(async () => (await debug(page)).langMenuOpen).toBe(false);
  expect((await debug(page)).scene).toBe('Options');

  // a click outside the list closes it too, without changing the language
  await page.mouse.click(lx2, ly2);
  await expect.poll(async () => (await debug(page)).langMenuOpen).toBe(true);
  await page.mouse.click(20, 700);
  await expect.poll(async () => (await debug(page)).langMenuOpen).toBe(false);
  expect((await debug(page)).lang).toBe('de');
});
