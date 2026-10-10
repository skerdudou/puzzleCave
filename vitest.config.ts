import { defineConfig } from 'vitest/config';

// `vitest run --mode slow` (npm run test:slow) enables the slow tests (SLOW=1)
export default defineConfig(({ mode }) => ({
  test: {
    include: ['packages/*/src/**/*.test.ts'],
    environment: 'node',
    passWithNoTests: true,
    env: mode === 'slow' ? { SLOW: '1' } : {},
  },
}));
