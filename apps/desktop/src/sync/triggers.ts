import type { DesktopBridge } from "../bridge/contract";
import type { SyncDesktopHost } from "./host";

/**
 * PHASE-021 · the desktop sync triggers (T4; MASTER-PLAN §5 — BINDING;
 * SYNC_PROTOCOL §8 trigger table): the shell-facing cadence that drives
 * the host. All five §8 rows:
 *
 * | Trigger | Behavior |
 * |---------|----------|
 * | App start / unlock | `onStartOrUnlock()` → full `host.syncNow()` (runCycle's step 1 IS the recovery pass) |
 * | Connectivity regained | bridge `connectivity.onChange(online)` → 5 s debounce → full cycle (bursts collapse to ONE cycle; a drop before the debounce fires cancels it) |
 * | Periodic while dirty | every 2 min: `queueDepth() > 0` → full cycle; clean → skip, the timer stays armed (cheap poll) |
 * | After local write | `onLocalWrite()` → `host.pushNow()` (push-only fast cycle — no pull) |
 * | Manual | `onManualSync()` → full `host.syncNow()` |
 *
 * Double-fire safety: the triggers never queue work themselves — the
 * HOST's one-in-flight mutex is the guard (a trigger firing while a cycle
 * runs is skipped by the host, §8 "One in-flight cycle at a time").
 *
 * Timer seams are fully injectable (`timers` — the four primitives — plus
 * `now`) so the suite drives the debounces/ticks deterministically without
 * host-level fake timers.
 */

/** SYNC_PROTOCOL §8: connectivity-regained debounce. */
export const SYNC_CONNECTIVITY_DEBOUNCE_MS = 5_000;

/** SYNC_PROTOCOL §8 (foreground desktop): periodic-while-dirty interval. */
export const SYNC_PERIODIC_INTERVAL_MS = 120_000;

/** An opaque timer handle (Node Timeout, browser id, or the test double's). */
export type SyncTimerHandle = unknown;

/** The four timer primitives the trigger set needs (MASTER-PLAN §5;
 * SYNC_PROTOCOL §8) — injectable so the suite drives the 5 s debounce and
 * the 2-min tick deterministically. */
export interface SyncTimers {
  setInterval(callback: () => void, ms: number): SyncTimerHandle;
  clearInterval(handle: SyncTimerHandle): void;
  setTimeout(callback: () => void, ms: number): SyncTimerHandle;
  clearTimeout(handle: SyncTimerHandle): void;
}

/** The default timer suite — the Node/browser globals. */
export const globalSyncTimers: SyncTimers = {
  setInterval: (callback, ms) => setInterval(callback, ms),
  clearInterval: (handle) => clearInterval(handle as Parameters<typeof clearInterval>[0]),
  setTimeout: (callback, ms) => setTimeout(callback, ms),
  clearTimeout: (handle) => clearTimeout(handle as Parameters<typeof clearTimeout>[0]),
};

export interface SyncTriggersOptions {
  readonly host: SyncDesktopHost;
  /** The bridge connectivity member, or null when the shell reports no
   * connectivity signal (the other triggers still work). */
  readonly bridge: Pick<DesktopBridge, "connectivity"> | null;
  /** Injectable timers (default: the global setInterval/clearInterval/
   * setTimeout/clearTimeout). */
  readonly timers?: SyncTimers;
  /** Injectable clock (default: Date.now) — diagnostics + tests. */
  readonly now?: () => number;
}

/** The §8 trigger set over a {@link SyncDesktopHost}. */
export class SyncTriggers {
  private readonly host: SyncDesktopHost;
  private readonly bridge: Pick<DesktopBridge, "connectivity"> | null;
  private readonly clock: () => number;
  private readonly timers: SyncTimers;

  private unsubscribeConnectivity: (() => void) | null = null;
  private debounceHandle: SyncTimerHandle | null = null;
  private periodicHandle: SyncTimerHandle | null = null;
  private started = false;

  constructor(options: SyncTriggersOptions) {
    this.host = options.host;
    this.bridge = options.bridge;
    this.clock = options.now ?? (() => Date.now());
    this.timers = options.timers ?? globalSyncTimers;
  }

  /**
   * Arm the background cadence: subscribe to the bridge connectivity
   * signal + start the periodic-while-dirty timer. Idempotent (a second
   * call is a no-op). The app-start/unlock trigger is NOT armed here —
   * the shell calls {@link onStartOrUnlock} explicitly at boot/unlock.
   */
  start(): void {
    if (this.started) return;
    this.started = true;
    if (this.bridge !== null) {
      this.unsubscribeConnectivity = this.bridge.connectivity.onChange((online) => {
        this.onConnectivityEvent(online);
      });
    }
    this.periodicHandle = this.timers.setInterval(() => {
      this.onPeriodicTick();
    }, SYNC_PERIODIC_INTERVAL_MS);
  }

  /**
   * §8 "App start / unlock": one full cycle (the host's runCycle runs the
   * recovery pass first, then status → pull → push → acks). Rejections
   * (e.g. DesktopSessionExpiredError) propagate to the caller — the shell
   * owns that UX; the host state is always recorded.
   */
  async onStartOrUnlock(): Promise<void> {
    await this.host.syncNow();
  }

  /**
   * §8 "After local write": the push-only fast cycle for interactive
   * feedback (drafts). No pull — the offline console's cached reads stay
   * as-is until the next full cycle.
   */
  async onLocalWrite(): Promise<void> {
    await this.host.pushNow();
  }

  /** §8 "Manual": the user-initiated sync-now (per-item results + typed
   * rejections render from the host state). */
  async onManualSync(): Promise<void> {
    await this.host.syncNow();
  }

  /** The trigger clock (diagnostics — the injected `now`, default
   * Date.now): used to timestamp when the cadence last fired. */
  now(): number {
    return this.clock();
  }

  /**
   * Cancel everything: the connectivity subscription, the pending
   * debounce, the periodic timer. Idempotent and safe on a never-started
   * instance; `start()` may be called again afterwards.
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
    this.started = false;
  }

  // -- internals -----------------------------------------------------------------

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
      // Internal firing has no caller to reject to — the host state is
      // the observability surface; swallow the rejection honestly.
      void this.host.syncNow().catch(() => undefined);
    }, SYNC_CONNECTIVITY_DEBOUNCE_MS);
  }

  /**
   * §8 periodic tick: fire a full cycle ONLY while dirty
   * (`queueDepth() > 0`); when clean, skip and keep the timer armed (a
   * cheap poll — the queue check is one COUNT round-trip on the local
   * store). The host's mutex skips the tick if a cycle is already
   * running.
   */
  private onPeriodicTick(): void {
    if (this.host.queueDepth() <= 0) return;
    void this.host.syncNow().catch(() => undefined);
  }

  private cancelDebounce(): void {
    if (this.debounceHandle === null) return;
    this.timers.clearTimeout(this.debounceHandle);
    this.debounceHandle = null;
  }
}
