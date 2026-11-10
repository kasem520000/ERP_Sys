import { z } from "zod";

import {
  FX_RATE_PATTERN,
  ISO_DATE_PATTERN,
  MONEY_AMOUNT_PATTERN,
  QUANTITY_PATTERN,
} from "../wire";

/**
 * PHASE-022 · DR-P22-06 · the field write-intent payload schemas
 * (MASTER-PLAN §6 + §1 DR-P22-06; OFFLINE_CAPABILITIES_MATRIX rows 9/12/27
 * android-field). The 022 counterpart of desktop-intents (DR-P21-08):
 *
 * - `receipt:create_field_collection` (row 9, OFFLINE-COMPLETE, SD):
 *   the field rep's money-in collection, POSTED at sync through the
 *   treasury module's ReceiptService create→post chain (G-05; the posting
 *   engine owns period locks + the INV-013 operation key).
 * - `van:confirm_load` + `van:confirm_unload` (row 12, OFFLINE-COMPLETE,
 *   SD, against the van snapshot): the two van-ledger confirmations over
 *   the distribution module's VanStockService (the PHASE-017 two-leg
 *   transfer chain; the van_stocks mirror is the snapshot).
 * - `credit_note:create_draft` (row 27, OFFLINE-DRAFT, SD):
 *   the van-return DRAFT credit note through the sales module's
 *   CreditNoteService.create — OD draft semantics, no posting (like
 *   draft-invoice for sales invoices).
 *
 * ADDITIVE, VERSION-FROZEN (the DR-P21-08 rules verbatim): each schema
 * accepts EXACTLY what the OWNING module service's create/draft path
 * consumes (minus server-side fields like actor/tenant/branch/currency —
 * the server derives those), so the handler is transport and never a
 * second business-logic path. CREATE only — no offline update intents
 * exist for these types.
 *
 * Money/qty travel as canonical decimal strings (ADR-0009): money ≤ 4 dp
 * (numeric(19,4)), qty ≤ 6 dp (numeric(19,6)), rates ≤ 8 dp.
 */

const money = z.string().regex(MONEY_AMOUNT_PATTERN);
const qty = z.string().regex(QUANTITY_PATTERN);
const fxRate = z.string().regex(FX_RATE_PATTERN);
const isoDate = z.string().regex(ISO_DATE_PATTERN);
/** Advisory client timestamps (§7 clock skew): non-trusted, min-shape only —
 * the server derives every business date; the value date is server-final. */
const advisoryTimestamp = z.string().min(4).nullable().optional();

// -- receipt:create_field_collection (SD-at-sync · ReceiptService) -------------------

/**
 * The optional open-item allocations (the treasury module's
 * AllocationService.setAllocations input — INV-016/BR-027): a field
 * collection may settle specific posted invoices; omitted → fully
 * on-account (the field default — BR-027's explicit unallocated remainder).
 * Soft bounds here; the AUTHORITATIVE per-item enforcement runs at posting
 * under the CC-02 row lock (fx-settlement.validateAllocationsUnderLock).
 */
const receiptAllocationSchema = z.object({
  openItemId: z.string().uuid(),
  amount: money,
});

/**
 * `receipt:create_field_collection` (SERVER_DECIDES-at-sync; MASTER-PLAN §6
 * row 9): the collection exactly as ReceiptService.create consumes it
 * (cashAccountId + method ride the treasury account; the tenant base
 * currency is server-derived, `exchangeRate` only for FX collections).
 * `valueDate` is the server-final business date (period locks + the RCV
 * numbering ride it); `collectedAt` is the advisory capture moment (audit
 * provenance only). `payerName` omitted → the partner's name at render.
 */
export const receiptCreateFieldCollectionPayloadSchema = z.object({
  partnerId: z.string().uuid(),
  cashAccountId: z.string().uuid(),
  method: z.enum(["CASH", "BANK", "CHEQUE", "CARD", "TRANSFER"]),
  currencyCode: z.string().length(3),
  amount: money,
  exchangeRate: fxRate.nullable().optional(),
  valueDate: isoDate,
  collectedAt: advisoryTimestamp,
  reference: z.string().max(80).nullable().optional(),
  payerName: z.string().max(200).nullable().optional(),
  description: z.string().max(500).nullable().optional(),
  descriptionAr: z.string().max(500).nullable().optional(),
  allocations: z.array(receiptAllocationSchema).max(50).optional(),
});

export type ReceiptCreateFieldCollectionPayload = z.infer<
  typeof receiptCreateFieldCollectionPayloadSchema
>;

// -- van:confirm_load / van:confirm_unload (SD-at-sync · VanStockService) ------------

/**
 * `van:confirm_load` (SERVER_DECIDES-at-sync; MASTER-PLAN §6 row 12):
 * the field rep confirms an ALREADY-DISPATCHED load transfer landed in the
 * van (the warehouse created + dispatched it online; BR-016 in-transit is
 * never sellable until this confirmation receives the IN leg). The
 * transfer IS the load document — its lines are the load; the device only
 * confirms, so the payload carries the transfer reference + the advisory
 * moment. A double-confirm (already POSTED) rejects STALE_VERSION; a
 * not-yet-dispatched transfer rejects VALIDATION_ERROR.
 */
export const vanConfirmLoadPayloadSchema = z.object({
  transferId: z.string().uuid(),
  confirmedAt: advisoryTimestamp,
});

export type VanConfirmLoadPayload = z.infer<typeof vanConfirmLoadPayloadSchema>;

/**
 * The unload line (mirrors VanStockService.unload's line input): one line
 * per item (the transfer service's uniqueness rule), qty in the item's
 * base unit — the service resolves batches/slices server-side (FEFO).
 */
const vanUnloadLineSchema = z.object({
  itemId: z.string().uuid(),
  qty,
});

/**
 * `van:confirm_unload` (SERVER_DECIDES-at-sync; MASTER-PLAN §6 row 12):
 * the end-of-day return — VanStockService.unload creates + dispatches the
 * reverse-direction transfer (van → main warehouse), which issues the OUT
 * leg from the CURRENT van snapshot. Unload beyond the current van
 * quantity rejects INSUFFICIENT_STOCK (machine-readable `availableQty` in
 * details); an inactive item rejects ITEM_INACTIVE.
 */
export const vanConfirmUnloadPayloadSchema = z.object({
  vanWarehouseId: z.string().uuid(),
  toWarehouseId: z.string().uuid(),
  lines: z.array(vanUnloadLineSchema).min(1).max(200),
  note: z.string().max(500).nullable().optional(),
  noteAr: z.string().max(500).nullable().optional(),
  confirmedAt: advisoryTimestamp,
});

export type VanConfirmUnloadPayload = z.infer<typeof vanConfirmUnloadPayloadSchema>;

// -- credit_note:create_draft (OD-create · CreditNoteService) ------------------------

/**
 * The credit-note line (mirrors CreditNoteLineInput): lines reference the
 * POSTED invoice's own lines (`invoiceLineId` — the server derives the
 * item, the original price and the issue-cost snapshot from it;
 * `unitPrice`/`taxCodeId` omitted → the invoice line's values). The
 * `reason` field of the brief maps to the line/header notes.
 */
const creditNoteLineSchema = z.object({
  invoiceLineId: z.string().uuid(),
  qty,
  unitPrice: z.string().regex(/^\d{1,15}(\.\d{1,6})?$/).nullable().optional(),
  discountAmount: money.nullable().optional(),
  taxCodeId: z.string().uuid().nullable().optional(),
  returnToStock: z.boolean(),
  batchId: z.string().uuid().nullable().optional(),
  serialIds: z.array(z.string().uuid()).nullable().optional(),
  description: z.string().max(500).nullable().optional(),
  descriptionAr: z.string().max(500).nullable().optional(),
  note: z.string().max(500).nullable().optional(),
});

/**
 * `credit_note:create_draft` (OWNER_DEVICE_WINS-create; MASTER-PLAN §6
 * row 27): the DRAFT van-return credit note exactly as
 * CreditNoteService.create consumes it. `invoiceId` is REQUIRED — the
 * service references POSTED invoices only (BR-004 return window, INV-016
 * outstanding bound); the customer is derived from the invoice server-side
 * (never trusted from the device). No posting: DRAFT_LOCAL → DRAFT, the
 * submit/approve/post lifecycle stays online (OD draft semantics — the
 * draft-invoice pattern).
 */
export const creditNoteCreateDraftPayloadSchema = z.object({
  invoiceId: z.string().uuid(),
  noteDate: isoDate,
  note: z.string().max(500).nullable().optional(),
  noteAr: z.string().max(500).nullable().optional(),
  lines: z.array(creditNoteLineSchema).min(1).max(200),
});

export type CreditNoteCreateDraftPayload = z.infer<typeof creditNoteCreateDraftPayloadSchema>;
