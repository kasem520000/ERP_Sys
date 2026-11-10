import { afterAll, describe, expect, it } from "vitest";
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

import { DesktopSession } from "../src/auth";
import type { DesktopBridge } from "../src/bridge/contract";
import { openDesktopStore, type DesktopStore } from "../src/store";
import {
  SyncDesktopHost,
  SyncTriggers,
  SYNC_CONNECTIVITY_DEBOUNCE_MS,
  SYNC_PERIODIC_INTERVAL_MS,
} from "../src/sync";

/**
 * PHASE-021 · the sync triggers suite (T4; MASTER-PLAN §5; SYNC_PROTOCOL
 * §8 trigger table): the REAL host over a REAL temp SQLite store + the
 * sync-core FakeSyncServerV2 — with an injected fake clock/timer suite so
 * the 5 s connectivity debounce and the 2-min periodic-while-dirty tick
 * are driven deterministically. The §8 behaviors under assertion:
 * start/unlock, connectivity-regained (bursts collapse to ONE cycle),
 * periodic while dirty (skip when clean — timer stays armed), post-write
 * fast push (no pull), manual sync, and stop() cancelling everything.
 */

const DEVICE_ID = "21212121-1111-4111-8111-111111111111";

/** A deterministic timer suite (injectable through SyncTriggersOptions). */
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

/** A fake bridge connectivity member (subscriber bookkeeping included). */
function fakeConnectivity(): {
  bridge: Pick<DesktopBridge, "connectivity">;
  emit: (online: boolean) => void;
  subscriberCount: () => number;
} {
  const subscribers = new Set<(online: boolean) => void>();
  return {
    bridge: {
      connectivity: {
        onChange: (callback: (online: boolean) => void): (() => void) => {
          subscribers.add(callback);
          return () => {
            subscribers.delete(callback);
          };
        },
        isOnline: () => true,
      },
    },
    emit: (online: boolean) => {
      for (const callback of [...subscribers]) callback(online);
    },
    subscriberCount: () => subscribers.size,
  };
}

/** Counting proxy (the same optionality-preserving pattern as the host
 * suite — pull/push are required, the v2 members ride the inner). */
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
const openStores: DesktopStore[] = [];

afterAll(() => {
  for (const store of openStores) store.close();
  for (const dir of workDirs) rmSync(dir, { recursive: true, force: true });
});

function makeHarness(): {
  store: DesktopStore;
  transport: CountingTransport;
  host: SyncDesktopHost;
} {
  const dir = mkdtempSync(join(tmpdir(), "erp-desktop-synctriggers-"));
  workDirs.push(dir);
  const store = openDesktopStore({ path: join(dir, "store.sqlite") });
  openStores.push(store);
  const session = new DesktopSession({
    getRefreshToken: () => Promise.resolve("refresh-secret-0123456789abcdef0123456789"),
    refresh: async () => {
      throw new Error("not expected in the trigger suite (primed session)");
    },
  });
  session.prime("access-primed-token", new Date(Date.now() + 14 * 60_000).toISOString());
  const transport = new CountingTransport(new V2Transport(new FakeSyncServerV2()));
  const host = new SyncDesktopHost({ store, transport, session, deviceId: DEVICE_ID });
  return { store, transport, host };
}

/** Flush pending microtasks (the fired trigger callbacks are async). */
function flush(): Promise<void> {
  return new Promise<void>((resolve) => setImmediate(resolve));
}

function enqueuePartnerCommand(store: DesktopStore, suffix: string): string {
  const command = buildSyncCommandV2({
    entityType: "partner",
    intent: "contact_merge",
    payload: { partnerId: "21212121-2222-4222-8222-222222222222", phone: "+97330000000" },
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

describe("SyncTriggers — §8 trigger table (SYNC_PROTOCOL §8)", () => {
  it("connectivity regained: 5 s debounce, bursts collapse to exactly ONE cycle", async () => {
    const { store, transport, host } = makeHarness();
    const timers = new FakeTimers();
    const connectivity = fakeConnectivity();
    const triggers = new SyncTriggers({
      host,
      bridge: connectivity.bridge,
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
    const { transport, host } = makeHarness();
    const timers = new FakeTimers();
    const connectivity = fakeConnectivity();
    const triggers = new SyncTriggers({
      host,
      bridge: connectivity.bridge,
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

  it("periodic while dirty: skips when the queue is clean, fires when dirty", async () => {
    const { store, transport, host } = makeHarness();
    const timers = new FakeTimers();
    const triggers = new SyncTriggers({
      host,
      bridge: null,
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
    timers.advance(SYNC_PERIODIC_INTERVAL_MS);
    await flush();
    expect(transport.counts.status).toBe(0);
    timers.advance(SYNC_PERIODIC_INTERVAL_MS);
    await flush();
    expect(transport.counts.status).toBe(0);

    // Dirty queue: the tick fires a full cycle and drains it.
    enqueuePartnerCommand(store, "periodic");
    expect(host.queueDepth()).toBe(1);
    timers.advance(SYNC_PERIODIC_INTERVAL_MS);
    await flush();
    expect(transport.counts.status).toBe(1);
    expect(transport.counts.pushV2).toBe(1);
    expect(host.queueDepth()).toBe(0);

    // Clean again: the next ticks skip — the timer is still alive.
    timers.advance(SYNC_PERIODIC_INTERVAL_MS * 3);
    await flush();
    expect(transport.counts.status).toBe(1);
    triggers.stop();
  });

  it("onLocalWrite: the post-write fast push (pushNow) — pull NOT called", async () => {
    const { store, transport, host } = makeHarness();
    const timers = new FakeTimers();
    const triggers = new SyncTriggers({
      host,
      bridge: null,
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
    const { transport, host } = makeHarness();
    const timers = new FakeTimers();
    const triggers = new SyncTriggers({
      host,
      bridge: null,
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

  it("stop(): cancels the subscription + every pending timer; idempotent; never-started safe", async () => {
    const { transport, host } = makeHarness();
    const timers = new FakeTimers();
    const connectivity = fakeConnectivity();
    const triggers = new SyncTriggers({
      host,
      bridge: connectivity.bridge,
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
    triggers.start(); // idempotent — no second subscription
    expect(connectivity.subscriberCount()).toBe(1);

    connectivity.emit(true); // pending debounce…
    triggers.stop();
    expect(connectivity.subscriberCount()).toBe(0); // unsubscribed
    connectivity.emit(true); // …goes nowhere now
    timers.advance(SYNC_PERIODIC_INTERVAL_MS * 5);
    await flush();
    expect(transport.counts.status).toBe(0); // nothing fired after stop

    expect(() => triggers.stop()).not.toThrow(); // idempotent
    expect(() => {
      const fresh = new SyncTriggers({ host, bridge: null });
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
