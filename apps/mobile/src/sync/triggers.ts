import {
  SYNC_BACKGROUND_MIN_INTERVAL_MS,
  SYNC_CONNECTIVITY_DEBOUNCE_MS,
  SYNC_FOREGROUND_INTERVAL_MS,
} from "../constants";
import { RetryScheduler } from "@erp/sync-core";

import type { MobileSyncHost } from "./host";

/**
 * PHASE-022 · the mobile sync triggers (T2-a; MASTER-PLAN §7 — BINDING;
 * the golden-constant schedule, §0): the shell-facing cadence that
 * drives the host. The full table:
 *
 * | Trigger | Behavior |
 * |---------|----------|
 * | App start / unlock | `onStartOrUnlock()` → full `host.syncNow()` (runCycle's step 1 IS the recovery pass for field) |
 * | Connectivity regained | the connectivity subscription → 5 s debounce → full cycle (bursts collapse to ONE cycle; a drop before the debounce fires cancels it) |
 * | Periodic while dirty | every 2 min: `queueDepth() > 0` → full cycle; clean → skip, the timer stays armed (cheap poll). Field-only by construction — the personal class has no queue (its reads refresh through the background task + connectivity + manual) |
 * | After local write | `onLocalWrite()` → `host.pushNow()` (push-only fast cycle — no pull; the personal host refuses it with `pull-only`, its screens have no write affordances to call this) |
 * | Manual | `onManualSync()` → full `host.syncNow()` |
 * | Background fetch | the `BackgroundSchedulerPort` task, every ≥ 15 min OS-scheduled (Doze-aware — the OS may always defer further; budgets are ceilings): a full cycle with the BACKGROUND budget profile (personal pulls ≤ 256 KB) |
 * | DEFERRED retryAfterMs | after any cycle that leaves deferred outbox rows, `refreshDeferredRetry()` arms the shared `RetryScheduler` with the server's hint (bounded by the cap) — the task re-runs the push-only fast cycle until the queue drains |
 *
 * Double-fire safety: the triggers never queue work themselves — the
 * HOST's one-in-flight mutex is the guard (a trigger firing while a
 * cycle runs is skipped by the host).
 *
 * Timer seams are fully injectable (`timers` — the four primitives —
 * plus `now`) so the suite drives the debounces/ticks deterministically
 * without host-level fake timers; the background scheduler is its own
 * port (expo-background-fetch on device — `registerTask` +
 * `unregisterTaskAsync`; `FakeScheduler` in tests).
 */

/** An opaque timer handle (Node Timeout, Hermes timer id, or the test
 * double's). */
export type SyncTimerHandle = unknown;

/** The four timer primitives the trigger set needs — injectable so the
 * suite drives the 5 s debounce and the 2-min tick deterministically. */
export interface SyncTimers {
  setInterval(callback: () => void, ms: number): SyncTimerHandle;
  clearInterval(handle: SyncTimerHandle): void;
  setTimeout(callback: () => void, ms: number): SyncTimerHandle;
  clearTimeout(handle: SyncTimerHandle): void;
}

/** The default timer suite — the Hermes/Node globals (React Native's JS
 * runtime ships setInterval/setTimeout; no DOM APIs are touched). */
export const globalSyncTimers: SyncTimers = {
  setInterval: (callback, ms) => setInterval(callback, ms),
  clearInterval: (handle) => clearInterval(handle as Parameters<typeof clearInterval>[0]),
  setTimeout: (callback, ms) => setTimeout(callback, ms),
  clearTimeout: (handle) => clearTimeout(handle as Parameters<typeof clearTimeout>[0]),
};

/** The connectivity signal the shell provides (or null when the shell
 * reports no connectivity signal — the other triggers still work). */
export interface ConnectivitySignal {
  onChange(callback: (online: boolean) => void): () => void;
}

/**
 * The background-fetch port (the native driver implements with
 * expo-background-fetch + expo-task-manager: `registerTaskAsync` with
 * `minimumInterval: minIntervalMs / 1000` and a task named for the app;
 * the returned unregister function calls `unregisterTaskAsync`). The OS
 * is the scheduler — `minIntervalMs` is a CEILING request (≥ 15 min per
 * the golden constants; Doze may defer further, never faster).
 */
export interface BackgroundSchedulerPort {
  /** Register the periodic background task. Returns the unregister
   * function (idempotent). */
  registerTask(input: {
    readonly minIntervalMs: number;
    readonly onFire: () => Promise<void> | void;
  }): () => void;
}

/**
 * The test double for {@link BackgroundSchedulerPort}: records every
 * registration (the suite asserts `minIntervalMs` ≥ 15 min and fires
 * the task on demand); `fire()` awaits the onFire callback.
 */
export class FakeScheduler implements BackgroundSchedulerPort {
  readonly registrations: {
    readonly minIntervalMs: number;
    readonly onFire: () => Promise<void> | void;
    readonly unregister: () => void;
  }[] = [];

  registerTask(input: {
    minIntervalMs: number;
    onFire: () => Promise<void> | void;
  }): () => void {
    const registration = {
      minIntervalMs: input.minIntervalMs,
      onFire: input.onFire,
      unregistered: false,
      unregister: () => {
        registration.unregistered = true;
      },
    };
    this.registrations.push(registration);
    return registration.unregister;
  }

  /** Fire the (still-registered) task at `index`; awaits onFire. */
  async fire(index: number): Promise<void> {
    const registration = this.registrations[index];
    if (registration === undefined) {
      throw new Error(`FakeScheduler.fire: no registration at index ${String(index)}`);
    }
    await registration.onFire();
  }

  /** Whether the registration at `index` was unregistered. */
  isUnregistered(index: number): boolean {
    const registration = this.registrations[index] as { unregistered?: boolean } | undefined;
    return registration?.unregistered === true;
  }
}

export interface MobileSyncTriggersOptions {
  readonly host: MobileSyncHost;
  /** The connectivity signal, or null when the shell reports none. */
  readonly connectivity: ConnectivitySignal | null;
  /** The background-fetch port (null ⇒ no background task; the shell
   * passes its device implementation or `new FakeScheduler()` in
   * tests). */
  readonly background?: BackgroundSchedulerPort | null;
  /** Injectable timers (default: the Hermes/Node globals). */
  readonly timers?: SyncTimers;
  /** Injectable clock (default: Date.now) — diagnostics + tests. */
  readonly now?: () => number;
}

/** The trigger set over a {@link MobileSyncHost}. */
export class MobileSyncTriggers {
  private readonly host: MobileSyncHost;
  private readonly connectivity: ConnectivitySignal | null;
  private readonly background: BackgroundSchedulerPort | null;
  private readonly clock: () => number;
  private readonly timers: SyncTimers;

  /** The DEFERRED-retry scheduler (§3.5): full jitter with the server's
   * retryAfterMs override; the task re-runs the push-only fast cycle
   * until the queue drains. Exposed for the suite + diagnostics. */
  readonly scheduler = new RetryScheduler();

  private unsubscribeConnectivity: (() => void) | null = null;
  private unregisterBackground: (() => void) | null = null;
  private debounceHandle: SyncTimerHandle | null = null;
  private periodicHandle: SyncTimerHandle | null = null;
  private started = false;

  constructor(options: MobileSyncTriggersOptions) {
    this.host = options.host;
    this.connectivity = options.connectivity;
    this.background = options.background ?? null;
    this.clock = options.now ?? (() => Date.now());
    this.timers = options.timers ?? globalSyncTimers;
  }

  /**
   * Arm the cadence: subscribe to the connectivity signal, start the
   * periodic-while-dirty timer, register the background task.
   * Idempotent (a second call is a no-op). The app-start/unlock trigger
   * is NOT armed here — the shell calls {@link onStartOrUnlock}
   * explicitly at boot/unlock.
   */
  start(): void {
    if (this.started) return;
    this.started = true;
    if (this.connectivity !== null) {
      this.unsubscribeConnectivity = this.connectivity.onChange((online) => {
        this.onConnectivityEvent(online);
      });
    }
    this.periodicHandle = this.timers.setInterval(() => {
      this.onPeriodicTick();
    }, SYNC_FOREGROUND_INTERVAL_MS);
    if (this.background !== null) {
      this.unregisterBackground = this.background.registerTask({
        minIntervalMs: SYNC_BACKGROUND_MIN_INTERVAL_MS,
        onFire: () => this.runInternal(true, true),
      });
    }
  }

  /**
   * "App start / unlock": one full cycle (the host's runCycle runs the
   * recovery pass first for field; the personal cycle checks its own
   * integrity first). Rejections (e.g. MobileSessionExpiredError)
   * propagate to the caller — the shell owns that UX; the host state is
   * always recorded.
   */
  async onStartOrUnlock(): Promise<void> {
    await this.host.syncNow();
    this.refreshDeferredRetry();
  }

  /**
   * "After local write": the push-only fast cycle for interactive
   * feedback (drafts). Field only — the personal host refuses it with
   * `pull-only` (its screens have no write affordances that could call
   * this); the refusal is silent-by-design here (the HOST is the guard).
   */
  async onLocalWrite(): Promise<void> {
    await this.host.pushNow();
    this.refreshDeferredRetry();
  }

  /** "Manual": the user-initiated sync-now. */
  async onManualSync(): Promise<void> {
    await this.host.syncNow();
    this.refreshDeferredRetry();
  }

  /** The trigger clock (diagnostics — the injected `now`, default
   * Date.now). */
  now(): number {
    return this.clock();
  }

  /**
   * Arm the DEFERRED retry (§3.5): when the outbox still holds rows
   * whose `next_attempt_at` is in the future, feed the server's
   * retryAfterMs into the shared RetryScheduler and schedule the task
   * that re-runs the push-only fast cycle until the queue drains (a
   * failed/undrained retry loops with full-jitter backoff). No-op when
   * nothing is deferred (the normal triggers own the due-now case) or a
   * task loop is already pending.
   */
  refreshDeferredRetry(): void {
    if (this.scheduler.pending) return;
    const hint = this.host.deferredRetryHintMs();
    if (hint === null) return;
    this.scheduler.deferredRetryAfter(hint);
    this.scheduler.schedule(async () => {
      await this.host.pushNow();
      return this.host.queueDepth() === 0;
    });
  }

  /**
   * Cancel everything: the connectivity subscription, the pending
   * debounce, the periodic timer, the background task, the deferred
   * retry loop. Idempotent and safe on a never-started instance;
   * `start()` may be called again afterwards.
   */
  stop(): void {
    this.cancelDebounce();
    if (this.periodicHandle !== null) {
      this.timers.clearInterval(this.periodicHandle);
      this.periodicHandle = null;
    }
    if (this.unsubscribeConnectivity !== null) {
      this.unsubscribeConnectivity();
      this.unsubscribeConnectivity = null;
    }
    if (this.unregisterBackground !== null) {
      this.unregisterBackground();
      this.unregisterBackground = null;
    }
    this.scheduler.cancel();
    this.started = false;
  }

  // -- internals -----------------------------------------------------------------

  /** One internal (non-user) cycle: background flag rides through;
   * rejections are swallowed honestly (internal firing has no caller —
   * the host state is the observability surface). */
  private async runInternal(background: boolean, swallow: boolean): Promise<void> {
    try {
      await this.host.syncNow({ background });
      this.refreshDeferredRetry();
    } catch (error) {
      if (!swallow) throw error;
      // Internal firing has no caller to reject to — the host state is
      // the observability surface; swallow the rejection honestly.
    }
  }

  /**
   * Connectivity regained → debounce 5 s → one full cycle. Bursts
   * collapse: while a debounce is pending, further online events are
   * ignored (exactly one cycle per regained window). A drop before the
   * debounce fires cancels it (firing into a dead network is pointless).
   */
  private onConnectivityEvent(online: boolean): void {
    if (!online) {
      this.cancelDebounce();
      return;
    }
    if (this.debounceHandle !== null) return; // a debounce is already pending
    this.debounceHandle = this.timers.setTimeout(() => {
      this.debounceHandle = null;
      void this.runInternal(false, true);
    }, SYNC_CONNECTIVITY_DEBOUNCE_MS);
  }

  /**
   * The 2-min periodic tick: fire a full cycle ONLY while dirty
   * (`queueDepth() > 0`); when clean, skip and keep the timer armed (a
   * cheap poll — the queue check is one COUNT on the local store; the
   * personal class reports 0 by construction, so its tick is always a
   * no-op — its reads refresh through the background task). The host's
   * mutex skips the tick if a cycle is already running.
   */
  private onPeriodicTick(): void {
    if (this.host.queueDepth() <= 0) return;
    void this.runInternal(false, true);
  }

  private cancelDebounce(): void {
    if (this.debounceHandle === null) return;
    this.timers.clearTimeout(this.debounceHandle);
    this.debounceHandle = null;
  }
}
