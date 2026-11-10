import { z } from "zod";

import {
  FX_RATE_PATTERN,
  ISO_DATE_PATTERN,
  MONEY_AMOUNT_PATTERN,
  QUANTITY_PATTERN,
} from "../wire";

/**
 * PHASE-021 · DR-P21-08 · the desktop write-intent payload schemas
 * (MASTER-PLAN §6 table; OFFLINE_CAPABILITIES_MATRIX rows 7/10/11/25/26/34).
 *
 * ADDITIVE, VERSION-FROZEN: these are per-intent payload schemas that ride
 * the EXISTING v2 command envelope (syncCommandSchema — `entityType:intent`
 * names the handler, `payload` is validated here). The envelope, the pull
 * shape, SYNC_CONTRACT_VERSION ("2026-11-04.1") and SYNC_REJECTION_REASONS
 * are untouched; each schema accepts EXACTLY what the OWNING module
 * service's create/draft path consumes (minus server-side fields like
 * actor/tenant/branch/currency — the server derives those), so the handler
 * is transport and never a second business-logic path.
 *
 * CREATE-draft only (DR-P21-08): no offline UPDATE intents exist for these
 * entity types — non-owner edits are simply not offered offline (only the
 * sales-invoice pair keeps 020's create+update OWNER_DEVICE_WINS shape).
 *
 * Money/qty travel as canonical decimal strings (ADR-0009): money ≤ 4 dp
 * (numeric(19,4)), qty ≤ 6 dp (numeric(19,6)), rates ≤ 8 dp.
 */

const money = z.string().regex(MONEY_AMOUNT_PATTERN);
const qty = z.string().regex(QUANTITY_PATTERN);
const fxRate = z.string().regex(FX_RATE_PATTERN);
const isoDate = z.string().regex(ISO_DATE_PATTERN);
/** Unit prices: non-negative money-shaped decimals ≤ 6 dp (the sales services' PRICE_RE). */
const unitPrice = z.string().regex(/^\d{1,15}(\.\d{1,6})?$/);
/** Counted quantities: NON-NEGATIVE decimals ≤ 6 dp (a counted zero is a legitimate count). */
const countedQty = z.string().regex(/^\d{1,15}(\.\d{1,6})?$/);

// -- partner:create (SD · PartnerService.create) ------------------------------------

/**
 * `partner:create` (SERVER_DECIDES; MASTER-PLAN §6 row 1): the partner
 * directory record exactly as PartnerService.create consumes it (BR-025:
 * codes auto-number tenant-wide when `code` is omitted, manual codes must
 * be unique; creditTermsId/priceListId are validated by the owning
 * service). Contact/address child rows are NOT part of create — they ride
 * the 020 `partner:contact_merge` intent (their owning surface); no
 * second path is added here.
 */
export const partnerCreatePayloadSchema = z.object({
  kind: z.enum(["CUSTOMER", "SUPPLIER", "BOTH"]),
  code: z.string().min(1).max(40).optional(),
  name: z.string().min(1).max(200),
  nameAr: z.string().max(200).nullable().optional(),
  taxNumber: z.string().max(200).nullable().optional(),
  creditLimit: money.nullable().optional(),
  creditTermsId: z.string().uuid().nullable().optional(),
  priceListId: z.string().uuid().nullable().optional(),
});

export type PartnerCreatePayload = z.infer<typeof partnerCreatePayloadSchema>;

// -- quotation:create_draft (OD-create · QuotationService.create) --------------------

/**
 * The quotation line (mirrors QuotationLineInput): `unitPrice` omitted or
 * null → the server resolves the sales price (BR-003) — the offline draft
 * never trusts a stale cached price silently.
 */
const quotationLineSchema = z.object({
  itemId: z.string().uuid(),
  qty,
  unitPrice: unitPrice.nullable().optional(),
  discountAmount: money.nullable().optional(),
  taxCodeId: z.string().uuid().nullable().optional(),
  description: z.string().max(500).nullable().optional(),
  descriptionAr: z.string().max(500).nullable().optional(),
  note: z.string().max(500).nullable().optional(),
});

/**
 * `quotation:create_draft` (OWNER_DEVICE_WINS-create; MASTER-PLAN §6
 * row 2): the DRAFT quotation aggregate the desktop captured offline.
 * `customerId` names the 020 draft-invoice vocabulary (the quotations
 * table column is customer_id); `validUntil` omitted → the service
 * derives it from sales.quote_default_validity_days (BR-006); quotations
 * carry no tax snapshot (resolution happens at order/invoice time).
 */
export const quotationCreateDraftPayloadSchema = z.object({
  customerId: z.string().uuid(),
  quoteDate: isoDate,
  validUntil: isoDate.nullable().optional(),
  note: z.string().max(500).nullable().optional(),
  noteAr: z.string().max(500).nullable().optional(),
  lines: z.array(quotationLineSchema).min(1).max(200),
});

export type QuotationCreateDraftPayload = z.infer<typeof quotationCreateDraftPayloadSchema>;

// -- delivery_note:create_draft (SD-at-submit · DeliveryNoteService.create) -----------

const deliveryLineSchema = z.object({
  itemId: z.string().uuid(),
  qty,
  unitPrice: unitPrice.nullable().optional(),
  discountAmount: money.nullable().optional(),
  batchId: z.string().uuid().nullable().optional(),
  serialIds: z.array(z.string().uuid()).nullable().optional(),
  description: z.string().max(500).nullable().optional(),
  note: z.string().max(500).nullable().optional(),
});

/**
 * `delivery_note:create_draft` (SERVER_DECIDES-at-submit; MASTER-PLAN §6
 * row 3): the DRAFT delivery-note aggregate. Draft creation writes no
 * stock and no COGS — planIssue/applyIssue + the G-03 journal run at
 * POST time online (SD-at-submit). Offline drafts are standalone
 * (order-line binding is the online order-linked flow; `orderId` may
 * reference an ISSUED order for a header-level link).
 */
export const deliveryNoteCreateDraftPayloadSchema = z.object({
  customerId: z.string().uuid(),
  warehouseId: z.string().uuid(),
  orderId: z.string().uuid().nullable().optional(),
  deliveryDate: isoDate,
  note: z.string().max(500).nullable().optional(),
  noteAr: z.string().max(500).nullable().optional(),
  lines: z.array(deliveryLineSchema).min(1).max(200),
});

export type DeliveryNoteCreateDraftPayload = z.infer<typeof deliveryNoteCreateDraftPayloadSchema>;

// -- expense:create (SD · ExpenseService.create) --------------------------------------

/**
 * `expense:create` (SERVER_DECIDES; MASTER-PLAN §6 row 4): the DRAFT
 * expense claim exactly as ExpenseService.create consumes it (BR-023 —
 * DRAFT → PENDING_APPROVAL → APPROVED → POSTED is the server's lifecycle;
 * payout posting is online-only). `receiptFileId` stays null offline (no
 * file uploads offline — the receipt attaches online before submit).
 */
export const expenseCreatePayloadSchema = z.object({
  categoryId: z.string().uuid(),
  cashAccountId: z.string().uuid(),
  payeeName: z.string().min(1).max(160),
  currencyCode: z.string().length(3),
  amount: money,
  exchangeRate: fxRate.nullable().optional(),
  taxCodeId: z.string().uuid().nullable().optional(),
  receiptFileId: z.string().uuid().nullable().optional(),
  valueDate: isoDate,
  description: z.string().max(500).nullable().optional(),
  descriptionAr: z.string().max(500).nullable().optional(),
});

export type ExpenseCreatePayload = z.infer<typeof expenseCreatePayloadSchema>;

// -- cash_transfer:create_draft (SD · treasury TransferService.create) ----------------

/**
 * `cash_transfer:create_draft` (SERVER_DECIDES; MASTER-PLAN §6 row 5):
 * the DRAFT account↔account transfer (G-12 posts online; the fee F < A
 * rule, the currency match and the distinct-accounts shape are the
 * server's). `feeAmount` omitted → "0.0000".
 */
export const cashTransferCreateDraftPayloadSchema = z.object({
  fromAccountId: z.string().uuid(),
  toAccountId: z.string().uuid(),
  currencyCode: z.string().length(3),
  amount: money,
  feeAmount: money.optional(),
  exchangeRate: fxRate.nullable().optional(),
  valueDate: isoDate,
  reference: z.string().max(200).nullable().optional(),
  description: z.string().max(500).nullable().optional(),
  descriptionAr: z.string().max(500).nullable().optional(),
});

export type CashTransferCreateDraftPayload = z.infer<typeof cashTransferCreateDraftPayloadSchema>;

// -- stock_transfer:create_draft (SD · inventory TransferService.create) --------------

const stockTransferLineSchema = z.object({
  itemId: z.string().uuid(),
  qty,
});

/**
 * `stock_transfer:create_draft` (SERVER_DECIDES; MASTER-PLAN §6 row 6):
 * the DRAFT two-leg stock transfer (BR-016/G-15 — dispatch/receive post
 * the OUT/IN legs online). One line per item (the service's uniqueness
 * rule); batch binding happens at dispatch (FEFO), never at draft.
 */
export const stockTransferCreateDraftPayloadSchema = z.object({
  fromWarehouseId: z.string().uuid(),
  toWarehouseId: z.string().uuid(),
  lines: z.array(stockTransferLineSchema).min(1).max(200),
  note: z.string().max(500).nullable().optional(),
  noteAr: z.string().max(500).nullable().optional(),
});

export type StockTransferCreateDraftPayload = z.infer<typeof stockTransferCreateDraftPayloadSchema>;

// -- stock_count:submit_lines (SD-aggregate · CountService.enterCounts) ---------------

const stockCountLineSchema = z.object({
  itemId: z.string().uuid(),
  countedQty,
  /** Batch disambiguator for multi-batch items (matches the session line's batch). */
  batchRef: z.string().uuid().nullable().optional(),
});

/**
 * `stock_count:submit_lines` (SERVER_DECIDES-aggregate; MASTER-PLAN §6
 * row 7): the counted lines for an EXISTING count session (sessions are
 * created online — the system-qty snapshot is frozen server-side at
 * session start). The handler resolves each (itemId, batchRef) to the
 * session's line and applies them through CountService.enterCounts (the
 * blind-safe line-entry path); submit/review/approve stay online
 * server decisions. A counted qty of 0 is legitimate (loss).
 */
export const stockCountSubmitLinesPayloadSchema = z.object({
  countId: z.string().uuid(),
  lines: z.array(stockCountLineSchema).min(1).max(500),
});

export type StockCountSubmitLinesPayload = z.infer<typeof stockCountSubmitLinesPayloadSchema>;
