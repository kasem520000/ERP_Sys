/**
 * PHASE-022 T-P22-2-e · LOCAL-VALID† pre-validation against cached
 * snapshots (MASTER-PLAN §8 — BINDING; OFFLINE_CAPABILITIES_MATRIX row 6/35
 * LOCAL-VALID†; CONFLICT_RESOLUTION §1 rule 4: "Local validation is
 * advisory. LOCALLY-VALIDATED operations may pass locally and still be
 * rejected at sync; the UI never presents local validation as final").
 *
 * The two-lane rule (§8 verbatim): "advisory warnings never block (server
 * decides), but structural validation blocks" —
 *
 *   ADVISORY (never blocks — the server decision at sync is final):
 *     VAN_STOCK_LOW    line qty exceeds the CACHED van stock for the item
 *     PRICE_TOLERANCE  captured price deviates from the CACHED price by
 *                      more than PRICE_TOLERANCE_FIELD_PCT (2%) — the
 *                      server's PRICE_CHANGED fires beyond tolerance
 *     CREDIT_LIMIT     cached partner balance + this sale exceeds the
 *                      cached credit limit (Journey G edge — warn posture)
 *     ON_ACCOUNT       a collection amount exceeds the cached open balance
 *                      (BR-027: the remainder goes on-account — legitimate)
 *     SERIAL_REUSE     a serial is already carried by a PENDING_SYNC van
 *                      sale of THIS device (row 35: "uniqueness checked
 *                      against snapshot; server re-checks" — our own outbox
 *                      is the only snapshot a device honestly has)
 *     UNKNOWN_ITEM     the line's item is not in the pulled item cache
 *                      ("not on this device — pull first", errNotFound)
 *
 *   BLOCKING (structural — the document is malformed; save refuses):
 *     MISSING_PARTNER  a credit sale without a customer
 *     MISSING_ITEM     a line without an item
 *     MISSING_SERIAL   a serial-tracked item whose capture does not cover
 *                      the line qty (row 35 — one serial per unit)
 *     ZERO_QTY         a non-positive quantity
 *     MALFORMED_QTY    a qty that is not a canonical decimal string
 *     MALFORMED_PRICE  a unit price that is not a non-negative decimal
 *     MALFORMED_AMOUNT a money amount that is not a canonical decimal
 *     MALFORMED_DATE   a business date that is not ISO YYYY-MM-DD
 *     MALFORMED_ID     a reference that is not a UUID
 *
 * All money/qty math uses @erp/domain-core Decimal (ADR-0009 — never a JS
 * float). The snapshot readers below are the shared cached-snapshot
 * accessors EVERY flow module (van-sale/van-load/route-visits/collection)
 * reads through — one place per fact, money TEXT canonical decimal strings.
 */
import { Decimal } from "@erp/domain-core";
import type { StorageAdapter } from "@erp/sync-core";

import { PRICE_TOLERANCE_FIELD_PCT } from "../constants";
import type { Dictionary } from "../i18n";

// -- cached-snapshot readers (LOCAL_DATABASE §1.1 — the field subset) --------------

/** An items-cache row (the sync-core v1 projection). */
export interface ItemSnapshot {
  readonly id: string;
  readonly sku: string;
  readonly name: string;
  readonly nameAr: string | null;
  readonly basePrice: string | null;
  readonly trackBatch: boolean;
  readonly trackSerial: boolean;
  readonly trackImei: boolean;
  readonly status: string;
}

function toItemSnapshot(row: Record<string, unknown> | undefined): ItemSnapshot | undefined {
  if (row === undefined) return undefined;
  return {
    id: String(row.id),
    sku: String(row.sku ?? ""),
    name: String(row.name ?? ""),
    nameAr: row.name_ar === null || row.name_ar === undefined ? null : String(row.name_ar),
    basePrice: row.base_price === null || row.base_price === undefined ? null : String(row.base_price),
    trackBatch: Number(row.track_batch ?? 0) === 1,
    trackSerial: Number(row.track_serial ?? 0) === 1,
    trackImei: Number(row.track_imei ?? 0) === 1,
    status: String(row.status ?? ""),
  };
}

/** The item cache row (or undefined — an unknown item is a MISSING_ITEM). */
export function readItem(adapter: StorageAdapter, itemId: string): ItemSnapshot | undefined {
  return toItemSnapshot(adapter.get("SELECT * FROM items WHERE id = ?", [itemId]));
}

/** Resolve a scanned barcode to its item (the barcodes cache; code-first). */
export function resolveBarcodeItem(
  adapter: StorageAdapter,
  code: string,
): ItemSnapshot | undefined {
  const row = adapter.get("SELECT item_id FROM barcodes WHERE code = ?", [code]);
  if (row === undefined) return undefined;
  return readItem(adapter, String(row.item_id));
}

/** A partners-cache row (the sync-core v1 projection). */
export interface PartnerSnapshot {
  readonly id: string;
  readonly code: string;
  readonly name: string;
  readonly nameAr: string | null;
  readonly status: string;
  readonly creditLimit: string | null;
  readonly priceListId: string | null;
}

function toPartnerSnapshot(row: Record<string, unknown> | undefined): PartnerSnapshot | undefined {
  if (row === undefined) return undefined;
  return {
    id: String(row.id),
    code: String(row.code ?? ""),
    name: String(row.name ?? ""),
    nameAr: row.name_ar === null || row.name_ar === undefined ? null : String(row.name_ar),
    status: String(row.status ?? ""),
    creditLimit: row.credit_limit === null || row.credit_limit === undefined ? null : String(row.credit_limit),
    priceListId: row.price_list_id === null || row.price_list_id === undefined ? null : String(row.price_list_id),
  };
}

/** The partner cache row (or undefined). */
export function readPartner(adapter: StorageAdapter, partnerId: string): PartnerSnapshot | undefined {
  return toPartnerSnapshot(adapter.get("SELECT * FROM partners WHERE id = ?", [partnerId]));
}

/**
 * The CACHED unit price for an item sold to a partner: the partner's price
 * list entry (tier pricing, price_list_items) when one exists, else the
 * item's base price. Null when neither cache knows — the caller then has
 * no basis for a tolerance advisory (honest: no warning, the server
 * decides with the authoritative price).
 */
export function readCachedUnitPrice(
  adapter: StorageAdapter,
  partnerId: string | null,
  itemId: string,
): string | null {
  if (partnerId !== null) {
    const partner = readPartner(adapter, partnerId);
    if (partner?.priceListId !== null && partner?.priceListId !== undefined) {
      const row = adapter.get(
        "SELECT unit_price FROM price_list_items WHERE price_list_id = ? AND item_id = ? ORDER BY min_qty ASC LIMIT 1",
        [partner.priceListId, itemId],
      );
      if (row !== undefined && row.unit_price !== null && row.unit_price !== undefined) {
        return String(row.unit_price);
      }
    }
  }
  const item = readItem(adapter, itemId);
  return item?.basePrice ?? null;
}

/** A statements-cache row (the v4 field read cache; id = partner id). */
export interface StatementSnapshot {
  readonly partnerId: string;
  readonly customerName: string;
  readonly customerNameAr: string | null;
  readonly asOf: string | null;
  readonly currencyCode: string | null;
  readonly closingBalance: string | null;
  readonly generatedAt: string | null;
  /** The parsed entries (StatementEntryLite rows). */
  readonly entries: readonly {
    entryDate: string;
    docRef: string | null;
    sourceType: string;
    outstanding: string;
  }[];
}

function toStatementSnapshot(row: Record<string, unknown> | undefined): StatementSnapshot | undefined {
  if (row === undefined) return undefined;
  let entries: StatementSnapshot["entries"] = [];
  try {
    const parsed = JSON.parse(String(row.entries ?? "[]")) as unknown;
    if (Array.isArray(parsed)) {
      entries = parsed
        .map((entry) => {
          const record = entry as Record<string, unknown>;
          return {
            entryDate: String(record.entryDate ?? ""),
            docRef: record.docRef === null || record.docRef === undefined ? null : String(record.docRef),
            sourceType: String(record.sourceType ?? ""),
            outstanding: String(record.outstanding ?? "0"),
          };
        })
        .filter((entry) => entry.entryDate !== "");
    }
  } catch {
    entries = [];
  }
  return {
    partnerId: String(row.id),
    customerName: String(row.customer_name ?? ""),
    customerNameAr: row.customer_name_ar === null || row.customer_name_ar === undefined ? null : String(row.customer_name_ar),
    asOf: row.as_of === null || row.as_of === undefined ? null : String(row.as_of),
    currencyCode: row.currency_code === null || row.currency_code === undefined ? null : String(row.currency_code),
    closingBalance: row.closing_balance === null || row.closing_balance === undefined ? null : String(row.closing_balance),
    generatedAt: row.generated_at === null || row.generated_at === undefined ? null : String(row.generated_at),
    entries,
  };
}

/** The partner's cached statement snapshot (or undefined — never guessed). */
export function readStatement(adapter: StorageAdapter, partnerId: string): StatementSnapshot | undefined {
  return toStatementSnapshot(adapter.get("SELECT * FROM statements WHERE id = ?", [partnerId]));
}

/**
 * The CACHED van stock quantity for one item in one van warehouse: the SUM
 * over the mirror rows (batch-level rows per natural key). Zero when the
 * snapshot holds no row for the item — the honest "cache says none" (the
 * advisory then warns; the server decides against the real van ledger).
 */
export function readVanStockQty(adapter: StorageAdapter, vanWarehouseId: string, itemId: string): string {
  const rows = adapter.all(
    "SELECT qty FROM van_stocks WHERE warehouse_id = ? AND item_id = ?",
    [vanWarehouseId, itemId],
  );
  let total = new Decimal(0);
  for (const row of rows) {
    const qty = String(row.qty ?? "0");
    if (/^-?\d+(\.\d+)?$/.test(qty)) {
      total = total.plus(new Decimal(qty));
    }
  }
  return total.toFixed(6);
}

/** The van snapshot's as-of stamp: the newest refreshed_at across the van's
 * rows (null when the cache holds nothing for the warehouse — the screens
 * then render the asOfNeverSynced label, never a guessed date). */
export function vanSnapshotAsOf(adapter: StorageAdapter, vanWarehouseId: string): string | null {
  const rows = adapter.all(
    "SELECT refreshed_at FROM van_stocks WHERE warehouse_id = ? AND refreshed_at IS NOT NULL",
    [vanWarehouseId],
  );
  let newest: string | null = null;
  for (const row of rows) {
    const stamp = String(row.refreshed_at ?? "");
    if (stamp !== "" && (newest === null || stamp > newest)) {
      newest = stamp;
    }
  }
  return newest;
}

/** One cached van stock line (the unload picker's item source). */
export interface VanStockLine {
  readonly id: string;
  readonly itemId: string;
  readonly batchId: string | null;
  readonly qty: string;
  readonly value: string;
  readonly refreshedAt: string | null;
}

/** The cached van stock lines for a warehouse (item-grouped, qty summed). */
export function readVanStockLines(adapter: StorageAdapter, vanWarehouseId: string): VanStockLine[] {
  const rows = adapter.all(
    "SELECT item_id, batch_id, qty, value, refreshed_at FROM van_stocks WHERE warehouse_id = ? ORDER BY item_id ASC, batch_id ASC",
    [vanWarehouseId],
  );
  return rows.map((row) => ({
    id: `${String(row.item_id)}:${row.batch_id === null ? "-" : String(row.batch_id)}`,
    itemId: String(row.item_id),
    batchId: row.batch_id === null || row.batch_id === undefined ? null : String(row.batch_id),
    qty: String(row.qty ?? "0"),
    value: String(row.value ?? "0"),
    refreshedAt: row.refreshed_at === null || row.refreshed_at === undefined ? null : String(row.refreshed_at),
  }));
}

// -- the two-lane result ------------------------------------------------------------

/** One advisory / blocking issue: a code + the i18n message key + the
 * PRE-FORMATTED interpolation context (digits.ts owns number shapes). */
export interface PrevalidationIssue {
  readonly code: PrevalidationCode;
  readonly messageKey: keyof Dictionary;
  readonly context: Readonly<Record<string, string>>;
  /** The line index the issue points at (1-based; 0 = document-level). */
  readonly line?: number;
}

/** The advisory codes (never block — the server decides at sync). */
export type AdvisoryCode =
  | "VAN_STOCK_LOW"
  | "PRICE_TOLERANCE"
  | "CREDIT_LIMIT"
  | "ON_ACCOUNT"
  | "SERIAL_REUSE"
  | "UNKNOWN_ITEM";

/** The structural codes (block — the document is malformed). */
export type BlockingCode =
  | "MISSING_PARTNER"
  | "MISSING_ITEM"
  | "MISSING_SERIAL"
  | "ZERO_QTY"
  | "MALFORMED_QTY"
  | "MALFORMED_PRICE"
  | "MALFORMED_AMOUNT"
  | "MALFORMED_DATE"
  | "MALFORMED_ID";

export type PrevalidationCode = AdvisoryCode | BlockingCode;

/** The two-lane pre-validation result (§8: advisories never block). */
export interface PrevalidationResult {
  readonly advisories: readonly PrevalidationIssue[];
  readonly blocking: readonly PrevalidationIssue[];
}

/** All codes this module can emit (tests pin the vocabulary). */
export const PREVALIDATION_CODES: readonly PrevalidationCode[] = [
  "VAN_STOCK_LOW",
  "PRICE_TOLERANCE",
  "CREDIT_LIMIT",
  "ON_ACCOUNT",
  "SERIAL_REUSE",
  "UNKNOWN_ITEM",
  "MISSING_PARTNER",
  "MISSING_ITEM",
  "MISSING_SERIAL",
  "ZERO_QTY",
  "MALFORMED_QTY",
  "MALFORMED_PRICE",
  "MALFORMED_AMOUNT",
  "MALFORMED_DATE",
  "MALFORMED_ID",
];

/** True when an issue code is advisory (the lane test — a screen never re-decides). */
export function isAdvisory(code: PrevalidationCode): code is AdvisoryCode {
  return (
    code === "VAN_STOCK_LOW" ||
    code === "PRICE_TOLERANCE" ||
    code === "CREDIT_LIMIT" ||
    code === "ON_ACCOUNT" ||
    code === "SERIAL_REUSE" ||
    code === "UNKNOWN_ITEM"
  );
}

// -- the van-sale pre-validation (rows 6 + 35 LOCAL-VALID†) -------------------------

/** One captured van-sale line (the cart line the machine validates). */
export interface VanSaleLineCapture {
  readonly itemId: string;
  readonly qty: string;
  readonly unitPrice: string;
  readonly discountAmount?: string | null;
  /** Serial capture for serial/IMEI-tracked items (row 35). */
  readonly serialIds?: readonly string[];
}

/** The van-sale capture the pre-validator inspects. */
export interface VanSaleCapture {
  /** The customer (null = a cash walk-in sale — a credit sale requires one). */
  readonly customerId: string | null;
  /** The payment posture: CREDIT requires a customer; CASH does not. */
  readonly payment: "CASH" | "CREDIT";
  readonly lines: readonly VanSaleLineCapture[];
  /** The van warehouse the rep serves from (van-stock advisory scope). */
  readonly vanWarehouseId?: string | null;
}

const CANONICAL_DECIMAL = /^-?\d+(\.\d+)?$/;
const CANONICAL_QTY = /^-?\d{1,15}(\.\d{1,6})?$/;
const CANONICAL_PRICE = /^\d{1,15}(\.\d{1,6})?$/;
const CANONICAL_MONEY = /^-?\d{1,15}(\.\d{1,4})?$/;
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
const UUID = /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/;

/** The pure decimal-string predicates (shared with the flow modules). */
export const patterns = {
  isDecimal: (value: string): boolean => CANONICAL_DECIMAL.test(value),
  isQty: (value: string): boolean => CANONICAL_QTY.test(value),
  isPrice: (value: string): boolean => CANONICAL_PRICE.test(value),
  isMoney: (value: string): boolean => CANONICAL_MONEY.test(value),
  isIsoDate: (value: string): boolean => ISO_DATE.test(value),
  isUuid: (value: string): boolean => UUID.test(value),
} as const;

/**
 * The LOCAL-VALID† van-sale pre-validation (rows 6/35): structural blocking
 * + snapshot advisories. Advisories NEVER appear in `blocking` and NEVER
 * prevent the save (§8) — the caller renders them as warnings and the
 * server decides at sync.
 */
export function prevalidateVanSale(
  adapter: StorageAdapter,
  capture: VanSaleCapture,
): PrevalidationResult {
  const advisories: PrevalidationIssue[] = [];
  const blocking: PrevalidationIssue[] = [];

  // -- structural lane (blocks) ---------------------------------------------------
  if (capture.payment === "CREDIT" && (capture.customerId === null || capture.customerId === "")) {
    blocking.push({ code: "MISSING_PARTNER", messageKey: "vanSaleCustomerRequired", context: {} });
  }
  if (capture.customerId !== null && capture.customerId !== "" && !patterns.isUuid(capture.customerId)) {
    blocking.push({ code: "MALFORMED_ID", messageKey: "commonRequired", context: {} });
  }
  if (capture.lines.length === 0) {
    blocking.push({ code: "MISSING_ITEM", messageKey: "vanSaleEmptyCart", context: {} });
  }

  for (const [index, line] of capture.lines.entries()) {
    const lineNo = index + 1;
    if (line.itemId === "") {
      blocking.push({ code: "MISSING_ITEM", messageKey: "commonRequired", context: {}, line: lineNo });
      continue;
    }
    if (!patterns.isQty(line.qty)) {
      blocking.push({ code: "MALFORMED_QTY", messageKey: "vanSaleQtyInvalid", context: {}, line: lineNo });
      continue;
    }
    if (new Decimal(line.qty).lessThanOrEqualTo(0)) {
      blocking.push({ code: "ZERO_QTY", messageKey: "vanSaleQtyInvalid", context: {}, line: lineNo });
      continue;
    }
    if (!patterns.isPrice(line.unitPrice)) {
      blocking.push({ code: "MALFORMED_PRICE", messageKey: "errInvalidMoney", context: {}, line: lineNo });
      continue;
    }
    if (line.discountAmount !== null && line.discountAmount !== undefined && !patterns.isMoney(line.discountAmount)) {
      blocking.push({ code: "MALFORMED_AMOUNT", messageKey: "errInvalidMoney", context: {}, line: lineNo });
      continue;
    }
    const item = readItem(adapter, line.itemId);
    if (item === undefined) {
      // Not in the cache: structurally unverifiable — the line names an
      // item the device has never pulled. The document may still be valid
      // server-side (the cache is a snapshot), so this is the errNotFound
      // ADVISORY ("not on this device — pull first"), never a silent pass.
      advisories.push({
        code: "UNKNOWN_ITEM",
        messageKey: "errNotFound",
        context: {},
        line: lineNo,
      });
      continue;
    }
    if (item.trackSerial || item.trackImei) {
      const serials = line.serialIds ?? [];
      const serialCount = new Decimal(String(serials.length));
      if (serialCount.lessThan(new Decimal(line.qty))) {
        blocking.push({
          code: "MISSING_SERIAL",
          messageKey: "vanSaleQtyNeedsSerial",
          context: {},
          line: lineNo,
        });
      }
    }
  }

  // -- advisory lane (never blocks) ------------------------------------------------
  if (blocking.length === 0) {
    // Van stock availability (row 6 advisory — the van snapshot).
    if (capture.vanWarehouseId !== null && capture.vanWarehouseId !== undefined && capture.vanWarehouseId !== "") {
      for (const [index, line] of capture.lines.entries()) {
        const available = readVanStockQty(adapter, capture.vanWarehouseId, line.itemId);
        if (new Decimal(line.qty).greaterThan(new Decimal(available))) {
          advisories.push({
            code: "VAN_STOCK_LOW",
            messageKey: "vanSaleStockAdvisory",
            context: { available, requested: line.qty },
            line: index + 1,
          });
        }
      }
    }
    // Price tolerance (2% PRICE_TOLERANCE_FIELD_PCT vs the cached price —
    // the price-list snapshot IS the server-authoritative price, SAS §2:
    // {cached} renders the price captured in the draft, {server} the
    // snapshot price the server will re-stamp/compare against).
    for (const [index, line] of capture.lines.entries()) {
      const cached = readCachedUnitPrice(adapter, capture.customerId, line.itemId);
      if (cached !== null && patterns.isPrice(cached) && new Decimal(cached).greaterThan(0)) {
        const deviation = new Decimal(line.unitPrice)
          .minus(new Decimal(cached))
          .abs()
          .dividedBy(new Decimal(cached))
          .times(100);
        if (deviation.greaterThan(new Decimal(PRICE_TOLERANCE_FIELD_PCT))) {
          advisories.push({
            code: "PRICE_TOLERANCE",
            messageKey: "vanSalePriceAdvisory",
            context: { cached: line.unitPrice, server: cached },
            line: index + 1,
          });
        }
      }
    }
    // Credit-limit advisory (Journey G edge — cached balance + limit).
    if (capture.customerId !== null) {
      const partner = readPartner(adapter, capture.customerId);
      const statement = readStatement(adapter, capture.customerId);
      if (
        partner?.creditLimit !== null &&
        partner?.creditLimit !== undefined &&
        patterns.isMoney(partner.creditLimit) &&
        statement?.closingBalance !== null &&
        statement?.closingBalance !== undefined &&
        patterns.isMoney(statement.closingBalance)
      ) {
        const saleTotal = capture.lines.reduce(
          (sum, line) =>
            sum.plus(
              new Decimal(line.qty)
                .times(new Decimal(line.unitPrice))
                .minus(new Decimal(line.discountAmount ?? "0")),
            ),
          new Decimal(0),
        );
        const projected = new Decimal(statement.closingBalance).plus(saleTotal);
        const limit = new Decimal(partner.creditLimit);
        if (projected.greaterThan(limit)) {
          advisories.push({
            code: "CREDIT_LIMIT",
            messageKey: "vanSaleCreditLimitAdvisory",
            context: {
              limit: partner.creditLimit,
              used: statement.closingBalance,
            },
          });
        }
      }
    }
    // Serial reuse against THIS device's pending van sales (row 35 snapshot).
    const pending = pendingVanSaleSerials(adapter);
    if (pending.size > 0) {
      for (const [index, line] of capture.lines.entries()) {
        for (const serial of line.serialIds ?? []) {
          if (pending.has(serial)) {
            advisories.push({
              code: "SERIAL_REUSE",
              messageKey: "vanSaleQtyNeedsSerial",
              context: {},
              line: index + 1,
            });
            break;
          }
        }
      }
    }
  }

  return { advisories, blocking };
}

/**
 * The serials carried by this device's NOT-yet-acked van-sale commands (the
 * only serial-uniqueness snapshot a device honestly holds — other devices'
 * pending sales are unknowable; the server re-checks at sync, row 35).
 */
export function pendingVanSaleSerials(adapter: StorageAdapter): Set<string> {
  const rows = adapter.all(
    "SELECT payload FROM outbox WHERE entity_type = ? AND intent = ? AND status IN (?, ?)",
    ["sales_invoice", "create_draft", "QUEUED", "IN_FLIGHT"],
  );
  const serials = new Set<string>();
  for (const row of rows) {
    try {
      const payload = JSON.parse(String(row.payload ?? "{}")) as {
        lines?: { serialIds?: unknown }[];
      };
      for (const line of payload.lines ?? []) {
        if (Array.isArray(line.serialIds)) {
          for (const serial of line.serialIds) {
            if (typeof serial === "string") serials.add(serial);
          }
        }
      }
    } catch {
      // An unparseable pending payload is none of this capture's business.
    }
  }
  return serials;
}

// -- the collection pre-validation (row 9 — structural only; the credit
//    limit and the period are checked SERVER-side per the matrix row) ------

/** The collection capture the pre-validator inspects. */
export interface CollectionCapture {
  readonly partnerId: string;
  readonly cashAccountId: string;
  readonly amount: string;
  readonly valueDate: string;
}

/**
 * Row 9's class is OFFLINE-COMPLETE with SD server-side (credit-limit/
 * period checked server-side — the matrix note): the client validates
 * STRUCTURE only; the open-balance comparison is the BR-027 on-account
 * ADVISORY (the unallocated remainder is legitimate).
 */
export function prevalidateCollection(
  adapter: StorageAdapter,
  capture: CollectionCapture,
): PrevalidationResult {
  const advisories: PrevalidationIssue[] = [];
  const blocking: PrevalidationIssue[] = [];
  if (capture.partnerId === "" || !patterns.isUuid(capture.partnerId)) {
    blocking.push({ code: "MISSING_PARTNER", messageKey: "collectionCustomerPlaceholder", context: {} });
  }
  if (capture.cashAccountId === "" || !patterns.isUuid(capture.cashAccountId)) {
    blocking.push({ code: "MALFORMED_ID", messageKey: "commonRequired", context: {} });
  }
  if (!patterns.isMoney(capture.amount) || new Decimal(capture.amount).lessThanOrEqualTo(0)) {
    blocking.push({ code: "MALFORMED_AMOUNT", messageKey: "collectionAmountInvalid", context: {} });
  }
  if (!patterns.isIsoDate(capture.valueDate)) {
    blocking.push({ code: "MALFORMED_DATE", messageKey: "errInvalidDate", context: {} });
  }
  if (blocking.length === 0) {
    const statement = readStatement(adapter, capture.partnerId);
    if (
      statement?.closingBalance !== null &&
      statement?.closingBalance !== undefined &&
      patterns.isMoney(statement.closingBalance) &&
      new Decimal(capture.amount).greaterThan(new Decimal(statement.closingBalance))
    ) {
      advisories.push({
        code: "ON_ACCOUNT",
        messageKey: "collectionExceedsOpenBalance",
        context: { balance: statement.closingBalance },
      });
    }
  }
  return { advisories, blocking };
}
