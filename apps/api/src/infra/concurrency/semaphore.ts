/**
 * PHASE-013 · a minimal bounded-semaphore (render pool concurrency —
 * RISK-013: Chromium pool saturation is smoothed by the queue + this
 * bound; light inline results are never affected).
 */
export class Semaphore {
  private readonly waiters: (() => void)[] = [];
  private active = 0;

  constructor(private readonly max: number) {}

  async acquire(): Promise<() => void> {
    if (this.active < this.max) {
      this.active += 1;
      return () => this.release();
    }
    await new Promise<void>((resolve) => {
      this.waiters.push(resolve);
    });
    this.active += 1;
    return () => this.release();
  }

  private release(): void {
    this.active -= 1;
    const next = this.waiters.shift();
    if (next !== undefined) {
      next();
    }
  }

  get inUse(): number {
    return this.active;
  }
}
