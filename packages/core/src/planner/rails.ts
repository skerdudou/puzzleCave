// Rails: exact searches on a solution's own block routes. Every floor cell no block ever stands
// on while the solution is replayed becomes gravel (the player walks on it, a block cannot be
// pushed onto it), and only the waters the solution fills may be filled: the blocks stay on the
// routes the solution gave them, while the order of the pushes, their interleaving and where a
// block waits are free. That shrinks the state space enough for an exact shortest search from a
// cut of the solution to the exit, on long suffixes (often the whole solution). With `keyRails`,
// keys and doors are also only those the solution takes and opens (key/door levels: the subsets
// of keys taken no longer multiply the states).
//
// The pass searches suffixes from the end backwards, cut after each interaction (key, door,
// water); a shorter suffix is spliced in, replayed on the real level, and the pass starts again
// from the new solution (new rails). It stops at the first search stopped by its caps: `reached`
// is the earliest cut searched to completion. Reaching 0 means the solution is optimal on its own
// rails (the order of its pushes cannot be improved; not a proof of optimality).
import { replay } from '../replay';
import { initialState } from '../state';
import { step } from '../step';
import type { Dir, GameState, LevelData } from '../types';
import { reachSubgoal } from './subgoal';

export interface RailsOptions {
  /** keys and doors restricted to those the solution takes and opens */
  keyRails?: boolean;
  /** macro-states of each search */
  maxStates: number;
  /** memory of each search (MB, 256 by default) */
  maxMemoryMb?: number;
  /** wall-clock limit of the whole pass */
  timeoutMs: number;
  now?: () => number;
  log?: (line: string) => void;
}

export interface RailsResult {
  moves: Dir[];
  /** each shorter solution found: the cut and the lengths */
  gains: { k: number; before: number; after: number }[];
  /** earliest cut searched to completion on the final solution (its length: none) */
  reached: number;
  searches: number;
  /** stopped by timeoutMs (else by a capped search, or done) */
  timedOut: boolean;
  ms: number;
}

/** The rails of a solution, its cuts, and the state after each move. */
function trace(level: LevelData, moves: readonly Dir[]) {
  let s = initialState(level);
  const states: GameState[] = [s];
  const rails = new Set<number>();
  const sank = new Set<number>();
  const keys = new Set<number>();
  const doors = new Set<number>();
  const cuts: number[] = [];
  const blocksOf = (st: GameState) => {
    st.objects.forEach((o, i) => {
      if (o === 'block') rails.add(i);
    });
  };
  blocksOf(s);
  moves.forEach((d, i) => {
    const r = step(s, d);
    s = r.state;
    states.push(s);
    blocksOf(s);
    let cut = false;
    for (const e of r.events) {
      const at = (p: { x: number; y: number }) => p.y * level.width + p.x;
      if (e.type === 'blockSank') (sank.add(at(e.at)), rails.add(at(e.at)), (cut = true));
      else if (e.type === 'keyPicked') (keys.add(at(e.at)), (cut = true));
      else if (e.type === 'doorOpened') (doors.add(at(e.at)), (cut = true));
    }
    if (cut && i + 1 < moves.length) cuts.push(i + 1);
  });
  return { states, rails, sank, keys, doors, cuts };
}

/** s with every floor cell off the rails turned to gravel (blocks cannot enter it). */
function onRails(s: GameState, rails: ReadonlySet<number>): GameState {
  const terrain = s.terrain.map((t, i) => (t === 'floor' && !rails.has(i) ? 'gravel' : t));
  return { ...s, terrain };
}

export function railsPass(level: LevelData, moves: readonly Dir[], o: RailsOptions): RailsResult {
  const now = o.now ?? (() => performance.now());
  const t0 = now();
  const deadline = t0 + o.timeoutMs;
  let best = [...moves];
  const gains: RailsResult['gains'] = [];
  let searches = 0;
  let reached = best.length;
  let timedOut = false;
  for (;;) {
    const t = trace(level, best);
    const allDoors = level.objects
      .filter((ob) => ob.kind === 'door')
      .map((ob) => ob.y * level.width + ob.x);
    reached = best.length;
    let improved = false;
    // from the end backwards, then the whole solution
    for (const k of [...t.cuts].reverse().concat(0)) {
      const left = deadline - now();
      if (left <= 0) {
        timedOut = true;
        break;
      }
      const s = t.states[k]!;
      const free: number[] = [];
      s.objects.forEach((ob, i) => {
        if (ob === 'block') free.push(i);
      });
      const res = reachSubgoal(
        onRails(s, t.rails),
        {
          free,
          doors: o.keyRails ? t.doors : allDoors,
          waters: t.sank,
          ...(o.keyRails ? { keys: t.keys } : {}),
        },
        () => false,
        {
          win: true,
          maxStates: o.maxStates,
          timeoutMs: left,
          now,
          ...(o.maxMemoryMb !== undefined ? { maxMemoryMb: o.maxMemoryMb } : {}),
        },
      );
      searches++;
      if (!res.ok) {
        if (res.timedOut) timedOut = true;
        o.log?.(
          `rails${o.keyRails ? ' (keys)' : ''}: stopped at cut ${k}/${best.length} (${res.explored} macro-states${res.timedOut ? ', time' : ''})`,
        );
        break;
      }
      reached = k;
      const suffix = best.length - k;
      if (res.moves.length < suffix) {
        const cand = [...best.slice(0, k), ...res.moves];
        // the rails are a restriction of the real level: checked all the same
        if (replay(level, cand).status === 'won') {
          gains.push({ k, before: best.length, after: cand.length });
          o.log?.(
            `rails${o.keyRails ? ' (keys)' : ''}: ${best.length} → ${cand.length} from cut ${k}`,
          );
          best = cand;
          improved = true;
          break;
        }
      }
    }
    if (!improved || timedOut) break;
  }
  return { moves: best, gains, reached, searches, timedOut, ms: now() - t0 };
}
