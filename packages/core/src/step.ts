import { DELTA, idx, inBounds } from './state';
import type { Dir, GameEvent, GameState, ObjKind, Pos, Status, StepResult, Terrain } from './types';

function withValue<T>(arr: readonly T[], i: number, v: T): T[] {
  const copy = arr.slice();
  copy[i] = v;
  return copy;
}

export function step(s: GameState, dir: Dir): StepResult {
  if (s.status !== 'playing') return { state: s, events: [] };

  const turned = s.facing !== dir;
  const blocked = (): StepResult =>
    turned
      ? { state: { ...s, facing: dir }, events: [{ type: 'turned', facing: dir }] }
      : { state: s, events: [] };

  const d = DELTA[dir];
  const dest: Pos = { x: s.player.x + d.x, y: s.player.y + d.y };
  if (!inBounds(s, dest)) return blocked();
  const di = idx(s, dest);
  const destTerrain = s.terrain[di] as Terrain;
  if (destTerrain === 'wall') return blocked();
  if (destTerrain === 'water' && s.mode === 'normal') return blocked();

  let terrain: readonly Terrain[] = s.terrain;
  let objects: readonly (ObjKind | null)[] = s.objects;
  let keys = s.keys;
  const effects: GameEvent[] = [];
  const obj = s.objects[di] ?? null;

  if (obj === 'door') {
    if (keys <= 0) return blocked();
    objects = withValue(objects, di, null);
    keys -= 1;
    effects.push({ type: 'doorOpened', at: dest });
  } else if (obj === 'key') {
    objects = withValue(objects, di, null);
    keys += 1;
    effects.push({ type: 'keyPicked', at: dest });
  } else if (obj === 'block') {
    const behind: Pos = { x: dest.x + d.x, y: dest.y + d.y };
    if (!inBounds(s, behind)) return blocked();
    const bi = idx(s, behind);
    const behindTerrain = s.terrain[bi];
    if ((behindTerrain !== 'floor' && behindTerrain !== 'water') || s.objects[bi] !== null) {
      return blocked();
    }
    objects = withValue(objects, di, null);
    effects.push({ type: 'pushed', from: dest, to: behind });
    if (behindTerrain === 'water') {
      terrain = withValue(terrain, bi, 'floor');
      effects.push({ type: 'blockSank', at: behind });
    } else {
      objects = withValue(objects, bi, 'block');
    }
  }

  const status: Status =
    destTerrain === 'water' ? 'drowned' : destTerrain === 'exit' ? 'won' : 'playing';
  const events: GameEvent[] = [];
  if (turned) events.push({ type: 'turned', facing: dir });
  events.push({ type: 'moved', from: s.player, to: dest }, ...effects);
  if (status === 'drowned') events.push({ type: 'drowned', at: dest });
  if (status === 'won') events.push({ type: 'won' });

  return {
    state: { ...s, terrain, objects, keys, player: dest, facing: dir, moves: s.moves + 1, status },
    events,
  };
}
