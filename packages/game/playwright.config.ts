import { defineConfig } from '@playwright/test';
import { E2E_FPS } from './e2e/fps';

// PC_E2E_SOFTWARE_GL=1 reproduces a machine without a GPU (a GitHub-hosted runner) locally:
// WebGL is then drawn in software (SwiftShader).
const softwareGl = process.env.PC_E2E_SOFTWARE_GL === '1';

export default defineConfig({
  testDir: 'e2e',
  timeout: 30_000,
  use: {
    baseURL: 'http://localhost:5199/',
    browserName: 'chromium',
    // The headless browser draws WebGL in software (SwiftShader) unless told to use the GPU: a
    // page in a level then takes about 11 CPU cores (0.1 with the GPU), so a few parallel
    // workers saturate the machine and starve the pages and the Vite server. Without a GPU,
    // Chromium still falls back to SwiftShader.
    launchOptions: { args: softwareGl ? ['--disable-gpu'] : ['--enable-gpu'] },
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
    env: { VITE_E2E_FPS: String(E2E_FPS) },
  },
});
