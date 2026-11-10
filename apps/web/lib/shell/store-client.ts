"use client";
/**
 * PHASE-021 T2-b (DR-P21-06 · MASTER-PLAN §6 + ARCHITECTURE) — the ASYNC
 * repository over `bridge.sql`.
 *
 * The sync ENGINE lives in the shell-side runtime (`apps/desktop`), never
 * in the webview: this module is 100% bridge-driven — every read goes
 * through `bridge.sql.query` and every write through `bridge.sql.execute`
 * (there is no synchronous StorageAdapter on the web side; the bridge is
 * async by contract). Column names use EXACTLY the frozen sync-core
 * v1–v3 + desktop v4–v5 DDL (`packages/sync-core/src/store/adapter.ts` +
 * `apps/desktop/src/store/desktop-migrations.ts`); every statement lives
 * in the exported `STORE_SQL` manifest so the schema-parity spec
 * (`apps/web/__tests__/local-schema-parity.test.ts`) can pin each one
 * against the REAL DDL parsed out of `@erp/sync-core`/`@erp/desktop`.
 *
 * The enqueue ordering is CRASH-SAFE by design (documented contract):
 *   1. outbox INSERT first — the outbox is the SOURCE OF TRUTH: if the
 *      process dies after this statement and before (2), the command
 *      still rides the next drain and the server creates the entity; the
 *      missing draft_docs row only costs a local projection, which the
 *      next pull re-materializes server-side.
 *   2. THEN the draft_docs projection row. The reverse order would be a
 *      lie: a draft row whose command was never queued would render
 *      DRAFT_LOCAL forever and never sync.
 * The two statements cannot share one bridge transaction (bridge.sql has
 * no BEGIN/COMMIT surface), so this window is honest and one-directional
 * — it can only lose a PROJECTION, never a COMMAND.
 *
 * The write gate duplicates sync-core's `assertWritable` semantics
 * against ASYNC reads (quarantined / contractGate / D-04 permission
 * watermark > 7d) — the webview cannot call the synchronous engine gate,
 * and it never invents a second business rule: it refuses loudly, before
 * any write, exactly like the engine.
 */
import type { OutboxStatus, SyncCommandV2Envelope } from "@erp/sync-core";

import type { DesktopBridge } from "./bridge";

// -- the SQL manifest (single source for the functions + the parity spec) ----------

/**
 * Every statement the repository issues. SELECTs stay deliberately
 * simple (`SELECT * FROM t` + JS-side filtering/projection): the local
 * caches are per-device single-tenant tables, and the plain shapes keep
 * the bridge double in tests (and the real SQL engine) on one narrow,
 * verifiable path. The parity spec parses each entry's table + columns
 * against the v1–v5 DDL.
 */
export const STORE_SQL = {
  metaSelect: "SELECT * FROM meta WHERE key = ?",
  cursorsSelectAll: "SELECT * FROM cursors",
  itemsSelectAll: "SELECT * FROM items",
  partnersSelectAll: "SELECT * FROM partners",
  taxCodesSelectAll: "SELECT * FROM tax_codes",
  stockCountsSelectAll: "SELECT * FROM stock_counts",
  salesInvoicesSelectAll: "SELECT * FROM sales_invoices",
  salesInvoiceSelectById: "SELECT * FROM sales_invoices WHERE id = ?",
  outboxSelectAll: "SELECT * FROM outbox",
  draftsSelectAll: "SELECT * FROM draft_docs",
  permissionsSelectKeys: "SELECT key FROM permissions",
  /** Column list copied 1:1 from sync-core's outbox engine INSERT (v3
   * shape: local_ref + next_attempt_at included) — the row the shell-side
   * drain picks up. */
  outboxInsert:
    "INSERT INTO outbox (command_id, entity_type, intent, payload, idempotency_key, base_version, client_created_at, local_ref, status, attempts, next_attempt_at, last_error, last_attempt_at, accepted_result, rejection_reason, rejection_action, official_no, acked_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
  /** INSERT OR REPLACE keyed on local_id: a RESEND (edit-and-resend /
   * accept-server-price / accept-partial) goes through the SAME enqueue
   * path with the SAME local_id — the row flips back to its initial
   * status pointing at the NEW command_id (fresh idempotencyKey rides
   * the outbox row), which is exactly "new commandId, same entity id". */
  draftUpsert:
    "INSERT OR REPLACE INTO draft_docs (local_id, doc_type, entity_id, payload, local_status, command_id, rejection, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
  draftUpdateStatus:
    "UPDATE draft_docs SET local_status = ?, rejection = ?, updated_at = ? WHERE local_id = ?",
  /** local_events (CONFLICT_RESOLUTION §3): the audit-logged user
   * choices — kept forever, never pruned, never sync machinery. The id
   * column is INTEGER PRIMARY KEY AUTOINCREMENT and stays implicit. */
  localEventInsert:
    "INSERT INTO local_events (kind, choice, reason, trace_id, command_id, payload, at) VALUES (?, ?, ?, ?, ?, ?, ?)",
} as const;

// -- view models (snake_case rows mapped to typed camelCase) ------------------------

export interface CachedItem {
  readonly id: string;
  readonly sku: string;
  readonly name: string;
  readonly nameAr: string | null;
  readonly kind: string;
  readonly uomId: string | null;
  readonly categoryId: string | null;
  readonly taxCodeId: string | null;
  readonly basePrice: string | null;
  readonly trackBatch: boolean;
  readonly trackSerial: boolean;
  readonly status: string;
  readonly updatedAt: string | null;
}

export interface CachedPartner {
  readonly id: string;
  readonly code: string;
  readonly name: string;
  readonly nameAr: string | null;
  readonly kind: string;
  readonly status: string;
  readonly creditLimit: string | null;
  readonly priceListId: string | null;
  readonly taxNumber: string | null;
  readonly updatedAt: string | null;
}

export interface CachedTaxCode {
  readonly id: string;
  readonly code: string;
  readonly name: string;
  readonly nameAr: string | null;
  readonly rate: string | null;
  readonly status: string;
}

/** A cached count session (stock_counts v4): sessions are created online
 * so the system-qty snapshot freezes server-side; only DRAFT sessions can
 * receive offline lines. */
export interface CachedCountSession {
  readonly id: string;
  readonly docNo: string | null;
  readonly status: string;
  readonly countedAt: string | null;
}

/** A cached sales invoice (sales_invoices v4) — the reprint source and
 * the honest read list. */
export interface CachedInvoice {
  readonly id: string;
  readonly docNo: string | null;
  readonly partnerId: string | null;
  readonly status: string;
  readonly issueDate: string | null;
  readonly totalGross: string | null;
  readonly totalTax: string | null;
  readonly currency: string | null;
  readonly payload: string;
  readonly version: number | null;
  readonly updatedAt: string | null;
}

/** The outbox row as the console renders it (snake_case → camelCase of
 * the v1/v3 DDL columns). */
export interface OutboxRowView {
  readonly commandId: string;
  readonly entityType: string;
  readonly intent: string;
  readonly payload: string;
  readonly idempotencyKey: string;
  readonly baseVersion: number | null;
  readonly clientCreatedAt: string;
  readonly localRef: string | null;
  readonly status: OutboxStatus;
  readonly attempts: number;
  readonly nextAttemptAt: number;
  readonly lastError: string | null;
  readonly lastAttemptAt: string | null;
  readonly acceptedResult: string | null;
  readonly rejectionReason: string | null;
  readonly rejectionAction: string | null;
  readonly officialNo: string | null;
  readonly ackedAt: string | null;
}

/** draft_docs local_status values (desktop migration v4 CHECK list). */
export type DraftStatus = "DRAFT_LOCAL" | "PENDING_MERGE" | "SYNC_FAILED" | "MERGED" | "CANCELLED_LOCAL";

/** The 9 OFFLINE-DRAFT doc types (MASTER-PLAN §6; matrix rows
 * 6/7/10/11/21/23/25/26/34) — the tab keys + draft_docs.doc_type values. */
export type DraftDocType =
  | "sales_invoice_draft"
  | "quotation_draft"
  | "delivery_note"
  | "stock_count_lines"
  | "partner_contact_merge"
  | "partner_create"
  | "expense"
  | "cash_transfer"
  | "stock_transfer";

export interface DraftRowView {
  readonly localId: string;
  readonly docType: DraftDocType;
  readonly entityId: string | null;
  readonly payload: string;
  readonly localStatus: DraftStatus;
  readonly commandId: string | null;
  readonly rejection: string | null;
  readonly updatedAt: string;
}

/** local_events row shape for a rejection choice (CONFLICT_RESOLUTION §3:
 * kind/choice/reason/trace_id/command_id/payload/at). */
export interface LocalEventInput {
  readonly kind: "rejection_choice";
  readonly choice: string;
  readonly reason: string;
  readonly traceId: string | null;
  readonly commandId: string | null;
  readonly payload: unknown;
  readonly at: string;
}

/** The D-04 unlock verdict — duplicated from 1-b's `unlockWithSnapshot`
 * (apps/desktop/src/auth/unlock.ts) against ASYNC reads; the semantics are
 * byte-identical (7-day watermark, strictly-greater expiry, NO_SNAPSHOT
 * when never pulled). */
export type UnlockDecision =
  | { mode: "full"; permissions: string[]; snapshotAt: Date }
  | { mode: "readonly"; reason: "SNAPSHOT_EXPIRED"; snapshotAt: Date }
  | { mode: "readonly"; reason: "NO_SNAPSHOT" };

/** The typed enqueue refusal — the async mirror of sync-core
 * `assertWritable` (LocalStoreCorruptError / SyncReadOnlyError). */
export type StoreWriteRefusal =
  | { kind: "quarantined" }
  | { kind: "contract-gate" }
  | { kind: "stale-watermark"; ageDays: number };

export class ShellStoreRefusedError extends Error {
  readonly refusal: StoreWriteRefusal;
  constructor(refusal: StoreWriteRefusal) {
    super(`local write refused (${refusal.kind}) — the store gate is closed`);
    this.name = "ShellStoreRefusedError";
    this.refusal = refusal;
  }
}

/** D-04: 7 days in ms (sync-core PERMISSION_SNAPSHOT_MAX_AGE_DAYS = 7 /
 * 1-b SNAPSHOT_WATERMARK_MS — duplicated, never imported from @erp/desktop). */
const SNAPSHOT_WATERMARK_MS = 7 * 24 * 60 * 60 * 1000;

// -- row mappers --------------------------------------------------------------------

const asString = (value: unknown): string => (typeof value === "string" ? value : String(value ?? ""));
const asNullableString = (value: unknown): string | null =>
  value === null || value === undefined ? null : String(value);
const asNullableNumber = (value: unknown): number | null =>
  value === null || value === undefined ? null : Number(value);

function mapItem(row: Record<string, unknown>): CachedItem {
  return {
    id: asString(row.id),
    sku: asString(row.sku),
    name: asString(row.name),
    nameAr: asNullableString(row.name_ar),
    kind: asString(row.kind),
    uomId: asNullableString(row.uom_id),
    categoryId: asNullableString(row.category_id),
    taxCodeId: asNullableString(row.tax_code_id),
    basePrice: asNullableString(row.base_price),
    trackBatch: row.track_batch === 1 || row.track_batch === true,
    trackSerial: row.track_serial === 1 || row.track_serial === true,
    status: asString(row.status),
    updatedAt: asNullableString(row.updated_at),
  };
}

function mapPartner(row: Record<string, unknown>): CachedPartner {
  return {
    id: asString(row.id),
    code: asString(row.code),
    name: asString(row.name),
    nameAr: asNullableString(row.name_ar),
    kind: asString(row.kind),
    status: asString(row.status),
    creditLimit: asNullableString(row.credit_limit),
    priceListId: asNullableString(row.price_list_id),
    taxNumber: asNullableString(row.tax_number),
    updatedAt: asNullableString(row.updated_at),
  };
}

function mapTaxCode(row: Record<string, unknown>): CachedTaxCode {
  return {
    id: asString(row.id),
    code: asString(row.code),
    name: asString(row.name),
    nameAr: asNullableString(row.name_ar),
    rate: asNullableString(row.rate),
    status: asString(row.status),
  };
}

function mapCountSession(row: Record<string, unknown>): CachedCountSession {
  return {
    id: asString(row.id),
    docNo: asNullableString(row.doc_no),
    status: asString(row.status),
    countedAt: asNullableString(row.counted_at),
  };
}

function mapInvoice(row: Record<string, unknown>): CachedInvoice {
  return {
    id: asString(row.id),
    docNo: asNullableString(row.doc_no),
    partnerId: asNullableString(row.partner_id),
    status: asString(row.status),
    issueDate: asNullableString(row.issue_date),
    totalGross: asNullableString(row.total_gross),
    totalTax: asNullableString(row.total_tax),
    currency: asNullableString(row.currency),
    payload: asString(row.payload),
    version: asNullableNumber(row.version),
    updatedAt: asNullableString(row.updated_at),
  };
}

function mapOutbox(row: Record<string, unknown>): OutboxRowView {
  return {
    commandId: asString(row.command_id),
    entityType: asString(row.entity_type),
    intent: asString(row.intent),
    payload: asString(row.payload),
    idempotencyKey: asString(row.idempotency_key),
    baseVersion: asNullableNumber(row.base_version),
    clientCreatedAt: asString(row.client_created_at),
    localRef: asNullableString(row.local_ref),
    status: asString(row.status) as OutboxStatus,
    attempts: Number(row.attempts ?? 0),
    nextAttemptAt: Number(row.next_attempt_at ?? 0),
    lastError: asNullableString(row.last_error),
    lastAttemptAt: asNullableString(row.last_attempt_at),
    acceptedResult: asNullableString(row.accepted_result),
    rejectionReason: asNullableString(row.rejection_reason),
    rejectionAction: asNullableString(row.rejection_action),
    officialNo: asNullableString(row.official_no),
    ackedAt: asNullableString(row.acked_at),
  };
}

function mapDraft(row: Record<string, unknown>): DraftRowView {
  return {
    localId: asString(row.local_id),
    docType: asString(row.doc_type) as DraftDocType,
    entityId: asNullableString(row.entity_id),
    payload: asString(row.payload),
    localStatus: asString(row.local_status) as DraftStatus,
    commandId: asNullableString(row.command_id),
    rejection: asNullableString(row.rejection),
    updatedAt: asString(row.updated_at),
  };
}

// -- the repository ------------------------------------------------------------------

/** Read one meta key (null when absent) — the machinery state surface. */
export async function readMeta(bridge: DesktopBridge, key: string): Promise<string | null> {
  const rows = await bridge.sql.query(STORE_SQL.metaSelect, [key]);
  const row = rows[0];
  return row === undefined ? null : asNullableString(row.value);
}

/** The as-of stamp: MAX(cursors.synced_at) over every entity cursor —
 * the honest "last synced" label (never a guess). */
export async function readAsOf(bridge: DesktopBridge): Promise<number | null> {
  const rows = await bridge.sql.query(STORE_SQL.cursorsSelectAll);
  let max: number | null = null;
  for (const row of rows) {
    const value = Number(row.synced_at ?? 0);
    if (Number.isFinite(value) && (max === null || value > max)) max = value;
  }
  return max;
}

/** Active items (status ACTIVE) — the pickers' source. */
export async function readCachedItems(bridge: DesktopBridge): Promise<CachedItem[]> {
  const rows = await bridge.sql.query(STORE_SQL.itemsSelectAll);
  return rows.map(mapItem).filter((item) => item.status.toUpperCase() === "ACTIVE");
}

/** Active partners (status ACTIVE) — the pickers' source. */
export async function readCachedPartners(bridge: DesktopBridge): Promise<CachedPartner[]> {
  const rows = await bridge.sql.query(STORE_SQL.partnersSelectAll);
  return rows.map(mapPartner).filter((partner) => partner.status.toUpperCase() === "ACTIVE");
}

/** Active tax codes — the taxCodeId pickers. */
export async function readCachedTaxCodes(bridge: DesktopBridge): Promise<CachedTaxCode[]> {
  const rows = await bridge.sql.query(STORE_SQL.taxCodesSelectAll);
  return rows.map(mapTaxCode).filter((code) => code.status.toUpperCase() === "ACTIVE");
}

/** Cached count sessions — only DRAFT sessions can receive offline lines
 * (matrix row 11: SD-aggregate; the snapshot freezes server-side). */
export async function readCachedCountSessions(bridge: DesktopBridge): Promise<CachedCountSession[]> {
  const rows = await bridge.sql.query(STORE_SQL.stockCountsSelectAll);
  return rows.map(mapCountSession).filter((session) => session.status.toUpperCase() === "DRAFT");
}

/** Cached sales invoices (all statuses — the honest list). */
export async function readSalesInvoices(bridge: DesktopBridge): Promise<CachedInvoice[]> {
  const rows = await bridge.sql.query(STORE_SQL.salesInvoicesSelectAll);
  return rows.map(mapInvoice);
}

/** One cached invoice (the reprint source) — null when not cached. */
export async function readCachedInvoice(bridge: DesktopBridge, id: string): Promise<CachedInvoice | null> {
  const rows = await bridge.sql.query(STORE_SQL.salesInvoiceSelectById, [id]);
  const row = rows[0];
  return row === undefined ? null : mapInvoice(row);
}

/** Outbox rows (optionally filtered by status) — the queue view source. */
export async function readOutbox(
  bridge: DesktopBridge,
  statuses?: readonly OutboxStatus[],
): Promise<OutboxRowView[]> {
  const rows = await bridge.sql.query(STORE_SQL.outboxSelectAll);
  const mapped = rows.map(mapOutbox);
  if (statuses === undefined) return mapped;
  const wanted = new Set<string>(statuses);
  return mapped.filter((row) => wanted.has(row.status));
}

/** Outbox rows carrying a typed rejection (rejection_reason NOT NULL) —
 * the rejection UX subjects. */
export async function readRejections(bridge: DesktopBridge): Promise<OutboxRowView[]> {
  const rows = await readOutbox(bridge);
  return rows.filter((row) => row.rejectionReason !== null);
}

/** Draft rows (optionally one doc type), newest first. */
export async function readDrafts(
  bridge: DesktopBridge,
  docType?: DraftDocType,
): Promise<DraftRowView[]> {
  const rows = await bridge.sql.query(STORE_SQL.draftsSelectAll);
  const mapped = rows.map(mapDraft);
  const filtered = docType === undefined ? mapped : mapped.filter((row) => row.docType === docType);
  return [...filtered].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
}

/** Master-data search over the caches (items + partners by display text) —
 * READ-CACHED (matrix row 33), JS-side over the pulled rows. */
export async function searchMasterData(
  bridge: DesktopBridge,
  kind: "items" | "partners",
  query: string,
): Promise<CachedItem[] | CachedPartner[]> {
  const needle = query.trim().toLowerCase();
  if (kind === "items") {
    const items = await readCachedItems(bridge);
    if (needle === "") return items;
    return items.filter(
      (item) =>
        item.name.toLowerCase().includes(needle) ||
        (item.nameAr ?? "").toLowerCase().includes(needle) ||
        item.sku.toLowerCase().includes(needle),
    );
  }
  const partners = await readCachedPartners(bridge);
  if (needle === "") return partners;
  return partners.filter(
    (partner) =>
      partner.name.toLowerCase().includes(needle) ||
      (partner.nameAr ?? "").toLowerCase().includes(needle) ||
      partner.code.toLowerCase().includes(needle),
  );
}

// -- the write gate (async mirror of sync-core assertWritable) ----------------------

async function refuseIfNotWritable(bridge: DesktopBridge): Promise<void> {
  const [quarantined, contractGate, watermarkRaw] = await Promise.all([
    readMeta(bridge, "quarantined"),
    readMeta(bridge, "contractGate"),
    readMeta(bridge, "permissionSnapshotAt"),
  ]);
  if (quarantined === "true") {
    throw new ShellStoreRefusedError({ kind: "quarantined" });
  }
  if (contractGate === "read-only") {
    throw new ShellStoreRefusedError({ kind: "contract-gate" });
  }
  const watermarkMs = normalizeSnapshotAtMs(watermarkRaw);
  if (watermarkMs !== null) {
    const ageDays = (Date.now() - watermarkMs) / 86_400_000;
    if (ageDays > 7) {
      throw new ShellStoreRefusedError({ kind: "stale-watermark", ageDays });
    }
  }
}

// -- the enqueue path ----------------------------------------------------------------

/** The projection row the enqueue writes alongside the outbox command. */
export interface DraftProjectionInput {
  /** The draft's stable local identity — the SAME value on a resend
   * (INSERT OR REPLACE flips the row to the new command; "new commandId,
   * same entity id", CONFLICT_RESOLUTION §3). */
  readonly localId: string;
  readonly docType: DraftDocType;
  readonly entityId: string | null;
  readonly payload: unknown;
  /** PENDING_MERGE for contact merges (matrix row 21); DRAFT_LOCAL for
   * every create-draft flow (default). */
  readonly initialStatus?: DraftStatus;
  readonly rejection?: string | null;
}

/**
 * Enqueue a built v2 command: OUTBOX INSERT first (source of truth), THEN
 * the draft_docs projection (see the module header for the crash-window
 * contract). Refuses loudly (ShellStoreRefusedError) BEFORE any write when
 * the store is quarantined / contract-gated / past the D-04 watermark.
 */
export async function enqueueDraftCommand(
  bridge: DesktopBridge,
  command: SyncCommandV2Envelope,
  draft: DraftProjectionInput,
): Promise<void> {
  await refuseIfNotWritable(bridge);
  const now = new Date().toISOString();
  // (1) the outbox row — byte-for-byte the engine's own INSERT shape. The
  // payload column carries the FULL v2 ENVELOPE (DR-P21-3b-1): the engine
  // sends JSON.parse(row.payload) VERBATIM on the wire, so anything less
  // than the envelope (commandId/entityType/intent/idempotencyKey…) is
  // unattributable server-side and the row freezes IN_FLIGHT forever —
  // the E2E journey (T-P21-3b) proved the seam. The ReferenceDevice
  // harness's own capture stores the same envelope shape.
  await bridge.sql.execute(STORE_SQL.outboxInsert, [
    command.commandId,
    command.entityType,
    command.intent,
    JSON.stringify(command),
    command.idempotencyKey,
    command.baseVersion ?? null,
    command.clientCreatedAt,
    command.localRef ?? null,
    "QUEUED",
    0,
    0,
    null,
    null,
    null,
    null,
    null,
    null,
    null,
  ]);
  // (2) the projection row — INSERT OR REPLACE so a resend with the same
  // local_id re-points the draft at the new command.
  await bridge.sql.execute(STORE_SQL.draftUpsert, [
    draft.localId,
    draft.docType,
    draft.entityId,
    JSON.stringify(draft.payload ?? null),
    draft.initialStatus ?? "DRAFT_LOCAL",
    command.commandId,
    draft.rejection ?? null,
    now,
  ]);
}

/** Append a local_events row (the audit-logged user choices — kept
 * forever, CONFLICT_RESOLUTION §3 + LOCAL_DATABASE §5.2 exclusion). */
export async function appendLocalEvent(bridge: DesktopBridge, event: LocalEventInput): Promise<void> {
  await bridge.sql.execute(STORE_SQL.localEventInsert, [
    event.kind,
    event.choice,
    event.reason,
    event.traceId,
    event.commandId,
    JSON.stringify(event.payload ?? null),
    event.at,
  ]);
}

/** Update a draft's local status (reconciliation/cancel effects). */
export async function updateDraftStatus(
  bridge: DesktopBridge,
  localId: string,
  status: DraftStatus,
  rejection?: string | null,
): Promise<void> {
  await bridge.sql.execute(STORE_SQL.draftUpdateStatus, [
    status,
    rejection ?? null,
    new Date().toISOString(),
    localId,
  ]);
}

// -- the unlock decision (D-04 duplicated from 1-b, against async reads) --------------

/** 1-b's `normalizeSnapshotAtMs` verbatim: epoch ms, numeric string, or
 * ISO 8601 → ms; null when absent/unparseable. */
function normalizeSnapshotAtMs(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value) && value > 0) {
    return value;
  }
  if (typeof value === "string") {
    if (/^\d+$/.test(value)) {
      const asNumber = Number(value);
      return Number.isFinite(asNumber) && asNumber > 0 ? asNumber : null;
    }
    const parsed = Date.parse(value);
    return Number.isNaN(parsed) ? null : parsed;
  }
  return null;
}

/**
 * The D-04 unlock decision against async reads — the semantics are
 * 1-b's `unlockWithSnapshot` (apps/desktop/src/auth/unlock.ts): no
 * snapshot → NO_SNAPSHOT; now − snapshotAt STRICTLY > 7 days →
 * SNAPSHOT_EXPIRED (exactly 7 days is still full); otherwise full mode
 * carrying the cached permission keys (fail-soft to [] when the
 * on-demand `permissions` table is absent — the watermark, not the key
 * list, is the mode authority).
 */
export async function unlockSnapshot(
  bridge: DesktopBridge,
  now?: Date,
): Promise<UnlockDecision> {
  const raw = await readMeta(bridge, "permissionSnapshotAt");
  const snapshotAtMs = raw === null ? null : normalizeSnapshotAtMs(raw);
  if (snapshotAtMs === null) {
    return { mode: "readonly", reason: "NO_SNAPSHOT" };
  }
  const nowMs = (now ?? new Date()).getTime();
  if (nowMs - snapshotAtMs > SNAPSHOT_WATERMARK_MS) {
    return { mode: "readonly", reason: "SNAPSHOT_EXPIRED", snapshotAt: new Date(snapshotAtMs) };
  }
  let permissions: string[] = [];
  try {
    const rows = await bridge.sql.query(STORE_SQL.permissionsSelectKeys);
    permissions = rows.map((row) => asString(row.key)).filter((key) => key !== "");
  } catch {
    permissions = []; // fail-soft: no table yet → full mode, no affordances
  }
  return { mode: "full", permissions, snapshotAt: new Date(snapshotAtMs) };
}
