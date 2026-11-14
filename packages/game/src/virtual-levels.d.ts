declare module 'virtual:levels' {
  import type { Chapter, LevelData } from '@puzzlecave/core';
  export const levels: LevelData[];
  export const chapters: Chapter[];
  /** the proven optimum, in moves, of each level whose saved solution is proven optimal */
  export const optima: Record<string, number>;
  /** the moves of each level's saved solution (the best known), proven optimal or not */
  export const best: Record<string, number>;
}

declare module 'virtual:solutions' {
  /** the saved solutions' text by level id (the preview of main only; empty elsewhere) */
  export const solutions: Record<string, string>;
}
