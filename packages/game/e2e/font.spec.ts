import { expect, test, type Page } from '@playwright/test';

const debug = (page: Page) =>
  page.evaluate(() => (window as unknown as { __pc?: Record<string, unknown> }).__pc ?? {});

test('the pixel font is loaded before the game starts', async ({ page }) => {
  await page.goto('/');
  await expect.poll(async () => (await debug(page)).scene).toBe('Menu');
  expect(await page.evaluate(() => document.fonts.check('16px Silkscreen'))).toBe(true);
  // check() is also true when no such face exists at all: make sure one really got loaded
  expect(
    await page.evaluate(() =>
      [...document.fonts].some((f) => f.family.includes('Silkscreen') && f.status === 'loaded'),
    ),
  ).toBe(true);
});
