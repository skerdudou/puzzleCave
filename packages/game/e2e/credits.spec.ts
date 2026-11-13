import { expect, test, type Page } from '@playwright/test';

type Pc = { scene?: string; buttons?: Record<string, [number, number]>; creditsBottom?: number };
const debug = (page: Page): Promise<Pc> =>
  page.evaluate(() => (window as unknown as { __pc?: Pc }).__pc ?? {});
const texts = (page: Page) =>
  page.evaluate(() =>
    (window as unknown as { __pcTexts: () => { text: string }[] }).__pcTexts().map((t) => t.text),
  );

test.use({ locale: 'en-US' });

for (const [w, h] of [
  [1280, 720],
  [740, 360],
  [360, 740],
]) {
  test(`credits from the menu's corner, back with Escape (${w}×${h})`, async ({ page }) => {
    await page.setViewportSize({ width: w!, height: h! });
    await page.goto('/');
    await expect.poll(async () => (await debug(page)).scene).toBe('Menu');
    const [x, y] = (await debug(page)).buttons!.credits!;
    await page.mouse.click(x, y);
    await expect.poll(async () => (await debug(page)).scene).toBe('Credits');
    // the music's credit as its author asks it, the whole list on the screen
    const shown = (await texts(page)).join('\n');
    expect(shown).toContain('Music by Eric Matyas');
    expect(shown).toContain('www.soundimage.org');
    // (device px: 1 a CSS px here)
    expect((await debug(page)).creditsBottom!).toBeLessThanOrEqual(h!);
    await page.keyboard.press('Escape');
    await expect.poll(async () => (await debug(page)).scene).toBe('Menu');
  });
}
