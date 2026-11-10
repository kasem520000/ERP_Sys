import { afterEach, describe, expect, it, vi } from "vitest";

import {
  RETRY_BASE_MS,
  RETRY_CAP_MS,
  RetryScheduler,
  applyResult,
  enqueue,
  fullJitterDelay,
  markInFlight,
  memoryAdapter,
  applyMigrations,
  nextBatch,
  seededRandom,
} from "../src";

/**
 * PHASE-020 · the retry machinery (SYNC_PROTOCOL §8; IDEMPOTENCY_AND_
 * RETRIES §2): full-jitter bounds + determinism, the DEFERRED
 * retryAfterMs pacing (bounded by the cap), and the "attempts NOT
 * incremented for DEFERRED" rule (§3.5 — DEFERRED is not a failure).
 * All randomness is seeded (SYNC_TESTS §9 Sev-1 replayability).
 */

const FIXED_NOW = 1_760_000_000_000;

afterEach(() => {
  vi.useRealTimers();
});

describe("fullJitterDelay (§8: min(cap, base × 2^attempts) × (0.5 + rand × 0.5))", () => {
  it("stays within [exponential × 0.5, exponential] and never above the cap", () => {
    const rand = seededRandom(7);
    for (let attempts = 0; attempts <= 12; attempts += 1) {
      const exponential = Math.min(RETRY_CAP_MS, RETRY_BASE_MS * 2 ** attempts);
      const delay = fullJitterDelay(attempts, { rand });
      expect(delay).toBeGreaterThanOrEqual(exponential * 0.5);
      expect(delay).toBeLessThanOrEqual(exponential);
      expect(delay).toBeLessThanOrEqual(RETRY_CAP_MS);
    }
  });

  it("is deterministic for a given seed and honors custom base/cap", () => {
    const first = Array.from({ length: 5 }, (_, i) => fullJitterDelay(i, { rand: seededRandom(99) }));
    const second = Array.from({ length: 5 }, (_, i) => fullJitterDelay(i, { rand: seededRandom(99) }));
    expect(first).toEqual(second);
    // Custom bounds: base 100, cap 250 → attempt 2: min(250, 400) = 250.
    const bounded = fullJitterDelay(2, { baseMs: 100, capMs: 250, rand: () => 0.75 });
    expect(bounded).toBe(250 * (0.5 + 0.75 * 0.5));
    expect(fullJitterDelay(0, { baseMs: 100, rand: () => 0 })).toBe(50);
    expect(fullJitterDelay(0, { baseMs: 100, rand: () => 1 })).toBe(100);
  });
});

describe("DEFERRED pacing (engine applyResult + nextBatch)", () => {
  it("honors retryAfterMs (bounded by the cap) and does NOT increment attempts", () => {
    vi.useFakeTimers({ now: FIXED_NOW });
    const adapter = memoryAdapter();
    applyMigrations(adapter);
    const { commandId } = enqueue(adapter, {
      entityType: "pos_sale",
      intent: "create",
      payload: { type: "pos_sale" },
      idempotencyKey: "retry-deferred-1",
    });
    markInFlight(adapter, [commandId]);
    expect(adapter.get("SELECT attempts FROM outbox WHERE command_id = ?", [commandId])!.attempts).toBe(1);

    // Server DEFERRED with a retryAfterMs hint: back to QUEUED, attempt
    // un-counted (DEFERRED is not a failure), retry paced by the hint.
    applyResult(adapter, { commandId, status: "DEFERRED", error: "rate limited", retryAfterMs: 5_000 });
    const row = nextBatch(adapter, 50, FIXED_NOW).find((candidate) => candidate.commandId === commandId);
    expect(row).toBeUndefined(); // not due yet — 5s pacing
    const due = nextBatch(adapter, 50, FIXED_NOW + 5_000).find((candidate) => candidate.commandId === commandId);
    expect(due).toBeDefined();
    expect(due!.attempts).toBe(0); // the send was un-counted
    expect(due!.nextAttemptAt).toBe(FIXED_NOW + 5_000);
  });

  it("bounds retryAfterMs by the cap and treats a hintless DEFERRED as due next cycle", () => {
    vi.useFakeTimers({ now: FIXED_NOW });
    const adapter = memoryAdapter();
    applyMigrations(adapter);
    const bounded = enqueue(adapter, {
      entityType: "pos_sale",
      intent: "create",
      payload: {},
      idempotencyKey: "retry-deferred-2",
    });
    applyResult(adapter, { commandId: bounded.commandId, status: "DEFERRED", retryAfterMs: 60_000_000 });
    expect(
      nextBatch(adapter, 50, FIXED_NOW + RETRY_CAP_MS - 1).find((c) => c.commandId === bounded.commandId),
    ).toBeUndefined();
    expect(
      nextBatch(adapter, 50, FIXED_NOW + RETRY_CAP_MS).find((c) => c.commandId === bounded.commandId),
    ).toBeDefined();

    const hintless = enqueue(adapter, {
      entityType: "pos_sale",
      intent: "create",
      payload: {},
      idempotencyKey: "retry-deferred-3",
    });
    applyResult(adapter, { commandId: hintless.commandId, status: "DEFERRED", error: "transport: dropped" });
    const dueNow = nextBatch(adapter, 50, FIXED_NOW).find((c) => c.commandId === hintless.commandId);
    expect(dueNow).toBeDefined();
    expect(dueNow!.nextAttemptAt).toBe(0);
  });
});

describe("RetryScheduler (§8: setTimeout per computed delay, retryAfterMs override)", () => {
  it("runs the task after each full-jitter delay and stops when done", async () => {
    vi.useFakeTimers();
    // Timing assertions ride INTEGER delays (constant rand → delay0 = 75,
    // delay1 = 150) so fake-timer fractional-clock artifacts cannot shift
    // a fire by ±1 ms; seeded-RNG determinism itself is covered above.
    const options = { baseMs: 100, capMs: 1_000, rand: () => 0.5 };
    const delay0 = fullJitterDelay(0, options); // 100 × 0.75 = 75
    const delay1 = fullJitterDelay(1, options); // 200 × 0.75 = 150
    expect(delay0).toBe(75);
    expect(delay1).toBe(150);
    let runs = 0;
    const scheduler = new RetryScheduler(options);
    scheduler.schedule(async () => {
      runs += 1;
      return runs >= 2;
    });
    expect(scheduler.pending).toBe(true);
    expect(runs).toBe(0);
    await vi.advanceTimersByTimeAsync(delay0 - 1);
    expect(runs).toBe(0); // strictly before the delay: nothing ran
    await vi.advanceTimersByTimeAsync(2);
    expect(runs).toBe(1); // fired exactly at the computed delay
    // The second delay is measured from the FIRST fire (delay0): it
    // completes at delay0 + delay1 on the absolute clock.
    await vi.advanceTimersByTimeAsync(delay1 - 2);
    expect(runs).toBe(1);
    await vi.advanceTimersByTimeAsync(2);
    expect(runs).toBe(2); // second attempt: attempts=1 → base×2 × jitter
    expect(scheduler.pending).toBe(false);
    expect(scheduler.attempts).toBe(1);
  });

  it("deferredRetryAfter overrides exactly the NEXT delay (bounded by the cap)", async () => {
    vi.useFakeTimers();
    let runs = 0;
    const scheduler = new RetryScheduler({ baseMs: 100_000, capMs: 1_000, rand: () => 1 });
    scheduler.deferredRetryAfter(400);
    scheduler.schedule(async () => {
      runs += 1;
      return runs >= 2;
    });
    // First delay: min(400, 1000) = 400 — NOT the 100s exponential.
    await vi.advanceTimersByTimeAsync(399);
    expect(runs).toBe(0);
    await vi.advanceTimersByTimeAsync(2);
    expect(runs).toBe(1);
    // The override is one-shot: the next delay is the exponential again
    // (min(cap, 100000 × 2^1) × 1.0 = 1000).
    await vi.advanceTimersByTimeAsync(998);
    expect(runs).toBe(1);
    await vi.advanceTimersByTimeAsync(2);
    expect(runs).toBe(2);
    // An override beyond the cap is bounded by the cap.
    scheduler.deferredRetryAfter(999_999);
    scheduler.schedule(async () => {
      runs += 1;
      return true;
    });
    await vi.advanceTimersByTimeAsync(1_000);
    expect(runs).toBe(3);
  });

  it("cancel stops the loop and clears the pending timer", async () => {
    vi.useFakeTimers();
    let runs = 0;
    const scheduler = new RetryScheduler({ baseMs: 50, rand: () => 0.5 });
    scheduler.schedule(async () => {
      runs += 1;
      return false;
    });
    scheduler.cancel();
    expect(scheduler.pending).toBe(false);
    await vi.advanceTimersByTimeAsync(10_000);
    expect(runs).toBe(0); // nothing fired after cancel
    // A failing task retries like an unfinished one (never throws out).
    const resilient = new RetryScheduler({ baseMs: 10, rand: () => 0.5 });
    let throwingRuns = 0;
    resilient.schedule(async () => {
      throwingRuns += 1;
      if (throwingRuns === 1) throw new Error("transient");
      return true;
    });
    await vi.advanceTimersByTimeAsync(100);
    expect(throwingRuns).toBe(2);
    expect(resilient.pending).toBe(false);
  });
});
