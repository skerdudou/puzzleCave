import { initialState } from './state';
import { step } from './step';
import type { Dir, GameEvent, GameState, LevelData, Mode } from './types';

interface Entry {
  state: GameState;
  dir: Dir | null;
}

export class Session {
  readonly level: LevelData;
  readonly mode: Mode;
  private stack: Entry[];
  private beforeRestart: Entry[] | null = null;

  constructor(level: LevelData, mode: Mode = 'normal') {
    this.level = level;
    this.mode = mode;
    this.stack = [{ state: initialState(level, mode), dir: null }];
  }

  get state(): GameState {
    return this.stack[this.stack.length - 1]!.state;
  }

  move(dir: Dir): GameEvent[] {
    const top = this.stack[this.stack.length - 1]!;
    const r = step(top.state, dir);
    if (r.state === top.state) return r.events;
    this.beforeRestart = null;
    if (r.state.moves === top.state.moves) {
      this.stack[this.stack.length - 1] = { ...top, state: r.state };
    } else {
      this.stack.push({ state: r.state, dir });
    }
    return r.events;
  }

  /** True right after a restart (before any new move): undo() will restore the previous game. */
  get canUndoRestart(): boolean {
    return this.beforeRestart !== null && this.stack.length <= 1;
  }

  undo(): boolean {
    if (this.canUndoRestart) {
      this.stack = this.beforeRestart!;
      this.beforeRestart = null;
      return true;
    }
    if (this.state.status !== 'playing' || this.stack.length <= 1) return false;
    this.stack.pop();
    return true;
  }

  restart(): void {
    // Only a game in progress and already started is saved; a repeated restart keeps the saved game.
    if (this.state.status === 'playing' && this.stack.length > 1) this.beforeRestart = this.stack;
    else if (this.state.status !== 'playing') this.beforeRestart = null;
    this.stack = [{ state: initialState(this.level, this.mode), dir: null }];
  }

  get moveLog(): Dir[] {
    return this.stack.slice(1).map((e) => e.dir as Dir);
  }
}
