export class AnimClock {
  private last = -Infinity;
  private readonly maxMs: number;
  constructor(maxMs = 100) {
    this.maxMs = maxMs;
  }
  next(nowMs: number): number {
    const d = Math.min(this.maxMs, nowMs - this.last);
    this.last = nowMs;
    return Math.max(0, d);
  }
  reset(): void {
    this.last = -Infinity;
  }
}
