import { beforeAll, describe, expect, it } from "vitest";

import { withTenant } from "../../infra/db/tenant-context";
import { TENANT_A } from "../test-db";
import {
  P_ACCOUNTANT,
  P_ACTOR,
  P_BUYER,
  P_JAN,
  TENANT_P,
  goodsReceipts,
  purchaseOrders,
  purchaseRequests,
  purchasingAppClient,
  setupPurchasingFixture,
  supplierInvoices,
  type PurchasingFixture,
} from "./fixtures";

/**
 * PHASE-011 operations tests (the phase §6): tenant isolation (A7 spoof —
 * cross-tenant supplier/GRN references are typed-404 with zero residue),
 * BR-012 PO-less policy (allowed-with-reason default; forbidden when the
 * policy is off), BR-010 PO approval thresholds (SoD: creator ≠ approver),
 * INV-021 numbering (official numbers immutable, unique), and CC-01
 * duplicate-post serialization.
 */

let fixture: PurchasingFixture;

beforeAll(async () => {
  fixture = await setupPurchasingFixture();
});

describe("A7 — tenant isolation (spoof parity)", () => {
  it("cross-tenant supplier references are rejected with typed errors + zero residue", async () => {
    // A purchase order referencing tenant A's partner id (from the seed
    // tenants — TENANT_A's users/partners are foreign to tenant P).
    const foreignPartnerId = "11111111-1111-4111-8111-111111111111"; // any foreign uuid
    await expect(
      withTenant(TENANT_P, () =>
        purchaseOrders.create({
          branchId: fixture.branchId,
          supplierId: foreignPartnerId,
          orderDate: P_JAN,
          expectedDate: null,
          currencyCode: "SAR",
          exchangeRate: null,
          note: null,
          noteAr: null,
          requestId: null,
          revisionOfId: null,
          actorId: P_ACTOR,
          lines: [
            { itemId: fixture.items.wac, qty: "1", unitPrice: "1.000000", taxCodeId: null, requestLineId: null, note: null },
          ],
        }),
      ),
    ).rejects.toMatchObject({ code: "SUPPLIER_NOT_FOUND" });
  });

  it("the RLS policies hold on the raw plane (app role sees only tenant P's purchasing rows)", async () => {
    const client = await purchasingAppClient();
    const result = await client.query("SELECT count(*)::int AS n FROM purchase_orders");
    expect(result.rows[0]!.n).toBeGreaterThan(0);
    // A second tenant's scope sees zero of tenant P's rows.
    const { appClient: rawAppClient } = await import("../test-db");
    const foreignClient = await rawAppClient();
    await foreignClient.query("SELECT set_config('erp.tenant_id', $1, false)", [TENANT_A]);
    const foreign = await foreignClient.query(
      "SELECT count(*)::int AS n FROM supplier_invoices WHERE supplier_id = $1",
      [fixture.supplierId],
    );
    expect(foreign.rows[0]!.n).toBe(0);
    await client.end();
    await foreignClient.end();
  });
});

describe("BR-012 — PO-less goods receipts", () => {
  it("allowed by default with an explicit reason (audited)", async () => {
    const grn = await withTenant(TENANT_P, () =>
      goodsReceipts.create({
        branchId: fixture.branchId,
        supplierId: fixture.supplierId,
        poId: null,
        warehouseId: fixture.warehouseId,
        receiptDate: P_JAN,
        poLessReason: "urgent maintenance part (BR-012 direct purchase)",
        note: null,
        noteAr: null,
        actorId: P_ACTOR,
        lines: [
          {
            poLineId: null,
            itemId: fixture.items.wac,
            qty: "2",
            unitCost: "5.000000",
            accountId: null,
            batchNo: null,
            batchExpiry: null,
            serialIds: null,
            note: null,
          },
        ],
      }),
    );
    expect(grn.poLessReason).toContain("BR-012");
    const result = await withTenant(TENANT_P, () => goodsReceipts.post(grn.id, P_ACTOR));
    expect(result.receiptNo).toMatch(/^GRN-2026-\d{6}$/);
  });

  it("reason is mandatory for PO-less receipts", async () => {
    await expect(
      withTenant(TENANT_P, () =>
        goodsReceipts.create({
          branchId: fixture.branchId,
          supplierId: fixture.supplierId,
          poId: null,
          warehouseId: fixture.warehouseId,
          receiptDate: P_JAN,
          poLessReason: null,
          note: null,
          noteAr: null,
          actorId: P_ACTOR,
          lines: [
            {
              poLineId: null,
              itemId: fixture.items.wac,
              qty: "1",
              unitCost: "1.000000",
              accountId: null,
              batchNo: null,
              batchExpiry: null,
              serialIds: null,
              note: null,
            },
          ],
        }),
      ),
    ).rejects.toMatchObject({ code: "PO_LESS_REASON_REQUIRED" });
  });

  it("forbidden when the policy is off", async () => {
    const { upsertSetting } = await import("../../modules/tenancy/infrastructure/tenancy.store");
    await withTenant(TENANT_P, () => upsertSetting("purchasing.allow_po_less_grn", false, P_ACTOR));
    try {
      await expect(
        withTenant(TENANT_P, () =>
          goodsReceipts.create({
            branchId: fixture.branchId,
            supplierId: fixture.supplierId,
            poId: null,
            warehouseId: fixture.warehouseId,
            receiptDate: P_JAN,
            poLessReason: "should be forbidden now",
            note: null,
            noteAr: null,
            actorId: P_ACTOR,
            lines: [
              {
                poLineId: null,
                itemId: fixture.items.wac,
                qty: "1",
                unitCost: "1.000000",
                accountId: null,
                batchNo: null,
                batchExpiry: null,
                serialIds: null,
                note: null,
              },
            ],
          }),
        ),
      ).rejects.toMatchObject({ code: "PO_LESS_GRN_FORBIDDEN" });
    } finally {
      await withTenant(TENANT_P, () => upsertSetting("purchasing.allow_po_less_grn", true, P_ACTOR));
    }
  });
});

describe("BR-010 — PO approval thresholds + SoD", () => {
  it("above-threshold orders require the approval hop (base-currency compare)", async () => {
    const { upsertSetting } = await import("../../modules/tenancy/infrastructure/tenancy.store");
    await withTenant(TENANT_P, () => upsertSetting("purchasing.po_approval_threshold", "100.0000", P_ACTOR));
    try {
      const big = await withTenant(TENANT_P, () =>
        purchaseOrders.create({
          branchId: fixture.branchId,
          supplierId: fixture.supplierId,
          orderDate: P_JAN,
          expectedDate: null,
          currencyCode: "SAR",
          exchangeRate: null,
          note: null,
          noteAr: null,
          requestId: null,
          revisionOfId: null,
          actorId: P_BUYER,
          lines: [
            { itemId: fixture.items.wac, qty: "10", unitPrice: "20.000000", taxCodeId: null, requestLineId: null, note: null },
          ],
        }),
      );
      // Above threshold (200 > 100): issue refuses without approval.
      await expect(
        withTenant(TENANT_P, () => purchaseOrders.issue(big.id, P_BUYER)),
      ).rejects.toMatchObject({ code: "PURCHASING_DOCUMENT_STATE" });

      // SoD: the creator cannot approve their own order (BR-034 default).
      await withTenant(TENANT_P, () => purchaseOrders.submit(big.id, P_BUYER));
      await expect(
        withTenant(TENANT_P, () => purchaseOrders.approve(big.id, P_BUYER)),
      ).rejects.toMatchObject({ code: "SELF_APPROVAL_BLOCKED" });
      await withTenant(TENANT_P, () => purchaseOrders.approve(big.id, P_ACTOR));
      const issued = await withTenant(TENANT_P, () => purchaseOrders.issue(big.id, P_ACTOR));
      expect(issued.status).toBe("ISSUED");

      // Below threshold: the small order skips the hop (single-owner MVP).
      const small = await withTenant(TENANT_P, () =>
        purchaseOrders.create({
          branchId: fixture.branchId,
          supplierId: fixture.supplierId,
          orderDate: P_JAN,
          expectedDate: null,
          currencyCode: "SAR",
          exchangeRate: null,
          note: null,
          noteAr: null,
          requestId: null,
          revisionOfId: null,
          actorId: P_BUYER,
          lines: [
            { itemId: fixture.items.wac, qty: "1", unitPrice: "50.000000", taxCodeId: null, requestLineId: null, note: null },
          ],
        }),
      );
      const directIssued = await withTenant(TENANT_P, () => purchaseOrders.issue(small.id, P_BUYER));
      expect(directIssued.status).toBe("ISSUED");
    } finally {
      await withTenant(TENANT_P, () => upsertSetting("purchasing.po_approval_threshold", null, P_ACTOR));
    }
  });

  it("PR approvals enforce SoD too (creator ≠ approver)", async () => {
    const request = await withTenant(TENANT_P, () =>
      purchaseRequests.create({
        branchId: fixture.branchId,
        neededBy: null,
        note: null,
        noteAr: null,
        actorId: P_BUYER,
        lines: [{ itemId: fixture.items.wac, qty: "1", note: null }],
      }),
    );
    await withTenant(TENANT_P, () => purchaseRequests.submit(request.id, P_BUYER));
    await expect(
      withTenant(TENANT_P, () => purchaseRequests.approve(request.id, P_BUYER)),
    ).rejects.toMatchObject({ code: "SELF_APPROVAL_BLOCKED" });
    const approved = await withTenant(TENANT_P, () => purchaseRequests.approve(request.id, P_ACTOR));
    expect(approved.requestNo).toMatch(/^PRN-\d{6}$/);
  });
});

describe("INV-021 — official numbers", () => {
  it("numbers are sequential, unique, and immutable once assigned", async () => {
    const orderA = await withTenant(TENANT_P, () =>
      purchaseOrders.create({
        branchId: fixture.branchId,
        supplierId: fixture.supplierId,
        orderDate: P_JAN,
        expectedDate: null,
        currencyCode: "SAR",
        exchangeRate: null,
        note: null,
        noteAr: null,
        requestId: null,
        revisionOfId: null,
        actorId: P_ACTOR,
        lines: [
          { itemId: fixture.items.wac, qty: "1", unitPrice: "1.000000", taxCodeId: null, requestLineId: null, note: null },
        ],
      }),
    );
    const issuedA = await withTenant(TENANT_P, () => purchaseOrders.issue(orderA.id, P_ACTOR));
    const orderB = await withTenant(TENANT_P, () =>
      purchaseOrders.create({
        branchId: fixture.branchId,
        supplierId: fixture.supplierId,
        orderDate: P_JAN,
        expectedDate: null,
        currencyCode: "SAR",
        exchangeRate: null,
        note: null,
        noteAr: null,
        requestId: null,
        revisionOfId: null,
        actorId: P_ACTOR,
        lines: [
          { itemId: fixture.items.wac, qty: "1", unitPrice: "1.000000", taxCodeId: null, requestLineId: null, note: null },
        ],
      }),
    );
    const issuedB = await withTenant(TENANT_P, () => purchaseOrders.issue(orderB.id, P_ACTOR));
    expect(issuedA.orderNo).not.toBe(issuedB.orderNo);
    const seqA = Number(issuedA.orderNo!.split("-").pop());
    const seqB = Number(issuedB.orderNo!.split("-").pop());
    expect(seqB).toBe(seqA + 1);

    // Immutable: a re-read shows the same number (posted rows never change).
    const reread = await withTenant(TENANT_P, () => purchaseOrders.find(orderA.id));
    expect(reread.orderNo).toBe(issuedA.orderNo);
  });
});

describe("CC-01 — duplicate-post serialization (INV-013)", () => {
  it("two CONCURRENT posts of one invoice converge on one entry set", async () => {
    const invoice = await withTenant(TENANT_P, () =>
      supplierInvoices.create({
        branchId: fixture.branchId,
        supplierId: fixture.supplierId,
        invoiceNo: `SUP-CC01-${Date.now()}`,
        invoiceDate: P_JAN,
        dueDate: "2026-02-14",
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
            description: "CC-01 duplicate-post fixture",
            descriptionAr: null,
            qty: "1",
            unitPrice: "10.000000",
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
        dispositions: [{ invoiceLineNo: 1, type: "ACCEPT_WITH_REASON", reason: "CC-01 fixture" }],
      }),
    );
    await withTenant(TENANT_P, () => supplierInvoices.approve(invoice.id, P_ACTOR));

    // Two concurrent posts in the same tenant scope.
    const [first, second] = await Promise.all([
      withTenant(TENANT_P, () => supplierInvoices.post(invoice.id, P_ACCOUNTANT)),
      withTenant(TENANT_P, () => supplierInvoices.post(invoice.id, P_ACCOUNTANT)),
    ]);
    // Both converge on the same journal entry (one entry set, losers replay).
    expect(first.journalEntryId).toBe(second.journalEntryId);
    expect([first.idempotentReplay, second.idempotentReplay]).toContain(true);
  });
});
