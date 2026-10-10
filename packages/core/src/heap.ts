/** Binary min-heap on (priority, value); on equal priority the smallest value comes out first. */
export class MinHeap {
  private readonly prio: number[] = [];
  private readonly vals: number[] = [];

  get size(): number {
    return this.prio.length;
  }

  push(priority: number, value: number): void {
    const { prio, vals } = this;
    let i = prio.length;
    prio.push(priority);
    vals.push(value);
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (!this.less(i, p)) break;
      this.swap(i, p);
      i = p;
    }
  }

  /** Removes the minimum; returns [priority, value]. The heap must not be empty. */
  pop(): [number, number] {
    const { prio, vals } = this;
    const top: [number, number] = [prio[0]!, vals[0]!];
    const lastP = prio.pop()!;
    const lastV = vals.pop()!;
    if (prio.length > 0) {
      prio[0] = lastP;
      vals[0] = lastV;
      let i = 0;
      for (;;) {
        const l = 2 * i + 1;
        const r = l + 1;
        let m = i;
        if (l < prio.length && this.less(l, m)) m = l;
        if (r < prio.length && this.less(r, m)) m = r;
        if (m === i) break;
        this.swap(i, m);
        i = m;
      }
    }
    return top;
  }

  private less(a: number, b: number): boolean {
    const pa = this.prio[a]!;
    const pb = this.prio[b]!;
    return pa < pb || (pa === pb && this.vals[a]! < this.vals[b]!);
  }

  private swap(a: number, b: number): void {
    const { prio, vals } = this;
    [prio[a], prio[b]] = [prio[b]!, prio[a]!];
    [vals[a], vals[b]] = [vals[b]!, vals[a]!];
  }
}
