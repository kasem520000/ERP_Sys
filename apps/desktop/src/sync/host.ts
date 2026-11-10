import {
  isQuarantined,
  markQueueUnresolvable,
  metaGet,
  queueStats as readQueueStats,
  runCycle,
  SyncClient,
  type CycleEvent,
  type CycleOutcome,
  type SyncTransport,
} from "@erp/sync-core";
import type { PullEnvelope, PushItemResult, PushItemResultV2 } from "@erp/contracts";

import type { DesktopSession, RotationFailure } from "../auth";
// Direct module imports (not the ../store barrel): the barrel drags in
// store/prune → ../index, widening the root-barrel dependency cycle the
// W1 layout already has — the host only needs these two exact modules.
import { pruneDesktopStore, type DesktopPruneResult } from "../store/prune";
import type { DesktopStore } from "../store/sqlite-adapter";
import type { PurgeReport } from "./revocation";
import { DesktopSessionExpiredError, DesktopSyncHttpError } from "./transport";

/**
 * PHASE-021 · the desktop sync host (T4; MASTER-PLAN §5 — BINDING; SYNC_
 * PROTOCOL §8 triggers + §9 full cycle; LOCAL_DATABASE §6.3/§6.4): a THIN
 * host over the UNMODIFIED sync-core client — `new SyncClient(store,
 * transport)` + `runCycle(client)` do all protocol work (recovery pass,
 * status gate C-08, revocation check C-06, permissions-first pull, the
 * ≤50-batch push, best-effort acks). The host owns exactly the desktop
 * concerns:
 *
 * - the **UI mirror** ({@link HostState} — phase/outcome/lastSyncAt/
 *   lastError/readOnlyReason) emitted through `onState` on every
 *   transition (the Offline Console, 2-b, renders this);
 * - the **one-in-flight mutex** — a second `syncNow()` while a cycle runs
 *   returns `{ skipped: "already-running" }`, never queues a second
 *   cycle (SYNC_PROTOCOL §8);
 * - the **session seam** — `silentRefreshIfDue()` before every cycle /
 *   fast push (15-min tokens, MASTER-PLAN §4.4); a session with no token
 *   throws {@link DesktopSessionExpiredError} (phase "error" — sync
 *   STOPS, never an anonymous request);
 * - the **C-08 contract gate mirror** — `outcome.readOnly` → phase
 *   "read-only" + `readOnlyReason: "CONTRACT_VERSION_UNSUPPORTED"` + the
 *   one-per-trip `onUpdatePrompt` hook (the updater UI listens; the
 *   shell — not the host — invokes 1-c's runUpdateCheck);
 * - the **D-01 revocation path** — `outcome.deviceRevoked`, an expired
 *   `status.device.dataExpiresAt` (SECURITY_AND_DEVICE_MANAGEMENT §6.2)
 *   or the session rotation-failure hook → STOP syncing +
 *   `markQueueUnresolvable` (mirroring cycle.ts) + phase "revoked" + the
 *   `onRevocation` hook (the shell then runs `purgeOnRevocation` and
 *   shows the re-enroll screen — the destructive purge is a first-class,
 *   audited step, not buried inside the cycle);
 * - the **post-cycle byte-exact prune** (DR-P21-03 — post-cycle, never
 *   mid-cycle) via `pruneDesktopStore`.
 *
 * Stale-server write refusal (MASTER-PLAN §5): `canWrite()` is the gate
 * 2-b's draft forms check before enabling writes (phase "read-only" ⇒
 * false). The ENFORCEMENT layer stays sync-core's `assertWritable`
 * (contract gate / D-04 watermark / quarantine → SyncReadOnlyError /
 * LocalStoreCorruptError on every enqueue) — the host state is the honest
 * UI projection of the same facts, never a second authority.
 *
 * Boot sequence for the shell (MASTER-PLAN §3): `openDesktopStore` (open
 * + migrations v1–5) → construct the session (with `onRotationFailure`
 * late-bound to `host.handleRotationFailure`) → `bridgeTransport(…)` →
 * `new SyncDesktopHost(…)` → `triggers.start()` + `triggers.onStartOrUnlock()`
 * → `host.boot()` (runCycle step 1 IS the recoveryPass — §3's boot
 * sequence completes inside the first cycle).
 */

/** The UI mirror (2-b renders this). Emitted through `onState` on every
 * transition; always readable via `host.state`. */
export interface HostState {
  /** "idle" after a clean cycle; "syncing" while one runs; "read-only"
   * when the C-08 contract gate tripped (update required); "revoked" —
   * D-01 terminal state, re-enrollment required; "corrupt" — the §6.4
   * drill must run; "error" — the last attempt failed. */
  readonly phase: "idle" | "syncing" | "read-only" | "revoked" | "corrupt" | "error";
  /** The last completed cycle's outcome (absent before the first). */
  readonly lastOutcome?: CycleOutcome;
  /** ISO timestamp of the last completed cycle / fast push. */
  readonly lastSyncAt?: string;
  /** Honest failure text for the last phase "error" (undefined = clean). */
  readonly lastError?: string;
  /** Set exactly when phase is "read-only" (C-08). */
  readonly readOnlyReason?: "CONTRACT_VERSION_UNSUPPORTED";
}

/** What `syncNow`/`boot` resolve to: an outcome when a cycle ran, or the
 * skip reason (never a queued second cycle). */
export interface SyncCycleResult {
  readonly outcome?: CycleOutcome;
  readonly skipped?: "already-running" | "revoked";
}

/** The fast-push result (`pushNow`): the drain counts, or why it was
 * refused (mutex / D-01 terminal / C-08 gate / quarantined store). */
export type PushNowResult =
  | { readonly skipped: "already-running" | "revoked" | "read-only" | "corrupt" }
  | {
      readonly skipped?: undefined;
      readonly pushed: number;
      readonly accepted: number;
      readonly rejected: number;
      readonly deferred: number;
      readonly duplicates: number;
    };

/** The sync-core outbox queue stats (engine `queueStats`). */
export interface OutboxQueueStats {
  readonly pending: number;
  readonly inFlight: number;
  readonly rejected: number;
  readonly acked: number;
}

/** How the host detected the D-01 condition. */
export interface RevocationDetection {
  /** "status" — the server's status response said revoked (the cycle
   * outcome mirrors it); "data-expiry" — `device.dataExpiresAt` is past
   * (§6.2 remote data-expiry instruction); "rotation-failure" — the
   * session's refresh exchange failed (reuse detection, M-05). */
  readonly source: "status" | "data-expiry" | "rotation-failure";
  readonly at: string;
  readonly detail?: string;
}

export interface SyncDesktopHostOptions {
  /** An OPEN, fully migrated desktop store (`openDesktopStore`). */
  readonly store: DesktopStore;
  /** The sync transport (bridgeTransport in the shell; scripted fakes in
   * tests). Consumed UNMODIFIED through sync-core's SyncClient. */
  readonly transport: SyncTransport;
  /** The memory-only device session (access tokens; silent refresh). */
  readonly session: DesktopSession;
  /** The enrolled device id (transport header + audit identity). */
  readonly deviceId: string;
  /** UI mirror subscriber — called on every state transition. */
  readonly onState?: (state: HostState) => void;
  /** C-08: fired ONCE per contract-gate trip (the updater UI listens;
   * the shell invokes 1-c's runUpdateCheck, not the host). */
  readonly onUpdatePrompt?: (reason: "CONTRACT_VERSION_UNSUPPORTED") => void;
  /** D-01: fired when revocation is detected (the shell runs
   * `purgeOnRevocation(store)` and shows the re-enroll screen). */
  readonly onRevocation?: (detection: RevocationDetection) => void;
  /** Post-cycle byte-exact prune options (DR-P21-03). Absent ⇒ the
   * default 1 GiB budget (`DESKTOP_STORAGE_BUDGET_BYTES`). */
  readonly prune?: { readonly budgetBytes?: number };
}

/**
 * The per-cycle observations the host derives from `CycleEvent`s + the
 * observed transport (runCycle already swallows per-entity failures into
 * events — the host collects them to phase honestly).
 */
interface CycleObservations {
  integrity: "ok" | "corrupt";
  errors: string[];
  contractGateCleared: boolean;
}

/** Read the D-01-relevant facts off ANY transport's status() result
 * (defensive runtime narrowing — sync-core's type only promises
 * `device?.revoked`; bridgeTransport additionally returns
 * `device.dataExpiresAt`). */
function readStatusFacts(raw: unknown): { deviceRevoked: boolean; dataExpiresAt: string | null; serverTime: string | null } {
  if (typeof raw !== "object" || raw === null) {
    return { deviceRevoked: false, dataExpiresAt: null, serverTime: null };
  }
  const record = raw as Record<string, unknown>;
  const serverTime = typeof record.serverTime === "string" ? record.serverTime : null;
  let deviceRevoked = false;
  let dataExpiresAt: string | null = null;
  const device = record.device;
  if (typeof device === "object" && device !== null) {
    const deviceRecord = device as Record<string, unknown>;
    if (deviceRecord.revoked === true) deviceRevoked = true;
    if (typeof deviceRecord.dataExpiresAt === "string" && deviceRecord.dataExpiresAt.length > 0) {
      dataExpiresAt = deviceRecord.dataExpiresAt;
    }
  }
  return { deviceRevoked, dataExpiresAt, serverTime };
}

/**
 * The transparent transport observer: wraps the injected SyncTransport
 * without changing a single byte of its behavior (optional members stay
 * optional — a 016-style transport keeps running in 016 mode through
 * runCycle) while recording what the host needs:
 *
 * - the last `status()` response (the D-01 data-expiry check reads
 *   `device.dataExpiresAt` defensively);
 * - whether any request failed with {@link DesktopSessionExpiredError}
 *   or an HTTP 401 (runCycle swallows transport errors into events /
 *   DEFERRED rows — without the flag the host could not phase honestly).
 */
class ObservingTransport implements SyncTransport {
  private lastStatusRaw: unknown = null;
  private sessionExpiredFlag = false;
  private httpUnauthorizedFlag = false;

  constructor(private readonly inner: SyncTransport) {
    if (inner.status !== undefined) {
      this.status = async () => {
        const status = await this.guard(() => inner.status!());
        this.lastStatusRaw = status;
        return status;
      };
    }
    if (inner.pushV2 !== undefined) {
      this.pushV2 = async (request: { contractVersion: string; commands: readonly Record<string, unknown>[] }) =>
        this.guard(() => inner.pushV2!(request));
    }
    if (inner.pullAck !== undefined) {
      this.pullAck = async (positions: readonly { entityType: string; cursor: string }[]) =>
        this.guard(() => inner.pullAck!(positions));
    }
    if (inner.pushAck !== undefined) {
      this.pushAck = async (commandIds: readonly string[]) => this.guard(() => inner.pushAck!(commandIds));
    }
  }

  /** Reset the per-cycle observation flags (called at cycle start). */
  beginCycle(): void {
    this.lastStatusRaw = null;
    this.sessionExpiredFlag = false;
    this.httpUnauthorizedFlag = false;
  }

  get sessionExpired(): boolean {
    return this.sessionExpiredFlag;
  }

  get httpUnauthorized(): boolean {
    return this.httpUnauthorizedFlag;
  }

  get lastStatus(): unknown {
    return this.lastStatusRaw;
  }

  private async guard<T>(operation: () => Promise<T>): Promise<T> {
    try {
      return await operation();
    } catch (error) {
      if (error instanceof DesktopSessionExpiredError) {
        this.sessionExpiredFlag = true;
      } else if (error instanceof DesktopSyncHttpError && error.status === 401) {
        this.httpUnauthorizedFlag = true;
      }
      throw error;
    }
  }

  async pull(entityType: string, cursor: string | null, limit?: number): Promise<PullEnvelope> {
    return this.guard(() => this.inner.pull(entityType, cursor, limit));
  }

  async push(batchId: string, commands: readonly Record<string, unknown>[]): Promise<PushItemResult[]> {
    return this.guard(() => this.inner.push(batchId, commands));
  }

  // Optional members are assigned in the constructor ONLY when the inner
  // transport provides them (their presence drives runCycle's v2 mode).
  declare readonly status?: () => Promise<{
    serverTime: string;
    contractVersion: string;
    suspended?: boolean;
    device?: { revoked?: boolean };
  }>;
  declare readonly pushV2?: (request: {
    contractVersion: string;
    commands: readonly Record<string, unknown>[];
  }) => Promise<PushItemResultV2[]>;
  declare readonly pullAck?: (positions: readonly { entityType: string; cursor: string }[]) => Promise<void>;
  declare readonly pushAck?: (commandIds: readonly string[]) => Promise<void>;
}

/** The desktop sync host. See the module header for the boot sequence. */
export class SyncDesktopHost {
  private readonly options: SyncDesktopHostOptions;
  private readonly observed: ObservingTransport;
  private readonly client: SyncClient;
  private currentState: HostState = { phase: "idle" };
  private cycleRunning = false;
  private revocationHandled = false;
  private gatePromptFired = false;
  private observations: CycleObservations = { integrity: "ok", errors: [], contractGateCleared: false };
  private lastPurgeReport: PurgeReport | null = null;
  private lastPruneResult: DesktopPruneResult | null = null;
  private pruneErrorMessage: string | null = null;

  constructor(options: SyncDesktopHostOptions) {
    if (!options.store.isOpen) {
      throw new Error("SyncDesktopHost: the store must be OPEN (openDesktopStore) before the host is constructed");
    }
    if (typeof options.deviceId !== "string" || options.deviceId.length === 0) {
      throw new Error("SyncDesktopHost: deviceId must be a non-empty string (the enrolled device id)");
    }
    this.options = options;
    // The UNMODIFIED sync-core client over the observed transport — every
    // protocol decision stays inside runCycle/SyncClient (MASTER-PLAN §5).
    this.observed = new ObservingTransport(options.transport);
    this.client = new SyncClient(options.store, this.observed);
  }

  /** The current UI mirror (a fresh copy — safe to render). */
  get state(): HostState {
    return { ...this.currentState };
  }

  /** The last D-01 purge report if the shell already ran one (recorded
   * via `recordRevocationPurge`) — null otherwise. */
  get lastPurge(): PurgeReport | null {
    return this.lastPurgeReport;
  }

  /** The last post-cycle byte-exact prune result (DR-P21-03). */
  get lastPrune(): DesktopPruneResult | null {
    return this.lastPruneResult;
  }

  /** A prune failure (maintenance never fails the cycle — recorded
   * honestly for the UI/support). */
  get lastPruneError(): string | null {
    return this.pruneErrorMessage;
  }

  /** The C-08 read-only reason, exactly when phase is "read-only". */
  get readOnlyReason(): "CONTRACT_VERSION_UNSUPPORTED" | undefined {
    return this.currentState.readOnlyReason;
  }

  /**
   * The local-write gate 2-b checks before enabling draft forms (MASTER-
   * PLAN §5 stale-server rule): false while read-only (C-08), revoked
   * (D-01) or corrupt (§6.4). NOT the enforcement layer — sync-core's
   * `assertWritable` stays authoritative on every enqueue.
   */
  canWrite(): boolean {
    const phase = this.currentState.phase;
    return phase !== "read-only" && phase !== "revoked" && phase !== "corrupt";
  }

  /** Dirty outbox depth: QUEUED + IN_FLIGHT commands (the periodic
   * trigger's "while dirty" check — SYNC_PROTOCOL §8). */
  queueDepth(): number {
    const stats = this.queueStats();
    return stats.pending + stats.inFlight;
  }

  /** The full outbox queue stats (sync-core engine `queueStats`). */
  queueStats(): OutboxQueueStats {
    return readQueueStats(this.options.store);
  }

  /**
   * Boot cycle (MASTER-PLAN §3's recovery step lives INSIDE runCycle —
   * step 1 is the recoveryPass; the store is already migrated by
   * `openDesktopStore`). Same path as `syncNow`; returns the outcome.
   */
  async boot(): Promise<SyncCycleResult> {
    return this.runGuardedCycle();
  }

  /**
   * Manual full cycle. One in flight at a time: a call while a cycle runs
   * returns `{ skipped: "already-running" }` (never queues); after D-01
   * every call returns `{ skipped: "revoked" }` until re-enrollment
   * constructs a fresh host. A session with no token REJECTS with
   * {@link DesktopSessionExpiredError} (phase "error") — sync stops, no
   * anonymous request is ever fired.
   */
  async syncNow(): Promise<SyncCycleResult> {
    return this.runGuardedCycle();
  }

  /**
   * Post-write fast push (SYNC_PROTOCOL §8 "After local write"): drains
   * the outbox through the v2 wire (`client.pushAllV2()` — no pull) when
   * the transport has `pushV2`, else the 016 `pushAll()`. Refused — never
   * attempted — while another cycle runs, after D-01, while the C-08 gate
   * is tripped, or on a quarantined store.
   */
  async pushNow(): Promise<PushNowResult> {
    if (this.revocationHandled) return { skipped: "revoked" };
    if (this.cycleRunning) return { skipped: "already-running" };
    if (metaGet(this.options.store, "contractGate") === "read-only") {
      return { skipped: "read-only" };
    }
    if (isQuarantined(this.options.store)) {
      return { skipped: "corrupt" };
    }
    this.cycleRunning = true;
    try {
      await this.ensureSession();
      if (this.revocationHandled) return { skipped: "revoked" };
      this.observed.beginCycle();
      if (this.options.transport.pushV2 !== undefined) {
        const result = await this.client.pushAllV2();
        this.finishFastPush();
        return {
          pushed: result.pushed,
          accepted: result.accepted,
          rejected: result.rejected,
          deferred: result.deferred,
          duplicates: result.duplicates,
        };
      }
      const legacy = await this.client.pushAll();
      this.finishFastPush();
      return {
        pushed: legacy.pushed,
        accepted: legacy.accepted,
        rejected: legacy.rejected,
        deferred: legacy.deferred,
        duplicates: 0,
      };
    } catch (error) {
      this.failCycle(error);
      throw error;
    } finally {
      this.cycleRunning = false;
    }
  }

  /**
   * The D-01 hook for `DesktopSession`'s `onRotationFailure` (the shell
   * wires it at session construction — a late-binding closure around this
   * host). `ROTATION_FAILED` (the reuse-detection signal, M-05: the
   * session's contract says a failed rotation is always terminal) runs
   * the D-01 path: STOP syncing + queue unresolvable + phase "revoked" +
   * the `onRevocation` hook. `NO_CREDENTIAL` is NOT a revocation (never
   * enrolled / already purged): the session-expired path owns that state
   * — the next cycle's token check throws DesktopSessionExpiredError.
   */
  handleRotationFailure(failure: RotationFailure): void {
    if (failure.kind === "NO_CREDENTIAL") return;
    this.enterRevokedState(
      "rotation-failure",
      `credential rotation failed (${String(failure.error)}) — refresh-token reuse detection revokes the device (M-05/D-01)`,
    );
  }

  /**
   * Record a D-01 purge the shell executed (observability for the UI —
   * `host.lastPurge` renders the "local data purged" state).
   */
  recordRevocationPurge(report: PurgeReport): void {
    this.lastPurgeReport = report;
  }

  // -- internals -----------------------------------------------------------------

  private async runGuardedCycle(): Promise<SyncCycleResult> {
    if (this.revocationHandled) return { skipped: "revoked" };
    if (this.cycleRunning) return { skipped: "already-running" };
    this.cycleRunning = true; // set synchronously — the one-in-flight mutex
    try {
      await this.ensureSession();
      if (this.revocationHandled) return { skipped: "revoked" };
      this.observed.beginCycle();
      this.observations = { integrity: "ok", errors: [], contractGateCleared: false };
      this.patchState({ phase: "syncing" });
      const outcome = await runCycle(this.client, {
        onEvent: (event) => this.onCycleEvent(event),
      });
      this.finishCycle(outcome);
      return { outcome };
    } catch (error) {
      this.failCycle(error);
      throw error;
    } finally {
      this.cycleRunning = false;
    }
  }

  /**
   * Acquire a current access token (expiry−60 s silent refresh, §4.4).
   * A session with no credential rejects with DesktopSessionExpiredError
   * (phase "error" via failCycle) — never an anonymous cycle. A rotation
   * failure already ran the D-01 path through handleRotationFailure (the
   * session fires the hook BEFORE rethrowing) — in that case the cycle is
   * skipped as revoked instead.
   */
  private async ensureSession(): Promise<void> {
    let token: string | null;
    try {
      token = await this.options.session.silentRefreshIfDue();
    } catch (error) {
      if (this.revocationHandled) return;
      throw error;
    }
    if (token === null || this.options.session.current() === null) {
      throw new DesktopSessionExpiredError(
        "the device session holds no access token (no refresh credential — never enrolled, purged, or logged out); " +
          "sync stops rather than sending anonymous requests (SECURITY_AND_DEVICE_MANAGEMENT §3)",
      );
    }
  }

  private onCycleEvent(event: CycleEvent): void {
    switch (event.type) {
      case "recovery":
        this.observations.integrity = event.integrity;
        break;
      case "statusError":
        this.observations.errors.push(`status: ${event.message}`);
        break;
      case "pullError":
        this.observations.errors.push(`pull ${event.entityType}: ${event.message}`);
        break;
      case "pushError":
        this.observations.errors.push(`push: ${event.message}`);
        break;
      case "contractGateCleared":
        this.observations.contractGateCleared = true;
        break;
      default:
        break; // status/pullPage/resync/ack/deviceRevoked/contractGate —
        // no host-side effect beyond the outcome + observed status.
    }
  }

  private finishCycle(outcome: CycleOutcome): void {
    const at = new Date().toISOString();

    // §6.4 corruption: runCycle returned early (quarantined store) — the
    // shell must run the recoverCorruptStore drill before anything else.
    if (this.observations.integrity === "corrupt") {
      this.patchState({
        phase: "corrupt",
        lastOutcome: outcome,
        lastSyncAt: at,
        lastError:
          "local store quarantined (integrity check failed) — the LOCAL_DATABASE §6.4 corruption path must run (recoverCorruptStore)",
        readOnlyReason: undefined,
      });
      return;
    }

    // D-01: the status response said revoked (runCycle mirrored it into
    // outcome.deviceRevoked + markQueueUnresolvable), or the remote
    // data-expiry watermark passed (§6.2 — server time is authoritative).
    const facts = readStatusFacts(this.observed.lastStatus);
    const dataExpiryPast =
      facts.dataExpiresAt !== null &&
      Date.parse(facts.dataExpiresAt) <= Date.parse(facts.serverTime ?? new Date().toISOString());
    if (outcome.deviceRevoked || facts.deviceRevoked || dataExpiryPast) {
      const detail =
        outcome.deviceRevoked || facts.deviceRevoked
          ? "the server reports this device as revoked (D-01) — syncing stopped; purge local tenant data and re-enroll"
          : "the device's remote data-expiry watermark passed (SECURITY_AND_DEVICE_MANAGEMENT §6.2) — purge local tenant data and re-enroll";
      this.enterRevokedState(outcome.deviceRevoked || facts.deviceRevoked ? "status" : "data-expiry", detail, outcome, at);
      return;
    }

    // C-08: the contract gate tripped — read-only, honest banner + the
    // one-per-trip update prompt. No push happened (runCycle stopped).
    if (outcome.readOnly) {
      this.patchState({
        phase: "read-only",
        lastOutcome: outcome,
        lastSyncAt: at,
        lastError: undefined,
        readOnlyReason: "CONTRACT_VERSION_UNSUPPORTED",
      });
      if (!this.gatePromptFired) {
        this.gatePromptFired = true;
        this.options.onUpdatePrompt?.("CONTRACT_VERSION_UNSUPPORTED");
      }
      return;
    }

    // The gate cleared this cycle (server fixed): re-arm the prompt.
    if (this.observations.contractGateCleared) {
      this.gatePromptFired = false;
    }

    // Session death mid-cycle: runCycle swallowed the transport errors
    // into events/DEFERRED rows — the observed flag phases it honestly.
    const sessionDead = this.observed.sessionExpired || this.observed.httpUnauthorized;
    const firstError = this.observations.errors[0];
    this.patchState({
      phase: sessionDead || firstError !== undefined ? "error" : "idle",
      lastOutcome: outcome,
      lastSyncAt: at,
      lastError: sessionDead
        ? "session-expired: the access token was rejected mid-cycle (HTTP 401 / no token) — silent refresh or re-enrollment required"
        : firstError,
      readOnlyReason: undefined,
    });
    this.runPostCyclePrune();
  }

  private finishFastPush(): void {
    const sessionDead = this.observed.sessionExpired || this.observed.httpUnauthorized;
    this.patchState({
      lastSyncAt: new Date().toISOString(),
      ...(sessionDead
        ? {
            phase: "error" as const,
            lastError:
              "session-expired: the access token was rejected during the fast push — silent refresh or re-enrollment required",
          }
        : {}),
    });
  }

  /** The D-01 terminal path: stop syncing + queue unresolvable (mirrors
   * cycle.ts's markQueueUnresolvable — idempotent) + phase "revoked" +
   * the shell's onRevocation hook (purge + re-enroll UX). */
  private enterRevokedState(
    source: RevocationDetection["source"],
    detail: string,
    outcome?: CycleOutcome,
    at?: string,
  ): void {
    if (!this.revocationHandled) {
      this.revocationHandled = true;
      markQueueUnresolvable(this.options.store, "DEVICE_REVOKED");
      this.options.onRevocation?.({ source, at: at ?? new Date().toISOString(), detail });
    }
    this.patchState({
      phase: "revoked",
      ...(outcome === undefined ? {} : { lastOutcome: outcome }),
      ...(at === undefined ? {} : { lastSyncAt: at }),
      lastError: detail,
      readOnlyReason: undefined,
    });
  }

  private failCycle(error: unknown): void {
    const lastError =
      error instanceof DesktopSessionExpiredError
        ? `session-expired: ${error.message}`
        : error instanceof DesktopSyncHttpError && error.status === 401
          ? "session-expired: the server rejected the access token (HTTP 401) — silent refresh or re-enrollment required"
          : `sync failed: ${String(error)}`;
    this.patchState({ phase: "error", lastError });
  }

  /** DR-P21-03: the byte-exact prune runs POST-cycle (never mid-cycle);
   * a maintenance failure never fails the cycle — it is recorded. */
  private runPostCyclePrune(): void {
    try {
      this.pruneErrorMessage = null;
      this.lastPruneResult = pruneDesktopStore(
        this.options.store,
        this.options.prune === undefined ? undefined : { budgetBytes: this.options.prune.budgetBytes },
      );
    } catch (error) {
      this.lastPruneResult = null;
      this.pruneErrorMessage = String(error);
    }
  }

  private patchState(patch: Partial<HostState>): void {
    this.currentState = { ...this.currentState, ...patch };
    this.options.onState?.({ ...this.currentState });
  }
}
