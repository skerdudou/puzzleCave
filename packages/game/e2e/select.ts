import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { expect, type Page } from '@playwright/test';

const chapters = JSON.parse(
  readFileSync(fileURLToPath(new URL('../../../levels/chapters.json', import.meta.url)), 'utf8'),
) as { id: string; levels: string[] }[];

type Pc = { scene?: string; chapter?: string; levelId?: string };
const pc = (page: Page): Promise<Pc> =>
  page.evaluate(() => (window as unknown as { __pc?: Pc }).__pc ?? {});

/**
 * On the selection screen, moves to a level by its id (PageDown/PageUp to its chapter, then
 * exactly as many arrows as the chapter order says), whatever the order of the chapters.
 */
export async function goToLevel(page: Page, id: string): Promise<void> {
  const target = chapters.findIndex((c) => c.levels.includes(id));
  expect(target).toBeGreaterThanOrEqual(0);
  await expect.poll(async () => (await pc(page)).scene).toBe('Select');
  const start = (await pc(page)).chapter;
  let ci = chapters.findIndex((c) => c.id === start);
  while (ci !== target) {
    const step = ci < target ? 1 : -1;
    await page.keyboard.press(step > 0 ? 'PageDown' : 'PageUp');
    ci += step;
    await expect.poll(async () => (await pc(page)).chapter).toBe(chapters[ci]!.id);
  }
  const levels = chapters[target]!.levels;
  const from = levels.indexOf((await pc(page)).levelId!);
  const to = levels.indexOf(id);
  for (let i = 0; i < Math.abs(to - from); i++)
    await page.keyboard.press(to > from ? 'ArrowRight' : 'ArrowLeft');
  await expect.poll(async () => (await pc(page)).levelId).toBe(id);
}
