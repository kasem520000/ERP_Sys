/**
 * PHASE-020 · the client retry scheduler (MASTER-PLAN §13; SYNC_PROTOCOL
 * §8; IDEMPOTENCY_AND_RETRIES §2): exponential backoff with FULL jitter —
 *
 *   delay = min(cap, base × 2^attempts) × (0.5 + rand() × 0.5)
 *
 * defaults base 5 s, cap 15 min (900 000 ms). Commands are idempotent by
 * contract, so retries are always safe — there is no "at-most-once" mode
 * anywhere in the client. DEFERRED responses honor the server's
 * `retryAfterMs` (bounded by the cap); sequence numbers — never wall
 * clocks — define ordering (§7.3), so jitter is purely a pacing concern.
 *
 * Determinism: the RNG is injectable (the chaos harness passes
 * seededRandom(seed) — every schedule replays from its seed).
 */

/** Connectivity-failure backoff base (§8: 5 s). */
export const RETRY_BASE_MS = 5_000;

/** Backoff cap (§8: 15 min). */
export const RETRY_CAP_MS = 900_000;

export interface FullJitterOptions {
  baseMs?: number;
  capMs?: number;
  /** Source of randomness — inject seededRandom(seed) for replayability. */
  rand?: () => number;
}

/** The full-jitter delay for `attempts` failed attempts:
 * `min(cap, base × 2^attempts) × (0.5 + rand() × 0.5)` — always within
 * [exponential × 0.5, exponential] and never above the cap. */
export function fullJitterDelay(attempts: number, opts?: FullJitterOptions): number {
  const baseMs = opts?.baseMs ?? RETRY_BASE_MS;
  const capMs = opts?.capMs ?? RETRY_CAP_MS;
  const rand = opts?.rand ?? Math.random;
  const exponential = Math.min(capMs, baseMs * 2 ** attempts);
  return exponential * (0.5 + rand() * 0.5);
}

/**
 * A task-loop scheduler around the full-jitter delay: `schedule(task)`
 * runs the task (via setTimeout, after the computed delay); when the
 * task resolves `false` (not done) the next run is scheduled with
 * attempts + 1; `true` ends the loop. A server DEFERRED hint injected
 * via `deferredRetryAfter(ms)` replaces exactly the NEXT computed delay
 * with `min(ms, cap)` (one-shot — SYNC_PROTOCOL §3.5).
 */
export class RetryScheduler {
  private attemptsValue = 0;
  private retryAfterOverride: number | null = null;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private resolveTimer: (() => void) | null = null;
  private running = false;
  private cancelled = false;

  constructor(private readonly options: FullJitterOptions = {}) {}

  /** Failed runs so far (the backoff exponent). */
  get attempts(): number {
    return this.attemptsValue;
  }

  /** Whether a task loop is active. */
  get pending(): boolean {
    return this.running;
  }

  /** Start the loop (no-op if one is already running). The task resolves
   * `true` when done, `false` to retry; a throw counts as "retry". */
  schedule(task: () => Promise<boolean>): void {
    if (this.running) return;
    this.running = true;
    this.cancelled = false;
    void this.loop(task);
  }

  /** Server DEFERRED hint (§3.5): the NEXT computed delay becomes
   * min(ms, cap) instead of the exponential — consumed once. */
  deferredRetryAfter(ms: number): void {
    this.retryAfterOverride = ms;
  }

  /** Stop the loop and clear the pending timer (the in-flight task, if
   * any, still settles — its result is discarded). */
  cancel(): void {
    this.cancelled = true;
    if (this.timer !== null) {
      clearTimeout(this.timer);
      this.timer = null;
    }
    if (this.resolveTimer !== null) {
      this.resolveTimer();
      this.resolveTimer = null;
    }
    this.running = false;
  }

  private async loop(task: () => Promise<boolean>): Promise<void> {
    while (!this.cancelled) {
      const override = this.retryAfterOverride;
      this.retryAfterOverride = null;
      const capMs = this.options.capMs ?? RETRY_CAP_MS;
      const delay =
        override !== null ? Math.min(override, capMs) : fullJitterDelay(this.attemptsValue, this.options);
      const woke = await new Promise<boolean>((resolve) => {
        this.resolveTimer = () => resolve(false);
        this.timer = setTimeout(() => {
          this.timer = null;
          this.resolveTimer = null;
          resolve(true);
        }, delay);
      });
      if (!woke || this.cancelled) break;
      let done = false;
      try {
        done = await task();
      } catch {
        done = false; // a failing task retries like an unfinished one
      }
      if (done) break;
      this.attemptsValue += 1;
    }
    this.running = false;
    this.timer = null;
    this.resolveTimer = null;
  }
}
