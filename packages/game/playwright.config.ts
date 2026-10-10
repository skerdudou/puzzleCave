import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: 'e2e',
  timeout: 30_000,
  use: { baseURL: 'http://localhost:5199/', browserName: 'chromium' },
  webServer: {
    command: 'npx vite --configLoader runner --port 5199 --strictPort',
    url: 'http://localhost:5199/',
    reuseExistingServer: false,
    timeout: 60_000,
  },
});
