import {
  applyPullBatch,
  isQuarantined,
  LocalStoreCorruptError,
  maintainCursorCount,
  markQueueUnresolvable,
  metaDelete,
  metaGet,
  metaSet,
  queueStats as readQueueStats,
  readCursor,
  rejectedCommands as readRejectedCommands,
  runCycle,
  writePermissionWatermark,
  SyncClient,
  type CycleEvent,
  type CycleOutcome,
  type PullAppliers,
  type StorageAdapter,
  type SyncTransport,
} from "@erp/sync-core";
import {
  isContractSupported as isSupportedContract,
  type PullEnvelope,
  type PushItemResult,
  type PushItemResultV2,
} from "@erp/contracts";

// Direct module imports (not the ../store barrel — the desktop host
// precedent: pull only the exact modules this file needs, keeping the
// import surface flat).
import { pruneMobileStore, type MobilePruneResult } from "../store/prune";
import type { MobileStore } from "../store/store";
import type { PurgeReport } from "./revocation";
import {
  MobileSessionExpiredError,
  MobileSyncHttpError,
  type AccessTokenProvider,
  type TransportBudgetController,
  type TransportBudgetProfile,
  FIELD_FOREGROUND_BUDGET,
  PERSONAL_BACKGROUND_BUDGET,
  PERSONAL_FOREGROUND_BUDGET,
} from "./transport";

/**
 * PHASE-022 · the mobile sync host (T2-a; MASTER-PLAN §7 — BINDING;
 * DR-P22-08): a THIN host over the UNMODIFIED sync-core client —
 * `new SyncClient(store, transport)` + `runCycle(client)` do all
 * protocol work for the android-field profile (recovery pass, status
 * gate C-08, revocation check C-06, permissions-first pull, the
 * ≤ 50-batch push, best-effort acks). The host owns exactly the mobile
 * concerns:
 *
 * - the **per-class cycle profile** (the ONE app's TWO experiences):
 *   android-field runs the full `runCycle` (pull + push, all entities
 *   in its feed group); android-personal runs the host's PULL-ONLY
 *   cycle — status gate → permissions watermark → per-entity pulls →
 *   pullAck — with the push path HARD-GUARDED unreachable (three
 *   layers: `pushNow()` refuses `{ skipped: "pull-only" }`; the
 *   `PersonalGuardTransport` wrapper makes push/pushV2 THROW; and the
 *   personal store has no outbox table, so any enqueue attempt fails
 *   loudly at the engine level — LOCAL_DATABASE §1.1 rule 2 by
 *   construction, DR-P22-08b);
 * - the **mobile feed materialization seam**: sync-core's `posAppliers`
 *   (fixed inside runCycle, unmodifiable) only projects the POS subset
 *   — the 022 feed entities (van_stocks / routes / settlement_templates
 *   / statements / sales_invoices / receipts / notifications) are
 *   projected onto this store's tables by `MOBILE_FEED_APPLIERS`
 *   below. For the field profile the projection rides the
 *   `FieldMaterializingTransport` wrapper (each pulled page is applied
 *   in ONE version-guarded transaction before the envelope returns to
 *   runCycle, which owns the authoritative cursor advance — the
 *   desktop precedent: pull feeds outside posAppliers' switch never
 *   materialize rows; the mobile caches are PULL-populated by design,
 *   MASTER-PLAN §8's "cached snapshots" + the personal read models);
 *   the personal cycle applies them through `applyPullBatch` directly
 *   (rows + cursor atomic);
 * - the **UI mirror** ({@link HostState}) emitted through `onState` on
 *   every transition (idle/syncing/read-only/revoked/corrupt/error);
 * - the **one-in-flight mutex** — a second call while a cycle runs
 *   returns `{ skipped: "already-running" }`, never queues;
 * - the **C-08 contract gate mirror** — read-only phase + the
 *   one-per-trip `onUpdatePrompt` hook (the release-policy UI listens);
 * - the **D-01 revocation path** — the status response's revoked flag,
 *   an expired `device.dataExpiresAt` (§6.2), field only:
 *   `markQueueUnresolvable` (personal has no queue to mark — its D-01
 *   is the purge + re-enroll) + phase "revoked" + the `onRevocation`
 *   hook (the shell then runs `purgeOnRevocation` and shows the
 *   re-enroll screen);
 * - the **per-cycle transport budget** (the client-side enforcement —
 *   field pull ≤ 8 MB / push ≤ 2 MB; personal background pull ≤ 256 KB)
 *   armed through the optional `budget.controller` (the shell wires the
 *   `MobileHttpTransport`'s own guard);
 * - the **post-cycle byte-exact prune** (the DR-P21-03 port, 128 MB —
 *   post-cycle, never mid-cycle);
 * - the **§6.4 full-pull flag**: the corruption drill sets
 *   `meta.fullPullPending`; a successful cycle with pulls > 0 clears
 *   it (the host's only write to that key).
 *
 * Stale-server write refusal: `canWrite()` is the gate the flow layer
 * checks before enabling writes (false while read-only/revoked/corrupt,
 * and ALWAYS false for the personal class — zero write affordances by
 * construction). The ENFORCEMENT layer stays sync-core's
 * `assertWritable` + the missing-outbox-table throw.
 */

// -- the mobile feed appliers (the app-side pull projections) --------------------
//
// sync-core's posAppliers (fixed inside runCycle) projects the POS
// subset only; these appliers cover the 022 feed entities — every
// column mirrors the LITE payload contracts
// (packages/contracts/src/sync/feed-projections.ts + the 020
// sales-invoice header projection), money/qty as TEXT decimal strings
// (ADR-0009), JSON lists (customers/entries/aging/title/body) stored as
// TEXT, the raw feed document in `payload`, the server row `version`,
// and the feed's changedAt as `updated_at`.

/** The field-profile feed entity types this store materializes (the
 * group's new subset — the POS base rides sync-core's posAppliers). */
export const MOBILE_FIELD_FEED_TYPES: readonly string[] = [
  "van_stocks",
  "routes",
  "settlement_templates",
  "statements",
];

/** The personal-profile feed entity types (the whole group). */
export const PERSONAL_FEED_TYPES: readonly string[] = [
  "statements",
  "sales_invoices",
  "receipts",
  "notifications",
];

const asText = (value: unknown): string => (typeof value === "string" ? value : String(value ?? ""));
const asNullableText = (value: unknown): string | null =>
  value === undefined || value === null ? null : asText(value);
const asJsonText = (value: unknown): string => JSON.stringify(value ?? null);

/** The mobile feed appliers — the app-side `PullAppliers` for the 022
 * entity types (+ the permissions watermark for the personal cycle,
 * where runCycle's posAppliers is not on the path). */
export const MOBILE_FEED_APPLIERS: PullAppliers & {
  readVersion: (adapter: StorageAdapter, entityType: string, id: string) => number | null;
} = {
  upsert(adapter: StorageAdapter, entityType: string, payload: Record<string, unknown>, version: number | null = null): void {
    switch (entityType) {
      case "permissions":
        // The personal pull-only cycle's watermark (runCycle's
        // posAppliers does this for the field cycle).
        writePermissionWatermark(adapter, payload.snapshotAt);
        return;
      case "van_stocks": {
        const id = asText(payload.id);
        if (id === "") return;
        adapter.run(
          `INSERT OR REPLACE INTO van_stocks (id, warehouse_id, item_id, batch_id, qty, value,
              refreshed_at, payload, version, updated_at, dirty)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0)`,
          [
            id,
            asText(payload.warehouseId),
            asText(payload.itemId),
            asNullableText(payload.batchId),
            asText(payload.qty),
            asText(payload.value),
            asNullableText(payload.refreshedAt),
            asJsonText(payload),
            version,
            asNullableText(payload.changedAt),
          ],
        );
        return;
      }
      case "routes": {
        const id = asText(payload.id);
        if (id === "") return;
        adapter.run(
          `INSERT OR REPLACE INTO routes (id, code, name, name_ar, sales_rep_id, van_warehouse_id,
              day_pattern, status, customers, payload, version, updated_at, dirty)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0)`,
          [
            id,
            asText(payload.code),
            asText(payload.name),
            asNullableText(payload.nameAr),
            asNullableText(payload.salesRepId),
            asNullableText(payload.vanWarehouseId),
            asJsonText(payload.dayPattern),
            asText(payload.status ?? "ACTIVE"),
            asJsonText(payload.customers ?? []),
            asJsonText(payload),
            version,
            asNullableText(payload.changedAt),
          ],
        );
        return;
      }
      case "settlement_templates": {
        const id = asText(payload.id);
        if (id === "") return;
        adapter.run(
          `INSERT OR REPLACE INTO settlement_templates (id, settlement_no, sales_rep_id, van_warehouse_id,
              shift_id, settlement_date, status, opening_cash, cash_sales, collections, cash_refunds,
              rep_expenses, expected_cash, counted_cash, variance, variance_direction, deposit_amount,
              payload, version, updated_at, dirty)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0)`,
          [
            id,
            asNullableText(payload.settlementNo),
            asText(payload.salesRepId),
            asNullableText(payload.vanWarehouseId),
            asNullableText(payload.shiftId),
            asNullableText(payload.settlementDate),
            asText(payload.status ?? "DRAFT"),
            asNullableText(payload.openingCash),
            asNullableText(payload.cashSales),
            asNullableText(payload.collections),
            asNullableText(payload.cashRefunds),
            asNullableText(payload.repExpenses),
            asNullableText(payload.expectedCash),
            asNullableText(payload.countedCash),
            asNullableText(payload.variance),
            asNullableText(payload.varianceDirection),
            asNullableText(payload.depositAmount),
            asJsonText(payload),
            version,
            asNullableText(payload.changedAt),
          ],
        );
        return;
      }
      case "statements": {
        // StatementLite: no `id` in the payload — the change row's id IS
        // the partner id (the permissions-snapshot pattern); the LRU
        // stamp is generatedAt (the snapshot generation time).
        const id = asText(payload.partnerId);
        if (id === "") return;
        adapter.run(
          `INSERT OR REPLACE INTO statements (id, customer_code, customer_name, customer_name_ar,
              as_of, currency_code, opening_balance, closing_balance, closing_balance_base, aging,
              entries, generated_at, payload, version, updated_at, dirty)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0)`,
          [
            id,
            asText(payload.customerCode),
            asText(payload.customerName),
            asNullableText(payload.customerNameAr),
            asNullableText(payload.asOf),
            asNullableText(payload.currencyCode),
            asNullableText(payload.openingBalance),
            asNullableText(payload.closingBalance),
            asNullableText(payload.closingBalanceBase),
            asJsonText(payload.aging ?? {}),
            asJsonText(payload.entries ?? []),
            asNullableText(payload.generatedAt),
            asJsonText(payload),
            version,
            asNullableText(payload.generatedAt),
          ],
        );
        return;
      }
      case "sales_invoices": {
        const id = asText(payload.id);
        if (id === "") return;
        adapter.run(
          `INSERT OR REPLACE INTO sales_invoices (id, invoice_no, status, kind, channel, customer_id,
              order_date, total_amount, currency, owner_device_id, payload, version, updated_at, dirty)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0)`,
          [
            id,
            asNullableText(payload.invoiceNo),
            asText(payload.status ?? "DRAFT"),
            asNullableText(payload.kind),
            asNullableText(payload.channel),
            asNullableText(payload.customerId),
            asNullableText(payload.orderDate),
            asNullableText(payload.totalAmount),
            asNullableText(payload.currency),
            asNullableText(payload.ownerDeviceId),
            asJsonText(payload),
            version,
            asNullableText(payload.changedAt),
          ],
        );
        return;
      }
      case "receipts": {
        const id = asText(payload.id);
        if (id === "") return;
        adapter.run(
          `INSERT OR REPLACE INTO receipts (id, receipt_no, status, partner_id, method, currency_code,
              amount, value_date, reference, posted_at, payload, version, updated_at, dirty)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0)`,
          [
            id,
            asNullableText(payload.receiptNo),
            asText(payload.status ?? "DRAFT"),
            asNullableText(payload.partnerId),
            asNullableText(payload.method),
            asNullableText(payload.currencyCode),
            asNullableText(payload.amount),
            asNullableText(payload.valueDate),
            asNullableText(payload.reference),
            asNullableText(payload.postedAt),
            asJsonText(payload),
            version,
            asNullableText(payload.changedAt),
          ],
        );
        return;
      }
      case "notifications": {
        const id = asText(payload.id);
        if (id === "") return;
        adapter.run(
          `INSERT OR REPLACE INTO notifications (id, user_id, category, severity, title, body,
              action_label, action_url, read_at, payload, version, updated_at, dirty)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0)`,
          [
            id,
            asNullableText(payload.userId),
            asNullableText(payload.category),
            asNullableText(payload.severity),
            asJsonText(payload.title),
            asJsonText(payload.body),
            asJsonText(payload.actionLabel),
            asNullableText(payload.actionUrl),
            asNullableText(payload.readAt),
            asJsonText(payload),
            version,
            asNullableText(payload.changedAt),
          ],
        );
        return;
      }
      default:
        return; // not a mobile-projected type — posAppliers' territory
    }
  },

  remove(adapter: StorageAdapter, entityType: string, id: string): void {
    switch (entityType) {
      case "permissions":
        return; // no local row — a permissions DELETE is a no-op
      case "van_stocks":
      case "routes":
      case "settlement_templates":
      case "statements":
      case "sales_invoices":
      case "receipts":
      case "notifications":
        adapter.run(`DELETE FROM ${entityType} WHERE id = ?`, [id]);
        return;
      default:
        return;
    }
  },

  readVersion(adapter: StorageAdapter, entityType: string, id: string): number | null {
    switch (entityType) {
      case "van_stocks":
      case "routes":
      case "settlement_templates":
      case "statements":
      case "sales_invoices":
      case "receipts":
      case "notifications": {
        const row = adapter.get(`SELECT version FROM ${entityType} WHERE id = ?`, [id]);
        if (row === undefined || row.version === undefined || row.version === null) return null;
        return Number(row.version);
      }
      default:
        return null;
    }
  },
};

/** The field-profile feed types this store materializes on pull. */
const FIELD_MATERIALIZE_TYPES = new Set<string>(MOBILE_FIELD_FEED_TYPES);

/**
 * The field-profile transport wrapper: observes status/session-expiry/
 * 401 (the desktop ObservingTransport) AND materializes the field feed
 * types' pulled pages into the store — ONE version-guarded transaction
 * per page, applied BEFORE the envelope returns to runCycle (which owns
 * the authoritative cursor advance + the POS-subset projection; a crash
 * between the two re-pulls the page, which is idempotent by primary
 * key — LOCAL_DATABASE §2's whole design).
 */
class FieldMaterializingTransport implements SyncTransport {
  private lastStatusRaw: unknown = null;
  private sessionExpiredFlag = false;
  private httpUnauthorizedFlag = false;

  constructor(
    private readonly inner: SyncTransport,
    private readonly store: MobileStore,
  ) {
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

  async pull(entityType: string, cursor: string | null, limit?: number): Promise<PullEnvelope> {
    const envelope = await this.guard(() => this.inner.pull(entityType, cursor, limit));
    if (FIELD_MATERIALIZE_TYPES.has(entityType) && envelope.changes.length > 0) {
      if (isQuarantined(this.store)) {
        // Never silent — runCycle returns before pulling on a
        // quarantined store, so reaching here means a stale flag raced
        // the cycle start; loud is the honest answer.
        throw new LocalStoreCorruptError(
          `materialize refused: store quarantined (entityType ${entityType}) — run the LOCAL_DATABASE §6.4 corruption path`,
        );
      }
      this.store.transaction(() => {
        for (const change of envelope.changes) {
          if (change.op === "DELETE") {
            MOBILE_FEED_APPLIERS.remove(this.store, entityType, change.id);
            continue;
          }
          if (change.payload === null) continue;
          const version = change.version ?? null;
          if (version !== null) {
            const local = MOBILE_FEED_APPLIERS.readVersion(this.store, entityType, change.id);
            if (local !== null && version <= local) continue; // stale — skip
          }
          MOBILE_FEED_APPLIERS.upsert(this.store, entityType, change.payload, version);
        }
      });
    }
    return envelope;
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

  private async guard<T>(operation: () => Promise<T>): Promise<T> {
    try {
      return await operation();
    } catch (error) {
      if (error instanceof MobileSessionExpiredError) {
        this.sessionExpiredFlag = true;
      } else if (error instanceof MobileSyncHttpError && error.status === 401) {
        this.httpUnauthorizedFlag = true;
      }
      throw error;
    }
  }
}

/**
 * The personal-profile transport wrapper: the same status/session/401
 * observation plus the NO-PUSH HARD GUARD — `push` and `pushV2` THROW
 * (`LOCAL_DATABASE §1.1 rule 2`). The host never calls them; the guard
 * exists so that NO code path can ever reach the push wire for the
 * personal class (a future bug fails loud at the seam, and the store's
 * missing outbox table is the second, engine-level guard).
 */
class PersonalGuardTransport implements SyncTransport {
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
  }

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

  private readonly noPush = (label: string): never => {
    throw new Error(
      `${label} refused: the android-personal class has NO push path (LOCAL_DATABASE §1.1 ` +
        "rule 2 — zero write affordances; DR-P22-08b)",
    );
  };

  async pull(entityType: string, cursor: string | null, limit?: number): Promise<PullEnvelope> {
    return this.guard(() => this.inner.pull(entityType, cursor, limit));
  }

  async push(): Promise<PushItemResult[]> {
    return this.noPush("push");
  }

  async pushV2(): Promise<PushItemResultV2[]> {
    return this.noPush("pushV2");
  }

  async status(): Promise<{
    serverTime: string;
    contractVersion: string;
    suspended?: boolean;
    device?: { revoked?: boolean };
  }> {
    return this.guard(() => this.inner.status!());
  }

  pullAck: (positions: readonly { entityType: string; cursor: string }[]) => Promise<void> = (positions) =>
    this.guard(() => this.inner.pullAck?.(positions) ?? Promise.resolve());

  pushAck: (commandIds: readonly string[]) => Promise<void> = (commandIds) =>
    this.guard(() => this.inner.pushAck?.(commandIds) ?? Promise.resolve());

  private async guard<T>(operation: () => Promise<T>): Promise<T> {
    try {
      return await operation();
    } catch (error) {
      if (error instanceof MobileSessionExpiredError) {
        this.sessionExpiredFlag = true;
      } else if (error instanceof MobileSyncHttpError && error.status === 401) {
        this.httpUnauthorizedFlag = true;
      }
      throw error;
    }
  }
}

// -- the host ---------------------------------------------------------------------

/** The UI mirror (the screens render this). Emitted through `onState`
 * on every transition; always readable via `host.state`. */
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
export interface MobileCycleResult {
  readonly outcome?: CycleOutcome;
  readonly skipped?: "already-running" | "revoked";
}

/** How the host detected the D-01 condition. */
export interface RevocationDetection {
  /** "status" — the server's status response said revoked; "data-expiry"
   * — `device.dataExpiresAt` is past (§6.2 remote data-expiry). */
  readonly source: "status" | "data-expiry";
  readonly at: string;
  readonly detail?: string;
}

/** The sync-core outbox queue stats (field only; the personal class
 * reports zeros — it has no queue by construction). */
export interface OutboxQueueStats {
  readonly pending: number;
  readonly inFlight: number;
  readonly rejected: number;
  readonly acked: number;
}

/** The fast-push result (`pushNow`) — FIELD ONLY; the personal class
 * is refused with `skipped: "pull-only"` (the hard guard). */
export type MobilePushResult =
  | { readonly skipped: "already-running" | "revoked" | "read-only" | "corrupt" | "pull-only" }
  | {
      readonly skipped?: undefined;
      readonly pushed: number;
      readonly accepted: number;
      readonly rejected: number;
      readonly deferred: number;
      readonly duplicates: number;
    };

export interface MobileSyncHostOptions {
  /** An OPEN, fully migrated mobile store (`openFieldStore` /
   * `openPersonalStore`). */
  readonly store: MobileStore;
  /** The device class — must match the store's own class. */
  readonly deviceClass: "android-field" | "android-personal";
  /** The sync transport (mobileHttpTransport in the shell; scripted
   * fakes in tests). Consumed UNMODIFIED through sync-core. */
  readonly transport: SyncTransport;
  /** The memory-only access-token provider (2-b owns the session); the
   * host reads it once per cycle for the fail-closed pre-check — the
   * transport reads it fresh per request. */
  readonly accessToken: AccessTokenProvider;
  /** UI mirror subscriber — called on every state transition. */
  readonly onState?: (state: HostState) => void;
  /** C-08: fired ONCE per contract-gate trip (the release-policy UI
   * listens — task 4-a's force-update path). */
  readonly onUpdatePrompt?: (reason: "CONTRACT_VERSION_UNSUPPORTED") => void;
  /** D-01: fired when revocation is detected (the shell runs
   * `purgeOnRevocation(store)` and shows the re-enroll screen). */
  readonly onRevocation?: (detection: RevocationDetection) => void;
  /** Post-cycle byte-exact prune options (the DR-P21-03 port). Absent ⇒
   * the default 128 MB budget (MOBILE_STORAGE_BUDGET_BYTES). */
  readonly prune?: { readonly budgetBytes?: number };
  /** The per-cycle transport budget wiring: the controller (the shell
   * passes the transport's own guard) — armed per cycle with the
   * per-class/per-mode profile (personal BACKGROUND pulls ≤ 256 KB). */
  readonly budget?: { readonly controller?: TransportBudgetController };
}

/**
 * The per-cycle observations the host derives from `CycleEvent`s + the
 * observed transport (runCycle already swallows per-entity failures
 * into events — the host collects them to phase honestly).
 */
interface CycleObservations {
  integrity: "ok" | "corrupt";
  errors: string[];
  contractGateCleared: boolean;
}

/** Read the D-01-relevant facts off ANY transport's status() result
 * (defensive runtime narrowing — the transport type only promises
 * `device?.revoked`; mobileHttpTransport additionally returns
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

/** The mobile sync host. See the module header for the per-class cycle
 * profiles + the boot sequence. */
export class MobileSyncHost {
  private readonly options: MobileSyncHostOptions;
  private readonly profile: "field" | "personal";
  private readonly observed: SyncTransport;
  private readonly observer: {
    beginCycle(): void;
    readonly sessionExpired: boolean;
    readonly httpUnauthorized: boolean;
    readonly lastStatus: unknown;
  };
  private readonly client: SyncClient;
  private currentState: HostState = { phase: "idle" };
  private cycleRunning = false;
  private revocationHandled = false;
  private gatePromptFired = false;
  private observations: CycleObservations = { integrity: "ok", errors: [], contractGateCleared: false };
  private lastPurgeReport: PurgeReport | null = null;
  private lastPruneResult: MobilePruneResult | null = null;
  private pruneErrorMessage: string | null = null;

  constructor(options: MobileSyncHostOptions) {
    if (!options.store.isOpen) {
      throw new Error("MobileSyncHost: the store must be OPEN (openFieldStore/openPersonalStore) before the host is constructed");
    }
    if (options.store.deviceClass !== options.deviceClass) {
      throw new Error(
        `MobileSyncHost: store class ${options.store.deviceClass} does not match options.deviceClass ${options.deviceClass}`,
      );
    }
    this.options = options;
    this.profile = options.deviceClass === "android-field" ? "field" : "personal";
    // The UNMODIFIED sync-core client over the wrapped transport — every
    // protocol decision stays inside runCycle/SyncClient (DR-P22-08).
    if (this.profile === "field") {
      const materializing = new FieldMaterializingTransport(options.transport, options.store);
      this.observed = materializing;
      this.observer = materializing;
    } else {
      const guard = new PersonalGuardTransport(options.transport);
      this.observed = guard;
      this.observer = guard;
    }
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

  /** The last post-cycle byte-exact prune result. */
  get lastPrune(): MobilePruneResult | null {
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

  /** The host's profile (field = pull+push; personal = pull-only). */
  get deviceProfile(): "field" | "personal" {
    return this.profile;
  }

  /**
   * The local-write gate the flow layer checks before enabling writes:
   * false while read-only (C-08), revoked (D-01) or corrupt (§6.4) — and
   * ALWAYS false for the personal class (zero write affordances by
   * construction, DR-P22-08b). NOT the enforcement layer — sync-core's
   * `assertWritable` + the personal store's missing outbox table stay
   * authoritative.
   */
  canWrite(): boolean {
    if (this.profile === "personal") return false;
    const phase = this.currentState.phase;
    return phase !== "read-only" && phase !== "revoked" && phase !== "corrupt";
  }

  /** Dirty outbox depth (the periodic trigger's "while dirty" check —
   * SYNC_PROTOCOL §8). Personal: always 0 (no queue by construction). */
  queueDepth(): number {
    const stats = this.queueStats();
    return stats.pending + stats.inFlight;
  }

  /** The full outbox queue stats. Personal: honest zeros. */
  queueStats(): OutboxQueueStats {
    if (this.profile === "personal") {
      return { pending: 0, inFlight: 0, rejected: 0, acked: 0 };
    }
    return readQueueStats(this.options.store);
  }

  /** Per-item rejection surfacing (CONFLICT_RESOLUTION §3): the typed
   * rejected outbox rows. Personal: always [] (no queue). */
  rejectedCommands(): ReturnType<typeof readRejectedCommands> {
    if (this.profile === "personal") return [];
    return readRejectedCommands(this.options.store);
  }

  /**
   * The DEFERRED retry hint for the trigger set's `RetryScheduler`:
   * the earliest `next_attempt_at` among queued outbox rows minus now
   * (null when nothing is queued or nothing is due in the future — the
   * normal triggers own the due-now case). Personal: always null.
   */
  deferredRetryHintMs(): number | null {
    if (this.profile === "personal") return null;
    const rows = this.options.store.all(
      "SELECT next_attempt_at FROM outbox WHERE status = ? AND next_attempt_at > 0",
      ["QUEUED"],
    );
    let earliest: number | null = null;
    for (const row of rows) {
      const at = Number(row.next_attempt_at ?? 0);
      if (at > 0 && (earliest === null || at < earliest)) earliest = at;
    }
    if (earliest === null) return null;
    const hint = earliest - Date.now();
    return hint > 0 ? hint : null;
  }

  /**
   * Boot cycle (the recovery pass lives INSIDE runCycle for field; the
   * personal cycle runs its own integrity check first). Same path as
   * `syncNow`; returns the outcome.
   */
  async boot(): Promise<MobileCycleResult> {
    return this.syncNow();
  }

  /**
   * Manual full cycle. One in flight at a time: a call while a cycle
   * runs returns `{ skipped: "already-running" }` (never queues); after
   * D-01 every call returns `{ skipped: "revoked" }` until
   * re-enrollment constructs a fresh host. A null/empty access token
   * REJECTS with {@link MobileSessionExpiredError} (phase "error") —
   * sync stops, no anonymous request is ever fired.
   *
   * `background: true` arms the personal-profile 256 KB pull budget
   * (the BackgroundSchedulerPort's ≥ 15 min task); field cycles keep
   * the 8 MB/2 MB golden budgets in every mode.
   */
  async syncNow(options?: { readonly background?: boolean }): Promise<MobileCycleResult> {
    if (this.revocationHandled) return { skipped: "revoked" };
    if (this.cycleRunning) return { skipped: "already-running" };
    this.cycleRunning = true; // set synchronously — the one-in-flight mutex
    try {
      this.ensureAccessToken();
      if (this.revocationHandled) return { skipped: "revoked" };
      this.observer.beginCycle();
      this.observations = { integrity: "ok", errors: [], contractGateCleared: false };
      this.armBudget(options?.background === true);
      this.patchState({ phase: "syncing" });
      const outcome =
        this.profile === "field"
          ? await runCycle(this.client, { onEvent: (event) => this.onCycleEvent(event) })
          : await this.runPullOnlyCycle();
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
   * Post-write fast push (SYNC_PROTOCOL §8 "After local write") — FIELD
   * ONLY: drains the outbox through the v2 wire when the transport has
   * `pushV2`, else the 016 `pushAll`. The personal class is REFUSED with
   * `{ skipped: "pull-only" }` — the hard guard (and the
   * PersonalGuardTransport would throw even if this check regressed).
   */
  async pushNow(): Promise<MobilePushResult> {
    if (this.profile === "personal") return { skipped: "pull-only" };
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
      this.ensureAccessToken();
      if (this.revocationHandled) return { skipped: "revoked" };
      this.observer.beginCycle();
      this.armBudget(false);
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
   * Record a D-01 purge the shell executed (observability for the UI —
   * `host.lastPurge` renders the "local data purged" state).
   */
  recordRevocationPurge(report: PurgeReport): void {
    this.lastPurgeReport = report;
  }

  // -- internals -----------------------------------------------------------------

  /**
   * Fail-closed pre-cycle check: a null/empty token rejects with
   * MobileSessionExpiredError (phase "error" via failCycle) — never an
   * anonymous cycle. (The transport re-checks per request; this check
   * stops the cycle BEFORE any network work.)
   */
  private ensureAccessToken(): void {
    const token = this.options.accessToken();
    if (token === null || token === "") {
      throw new MobileSessionExpiredError(
        "the device session holds no access token (never enrolled, purged, or logged out); " +
          "sync stops rather than sending anonymous requests (SECURITY_AND_DEVICE_MANAGEMENT §3)",
      );
    }
  }

  /** Arm the per-cycle transport budget (the client-side enforcement):
   * field — 8 MB pull / 2 MB push in every mode; personal — 8 MB
   * foreground, 256 KB BACKGROUND. */
  private armBudget(background: boolean): void {
    const controller = this.options.budget?.controller;
    if (controller === undefined) return;
    const profile: TransportBudgetProfile = this.profile === "field"
      ? FIELD_FOREGROUND_BUDGET
      : background
        ? PERSONAL_BACKGROUND_BUDGET
        : PERSONAL_FOREGROUND_BUDGET;
    controller.beginCycle(profile);
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

  /**
   * The personal-profile PULL-ONLY cycle (DR-P22-08b): the C-08 status
   * gate → the D-01 revocation check → the permissions watermark pull →
   * every personal feed entity through `applyPullBatch` with the mobile
   * appliers (rows + cursor atomic, version-guarded) → best-effort
   * pullAck. NO push — structurally (the guard transport would throw).
   */
  private async runPullOnlyCycle(): Promise<CycleOutcome> {
    const startedAt = Date.now();
    const store = this.options.store;
    const transport = this.observed;
    const outcome: CycleOutcome = {
      pulled: 0,
      pushed: 0,
      accepted: 0,
      rejected: 0,
      deferred: 0,
      duplicates: 0,
      readOnly: false,
      deviceRevoked: false,
      durationMs: 0,
    };

    // The personal integrity check (recoveryPass's checksum logic minus
    // the outbox/inbox machinery this profile does not have).
    const cursorMeta = metaGet(store, "cursorCount");
    const actualCursors = store.all("SELECT entity_type FROM cursors").length;
    if (cursorMeta !== null && Number(cursorMeta) !== actualCursors) {
      metaSet(store, "quarantined", "true");
      store.run("DELETE FROM cursors");
      maintainCursorCount(store);
      this.observations.integrity = "corrupt";
      this.observations.errors.push(
        `cursorCount mismatch (meta=${cursorMeta}, actual=${String(actualCursors)}) — store quarantined, §6.4 required`,
      );
      outcome.durationMs = Date.now() - startedAt;
      return outcome;
    }

    // Status gate (C-08) + revocation (C-06/D-01) — the same wire runCycle
    // uses; a status failure proceeds defensively (every pull is still
    // protected by the per-envelope gate below).
    if (transport.status !== undefined) {
      try {
        const status = await transport.status();
        if (!isSupportedContract(status.contractVersion)) {
          // C-08: STOP — no business pull, no read of a contract this
          // client does not understand (the same rule runCycle applies).
          metaSet(store, "contractGate", "read-only");
          outcome.readOnly = true;
          outcome.durationMs = Date.now() - startedAt;
          return outcome;
        }
        if (metaGet(store, "contractGate") === "read-only") {
          // The app updated + the server is supported again: resume writes
          // (the same re-arm runCycle does on contractGateCleared).
          metaSet(store, "contractGate", "ok");
        }
        if (status.device?.revoked === true) {
          outcome.deviceRevoked = true;
        }
      } catch (error) {
        this.observations.errors.push(`status: ${String(error)}`);
      }
    }

    // Permissions FIRST (the D-04 watermark), then the personal feed
    // group — the same order runCycle uses.
    const entities: readonly string[] = ["permissions", ...PERSONAL_FEED_TYPES];
    const ackPositions: { entityType: string; cursor: string }[] = [];
    for (const entityType of entities) {
      try {
        for (let page = 0; page < 100; page += 1) {
          const cursor = readCursor(store, entityType);
          const envelope = await transport.pull(entityType, cursor);
          if (envelope.contractVersion !== undefined && envelope.contractVersion !== "" && !isSupportedContract(envelope.contractVersion)) {
            // Per-envelope gate — the same C-08 stop as an unsupported
            // status (the shared helper, evaluated inline).
            metaSet(store, "contractGate", "read-only");
            outcome.readOnly = true;
            outcome.durationMs = Date.now() - startedAt;
            return outcome;
          }
          const applied = applyPullBatch(
            store,
            { entityType, cursor: envelope.nextCursor ?? envelope.cursor, changes: envelope.changes },
            MOBILE_FEED_APPLIERS,
          );
          outcome.pulled += applied;
          if (!envelope.hasMore) break;
        }
        const finalCursor = readCursor(store, entityType);
        if (finalCursor !== null) ackPositions.push({ entityType, cursor: finalCursor });
      } catch (error) {
        // One entity's failure never blocks the others — the persisted
        // cursor resumes exactly where the last commit landed (§2.7).
        this.observations.errors.push(`pull ${entityType}: ${String(error)}`);
      }
    }

    // Best-effort ack (correctness never depends on it, §2.8).
    if (ackPositions.length > 0 && transport.pullAck !== undefined) {
      try {
        await transport.pullAck(ackPositions);
      } catch {
        // best-effort — the local cursor is authoritative
      }
    }
    outcome.durationMs = Date.now() - startedAt;
    return outcome;
  }

  private finishCycle(outcome: CycleOutcome): void {
    const at = new Date().toISOString();

    // §6.4 corruption: the cycle returned early (quarantined store) —
    // the shell must run the recoverCorruptStore drill before anything
    // else.
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
    // outcome.deviceRevoked for field), or the remote data-expiry
    // watermark passed (§6.2 — server time is authoritative).
    const facts = readStatusFacts(this.observer.lastStatus);
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
    // one-per-trip update prompt. No push happened (the cycle stopped).
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

    // Session death mid-cycle: the cycle swallowed the transport errors
    // into events/DEFERRED rows — the observed flag phases it honestly.
    const sessionDead = this.observer.sessionExpired || this.observer.httpUnauthorized;
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
    // The §6.4 full-pull flag: a cycle that pulled anything has
    // re-bootstrapped the caches — clear it (the ONLY writer besides
    // the drill itself).
    if (outcome.pulled > 0) {
      metaDelete(this.options.store, "fullPullPending");
    }
    this.runPostCyclePrune();
  }

  private finishFastPush(): void {
    const sessionDead = this.observer.sessionExpired || this.observer.httpUnauthorized;
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

  /** The D-01 terminal path: stop syncing + (field only)
   * `markQueueUnresolvable` — personal has no queue to mark; its D-01
   * IS the purge + re-enroll — + phase "revoked" + the shell's
   * onRevocation hook. */
  private enterRevokedState(
    source: RevocationDetection["source"],
    detail: string,
    outcome?: CycleOutcome,
    at?: string,
  ): void {
    if (!this.revocationHandled) {
      this.revocationHandled = true;
      if (this.profile === "field") {
        markQueueUnresolvable(this.options.store, "DEVICE_REVOKED");
      }
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
      error instanceof MobileSessionExpiredError
        ? `session-expired: ${error.message}`
        : error instanceof MobileSyncHttpError && error.status === 401
          ? "session-expired: the server rejected the access token (HTTP 401) — silent refresh or re-enrollment required"
          : `sync failed: ${String(error)}`;
    this.patchState({ phase: "error", lastError });
  }

  /** The byte-exact prune runs POST-cycle (never mid-cycle); a
   * maintenance failure never fails the cycle — it is recorded. */
  private runPostCyclePrune(): void {
    try {
      this.pruneErrorMessage = null;
      this.lastPruneResult = pruneMobileStore(
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

// The shared contract-version gate check (contracts isContractSupported,
// imported at the top) is applied by the pull-only cycle's per-envelope
// gate — the same rule runCycle applies.
