/**
 * PHASE-022 T-P22-2-e · the field-document flow suites (rows 9/12/27/11):
 * the field collection receipt, the van load/unload confirmations, the
 * return credit-note draft and the stock-count lines — every payload
 * PARSED against its landed @erp/contracts zod schema (the 2-c contract —
 * the proof the client emits server-valid payloads), every transition
 * driven through sync-core's applyResult (UNMODIFIED reuse), over REAL
 * field stores.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { applyResult, markInFlight, nextOfflineNumber } from "@erp/sync-core";
import {
  creditNoteCreateDraftPayloadSchema,
  receiptCreateFieldCollectionPayloadSchema,
  stockCountSubmitLinesPayloadSchema,
  vanConfirmLoadPayloadSchema,
  vanConfirmUnloadPayloadSchema,
} from "@erp/contracts";

import { openFieldStore, openPersonalStore, type MobileStore } from "../src/store";
import {
  buildCollectionPayload,
  collectionDocument,
  planAllocationOldestFirst,
  saveFieldCollection,
  validateCollection,
} from "../src/fieldsales/collection";
import {
  buildVanLoadPayload,
  buildVanUnloadPayload,
  saveVanLoadConfirmation,
  saveVanUnloadConfirmation,
  validateVanUnload,
  vanMovementDocument,
  vanSnapshot,
} from "../src/fieldsales/van-load";
import {
  buildReturnPayload,
  returnDocument,
  saveReturnDraft,
} from "../src/fieldsales/returns";
import {
  buildCountLinesPayload,
  countDocument,
  saveCountLines,
  scanCountItem,
  validateCountLines,
} from "../src/fieldsales/count-lines";
import { flowRowByCommandId, flowStateFromRow } from "../src/fieldsales/state-machine";

// -- the shared harness ---------------------------------------------------------------

const DEVICE_ID = "2e2e2e2e-0000-4111-8111-2e2e2e2e2e2e";
const VAN_WH = "2e2e2e2e-1111-4111-8111-2e2e2e2e2e11";
const TO_WH = "2e2e2e2e-1212-4111-8111-2e2e2e2e2e12";
const ITEM_A = "2e2e2e2e-2222-4111-8111-2e2e2e2e2e22";
const ITEM_B = "2e2e2e2e-2323-4111-8111-2e2e2e2e2e23";
const PARTNER = "2e2e2e2e-6666-4111-8111-2e2e2e2e2e66";
const CASH_ACCOUNT = "2e2e2e2e-9999-4111-8111-2e2e2e2e2e99";
const TRANSFER_ID = "2e2e2e2e-3434-4111-8111-2e2e2e2e2e34";
const CTX = {
  deviceId: DEVICE_ID,
  deviceCode: "F01",
  vanWarehouseId: VAN_WH,
  cashAccountId: CASH_ACCOUNT,
  currencyCode: "SAR",
  today: "2026-11-18",
} as const;

let dir: string;
let store: MobileStore;

function sequencedUuid(prefix: string): () => string {
  let n = 0;
  return (): string => {
    n += 1;
    return `${prefix}0000-4000-8000-${String(n).padStart(12, "0")}`;
  };
}

beforeAll(() => {
  dir = mkdtempSync(join(tmpdir(), "p22-2e-docs-"));
  store = openFieldStore(join(dir, "field.db"));
  // items + barcodes for the count flow
  for (const [id, name, sku] of [
    [ITEM_A, "مياه 600مل", "SKU-A"],
    [ITEM_B, "أرز 5كغ", "SKU-B"],
  ] as const) {
    store.run(
      `INSERT INTO items (id, sku, name, name_ar, kind, uom_id, category_id, tax_code_id, base_price,
                           track_batch, track_serial, track_imei, status, updated_at, dirty)
       VALUES (?, ?, ?, NULL, 'STOCK', NULL, NULL, NULL, '5.0000', 0, 0, 0, 'ACTIVE', '2026-11-17T10:00:00Z', 0)`,
      [id, sku, name],
    );
  }
  store.run("INSERT INTO barcodes (id, code, item_id, uom_id, updated_at) VALUES (?, '6291000000099', ?, NULL, '2026-11-17T10:00:00Z')", [
    "2e2e2e2e-ca01-4111-8111-2e2e2e2e2ec1",
    ITEM_A,
  ]);
  store.run(
    `INSERT INTO partners (id, code, name, name_ar, kind, status, credit_limit, price_list_id, tax_number, updated_at)
     VALUES (?, 'C-001', 'عميل الطريق الأول', NULL, 'CUSTOMER', 'ACTIVE', NULL, NULL, NULL, '2026-11-17T10:00:00Z')`,
    [PARTNER],
  );
  // The van snapshot: ITEM_A ×10, ITEM_B ×3.
  for (const [id, itemId, qty] of [
    ["2e2e2e2e-v001-4111-8111-2e2e2e2e2e01", ITEM_A, "10.000000"],
    ["2e2e2e2e-v002-4111-8111-2e2e2e2e2e02", ITEM_B, "3.000000"],
  ] as const) {
    store.run(
      `INSERT INTO van_stocks (id, warehouse_id, item_id, batch_id, qty, value, refreshed_at, payload, version, updated_at, dirty)
       VALUES (?, ?, ?, NULL, ?, '0.0000', '2026-11-17T09:30:00Z', '{}', 3, '2026-11-17T09:30:00Z', 0)`,
      [id, VAN_WH, itemId, qty],
    );
  }
  // The partner's cached statement: two open invoices (oldest first plan).
  store.run(
    `INSERT INTO statements (id, customer_code, customer_name, customer_name_ar, as_of, currency_code,
        opening_balance, closing_balance, closing_balance_base, aging, entries, generated_at, payload, version, updated_at, dirty)
     VALUES (?, 'C-001', 'عميل الطريق الأول', NULL, '2026-11-16', 'SAR', '80.0000', '230.0000', '230.0000', '{}',
             ?, '2026-11-17T09:00:00Z', '{}', NULL, '2026-11-17T09:00:00Z', 0)`,
    [
      PARTNER,
      JSON.stringify([
        { entryDate: "2026-11-01", docRef: "INV-2026-0007", sourceType: "sales_invoice", currencyCode: "SAR", debit: "150.0000", credit: "0.0000", balance: "150.0000", outstanding: "150.0000" },
        { entryDate: "2026-11-09", docRef: "INV-2026-0012", sourceType: "sales_invoice", currencyCode: "SAR", debit: "80.0000", credit: "0.0000", balance: "230.0000", outstanding: "80.0000" },
        { entryDate: "2026-11-10", docRef: "RCV-2026-0031", sourceType: "receipt", currencyCode: "SAR", debit: "0.0000", credit: "0.0000", balance: "230.0000", outstanding: "0.0000" },
      ]),
    ],
  );
});

afterAll(() => {
  store.close();
  rmSync(dir, { recursive: true, force: true });
});

// -- the field collection (row 9 OFFLINE-COMPLETE) ------------------------------------

describe("PHASE-022 2-e · the field collection (row 9 OFFLINE-COMPLETE)", () => {
  it("emits a SERVER-VALID receipt:create_field_collection payload (the zod parse proof)", () => {
    const payload = buildCollectionPayload(CTX, {
      partnerId: PARTNER,
      method: "CASH",
      amount: "150.0000",
      reference: null,
      collectedAt: "2026-11-18T07:45:00Z",
    });
    const parsed = receiptCreateFieldCollectionPayloadSchema.safeParse(payload);
    expect(parsed.success).toBe(true);
    if (parsed.success) {
      expect(parsed.data).toMatchObject({
        partnerId: PARTNER,
        cashAccountId: CASH_ACCOUNT,
        method: "CASH",
        currencyCode: "SAR",
        amount: "150.0000",
        valueDate: "2026-11-18",
      });
    }
  });

  it("carries explicit open-item allocations when the caller knows the ids (INV-016/BR-027)", () => {
    const payload = buildCollectionPayload(CTX, {
      partnerId: PARTNER,
      method: "TRANSFER",
      amount: "100.0000",
      reference: "TRF-991",
      allocations: [{ openItemId: "2e2e2e2e-0a01-4111-8111-2e2e2e2e2e0a", amount: "100.0000" }],
    });
    const parsed = receiptCreateFieldCollectionPayloadSchema.safeParse(payload);
    expect(parsed.success).toBe(true);
    if (parsed.success) {
      expect(parsed.data.allocations).toEqual([
        { openItemId: "2e2e2e2e-0a01-4111-8111-2e2e2e2e2e0a", amount: "100.0000" },
      ]);
    }
  });

  it("plans the oldest-first allocation over the cached statement (display — the LITE projection carries no openItemId)", () => {
    const plan = planAllocationOldestFirst(store, PARTNER, "200.0000");
    expect(plan.rows).toHaveLength(2);
    expect(plan.rows[0]).toMatchObject({ docRef: "INV-2026-0007", amount: "150.0000", openItemId: null });
    expect(plan.rows[1]).toMatchObject({ docRef: "INV-2026-0012", amount: "50.0000", openItemId: null });
    expect(plan.allocated).toBe("200.0000");
    expect(plan.unallocated).toBe("0.0000");
    // Beyond the open balance → the on-account remainder (BR-027).
    const overflow = planAllocationOldestFirst(store, PARTNER, "250.0000");
    expect(overflow.unallocated).toBe("20.0000");
  });

  it("validates structure + advises the BR-027 on-account remainder (never blocks)", () => {
    const valid = validateCollection(store, CTX, { partnerId: PARTNER, method: "CASH", amount: "150.0000" });
    expect(valid.blocking).toHaveLength(0);
    expect(valid.advisories).toHaveLength(0);

    const over = validateCollection(store, CTX, { partnerId: PARTNER, method: "CASH", amount: "260.0000" });
    expect(over.advisories.map((issue) => issue.code)).toContain("ON_ACCOUNT");
    expect(over.blocking).toHaveLength(0);

    const malformed = validateCollection(store, CTX, { partnerId: PARTNER, method: "CASH", amount: "12.3.4" });
    expect(malformed.blocking.map((issue) => issue.code)).toContain("MALFORMED_AMOUNT");
  });

  it("saves: PENDING_SYNC with the OFF- local ref → POSTED (official RCV) → the row 9 machine", () => {
    const uuid = sequencedUuid("ba");
    const saved = saveFieldCollection(store, CTX, { partnerId: PARTNER, method: "CASH", amount: "150.0000" }, uuid);
    expect(saved.ok).toBe(true);
    expect(saved.state).toBe("PENDING_SYNC");
    const row = flowRowByCommandId(store, saved.commandId!);
    expect(row?.entityType).toBe("receipt");
    expect(row?.intent).toBe("create_field_collection");
    expect(row?.idempotencyKey).toMatch(/^receipt:create_field_collection:/);

    markInFlight(store, [saved.commandId!]);
    applyResult(store, {
      commandId: saved.commandId!,
      status: "ACCEPTED",
      officialNo: "RCV-2026-0117",
      acceptedResult: { receiptId: "srv-rcv-1", status: "POSTED" },
    });
    const view = collectionDocument(store, saved.commandId!);
    expect(view?.state).toBe("POSTED");
    expect(view?.officialNo).toBe("RCV-2026-0117");
    expect(view?.method).toBe("CASH");
  });

  it("→ REJECTED(editable): PERIOD_LOCKED rides the server-final value date; the §3 action is edit-and-resend", () => {
    const uuid = sequencedUuid("bb");
    const saved = saveFieldCollection(store, CTX, { partnerId: PARTNER, method: "CASH", amount: "80.0000" }, uuid);
    markInFlight(store, [saved.commandId!]);
    applyResult(store, {
      commandId: saved.commandId!,
      status: "REJECTED",
      rejectionReason: "PERIOD_LOCKED",
      rejectionAction: "EDIT_AND_RESEND",
      error: "period locked",
      rejectionDetails: { entryDate: "2026-11-18", status: "LOCKED" },
      resubmittable: true,
    });
    const view = collectionDocument(store, saved.commandId!);
    expect(view?.state).toBe("REJECTED");
    const row = flowRowByCommandId(store, saved.commandId!);
    expect(JSON.parse(row?.lastError ?? "{}")).toMatchObject({
      reason: "PERIOD_LOCKED",
      resubmittable: true,
      details: { entryDate: "2026-11-18", status: "LOCKED" },
    });
  });

  it("refuses to enqueue on structural blocking (malformed amount)", () => {
    const before = store.countRows("outbox");
    const blocked = saveFieldCollection(store, CTX, { partnerId: PARTNER, method: "CASH", amount: "-5" });
    expect(blocked.ok).toBe(false);
    expect(store.countRows("outbox")).toBe(before);
  });
});

// -- the van load/unload confirmations (row 12 OFFLINE-COMPLETE) ----------------------

describe("PHASE-022 2-e · the van load/unload confirmations (row 12 OFFLINE-COMPLETE)", () => {
  it("emits a SERVER-VALID van:confirm_load payload (the zod parse proof)", () => {
    const payload = buildVanLoadPayload({ transferId: TRANSFER_ID, confirmedAt: "2026-11-18T06:30:00Z" });
    const parsed = vanConfirmLoadPayloadSchema.safeParse(payload);
    expect(parsed.success).toBe(true);
    if (parsed.success) {
      expect(parsed.data).toEqual({ transferId: TRANSFER_ID, confirmedAt: "2026-11-18T06:30:00Z" });
    }
  });

  it("emits a SERVER-VALID van:confirm_unload payload (one line per item, qty ≤ 6dp)", () => {
    const payload = buildVanUnloadPayload({
      vanWarehouseId: VAN_WH,
      toWarehouseId: TO_WH,
      lines: [
        { itemId: ITEM_A, qty: "4.500000" },
        { itemId: ITEM_B, qty: "3" },
      ],
      note: "end of day",
    });
    const parsed = vanConfirmUnloadPayloadSchema.safeParse(payload);
    expect(parsed.success).toBe(true);
    if (parsed.success) {
      expect(parsed.data.lines).toEqual([
        { itemId: ITEM_A, qty: "4.500000" },
        { itemId: ITEM_B, qty: "3" },
      ]);
    }
  });

  it("save load: PENDING_SYNC → POSTED (the van ledger); double-confirm → REJECTED STALE_VERSION with typed details", () => {
    const uuid = sequencedUuid("bc");
    const saved = saveVanLoadConfirmation(store, CTX, { transferId: TRANSFER_ID }, uuid);
    expect(saved.ok).toBe(true);
    expect(saved.state).toBe("PENDING_SYNC");

    markInFlight(store, [saved.commandId!]);
    applyResult(store, {
      commandId: saved.commandId!,
      status: "ACCEPTED",
      officialNo: "TRN-2026-0071",
      acceptedResult: { transferId: TRANSFER_ID, status: "POSTED" },
    });
    expect(vanMovementDocument(store, saved.commandId!)).toMatchObject({
      intent: "confirm_load",
      state: "POSTED",
      officialNo: "TRN-2026-0071",
    });

    // The rep double-confirms (the 2-c handler contract: STALE_VERSION).
    const again = saveVanLoadConfirmation(store, CTX, { transferId: TRANSFER_ID }, sequencedUuid("bd"));
    markInFlight(store, [again.commandId!]);
    applyResult(store, {
      commandId: again.commandId!,
      status: "REJECTED",
      rejectionReason: "STALE_VERSION",
      rejectionAction: "REVIEW_AND_MERGE",
      error: "transfer already POSTED",
      rejectionDetails: { transferId: TRANSFER_ID, currentStatus: "POSTED" },
      resubmittable: true,
    });
    const view = vanMovementDocument(store, again.commandId!);
    expect(view?.state).toBe("REJECTED");
    const row = flowRowByCommandId(store, again.commandId!);
    expect(JSON.parse(row?.lastError ?? "{}")).toMatchObject({
      reason: "STALE_VERSION",
      details: { transferId: TRANSFER_ID, currentStatus: "POSTED" },
    });
  });

  it("unload validation: the qty-beyond-snapshot check is an ADVISORY (server decides INSUFFICIENT_STOCK), never a block", () => {
    const result = validateVanUnload(store, {
      vanWarehouseId: VAN_WH,
      toWarehouseId: TO_WH,
      lines: [{ itemId: ITEM_B, qty: "15" }],
    });
    expect(result.advisories.map((issue) => issue.code)).toContain("VAN_STOCK_LOW");
    expect(result.advisories[0]?.context).toMatchObject({ requested: "15", available: "3.000000" });
    expect(result.blocking).toHaveLength(0);
  });

  it("unload validation blocks: empty lines, repeated item, malformed qty", () => {
    expect(
      validateVanUnload(store, { vanWarehouseId: VAN_WH, toWarehouseId: TO_WH, lines: [] }).blocking,
    ).not.toHaveLength(0);
    expect(
      validateVanUnload(store, {
        vanWarehouseId: VAN_WH,
        toWarehouseId: TO_WH,
        lines: [
          { itemId: ITEM_A, qty: "1" },
          { itemId: ITEM_A, qty: "2" },
        ],
      }).blocking,
    ).not.toHaveLength(0);
    expect(
      validateVanUnload(store, {
        vanWarehouseId: VAN_WH,
        toWarehouseId: TO_WH,
        lines: [{ itemId: ITEM_A, qty: "x" }],
      }).blocking,
    ).not.toHaveLength(0);
  });

  it("save unload: PENDING_SYNC → REJECTED(editable) INSUFFICIENT_STOCK with the machine-readable availableQty", () => {
    const uuid = sequencedUuid("be");
    const saved = saveVanUnloadConfirmation(
      store,
      CTX,
      { vanWarehouseId: VAN_WH, toWarehouseId: TO_WH, lines: [{ itemId: ITEM_B, qty: "15" }] },
      uuid,
    );
    expect(saved.ok).toBe(true);
    expect(saved.advisories.map((issue) => issue.code)).toContain("VAN_STOCK_LOW"); // the advisory rode along
    markInFlight(store, [saved.commandId!]);
    applyResult(store, {
      commandId: saved.commandId!,
      status: "REJECTED",
      rejectionReason: "INSUFFICIENT_STOCK",
      rejectionAction: "EDIT_AND_RESEND",
      error: "unload beyond current van quantity",
      rejectionDetails: { vanWarehouseId: VAN_WH, itemId: ITEM_B, availableQty: "3.000000", requestedQty: "15" },
      resubmittable: true,
    });
    const view = vanMovementDocument(store, saved.commandId!);
    expect(view?.state).toBe("REJECTED");
    expect(view?.intent).toBe("confirm_unload");
  });

  it("the snapshot view carries the cached lines + the honest as-of stamp", () => {
    const snapshot = vanSnapshot(store, VAN_WH);
    expect(snapshot.lines.map((line) => line.itemId).sort()).toEqual([ITEM_A, ITEM_B].sort());
    expect(snapshot.asOf).toBe("2026-11-17T09:30:00Z");
  });

  it("refuses a malformed transfer reference (structural blocking, zero residue)", () => {
    const before = store.countRows("outbox");
    expect(saveVanLoadConfirmation(store, CTX, { transferId: "not-a-uuid" }).ok).toBe(false);
    expect(store.countRows("outbox")).toBe(before);
  });
});

// -- the return credit-note draft (row 27 OFFLINE-DRAFT) ------------------------------

describe("PHASE-022 2-e · the return credit-note draft (row 27 OFFLINE-DRAFT)", () => {
  const INVOICE_ID = "2e2e2e2e-1a01-4111-8111-2e2e2e2e2e1a";
  const INVOICE_LINE = "2e2e2e2e-1b01-4111-8111-2e2e2e2e2e1b";

  it("emits a SERVER-VALID credit_note:create_draft payload — batch/serial capture is wire-complete here (row 35)", () => {
    const payload = buildReturnPayload(CTX, {
      invoiceId: INVOICE_ID,
      note: "عيب بالمصنع",
      lines: [
        {
          invoiceLineId: INVOICE_LINE,
          qty: "1",
          returnToStock: true,
          batchId: "2e2e2e2e-ba01-4111-8111-2e2e2e2e2eb1",
          serialIds: ["2e2e2e2e-5e01-4111-8111-2e2e2e2e2e5e"],
        },
      ],
    });
    const parsed = creditNoteCreateDraftPayloadSchema.safeParse(payload);
    expect(parsed.success).toBe(true);
    if (parsed.success) {
      expect(parsed.data.invoiceId).toBe(INVOICE_ID);
      expect(parsed.data.noteDate).toBe("2026-11-18");
      expect(parsed.data.lines[0]).toMatchObject({
        invoiceLineId: INVOICE_LINE,
        qty: "1",
        returnToStock: true,
      });
      expect(parsed.data.lines[0]?.batchId).toBe("2e2e2e2e-ba01-4111-8111-2e2e2e2e2eb1");
      expect(parsed.data.lines[0]?.serialIds).toEqual(["2e2e2e2e-5e01-4111-8111-2e2e2e2e2e5e"]);
    }
  });

  it("blocks structurally: missing original invoice (BR-004), empty lines, zero qty", () => {
    expect(saveReturnDraft(store, CTX, { invoiceId: "", lines: [{ invoiceLineId: INVOICE_LINE, qty: "1", returnToStock: true }] }).ok).toBe(false);
    expect(saveReturnDraft(store, CTX, { invoiceId: INVOICE_ID, lines: [] }).ok).toBe(false);
    expect(
      saveReturnDraft(store, CTX, { invoiceId: INVOICE_ID, lines: [{ invoiceLineId: INVOICE_LINE, qty: "0", returnToStock: false }] }).ok,
    ).toBe(false);
  });

  it("saves: DRAFT_LOCAL → DRAFT (the server ACK creates the DRAFT; posting stays online)", () => {
    const uuid = sequencedUuid("ca");
    const saved = saveReturnDraft(
      store,
      CTX,
      {
        invoiceId: INVOICE_ID,
        lines: [{ invoiceLineId: INVOICE_LINE, qty: "2", returnToStock: true }],
      },
      uuid,
    );
    expect(saved.ok).toBe(true);
    const row = flowRowByCommandId(store, saved.commandId!);
    expect(row?.entityType).toBe("credit_note");
    expect(row?.intent).toBe("create_draft");

    markInFlight(store, [saved.commandId!]);
    applyResult(store, {
      commandId: saved.commandId!,
      status: "ACCEPTED",
      officialNo: null,
      acceptedResult: { creditNoteId: "srv-cn-1", status: "DRAFT" },
    });
    const view = returnDocument(store, saved.commandId!);
    expect(view?.state).toBe("POSTED"); // the COMMAND is accepted…
    expect(flowStateFromRow(flowRowByCommandId(store, saved.commandId!))).toBe("POSTED");
    // …and the SERVER document status is the row-27 DRAFT (DRAFT_LOCAL → DRAFT).
    const accepted = JSON.parse(flowRowByCommandId(store, saved.commandId!)?.acceptedResult ?? "{}") as { status?: string };
    expect(accepted.status).toBe("DRAFT");
    expect(view?.lineCount).toBe(1);
  });

  it("→ REJECTED(editable) VALIDATION_ERROR when the invoice reference is not a POSTED invoice (BR-004 server-side)", () => {
    const uuid = sequencedUuid("cb");
    const saved = saveReturnDraft(
      store,
      CTX,
      { invoiceId: INVOICE_ID, lines: [{ invoiceLineId: INVOICE_LINE, qty: "1", returnToStock: false }] },
      uuid,
    );
    markInFlight(store, [saved.commandId!]);
    applyResult(store, {
      commandId: saved.commandId!,
      status: "REJECTED",
      rejectionReason: "VALIDATION_ERROR",
      rejectionAction: "EDIT_AND_RESEND",
      error: "credit notes reference POSTED invoices only",
      resubmittable: true,
    });
    expect(returnDocument(store, saved.commandId!)?.state).toBe("REJECTED");
  });
});

// -- the stock-count lines (row 11 OFFLINE-DRAFT — facts only) -------------------------

describe("PHASE-022 2-e · the stock-count lines (row 11 OFFLINE-DRAFT — facts only)", () => {
  const COUNT_ID = "2e2e2e2e-c0de-4111-8111-2e2e2e2e2ec0";

  it("emits a SERVER-VALID stock_count:submit_lines payload (counted facts, batchRef optional)", () => {
    const payload = buildCountLinesPayload({
      countId: COUNT_ID,
      lines: [
        { itemId: ITEM_A, countedQty: "9" },
        { itemId: ITEM_B, countedQty: "0", batchRef: "2e2e2e2e-ba02-4111-8111-2e2e2e2e2eb2" },
      ],
    });
    const parsed = stockCountSubmitLinesPayloadSchema.safeParse(payload);
    expect(parsed.success).toBe(true);
    if (parsed.success) {
      expect(parsed.data.countId).toBe(COUNT_ID);
      expect(parsed.data.lines).toEqual([
        { itemId: ITEM_A, countedQty: "9" },
        { itemId: ITEM_B, countedQty: "0", batchRef: "2e2e2e2e-ba02-4111-8111-2e2e2e2e2eb2" },
      ]);
    }
  });

  it("a counted ZERO is legitimate (a loss is a fact) — never blocked", () => {
    expect(
      validateCountLines({ countId: COUNT_ID, lines: [{ itemId: ITEM_A, countedQty: "0" }] }).blocking,
    ).toHaveLength(0);
  });

  it("blocks: malformed session ref, empty lines, malformed qty, duplicate (item,batch)", () => {
    expect(validateCountLines({ countId: "junk", lines: [{ itemId: ITEM_A, countedQty: "1" }] }).blocking).not.toHaveLength(0);
    expect(validateCountLines({ countId: COUNT_ID, lines: [] }).blocking).not.toHaveLength(0);
    expect(validateCountLines({ countId: COUNT_ID, lines: [{ itemId: ITEM_A, countedQty: "1.2.3" }] }).blocking).not.toHaveLength(0);
    expect(
      validateCountLines({
        countId: COUNT_ID,
        lines: [
          { itemId: ITEM_A, countedQty: "1" },
          { itemId: ITEM_A, countedQty: "2" },
        ],
      }).blocking,
    ).not.toHaveLength(0);
  });

  it("scan-to-count resolves the barcode through the shared cache reader; unknown codes surface null", () => {
    expect(scanCountItem(store, "6291000000099")?.id).toBe(ITEM_A);
    expect(scanCountItem(store, "0000000000000")).toBeUndefined();
  });

  it("saves: DRAFT_LOCAL → DRAFT (submit/review/approve stay online server decisions)", () => {
    const uuid = sequencedUuid("da");
    const saved = saveCountLines(
      store,
      CTX,
      {
        countId: COUNT_ID,
        lines: [
          { itemId: ITEM_A, countedQty: "10" },
          { itemId: ITEM_B, countedQty: "3" },
        ],
      },
      uuid,
    );
    expect(saved.ok).toBe(true);
    const row = flowRowByCommandId(store, saved.commandId!);
    expect(row?.entityType).toBe("stock_count");
    expect(row?.intent).toBe("submit_lines");
    markInFlight(store, [saved.commandId!]);
    applyResult(store, {
      commandId: saved.commandId!,
      status: "ACCEPTED",
      acceptedResult: { countId: COUNT_ID, status: "COUNTED" },
    });
    const view = countDocument(store, saved.commandId!);
    expect(view?.state).toBe("POSTED");
    expect(view?.lineCount).toBe(2);
    expect(view?.countId).toBe(COUNT_ID);
  });
});

// -- the shared offline numbering + the personal no-write proof -----------------------

describe("PHASE-022 2-e · the shared OFF- sequence + the personal hard guard", () => {
  it("the ONE per-device offline sequence advances across every flow (nextOfflineNumber reuse, UNMODIFIED)", () => {
    const before = Number(store.get("SELECT value FROM meta WHERE key = ?", [`offline_seq:${DEVICE_ID}`])?.value ?? "0");
    const localRef = nextOfflineNumber(store, "F01", DEVICE_ID);
    expect(localRef).toBe(`OFF-F01-${String(before + 1).padStart(5, "0")}`);
  });

  it("collection/unload/returns/count saves ALL refuse on a personal store (no outbox — §1.1 rule 2)", () => {
    const personal = openPersonalStore(":memory:");
    try {
      expect(() => saveFieldCollection(personal, CTX, { partnerId: PARTNER, method: "CASH", amount: "10" })).toThrow(/outbox|no such table/i); // the personal store has no outbox AND no field caches — the write path is structurally impossible
      expect(() =>
        saveVanUnloadConfirmation(personal, CTX, { vanWarehouseId: VAN_WH, toWarehouseId: TO_WH, lines: [{ itemId: ITEM_A, qty: "1" }] }),
      ).toThrow(/outbox|no such table/i); // the personal store has no outbox AND no field caches — the write path is structurally impossible
      expect(() =>
        saveReturnDraft(personal, CTX, { invoiceId: TRANSFER_ID, lines: [{ invoiceLineId: TRANSFER_ID, qty: "1", returnToStock: false }] }),
      ).toThrow(/outbox|no such table/i); // the personal store has no outbox AND no field caches — the write path is structurally impossible
      expect(() =>
        saveCountLines(personal, CTX, { countId: TRANSFER_ID, lines: [{ itemId: ITEM_A, countedQty: "1" }] }),
      ).toThrow(/outbox|no such table/i); // the personal store has no outbox AND no field caches — the write path is structurally impossible
    } finally {
      personal.close();
    }
  });
});
