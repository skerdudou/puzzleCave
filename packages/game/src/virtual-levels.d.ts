declare module 'virtual:levels' {
  import type { Chapter, LevelData } from '@puzzlecave/core';
  export const levels: LevelData[];
  export const chapters: Chapter[];
}

declare module 'virtual:solutions' {
  /** the saved solutions' text by level id (the preview of main only; empty elsewhere) */
  export const solutions: Record<string, string>;
}
