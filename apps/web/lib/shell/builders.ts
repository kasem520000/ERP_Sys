"use client";
/**
 * PHASE-021 T2-b (DR-P21-06/§6) — thin per-intent command builders for the
 * webview console. Every builder:
 *   1. zod-validates the payload against the FROZEN @erp/contracts
 *      desktop-intents schema (a schema failure throws the zod error —
 *      the forms map issues to per-field AR/EN messages before this point
 *      anyway; this is the second, honest guard), and
 *   2. wraps sync-core's `buildSyncCommandV2` with the SAME idempotencyKey
 *      vocabulary the 020 builders use (`{entityType}:{intent}:{uuid}`) —
 *      a resend generates a NEW key by construction (fresh uuid), which
 *      is exactly "new commandId + fresh idempotencyKey, same entity id"
 *      (CONFLICT_RESOLUTION §3).
 * The 020 builders (draft invoice + contact merge) are RE-EXPORTED
 * verbatim — the console consumes them through this module only.
 */
import {
  cashTransferCreateDraftPayloadSchema,
  deliveryNoteCreateDraftPayloadSchema,
  expenseCreatePayloadSchema,
  partnerCreatePayloadSchema,
  quotationCreateDraftPayloadSchema,
  stockCountSubmitLinesPayloadSchema,
  stockTransferCreateDraftPayloadSchema,
  type CashTransferCreateDraftPayload,
  type DeliveryNoteCreateDraftPayload,
  type ExpenseCreatePayload,
  type PartnerCreatePayload,
  type QuotationCreateDraftPayload,
  type StockCountSubmitLinesPayload,
  type StockTransferCreateDraftPayload,
} from "@erp/contracts";
import {
  buildDraftInvoiceCreate,
  buildPartnerContactMerge,
  buildSyncCommandV2,
  type SyncCommandV2Envelope,
} from "@erp/sync-core";

// -- the 020 builders, re-exported verbatim ------------------------------------------

export { buildDraftInvoiceCreate, buildPartnerContactMerge };
export type { SyncCommandV2Envelope };

/**
 * A fresh v4-shaped id for idempotencyKey tails: `crypto.randomUUID` in
 * every real runtime (browser/Node), with a getRandomValues fallback for
 * older jsdom builds — never a counter, never deterministic (a resend MUST
 * mint a fresh key; CONFLICT_RESOLUTION §3).
 */
function freshId(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  bytes[6] = (bytes[6]! & 0x0f) | 0x40;
  bytes[8] = (bytes[8]! & 0x3f) | 0x80;
  const hex = Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

// -- the seven DR-P21-08 desktop intents ---------------------------------------------

/** `partner:create` (SD; matrix row 23) — codes auto-number server-side
 * when omitted (BR-025); contact child rows ride contact_merge, never
 * this payload. */
export function buildPartnerCreate(payload: PartnerCreatePayload): SyncCommandV2Envelope {
  const parsed = partnerCreatePayloadSchema.parse(payload);
  return buildSyncCommandV2({
    entityType: "partner",
    intent: "create",
    payload: parsed,
    idempotencyKey: `partner:create:${freshId()}`,
  });
}

/** `quotation:create_draft` (OD-create; matrix row 7) — unitPrice null ⇒
 * the server resolves the price (BR-003): the draft never trusts a stale
 * cached price silently. */
export function buildQuotationCreateDraft(payload: QuotationCreateDraftPayload): SyncCommandV2Envelope {
  const parsed = quotationCreateDraftPayloadSchema.parse(payload);
  return buildSyncCommandV2({
    entityType: "quotation",
    intent: "create_draft",
    payload: parsed,
    idempotencyKey: `quotation:create_draft:${freshId()}`,
  });
}

/** `delivery_note:create_draft` (SD-at-submit; matrix row 10) — draft
 * creation writes no stock and no COGS; planIssue/G-03 run at POST online. */
export function buildDeliveryNoteCreateDraft(payload: DeliveryNoteCreateDraftPayload): SyncCommandV2Envelope {
  const parsed = deliveryNoteCreateDraftPayloadSchema.parse(payload);
  return buildSyncCommandV2({
    entityType: "delivery_note",
    intent: "create_draft",
    payload: parsed,
    idempotencyKey: `delivery_note:create_draft:${freshId()}`,
  });
}

/** `expense:create` (SD; matrix row 25) — DRAFT lifecycle server-side;
 * receiptFileId stays null offline (no offline uploads). */
export function buildExpenseCreate(payload: ExpenseCreatePayload): SyncCommandV2Envelope {
  const parsed = expenseCreatePayloadSchema.parse(payload);
  return buildSyncCommandV2({
    entityType: "expense",
    intent: "create",
    payload: parsed,
    idempotencyKey: `expense:create:${freshId()}`,
  });
}

/** `cash_transfer:create_draft` (SD; matrix row 34) — the fee F < A rule,
 * currency match, and distinct accounts are the server's decisions. */
export function buildCashTransferCreateDraft(payload: CashTransferCreateDraftPayload): SyncCommandV2Envelope {
  const parsed = cashTransferCreateDraftPayloadSchema.parse(payload);
  return buildSyncCommandV2({
    entityType: "cash_transfer",
    intent: "create_draft",
    payload: parsed,
    idempotencyKey: `cash_transfer:create_draft:${freshId()}`,
  });
}

/** `stock_transfer:create_draft` (SD; matrix row 26) — one line per item;
 * batch binding happens at dispatch (FEFO), never at draft. */
export function buildStockTransferCreateDraft(payload: StockTransferCreateDraftPayload): SyncCommandV2Envelope {
  const parsed = stockTransferCreateDraftPayloadSchema.parse(payload);
  return buildSyncCommandV2({
    entityType: "stock_transfer",
    intent: "create_draft",
    payload: parsed,
    idempotencyKey: `stock_transfer:create_draft:${freshId()}`,
  });
}

/** `stock_count:submit_lines` (SD-aggregate; matrix row 11) — counted
 * quantities are facts; variance/adjustment posting is server-only. */
export function buildStockCountSubmitLines(payload: StockCountSubmitLinesPayload): SyncCommandV2Envelope {
  const parsed = stockCountSubmitLinesPayloadSchema.parse(payload);
  return buildSyncCommandV2({
    entityType: "stock_count",
    intent: "submit_lines",
    payload: parsed,
    idempotencyKey: `stock_count:submit_lines:${freshId()}`,
  });
}
