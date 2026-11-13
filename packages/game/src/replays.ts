import { app } from './app';
import type { SavedReplay } from './save';

// the pure functions live apart: importing `app` needs a browser, the tests do not
export { movesOf, parseReplayText, replayText, toSaved } from './replayText';

export const getReplay = (levelId: string): SavedReplay | undefined => app.data.replays[levelId];

/**
 * Keeps `r` as the level's replay; false when the save could not be written (too big for the
 * storage): the previous replay is then put back, so that the next saves do not fail too.
 */
export function setReplay(levelId: string, r: SavedReplay): boolean {
  const previous = app.data.replays[levelId];
  app.data.replays[levelId] = r;
  if (app.persist()) return true;
  if (previous) app.data.replays[levelId] = previous;
  else delete app.data.replays[levelId];
  return false;
}

export function deleteReplay(levelId: string): void {
  delete app.data.replays[levelId];
  app.persist();
}
