import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { Decimal } from "@erp/domain-core";

import { superuserClient } from "../test-db";
import { withTenant } from "../../infra/db/tenant-context";
import { AuditService } from "../../modules/audit/api/audit";
import { DrizzleAuditStore } from "../../modules/audit/infrastructure/drizzle-audit.store";
import { PostingService } from "../../modules/accounting/application/posting-service";
import { PartnerSubledgerService } from "../../modules/partners/application/subledger-service";
import { NumberingService } from "../../modules/accounting/application/numbering-service";
import * as journal from "../../modules/accounting/infrastructure/journal.store";
import * as accountingStore from "../../modules/accounting/infrastructure/accounting.store";
import * as inventoryStore from "../../modules/inventory/infrastructure/inventory.store";
import * as pStore from "../../modules/purchasing/infrastructure/purchasing.store";
import { SupplierReturnsService } from "../../modules/purchasing/application/supplier-rma";
import {
  P_ACCOUNTANT,
  P_ACTOR,
  P_BUYER,
  TENANT_P,
  debitNotes,
  goodsReceipts,
  pCoa,
  purchaseOrders,
  setupPurchasingFixture,
  supplierInvoices,
  type PurchasingFixture,
} from "./fixtures";

/**
 * PHASE-039 · the supplier-RMA DB suite (task 7-API-A; migration 0059; R-03):
 * the return-to-vendor mirror over real PostgreSQL through the app-role
 * services — REQUESTED → APPROVED (SoD, SRTV-{YYYY}-{SEQ:6}) → SHIPPED (the
 * inventory issue through the movement engine riding the manual_issue source
 * with the SUPPLIER_RETURN marker) → CREDITED (G-38 + the auto-generated AP
 * debit note stamped POSTED against the journal, satisfying the 0059
 * lifecycle CHECK) — with the purchased-qty bound, SoD, the fail-closed
 * returns-account mapping, and BR-064's exactly-once credit all asserted.
 *
 * Runs on the shared purchasing tenant P (delta-based stock asserts like
 * every sibling file); every test builds its own PO → GR → supplier-invoice
 * chain so the bounds stay hermetic. Dates sit in FY2026-November, outside
 * every PERIOD_LOCKED pack.
 */

const RT_ORDER_DATE = "2026-11-04";
const RT_GRN_DATE = "2026-11-05";
const RT_INVOICE_DATE = "2026-11-06";
const RT_SHIP_DATE = "2026-11-10";
const RT_CREDIT_DATE = "2026-11-11";

const audit = new AuditService(new DrizzleAuditStore());
const posting = new PostingService(audit, new PartnerSubledgerService());
const numbering = new NumberingService(audit);
const supplierReturns = new SupplierReturnsService(audit, posting, numbering);

let fixture: PurchasingFixture;
let returnsAccountId = "";
let invoiceSeq = 0;

interface ExpectedLine {
  accountId: string;
  direction: "DEBIT" | "CREDIT";
  amount: string;
}

async function journalLinesOf(entryId: string): Promise<ExpectedLine[]> {
  const lines = await journal.listLines(entryId);
  return lines.map((line) => ({
    accountId: line.accountId,
    direction: line.direction as "DEBIT" | "CREDIT",
    amount: line.amount,
  }));
}

async function setTenantSetting(key: string, value: unknown): Promise<void> {
  const su = await superuserClient();
  await su.query(
    `INSERT INTO tenant_settings (id, tenant_id, key, value) VALUES (gen_random_uuid(), $1, $2, $3::jsonb)
     ON CONFLICT (tenant_id, key) DO UPDATE SET value = EXCLUDED.value`,
    [TENANT_P, key, JSON.stringify(value)],
  );
  await su.end();
}

async function clearTenantSetting(key: string): Promise<void> {
  const su = await superuserClient();
  await su.query(`DELETE FROM tenant_settings WHERE tenant_id = $1 AND key = $2`, [TENANT_P, key]);
  await su.end();
}

/** A hermetic PO → goods-receipt → POSTED supplier-invoice chain (NS tax —
 * G-38 carries no VAT legs), returning the PO and its first line. */
async function poChain(note: string): Promise<{ poId: string; poLineId: string }> {
  invoiceSeq += 1;
  const order = await withTenant(TENANT_P, () =>
    purchaseOrders.create({
      branchId: fixture.branchId,
      supplierId: fixture.supplierId,
      orderDate: RT_ORDER_DATE,
      expectedDate: null,
      currencyCode: "SAR",
      exchangeRate: null,
      note,
      noteAr: null,
      requestId: null,
      revisionOfId: null,
      actorId: P_BUYER,
      lines: [
        {
          itemId: fixture.items.wac,
          qty: "20",
          unitPrice: "2.500000",
          taxCodeId: null,
          requestLineId: null,
          note: null,
        },
      ],
    }),
  );
  const issued = await withTenant(TENANT_P, () => purchaseOrders.issue(order.id, P_BUYER));
  const orderLines = await withTenant(TENANT_P, () => pStore.listPurchaseOrderLines(issued.id));

  const grn = await withTenant(TENANT_P, () =>
    goodsReceipts.create({
      branchId: fixture.branchId,
      supplierId: fixture.supplierId,
      poId: issued.id,
      warehouseId: fixture.warehouseId,
      receiptDate: RT_GRN_DATE,
      poLessReason: null,
      note: `${note} — receipt`,
      noteAr: null,
      actorId: P_ACTOR,
      lines: [
        {
          poLineId: orderLines[0]!.id,
          itemId: fixture.items.wac,
          qty: "20",
          unitCost: "2.500000",
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
  const grnLines = await withTenant(TENANT_P, () => pStore.listGoodsReceiptLines(grn.id));

  const invoice = await withTenant(TENANT_P, () =>
    supplierInvoices.create({
      branchId: fixture.branchId,
      supplierId: fixture.supplierId,
      invoiceNo: `SUP-RTV-${String(invoiceSeq).padStart(3, "0")}`,
      invoiceDate: RT_INVOICE_DATE,
      dueDate: null,
      currencyCode: "SAR",
      exchangeRate: null,
      poId: issued.id,
      note: null,
      noteAr: null,
      actorId: P_ACCOUNTANT,
      lines: [
        {
          grnLineId: grnLines[0]!.id,
          itemId: fixture.items.wac,
          accountId: null,
          description: `${note} — stock line`,
          descriptionAr: null,
          qty: "20",
          unitPrice: "2.500000",
          taxCodeId: fixture.taxCodeIds.notSubject,
          vatRecoverable: null,
          note: null,
        },
      ],
    }),
  );
  await withTenant(TENANT_P, () => supplierInvoices.recordMatch({ id: invoice.id, actorId: P_BUYER }));
  await withTenant(TENANT_P, () => supplierInvoices.approve(invoice.id, P_ACTOR));
  await withTenant(TENANT_P, () => supplierInvoices.post(invoice.id, P_ACCOUNTANT));
  return { poId: issued.id, poLineId: orderLines[0]!.id };
}

beforeAll(async () => {
  fixture = await setupPurchasingFixture();
  // The tenant-mapped purchase-returns account (the ship journal debits it,
  // G-38 credits it) — a dedicated root postable row, unmapped by default so
  // the fail-closed pack can flip the setting.
  await withTenant(TENANT_P, async () => {
    let returns = await accountingStore.findAccountByCode("2145");
    if (returns === undefined) {
      returns = await pCoa.create(P_ACTOR, {
        code: "2145",
        name: "Purchase returns (RTV)",
        nameAr: "مرتجعات المشتريات",
        type: "LIABILITY",
        parentId: null,
        currencyCode: null,
        isGroup: false,
      });
    }
    returnsAccountId = returns.id;
  });
});

afterAll(async () => {
  await clearTenantSetting("purchasing.supplier_return_account");
});

// -- the lifecycle: REQUESTED → APPROVED (SoD) → SHIPPED → CREDITED (G-38) --------------

describe("PHASE-039 supplier RMAs — the full lifecycle to CREDITED (G-38)", () => {
  it("walks the ladder with SoD and the fail-closed account, ships through the movement engine, and credits exactly once", async () => {
    const chain = await poChain("RTV lifecycle");

    const srma = await withTenant(TENANT_P, () =>
      supplierReturns.create({
        branchId: fixture.branchId,
        purchaseOrderId: chain.poId,
        reasonCode: "DAMAGED",
        reason: "damaged on arrival",
        reasonAr: "تالفة عند الوصول",
        note: null,
        noteAr: null,
        actorId: P_BUYER,
        lines: [{ poLineId: chain.poLineId, qty: "5", note: null }],
      }),
    );
    expect(srma.status).toBe("REQUESTED");
    expect(srma.supplierId).toBe(fixture.supplierId);
    expect(srma.currencyCode).toBe("SAR");
    // The cost snapshot: 5 × 2.50 at 4dp (no VAT legs on a return credit).
    expect(srma.totalNet).toBe("12.5000");
    expect(srma.lines).toHaveLength(1);
    expect(srma.lines[0]).toMatchObject({ poLineId: chain.poLineId, qty: "5.000000", unitCost: "2.5000" });

    // SoD: the creator can never approve.
    await expect(
      withTenant(TENANT_P, () => supplierReturns.approve(srma.id, P_BUYER)),
    ).rejects.toMatchObject({ code: "SELF_APPROVAL_BLOCKED" });

    const approved = await withTenant(TENANT_P, () => supplierReturns.approve(srma.id, P_ACTOR));
    expect(approved.status).toBe("APPROVED");
    expect(approved.srmaNo).toMatch(/^SRTV-2026-\d{6}$/);
    expect(approved.approvedBy).toBe(P_ACTOR);

    // Fail-closed: the returns account unmapped → typed, nothing ships.
    await clearTenantSetting("purchasing.supplier_return_account");
    await expect(
      withTenant(TENANT_P, () =>
        supplierReturns.ship({
          srmaId: srma.id,
          warehouseId: fixture.warehouseId,
          entryDate: RT_SHIP_DATE,
          actorId: P_ACTOR,
        }),
      ),
    ).rejects.toMatchObject({ code: "SUPPLIER_RETURN_ACCOUNT_UNMAPPED" });
    const stillApproved = await withTenant(TENANT_P, () => supplierReturns.find(srma.id));
    expect(stillApproved.status).toBe("APPROVED");

    // Mapped: the goods leave through the movement engine — ONE inventory
    // journal (DR the mapped returns account · CR INVENTORY at issue cost).
    await setTenantSetting("purchasing.supplier_return_account", returnsAccountId);
    const stockBefore = await withTenant(TENANT_P, () =>
      inventoryStore.findItemStock(fixture.items.wac, fixture.warehouseId),
    );
    const shipped = await withTenant(TENANT_P, () =>
      supplierReturns.ship({
        srmaId: srma.id,
        warehouseId: fixture.warehouseId,
        entryDate: RT_SHIP_DATE,
        actorId: P_ACTOR,
      }),
    );
    expect(shipped.status).toBe("SHIPPED");
    expect(shipped.shippedAt).not.toBeNull();
    expect(shipped.shippedBy).toBe(P_ACTOR);

    // The stock_moves source CHECK was NOT widened — the issue rides the
    // generic manual_issue source with the SUPPLIER_RETURN reason marker and
    // source_id = the SRMA.
    const moves = await withTenant(TENANT_P, () =>
      inventoryStore.listStockMoves({ sourceType: "manual_issue", sourceId: srma.id, limit: 10 }),
    );
    expect(moves).toHaveLength(1);
    expect(moves[0]!.direction).toBe("OUT");
    expect(moves[0]!.qty).toBe("5.000000");
    expect(moves[0]!.reason).toBe("SUPPLIER_RETURN");
    const shipValue = moves[0]!.valueAmount;

    const shipEntry = await withTenant(TENANT_P, () =>
      journal.findEntryBySourceKey("supplier_return_authorization", srma.id, "ship"),
    );
    expect(shipEntry).toBeDefined();
    expect(await withTenant(TENANT_P, () => journalLinesOf(shipEntry!.id))).toEqual([
      { accountId: returnsAccountId, direction: "DEBIT", amount: shipValue },
      { accountId: fixture.gl.inventory, direction: "CREDIT", amount: shipValue },
    ]);

    // On-hand −5 (delta-based — sibling files share the item).
    const stockAfter = await withTenant(TENANT_P, () =>
      inventoryStore.findItemStock(fixture.items.wac, fixture.warehouseId),
    );
    expect(
      new Decimal(stockAfter!.qty).minus(new Decimal(stockBefore!.qty)).toFixed(6),
    ).toBe("-5.000000");

    // G-38: DR AP_CONTROL (partner, net) · CR the mapped returns account.
    const credited = await withTenant(TENANT_P, () =>
      supplierReturns.credit({ srmaId: srma.id, entryDate: RT_CREDIT_DATE, actorId: P_ACTOR }),
    );
    expect(credited.status).toBe("CREDITED");
    expect(credited.creditedAt).not.toBeNull();
    expect(credited.creditedBy).toBe(P_ACTOR);
    expect(credited.debitNoteId).not.toBeNull();
    expect(credited.postedJournalId).not.toBeNull();
    expect(credited.entryNo).not.toBeNull();

    const creditEntry = await withTenant(TENANT_P, () =>
      journal.findEntryBySourceKey("supplier_return_authorization", srma.id, "credit"),
    );
    expect(creditEntry).toBeDefined();
    expect(await withTenant(TENANT_P, () => journalLinesOf(creditEntry!.id))).toEqual([
      { accountId: fixture.gl.apControl, direction: "DEBIT", amount: "12.5000" },
      { accountId: returnsAccountId, direction: "CREDIT", amount: "12.5000" },
    ]);
    expect(credited.postedJournalId).toBe(creditEntry!.id);
    expect(credited.entryNo).toBe(creditEntry!.entryNo);

    // The DN document exists at CREDITED (the 0059 lifecycle CHECK demands
    // debit_note_id) — POSTED against the G-38 journal, through the
    // debit-notes store.
    const note = await withTenant(TENANT_P, () => debitNotes.find(credited.debitNoteId!));
    expect(note.status).toBe("POSTED");
    expect(note.noteNo).toMatch(/^DBN-2026-\d{6}$/);
    expect(note.postedJournalId).toBe(creditEntry!.id);
    expect(note.refInvoiceId).not.toBeNull();
    expect(note.totalNet).toBe("12.5000");
    expect(note.totalGross).toBe("12.5000");

    // BR-064 applied to the purchasing side: the credit hop is exactly-once.
    await expect(
      withTenant(TENANT_P, () =>
        supplierReturns.credit({ srmaId: srma.id, entryDate: RT_CREDIT_DATE, actorId: P_ACTOR }),
      ),
    ).rejects.toMatchObject({
      code: "SUPPLIER_RMA_STATE_INVALID",
      details: { current: "CREDITED", attempted: "credit" },
    });
  });
});

// -- the purchased-qty bound + the typed state machine -----------------------------------

describe("PHASE-039 supplier RMAs — the purchased-qty bound and the lifecycle gate", () => {
  it("rejects above the purchased qty, folds open supplier RMAs, frees on cancel, and gates the hops", async () => {
    const chain = await poChain("RTV bounding");

    const create = (qty: string) =>
      withTenant(TENANT_P, () =>
        supplierReturns.create({
          branchId: fixture.branchId,
          purchaseOrderId: chain.poId,
          reasonCode: "OVER_SHIPMENT",
          reason: null,
          reasonAr: null,
          note: null,
          noteAr: null,
          actorId: P_BUYER,
          lines: [{ poLineId: chain.poLineId, qty, note: null }],
        }),
      );

    // Above the purchased qty → typed with the fold's numbers.
    await expect(create("25")).rejects.toMatchObject({
      code: "SUPPLIER_RMA_QTY_EXCEEDS_PURCHASED",
      details: { lineId: chain.poLineId, qty: "25", available: "20.000000" },
    });

    // An OPEN (REQUESTED) SRMA claims 15 → only 5 stays available.
    const first = await create("15");
    await expect(create("10")).rejects.toMatchObject({
      code: "SUPPLIER_RMA_QTY_EXCEEDS_PURCHASED",
      details: { lineId: chain.poLineId, qty: "10", available: "5.000000" },
    });

    // Exactly the remaining qty passes (boundary inclusive).
    const second = await create("5");
    expect(second.status).toBe("REQUESTED");

    // Cancellation frees the claimed qty — a fresh SRMA of 5 fits again.
    await withTenant(TENANT_P, () => supplierReturns.cancel(second.id, "wrong item picked", P_ACTOR));
    const third = await create("5");
    expect(third.status).toBe("REQUESTED");

    // The state machine: ship straight out of REQUESTED is typed; the credit
    // hop off REQUESTED (before shipping) is typed; cancel off SHIPPED is
    // typed (ledger history — reversal lives in the engine).
    await expect(
      withTenant(TENANT_P, () =>
        supplierReturns.ship({
          srmaId: first.id,
          warehouseId: fixture.warehouseId,
          entryDate: RT_SHIP_DATE,
          actorId: P_ACTOR,
        }),
      ),
    ).rejects.toMatchObject({
      code: "SUPPLIER_RMA_STATE_INVALID",
      details: { current: "REQUESTED", attempted: "ship" },
    });
    await expect(
      withTenant(TENANT_P, () =>
        supplierReturns.credit({ srmaId: first.id, entryDate: RT_CREDIT_DATE, actorId: P_ACTOR }),
      ),
    ).rejects.toMatchObject({
      code: "SUPPLIER_RMA_STATE_INVALID",
      details: { current: "REQUESTED", attempted: "credit" },
    });

    await withTenant(TENANT_P, () => supplierReturns.approve(third.id, P_ACTOR));
    await setTenantSetting("purchasing.supplier_return_account", returnsAccountId);
    const shipped = await withTenant(TENANT_P, () =>
      supplierReturns.ship({
        srmaId: third.id,
        warehouseId: fixture.warehouseId,
        entryDate: RT_SHIP_DATE,
        actorId: P_ACTOR,
      }),
    );
    expect(shipped.status).toBe("SHIPPED");
    await expect(
      withTenant(TENANT_P, () => supplierReturns.cancel(third.id, "already gone", P_ACTOR)),
    ).rejects.toMatchObject({ code: "SUPPLIER_RMA_STATE_INVALID" });
  });
});
