// Keeps the screen on (Screen Wake Lock API) while something is watched without touching the
// screen, such as a solution replay. The browser drops the lock when the page is hidden: it is
// asked for again when the page comes back. Where the API is missing or refused, nothing happens.

interface Sentinel {
  release(): Promise<void>;
}
interface WakeLockNav {
  wakeLock?: { request(type: 'screen'): Promise<Sentinel> };
}

/** What keepAwake needs of the document. */
interface Doc {
  visibilityState: string;
  addEventListener(type: 'visibilitychange', fn: () => void): void;
  removeEventListener(type: 'visibilitychange', fn: () => void): void;
}

/** Holds the screen on until `release()`. */
export function keepAwake(
  nav: WakeLockNav = navigator as WakeLockNav,
  doc: Doc = document,
): { release(): void } {
  let sentinel: Sentinel | null = null;
  let held = true;
  const request = () => {
    if (!held || !nav.wakeLock || doc.visibilityState !== 'visible') return;
    nav.wakeLock.request('screen').then(
      (s) => {
        if (held) sentinel = s;
        else void s.release().catch(() => {});
      },
      () => {},
    );
  };
  const onVisible = () => request();
  doc.addEventListener('visibilitychange', onVisible);
  request();
  return {
    release() {
      held = false;
      doc.removeEventListener('visibilitychange', onVisible);
      void sentinel?.release().catch(() => {});
      sentinel = null;
    },
  };
}
