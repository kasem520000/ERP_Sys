import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { PullEnvelope, PushItemResult, PushItemResultV2 } from "@erp/contracts";
import {
  buildSyncCommandV2,
  enqueue,
  FakeSyncServerV2,
  V2Transport,
  type SyncTransport,
} from "@erp/sync-core";

import { BudgetGuard } from "../src/sync/transport";
import {
  FakeScheduler,
  MobileSyncTriggers,
  type ConnectivitySignal,
} from "../src/sync/triggers";
import { MobileSyncHost } from "../src/sync/host";
import { openFieldStore, openPersonalStore, type MobileStore } from "../src/store";
import {
  PERSONAL_BACKGROUND_PULL_BUDGET_BYTES,
  SYNC_BACKGROUND_MIN_INTERVAL_MS,
  SYNC_CONNECTIVITY_DEBOUNCE_MS,
  SYNC_FOREGROUND_INTERVAL_MS,
} from "../src/constants";

/**
 * PHASE-022 · the mobile sync triggers suite (T2-a; MASTER-PLAN §7 — the
 * golden-constant schedule): the REAL host over REAL temp SQLite stores
 * + the sync-core FakeSyncServerV2 — with an injected fake clock/timer
 * suite so the 5 s connectivity debounce and the 2-min periodic-while-
 * dirty tick are driven deterministically, a FakeScheduler for the
 * ≥ 15 min background task, and vi fake timers for the RetryScheduler's
 * DEFERRED retryAfterMs (the one piece whose timer lives inside
 * sync-core — unmodified, so the global timer is the seam).
 */

const PARTNER_ID = "31313131-2222-4222-8222-222222222222";

/** A deterministic timer suite (injectable through the options). */
class FakeTimers {
  now = 0;
  private sequence = 0;
  private readonly entries = new Map<number, { at: number; period?: number; callback: () => void }>();

  readonly setTimeout = (callback: () => void, ms: number): number => {
    this.sequence += 1;
    this.entries.set(this.sequence, { at: this.now + ms, callback });
    return this.sequence;
  };

  readonly clearTimeout = (handle: unknown): void => {
    this.entries.delete(Number(handle));
  };

  readonly setInterval = (callback: () => void, ms: number): number => {
    this.sequence += 1;
    this.entries.set(this.sequence, { at: this.now + ms, period: ms, callback });
    return this.sequence;
  };

  readonly clearInterval = (handle: unknown): void => {
    this.entries.delete(Number(handle));
  };

  /** Advance the clock, firing every due entry in schedule order
   * (intervals reschedule themselves). */
  advance(ms: number): void {
    const target = this.now + ms;
    for (;;) {
      let earliestId: number | null = null;
      let earliestAt = Number.POSITIVE_INFINITY;
      for (const [id, entry] of this.entries) {
        if (entry.at <= target && entry.at < earliestAt) {
          earliestId = id;
          earliestAt = entry.at;
        }
      }
      if (earliestId === null) break;
      const entry = this.entries.get(earliestId)!;
      this.now = entry.at;
      if (entry.period !== undefined) {
        this.entries.set(earliestId, { at: entry.at + entry.period, period: entry.period, callback: entry.callback });
      } else {
        this.entries.delete(earliestId);
      }
      entry.callback();
    }
    this.now = target;
  }
}

/** A fake connectivity signal (subscriber bookkeeping included). */
function fakeConnectivity(): {
  connectivity: ConnectivitySignal;
  emit: (online: boolean) => void;
  subscriberCount: () => number;
} {
  const subscribers = new Set<(online: boolean) => void>();
  return {
    connectivity: {
      onChange: (callback: (online: boolean) => void): (() => void) => {
        subscribers.add(callback);
        return () => {
          subscribers.delete(callback);
        };
      },
    },
    emit: (online: boolean) => {
      for (const callback of [...subscribers]) callback(online);
    },
    subscriberCount: () => subscribers.size,
  };
}

/** Counting proxy (the optionality-preserving pattern — pull/push are
 * required, the v2 members ride the inner). */
class CountingTransport implements SyncTransport {
  readonly counts = { status: 0, pull: 0, pushV2: 0, push: 0, pullAck: 0, pushAck: 0 };

  constructor(private readonly inner: SyncTransport) {}

  async pull(entityType: string, cursor: string | null, limit?: number): Promise<PullEnvelope> {
    this.counts.pull += 1;
    return this.inner.pull(entityType, cursor, limit);
  }

  async push(batchId: string, commands: readonly Record<string, unknown>[]): Promise<PushItemResult[]> {
    this.counts.push += 1;
    return this.inner.push(batchId, commands);
  }

  async status(): Promise<{
    serverTime: string;
    contractVersion: string;
    suspended?: boolean;
    device?: { revoked?: boolean };
  }> {
    this.counts.status += 1;
    return this.inner.status!();
  }

  async pushV2(request: {
    contractVersion: string;
    commands: readonly Record<string, unknown>[];
  }): Promise<PushItemResultV2[]> {
    this.counts.pushV2 += 1;
    return this.inner.pushV2!(request);
  }

  async pullAck(positions: readonly { entityType: string; cursor: string }[]): Promise<void> {
    this.counts.pullAck += 1;
    return this.inner.pullAck!(positions);
  }

  async pushAck(commandIds: readonly string[]): Promise<void> {
    this.counts.pushAck += 1;
    return this.inner.pushAck!(commandIds);
  }
}

const workDirs: string[] = [];
const openStores: MobileStore[] = [];

afterAll(() => {
  for (const store of openStores) store.close();
  for (const dir of workDirs) rmSync(dir, { recursive: true, force: true });
});

interface TriggerHarness {
  readonly store: MobileStore;
  readonly server: FakeSyncServerV2;
  readonly transport: CountingTransport;
  readonly host: MobileSyncHost;
  readonly budget: BudgetGuard;
  readonly scheduler: FakeScheduler;
}

function makeHarness(profile: "field" | "personal"): TriggerHarness {
  const dir = mkdtempSync(join(tmpdir(), profile === "field" ? "erp-mobile-triggers-field-" : "erp-mobile-triggers-personal-"));
  workDirs.push(dir);
  const store = profile === "field" ? openFieldStore(join(dir, "store.sqlite")) : openPersonalStore(join(dir, "store.sqlite"));
  openStores.push(store);
  const server = new FakeSyncServerV2();
  const transport = new CountingTransport(new V2Transport(server));
  const budget = new BudgetGuard();
  const host = new MobileSyncHost({
    store,
    deviceClass: profile === "field" ? "android-field" : "android-personal",
    transport,
    accessToken: () => "access-token-triggers-01",
    budget: { controller: budget },
  });
  return { store, server, transport, host, budget, scheduler: new FakeScheduler() };
}

/** Flush pending microtasks (the fired trigger callbacks are async). */
function flush(): Promise<void> {
  return new Promise<void>((resolve) => setImmediate(resolve));
}

function enqueuePartnerCommand(store: MobileStore, suffix: string): string {
  const command = buildSyncCommandV2({
    entityType: "partner",
    intent: "contact_merge",
    payload: { partnerId: PARTNER_ID, phone: "+97330000000" },
    idempotencyKey: `partner:contact_merge:${suffix}`,
  });
  store.transaction(() => {
    enqueue(store, {
      entityType: command.entityType,
      intent: command.intent,
      payload: command as unknown as Record<string, unknown>,
      idempotencyKey: command.idempotencyKey,
      commandId: command.commandId,
    });
  });
  return command.commandId;
}

describe("MobileSyncTriggers — the golden-constant schedule (MASTER-PLAN §0)", () => {
  it("connectivity regained: 5 s debounce, bursts collapse to exactly ONE cycle", async () => {
    const { store, transport, host, scheduler } = makeHarness("field");
    const timers = new FakeTimers();
    const connectivity = fakeConnectivity();
    const triggers = new MobileSyncTriggers({
      host,
      connectivity: connectivity.connectivity,
      background: scheduler,
      now: () => timers.now,
      timers: {
        setInterval: timers.setInterval,
        clearInterval: timers.clearInterval,
        setTimeout: timers.setTimeout,
        clearTimeout: timers.clearTimeout,
      },
    });
    triggers.start();

    // Burst: four regained events inside the debounce window.
    connectivity.emit(true);
    connectivity.emit(true);
    connectivity.emit(true);
    connectivity.emit(true);
    timers.advance(SYNC_CONNECTIVITY_DEBOUNCE_MS - 1);
    expect(transport.counts.status).toBe(0); // still debouncing
    timers.advance(1);
    await flush();
    expect(transport.counts.status).toBe(1); // exactly one full cycle
    expect(host.state.phase).toBe("idle");
    expect(store.all("SELECT * FROM cursors").length).toBeGreaterThan(0); // a real cycle ran

    // A later regained event fires one more (the debounce re-arms).
    connectivity.emit(true);
    timers.advance(SYNC_CONNECTIVITY_DEBOUNCE_MS);
    await flush();
    expect(transport.counts.status).toBe(2);
    triggers.stop();
  });

  it("a connectivity drop before the debounce fires cancels the pending cycle", async () => {
    const { transport, host, scheduler } = makeHarness("field");
    const timers = new FakeTimers();
    const connectivity = fakeConnectivity();
    const triggers = new MobileSyncTriggers({
      host,
      connectivity: connectivity.connectivity,
      background: scheduler,
      now: () => timers.now,
      timers: {
        setInterval: timers.setInterval,
        clearInterval: timers.clearInterval,
        setTimeout: timers.setTimeout,
        clearTimeout: timers.clearTimeout,
      },
    });
    triggers.start();
    connectivity.emit(true);
    timers.advance(3_000);
    connectivity.emit(false); // dropped again mid-debounce
    timers.advance(SYNC_CONNECTIVITY_DEBOUNCE_MS);
    await flush();
    expect(transport.counts.status).toBe(0); // cancelled — nothing fired
    // Regained again → one cycle after the full debounce.
    connectivity.emit(true);
    timers.advance(SYNC_CONNECTIVITY_DEBOUNCE_MS);
    await flush();
    expect(transport.counts.status).toBe(1);
    triggers.stop();
  });

  it("periodic while dirty: skips when the queue is clean, fires when dirty (2 min)", async () => {
    const { store, transport, host, scheduler } = makeHarness("field");
    const timers = new FakeTimers();
    const triggers = new MobileSyncTriggers({
      host,
      connectivity: null,
      background: scheduler,
      now: () => timers.now,
      timers: {
        setInterval: timers.setInterval,
        clearInterval: timers.clearInterval,
        setTimeout: timers.setTimeout,
        clearTimeout: timers.clearTimeout,
      },
    });
    triggers.start();

    // Clean queue: the tick skips (cheap poll), the timer stays armed.
    timers.advance(SYNC_FOREGROUND_INTERVAL_MS);
    await flush();
    expect(transport.counts.status).toBe(0);
    timers.advance(SYNC_FOREGROUND_INTERVAL_MS);
    await flush();
    expect(transport.counts.status).toBe(0);

    // Dirty queue: the tick fires a full cycle and drains it.
    enqueuePartnerCommand(store, "periodic");
    expect(host.queueDepth()).toBe(1);
    timers.advance(SYNC_FOREGROUND_INTERVAL_MS);
    await flush();
    expect(transport.counts.status).toBe(1);
    expect(transport.counts.pushV2).toBe(1);
    expect(host.queueDepth()).toBe(0);

    // Clean again: the next ticks skip — the timer is still alive.
    timers.advance(SYNC_FOREGROUND_INTERVAL_MS * 3);
    await flush();
    expect(transport.counts.status).toBe(1);
    triggers.stop();
  });

  it("the personal class is never dirty: its 2-min tick is always a no-op (reads refresh via background)", async () => {
    const { transport, host, scheduler } = makeHarness("personal");
    const timers = new FakeTimers();
    const triggers = new MobileSyncTriggers({
      host,
      connectivity: null,
      background: scheduler,
      now: () => timers.now,
      timers: {
        setInterval: timers.setInterval,
        clearInterval: timers.clearInterval,
        setTimeout: timers.setTimeout,
        clearTimeout: timers.clearTimeout,
      },
    });
    triggers.start();
    // Three ticks with a store full of read models — nothing fires.
    timers.advance(SYNC_FOREGROUND_INTERVAL_MS * 3);
    await flush();
    expect(transport.counts.status).toBe(0);
    triggers.stop();
  });

  it("onLocalWrite: the post-write fast push (pushNow) — pull NOT called (field)", async () => {
    const { store, transport, host, scheduler } = makeHarness("field");
    const timers = new FakeTimers();
    const triggers = new MobileSyncTriggers({
      host,
      connectivity: null,
      background: scheduler,
      now: () => timers.now,
      timers: {
        setInterval: timers.setInterval,
        clearInterval: timers.clearInterval,
        setTimeout: timers.setTimeout,
        clearTimeout: timers.clearTimeout,
      },
    });
    triggers.start();
    enqueuePartnerCommand(store, "fastpush");
    await triggers.onLocalWrite();

    expect(transport.counts.pushV2).toBe(1);
    expect(transport.counts.pull).toBe(0); // fast push — no pull
    expect(transport.counts.status).toBe(0); // no status round-trip either
    expect(host.queueDepth()).toBe(0);
    triggers.stop();
  });

  it("onStartOrUnlock + onManualSync drive full cycles", async () => {
    const { transport, host, scheduler } = makeHarness("field");
    const timers = new FakeTimers();
    const triggers = new MobileSyncTriggers({
      host,
      connectivity: null,
      background: scheduler,
      now: () => timers.now,
      timers: {
        setInterval: timers.setInterval,
        clearInterval: timers.clearInterval,
        setTimeout: timers.setTimeout,
        clearTimeout: timers.clearTimeout,
      },
    });
    triggers.start();
    await triggers.onStartOrUnlock();
    expect(transport.counts.status).toBe(1);
    expect(transport.counts.pull).toBeGreaterThan(0); // full cycle
    await triggers.onManualSync();
    expect(transport.counts.status).toBe(2);
    triggers.stop();
  });

  it("stop(): cancels the subscription + every pending timer + the background task; idempotent; never-started safe", async () => {
    const { transport, host, scheduler } = makeHarness("field");
    const timers = new FakeTimers();
    const connectivity = fakeConnectivity();
    const triggers = new MobileSyncTriggers({
      host,
      connectivity: connectivity.connectivity,
      background: scheduler,
      now: () => timers.now,
      timers: {
        setInterval: timers.setInterval,
        clearInterval: timers.clearInterval,
        setTimeout: timers.setTimeout,
        clearTimeout: timers.clearTimeout,
      },
    });
    triggers.start();
    expect(connectivity.subscriberCount()).toBe(1);
    expect(scheduler.registrations).toHaveLength(1); // one background task
    triggers.start(); // idempotent — no second subscription, no second task
    expect(connectivity.subscriberCount()).toBe(1);
    expect(scheduler.registrations).toHaveLength(1);

    connectivity.emit(true); // pending debounce…
    triggers.stop();
    expect(connectivity.subscriberCount()).toBe(0); // unsubscribed
    expect(scheduler.isUnregistered(0)).toBe(true); // the background task unregistered
    connectivity.emit(true); // …goes nowhere now
    timers.advance(SYNC_FOREGROUND_INTERVAL_MS * 5);
    await flush();
    expect(transport.counts.status).toBe(0); // nothing fired after stop

    expect(() => triggers.stop()).not.toThrow(); // idempotent
    expect(() => {
      const fresh = new MobileSyncTriggers({ host, connectivity: null });
      fresh.stop(); // never-started — safe
    }).not.toThrow();

    // Restart after stop: the cadence arms again.
    triggers.start();
    expect(connectivity.subscriberCount()).toBe(1);
    connectivity.emit(true);
    timers.advance(SYNC_CONNECTIVITY_DEBOUNCE_MS);
    await flush();
    expect(transport.counts.status).toBe(1);
    triggers.stop();
  });
});

describe("MobileSyncTriggers — the BackgroundSchedulerPort (≥ 15 min, the golden floor)", () => {
  it("registers the task with minIntervalMs = 900_000 and firing runs a real cycle", async () => {
    const { transport, host, scheduler } = makeHarness("field");
    const triggers = new MobileSyncTriggers({ host, connectivity: null, background: scheduler });
    triggers.start();

    // The golden floor — never faster (the OS may always defer further).
    expect(SYNC_BACKGROUND_MIN_INTERVAL_MS).toBe(900_000);
    expect(scheduler.registrations[0]!.minIntervalMs).toBe(SYNC_BACKGROUND_MIN_INTERVAL_MS);
    expect(scheduler.registrations[0]!.minIntervalMs).toBeGreaterThanOrEqual(900_000);

    await scheduler.fire(0);
    expect(transport.counts.status).toBe(1); // a real full cycle ran
    expect(host.state.phase).toBe("idle");
    triggers.stop();
  });

  it("personal BACKGROUND firing arms the 256 KB pull budget (the read-mostly profile)", async () => {
    const { transport, host, budget, scheduler } = makeHarness("personal");
    const triggers = new MobileSyncTriggers({ host, connectivity: null, background: scheduler });
    triggers.start();
    expect(scheduler.registrations[0]!.minIntervalMs).toBe(SYNC_BACKGROUND_MIN_INTERVAL_MS);

    await scheduler.fire(0);
    expect(transport.counts.status).toBe(1);
    expect(budget.usage().pullLimitBytes).toBe(PERSONAL_BACKGROUND_PULL_BUDGET_BYTES);
    expect(budget.usage().pullLimitBytes).toBe(262_144);
    // No push ever happened for the personal class.
    expect(transport.counts.pushV2).toBe(0);
    expect(transport.counts.push).toBe(0);
    triggers.stop();
  });
});

describe("MobileSyncTriggers — DEFERRED retryAfterMs honored via RetryScheduler (§3.5)", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("a DEFERRED command with retryAfterMs 20 s retries after ~20 s — NOT the 5 s base backoff", async () => {
    // A scripted transport: the FIRST push of the command returns DEFERRED
    // with retryAfterMs 20_000; the retry (second push) accepts. The push
    // COUNT rides the fake server's own recorder (the deferring wrapper
    // sits between the counting proxy and the server).
    const { store, server, transport } = makeHarness("field");
    const seen = new Set<string>();
    const deferring: SyncTransport = {
      pull: (entityType, cursor, limit) => transport.inner.pull(entityType, cursor, limit),
      push: (batchId, commands) => transport.inner.push(batchId, commands),
      status: () => transport.inner.status!(),
      pushV2: async (request) => {
        const results = await transport.inner.pushV2(request);
        return results.map((result) => {
          const id = result.commandId ?? result.id;
          if (result.status === "ACCEPTED" && !seen.has(id)) {
            seen.add(id);
            return {
              ...result,
              status: "DEFERRED" as const,
              reason: "RATE_LIMITED",
              message: "rate limited",
              ...({ retryAfterMs: 20_000 } as Record<string, unknown>),
            } as PushItemResultV2;
          }
          return result;
        });
      },
      pullAck: (positions) => transport.inner.pullAck(positions),
      pushAck: (commandIds) => transport.inner.pushAck(commandIds),
    };
    const deferredHost = new MobileSyncHost({
      store,
      deviceClass: "android-field",
      transport: deferring,
      accessToken: () => "access-token-deferred-01",
    });
    const triggers = new MobileSyncTriggers({ host: deferredHost, connectivity: null });

    const commandId = enqueuePartnerCommand(store, "deferred");
    expect(deferredHost.queueDepth()).toBe(1);

    // The manual cycle pushes once → DEFERRED (retryAfterMs 20 s lands on
    // the outbox row's next_attempt_at); refreshDeferredRetry arms the
    // RetryScheduler with the server's hint.
    await triggers.onManualSync();
    expect(deferredHost.state.lastOutcome?.deferred).toBe(1);
    expect(store.get("SELECT * FROM outbox WHERE command_id = ?", [commandId])?.status).toBe("QUEUED");
    const nextAttemptAt = Number(
      store.get("SELECT next_attempt_at FROM outbox WHERE command_id = ?", [commandId])?.next_attempt_at ?? 0,
    );
    expect(nextAttemptAt).toBeGreaterThan(Date.now()); // paced in the future
    expect(triggers.scheduler.pending).toBe(true); // the loop is armed

    // NOT fired at 19 s — the honored hint (the 5 s base × full jitter
    // would have fired between 2.5 s and 5 s; proving the override).
    await vi.advanceTimersByTimeAsync(19_000);
    expect(server.pushCalls).toHaveLength(1); // still exactly the first push

    // Fired by ~21 s: the retry push runs, the queue drains, the loop ends.
    await vi.advanceTimersByTimeAsync(2_000);
    expect(server.pushCalls).toHaveLength(2);
    expect(deferredHost.queueDepth()).toBe(0);
    expect(store.get("SELECT * FROM outbox WHERE command_id = ?", [commandId])?.status).toBe("ACKED");
    expect(triggers.scheduler.pending).toBe(false); // the task resolved done
    triggers.stop();
  });

  it("nothing deferred → refreshDeferredRetry is a no-op (the normal triggers own the due-now case)", () => {
    const { host, scheduler } = makeHarness("field");
    const triggers = new MobileSyncTriggers({ host, connectivity: null, background: scheduler });
    triggers.refreshDeferredRetry();
    expect(triggers.scheduler.pending).toBe(false);
    expect(host.deferredRetryHintMs()).toBeNull();
  });
});
