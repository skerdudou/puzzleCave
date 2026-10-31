/**
 * The most frames per second the game steps and draws during the e2e tests (playwright.config.ts
 * passes it to Vite, src/main.ts to Phaser). 0: uncapped. Override with VITE_E2E_FPS.
 */
export const E2E_FPS = Number(process.env.VITE_E2E_FPS ?? 15);

/** One game step, in ms, at that cap (uncapped: a 60 Hz frame). */
export const FRAME_MS = 1000 / (E2E_FPS > 0 ? E2E_FPS : 60);
