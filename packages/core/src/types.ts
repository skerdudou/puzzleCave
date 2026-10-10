export type Terrain = 'floor' | 'gravel' | 'water' | 'wall' | 'exit';
export type ObjKind = 'key' | 'door' | 'block';
export type TileKind = Terrain | ObjKind | 'start';
export type Dir = 'up' | 'down' | 'left' | 'right';
export type Mode = 'normal' | 'platinum';
export type Status = 'playing' | 'won' | 'drowned';

export interface Pos {
  readonly x: number;
  readonly y: number;
}

export interface LevelObject extends Pos {
  readonly kind: ObjKind;
}

export interface ThresholdOverrides {
  goldMoves?: number;
  silverMoves?: number;
  bronzeMoves?: number;
  goldTime?: number;
  silverTime?: number;
  bronzeTime?: number;
  platinumTime?: number;
}

export interface LevelData {
  id: string;
  name: string;
  author?: string;
  width: number;
  height: number;
  /** row-major, length width*height */
  terrain: Terrain[];
  objects: LevelObject[];
  start: Pos;
  initialKeys: number;
  platinum: boolean;
  thresholds: ThresholdOverrides;
}

export interface GameState {
  readonly width: number;
  readonly height: number;
  readonly terrain: readonly Terrain[];
  readonly objects: readonly (ObjKind | null)[];
  readonly player: Pos;
  readonly facing: Dir;
  readonly keys: number;
  readonly moves: number;
  readonly status: Status;
  readonly mode: Mode;
}

export type GameEvent =
  | { type: 'turned'; facing: Dir }
  | { type: 'moved'; from: Pos; to: Pos }
  | { type: 'pushed'; from: Pos; to: Pos }
  | { type: 'blockSank'; at: Pos }
  | { type: 'keyPicked'; at: Pos }
  | { type: 'doorOpened'; at: Pos }
  | { type: 'won' }
  | { type: 'drowned'; at: Pos };

export interface StepResult {
  state: GameState;
  events: GameEvent[];
}
