/**
 * PHASE-022 T-P22-3-b · the parked-rejection actions (docs/offline/
 * CONFLICT_RESOLUTION §3 — THE TABLE, EXACTLY): per typed rejection code
 * → the fixed user-action set; the executors that apply a choice; and
 * the local audit trail that records EVERY choice with the rejecting
 * response's traceId.
 *
 * §3's rules, implemented verbatim:
 *   - resending produces a NEW command with a new `commandId` but the
 *     SAME entity id (the edited payload keeps its identity fields) and a
 *     FRESH `idempotencyKey` WHEN THE PAYLOAD CHANGED (unchanged payload
 *     → the SAME key: the server dedupes the replay);
 *   - cancel = void the pending document + keep the audit record;
 *   - accept-server-price = recompute the payload from the server's
 *     prices, then resend;
 *   - DEVICE_REVOKED / TENANT_SUSPENDED = NO resubmission (the
 *     administrative surface — §SECURITY_AND_DEVICE_MANAGEMENT §3);
 *   - "unknown reason" is not a valid UX state: the registry fallback
 *     shows message + traceId + the support hint (ERROR_MODEL §5).
 *
 * Writes go through sync-core's `enqueue`/`cancel` UNMODIFIED (the
 * fieldsales/van-sale.ts usage shape); the audit trail is a small
 * meta-backed list (choice + code + action + traceId + the new commandId
 * — the "keep simple" reading of the brief).
 */
import { generateUuidV7 } from "@erp/domain-core";
import {
  cancel,
  enqueue,
  metaGet,
  metaSet,
  type OutboxRow,
  type StorageAdapter,
} from "@erp/sync-core";

import { minDecimals } from "../exact-decimal";
import type { Dictionary } from "../i18n";

/** The §3 user actions (the exact §3 vocabulary). */
export type ParkedActionCode =
  | "EDIT_AND_RESEND"
  | "ACCEPT_SERVER_PRICE"
  | "ACCEPT_PARTIAL"
  | "CANCEL"
  | "SUBSTITUTE_AND_RESEND"
  | "REVIEW_AND_MERGE"
  | "DISCARD"
  | "REQUEST_APPROVAL_ONLINE";

/** The §3 table — code → the REQUIRED action set (exact, ordered). */
export const REJECTION_ACTION_TABLE: Readonly<Record<string, readonly ParkedActionCode[]>> = {
  PERIOD_LOCKED: ["EDIT_AND_RESEND", "CANCEL"],
  PRICE_CHANGED: ["ACCEPT_SERVER_PRICE", "EDIT_AND_RESEND", "CANCEL"],
  INSUFFICIENT_STOCK: ["EDIT_AND_RESEND", "ACCEPT_PARTIAL", "CANCEL"],
  CREDIT_LIMIT_EXCEEDED: ["EDIT_AND_RESEND", "REQUEST_APPROVAL_ONLINE", "CANCEL"],
  STALE_VERSION: ["REVIEW_AND_MERGE", "DISCARD"],
  ITEM_INACTIVE: ["CANCEL", "SUBSTITUTE_AND_RESEND"],
  PARTNER_INACTIVE: ["CANCEL", "SUBSTITUTE_AND_RESEND"],
  VALIDATION_ERROR: ["EDIT_AND_RESEND"],
  // §3's last row: "No resubmission: surface administrative state, stop
  // sync" — no user actions exist for these codes.
  DEVICE_REVOKED: [],
  TENANT_SUSPENDED: [],
};

/** The §3 code classification (administrative vs decision vs fallback). */
export interface ParkedActionSet {
  /** The raw rejection code ("UNKNOWN" when unrecognized). */
  readonly code: string;
  /** The §3-required action set ([] for administrative codes). */
  readonly actions: readonly ParkedActionCode[];
  /** DEVICE_REVOKED / TENANT_SUSPENDED — no resubmission, administrative. */
  readonly administrative: boolean;
  /** An unrecognized code — the registry fallback (message + traceId +
   * support hint, ERROR_MODEL §5); "unknown reason" is not a UX state. */
  readonly fallback: boolean;
}

/**
 * Resolve the §3 action set for a rejection code. The §3 table is
 * EXACT: every listed code maps to its fixed action list; the §3
 * administrative codes have NO actions; anything else (engine codes like
 * DUPLICATE_COMMAND, garbage, a future server's new code) is the
 * FALLBACK — message + traceId + support, never a guessed action.
 */
export function actionsForRejectionCode(code: string): ParkedActionSet {
  const actions = REJECTION_ACTION_TABLE[code];
  if (actions !== undefined) {
    return {
      code,
      actions,
      administrative: code === "DEVICE_REVOKED" || code === "TENANT_SUSPENDED",
      fallback: false,
    };
  }
  return { code: "UNKNOWN", actions: [], administrative: false, fallback: true };
}

/** The i18n label key per §3 user action (the action* vocabulary). */
export function parkedActionLabelKey(action: ParkedActionCode): keyof Dictionary {
  switch (action) {
    case "EDIT_AND_RESEND":
      return "actionEditAndResend";
    case "ACCEPT_SERVER_PRICE":
      return "actionAcceptServerPrice";
    case "ACCEPT_PARTIAL":
      return "actionAcceptPartial";
    case "CANCEL":
      return "actionCancel";
    case "SUBSTITUTE_AND_RESEND":
      return "actionSubstituteAndResend";
    case "REVIEW_AND_MERGE":
      return "actionReviewAndMerge";
    case "DISCARD":
      return "actionDiscard";
    case "REQUEST_APPROVAL_ONLINE":
      return "actionRequestApproval";
  }
}

// -- the local audit trail (a small meta-backed list — keep simple) -----------------

/** The meta key holding the rejection-decision audit list. */
export const REJECTION_AUDIT_META_KEY = "rejectionAudit";

/** The audit list cap (oldest entries drop off; the trail is bounded). */
export const REJECTION_AUDIT_CAP = 100;

/** One audited user choice on a rejected command. */
export interface RejectionAuditEntry {
  /** When the choice was made (device clock — advisory, CONFLICT §5). */
  readonly at: string;
  readonly code: string;
  readonly action: ParkedActionCode | "FALLBACK";
  /** The REJECTED command the choice was made about. */
  readonly commandId: string;
  /** The command's entity identity (payload.invoiceId/entityId). */
  readonly entityId: string | null;
  /** The rejecting response's traceId (null when the server sent none). */
  readonly traceId: string | null;
  /** The resend's NEW commandId (EDIT_AND_RESEND family only). */
  readonly newCommandId: string | null;
}

/** Read the rejection-decision audit trail (oldest → newest). */
export function rejectionAuditTrail(adapter: StorageAdapter): RejectionAuditEntry[] {
  const raw = metaGet(adapter, REJECTION_AUDIT_META_KEY);
  if (raw === null) return [];
  try {
    const parsed = JSON.parse(raw) as unknown;
    return Array.isArray(parsed) ? (parsed as RejectionAuditEntry[]) : [];
  } catch {
    return [];
  }
}

/** Append one audited choice (bounded; runs inside the caller's write). */
function recordRejectionChoice(
  adapter: StorageAdapter,
  entry: RejectionAuditEntry,
): void {
  const trail = [...rejectionAuditTrail(adapter), entry].slice(-REJECTION_AUDIT_CAP);
  metaSet(adapter, REJECTION_AUDIT_META_KEY, JSON.stringify(trail));
}

// -- payload readers ----------------------------------------------------------------

function parsePayload(raw: string): Record<string, unknown> {
  try {
    const parsed = JSON.parse(raw) as unknown;
    return parsed !== null && typeof parsed === "object" ? (parsed as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}

/** The command's entity identity (the §3 "SAME entity id" key). */
export function entityIdOfPayload(payload: Record<string, unknown>): string | null {
  for (const key of ["entityId", "invoiceId", "partnerId", "itemId"]) {
    const value = payload[key];
    if (typeof value === "string" && value !== "") return value;
  }
  return null;
}

/** The rejecting response's traceId (details.traceId — the audit key). */
export function traceIdOfRow(row: OutboxRow): string | null {
  if (row.lastError === null) return null;
  try {
    const parsed = JSON.parse(row.lastError) as { details?: { traceId?: unknown } };
    const traceId = parsed?.details?.traceId;
    return typeof traceId === "string" && traceId !== "" ? traceId : null;
  } catch {
    return null;
  }
}

// -- the executors -------------------------------------------------------------------

/** Options every resend executor accepts (deterministic tests). */
export interface ResendOptions {
  /** The uuid generator for the NEW commandId / idempotencyKey. */
  readonly uuid?: () => string;
}

/** A resend's outcome: the NEW outbox row + whether the key rotated. */
export interface ResendOutcome {
  readonly row: OutboxRow;
  readonly newCommandId: string;
  readonly payloadChanged: boolean;
}

/**
 * EDIT_AND_RESEND — the §3 resend rule, exactly: ONE transaction that
 * enqueues the NEW command (new commandId; the SAME entity id — the
 * edited payload keeps its identity fields; a FRESH idempotencyKey —
 * §3 mandates it WHEN THE PAYLOAD CHANGED, and the local outbox's
 * UNIQUE(idempotency_key) plus the fact that a REJECTED command was
 * never executed server-side make a fresh key the correct reading for
 * an unchanged payload too: there is no accepted execution to dedupe
 * against), voids the rejected row, and audits the choice with the
 * rejecting traceId.
 */
export function editAndResend(
  adapter: StorageAdapter,
  row: OutboxRow,
  editedPayload: Record<string, unknown>,
  options: ResendOptions = {},
): ResendOutcome {
  const uuid = options.uuid ?? generateUuidV7;
  const payloadChanged = JSON.stringify(editedPayload) !== row.payload;
  const newCommandId = uuid();
  const idempotencyKey = `${row.entityType}:${row.intent}:${uuid()}`;
  const code = row.rejectionReason ?? "VALIDATION_ERROR";
  const payload = parsePayload(row.payload);
  return adapter.transaction(() => {
    const enqueued = enqueue(adapter, {
      entityType: row.entityType,
      intent: row.intent,
      payload: editedPayload,
      idempotencyKey,
      commandId: newCommandId,
      baseVersion: row.baseVersion,
      localRef: row.localRef,
    });
    // The rejected row is superseded by the new command — voided (the
    // §3 "keep audit record" rule: the row stays, CANCELLED, never
    // deleted; the audit entry below carries the linkage).
    cancel(adapter, row.commandId);
    recordRejectionChoice(adapter, {
      at: new Date().toISOString(),
      code,
      action: "EDIT_AND_RESEND",
      commandId: row.commandId,
      entityId: entityIdOfPayload(payload),
      traceId: traceIdOfRow(row),
      newCommandId,
    });
    return { row: enqueued, newCommandId, payloadChanged };
  });
}

/**
 * ACCEPT_SERVER_PRICE — recompute the payload from the server's prices
 * (each line's unitPrice replaced where the server sent one; any
 * explicit total recomputed from the lines), then the §3 resend.
 */
export function acceptServerPrice(
  adapter: StorageAdapter,
  row: OutboxRow,
  input: { serverPrices: Readonly<Record<string, string>> },
  options: ResendOptions = {},
): ResendOutcome {
  const payload = parsePayload(row.payload);
  if (Array.isArray(payload.lines)) {
    payload.lines = (payload.lines as Record<string, unknown>[]).map((line) => {
      const itemId = typeof line.itemId === "string" ? line.itemId : null;
      const serverPrice = itemId === null ? undefined : input.serverPrices[itemId];
      return serverPrice === undefined ? line : { ...line, unitPrice: serverPrice };
    });
  }
  return editAndResend(adapter, row, payload, options);
}

/**
 * ACCEPT_PARTIAL — reduce each line's qty to the server's available
 * quantity (never above it; zero-qty lines drop — a partial fulfillment
 * carries only the fulfillable lines), then the §3 resend.
 */
export function acceptPartial(
  adapter: StorageAdapter,
  row: OutboxRow,
  input: { availableQty: Readonly<Record<string, string>> },
  options: ResendOptions = {},
): ResendOutcome {
  const payload = parsePayload(row.payload);
  if (Array.isArray(payload.lines)) {
    payload.lines = (payload.lines as Record<string, unknown>[])
      .map((line) => {
        const itemId = typeof line.itemId === "string" ? line.itemId : null;
        const available = itemId === null ? undefined : input.availableQty[itemId];
        if (available === undefined || typeof line.qty !== "string") return line;
        return { ...line, qty: minDecimals(line.qty, available) };
      })
      .filter((line) => line.qty !== "0");
  }
  return editAndResend(adapter, row, payload, options);
}

/**
 * SUBSTITUTE_AND_RESEND — replace the deactivated master data (the line
 * items' itemId and/or the document's partner identity), then the §3
 * resend.
 */
export function substituteAndResend(
  adapter: StorageAdapter,
  row: OutboxRow,
  input: { itemId?: string; partnerId?: string },
  options: ResendOptions = {},
): ResendOutcome {
  const payload = parsePayload(row.payload);
  if (input.itemId !== undefined) {
    if (Array.isArray(payload.lines)) {
      payload.lines = (payload.lines as Record<string, unknown>[]).map((line) => ({
        ...line,
        itemId: input.itemId,
      }));
    }
    if (typeof payload.itemId === "string") payload.itemId = input.itemId;
  }
  if (input.partnerId !== undefined) {
    if (typeof payload.partnerId === "string") payload.partnerId = input.partnerId;
    if (typeof payload.customerId === "string") payload.customerId = input.partnerId;
  }
  return editAndResend(adapter, row, payload, options);
}

/** CANCEL — void the pending document, keep the audit record (§3). */
export function cancelRejected(
  adapter: StorageAdapter,
  row: OutboxRow,
  options: { reason?: string } = {},
): void {
  const payload = parsePayload(row.payload);
  adapter.transaction(() => {
    cancel(adapter, row.commandId);
    recordRejectionChoice(adapter, {
      at: new Date().toISOString(),
      code: row.rejectionReason ?? "VALIDATION_ERROR",
      action: "CANCEL",
      commandId: row.commandId,
      entityId: entityIdOfPayload(payload),
      traceId: traceIdOfRow(row),
      newCommandId: null,
    });
    void options.reason;
  });
}

/** DISCARD the local edit (STALE_VERSION's audited discard). */
export function discardRejected(adapter: StorageAdapter, row: OutboxRow): void {
  const payload = parsePayload(row.payload);
  adapter.transaction(() => {
    cancel(adapter, row.commandId);
    recordRejectionChoice(adapter, {
      at: new Date().toISOString(),
      code: row.rejectionReason ?? "VALIDATION_ERROR",
      action: "DISCARD",
      commandId: row.commandId,
      entityId: entityIdOfPayload(payload),
      traceId: traceIdOfRow(row),
      newCommandId: null,
    });
  });
}

/**
 * REQUEST_APPROVAL_ONLINE — §6.6 ONLINE-ONLY (CREDIT_LIMIT_EXCEEDED's
 * "request approval path online"): online → the choice is audited and
 * the shell links out; offline → REFUSED with the honest reason — never
 * queued (an approval decision cannot be made offline).
 */
export function requestApprovalOnline(
  adapter: StorageAdapter,
  row: OutboxRow,
  online: boolean,
): { ok: boolean; reason: "offline" | null } {
  if (!online) return { ok: false, reason: "offline" };
  const payload = parsePayload(row.payload);
  adapter.transaction(() => {
    recordRejectionChoice(adapter, {
      at: new Date().toISOString(),
      code: row.rejectionReason ?? "VALIDATION_ERROR",
      action: "REQUEST_APPROVAL_ONLINE",
      commandId: row.commandId,
      entityId: entityIdOfPayload(payload),
      traceId: traceIdOfRow(row),
      newCommandId: null,
    });
  });
  return { ok: true, reason: null };
}
