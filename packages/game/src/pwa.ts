/// <reference types="vite-plugin-pwa/vanillajs" />
import Phaser from 'phaser';
import { registerSW } from 'virtual:pwa-register';
import { app } from './app';
import { setDebug } from './debug';
import { hideUpdating, showUpdating } from './notice';
import { CHECK_INTERVAL_MS, RESUME_SCENES, UpdateGate, checkDue } from './updateGate';

/**
 * The service worker (offline play, published build only: a no-op on the dev server) and the
 * updates. A new version is looked for at start-up, every 30 minutes and when the game comes back
 * to the screen; once downloaded, it is applied at one of UpdateGate's moments: the page reloads
 * and comes back to the screen it was on (RESUME_KEY), behind an "Updating…" box when the game is
 * on the screen. At start-up the first screen waits for the check (at most START_CHECK_MS): a new
 * version found then is applied before anything shows.
 */

/** The screen to come back to after an update's reload (sessionStorage: this tab only). */
const RESUME_KEY = 'puzzlecave.resume';
/** At start-up, how long the first screen waits for the check for a new version, ms. */
const START_CHECK_MS = 2500;

/** A screen that knows what to show again after a reload (the level picked, the scroll…). */
export interface Resumable {
  resumeData(): object;
}

/** The screen to come back to, taken once (null: a plain start). */
let resume: { scene: string; data: object } | null = (() => {
  try {
    const raw = sessionStorage.getItem(RESUME_KEY);
    sessionStorage.removeItem(RESUME_KEY);
    const r = raw ? (JSON.parse(raw) as { scene?: unknown; data?: unknown }) : null;
    return r && typeof r.scene === 'string' && RESUME_SCENES.includes(r.scene)
      ? { scene: r.scene, data: typeof r.data === 'object' && r.data !== null ? r.data : {} }
      : null;
  } catch {
    return null;
  }
})();

/**
 * Coming back from an update: the "Updating…" box, until that screen is drawn again (called once
 * the language is known).
 */
export function showResumeBox(): void {
  if (resume) showUpdating();
}

/** Where the game starts: the screen it was on before an update, else the main menu. */
export function startScreen(): { scene: string; data: object } {
  const r = resume ?? { scene: 'Menu', data: {} };
  resume = null;
  return r;
}

/** The "Updating…" box goes once `scene` has been drawn. */
export function hideUpdatingAfter(scene: Phaser.Scene): void {
  scene.events.once(Phaser.Scenes.Events.CREATE, () =>
    scene.game.events.once(Phaser.Core.Events.POST_RENDER, hideUpdating),
  );
}

/** Resolves once the start-up check for a new version is over: true if one is being applied. */
let startCheck: Promise<boolean> = Promise.resolve(false);
export const afterStartCheck = (): Promise<boolean> => startCheck;

export function startUpdates(game: Phaser.Game): void {
  let starting = true;
  let done: (applying: boolean) => void = () => {};
  startCheck = new Promise<boolean>((resolve) => {
    done = (applying) => {
      if (!starting) return;
      starting = false;
      resolve(applying);
    };
  });
  // no service worker (the dev server), none yet (the very first visit: nothing to update),
  // offline: nothing to wait for
  if (import.meta.env.DEV || !navigator.serviceWorker?.controller || !navigator.onLine) done(false);
  else setTimeout(() => done(false), START_CHECK_MS);

  /** The new version takes over and the page reloads, back to `scene`. */
  const apply = (scene: string, shown: boolean) => {
    const s = game.scene.getScene(scene) as (Phaser.Scene & Partial<Resumable>) | null;
    const data = s?.resumeData?.() ?? {};
    try {
      sessionStorage.setItem(RESUME_KEY, JSON.stringify({ scene, data }));
    } catch {
      /* no storage: the reload starts on the main menu */
    }
    if (shown) showUpdating();
    app.persist(); // already saved as it changes: one more time costs nothing
    setDebug({ updateApplied: scene });
    void update();
  };
  const gate = new UpdateGate(apply);
  // the new service worker waits until `update()` lets it take over, then the page reloads
  const update = registerSW({
    immediate: true,
    onNeedRefresh: () => {
      setDebug({ updateReady: true });
      if (!starting) return gate.ready();
      // at start-up: applied before the first screen shows, which comes back after the reload
      const first = resume ?? { scene: 'Menu', data: {} };
      try {
        sessionStorage.setItem(RESUME_KEY, JSON.stringify(first));
      } catch {
        /* the main menu */
      }
      showUpdating();
      done(true);
      void update();
    },
    onRegisteredSW: (_url, registration) => {
      if (!registration) return done(false);
      // the check at start-up: nothing new once it is over (else onNeedRefresh comes, once the
      // new version is downloaded)
      registration
        .update()
        .then(() => {
          if (!registration.installing && !registration.waiting) done(false);
        })
        .catch(() => done(false));
      watchForUpdates(registration);
    },
  });
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') gate.hidden();
  });
  game.events.once(Phaser.Core.Events.READY, () => {
    for (const scene of game.scene.getScenes(false))
      scene.events.on(Phaser.Scenes.Events.CREATE, () => gate.enter(scene.scene.key));
  });
}

/** Asks the server for a new service worker now and then while the game stays open. */
function watchForUpdates(registration: ServiceWorkerRegistration): void {
  let last = Date.now();
  const check = () => {
    const now = Date.now();
    if (!checkDue(now, last) || registration.installing || !navigator.onLine) return;
    last = now;
    registration.update().catch(() => {
      /* offline, server unreachable: next time */
    });
  };
  setInterval(check, CHECK_INTERVAL_MS);
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') check();
  });
}
