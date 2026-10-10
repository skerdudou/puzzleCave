// Memory model of the solver processes (compact engine: typed arrays outside the V8 heap).

const MB = 1024 ** 2;
/**
 * Bytes per macro-state of the compact engine, rounded up: measured 62–105 B (table, nodes
 * and heap; pc-03 71, pc-10 62, pc-15 105, see docs/solver-study.md).
 */
export const BYTES_PER_STATE = 120;
/** Node, tsx, the pack and the solver's V8 heap */
export const CHILD_BASE_BYTES = 150 * MB;
/** with no state limit, each process must have at least ~1.5 GB */
export const MIN_CHILD_BYTES = 1.5 * 1024 * MB;
/** --max-old-space-size of the children: the solver keeps almost nothing in the V8 heap */
export const CHILD_HEAP_MB = 512;
/** floor of the solver memory cap */
export const MIN_SOLVER_MB = 256;

/** Budget under 70% of RAM: 0.7 × total − already used. */
export function memoryBudget(totalBytes: number, freeBytes: number): number {
  return 0.7 * totalBytes - (totalBytes - freeBytes);
}

/**
 * Estimated memory of a child process: explicit solver cap + base, otherwise
 * maxStates × BYTES_PER_STATE + base, otherwise (no state limit) MIN_CHILD_BYTES.
 */
export function childNeedBytes(maxStates: number | undefined, maxMemoryMb?: number): number {
  if (maxMemoryMb !== undefined) return maxMemoryMb * MB + CHILD_BASE_BYTES;
  if (maxStates !== undefined && Number.isFinite(maxStates))
    return maxStates * BYTES_PER_STATE + CHILD_BASE_BYTES;
  return MIN_CHILD_BYTES;
}

/** solver cap (MB) for a process that has childBytes available */
export function solverMemoryMb(childBytes: number): number {
  return Math.max(MIN_SOLVER_MB, Math.floor((childBytes - CHILD_BASE_BYTES) / MB));
}

/** cap of the solver solving a single level in the current process: the whole budget */
export function inProcessMemoryMb(totalBytes: number, freeBytes: number): number {
  return solverMemoryMb(memoryBudget(totalBytes, freeBytes));
}
