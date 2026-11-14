import { expect, test, type Page } from '@playwright/test';

type Pc = {
  scene?: string;
  buttons?: Record<string, [number, number]>;
  buttonWidths?: Record<string, number>;
  installOffered?: boolean;
  fullscreenOffered?: boolean;
};
const debug = (page: Page): Promise<Pc> =>
  page.evaluate(() => (window as unknown as { __pc?: Pc }).__pc ?? {});

/** The browser's install offer (Chrome's beforeinstallprompt), counting the boxes it opens. */
const offerInstall = (page: Page) =>
  page.evaluate(() => {
    const w = window as unknown as { __prompts: number };
    w.__prompts = 0;
    const e = new Event('beforeinstallprompt', { cancelable: true });
    Object.assign(e, {
      prompt: () => {
        w.__prompts++;
        return Promise.resolve();
      },
      userChoice: Promise.resolve({ outcome: 'dismissed' }),
    });
    window.dispatchEvent(e);
  });

// a phone in portrait, in French (the longest label), where the full screen button shows too
test.use({ locale: 'fr-FR', hasTouch: true, isMobile: true, viewport: { width: 360, height: 740 } });

test("the menu's Install button: only on the browser's offer, opens its box once", async ({
  page,
}) => {
  await page.goto('/');
  await expect.poll(async () => (await debug(page)).scene).toBe('Menu');
  // no offer (Safari, already installed): no button
  expect((await debug(page)).installOffered).toBe(false);
  await offerInstall(page);
  await expect.poll(async () => (await debug(page)).installOffered).toBe(true);
  const d = await debug(page);
  const [x, y] = d.buttons!.install!;
  // in the top left corner, clear of the full screen button in the top right one
  expect(x).toBeLessThan(180);
  expect(y).toBeLessThan(40);
  if (d.fullscreenOffered) {
    const right = x + d.buttonWidths!.install! / 2;
    const left = d.buttons!.fullscreen![0] - d.buttonWidths!.fullscreen! / 2;
    expect(right).toBeLessThan(left);
  }
  await page.screenshot({ path: test.info().outputPath('menu-install.png') });
  await page.touchscreen.tap(x, y);
  await expect.poll(async () => (await debug(page)).installOffered).toBe(false);
  expect(await page.evaluate(() => (window as unknown as { __prompts: number }).__prompts)).toBe(1);
});
