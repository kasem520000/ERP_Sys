import { beforeAll, describe, expect, it } from "vitest";

import {
  ALL_KNOWN_PERMISSIONS,
  R_ACTOR,
  fullContext,
  newRunService,
  withTenant,
} from "./fixtures";
import { superuserClient, ensureTestDb } from "../test-db";
import { AuditService } from "../../modules/audit/api/audit";
import { DrizzleAuditStore } from "../../modules/audit/infrastructure/drizzle-audit.store";
import { PostingService } from "../../modules/accounting/application/posting-service";
import { PeriodService } from "../../modules/accounting/application/period-service";
import { NumberingService } from "../../modules/accounting/application/numbering-service";
import { PartnerSubledgerService } from "../../modules/partners/application/subledger-service";
import { TaxResolverService } from "../../modules/tax/application/tax-resolver-service";
import { WarehouseService } from "../../modules/inventory/application/warehouse-service";
import { StockService } from "../../modules/inventory/application/stock-service";
import { TrackingService } from "../../modules/inventory/application/tracking-service";
import { GoodsReceiptService } from "../../modules/purchasing/application/goods-receipts";
import { SalesInvoiceService } from "../../modules/sales/application/invoices";
import { CreditNoteService } from "../../modules/sales/application/credit-notes";
import type { ReportResult } from "../../modules/reporting/application/contract";

/**
 * PHASE-015 T10 · the industry report fixtures (industries/reports/README
 * PHASE-015 rows; PHASE-015 §6 "report fixtures asserting totals tie to
 * journal lines where applicable"): the three industry contracts over a
 * dedicated, fully-journaled inventory book — every stock row flows through
 * the real services (GRN → write-offs → sale → return), so the
 * grocery.expiry_writeoff totals tie EXACTLY to the INVENTORY_SHRINKAGE
 * journal lines and the expiry list's value at risk ties through INV-010.
 *
 * Dedicated tenant RI (SAR base): one PO-less GRN (three expiry batches at
 * a uniform WAC 2, a plain item at 5, three IMEI devices at 100), an
 * EXPIRED batch write-off (12.0000), a DAMAGE write-off (15.0000), one
 * serial sale (invoice) and its return (credit note). No transfers, no
 * revaluations — every move is journaled, so the INV-010 tie is exact.
 */

/** Dedicated industry-reporting tenant (owns its book end to end). */
export const TENANT_RI = "38383838-3838-3838-3838-383838383838";
/** The approver (BR-034 SoD: the creator never approves their own document). */
const RI_APPROVER = "3b3b3b3b-0000-4000-8000-00000000003b";

const audit = new AuditService(new DrizzleAuditStore());
const posting = new PostingService(audit, new PartnerSubledgerService());
const numbering = new NumberingService(audit);
const periods = new PeriodService(audit);
const warehouses = new WarehouseService(audit);
const stock = new StockService(audit, posting);
const tracking = new TrackingService(audit, stock);
const goodsReceipts = new GoodsReceiptService(audit, posting, numbering);
const salesInvoices = new SalesInvoiceService(audit, posting, numbering, new TaxResolverService());
const creditNotes = new CreditNoteService(audit, posting, numbering, new TaxResolverService());

interface IndustryFixture {
  warehouseId: string;
  perishableId: string;
  plainId: string;
  deviceId: string;
  serialIds: { s1: string; s2: string; s3: string };
  grnRef: string;
  saleRef: string;
  returnRef: string;
}

let fixture: IndustryFixture | undefined;

function assertDefined<T>(value: T | undefined | null, label: string): T {
  if (value === undefined || value === null) throw new Error(`fixture ${label} missing`);
  return value;
}

/** Boots tenant RI's book (idempotent — every step guards its own rows). */
async function setupIndustryFixture(): Promise<IndustryFixture> {
  if (fixture !== undefined) return fixture;
  ensureTestDb();
  const su = await superuserClient();
  await su.query(
    `INSERT INTO tenants (id, name, name_ar, base_currency, country_code, timezone) VALUES
       ($1, 'Tenant RI (industry reporting)', 'المستأجر ر-ص', 'SAR', 'SA', 'Asia/Riyadh')
     ON CONFLICT (id) DO NOTHING`,
    [TENANT_RI],
  );
  await su.query(
    `INSERT INTO users (id, email, full_name, password_hash, status)
     VALUES ($1, 'ri-actor@fixture.test', 'RI Actor', 'x', 'ACTIVE'),
            ($2, 'ri-approver@fixture.test', 'RI Approver', 'x', 'ACTIVE')
     ON CONFLICT (id) DO NOTHING`,
    [R_ACTOR, RI_APPROVER],
  );
  await su.end();

  const built = await withTenant(TENANT_RI, async () => {
    const { provisionCoaTemplate, seedMasterDataBasics, insertAccountPurpose, listBranches, insertBranch } =
      await import("../../modules/tenancy/infrastructure/tenancy.store");
    const { findAccountByCode, findActivePurpose, findFiscalYearByName } = await import(
      "../../modules/accounting/infrastructure/accounting.store"
    );
    const partnersStore = await import("../../modules/partners/infrastructure/partners.store");
    const itemsStore = await import("../../modules/items/infrastructure/items.store");
    await seedMasterDataBasics();
    await provisionCoaTemplate();

    // GRNI is the one purpose the template leaves unmarked that the GRN
    // posting needs (2130 — the accrued-expenses host, same as the
    // purchasing fixture). INVENTORY, INVENTORY_SHRINKAGE, COGS, AR_CONTROL,
    // SALES_REVENUE and SALES_RETURNS all resolve through the template.
    const mapPurpose = async (purposeKey: string, code: string) => {
      const existing = await findActivePurpose(purposeKey);
      if (existing !== undefined) return existing.accountId;
      const account = await findAccountByCode(code);
      if (account === undefined) throw new Error(`fixture account ${code} missing`);
      await insertAccountPurpose({ purposeKey, accountId: account.id, activeFrom: "2025-12-01" });
      return account.id;
    };
    await mapPurpose("GRNI", "2130");

    const existingYear = await findFiscalYearByName("FY2026");
    if (existingYear === undefined) {
      await periods.createYear(R_ACTOR, { name: "FY2026", startDate: "2026-01-01", endDate: "2026-12-31" });
    }

    const branches = await listBranches(null);
    const mainBranch =
      branches.find((b) => b.code === "MAIN") ??
      (await insertBranch({
        code: "MAIN",
        name: "Main branch",
        nameAr: "الفرع الرئيسي",
        address: null,
      }));
    const existingWarehouses = await warehouses.list({ limit: 10, activeOnly: false });
    const warehouse =
      existingWarehouses.find((w) => w.code === "RI-WH") ??
      (await warehouses.create({
        branchId: mainBranch.id,
        code: "RI-WH",
        name: "Industry warehouse",
        nameAr: "مستودع التقارير",
        inventoryAccountId: null,
        note: null,
        actorId: R_ACTOR,
      }));

    const uoms = await itemsStore.listUoms();
    const pcs = assertDefined(uoms.find((u) => u.code === "PCS"), "PCS uom");
    const ensureItem = async (
      sku: string,
      name: string,
      extra: { costingMethod?: string; trackBatch?: boolean; trackSerial?: boolean; hasExpiry?: boolean },
    ) => {
      const found = await itemsStore.findItemBySku(sku);
      if (found !== undefined) return found.id;
      const created = await itemsStore.insertItem({
        sku,
        name,
        nameAr: null,
        kind: "STOCK",
        uomId: pcs.id,
        categoryId: null,
        taxCodeId: null,
        costingMethod: extra.costingMethod ?? "WAC",
        trackBatch: extra.trackBatch ?? false,
        trackSerial: extra.trackSerial ?? false,
        trackImei: extra.trackSerial ?? false,
        hasExpiry: extra.hasExpiry ?? false,
        reorderLevel: null,
        reorderQty: null,
        basePrice: null,
      });
      return created.id;
    };
    const perishable = await ensureItem("RI-PERISH", "RI perishable item", {
      trackBatch: true,
      hasExpiry: true,
    });
    const plain = await ensureItem("RI-PLAIN", "RI plain item", {});
    const device = await ensureItem("RI-DEVICE", "RI serial device", { trackSerial: true });

    const ensurePartner = async (kind: "CUSTOMER" | "SUPPLIER", code: string, name: string) => {
      const found = await partnersStore.findPartnerByCode(code);
      if (found !== undefined) return found.id;
      const created = await partnersStore.insertPartner({
        kind,
        code,
        name,
        nameAr: null,
        taxNumber: null,
        creditLimit: null,
        creditTermsId: null,
        priceListId: null,
      });
      return created.id;
    };
    const customerId = await ensurePartner("CUSTOMER", "RI-CUST-01", "شركة التقارير الصناعية");
    const supplierId = await ensurePartner("SUPPLIER", "RI-SUP-01", "مورد التقارير");

    // Three IMEI devices (BR-018 registry).
    const ensureSerial = async (serialNo: string, imei: string) => {
      const found = await (await import("../../modules/inventory/infrastructure/inventory.store")).findSerialByNo(
        device,
        serialNo,
      );
      if (found !== undefined) return found.id;
      const created = await tracking.registerSerial({
        itemId: device,
        serialNo,
        imei,
        actorId: R_ACTOR,
      });
      return created.id;
    };
    const s1 = await ensureSerial("RI-SN-001", "356938035643809");
    const s2 = await ensureSerial("RI-SN-002", "356938035643810");
    const s3 = await ensureSerial("RI-SN-003", "356938035643811");

    // The goods-in: ONE PO-less GRN — three expiry batches (uniform WAC 2),
    // the plain item (WAC 5), and the three devices (WAC 100).
    const inventoryStore = await import("../../modules/inventory/infrastructure/inventory.store");
    const oldBatch = await inventoryStore.findBatchByNo(perishable, "RI-B-OLD");
    let grnRef = "";
    if (oldBatch === undefined) {
      const grn = await goodsReceipts.create({
        branchId: mainBranch.id,
        supplierId,
        poId: null,
        warehouseId: warehouse.id,
        receiptDate: "2026-01-02",
        poLessReason: "industry-report fixture substrate",
        note: null,
        noteAr: null,
        actorId: R_ACTOR,
        lines: [
          { poLineId: null, itemId: perishable, qty: "6", unitCost: "2.000000", accountId: null, batchNo: "RI-B-OLD", batchExpiry: "2026-01-05", serialIds: null, note: null },
          { poLineId: null, itemId: perishable, qty: "10", unitCost: "2.000000", accountId: null, batchNo: "RI-B-MID", batchExpiry: "2026-01-15", serialIds: null, note: null },
          { poLineId: null, itemId: perishable, qty: "10", unitCost: "2.000000", accountId: null, batchNo: "RI-B-NEAR", batchExpiry: "2026-01-20", serialIds: null, note: null },
          { poLineId: null, itemId: plain, qty: "8", unitCost: "5.000000", accountId: null, batchNo: null, batchExpiry: null, serialIds: null, note: null },
          { poLineId: null, itemId: device, qty: "3", unitCost: "100.000000", accountId: null, batchNo: null, batchExpiry: null, serialIds: [s1, s2, s3], note: null },
        ],
      });
      const posted = await goodsReceipts.post(grn.id, R_ACTOR);
      grnRef = assertDefined(posted.receipt.receiptNo, "GRN number");
    } else {
      const receipts = await goodsReceipts.list({ limit: 10 });
      grnRef = assertDefined(receipts.find((r) => r.status === "POSTED")?.receiptNo, "GRN number");
    }

    // The write-offs: EXPIRED zeroes batch RI-B-OLD (6 @ WAC 2 = 12.0000 →
    // DR SHRINKAGE), DAMAGE removes 3 plain units (15.0000).
    if (oldBatch === undefined || (await inventoryStore.findBatchById(oldBatch.id))?.status !== "WRITTEN_OFF") {
      const batchRow =
        oldBatch ?? assertDefined(await inventoryStore.findBatchByNo(perishable, "RI-B-OLD"), "RI-B-OLD");
      await stock.manualIssue({
        itemId: perishable,
        warehouseId: warehouse.id,
        qty: "6",
        reason: "EXPIRED",
        counterAccountId: null,
        valueDate: "2026-01-06",
        batchId: batchRow.id,
        note: "Expiry write-off — RI-B-OLD",
        noteAr: "شطب منتهي الصلاحية — RI-B-OLD",
        actorId: R_ACTOR,
      });
      await inventoryStore.markBatchWrittenOff(batchRow.id);
      await stock.manualIssue({
        itemId: plain,
        warehouseId: warehouse.id,
        qty: "3",
        reason: "DAMAGE",
        counterAccountId: null,
        valueDate: "2026-01-07",
        actorId: R_ACTOR,
      });
    }

    // The device cycle: sell RI-SN-002 on a credit invoice (flow B), then
    // return it with a credit note — the IMEI register's sale/return links.
    // Guards key on the POSTED documents (the serial re-shelves as
    // in_stock after the return — BR-018 — so status alone can't tell the
    // cycle's stages apart on re-entry).
    const salesStore = await import("../../modules/sales/infrastructure/sales.store");
    let saleRef = "";
    const existingInvoice = (await salesStore.listSalesInvoices({ limit: 10 })).find(
      (i) => i.status === "POSTED",
    );
    if (existingInvoice === undefined) {
      const invoice = await salesInvoices.create({
        branchId: mainBranch.id,
        customerId,
        salesRepId: null,
        kind: "CREDIT",
        invoiceDate: "2026-01-12",
        dueDate: null,
        currencyCode: "SAR",
        exchangeRate: null,
        orderId: null,
        deliveryId: null,
        warehouseId: warehouse.id,
        cashAccountId: null,
        note: "IMEI register fixture sale",
        noteAr: null,
        actorId: R_ACTOR,
        lines: [
          {
            itemId: device,
            accountId: null,
            deliveryLineId: null,
            description: null,
            descriptionAr: null,
            qty: "1",
            unitPrice: "150.000000",
            discountAmount: null,
            taxCodeId: null,
            batchId: null,
            serialIds: [s2],
            note: null,
          },
        ],
      });
      await salesInvoices.approve(invoice.id, RI_APPROVER, false);
      const postedInvoice = await salesInvoices.post(invoice.id, R_ACTOR);
      saleRef = assertDefined(postedInvoice.invoiceNo, "invoice number");
    } else {
      saleRef = assertDefined(existingInvoice.invoiceNo, "invoice number");
    }

    let returnRef = "";
    const existingNote = (await salesStore.listCreditNotes({ limit: 10 })).find(
      (n) => n.status === "POSTED",
    );
    if (existingNote === undefined) {
      const invoiceRow = assertDefined(
        (await salesStore.listSalesInvoices({ limit: 10 })).find((i) => i.status === "POSTED"),
        "posted invoice",
      );
      const invoiceLines = await salesStore.listSalesInvoiceLines(invoiceRow.id);
      const deviceLine = assertDefined(invoiceLines.find((l) => l.itemId === device), "device invoice line");
      const note = await creditNotes.create({
        branchId: mainBranch.id,
        salesRepId: null,
        invoiceId: invoiceRow.id,
        noteDate: "2026-01-14",
        note: "IMEI register fixture return",
        noteAr: null,
        actorId: R_ACTOR,
        lines: [
          {
            invoiceLineId: deviceLine.id,
            qty: "1",
            unitPrice: null,
            discountAmount: null,
            taxCodeId: null,
            returnToStock: true,
            batchId: null,
            serialIds: [s2],
            description: null,
            descriptionAr: null,
            note: null,
          },
        ],
      });
      await creditNotes.approve(note.id, RI_APPROVER);
      const postedNote = await creditNotes.post(note.id, R_ACTOR);
      returnRef = assertDefined(postedNote.noteNo, "credit note number");
    } else {
      returnRef = assertDefined(existingNote.noteNo, "credit note number");
    }

    return {
      warehouseId: warehouse.id,
      perishableId: perishable,
      plainId: plain,
      deviceId: device,
      serialIds: { s1, s2, s3 },
      grnRef,
      saleRef,
      returnRef,
    };
  });

  fixture = built;
  return fixture;
}

function runReport(
  reportKey: string,
  params: Record<string, unknown>,
): Promise<{ runId: string; result?: ReportResult; status: string }> {
  return withTenant(TENANT_RI, () =>
    newRunService().run({ reportKey, params, ctx: fullContext(TENANT_RI) }),
  );
}

/** A run context that also carries the drill-target permissions (the
 * full-grants actor of the IMEI register's document hops). */
const DRILL_CONTEXT = fullContext(TENANT_RI, {
  permissions: new Set([
    ...ALL_KNOWN_PERMISSIONS,
    "purchasing.goods_receipts.view",
    "sales.invoices.view",
    "sales.credit_notes.view",
  ]),
});

beforeAll(async () => {
  await setupIndustryFixture();
});

describe("inventory.expiry_list (PHASE-015 T10; BR-017 FEFO)", () => {
  it("buckets the on-hand batches by days-to-expiry with value at risk and FEFO rank; INV-010 ties", async () => {
    const outcome = await runReport("inventory.expiry_list", { asOf: "2026-01-10", locale: "ar" });
    expect(outcome.status).toBe("SUCCEEDED");
    const result = outcome.result!;
    expect(result.reportId).toBe("inventory.expiry_list");

    // RI-B-OLD is written off (qty 0 → suppressed); the two live batches
    // carry 10 units each at WAC 2 → 20.0000 at risk per batch.
    expect(result.rows).toHaveLength(2);
    const mid = result.rows.find((row) => row.values.batchNo === "RI-B-MID")!;
    const near = result.rows.find((row) => row.values.batchNo === "RI-B-NEAR")!;
    expect(mid.values.daysToExpiry).toBe(5);
    expect(mid.values.bucket).toBe("0–7 يوم");
    expect(mid.values.qty).toBe("10.000000");
    expect(mid.values.value).toBe("20.0000");
    expect(mid.values.fefoRank).toBe(1);
    expect(near.values.daysToExpiry).toBe(10);
    expect(near.values.bucket).toBe("8–30 يوم");
    expect(near.values.value).toBe("20.0000");
    expect(near.values.fefoRank).toBe(2);

    const totals = new Map(result.totals.map((total) => [total.id, total.amount]));
    expect(totals.get("valueAtRisk")).toBe("40.0000");
    expect(result.assertions.find((a) => a.id === "inv010-stock-tie")?.status).toBe("PASS");
  });

  it("bucketDays reshapes the buckets (custom edges) and EN labels resolve", async () => {
    const outcome = await runReport("inventory.expiry_list", {
      asOf: "2026-01-10",
      locale: "en",
      bucketDays: [5, 40],
    });
    const result = outcome.result!;
    const mid = result.rows.find((row) => row.values.batchNo === "RI-B-MID")!;
    const near = result.rows.find((row) => row.values.batchNo === "RI-B-NEAR")!;
    expect(mid.values.bucket).toBe("0–5 days");
    expect(near.values.bucket).toBe("6–40 days");
  });
});

describe("grocery.expiry_writeoff (PHASE-015 T10; GL tie-out)", () => {
  it("registers the EXPIRED/DAMAGE write-offs with per-reason totals tying EXACTLY to the shrinkage GL", async () => {
    const outcome = await runReport("grocery.expiry_writeoff", {
      dateFrom: "2026-01-01",
      dateTo: "2026-01-31",
      locale: "en",
    });
    expect(outcome.status).toBe("SUCCEEDED");
    const result = outcome.result!;

    expect(result.rows).toHaveLength(2);
    const expired = result.rows.find((row) => row.values.reason === "EXPIRED")!;
    const damaged = result.rows.find((row) => row.values.reason === "DAMAGE")!;
    expect(expired.values.batchNo).toBe("RI-B-OLD");
    expect(expired.values.qty).toBe("6.000000");
    expect(expired.values.valueAmount).toBe("12.0000"); // 6 @ WAC 2
    expect(expired.values.movedAt).toBe("2026-01-06");
    expect(expired.values.sourceRef).toBeTruthy(); // the journal entry no
    expect(damaged.values.valueAmount).toBe("15.0000"); // 3 @ WAC 5
    expect(damaged.values.movedAt).toBe("2026-01-07");

    const totals = new Map(result.totals.map((total) => [total.id, total.amount]));
    expect(totals.get("expiredTotal")).toBe("12.0000");
    expect(totals.get("damagedTotal")).toBe("15.0000");
    expect(totals.get("writeoffTotal")).toBe("27.0000");

    // The mandatory GL tie-out: Σ register values == Σ INVENTORY_SHRINKAGE
    // debits of the same write-off postings in the window (exact, 0 tol).
    const tie = result.assertions.find((a) => a.id === "writeoff-gl-tie")!;
    expect(tie.status).toBe("PASS");
    expect(tie.compared).toEqual({ left: "27.0000", right: "27.0000" });
  });

  it("an empty window is honestly empty (zero rows, zero tie)", async () => {
    const outcome = await runReport("grocery.expiry_writeoff", {
      dateFrom: "2025-01-01",
      dateTo: "2025-01-31",
      locale: "en",
    });
    const result = outcome.result!;
    expect(result.rows).toHaveLength(0);
    const tie = result.assertions.find((a) => a.id === "writeoff-gl-tie")!;
    expect(tie.status).toBe("PASS");
    expect(tie.compared).toEqual({ left: "0.0000", right: "0.0000" });
  });
});

describe("retail.imei_register (PHASE-015 T10; BR-018 linkage)", () => {
  it("lists every device with its GRN, sale, and return linkage; the ledger consistency check passes", async () => {
    const fx = await setupIndustryFixture();
    const outcome = await withTenant(TENANT_RI, () =>
      newRunService().run({
        reportKey: "retail.imei_register",
        params: { dateFrom: "2026-01-01", dateTo: "2026-01-31", locale: "en" },
        ctx: DRILL_CONTEXT,
      }),
    );
    expect(outcome.status).toBe("SUCCEEDED");
    const result = outcome.result!;

    
    expect(result.rows).toHaveLength(3);
    const s1 = result.rows.find((row) => row.values.serialNo === "RI-SN-001")!;
    const s2 = result.rows.find((row) => row.values.serialNo === "RI-SN-002")!;
    const s3 = result.rows.find((row) => row.values.serialNo === "RI-SN-003")!;

    // In-stock devices: the GRN reference in, no sale.
    expect(s1.values.status).toBe("in_stock");
    expect(s1.values.imei).toBe("356938035643809");
    expect(s1.values.grnRef).toBe(fx.grnRef);
    expect(s1.values.receivedAt).toBe("2026-01-02");
    expect(s1.values.saleRef).toBeNull();
    expect(s1.values.returnRef).toBeNull();
    expect(s3.values.grnRef).toBe(fx.grnRef);
    expect(s3.values.saleRef).toBeNull();

    // The sold-and-returned device: GRN in, invoice out, credit note back
    // — re-shelved as in_stock (BR-018: the original sale stays in the
    // move ledger's history), with every reference resolvable.
    expect(s2.values.status).toBe("in_stock");
    expect(s2.values.grnRef).toBe(fx.grnRef);
    expect(s2.values.saleRef).toBe(fx.saleRef);
    expect(s2.values.soldAt).toBe("2026-01-12");
    expect(s2.values.returnRef).toBe(fx.returnRef);
    expect(s2.values.returnedAt).toBe("2026-01-14");
    // The sale drill link is generated only for targets the user can open
    // (§4) — the drill-context run carries the document permissions.
    expect(s2.drillLinks?.some((link) => link.route.includes("/sales/invoices/"))).toBe(true);
    expect(s2.drillLinks?.some((link) => link.route.includes("/sales/credit-notes/"))).toBe(true);
    expect(s1.drillLinks?.some((link) => link.route.includes("/purchasing/goods-receipts/"))).toBe(true);

    // Without the drill permissions the links are withheld (no 403 hops).
    const bare = await runReport("retail.imei_register", {
      dateFrom: "2026-01-01",
      dateTo: "2026-01-31",
      locale: "en",
    });
    const bareS2 = bare.result!.rows.find((row) => row.values.serialNo === "RI-SN-002")!;
    expect(bareS2.drillLinks ?? []).toHaveLength(0);

    const totals = new Map(result.totals.map((total) => [total.id, total.amount]));
    expect(totals.get("devices")).toBe("3");
    expect(result.assertions.find((a) => a.id === "imei-ledger-consistency")?.status).toBe("PASS");
  });

  it("the window filters on goods-in date and the item filter narrows to the item", async () => {
    const fx = await setupIndustryFixture();
    const outsideWindow = await runReport("retail.imei_register", {
      dateFrom: "2026-02-01",
      dateTo: "2026-02-28",
      locale: "en",
    });
    expect(outsideWindow.result!.rows).toHaveLength(0);

    const byItem = await runReport("retail.imei_register", {
      itemId: fx.deviceId,
      locale: "en",
    });
    expect(byItem.result!.rows).toHaveLength(3);
    expect(byItem.result!.rows.every((row) => row.values.itemSku === "RI-DEVICE")).toBe(true);
  });
});

describe("registry integration (the shared contract)", () => {
  it("the three industry keys are registered with the industry category", async () => {
    const snapshot = newRunService().contracts();
    for (const id of ["inventory.expiry_list", "grocery.expiry_writeoff", "retail.imei_register"]) {
      const contract = snapshot.find((c) => c.id === id);
      expect(contract, id).toBeDefined();
      expect(contract!.category).toBe("industry");
    }
  });

  it("exports flow through the shared contract (CSV renderer over the stored envelope)", async () => {
    const { renderCsv } = await import("../../modules/reporting/application/export/csv");
    const outcome = await runReport("grocery.expiry_writeoff", {
      dateFrom: "2026-01-01",
      dateTo: "2026-01-31",
      locale: "en",
    });
    const csv = renderCsv(outcome.result!).toString("utf8");
    expect(csv).toContain("EXPIRED");
    expect(csv).toContain("DAMAGE");
    expect(csv).toContain("27.0000");
    expect(csv).toContain("writeoff-gl-tie,PASS");
  });
});
