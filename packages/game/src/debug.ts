// state readable by the e2e tests
export function setDebug(patch: Record<string, unknown>): void {
  const w = window as unknown as { __pc?: Record<string, unknown> };
  w.__pc = { ...(w.__pc ?? {}), ...patch };
}
