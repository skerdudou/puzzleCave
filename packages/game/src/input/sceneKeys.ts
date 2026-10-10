/** What `onSceneKeyDown` needs from a Phaser scene. */
export interface KeyScene {
  sys: { isActive(): boolean };
  events: { once(event: 'shutdown', fn: () => void): unknown };
}

/**
 * Calls `handler` once per DOM keydown while the scene is active, until it shuts down.
 *
 * Not `scene.input.keyboard.on('keydown')`: Phaser 4.2's KeyboardPlugin re-runs its whole
 * event queue on every DOM key event and only empties it at the end of the game step, so
 * when several key events arrive between two frames (slow frames, loaded machine) earlier
 * keydowns are dispatched again — two ArrowRight presses in one frame gave 5 handler calls.
 */
export function onSceneKeyDown(
  scene: KeyScene,
  handler: (e: KeyboardEvent) => void,
  target: EventTarget = window,
): void {
  const listener = (e: Event) => {
    if (scene.sys.isActive()) handler(e as KeyboardEvent);
  };
  target.addEventListener('keydown', listener);
  scene.events.once('shutdown', () => target.removeEventListener('keydown', listener));
}
