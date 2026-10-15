/// <reference types="vite-plugin-pwa/vanillajs" />
import Phaser from 'phaser';
import { registerSW } from 'virtual:pwa-register';
import { app } from './app';
import { setDebug } from './debug';
import { t } from './i18n';
import { COLORS } from './ui';
import { CHECK_INTERVAL_MS, UpdateGate, checkDue } from './updateGate';

/**
 * The service worker (offline play, published build only: a no-op on the dev server) and the
 * updates: a new version is looked for at start-up, every 30 minutes and when the game comes
 * back to the screen; once it is downloaded, it is applied (the page reloads) at once on a menu,
 * or after the level in progress (see UpdateGate).
 */
export function startUpdates(game: Phaser.Game): void {
  const gate = new UpdateGate(
    () => {
      app.persist(); // already saved as it changes: one more time costs nothing
      void update();
    },
    () => showNotice(t('updateReady')),
  );
  // the new service worker waits until `update()` lets it take over, then the page reloads
  const update = registerSW({
    immediate: true,
    onNeedRefresh: () => {
      setDebug({ updateReady: true });
      gate.ready();
    },
    onRegisteredSW: (_url, registration) => {
      if (registration) watchForUpdates(registration);
    },
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

/** A short line over the top of the play area for a few seconds; it never takes a touch. */
function showNotice(text: string): void {
  const el = document.createElement('div');
  el.textContent = text;
  el.setAttribute('role', 'status');
  Object.assign(el.style, {
    position: 'fixed',
    top: 'calc(env(safe-area-inset-top, 0px) + 104px)',
    left: '50%',
    transform: 'translateX(-50%)',
    maxWidth: 'calc(100vw - 32px)',
    boxSizing: 'border-box',
    padding: '6px 12px',
    borderRadius: '6px',
    background: 'rgba(0, 0, 0, 0.75)',
    color: COLORS.text,
    font: '13px monospace',
    textAlign: 'center',
    pointerEvents: 'none',
    transition: 'opacity 0.5s',
    zIndex: '10',
  } satisfies Partial<CSSStyleDeclaration>);
  document.body.append(el);
  setDebug({ updateNotice: text });
  setTimeout(() => (el.style.opacity = '0'), 6000);
  setTimeout(() => el.remove(), 6600);
}
