import { availableParallelism } from 'node:os';
import { defineConfig } from '@playwright/test';
import { E2E_FPS } from './e2e/fps';
import { chooseWorkers, probeRenderer } from './e2e/gpuProbe';

// PC_E2E_SOFTWARE_GL=1 reproduces a machine without a GPU (a GitHub-hosted runner) locally:
// WebGL is then drawn in software (SwiftShader).
const softwareGl = process.env.PC_E2E_SOFTWARE_GL === '1';

// The headless browser draws WebGL in software (SwiftShader) unless told to use the GPU: a page in
// a level then takes about 11 CPU cores uncapped, 4.5 at the e2e cap (0.02 with the GPU), so a few
// parallel workers saturate the machine and starve the pages and the Vite server. Without a GPU,
// Chromium still falls back to SwiftShader.
const browserArgs = softwareGl ? ['--disable-gpu'] : ['--enable-gpu'];

// Which renderer that browser really gets (e2e/gpuProbe.ts). In software, the workers are limited
// to the cores the pages need; with a GPU, Playwright's default. --workers on the command line
// still wins. The worker processes load this config again: they inherit the probe's result from
// the runner's environment instead of launching a browser each.
const PROBED = 'PC_E2E_RENDERER';
if (process.env[PROBED] === undefined) {
  const started = Date.now();
  const renderer = await probeRenderer(browserArgs);
  process.env[PROBED] = renderer ?? '';
  const workers = chooseWorkers(renderer, availableParallelism());
  console.log(
    `e2e: WebGL renderer ${renderer ?? 'none'} (probed in ${Date.now() - started} ms): ` +
      (workers === undefined ? "Playwright's default workers" : `software, ${workers} workers`) +
      ' unless --workers is given',
  );
}
const workers = chooseWorkers(process.env[PROBED] || null, availableParallelism());

export default defineConfig({
  testDir: 'e2e',
  // e2e/*.test.ts are unit tests (Vitest).
  testMatch: '**/*.spec.ts',
  timeout: 30_000,
  workers,
  use: {
    baseURL: 'http://localhost:5199/',
    browserName: 'chromium',
    launchOptions: { args: browserArgs },
  },
  webServer: {
    command: 'npx vite --configLoader runner --port 5199 --strictPort',
    url: 'http://localhost:5199/',
    reuseExistingServer: false,
    timeout: 60_000,
    // The tests wait on the game's state, not on frames: the game steps and draws at most
    // E2E_FPS frames a second (e2e/fps.ts, src/main.ts): a page in a level then costs 4.5 CPU
    // cores instead of 11 when WebGL is drawn in software. VITE_E2E_FPS=0 runs uncapped. Added
    // to the server's environment by Playwright, so no shell syntax is needed.
    // VITE_E2E=1: the game shows what the release shows (no level ids after the names).
    env: { VITE_E2E_FPS: String(E2E_FPS), VITE_E2E: '1' },
  },
});
