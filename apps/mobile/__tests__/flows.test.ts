/**
 * PHASE-022 T-P22-2-e · the field-sales flow suites (MASTER-PLAN §8 —
 * BINDING): the honest state machines, the LOCAL-VALID† two-lane
 * pre-validation, and the van-sale capture — over REAL field stores
 * (openFieldStore on temp SQLite files, the 2-a suite shapes), with the
 * server payload contracts PARSED (the zod schemas from @erp/contracts —
 * the proof the client emits server-valid payloads) and the state
 * transitions driven through sync-core's own applyResult (UNMODIFIED
 * reuse).
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  applyResult,
  currentOfflineSeq,
  markInFlight,
  type OutboxRow,
} from "@erp/sync-core";
import {
  draftInvoiceCreateSchema,
  RESUBMITTABLE_BY_REASON,
} from "@erp/contracts";

import { openFieldStore, openPersonalStore, type MobileStore } from "../src/store";
import {
  addItemToCart,
  buildVanSalePayload,
  emptyVanSaleCart,
  saveVanSale,
  setCartCustomer,
  setCartPayment,
  setCartLineQty,
  addCartLineSerial,
  vanSaleCartTotal,
  vanSaleDocument,
} from "../src/fieldsales/van-sale";
import {
  isAdvisory,
  patterns,
  prevalidateVanSale,
  readItem,
  readVanStockQty,
  resolveBarcodeItem,
  vanSnapshotAsOf,
} from "../src/fieldsales/prevalidation";
import {
  describeRejection,
  flowRowByCommandId,
  flowStateFromRow,
  flowStateLabelKey,
  FLOW_STATE_TONE,
  rejectionActionLabelKey,
  rejectionDetailKey,
  rejectionLabelKey,
  FIELD_FLOW_INTENTS,
  type HonestFlowState,
} from "../src/fieldsales/state-machine";
import { PRICE_TOLERANCE_FIELD_PCT } from "../src/constants";

// -- the shared harness ---------------------------------------------------------------

const DEVICE_ID = "2e2e2e2e-0000-4111-8111-2e2e2e2e2e2e";
const VAN_WH = "2e2e2e2e-1111-4111-8111-2e2e2e2e2e11";
const ITEM_A = "2e2e2e2e-2222-4111-8111-2e2e2e2e2e22"; // plain item
const ITEM_SERIAL = "2e2e2e2e-3333-4111-8111-2e2e2e2e2e33"; // serial-tracked (row 35)
const ITEM_BATCH = "2e2e2e2e-4444-4111-8111-2e2e2e2e2e44"; // batch-tracked (row 35)
const ITEM_UNKNOWN = "2e2e2e2e-5555-4111-8111-2e2e2e2e2e55";
const PARTNER_CREDIT = "2e2e2e2e-6666-4111-8111-2e2e2e2e2e66";
const PARTNER_LIMITED = "2e2e2e2e-7777-4111-8111-2e2e2e2e2e77";
const PRICE_LIST = "2e2e2e2e-8888-4111-8111-2e2e2e2e2e88";
const CTX = {
  deviceId: DEVICE_ID,
  deviceCode: "F01",
  vanWarehouseId: VAN_WH,
  cashAccountId: "2e2e2e2e-9999-4111-8111-2e2e2e2e2e99",
  currencyCode: "SAR",
  today: "2026-11-18",
} as const;

let dir: string;
let store: MobileStore;

/** Seed the field caches exactly like the pull appliers would land them. */
function seedSnapshotCaches(): void {
  const item = (id: string, name: string, price: string, flags: { serial?: boolean; batch?: boolean } = {}): void => {
    store.run(
      `INSERT INTO items (id, sku, name, name_ar, kind, uom_id, category_id, tax_code_id, base_price,
                           track_batch, track_serial, track_imei, status, updated_at, dirty)
       VALUES (?, ?, ?, NULL, 'STOCK', NULL, NULL, NULL, ?, ?, ?, ?, 'ACTIVE', '2026-11-17T10:00:00Z', 0)`,
      [id, `SKU-${id.slice(0, 8)}`, name, price, flags.batch === true ? 1 : 0, flags.serial === true ? 1 : 0, 0],
    );
  };
  item(ITEM_A, "مياه 600مل", "2.5000");
  item(ITEM_SERIAL, "هاتف — يتتبع المسلسل", "1200.0000", { serial: true });
  item(ITEM_BATCH, "ألبان — يتتبع الدفعة", "8.0000", { batch: true });

  store.run("INSERT INTO barcodes (id, code, item_id, uom_id, updated_at) VALUES (?, ?, ?, NULL, '2026-11-17T10:00:00Z')", [
    "2e2e2e2e-beef-4111-8111-2e2e2e2e2eef",
    "6291000000011",
    ITEM_A,
  ]);
  store.run("INSERT INTO barcodes (id, code, item_id, uom_id, updated_at) VALUES (?, ?, ?, NULL, '2026-11-17T10:00:00Z')", [
    "2e2e2e2e-bad0-4111-8111-2e2e2e2e2ead",
    "6291000000028",
    ITEM_SERIAL,
  ]);

  store.run(
    `INSERT INTO partners (id, code, name, name_ar, kind, status, credit_limit, price_list_id, tax_number, updated_at)
     VALUES (?, 'C-001', 'عميل الطريق الأول', NULL, 'CUSTOMER', 'ACTIVE', NULL, ?, NULL, '2026-11-17T10:00:00Z')`,
    [PARTNER_CREDIT, PRICE_LIST],
  );
  store.run(
    `INSERT INTO partners (id, code, name, name_ar, kind, status, credit_limit, price_list_id, tax_number, updated_at)
     VALUES (?, 'C-002', 'عميل محدود السقف', NULL, 'CUSTOMER', 'ACTIVE', ?, NULL, NULL, '2026-11-17T10:00:00Z')`,
    [PARTNER_LIMITED, "100.0000"],
  );

  store.run(
    "INSERT INTO price_list_items (id, price_list_id, item_id, uom_id, unit_price, min_qty, updated_at) VALUES (?, ?, ?, NULL, ?, '0', '2026-11-17T10:00:00Z')",
    ["2e2e2e2e-pl01-4111-8111-2e2e2e2e2e01", PRICE_LIST, ITEM_A, "2.0000"],
  );

  // The van snapshot: ITEM_A ×10, ITEM_SERIAL ×2 (no batch rows), ITEM_BATCH ×5.
  const vanRow = (id: string, itemId: string, qty: string, batch: string | null): void => {
    store.run(
      `INSERT INTO van_stocks (id, warehouse_id, item_id, batch_id, qty, value, refreshed_at, payload, version, updated_at, dirty)
       VALUES (?, ?, ?, ?, ?, '0.0000', '2026-11-17T09:30:00Z', '{}', 3, '2026-11-17T09:30:00Z', 0)`,
      [id, VAN_WH, itemId, batch, qty],
    );
  };
  vanRow("2e2e2e2e-v001-4111-8111-2e2e2e2e2e01", ITEM_A, "10.000000", null);
  vanRow("2e2e2e2e-v002-4111-8111-2e2e2e2e2e02", ITEM_SERIAL, "2.000000", null);
  vanRow("2e2e2e2e-v003-4111-8111-2e2e2e2e2e03", ITEM_BATCH, "5.000000", "2e2e2e2e-ba01-4111-8111-2e2e2e2e2eb1");
  vanRow("2e2e2e2e-v004-4111-8111-2e2e2e2e2e04", ITEM_BATCH, "2.000000", "2e2e2e2e-ba02-4111-8111-2e2e2e2e2eb2");

  // The statements cache: PARTNER_LIMITED carries a 90.0000 balance.
  store.run(
    `INSERT INTO statements (id, customer_code, customer_name, customer_name_ar, as_of, currency_code,
        opening_balance, closing_balance, closing_balance_base, aging, entries, generated_at, payload, version, updated_at, dirty)
     VALUES (?, 'C-002', 'عميل محدود السقف', NULL, '2026-11-16', 'SAR', '80.0000', '90.0000', '90.0000', '{}',
             ?, '2026-11-17T09:00:00Z', '{}', NULL, '2026-11-17T09:00:00Z', 0)`,
    [
      PARTNER_LIMITED,
      JSON.stringify([
        { entryDate: "2026-11-01", docRef: "INV-2026-0007", sourceType: "sales_invoice", currencyCode: "SAR", debit: "90.0000", credit: "0.0000", balance: "90.0000", outstanding: "90.0000" },
      ]),
    ],
  );
}

/** A deterministic uuid factory (sequence-stable command ids in tests). */
function sequencedUuid(prefix: string): () => string {
  let n = 0;
  return (): string => {
    n += 1;
    // uuid-shaped, deterministic, time-ordered-looking for FIFO stability.
    return `${prefix}0000-4000-8000-${String(n).padStart(12, "0")}`;
  };
}

beforeAll(() => {
  dir = mkdtempSync(join(tmpdir(), "p22-2e-flows-"));
  store = openFieldStore(join(dir, "field.db"));
  seedSnapshotCaches();
});

afterAll(() => {
  store.close();
  rmSync(dir, { recursive: true, force: true });
});

// -- the honest state machine ---------------------------------------------------------

describe("PHASE-022 2-e · the honest state machine (§8)", () => {
  it("derives the five honest states from the outbox statuses (undefined → DRAFT_LOCAL)", () => {
    expect(flowStateFromRow(undefined)).toBe<HonestFlowState>("DRAFT_LOCAL");
    for (const status of ["QUEUED", "IN_FLIGHT"] as const) {
      expect(flowStateFromRow({ status } as OutboxRow)).toBe("PENDING_SYNC");
    }
    expect(flowStateFromRow({ status: "ACKED" } as OutboxRow)).toBe("POSTED");
    expect(flowStateFromRow({ status: "REJECTED" } as OutboxRow)).toBe("REJECTED");
    expect(flowStateFromRow({ status: "CANCELLED" } as OutboxRow)).toBe("CANCELLED");
  });

  it("binds every honest state to a §3 tone + a syncState* label key (no invented colors)", () => {
    const states: HonestFlowState[] = ["DRAFT_LOCAL", "PENDING_SYNC", "POSTED", "REJECTED", "CANCELLED"];
    for (const state of states) {
      expect(FLOW_STATE_TONE[state]).toMatch(/^(info|warning|success|danger)$/);
      expect(flowStateLabelKey(state)).toMatch(/^syncState/);
    }
    expect(FLOW_STATE_TONE.POSTED).toBe("success");
    expect(FLOW_STATE_TONE.REJECTED).toBe("danger");
  });

  it("maps every typed rejection reason to a reject* label + detail key and an action* key (§3 table)", () => {
    for (const reason of Object.keys(RESUBMITTABLE_BY_REASON)) {
      expect(String(rejectionLabelKey(reason as never))).toMatch(/^reject/);
      expect(String(rejectionDetailKey(reason as never))).toMatch(/^reject.*Detail$/);
    }
    expect(rejectionActionLabelKey("EDIT_AND_RESEND")).toBe("actionEditAndResend");
    expect(rejectionActionLabelKey("ACCEPT_SERVER_PRICE")).toBe("actionAcceptServerPrice");
    expect(rejectionActionLabelKey("CANCEL_WITH_REASON")).toBe("actionCancel");
  });

  it("surfaces a typed rejection (reason + resubmittable + machine-readable details) from the stored lastError", () => {
    const row: OutboxRow = {
      commandId: "c1",
      entityType: "van",
      intent: "confirm_unload",
      payload: "{}",
      idempotencyKey: "k1",
      baseVersion: null,
      clientCreatedAt: "2026-11-18T08:00:00Z",
      localRef: "OFF-F01-00001",
      status: "REJECTED",
      attempts: 1,
      nextAttemptAt: 0,
      lastError: JSON.stringify({
        reason: "INSUFFICIENT_STOCK",
        resubmittable: true,
        details: { availableQty: "10.000000", requestedQty: "15" },
        message: "unload beyond current van quantity",
      }),
      lastAttemptAt: "2026-11-18T09:00:00Z",
      acceptedResult: null,
      rejectionReason: "INSUFFICIENT_STOCK",
      rejectionAction: "EDIT_AND_RESEND",
      officialNo: null,
      ackedAt: null,
    };
    const summary = describeRejection(row);
    expect(summary?.reason).toBe("INSUFFICIENT_STOCK");
    expect(summary?.resubmittable).toBe(true);
    expect(summary?.details).toMatchObject({ availableQty: "10.000000", requestedQty: "15" });
    expect(summary?.action).toBe("EDIT_AND_RESEND");
    expect(summary?.message).toBe("unload beyond current van quantity");
  });

  it("falls back to the RESUBMITTABLE_BY_REASON default + the contracts action map on a legacy lastError", () => {
    const summary = describeRejection({
      status: "REJECTED",
      rejectionReason: "PARTNER_INACTIVE",
      rejectionAction: null,
      lastError: "partner deactivated",
    } as unknown as OutboxRow);
    expect(summary?.resubmittable).toBe(false); // RESUBMITTABLE_BY_REASON.PARTNER_INACTIVE
    expect(summary?.action).toBe("CANCEL_WITH_REASON"); // actionForSyncRejection
    expect(summary?.message).toBe("partner deactivated");
  });

  it("carries the six §8 field intents (rows 6/9/12/27/11) with their machine kinds", () => {
    expect(FIELD_FLOW_INTENTS).toEqual([
      { entityType: "sales_invoice", intent: "create_draft", machine: "draft" },
      { entityType: "receipt", intent: "create_field_collection", machine: "sync" },
      { entityType: "van", intent: "confirm_load", machine: "sync" },
      { entityType: "van", intent: "confirm_unload", machine: "sync" },
      { entityType: "credit_note", intent: "create_draft", machine: "draft" },
      { entityType: "stock_count", intent: "submit_lines", machine: "draft" },
    ]);
  });
});

// -- the LOCAL-VALID† pre-validation (two lanes) ---------------------------------------

describe("PHASE-022 2-e · LOCAL-VALID† pre-validation (rows 6/35 — the two lanes)", () => {
  const baseCapture = {
    customerId: null as string | null,
    payment: "CASH" as "CASH" | "CREDIT",
    vanWarehouseId: VAN_WH as string | null,
    lines: [] as { itemId: string; qty: string; unitPrice: string; serialIds?: string[] }[],
  };

  it("blocks structurally: missing partner on a CREDIT sale (MISSING_PARTNER)", () => {
    const result = prevalidateVanSale(store, {
      ...baseCapture,
      payment: "CREDIT",
      customerId: null,
      lines: [{ itemId: ITEM_A, qty: "1", unitPrice: "2.5" }],
    });
    expect(result.blocking.map((issue) => issue.code)).toContain("MISSING_PARTNER");
    expect(result.blocking.every((issue) => !isAdvisory(issue.code))).toBe(true);
  });

  it("blocks structurally: zero qty (ZERO_QTY), malformed qty (MALFORMED_QTY), malformed price (MALFORMED_PRICE), empty line set (MISSING_ITEM)", () => {
    const zero = prevalidateVanSale(store, { ...baseCapture, lines: [{ itemId: ITEM_A, qty: "0", unitPrice: "2.5" }] });
    expect(zero.blocking.map((issue) => issue.code)).toContain("ZERO_QTY");

    const malformedQty = prevalidateVanSale(store, { ...baseCapture, lines: [{ itemId: ITEM_A, qty: "1..5", unitPrice: "2.5" }] });
    expect(malformedQty.blocking.map((issue) => issue.code)).toContain("MALFORMED_QTY");

    const malformedPrice = prevalidateVanSale(store, { ...baseCapture, lines: [{ itemId: ITEM_A, qty: "1", unitPrice: "2.5.0" }] });
    expect(malformedPrice.blocking.map((issue) => issue.code)).toContain("MALFORMED_PRICE");

    const empty = prevalidateVanSale(store, { ...baseCapture, lines: [] });
    expect(empty.blocking.map((issue) => issue.code)).toContain("MISSING_ITEM");
  });

  it("blocks structurally: serial-tracked item without per-unit serial capture (MISSING_SERIAL, row 35)", () => {
    const result = prevalidateVanSale(store, {
      ...baseCapture,
      lines: [{ itemId: ITEM_SERIAL, qty: "2", unitPrice: "1200", serialIds: ["SN-1"] }],
    });
    expect(result.blocking.map((issue) => issue.code)).toContain("MISSING_SERIAL");
    const covered = prevalidateVanSale(store, {
      ...baseCapture,
      lines: [{ itemId: ITEM_SERIAL, qty: "2", unitPrice: "1200", serialIds: ["SN-1", "SN-2"] }],
    });
    expect(covered.blocking).toHaveLength(0);
  });

  it("warns (never blocks) when the line qty exceeds the CACHED van stock (VAN_STOCK_LOW)", () => {
    const result = prevalidateVanSale(store, {
      ...baseCapture,
      lines: [{ itemId: ITEM_A, qty: "11", unitPrice: "2.5" }],
    });
    expect(result.advisories.map((issue) => issue.code)).toContain("VAN_STOCK_LOW");
    expect(result.blocking).toHaveLength(0);
    expect(result.advisories[0]?.context).toMatchObject({ available: "10.000000", requested: "11" });
  });

  it("sums the van snapshot across batch rows (ITEM_BATCH 5 + 2 = 7)", () => {
    expect(readVanStockQty(store, VAN_WH, ITEM_BATCH)).toBe("7.000000");
    const within = prevalidateVanSale(store, {
      ...baseCapture,
      lines: [{ itemId: ITEM_BATCH, qty: "7", unitPrice: "8" }],
    });
    expect(within.advisories.map((issue) => issue.code)).not.toContain("VAN_STOCK_LOW");
    const beyond = prevalidateVanSale(store, {
      ...baseCapture,
      lines: [{ itemId: ITEM_BATCH, qty: "7.5", unitPrice: "8" }],
    });
    expect(beyond.advisories.map((issue) => issue.code)).toContain("VAN_STOCK_LOW");
  });

  it("warns (never blocks) beyond the 2% PRICE_TOLERANCE_FIELD_PCT vs the cached tier price (PRICE_TOLERANCE)", () => {
    // PARTNER_CREDIT's tier price for ITEM_A is 2.0000 (price_list_items).
    const within = prevalidateVanSale(store, {
      ...baseCapture,
      customerId: PARTNER_CREDIT,
      payment: "CREDIT",
      lines: [{ itemId: ITEM_A, qty: "1", unitPrice: "2.04" }], // +2% exactly — inside
    });
    expect(within.advisories.map((issue) => issue.code)).not.toContain("PRICE_TOLERANCE");
    const beyond = prevalidateVanSale(store, {
      ...baseCapture,
      customerId: PARTNER_CREDIT,
      payment: "CREDIT",
      lines: [{ itemId: ITEM_A, qty: "1", unitPrice: "2.05" }], // +2.5% — beyond
    });
    expect(beyond.advisories.map((issue) => issue.code)).toContain("PRICE_TOLERANCE");
    expect(PRICE_TOLERANCE_FIELD_PCT).toBe(2);
    expect(beyond.blocking).toHaveLength(0);
  });

  it("warns (never blocks) on the credit-limit posture (CREDIT_LIMIT — cached balance + this sale > cached limit)", () => {
    // PARTNER_LIMITED: balance 90.0000, limit 100.0000 → a 15.00 sale projects 105 > 100.
    const result = prevalidateVanSale(store, {
      ...baseCapture,
      customerId: PARTNER_LIMITED,
      payment: "CREDIT",
      lines: [{ itemId: ITEM_A, qty: "6", unitPrice: "2.5" }], // 15.00
    });
    expect(result.advisories.map((issue) => issue.code)).toContain("CREDIT_LIMIT");
    expect(result.advisories[0]?.context).toMatchObject({ limit: "100.0000", used: "90.0000" });
    expect(result.blocking).toHaveLength(0);
  });

  it("warns (never blocks) on a serial already carried by THIS device's pending van sale (SERIAL_REUSE, row 35 snapshot)", async () => {
    const uuid = sequencedUuid("aa");
    const cart = setCartPayment(setCartCustomer(emptyVanSaleCart("CREDIT"), PARTNER_CREDIT, "عميل الطريق الأول"), "CREDIT");
    const withSerial = addCartLineSerial(
      { ...cart, lines: [{ itemId: ITEM_SERIAL, itemName: "هاتف", qty: "1", unitPrice: "1200", discountAmount: null, taxCodeId: null, serialIds: [], batchId: null, trackedSerial: true, trackedBatch: false }] },
      ITEM_SERIAL,
      "IMEI-4444",
    );
    const saved = saveVanSale(store, CTX, withSerial, uuid);
    expect(saved.ok).toBe(true);

    const reuse = prevalidateVanSale(store, {
      ...baseCapture,
      lines: [{ itemId: ITEM_SERIAL, qty: "1", unitPrice: "1200", serialIds: ["IMEI-4444"] }],
    });
    expect(reuse.advisories.map((issue) => issue.code)).toContain("SERIAL_REUSE");
    expect(reuse.blocking).toHaveLength(0);
  });

  it("advises UNKNOWN_ITEM for an item the cache never pulled (errNotFound), never blocks", () => {
    const result = prevalidateVanSale(store, {
      ...baseCapture,
      lines: [{ itemId: ITEM_UNKNOWN, qty: "1", unitPrice: "5" }],
    });
    expect(result.advisories.map((issue) => issue.code)).toContain("UNKNOWN_ITEM");
    expect(result.blocking).toHaveLength(0);
  });

  it("exposes the pattern predicates the flows share (canonical decimal shapes)", () => {
    expect(patterns.isQty("12.123456")).toBe(true);
    expect(patterns.isQty("-1")).toBe(true);
    expect(patterns.isQty("1.1234567")).toBe(false);
    expect(patterns.isMoney("123.1234")).toBe(true);
    expect(patterns.isPrice("-2")).toBe(false);
    expect(patterns.isIsoDate("2026-11-18")).toBe(true);
    expect(patterns.isIsoDate("2026-11-18T10:00:00Z")).toBe(false);
    expect(patterns.isUuid(ITEM_A)).toBe(true);
    expect(patterns.isUuid("not-a-uuid")).toBe(false);
  });
});

// -- the van-sale capture machine -----------------------------------------------------

describe("PHASE-022 2-e · the van-sale capture (row 6 LOCAL-VALID† + row 35)", () => {
  it("resolves a scanned barcode to the cached item (scan-to-cart)", () => {
    const item = resolveBarcodeItem(store, "6291000000011");
    expect(item?.id).toBe(ITEM_A);
    expect(item?.name).toBe("مياه 600مل");
    expect(readItem(store, ITEM_A)?.basePrice).toBe("2.5000");
  });

  it("cart reducers: scan merges qty, customer prices from the tier cache, totals in Decimal strings", () => {
    let cart = setCartCustomer(emptyVanSaleCart("CREDIT"), PARTNER_CREDIT, "عميل الطريق الأول");
    cart = addItemToCart(store, cart, { code: "6291000000011" }); // qty 1 @ tier 2.0000
    cart = addItemToCart(store, cart, { code: "6291000000011" }); // merged qty 2
    expect(cart.lines).toHaveLength(1);
    expect(cart.lines[0]?.qty).toBe("2.000000");
    expect(cart.lines[0]?.unitPrice).toBe("2.0000");
    cart = setCartLineQty(cart, ITEM_A, "3");
    expect(vanSaleCartTotal(cart)).toBe("6.0000");
  });

  it("emits a SERVER-VALID sales_invoice:create_draft payload (the zod parse proof)", () => {
    let cart = setCartPayment(emptyVanSaleCart("CREDIT"), "CREDIT");
    cart = setCartCustomer(cart, PARTNER_CREDIT, "عميل الطريق الأول");
    cart = addItemToCart(store, cart, { code: "6291000000011" });
    const payload = buildVanSalePayload(cart, CTX);
    const parsed = draftInvoiceCreateSchema.safeParse(payload);
    expect(parsed.success).toBe(true);
    if (parsed.success) {
      expect(parsed.data.customerId).toBe(PARTNER_CREDIT);
      expect(parsed.data.orderDate).toBe("2026-11-18");
      expect(parsed.data.lines[0]).toMatchObject({ itemId: ITEM_A, qty: "1", unitPrice: "2.0000" });
    }
  });

  it("row 35 additive serial/batch capture: rides the payload — and the server's CURRENT contract strips it (the honest gap)", () => {
    let cart = emptyVanSaleCart("CASH");
    cart = addItemToCart(store, cart, { code: "6291000000028" }); // serial-tracked
    cart = addCartLineSerial(cart, ITEM_SERIAL, "IMEI-9001");
    const withBatch = { ...cart, lines: cart.lines.map((line) => ({ ...line, batchId: "BATCH-77" })) };
    const payload = buildVanSalePayload(withBatch, CTX);
    // The device-side payload CARRIES the capture…
    expect(payload.lines[0]?.serialIds).toEqual(["IMEI-9001"]);
    expect(payload.lines[0]?.batchId).toBe("BATCH-77");
    // …and the server's zod schema (non-strict) PARSES it successfully —
    // but STRIPS the unknown line keys: the wire gap this task records as
    // deviation 1 (packages/contracts is read-only this wave).
    const parsed = draftInvoiceCreateSchema.safeParse(payload);
    expect(parsed.success).toBe(true);
    if (parsed.success) {
      expect(parsed.data.lines[0] && "serialIds" in parsed.data.lines[0]).toBe(false);
      expect(parsed.data.lines[0] && "batchId" in parsed.data.lines[0]).toBe(false);
    }
  });

  it("saves: ONE transaction → the OFF- local ref sequence + the reused sync-core envelope in the outbox (PENDING_SYNC)", () => {
    const uuid = sequencedUuid("ab");
    let cart = emptyVanSaleCart("CASH");
    cart = addItemToCart(store, cart, { code: "6291000000011" });
    const seqBefore = currentOfflineSeq(store, DEVICE_ID); // the shared per-device OFF- sequence
    const first = saveVanSale(store, CTX, cart, uuid);
    expect(first.ok).toBe(true);
    expect(first.localRef).toBe(`OFF-F01-${String(seqBefore + 1).padStart(5, "0")}`);
    expect(first.state).toBe("PENDING_SYNC");

    const row = flowRowByCommandId(store, first.commandId!);
    expect(row?.entityType).toBe("sales_invoice");
    expect(row?.intent).toBe("create_draft");
    expect(row?.status).toBe("QUEUED");
    expect(row?.localRef).toBe(`OFF-F01-${String(seqBefore + 1).padStart(5, "0")}`);
    // The idempotency key is the sync-core builder's convention.
    expect(row?.idempotencyKey).toMatch(/^sales_invoice:create_draft:/);

    const second = saveVanSale(store, CTX, cart, uuid);
    expect(second.localRef).toBe(`OFF-F01-${String(seqBefore + 2).padStart(5, "0")}`); // nextOfflineNumber advances
  });

  it("refuses to enqueue on structural blocking (nothing lands in the outbox)", () => {
    const before = store.countRows("outbox");
    const blocked = saveVanSale(store, CTX, {
      ...emptyVanSaleCart("CREDIT"),
      lines: [{ itemId: ITEM_A, itemName: "مياه", qty: "1", unitPrice: "2.5", discountAmount: null, taxCodeId: null, serialIds: [], batchId: null, trackedSerial: false, trackedBatch: false }],
    });
    expect(blocked.ok).toBe(false);
    expect(blocked.blocking.map((issue) => issue.code)).toContain("MISSING_PARTNER");
    expect(store.countRows("outbox")).toBe(before);
  });

  it("PENDING_SYNC → POSTED on applyResult (the official number is the ONLY place it enters)", () => {
    const uuid = sequencedUuid("ac");
    let cart = emptyVanSaleCart("CASH");
    cart = addItemToCart(store, cart, { code: "6291000000011" });
    const saved = saveVanSale(store, CTX, cart, uuid);
    markInFlight(store, [saved.commandId!]);
    applyResult(store, {
      commandId: saved.commandId!,
      status: "ACCEPTED",
      officialNo: "INV-2026-0042",
      acceptedResult: { invoiceId: "srv-inv-1", status: "DRAFT" },
    });
    const view = vanSaleDocument(store, saved.commandId!);
    expect(view?.state).toBe("POSTED");
    expect(view?.officialNo).toBe("INV-2026-0042");
  });

  it("PENDING_SYNC → REJECTED(editable) with the typed reason surfaced (PRICE_CHANGED → ACCEPT_SERVER_PRICE)", () => {
    const uuid = sequencedUuid("ad");
    let cart = setCartPayment(emptyVanSaleCart("CREDIT"), "CREDIT");
    cart = setCartCustomer(cart, PARTNER_CREDIT, "عميل الطريق الأول");
    cart = addItemToCart(store, cart, { code: "6291000000011" });
    const saved = saveVanSale(store, CTX, cart, uuid);
    markInFlight(store, [saved.commandId!]);
    applyResult(store, {
      commandId: saved.commandId!,
      status: "REJECTED",
      rejectionReason: "PRICE_CHANGED",
      rejectionAction: "ACCEPT_SERVER_PRICE",
      error: "line 1 price beyond tolerance",
      rejectionDetails: { currentPrice: "2.1000", tolerancePct: "2" },
      resubmittable: true,
    });
    const row = flowRowByCommandId(store, saved.commandId!);
    expect(flowStateFromRow(row)).toBe("REJECTED");
    const summary = describeRejection(row!);
    expect(summary?.reason).toBe("PRICE_CHANGED");
    expect(summary?.resubmittable).toBe(true);
    expect(summary?.action).toBe("ACCEPT_SERVER_PRICE");
    expect(summary?.details).toMatchObject({ currentPrice: "2.1000" });
    expect(rejectionLabelKey("PRICE_CHANGED")).toBe("rejectPriceChanged");
  });

  it("the van snapshot exposes its as-of stamp (the confirmation screens' label input)", () => {
    expect(vanSnapshotAsOf(store, VAN_WH)).toBe("2026-11-17T09:30:00Z");
  });
});

// -- the no-personal-write structural proof -------------------------------------------

describe("PHASE-022 2-e · no personal-write leakage (§8: zero write affordances by construction)", () => {
  it("every fieldsales save path REFUSES on a personal store (no outbox table — LOCAL_DATABASE §1.1 rule 2)", () => {
    const personal = openPersonalStore(":memory:");
    try {
      expect(() =>
        saveVanSale(personal, CTX, {
          ...emptyVanSaleCart("CASH"),
          lines: [{ itemId: ITEM_A, itemName: "مياه", qty: "1", unitPrice: "2.5", discountAmount: null, taxCodeId: null, serialIds: [], batchId: null, trackedSerial: false, trackedBatch: false }],
        }),
      ).toThrow(/outbox|no such table/i); // the personal store has no outbox AND no field caches — the write path is structurally impossible
    } finally {
      personal.close();
    }
  });

  it("the fieldsales + screens sources import only the sanctioned areas (a structural import-graph assertion)", async () => {
    const { readdir, readFile } = await import("node:fs/promises");
    const { fileURLToPath } = await import("node:url");
    const srcRoot = fileURLToPath(new URL("../src", import.meta.url));
    // PHASE-022 3-b evolution: the fieldsales flows stay fully banned from
    // the personal/companion/reconciliation areas (the field flows never
    // render them). The SCREENS area now legitimately renders 3-b's thin
    // view-model screens — the invariant that survives for screens is the
    // WRITE-PATH one: a screen never imports sync-core's enqueue or the
    // command builders directly; writes go through the area modules (the
    // fieldsales flows, the reconciliation §3 executors) so every write is
    // transactional + audited by construction.
    const bannedAreas = /from\s+"(\.\.\/)*(personal|companion|reconciliation)\b/;
    const bannedWrites = /from\s+"@erp\/sync-core"[^;]*\b(enqueue|buildSyncCommandV2|buildDraftInvoice|buildPosSaleCommand|buildPartnerContactMerge|applyResult|markInFlight|requeue|capturePosSale)\b/;
    const areas = ["fieldsales", "screens"] as const;
    for (const area of areas) {
      const dirEntries = await readdir(`${srcRoot}/${area}`, { withFileTypes: true });
      for (const entry of dirEntries) {
        if (!entry.isFile() || !/\.(ts|tsx)$/.test(entry.name)) continue;
        const source = await readFile(`${srcRoot}/${area}/${entry.name}`, "utf8");
        if (area === "fieldsales") {
          expect(
            bannedAreas.test(source),
            `${area}/${entry.name} must never reach a personal/companion/reconciliation module (§8: the personal class has ZERO write affordances)`,
          ).toBe(false);
        }
        expect(
          bannedWrites.test(source),
          `${area}/${entry.name} must never import a sync-core write API directly (writes go through the area modules)`,
        ).toBe(false);
      }
    }
  });
});
