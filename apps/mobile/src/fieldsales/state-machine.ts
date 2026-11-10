/**
 * PHASE-022 T-P22-2-e · the shared field-sales flow state machine
 * (MASTER-PLAN §8 — BINDING; OFFLINE_CAPABILITIES_MATRIX §2 the
 * "Post-sync state machine" column; CONFLICT_RESOLUTION §3 the rejection
 * UX contract). EVERY flow (van-sale / collection / van-load / returns /
 * count-lines) renders through THESE helpers — a screen never invents a
 * state, a tone, or a rejection mapping.
 *
 * The honest states (state honesty, OFFLINE_ARCHITECTURE §5 — no locally
 * created state is EVER presented as posted):
 *
 *   DRAFT_LOCAL   the capture exists only in the editing UI (no command yet)
 *   PENDING_SYNC  the command is queued/in-flight in the outbox (QUEUED |
 *                 IN_FLIGHT) — the official number appears NOWHERE yet
 *   POSTED        the server ACCEPTED (outbox ACKED) — officialNo recorded
 *   REJECTED      the server rejected (outbox REJECTED) — EDITABLE again
 *                 locally per CONFLICT_RESOLUTION §3 rules, unless the
 *                 reason is administrative (resubmittable:false)
 *   CANCELLED     the user cancelled after a rejection (outbox CANCELLED)
 *
 * The draft-class flows (rows 6/11/27 — `DRAFT_LOCAL → DRAFT` in the
 * matrix) ride the same five states: an ACKED draft command is POSTED as a
 * COMMAND (the server accepted the create) while the server-side document
 * is a DRAFT — {@link serverDocumentStatus} surfaces that nuance for
 * rendering (e.g. the Returns screen shows "POSTED · server DRAFT").
 *
 * sync-core is consumed UNMODIFIED: state WRITES go through
 * `enqueue`/`applyResult`/`cancel`/`requeue`; this module only READS the
 * outbox (the fromRow mapping below mirrors the public OutboxRow shape).
 */
import {
  actionForSyncRejection,
  RESUBMITTABLE_BY_REASON,
  type RejectionAction,
  type SyncRejectionReason,
} from "@erp/contracts";
import type { StorageAdapter, OutboxRow } from "@erp/sync-core";

import type { Dictionary } from "../i18n";
import type { SemanticFamily } from "../theme/tokens";

/** The honest post-sync states a flow document can be in (§8). */
export type HonestFlowState = "DRAFT_LOCAL" | "PENDING_SYNC" | "POSTED" | "REJECTED" | "CANCELLED";

/** The per-flow machine class (OFFLINE_CAPABILITIES_MATRIX §2 column). */
export type FlowMachineKind = "sync" | "draft";

/**
 * The tone binding for the honest states (DESIGN_TOKENS §3 semantics via
 * the theme's SemanticFamily — the ONLY state→color path for flow states,
 * mirroring the §3 document badge map: DRAFT_LOCAL→info like DRAFT,
 * PENDING_SYNC→warning like PENDING_APPROVAL, POSTED→success like POSTED,
 * REJECTED→danger like the §3 rejection surface, CANCELLED→danger like
 * VOIDED/CANCELLED).
 */
export const FLOW_STATE_TONE: Readonly<Record<HonestFlowState, SemanticFamily>> = {
  DRAFT_LOCAL: "info",
  PENDING_SYNC: "warning",
  POSTED: "success",
  REJECTED: "danger",
  CANCELLED: "danger",
};

/** The i18n label key per honest state (the syncState* vocabulary — the
 * screens' single source; a plain record, exhaustively typed). */
export const FLOW_STATE_LABEL_KEY: Readonly<Record<HonestFlowState, keyof Dictionary>> = {
  DRAFT_LOCAL: "syncStateDraftLocal",
  PENDING_SYNC: "syncStatePendingSync",
  POSTED: "syncStatePosted",
  REJECTED: "syncStateRejected",
  CANCELLED: "syncStateDraftLocal",
};

/** Derive the honest state from an outbox row (undefined → DRAFT_LOCAL). */
export function flowStateFromRow(row: OutboxRow | undefined): HonestFlowState {
  if (row === undefined) return "DRAFT_LOCAL";
  switch (row.status) {
    case "QUEUED":
    case "IN_FLIGHT":
      return "PENDING_SYNC";
    case "ACKED":
      return "POSTED";
    case "REJECTED":
      return "REJECTED";
    case "CANCELLED":
      return "CANCELLED";
  }
}

/** The label key per honest state (the record lookup — kept tiny so the
 * exhaustive switch above and this stay obviously identical). */
export function flowStateLabelKey(state: HonestFlowState): keyof Dictionary {
  return FLOW_STATE_LABEL_KEY[state];
}

/**
 * The server-side document status of an ACKED command (the draft-machine
 * nuance): reads the stored acceptedResult JSON's `status` field (the
 * handlers return `{status: "DRAFT"}` for draft intents, the posted
 * results carry their own status). Null when the result carries no status.
 */
export function serverDocumentStatus(row: OutboxRow | undefined): string | null {
  if (row === undefined || row.acceptedResult === null) return null;
  try {
    const parsed = JSON.parse(row.acceptedResult) as { status?: unknown };
    return typeof parsed.status === "string" ? parsed.status : null;
  } catch {
    return null;
  }
}

/** The official number of a POSTED command (null until the server assigned it). */
export function officialNumberOf(row: OutboxRow | undefined): string | null {
  return row?.officialNo ?? null;
}

// -- rejection surfacing (CONFLICT_RESOLUTION §3 — the typed contract) ------------

/** The §3 rejection summary a rejected-command surface renders. */
export interface RejectionSummary {
  readonly reason: SyncRejectionReason;
  /** The server's human message (details.message / legacy lastError text). */
  readonly message: string | null;
  /** Whether the user may fix & resend (RESUBMITTABLE_BY_REASON default, server-stamped override). */
  readonly resubmittable: boolean;
  /** Machine-readable details (availableQty, currentVersion, …). */
  readonly details: Record<string, unknown> | null;
  /** The §3 required action (the stored action or the contracts map). */
  readonly action: RejectionAction;
}

/** The i18n label key per typed rejection reason (the reject* vocabulary). */
export function rejectionLabelKey(reason: SyncRejectionReason): keyof Dictionary {
  switch (reason) {
    case "PERIOD_LOCKED":
      return "rejectPeriodLocked";
    case "PRICE_CHANGED":
      return "rejectPriceChanged";
    case "INSUFFICIENT_STOCK":
      return "rejectInsufficientStock";
    case "CREDIT_LIMIT_EXCEEDED":
      return "rejectCreditLimitExceeded";
    case "STALE_VERSION":
      return "rejectStaleVersion";
    case "ITEM_INACTIVE":
      return "rejectItemInactive";
    case "PARTNER_INACTIVE":
      return "rejectPartnerInactive";
    case "VALIDATION_ERROR":
      return "rejectValidationError";
    case "DEVICE_REVOKED":
      return "rejectDeviceRevoked";
    case "TENANT_SUSPENDED":
      return "rejectTenantSuspended";
    case "DUPLICATE_COMMAND":
    case "CONTRACT_VERSION_UNSUPPORTED":
    case "FORBIDDEN":
      return "rejectValidationError";
  }
}

/** The i18n detail key per typed rejection reason (the reject*Detail vocabulary). */
export function rejectionDetailKey(reason: SyncRejectionReason): keyof Dictionary {
  switch (reason) {
    case "PERIOD_LOCKED":
      return "rejectPeriodLockedDetail";
    case "PRICE_CHANGED":
      return "rejectPriceChangedDetail";
    case "INSUFFICIENT_STOCK":
      return "rejectInsufficientStockDetail";
    case "CREDIT_LIMIT_EXCEEDED":
      return "rejectCreditLimitExceededDetail";
    case "STALE_VERSION":
      return "rejectStaleVersionDetail";
    case "ITEM_INACTIVE":
      return "rejectItemInactiveDetail";
    case "PARTNER_INACTIVE":
      return "rejectPartnerInactiveDetail";
    case "VALIDATION_ERROR":
      return "rejectValidationErrorDetail";
    case "DEVICE_REVOKED":
      return "rejectDeviceRevokedDetail";
    case "TENANT_SUSPENDED":
      return "rejectTenantSuspendedDetail";
    case "DUPLICATE_COMMAND":
    case "CONTRACT_VERSION_UNSUPPORTED":
    case "FORBIDDEN":
      return "rejectValidationErrorDetail";
  }
}

/** The i18n label key per §3 user action (the action* vocabulary). */
export function rejectionActionLabelKey(action: RejectionAction): keyof Dictionary {
  switch (action) {
    case "EDIT_AND_RESEND":
      return "actionEditAndResend";
    case "ACCEPT_SERVER_PRICE":
      return "actionAcceptServerPrice";
    case "CANCEL_WITH_REASON":
      return "actionCancel";
  }
}

/**
 * Parse a rejected row's typed lastError (the applyResult REJECTED shape
 * `{reason, resubmittable, details, message}`) or the legacy plain-string
 * form — the single rejection-surfacing path the ParkedRejections screen
 * (3-b) and the per-flow REJECTED banners share. The resubmittable
 * fallback is the contracts RESUBMITTABLE_BY_REASON map (the client-side
 * default; the typed JSON's server-stamped value always wins).
 */
export function describeRejection(row: OutboxRow): RejectionSummary | null {
  if (row.status !== "REJECTED") return null;
  const reason = (row.rejectionReason ?? "VALIDATION_ERROR") as SyncRejectionReason;
  let resubmittable = RESUBMITTABLE_BY_REASON[reason] ?? true;
  let message: string | null = null;
  let details: Record<string, unknown> | null = null;
  if (row.lastError !== null) {
    try {
      const parsed = JSON.parse(row.lastError) as {
        reason?: unknown;
        resubmittable?: unknown;
        details?: unknown;
        message?: unknown;
      };
      if (parsed !== null && typeof parsed === "object" && "reason" in parsed) {
        resubmittable = typeof parsed.resubmittable === "boolean" ? parsed.resubmittable : resubmittable;
        message = typeof parsed.message === "string" ? parsed.message : null;
        details =
          parsed.details !== null && typeof parsed.details === "object"
            ? (parsed.details as Record<string, unknown>)
            : null;
      } else {
        message = row.lastError;
      }
    } catch {
      message = row.lastError;
    }
  }
  const action =
    row.rejectionAction === "EDIT_AND_RESEND" || row.rejectionAction === "ACCEPT_SERVER_PRICE"
      ? (row.rejectionAction as RejectionAction)
      : actionForSyncRejection(reason);
  return { reason, message, resubmittable, details, action };
}

// -- outbox read helpers (reads only — writes stay sync-core's) --------------------

/** Map a raw outbox row (snake_case columns) onto the public OutboxRow. */
export function readOutboxRow(row: Record<string, unknown> | undefined): OutboxRow | undefined {
  if (row === undefined) return undefined;
  const read = (key: string): unknown => {
    const value = row[key];
    return value === undefined ? null : value;
  };
  return {
    commandId: String(read("command_id")),
    entityType: String(read("entity_type")),
    intent: String(row.intent),
    payload: String(row.payload),
    idempotencyKey: String(read("idempotency_key")),
    baseVersion: (() => {
      const value = read("base_version");
      return value === null ? null : Number(value);
    })(),
    clientCreatedAt: String(read("client_created_at")),
    localRef: (() => {
      const value = read("local_ref");
      return value === null ? null : String(value);
    })(),
    status: row.status as OutboxRow["status"],
    attempts: Number(row.attempts ?? 0),
    nextAttemptAt: (() => {
      const value = read("next_attempt_at");
      return value === null ? 0 : Number(value);
    })(),
    lastError: (() => {
      const value = read("last_error");
      return value === null ? null : String(value);
    })(),
    lastAttemptAt: (() => {
      const value = read("last_attempt_at");
      return value === null ? null : String(value);
    })(),
    acceptedResult: (() => {
      const value = read("accepted_result");
      return value === null ? null : String(value);
    })(),
    rejectionReason: (() => {
      const value = read("rejection_reason");
      return value === null ? null : String(value);
    })(),
    rejectionAction: (() => {
      const value = read("rejection_action");
      return value === null ? null : String(value);
    })(),
    officialNo: (() => {
      const value = read("official_no");
      return value === null ? null : String(value);
    })(),
    ackedAt: (() => {
      const value = read("acked_at");
      return value === null ? null : String(value);
    })(),
  };
}

/** One flow document's outbox row by command id (undefined → DRAFT_LOCAL). */
export function flowRowByCommandId(
  adapter: StorageAdapter,
  commandId: string,
): OutboxRow | undefined {
  return readOutboxRow(adapter.get("SELECT * FROM outbox WHERE command_id = ?", [commandId]));
}

/** Every outbox row for a flow's entityType:intent (newest first). */
export function flowRows(
  adapter: StorageAdapter,
  entityType: string,
  intent: string,
): OutboxRow[] {
  return adapter
    .all("SELECT * FROM outbox WHERE entity_type = ? AND intent = ?", [entityType, intent])
    .map((row) => readOutboxRow(row))
    .filter((row): row is OutboxRow => row !== undefined)
    .sort((a, b) => b.clientCreatedAt.localeCompare(a.clientCreatedAt) || b.commandId.localeCompare(a.commandId));
}

// -- the shared flow context ---------------------------------------------------------

/**
 * The field device context every flow save consumes (§8 "capture rep/device
 * attribution + van warehouse context"): identity (offline numbering + the
 * envelope attribution the server stamps), the rep's van (advisory scope),
 * the cash account (collections), the tenant base currency (advisory — the
 * server derives currency per document), and the business date (advisory —
 * CONFLICT_RESOLUTION §5: server time is authoritative for business dates).
 */
export interface FieldFlowContext {
  /** The enrolled device id (the offline sequence's terminal id). */
  readonly deviceId: string;
  /** A short device code for the OFF- local refs (e.g. "F01"). */
  readonly deviceCode: string;
  /** The rep's van warehouse (the route context) — van-stock advisory scope. */
  readonly vanWarehouseId?: string | null;
  /** The rep's sales-rep id — display context only (attribution is server-side). */
  readonly salesRepId?: string | null;
  /** The rep's cash account (the collection target; the rep context's configured account). */
  readonly cashAccountId?: string;
  /** The tenant base currency (advisory — collections' currencyCode default). */
  readonly currencyCode?: string;
  /** The business date YYYY-MM-DD (advisory; defaults to the device's today). */
  readonly today?: string;
}

/** The context's resolved business date (device clock — advisory only). */
export function contextToday(ctx: FieldFlowContext): string {
  if (ctx.today !== undefined && /^\d{4}-\d{2}-\d{2}$/.test(ctx.today)) return ctx.today;
  return new Date().toISOString().slice(0, 10);
}

/** The per-flow command-registry keys this wave owns (the §8 intent set). */
export const FIELD_FLOW_INTENTS: readonly { entityType: string; intent: string; machine: FlowMachineKind }[] = [
  // Row 6 LOCAL-VALID† — the van-sale draft invoice.
  { entityType: "sales_invoice", intent: "create_draft", machine: "draft" },
  // Row 9 OFFLINE-COMPLETE — the field collection receipt.
  { entityType: "receipt", intent: "create_field_collection", machine: "sync" },
  // Row 12 OFFLINE-COMPLETE — the van load/unload confirmations.
  { entityType: "van", intent: "confirm_load", machine: "sync" },
  { entityType: "van", intent: "confirm_unload", machine: "sync" },
  // Row 27 OFFLINE-DRAFT — the van-return credit note.
  { entityType: "credit_note", intent: "create_draft", machine: "draft" },
  // Row 11 OFFLINE-DRAFT — the stock-count line submission.
  { entityType: "stock_count", intent: "submit_lines", machine: "draft" },
];
