import type { Page } from '@playwright/test';

/** A button's centre on the screen (CSS px), as the current scene reports it. */
export const buttonAt = (page: Page, id: string): Promise<[number, number]> =>
  page.evaluate(
    (id) =>
      (window as unknown as { __pc?: { buttons?: Record<string, [number, number]> } }).__pc!
        .buttons![id]!,
    id,
  );

/**
 * Clicks an Options button: the page scrolls when it is taller than the screen, so it is wheeled
 * until the button shows.
 */
export async function clickScrolled(page: Page, id: string): Promise<void> {
  const { width, height } = page.viewportSize()!;
  await page.mouse.move(width / 2, height / 2);
  for (let i = 0; i < 20; i++) {
    const [x, y] = await buttonAt(page, id);
    if (y > 20 && y < height - 20) return page.mouse.click(x, y);
    await page.mouse.wheel(0, 120);
    await page.waitForTimeout(50);
  }
  throw new Error(`button ${id} never came on the screen`);
}
