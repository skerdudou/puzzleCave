/**
 * Whether the e2e browser draws WebGL on the GPU or in software, and how many workers the machine
 * can then afford (playwright.config.ts). In software (SwiftShader) one page sitting in a level
 * costs about 4.5 CPU cores at the e2e frame cap (e2e/fps.ts); with the GPU, almost nothing.
 */
import { chromium } from '@playwright/test';

/** CPU cores one test page takes when WebGL is drawn in software, rounded up (measured). */
export const SOFTWARE_CORES_PER_WORKER = 5;

/** A renderer string drawn by the CPU, or no WebGL at all (null). */
export function isSoftwareRenderer(renderer: string | null): boolean {
  return (
    renderer === null ||
    /swiftshader|llvmpipe|softpipe|software|basic render driver/i.test(renderer)
  );
}

/**
 * The workers for that renderer: Playwright's default (undefined) with the GPU, otherwise as many
 * pages as the cores can draw, at least one.
 */
export function chooseWorkers(
  renderer: string | null,
  cores: number,
  coresPerWorker = SOFTWARE_CORES_PER_WORKER,
): number | undefined {
  if (!isSoftwareRenderer(renderer)) return undefined;
  return Math.max(1, Math.floor(cores / coresPerWorker));
}

/**
 * Launches Chromium with these args and reads the WebGL renderer of a blank page (the unmasked one
 * when available). null when there is no WebGL or anything fails: never throws.
 */
export async function probeRenderer(args: string[], timeoutMs = 10_000): Promise<string | null> {
  let browser: Awaited<ReturnType<typeof chromium.launch>> | undefined;
  try {
    browser = await chromium.launch({ args, timeout: timeoutMs });
    const page = await browser.newPage();
    return await page.evaluate(() => {
      const gl = document.createElement('canvas').getContext('webgl');
      if (!gl) return null;
      const info = gl.getExtension('WEBGL_debug_renderer_info');
      return String(gl.getParameter(info ? info.UNMASKED_RENDERER_WEBGL : gl.RENDERER));
    });
  } catch {
    return null;
  } finally {
    await browser?.close().catch(() => {});
  }
}
