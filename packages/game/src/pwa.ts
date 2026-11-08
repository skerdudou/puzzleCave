/// <reference types="vite-plugin-pwa/vanillajs" />
import Phaser from 'phaser';
import { registerSW } from 'virtual:pwa-register';
import { app } from './app';
import { setDebug } from './debug';
import { hideUpdating, showUpdating } from './notice';
import { PREVIEW } from './preview';
import { RESUME_SCENES, UpdateGate, checkDue, checkInterval } from './updateGate';
import { logScene, logUpdate } from './updateLog';

/**
 * The service worker (offline play, published build only: a no-op on the dev server) and the
 * updates. A new version is looked for at start-up, then once an hour in the release (once a
 * minute in the preview), on a timer and when the game comes back to the screen; once
 * downloaded, it is applied at one of UpdateGate's moments: the page reloads
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
  /** this tab put the new version in: its reload is expected */
  let applying = false;
  /**
   * Another tab of the game put a new version in (all tabs share the service worker): this one
   * reloads at one of the gate's moments, never in the middle of a level.
   */
  let takenElsewhere = false;
  const hadController = !!navigator.serviceWorker?.controller;
  logUpdate(
    `page loaded (${hadController ? 'service worker in charge' : 'no service worker yet'}${resume ? `, back to ${resume.scene} after an update` : ''})`,
  );
  let done: (applying: boolean) => void = () => {};
  startCheck = new Promise<boolean>((resolve) => {
    done = (applying) => {
      if (!starting) return;
      starting = false;
      logUpdate(applying ? 'start-up check: a new version, put in now' : 'start-up check over');
      resolve(applying);
    };
  });
  // no service worker (the dev server), none yet (the very first visit: nothing to update),
  // offline: nothing to wait for
  if (import.meta.env.DEV || !hadController || !navigator.onLine) done(false);
  else
    setTimeout(() => {
      if (starting) logUpdate(`start-up check: no answer within ${START_CHECK_MS} ms, game shown`);
      done(false);
    }, START_CHECK_MS);

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
    applying = true;
    if (takenElsewhere) {
      // already in charge (put in by another tab): only this page is behind
      logUpdate(
        `reload (${shown ? 'screen change' : 'gone to the background'}): another tab put the new version in`,
      );
      window.location.reload();
      return;
    }
    logUpdate(`new version put in (${shown ? 'screen change' : 'gone to the background'}), reload`);
    void update();
  };
  const gate = new UpdateGate(apply);
  // the new service worker waits until `update()` lets it take over, then the page reloads
  const update = registerSW({
    immediate: true,
    onNeedRefresh: () => {
      setDebug({ updateReady: true });
      logUpdate(
        `new version downloaded${starting ? ' (start-up)' : ', waiting for a menu screen'}`,
      );
      if (!starting) return gate.ready();
      // at start-up: applied before the first screen shows, which comes back after the reload
      const first = resume ?? { scene: 'Menu', data: {} };
      try {
        sessionStorage.setItem(RESUME_KEY, JSON.stringify(first));
      } catch {
        /* the main menu */
      }
      showUpdating();
      applying = true;
      done(true);
      void update();
    },
    // the new version in charge: this tab reloads at once only if it put it in; another tab's
    // update waits for the gate (below)
    onNeedReload: () => {
      if (applying) window.location.reload();
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
  navigator.serviceWorker?.addEventListener('controllerchange', () => {
    // a first install takes nothing over; this tab's own update reloads (onNeedReload)
    if (!hadController || applying) return;
    logUpdate('another tab put a new version in');
    takenElsewhere = true;
    if (!starting) return gate.ready();
    // nothing shown yet: reloaded now, on the first screen
    const first = resume ?? { scene: 'Menu', data: {} };
    try {
      sessionStorage.setItem(RESUME_KEY, JSON.stringify(first));
    } catch {
      /* the main menu */
    }
    showUpdating();
    applying = true;
    done(true);
    window.location.reload();
  });
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') gate.hidden();
  });
  game.events.once(Phaser.Core.Events.READY, () => {
    for (const scene of game.scene.getScenes(false))
      scene.events.on(Phaser.Scenes.Events.CREATE, () => {
        logScene(scene.scene.key);
        gate.enter(scene.scene.key);
      });
  });
}

/** Asks the server for a new service worker now and then while the game stays open. */
function watchForUpdates(registration: ServiceWorkerRegistration): void {
  let last = Date.now();
  const every = checkInterval(PREVIEW);
  const check = () => {
    const now = Date.now();
    // a little slack: a timer may fire a hair early
    if (!checkDue(now, last, every - 1000) || registration.installing || !navigator.onLine) return;
    last = now;
    logUpdate('check for a new version');
    registration.update().catch(() => {
      /* offline, server unreachable: next time */
    });
  };
  setInterval(check, every);
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') check();
  });
}
