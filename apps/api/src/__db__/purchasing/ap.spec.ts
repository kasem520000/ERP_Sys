import { beforeAll, beforeEach, describe, expect, it } from "vitest";

import { withTenant } from "../../infra/db/tenant-context";
import * as journalStore from "../../modules/accounting/infrastructure/journal.store";
import {
  P_ACCOUNTANT,
  P_ACTOR,
  P_JAN,
  P_MAR,
  TENANT_P,
  allocations,
  apQueries,
  goodsReceipts,
  openingAp,
  payments,
  pOpeningDrafts,
  pOpeningPost,
  pPeriods,
  pReconciliation,
  purchasingReconciliation,
  reallocations,
  setupPurchasingFixture,
  supplierInvoices,
  type PurchasingFixture,
} from "./fixtures";

/**
 * PHASE-011 AP subledger tests (ACCOUNTING_TESTS §4; the phase §6):
 * RC-02 (Σ subledger = AP_CONTROL exactly — randomized op mix), RC-03
 * (seeded drift → BROKEN + PC-04 lock block), RC-09 (GRNI register =
 * GRNI account at each step), RC-10 (aging/statement determinism —
 * byte-identical re-runs), the G-16 AP side (opening balances are
 * allocatable open items from entry #1, INV-009 exact), aging buckets,
 * and the audited re-allocation document (BR-027/INV-016).
 */

let fixture: PurchasingFixture;
let openingPosted = false;

beforeAll(async () => {
  fixture = await setupPurchasingFixture();
});

/** G-16 AP side: the supplier's opening balance becomes an allocatable open item. */
async function ensureOpeningAp(): Promise<void> {
  if (openingPosted) return;
  await withTenant(TENANT_P, async () => {
    const existing = await pOpeningDrafts.list("PARTNER", undefined, 100);
    const openingRows = existing.rows as unknown as { partnerId: string | null }[];
    if (!openingRows.some((row) => row.partnerId === fixture.supplierId)) {
      await pOpeningDrafts.create(P_ACTOR, {
        kind: "PARTNER",
        partnerId: fixture.supplierId,
        amount: "-1000.0000",
        note: "opening AP (G-16 supplier side)",
      });
    }
    await pOpeningPost.post(P_ACTOR, fixture.fiscalYearId);
  });
  openingPosted = true;
}

describe("G-16 AP side — opening balances settle like any invoice (INV-009 from entry #1)", () => {
  it("the opening AP item is open, allocatable, and included in statements", async () => {
    await ensureOpeningAp();
    const items = await withTenant(TENANT_P, () => openingAp.openingItems());
    const opening = items.find((row) => row.partnerId === fixture.supplierId);
    expect(opening).toBeDefined();
    expect(opening!.amount).toBe("1000.0000");

    // INV-009 exact from the first entry: Σ subledger = AP_CONTROL.
    const verification = await withTenant(TENANT_P, () =>
      openingAp.verifyInv009({ asOf: P_JAN }),
    );
    expect(verification.ok).toBe(true);
    expect(verification.diff).toBe("0.0000");
    expect(verification.openingItems).toBeGreaterThan(0);

    // The statement includes the opening entry deterministically.
    const statement = await withTenant(TENANT_P, () =>
      apQueries.statement({ supplierId: fixture.supplierId, asOf: P_JAN }),
    );
    const openingEntry = statement.entries.find((row) => row.sourceType === "opening_balances");
    expect(openingEntry).toBeDefined();
    expect(openingEntry!.credit).toBe("1000.0000");
  });

  it("a payment settles the opening item exactly (G-16's settlement proof)", async () => {
    await ensureOpeningAp();
    const items = await withTenant(TENANT_P, () => apQueries.openItems({ supplierId: fixture.supplierId }));
    const opening = items.find((row) => row.sourceType === "opening_balances");
    expect(opening).toBeDefined();

    const payment = await withTenant(TENANT_P, () =>
      payments.create({
        cashAccountId: fixture.cashAccountId,
        partnerId: fixture.supplierId,
        method: "BANK",
        payeeName: null,
        currencyCode: "SAR",
        amount: "1000.0000",
        exchangeRate: null,
        valueDate: P_MAR,
        reference: "opening settlement",
        description: "settle opening AP",
        descriptionAr: null,
        actorId: P_ACCOUNTANT,
      }),
    );
    await withTenant(TENANT_P, () =>
      allocations.setAllocations({
        docType: "payment",
        docId: payment.id,
        allocations: [{ openItemId: opening!.id, amount: "1000.0000" }],
        actorId: P_ACCOUNTANT,
      }),
    );
    await withTenant(TENANT_P, () => payments.post(payment.id, P_ACCOUNTANT));

    const after = await withTenant(TENANT_P, () => apQueries.openItems({ supplierId: fixture.supplierId }));
    expect(after.find((row) => row.sourceType === "opening_balances")).toBeUndefined();
    const verification = await withTenant(TENANT_P, () => openingAp.verifyInv009({ asOf: P_MAR }));
    expect(verification.ok).toBe(true);
  });
});

describe("RC-02/RC-03 — AP subledger = AP_CONTROL exact, drift detected", () => {
  it("RC-02: 20 randomized AP operations reconcile exactly (OK run)", async () => {
    // A randomized mix over the fixture timeline: expense invoices with
    // varied amounts (deterministic seed for reproducibility).
    let seed = 42;
    const rand = (max: number) => {
      seed = (seed * 1103515245 + 12345) % 2147483648;
      return seed % max;
    };
    for (let i = 0; i < 20; i += 1) {
      const amount = (rand(900) + 100).toFixed(2);
      const invoice = await withTenant(TENANT_P, () =>
        supplierInvoices.create({
          branchId: fixture.branchId,
          supplierId: fixture.supplierId,
          invoiceNo: `SUP-RC02-${i}`,
          invoiceDate: P_MAR,
          dueDate: "2026-04-14",
          currencyCode: "SAR",
          exchangeRate: null,
          poId: null,
          note: null,
          noteAr: null,
          actorId: P_ACCOUNTANT,
          lines: [
            {
              grnLineId: null,
              itemId: null,
              accountId: fixture.items.expenseAccount,
              description: `RC-02 op ${i}`,
              descriptionAr: null,
              qty: "1",
              unitPrice: `${amount}`,
              taxCodeId: null,
              vatRecoverable: null,
              note: null,
            },
          ],
        }),
      );
      await withTenant(TENANT_P, () =>
        supplierInvoices.recordMatch({
          id: invoice.id,
          actorId: P_ACCOUNTANT,
          dispositions: [{ invoiceLineNo: 1, type: "ACCEPT_WITH_REASON", reason: "RC-02 randomized op" }],
        }),
      );
      await withTenant(TENANT_P, () => supplierInvoices.approve(invoice.id, P_ACTOR));
      await withTenant(TENANT_P, () => supplierInvoices.post(invoice.id, P_ACCOUNTANT));
    }
    const run = await withTenant(TENANT_P, () =>
      pReconciliation.runApCheck({ asOf: P_MAR, runMode: "ON_DEMAND", checkedBy: P_ACTOR }),
    );
    expect(run.status).toBe("OK");
    expect(run.controlBalance).toBe(run.subledgerBalance);
    expect(run.diffCount).toBe(0);
  });

  it("RC-03: seeded subledger drift → BROKEN + PC-04 blocks the period lock", async () => {
    // Seed drift via superuser tooling (the documented repair path — the
    // subledger is append-only for erp_app): capture one AP subledger row's
    // full contents, delete it, then repair by re-inserting it.
    const { superuserClient } = await import("../test-db");
    const su = await superuserClient();
    const captured = await su.query(
      `SELECT s.* FROM partner_subledger_entries s
       WHERE s.tenant_id = $1
         AND NOT EXISTS (SELECT 1 FROM treasury_allocations a WHERE a.open_item_id = s.id)
       ORDER BY s.entry_date, s.id LIMIT 1`,
      [TENANT_P],
    );
    expect(captured.rows.length).toBe(1);
    const victim = captured.rows[0]!;
    await su.query(`ALTER TABLE partner_subledger_entries DISABLE TRIGGER trg_partner_subledger_guard`);
    await su.query(`DELETE FROM partner_subledger_entries WHERE id = $1`, [victim.id]);
    await su.query(`ALTER TABLE partner_subledger_entries ENABLE TRIGGER trg_partner_subledger_guard`);
    await su.end();

    const run = await withTenant(TENANT_P, () =>
      pReconciliation.runApCheck({ asOf: P_MAR, runMode: "ON_DEMAND", checkedBy: P_ACTOR }),
    );
    expect(run.status).toBe("BROKEN");

    // PC-04: the LOCK is refused while a core check is BROKEN.
    const { findPeriodForDate } = await import("../../modules/accounting/infrastructure/accounting.store");
    const period = await withTenant(TENANT_P, () => findPeriodForDate(P_MAR));
    await withTenant(TENANT_P, () => pPeriods.softClose(P_ACTOR, period!.id));
    try {
      await expect(
        withTenant(TENANT_P, () => pPeriods.lock(P_ACTOR, period!.id)),
      ).rejects.toMatchObject({ code: "RECONCILIATION_BROKEN" });
    } finally {
      await withTenant(TENANT_P, () => pPeriods.reopen(P_ACTOR, period!.id, "RC-03 pack reopen"));
    }

    // Repair (the documented superuser-tooling drift repair): restore the
    // exact row, then re-run green.
    const su2 = await superuserClient();
    await su2.query(`ALTER TABLE partner_subledger_entries DISABLE TRIGGER trg_partner_subledger_guard`);
    await su2.query(
      `INSERT INTO partner_subledger_entries (id, tenant_id, partner_id, journal_entry_id, journal_line_id,
         entry_date, direction, amount, base_amount, currency_code, source_type, source_id, memo)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)`,
      [victim.id, victim.tenant_id, victim.partner_id, victim.journal_entry_id, victim.journal_line_id,
       victim.entry_date, victim.direction, victim.amount, victim.base_amount, victim.currency_code,
       victim.source_type, victim.source_id, victim.memo],
    );
    await su2.query(`ALTER TABLE partner_subledger_entries ENABLE TRIGGER trg_partner_subledger_guard`);
    await su2.end();

    const repaired = await withTenant(TENANT_P, () =>
      pReconciliation.runApCheck({ asOf: P_MAR, runMode: "ON_DEMAND", checkedBy: P_ACTOR }),
    );
    expect(repaired.status).toBe("OK");
  });
});

describe("RC-09 — GRNI register reconciles at each step", () => {
  it("GRN → invoice → partial: the register equals the GRNI account at every step", async () => {
    const { listGoodsReceipts, listGoodsReceiptLines } = await import(
      "../../modules/purchasing/infrastructure/purchasing.store"
    );

    // Fresh chain (FIFO item, no prior invoices).
    const { purchaseOrders } = await import("./fixtures");
    const order = await withTenant(TENANT_P, () =>
      purchaseOrders.create({
        branchId: fixture.branchId,
        supplierId: fixture.supplierId,
        orderDate: P_MAR,
        expectedDate: null,
        currencyCode: "SAR",
        exchangeRate: null,
        note: null,
        noteAr: null,
        requestId: null,
        revisionOfId: null,
        actorId: P_ACCOUNTANT,
        lines: [
          { itemId: fixture.items.fifo, qty: "10", unitPrice: "7.000000", taxCodeId: null, requestLineId: null, note: null },
        ],
      }),
    );
    await withTenant(TENANT_P, () => purchaseOrders.issue(order.id, P_ACCOUNTANT));
    const pStore = await import("../../modules/purchasing/infrastructure/purchasing.store");
    const orderLines = await withTenant(TENANT_P, () => pStore.listPurchaseOrderLines(order.id));
    const grn = await withTenant(TENANT_P, () =>
      goodsReceipts.create({
        branchId: fixture.branchId,
        supplierId: fixture.supplierId,
        poId: order.id,
        warehouseId: fixture.warehouseId,
        receiptDate: P_MAR,
        poLessReason: null,
        note: null,
        noteAr: null,
        actorId: P_ACTOR,
        lines: [
          {
            poLineId: orderLines[0]!.id,
            itemId: fixture.items.fifo,
            qty: "10",
            unitCost: "7.000000",
            accountId: null,
            batchNo: null,
            batchExpiry: null,
            serialIds: null,
            note: null,
          },
        ],
      }),
    );
    await withTenant(TENANT_P, () => goodsReceipts.post(grn.id, P_ACTOR));

    // Step 1: GRN posted — register = account = +70.
    let run = await withTenant(TENANT_P, () =>
      purchasingReconciliation.runGrniCheck({ asOf: P_MAR, runMode: "ON_DEMAND", checkedBy: P_ACTOR }),
    );
    expect(run.status).toBe("OK");
    expect(run.subledgerBalance).toBe(run.controlBalance);

    const grnLines = await withTenant(TENANT_P, () => listGoodsReceiptLines(grn.id));
    void listGoodsReceipts;

    // Step 2: partial invoice (6 of 10) — register = 70 − 42 = 28.
    const invoice = await withTenant(TENANT_P, () =>
      supplierInvoices.create({
        branchId: fixture.branchId,
        supplierId: fixture.supplierId,
        invoiceNo: `SUP-RC09-${Date.now()}`,
        invoiceDate: P_MAR,
        dueDate: "2026-04-14",
        currencyCode: "SAR",
        exchangeRate: null,
        poId: order.id,
        note: null,
        noteAr: null,
        actorId: P_ACCOUNTANT,
        lines: [
          {
            grnLineId: grnLines[0]!.id,
            itemId: fixture.items.fifo,
            accountId: null,
            description: null,
            descriptionAr: null,
            qty: "6",
            unitPrice: "7.000000",
            taxCodeId: null,
            vatRecoverable: null,
            note: null,
          },
        ],
      }),
    );
    await withTenant(TENANT_P, () => supplierInvoices.recordMatch({ id: invoice.id, actorId: P_ACCOUNTANT }));
    await withTenant(TENANT_P, () => supplierInvoices.approve(invoice.id, P_ACTOR));
    await withTenant(TENANT_P, () => supplierInvoices.post(invoice.id, P_ACCOUNTANT));

    run = await withTenant(TENANT_P, () =>
      purchasingReconciliation.runGrniCheck({ asOf: P_MAR, runMode: "ON_DEMAND", checkedBy: P_ACTOR }),
    );
    expect(run.status).toBe("OK");

    // The register row itself: 10 received − 6 invoiced.
    const rows = await withTenant(TENANT_P, () => apQueries.grniRegister(P_MAR));
    const row = rows.find((r) => r.grnLineId === grnLines[0]!.id);
    expect(row!.receivedQty).toBe("10.000000");
    expect(row!.invoicedQty).toBe("6.000000");
  });
});

describe("RC-10 — aging + statements are deterministic as-of recomputations", () => {
  it("re-running at the same as-of yields byte-identical results", async () => {
    const first = await withTenant(TENANT_P, () => apQueries.aging({ asOf: P_MAR }));
    const second = await withTenant(TENANT_P, () => apQueries.aging({ asOf: P_MAR }));
    expect(JSON.stringify(second)).toBe(JSON.stringify(first));

    const s1 = await withTenant(TENANT_P, () =>
      apQueries.statement({ supplierId: fixture.supplierId, asOf: P_MAR }),
    );
    const s2 = await withTenant(TENANT_P, () =>
      apQueries.statement({ supplierId: fixture.supplierId, asOf: P_MAR }),
    );
    expect(JSON.stringify(s2)).toBe(JSON.stringify(s1));
  });

  it("aging buckets split by due date (not due / overdue)", async () => {
    const rows = await withTenant(TENANT_P, () => apQueries.aging({ asOf: P_MAR }));
    expect(rows.length).toBeGreaterThan(0);
    const supplier = rows.find((r) => r.supplierId === fixture.supplierId);
    expect(supplier).toBeDefined();
    // Buckets sum to the total exactly.
    const bucketSum = (
      Number(supplier!.notDue) +
      Number(supplier!.b1_30) +
      Number(supplier!.b31_60) +
      Number(supplier!.b61_90) +
      Number(supplier!.b90Plus)
    ).toFixed(4);
    expect(bucketSum).toBe(supplier!.total);
    // The RC-02 invoices (due 2026-04-14, as-of 2026-03-10) are not due.
    expect(Number(supplier!.notDue)).toBeGreaterThan(0);
  });

  it("statements show document currency + base totals (BR-028)", async () => {
    const statement = await withTenant(TENANT_P, () =>
      apQueries.statement({ supplierId: fixture.supplierId, asOf: P_MAR }),
    );
    expect(statement.entries.length).toBeGreaterThan(2);
    for (const entry of statement.entries) {
      expect(entry.currencyCode).toMatch(/^[A-Z]{3}$/);
      expect(entry.baseBalance).toBeDefined();
    }
    // The base running balance is computed per entry (INV-008's stored
    // rates); the document-currency Σ and the base Σ are both present on
    // the statement (multi-currency suppliers included).
  });
});

describe("Re-allocations — audited documents (BR-027/INV-016)", () => {
  let paymentId = "";
  let fromItem = "";
  let toItem = "";

  beforeEach(async () => {
    // One payment partially allocated across two invoices (the substrate).
    if (paymentId !== "") return;
    const openBefore = await withTenant(TENANT_P, () =>
      apQueries.openItems({ supplierId: fixture.supplierId }),
    );
    void openBefore;
    // Two fresh invoices to allocate across.
    const ids: string[] = [];
    for (let i = 0; i < 2; i += 1) {
      const invoice = await withTenant(TENANT_P, () =>
        supplierInvoices.create({
          branchId: fixture.branchId,
          supplierId: fixture.supplierId,
          invoiceNo: `SUP-RAL-${Date.now()}-${i}`,
          invoiceDate: P_MAR,
          dueDate: "2026-04-14",
          currencyCode: "SAR",
          exchangeRate: null,
          poId: null,
          note: null,
          noteAr: null,
          actorId: P_ACCOUNTANT,
          lines: [
            {
              grnLineId: null,
              itemId: null,
              accountId: fixture.items.expenseAccount,
              description: `re-allocation fixture ${i}`,
              descriptionAr: null,
              qty: "1",
              unitPrice: "100.000000",
              taxCodeId: null,
              vatRecoverable: null,
              note: null,
            },
          ],
        }),
      );
      await withTenant(TENANT_P, () =>
        supplierInvoices.recordMatch({
          id: invoice.id,
          actorId: P_ACCOUNTANT,
          dispositions: [{ invoiceLineNo: 1, type: "ACCEPT_WITH_REASON", reason: "re-allocation fixture" }],
        }),
      );
      await withTenant(TENANT_P, () => supplierInvoices.approve(invoice.id, P_ACTOR));
      await withTenant(TENANT_P, () => supplierInvoices.post(invoice.id, P_ACCOUNTANT));
      ids.push(invoice.id);
    }
    const items = await withTenant(TENANT_P, () =>
      apQueries.openItems({ supplierId: fixture.supplierId }),
    );
    fromItem = items.find((row) => row.sourceId === ids[0])!.id;
    toItem = items.find((row) => row.sourceId === ids[1])!.id;

    const payment = await withTenant(TENANT_P, () =>
      payments.create({
        cashAccountId: fixture.cashAccountId,
        partnerId: fixture.supplierId,
        method: "BANK",
        payeeName: null,
        currencyCode: "SAR",
        amount: "150.0000",
        exchangeRate: null,
        valueDate: P_MAR,
        reference: "re-allocation substrate",
        description: "partially allocated payment",
        descriptionAr: null,
        actorId: P_ACCOUNTANT,
      }),
    );
    await withTenant(TENANT_P, () =>
      allocations.setAllocations({
        docType: "payment",
        docId: payment.id,
        allocations: [
          { openItemId: fromItem, amount: "100.0000" },
          { openItemId: toItem, amount: "50.0000" },
        ],
        actorId: P_ACCOUNTANT,
      }),
    );
    await withTenant(TENANT_P, () => payments.post(payment.id, P_ACCOUNTANT));
    paymentId = payment.id;
  });

  it("moves a settled amount between open items as an audited document", async () => {
    const doc = await withTenant(TENANT_P, () =>
      reallocations.execute({
        paymentId,
        reason: "buyer correction: apply to invoice 2",
        actorId: P_ACCOUNTANT,
        lines: [{ fromOpenItemId: fromItem, toOpenItemId: toItem, amount: "30.0000" }],
      }),
    );
    expect(doc.docNo).toMatch(/^RAL-2026-\d{6}$/);
    expect(doc.totalAmount).toBe("30.0000");

    // The rewritten allocations: from 100→70, to 50→80.
    const pStore = await import("../../modules/purchasing/infrastructure/purchasing.store");
    const after = await withTenant(TENANT_P, () => pStore.paymentPostedAllocations(paymentId));
    const from = after.find((row) => row.openItemId === fromItem);
    const to = after.find((row) => row.openItemId === toItem);
    expect(from!.amount).toBe("70.0000");
    expect(to!.amount).toBe("80.0000");

    // Σ allocations still ≤ payment amount (INV-016): 70 + 80 = 150 ✓.
    const sum = after.reduce((acc, row) => acc + Number(row.amount), 0);
    expect(sum.toFixed(4)).toBe("150.0000");

    // The audited document list shows the movement.
    const docs = await withTenant(TENANT_P, () => reallocations.list({ paymentId, limit: 50 }));
    expect(docs.length).toBe(1);
    expect(docs[0]!.reason).toBe("buyer correction: apply to invoice 2");
  });

  it("rejects re-allocation beyond the settled amount (INV-016 bounds)", async () => {
    await expect(
      withTenant(TENANT_P, () =>
        reallocations.execute({
          paymentId,
          reason: "over-move attempt",
          actorId: P_ACCOUNTANT,
          lines: [{ fromOpenItemId: fromItem, toOpenItemId: toItem, amount: "71.0000" }],
        }),
      ),
    ).rejects.toMatchObject({ code: "REALLOCATION_SOURCE_INVALID" });
  });

  it("return-to-on-account: to NULL un-allocates explicitly (BR-027)", async () => {
    const doc = await withTenant(TENANT_P, () =>
      reallocations.execute({
        paymentId,
        reason: "return 20 to on-account pending dispute",
        actorId: P_ACCOUNTANT,
        lines: [{ fromOpenItemId: toItem, toOpenItemId: null, amount: "20.0000" }],
      }),
    );
    expect(doc.totalAmount).toBe("20.0000");
    const pStore = await import("../../modules/purchasing/infrastructure/purchasing.store");
    const after = await withTenant(TENANT_P, () => pStore.paymentPostedAllocations(paymentId));
    const to = after.find((row) => row.openItemId === toItem);
    expect(to!.amount).toBe("60.0000");
    const sum = after.reduce((acc, row) => acc + Number(row.amount), 0);
    expect(sum.toFixed(4)).toBe("130.0000"); // 20 back on-account
  });
});

describe("PC-04 — GRNI BROKEN blocks the period lock", () => {
  it("a drifted GRNI run refuses LOCK until green (RC-09's gate)", async () => {
    // Seed drift via superuser tooling: delete one GRN line's cleared value
    // by inserting a fake invoice line effect is complex — instead mutate a
    // posted GRN line's value via superuser (the documented tooling path).
    const { superuserClient } = await import("../test-db");
    const su = await superuserClient();
    const row = await su.query(
      `SELECT l.id FROM goods_receipt_lines l
       JOIN goods_receipts g ON g.id = l.receipt_id
       WHERE l.tenant_id = $1 AND g.status = 'POSTED' LIMIT 1`,
      [TENANT_P],
    );
    await su.query(
      `UPDATE goods_receipt_lines SET value_amount = value_amount + 1 WHERE id = $1`,
      [row.rows[0]!.id],
    );
    await su.end();

    const run = await withTenant(TENANT_P, () =>
      purchasingReconciliation.runGrniCheck({ asOf: P_MAR, runMode: "ON_DEMAND", checkedBy: P_ACTOR }),
    );
    expect(run.status).toBe("BROKEN");

    const period = await withTenant(TENANT_P, async () => {
      const { findPeriodForDate } = await import("../../modules/accounting/infrastructure/accounting.store");
      return findPeriodForDate(P_MAR);
    });
    await withTenant(TENANT_P, () => pPeriods.softClose(P_ACTOR, period!.id));
    try {
      await expect(
        withTenant(TENANT_P, () => pPeriods.lock(P_ACTOR, period!.id)),
      ).rejects.toMatchObject({ code: "RECONCILIATION_BROKEN" });
    } finally {
      await withTenant(TENANT_P, () => pPeriods.reopen(P_ACTOR, period!.id, "RC-09 pack reopen"));
    }

    // Repair (documented superuser tooling): restore the value.
    const su2 = await superuserClient();
    await su2.query(
      `UPDATE goods_receipt_lines SET value_amount = value_amount - 1 WHERE id = $1`,
      [row.rows[0]!.id],
    );
    await su2.end();
    const repaired = await withTenant(TENANT_P, () =>
      purchasingReconciliation.runGrniCheck({ asOf: P_MAR, runMode: "ON_DEMAND", checkedBy: P_ACTOR }),
    );
    expect(repaired.status).toBe("OK");
  });
});

/** Journal read port (evidence helper). */
export function journalEntry(id: string) {
  return withTenant(TENANT_P, () => journalStore.findEntryById(id));
}
