// Full screen in a browser tab (the Fullscreen API): on a phone, it hides the browser's bars,
// which take a lot of a landscape screen. Offered only where it makes sense.

/** What decides whether full screen is offered. */
export interface FullscreenEnv {
  /** the page may go full screen (`document.fullscreenEnabled`; false on an iPhone's Safari) */
  enabled: boolean;
  /** the game runs as an installed app (display-mode fullscreen or standalone): no bars to hide */
  installed: boolean;
  /** a touch screen (a computer has F11 and room enough) */
  touch: boolean;
}

/** Full screen is offered: a touch screen, in a browser tab that may go full screen. */
export function offersFullscreen(env: FullscreenEnv): boolean {
  return env.enabled && !env.installed && env.touch;
}

/** The environment of this page (`touch`: isTouchDevice(), given by the caller). */
export function fullscreenEnv(touch: boolean): FullscreenEnv {
  const media = (q: string) =>
    typeof window.matchMedia === 'function' && window.matchMedia(q).matches;
  return {
    enabled: document.fullscreenEnabled === true,
    installed:
      // a tab put full screen by this API matches display-mode fullscreen too: not installed
      (media('(display-mode: fullscreen)') && !isFullscreen()) ||
      media('(display-mode: standalone)') ||
      // an iPhone's home screen app (Safari's own flag)
      (navigator as Navigator & { standalone?: boolean }).standalone === true,
    touch,
  };
}

/** The page is full screen now (through this API, not F11). */
export const isFullscreen = (): boolean => document.fullscreenElement != null;

/**
 * Goes full screen (the whole page, the browser's navigation hidden), or leaves it. Must run in
 * a tap or a key press: the browser refuses it otherwise (the failure is ignored).
 */
export function toggleFullscreen(): void {
  const done = isFullscreen()
    ? document.exitFullscreen()
    : document.documentElement.requestFullscreen({ navigationUI: 'hide' });
  done.catch(() => {});
}
