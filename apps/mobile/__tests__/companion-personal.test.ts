import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { mkdtempSync, readdirSync, readFileSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  applyResult,
  buildSyncCommandV2,
  enqueue,
  nextOfflineNumber,
  rejectedCommands,
} from "@erp/sync-core";

import { openFieldStore, openPersonalStore, type MobileStore } from "../src/store";
import {
  approvalsAffordance,
  buildCompanionDashboard,
  buildStatementView,
  buildCachedInvoices,
  buildOwnDocuments,
  searchMasterData,
} from "../src/companion";
import { buildPersonalHome } from "../src/personal";

/**
 * PHASE-022 T-P22-3-b · the companion + personal view-models (MASTER-PLAN
 * §8 "Companion"/"Personal" — READ-CACHED† with as-of labels; OFFLINE_
 * CAPABILITIES_MATRIX rows 12–14/16/29/33) over REAL openFieldStore /
 * openPersonalStore temp SQLite files, PLUS the STRUCTURAL no-write
 * proof: the companion + personal modules NEVER import enqueue or any
 * command builder (a source scan over src/companion + src/personal).
 */

const DEVICE_ID = "3b3b3b3b-0000-4111-8111-3b3b3b3b3b01";
const TODAY = "2026-11-18";
const ITEM_A = "3b3b3b3b-2222-4111-8111-3b3b3b3b3b22";
const PARTNER_A = "3b3b3b3b-6666-4111-8111-3b3b3b3b3b66";

let dir: string;
let field: MobileStore;
let personal: MobileStore;

/** Seed one outbox command (any intent) for the dashboard/documents.
 * The row's client_created_at is stamped to TODAY (the dashboard filters
 * by the business date the flows stamp — enqueue's clock is the real now). */
function seedCommand(
  entityType: string,
  intent: string,
  payload: Record<string, unknown>,
): string {
  const localRef = nextOfflineNumber(field, "F01", DEVICE_ID);
  const command = buildSyncCommandV2({ entityType, intent, payload, localRef });
  const enqueued = field.transaction(() =>
    enqueue(field, {
      entityType: command.entityType,
      intent: command.intent,
      payload: command.payload as Record<string, unknown>,
      idempotencyKey: command.idempotencyKey,
      commandId: command.commandId,
      localRef,
    }),
  );
  field.run("UPDATE outbox SET client_created_at = ? WHERE command_id = ?", [
    `${TODAY}T10:00:00Z`,
    enqueued.commandId,
  ]);
  return enqueued.commandId;
}

beforeAll(() => {
  dir = mkdtempSync(join(tmpdir(), "p22-3b-companion-"));
  field = openFieldStore(join(dir, "field.db"));
  personal = openPersonalStore(":memory:");

  // -- the field store's caches ------------------------------------------------
  field.run(
    `INSERT INTO items (id, sku, name, name_ar, kind, uom_id, category_id, tax_code_id, base_price,
                        track_batch, track_serial, track_imei, status, updated_at, dirty)
     VALUES (?, 'SKU-WATER', 'مياه 600مل', NULL, 'STOCK', NULL, NULL, NULL, '2.5000', 0, 0, 0, 'ACTIVE', '2026-11-17T10:00:00Z', 0)`,
    [ITEM_A],
  );
  field.run(
    `INSERT INTO partners (id, code, name, name_ar, kind, status, credit_limit, price_list_id, tax_number, updated_at)
     VALUES (?, 'C-001', 'عميل الطريق الأول', NULL, 'CUSTOMER', 'ACTIVE', '100.0000', NULL, NULL, '2026-11-17T10:00:00Z')`,
    [PARTNER_A],
  );
  field.run(
    `INSERT INTO van_stocks (id, warehouse_id, item_id, batch_id, qty, value, refreshed_at, payload, version, updated_at, dirty)
     VALUES ('3b3b3b3b-v001-4111-8111-3b3b3b3b3v01', 'wh-van', ?, NULL, '10.500000', '0.0000', '2026-11-17T09:30:00Z', '{}', 3, '2026-11-17T09:30:00Z', 0)`,
    [ITEM_A],
  );
  field.run(
    `INSERT INTO statements (id, customer_code, customer_name, customer_name_ar, as_of, currency_code,
        opening_balance, closing_balance, closing_balance_base, aging, entries, generated_at, payload, version, updated_at, dirty)
     VALUES (?, 'C-001', 'عميل الطريق الأول', NULL, '2026-11-16', 'SAR', '80.0000', '90.0000', '90.0000',
             ?, ?, '2026-11-17T09:00:00Z', '{}', NULL, '2026-11-17T09:00:00Z', 0)`,
    [
      PARTNER_A,
      JSON.stringify({ not_due: "70.0000", "1_30": "20.0000", "31_60": "0.0000", "61_90": "0.0000", "90_plus": "0.0000" }),
      JSON.stringify([
        { entryDate: "2026-11-10", docRef: "INV-100", sourceType: "sales_invoice", currencyCode: "SAR", debit: "20.0000", credit: "0.0000", outstanding: "100.0000" },
        { entryDate: "2026-11-12", docRef: "RCT-20", sourceType: "receipt", currencyCode: "SAR", debit: "0.0000", credit: "10.0000", outstanding: "90.0000" },
      ]),
    ],
  );

  // -- today's documents (the dashboard aggregation input) ----------------------
  seedCommand("sales_invoice", "create_draft", {
    customerId: PARTNER_A,
    orderDate: TODAY,
    lines: [{ itemId: ITEM_A, qty: "3", unitPrice: "2.5000" }],
  });
  seedCommand("receipt", "create_field_collection", {
    partnerId: PARTNER_A,
    method: "CASH",
    currencyCode: "SAR",
    amount: "50.0000",
    valueDate: TODAY,
  });
  const rejectedId = seedCommand("sales_invoice", "create_draft", {
    customerId: PARTNER_A,
    orderDate: TODAY,
    lines: [{ itemId: ITEM_A, qty: "9", unitPrice: "2.5000" }],
  });
  applyResult(field, {
    commandId: rejectedId,
    status: "REJECTED",
    rejectionReason: "PRICE_CHANGED",
    rejectionDetails: { traceId: "trace-cpr-001", server: "3.0000", cached: "2.5000" },
  });
  const ackedId = seedCommand("sales_invoice", "create_draft", {
    customerId: PARTNER_A,
    orderDate: TODAY,
    lines: [{ itemId: ITEM_A, qty: "1", unitPrice: "2.0000" }],
  });
  applyResult(field, {
    commandId: ackedId,
    status: "ACCEPTED",
    officialNo: "INV-2026-0901",
    acceptedResult: { status: "DRAFT" },
  });

  // -- the personal store's read models ----------------------------------------
  personal.run(
    `INSERT INTO statements (id, customer_code, customer_name, customer_name_ar, as_of, currency_code,
        opening_balance, closing_balance, closing_balance_base, aging, entries, generated_at, payload, version, updated_at, dirty)
     VALUES (?, 'C-001', 'عميل الطريق الأول', NULL, '2026-11-16', 'SAR', '100.0000', '125.5000', '125.5000',
             ?, '[]', '2026-11-17T09:00:00Z', '{}', NULL, '2026-11-17T09:00:00Z', 0)`,
    [
      PARTNER_A,
      JSON.stringify({ not_due: "100.0000", "1_30": "25.5000", "31_60": "0.0000", "61_90": "0.0000", "90_plus": "0.0000" }),
    ],
  );
  personal.run(
    `INSERT INTO sales_invoices (id, invoice_no, status, kind, channel, customer_id, order_date, total_amount, currency, owner_device_id, payload, version, updated_at, dirty)
     VALUES ('3b3b3b3b-inv1-4111-8111-3b3b3b3b3i01', 'INV-2026-0901', 'POSTED', 'CREDIT', 'FIELD', ?, '2026-11-10', '125.5000', 'SAR', NULL, '{}', 2, '2026-11-17T09:10:00Z', 0)`,
    [PARTNER_A],
  );
  personal.run(
    `INSERT INTO receipts (id, receipt_no, status, partner_id, method, currency_code, amount, value_date, reference, posted_at, payload, version, updated_at, dirty)
     VALUES ('3b3b3b3b-rcp1-4111-8111-3b3b3b3b3r01', 'RCT-2026-0044', 'POSTED', ?, 'CASH', 'SAR', '10.0000', '2026-11-12', NULL, '2026-11-12T12:00:00Z', '{}', 1, '2026-11-17T09:20:00Z', 0)`,
    [PARTNER_A],
  );
  personal.run(
    `INSERT INTO notifications (id, user_id, category, severity, title, body, action_label, action_url, read_at, payload, version, updated_at, dirty)
     VALUES
       ('3b3b3b3b-not1-4111-8111-3b3b3b3b3n01', ?, 'invoice_overdue', 'warning', ?, '{}', NULL, NULL, NULL, '{}', 1, '2026-11-17T09:30:00Z', 0),
       ('3b3b3b3b-not2-4111-8111-3b3b3b3b3n02', ?, 'subscription', 'info', ?, '{}', NULL, NULL, '2026-11-16T08:00:00Z', '{}', 1, '2026-11-16T08:00:00Z', 0)`,
    [
      DEVICE_ID,
      JSON.stringify({ ar: "فاتورة متأخرة", en: "Invoice overdue" }),
      DEVICE_ID,
      JSON.stringify({ ar: "تنبيه اشتراك", en: "Subscription notice" }),
    ],
  );
});

afterAll(() => {
  field.close();
  personal.close();
  rmSync(dir, { recursive: true, force: true });
});

// -- THE STRUCTURAL NO-WRITE PROOF ------------------------------------------------------

describe("PHASE-022 T-P22-3-b · the structural no-write proof (companion + personal never enqueue)", () => {
  /** Every .ts source under a directory (recursive). */
  function sources(root: string): string[] {
    const out: string[] = [];
    for (const entry of readdirSync(root)) {
      const full = join(root, entry);
      if (statSync(full).isDirectory()) out.push(...sources(full));
      else if (entry.endsWith(".ts")) out.push(full);
    }
    return out;
  }

  it("no companion/personal module imports or calls enqueue or any command builder (the source scan)", () => {
    const writeCalls = [
      /\benqueue\s*\(/,
      /\bbuildSyncCommandV2\s*\(/,
      /\bbuildDraftInvoiceCreate\s*\(/,
      /\bbuildDraftInvoiceUpdate\s*\(/,
      /\bbuildPosSaleCommand\s*\(/,
      /\bbuildShiftOpenCommand\s*\(/,
      /\bbuildShiftCloseCommand\s*\(/,
      /\bbuildPartnerContactMerge\s*\(/,
      /\bapplyResult\s*\(/,
      /\bmarkInFlight\s*\(/,
      /\brequeue\s*\(/,
      /\bcapturePosSale\s*\(/,
      /\bmetaSet\s*\(/,
      /\bcancel\s*\(/,
    ];
    const writeNames = [
      "enqueue",
      "buildSyncCommandV2",
      "buildDraftInvoiceCreate",
      "buildDraftInvoiceUpdate",
      "buildPosSaleCommand",
      "buildShiftOpenCommand",
      "buildShiftCloseCommand",
      "buildPartnerContactMerge",
      "applyResult",
      "markInFlight",
      "requeue",
      "capturePosSale",
      "metaSet",
      "cancel",
    ];
    const roots = [
      join(__dirname, "..", "src", "companion"),
      join(__dirname, "..", "src", "personal"),
    ];
    const files = roots.flatMap((root) => sources(root));
    expect(files.length).toBeGreaterThanOrEqual(7); // the scan saw the areas
    for (const file of files) {
      const source = readFileSync(file, "utf8");
      for (const pattern of writeCalls) {
        expect(pattern.test(source), `${file} calls a write API (${pattern})`).toBe(false);
      }
      // No sync-core IMPORT may name a write symbol (types + reads only).
      for (const line of source.split("\n")) {
        if (!/@erp\/sync-core/.test(line) || !/^\s*import/.test(line)) continue;
        for (const name of writeNames) {
          expect(
            new RegExp(`\\b${name}\\b`).test(line),
            `${file} imports "${name}" from sync-core`,
          ).toBe(false);
        }
      }
    }
  });

  it("the module shapes export no write path either (the barrel scan)", async () => {
    const companion = await import("../src/companion");
    const personal = await import("../src/personal");
    const writeExports = [
      "enqueue",
      "cancel",
      "applyResult",
      "markInFlight",
      "requeue",
      "capturePosSale",
      "metaSet",
      "buildSyncCommandV2",
      "buildDraftInvoiceCreate",
      "buildDraftInvoiceUpdate",
      "buildPosSaleCommand",
      "buildPartnerContactMerge",
    ];
    for (const barrel of [companion, personal]) {
      for (const key of Object.keys(barrel)) {
        expect(writeExports, `the barrel exports "${key}"`).not.toContain(key);
      }
    }
  });
});

// -- the companion view-models -----------------------------------------------------------

describe("PHASE-022 T-P22-3-b · the companion dashboard (READ-CACHED aggregation + as-of)", () => {
  it("today's metrics: sales/collections/cash per currency + parked count + van stock with as-of", () => {
    const dashboard = buildCompanionDashboard(field, { today: TODAY });
    // sales = the live draft (7.5000) + the rejected one (22.5000, awaiting
    // the §3 choice — the aggregate is honest by inclusion) + the ACKED
    // one (2.0000).
    expect(dashboard.sales.count).toBe(3);
    expect(dashboard.sales.byCurrency).toEqual([{ currencyCode: "SAR", amount: "32.0000" }]);
    expect(dashboard.sales.asOf).not.toBeNull();
    expect(dashboard.collections).toMatchObject({ count: 1 });
    expect(dashboard.collections.byCurrency).toEqual([{ currencyCode: "SAR", amount: "50.0000" }]);
    expect(dashboard.cash.byCurrency).toEqual([{ currencyCode: "SAR", amount: "50.0000" }]);
    expect(dashboard.parkedRejections).toBe(1);
    expect(dashboard.vanStock).toEqual({ totalQty: "10.500000", asOf: "2026-11-17T09:30:00Z" });
  });

  it("an empty day is honest zeros, never a guessed amount (null van stock when never pulled)", () => {
    const dashboard = buildCompanionDashboard(field, { today: "2026-01-01" });
    expect(dashboard.sales.count).toBe(0);
    expect(dashboard.sales.byCurrency).toEqual([]);
    expect(dashboard.sales.asOf).toBeNull();
  });
});

describe("PHASE-022 T-P22-3-b · the statement view (entries + running balance + as-of)", () => {
  it("renders the cached snapshot: entries with COMPUTED running balances, opening/closing, aging, as-of", () => {
    const view = buildStatementView(field, { partnerId: PARTNER_A });
    expect(view).not.toBeNull();
    expect(view!.openingBalance).toBe("80.0000");
    expect(view!.entries).toHaveLength(2);
    // The running balance is COMPUTED from the opening (the projection
    // rows carried no balance field): 80 + 20 = 100, then 100 − 10 = 90.
    expect(view!.entries[0]!.balance).toBe("100.0000");
    expect(view!.entries[1]!.balance).toBe("90.0000");
    expect(view!.closingBalance).toBe("90.0000");
    expect(view!.asOf).toBe("2026-11-16");
    expect(view!.generatedAt).toBe("2026-11-17T09:00:00Z");
    expect(view!.aging).toMatchObject({ not_due: "70.0000", "1_30": "20.0000" });
  });

  it("an unknown partner / never-pulled cache → null (never a fabricated zero statement)", () => {
    expect(buildStatementView(field, { partnerId: "3b3b3b3b-0000-4111-8111-3b3b3b3b3f0f" })).toBeNull();
  });
});

describe("PHASE-022 T-P22-3-b · the own-documents invoice views (locally-created + synced)", () => {
  it("every honest state is listed; the official number appears ONLY on the ACKED row", () => {
    const docs = buildOwnDocuments(field);
    expect(docs).toHaveLength(3);
    const posted = docs.find((doc) => doc.officialNo === "INV-2026-0901");
    expect(posted).toMatchObject({ state: "POSTED", serverStatus: "DRAFT", totalAmount: "2.0000" });
    const rejected = docs.find((doc) => doc.state === "REJECTED");
    expect(rejected).toBeDefined();
    expect(rejected!.officialNo).toBeNull(); // never a guessed number
    const pending = docs.filter((doc) => doc.state === "PENDING_SYNC");
    expect(pending).toHaveLength(1);
    for (const doc of docs) {
      expect(doc.asOf).not.toBeNull();
    }
  });

  it("the cached server invoices (the read model) mirror the synced list", () => {
    // The FIELD profile has no sales_invoices table (the personal read
    // model) — the companion's own-documents list is the outbox view.
    expect(() => buildCachedInvoices(field)).toThrow();
    const cached = buildCachedInvoices(personal);
    expect(cached).toHaveLength(1);
    expect(cached[0]).toMatchObject({ invoiceNo: "INV-2026-0901", status: "POSTED", totalAmount: "125.5000" });
  });
});

describe("PHASE-022 T-P22-3-b · master-data search from cache (row 33)", () => {
  it("matches items + partners by code/name/Arabic name with as-of labels", () => {
    const hits = searchMasterData(field, { query: "مياه" });
    expect(hits).toHaveLength(1);
    expect(hits[0]).toMatchObject({ kind: "item", code: "SKU-WATER", asOf: "2026-11-17T10:00:00Z" });
    const byCode = searchMasterData(field, { query: "C-001" });
    expect(byCode).toHaveLength(1);
    expect(byCode[0]!.kind).toBe("partner");
  });

  it("an empty query fetches nothing; LIKE metacharacters match literally", () => {
    expect(searchMasterData(field, { query: "   " })).toEqual([]);
    expect(searchMasterData(field, { query: "%" })).toEqual([]);
    expect(searchMasterData(field, { query: "SKU-WAT" })).toHaveLength(1);
  });
});

// -- the ONLINE-ONLY approvals affordance (row 16) --------------------------------------

describe("PHASE-022 T-P22-3-b · the approvals affordance (ONLINE-ONLY — never queued)", () => {
  it("online → enabled; offline → disabled WITH the honest reason (no queue path exists)", () => {
    expect(approvalsAffordance(true)).toEqual({ enabled: true, reason: null });
    const offline = approvalsAffordance(false);
    expect(offline).toEqual({ enabled: false, reason: "offline" });
    if (offline.enabled) throw new Error("unreachable");
  });
});

// -- the personal home view-model (row 29 — READ-ONLY) ----------------------------------

describe("PHASE-022 T-P22-3-b · the personal home (balance + due dates + recent docs + notifications)", () => {
  it("the READ-ONLY aggregation over the personal read models", () => {
    const view = buildPersonalHome(personal, { today: TODAY });
    expect(view.balance).toEqual({
      amount: "125.5000",
      currencyCode: "SAR",
      asOf: "2026-11-16",
      generatedAt: "2026-11-17T09:00:00Z",
    });
    expect(view.linkedPartner).toMatchObject({ id: PARTNER_A, code: "C-001" });
    expect(view.aging).toEqual([
      { bucket: "not_due", amount: "100.0000" },
      { bucket: "1_30", amount: "25.5000" },
      { bucket: "31_60", amount: "0.0000" },
      { bucket: "61_90", amount: "0.0000" },
      { bucket: "90_plus", amount: "0.0000" },
    ]);
    expect(view.recentDocs).toHaveLength(2);
    // Newest-updated first: the receipt (09:20) over the invoice (09:10).
    expect(view.recentDocs[0]).toMatchObject({ kind: "receipt", number: "RCT-2026-0044", amount: "10.0000" });
    expect(view.recentDocs[1]).toMatchObject({ kind: "invoice", number: "INV-2026-0901" });
    expect(view.notifications).toHaveLength(2);
    expect(view.notifications[0]).toMatchObject({ titleAr: "فاتورة متأخرة", titleEn: "Invoice overdue" });
    expect(view.unreadCount).toBe(1);
  });

  it("an empty personal store is honest nulls/zeros — never a guessed balance", () => {
    const fresh = openPersonalStore(":memory:");
    const view = buildPersonalHome(fresh);
    expect(view.balance).toBeNull();
    expect(view.linkedPartner).toBeNull();
    expect(view.aging.map((row) => row.amount)).toEqual(["0", "0", "0", "0", "0"]);
    expect(view.recentDocs).toEqual([]);
    expect(view.notifications).toEqual([]);
    expect(view.unreadCount).toBe(0);
    fresh.close();
  });
});

// -- the rejected-commands read (the parked list's source — read-only) -------------------

describe("PHASE-022 T-P22-3-b · the parked list source (sync-core's rejectedCommands, reused)", () => {
  it("exactly the REJECTED rows are parked", () => {
    const parked = rejectedCommands(field);
    expect(parked).toHaveLength(1);
    expect(parked[0]!.rejectionReason).toBe("PRICE_CHANGED");
  });
});
