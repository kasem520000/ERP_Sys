import { beforeAll, describe, expect, it } from "vitest";

import {
  ensureTestDb,
  seedTenants,
  superuserClient,
} from "../test-db";
import { withTenant } from "../../infra/db/tenant-context";
import { AuditService } from "../../modules/audit/api/audit";
import { DrizzleAuditStore } from "../../modules/audit/infrastructure/drizzle-audit.store";
import { PostingService } from "../../modules/accounting/application/posting-service";
import { PeriodService } from "../../modules/accounting/application/period-service";
import { PartnerSubledgerService } from "../../modules/partners/application/subledger-service";
import { NumberingService } from "../../modules/accounting/application/numbering-service";
import { CoaService } from "../../modules/accounting/application/coa-service";
import { InboxService } from "../../modules/notifications/application/inbox-service";
import { ControlGuard } from "../../modules/budgeting/application/control-guard";
import { ConsumptionService } from "../../modules/budgeting/application/consumption-service";
import { BudgetVersionService } from "../../modules/budgeting/application/budget-version-service";
import { BudgetGridService } from "../../modules/budgeting/application/budget-grid-service";
import { ApprovalWorkflow } from "../../modules/budgeting/application/approval-workflow";
import { PaymentService } from "../../modules/treasury/application/payment-service";
import { AllocationService } from "../../modules/treasury/application/allocation-service";
import { SettlementCore } from "../../modules/treasury/application/fx-settlement";
import { PettyCashGuard } from "../../modules/treasury/application/petty-cash-service";
import { TaxResolverService } from "../../modules/tax/application/tax-resolver-service";
import { SupplierInvoiceService } from "../../modules/purchasing/application/supplier-invoices";
import { MatchingService } from "../../modules/purchasing/application/matching";
import { PurchaseOrderService } from "../../modules/purchasing/application/orders";
import { RfqService } from "../../modules/purchasing/application/rfq";
import { SupplierQuoteService } from "../../modules/purchasing/application/quotes";
import { AwardService } from "../../modules/purchasing/application/award";
import { BlanketService } from "../../modules/purchasing/application/blanket";
import { ScorecardService } from "../../modules/purchasing/application/scorecards";
import { CapexService } from "../../modules/purchasing/application/capex";
import { SupplierAdvancesService } from "../../modules/purchasing/application/advances";
import { TenderIntakeService } from "../../modules/purchasing/application/tenders";
import {
  listRfqLines,
  updateRfq,
  type RfqRow,
} from "../../modules/purchasing/infrastructure/sourcing.store";
import { REPORT_CONTRACTS } from "../../modules/reporting/registry";

/**
 * PHASE-038 · the sourcing & supplier-collaboration DB suite (acceptance
 * 2–9): real PostgreSQL 16 through the app-role services exactly as the
 * production paths run — every journal flows through PostingEngine.post,
 * every number through the numbering service, nothing inserts GL rows
 * directly.
 *
 * Dedicated tenant S (SAR base, SA) — the suite owns it end to end
 * (the ZATCA tenant-Z pattern). A second tenant (S-FOREIGN) carries a
 * live RFQ + portal invite so the spoof battery distinguishes RLS
 * rejection from token rejection.
 *
 * File-level ordering (sequential, single fork):
 *   substrate → RFQ lifecycle (issue → quotes → comparison → the 3-bid
 *   floor both modes → award → BR-063 close) → portal happy path + the
 *   spoof battery → blanket commitments (release/over-release/expiry) →
 *   G-33 (SoD, unmapped failure pack, disbursement + application) →
 *   G-34 (terms SoD, window, capture, replay) → scorecards + the
 *   approved-vendor gate (FLAG + BLOCK) → CAPEX (SoD + the 028 guard
 *   OFF/ENFORCED) → tender intake → the P-06 contract linkage → the
 *   P-11 matching bands (tenant P's fixture chain) → the two report
 *   contracts render over the seeded data.
 */

const S_TENANT = "77777777-3803-7003-8000-000000000038";
const S_FOREIGN = "77777777-3803-7003-8000-000000000039";
const S_ACTOR = "77777777-3803-7003-8000-0000000000a1";
const S_BUYER = "77777777-3803-7003-8000-0000000000a2";
const S_APPROVER = "77777777-3803-7003-8000-0000000000a3";

const audit = new AuditService(new DrizzleAuditStore());
const inbox = new InboxService();
const posting = new PostingService(audit, new PartnerSubledgerService());
const numbering = new NumberingService(audit);
const resolver = new TaxResolverService();
const matching = new MatchingService();
const orderService = new PurchaseOrderService(audit, numbering);

const rfqService = new RfqService(audit, numbering);
const quoteService = new SupplierQuoteService(audit);
const blanketService = new BlanketService(audit, numbering, orderService);
const awardService = new AwardService(audit, inbox, orderService, blanketService);
const scorecardService = new ScorecardService(audit);
const capexService = new CapexService(audit, new ControlGuard(audit, inbox), numbering);
const advancesService = new SupplierAdvancesService(audit, posting, numbering);
const tenderService = new TenderIntakeService(audit, numbering);
const supplierInvoices = new SupplierInvoiceService(audit, posting, numbering, resolver, matching);
const payments = new PaymentService(audit, new SettlementCore(audit, posting, numbering), new PettyCashGuard(audit));
const allocations = new AllocationService(audit);

interface SFix {
  branchId: string;
  warehouseId: string;
  suppliers: { a: string; b: string; c: string };
  items: { one: string; two: string };
  cashAccountId: string;
  advanceControlAccount: string;
  discountIncomeAccount: string;
  expenseAccountId: string;
  fiscalYearId: string;
  periodId: string;
  contractId: string;
  foreign: { rfqId: string; supplierId: string };
}

let fix: SFix;

async function setTenantSetting(tenantId: string, key: string, value: unknown): Promise<void> {
  const su = await superuserClient();
  await su.query(
    `INSERT INTO tenant_settings (id, tenant_id, key, value) VALUES (gen_random_uuid(), $1, $2, $3::jsonb)
     ON CONFLICT (tenant_id, key) DO UPDATE SET value = EXCLUDED.value`,
    [tenantId, key, JSON.stringify(value)],
  );
  await su.end();
}

async function clearTenantSetting(tenantId: string, key: string): Promise<void> {
  const su = await superuserClient();
  await su.query(`DELETE FROM tenant_settings WHERE tenant_id = $1 AND key = $2`, [tenantId, key]);
  await su.end();
}

beforeAll(async () => {
  ensureTestDb();
  const su = await superuserClient();
  await seedTenants(su as never);
  await su.query(
    `INSERT INTO tenants (id, name, name_ar, base_currency, country_code, timezone) VALUES
       ($1, 'Sourcing Spec Buyer', 'مشترٍ مواصفات التوريد', 'SAR', 'SA', 'Asia/Riyadh'),
       ($2, 'Sourcing Foreign', 'المستأجر الأجنبي للتوريد', 'SAR', 'SA', 'Asia/Riyadh')
     ON CONFLICT (id) DO NOTHING`,
    [S_TENANT, S_FOREIGN],
  );
  await su.query(
    `INSERT INTO users (id, email, full_name, password_hash, status) VALUES
       ($1, 'sourcing-actor@fixture.test', 'Sourcing Actor', 'x', 'ACTIVE'),
       ($2, 'sourcing-buyer@fixture.test', 'Sourcing Buyer', 'x', 'ACTIVE'),
       ($3, 'sourcing-approver@fixture.test', 'Sourcing Approver', 'x', 'ACTIVE')
     ON CONFLICT (id) DO NOTHING`,
    [S_ACTOR, S_BUYER, S_APPROVER],
  );
  await su.end();

  await withTenant(S_FOREIGN, async () => {
    const fTenancy = await import("../../modules/tenancy/infrastructure/tenancy.store");
    const fPartners = await import("../../modules/partners/infrastructure/partners.store");
    const fItems = await import("../../modules/items/infrastructure/items.store");
    await fTenancy.seedMasterDataBasics();
    await fTenancy.provisionCoaTemplate();
    const fBranch =
      (await fTenancy.listBranches(null)).find((b) => b.code === "MAIN") ??
      (await fTenancy.insertBranch({
        code: "MAIN",
        name: "Main branch",
        nameAr: "الفرع الرئيسي",
        address: null,
      }));
    const fSupplier = await fPartners.insertPartner({
      kind: "SUPPLIER",
      code: "S2-SUP-01",
      name: "Foreign Supplier",
      nameAr: null,
      taxNumber: null,
      creditLimit: null,
      creditTermsId: null,
      priceListId: null,
    });
    const uoms = await fItems.listUoms();
    const pcs = uoms.find((u) => u.code === "PCS") ?? uoms[0]!;
    const fItem = await fItems.insertItem({
      sku: "S2-ITEM-01",
      name: "Foreign item",
      nameAr: null,
      kind: "STOCK",
      uomId: pcs.id,
      categoryId: null,
      taxCodeId: null,
      costingMethod: "WAC",
      trackBatch: false,
      trackSerial: false,
      trackImei: false,
      hasExpiry: false,
      reorderLevel: null,
      reorderQty: null,
      basePrice: null,
    });
    const fRfq = await rfqService.create({
      branchId: fBranch.id,
      title: "Foreign round",
      titleAr: null,
      mode: "INVITED",
      currencyCode: "SAR",
      dueAt: "2030-01-01T00:00:00.000Z",
      invitedSuppliers: [fSupplier.id],
      lines: [{ itemId: fItem.id, qty: "1", targetPrice: null, note: null }],
      note: null,
      noteAr: null,
      actorId: S_ACTOR,
    });
    await rfqService.issue(fRfq.id, S_ACTOR);
    foreignFix = { rfqId: fRfq.id, supplierId: fSupplier.id };
  });

  await withTenant(S_TENANT, async () => {
    const tenancyStore = await import("../../modules/tenancy/infrastructure/tenancy.store");
    const accountingStore = await import("../../modules/accounting/infrastructure/accounting.store");
    const partnersStore = await import("../../modules/partners/infrastructure/partners.store");
    const itemsStore = await import("../../modules/items/infrastructure/items.store");
    const treasuryStore = await import("../../modules/treasury/infrastructure/treasury.store");
    const crmStore = await import("../../modules/crm/infrastructure/crm.store");
    await tenancyStore.seedMasterDataBasics();
    await tenancyStore.provisionCoaTemplate();

    const coa = new CoaService(audit);
    const byCode = async (code: string) => {
      const account = await accountingStore.findAccountByCode(code);
      if (account === undefined) throw new Error(`fixture account ${code} missing`);
      return account;
    };
    // The G-33 control + G-34 income accounts (dedicated postable rows).
    // Root-level postable accounts (no parent — the template's mid-tree
    // nodes vary by provision order; the root avoids the V3 homogeneous
    // tree's parent-type coupling entirely).
    let advance = await accountingStore.findAccountByCode("1157");
    if (advance === undefined) {
      advance = await coa.create(S_ACTOR, {
        code: "1157",
        name: "Advances to suppliers",
        nameAr: "دفعات مقدمة للموردين",
        type: "ASSET",
        parentId: null,
        currencyCode: null,
        isGroup: false,
      });
    }
    let discountIncome = await accountingStore.findAccountByCode("4180");
    if (discountIncome === undefined) {
      discountIncome = await coa.create(S_ACTOR, {
        code: "4180",
        name: "Early-payment discount income",
        nameAr: "إيراد خصم الدفع المبكر",
        type: "REVENUE",
        parentId: null,
        currencyCode: null,
        isGroup: false,
      });
    }

    // The posting purposes the suite's flows need (the P-fixture map):
    // AP_CONTROL (G-08/G-33 apply), INVENTORY + GRNI (the G-07 band chain).
    const mapPurpose = async (purposeKey: string, code: string) => {
      const existing = await accountingStore.findActivePurpose(purposeKey);
      if (existing !== undefined) return existing.accountId;
      const account = await byCode(code);
      const { insertAccountPurpose } = tenancyStore;
      await insertAccountPurpose({ purposeKey, accountId: account.id, activeFrom: "2025-12-01" });
      return account.id;
    };
    await mapPurpose("AP_CONTROL", "2110");
    await mapPurpose("INVENTORY", "1140");
    await mapPurpose("GRNI", "2130");

    const periods = new PeriodService(audit);
    const year = await accountingStore.findFiscalYearByName("FY2026");
    const fiscalYearId =
      year?.id ??
      (
        await periods.createYear(S_ACTOR, {
          name: "FY2026",
          startDate: "2026-01-01",
          endDate: "2026-12-31",
        })
      ).id;
    const yearPeriods = await (
      await import("../../modules/budgeting/infrastructure/budgeting.store")
    ).listPeriodsOfYear(fiscalYearId);

    const branch =
      (await tenancyStore.listBranches(null)).find((b) => b.code === "MAIN") ??
      (await tenancyStore.insertBranch({
        code: "MAIN",
        name: "Main branch",
        nameAr: "الفرع الرئيسي",
        address: null,
      }));

    const mkSupplier = async (code: string, name: string) => {
      const existing = await partnersStore.findPartnerByCode(code);
      if (existing !== undefined) return existing.id;
      return (
        await partnersStore.insertPartner({
          kind: "SUPPLIER",
          code,
          name,
          nameAr: null,
          taxNumber: null,
          creditLimit: null,
          creditTermsId: null,
          priceListId: null,
        })
      ).id;
    };
    const uoms = await itemsStore.listUoms();
    const pcs = uoms.find((u) => u.code === "PCS") ?? uoms[0]!;
    const mkItem = async (sku: string) => {
      const existing = await itemsStore.findItemBySku(sku);
      if (existing !== undefined) return existing.id;
      return (
        await itemsStore.insertItem({
          sku,
          name: `Sourcing ${sku}`,
          nameAr: null,
          kind: "STOCK",
          uomId: pcs.id,
          categoryId: null,
          taxCodeId: null,
          costingMethod: "WAC",
          trackBatch: false,
          trackSerial: false,
          trackImei: false,
          hasExpiry: false,
          reorderLevel: null,
          reorderQty: null,
          basePrice: null,
        })
      ).id;
    };

    const cash = await treasuryStore.insertCashAccount({
      name: "Main till",
      nameAr: "الخزنة الرئيسية",
      type: "CASH",
      accountId: (await byCode("1111")).id,
      currencyCode: "SAR",
      branchId: null,
      createdBy: S_ACTOR,
    });

    // The P-06 live contract (DRAFT → ACTIVE patch — the store-level
    // lifecycle the CRM service wraps).
    const contractSupplier = await mkSupplier("S-SUP-C", "Contract Supplier");
    const contract = await crmStore.insertContract({
      partnerId: contractSupplier,
      projectId: null,
      title: "Framework contract",
      titleAr: null,
      scope: null,
      feeModel: "RETAINER",
      startDate: "2026-01-01",
      endDate: "2026-12-31",
      monthlyAmount: "1000.0000",
      currencyCode: "SAR",
      note: null,
      noteAr: null,
      actorId: S_ACTOR,
    });
    await crmStore.patchContract({ id: contract.id, status: "ACTIVE", contractNo: "CT-S-001" });

    const warehouseService = new (await import("../../modules/inventory/application/warehouse-service")).WarehouseService(audit);
    const existingWarehouses = await warehouseService.list({ limit: 10, activeOnly: false });
    const warehouse =
      existingWarehouses.find((w) => w.code === "S-WH") ??
      (await warehouseService.create({
        branchId: branch.id,
        code: "S-WH",
        name: "Sourcing warehouse",
        nameAr: "مستودع التوريد",
        inventoryAccountId: null,
        note: null,
        actorId: S_ACTOR,
      }));

    fix = {
      branchId: branch.id,
      warehouseId: warehouse.id,
      suppliers: {
        a: await mkSupplier("S-SUP-A", "Sourcing Supplier A"),
        b: await mkSupplier("S-SUP-B", "Sourcing Supplier B"),
        c: contractSupplier,
      },
      items: {
        one: await mkItem("S-ITEM-01"),
        two: await mkItem("S-ITEM-02"),
      },
      cashAccountId: cash.id,
      advanceControlAccount: advance.id,
      discountIncomeAccount: discountIncome.id,
      expenseAccountId: (await byCode("5210")).id,
      fiscalYearId,
      periodId: yearPeriods[2]!.id, // March — the CAPEX neededBy period
      contractId: contract.id,
      foreign: foreignFix!,
    };
  });
});

let foreignFix: { rfqId: string; supplierId: string } | undefined;

// -- helpers ---------------------------------------------------------------------------

async function issueRfqWithQuotes(input: {
  invited: string[];
  lines?: { itemId: string; qty: string; targetPrice: string | null; note: string | null }[];
}): Promise<RfqRow> {
  const rfq = await withTenant(S_TENANT, () =>
    rfqService.create({
      branchId: fix.branchId,
      title: "Sourcing round",
      titleAr: null,
      mode: "INVITED",
      currencyCode: "SAR",
      dueAt: "2030-01-01T00:00:00.000Z",
      invitedSuppliers: input.invited,
      lines: input.lines ?? [
        { itemId: fix.items.one, qty: "10", targetPrice: "10.0000", note: null },
      ],
      note: null,
      noteAr: null,
      actorId: S_ACTOR,
    }),
  );
  return withTenant(S_TENANT, () => rfqService.issue(rfq.id, S_ACTOR));
}

async function quotePrice(rfq: RfqRow, supplierId: string, unitPrice: string): Promise<string> {
  const lines = await withTenant(S_TENANT, () => listRfqLines(rfq.id));
  const submitted = await withTenant(S_TENANT, () =>
    quoteService.submit({
      rfqId: rfq.id,
      supplierId,
      quoteRef: null,
      submittedVia: "BACK_OFFICE",
      currencyCode: "SAR",
      leadTimeDays: 5,
      validUntil: "2030-01-01",
      paymentTerms: null,
      submittedBy: S_BUYER,
      portalContact: null,
      note: null,
      lines: lines.map((l) => ({
        rfqLineId: l.id,
        qty: l.qty,
        unitPrice,
        leadTimeDays: null,
        note: null,
      })),
    }),
  );
  return submitted.id;
}

function portalSubmitBody(rfqId: string, token: string, unitPrice: string) {
  return withTenant(S_TENANT, async () => {
    const lines = await listRfqLines(rfqId);
    return quoteService.portalSubmit({
      rfqId,
      token,
      quoteRef: null,
      currencyCode: "SAR",
      leadTimeDays: null,
      validUntil: null,
      paymentTerms: null,
      portalContact: null,
      note: null,
      lines: lines.map((l) => ({
        rfqLineId: l.id,
        qty: l.qty,
        unitPrice,
        leadTimeDays: null,
        note: null,
      })),
    });
  });
}

// -- 2. the RFQ lifecycle ----------------------------------------------------------------

describe("PHASE-038 acceptance 2 — the RFQ lifecycle end-to-end", () => {
  it("walks DRAFT → ISSUED (invited mode) with the official number reserving at issue", async () => {
    const rfq = await issueRfqWithQuotes({ invited: [fix.suppliers.a, fix.suppliers.b] });
    expect(rfq.status).toBe("ISSUED");
    expect(rfq.rfqNo).toMatch(/^RFQ-\d{4}-\d{6}$/);
    expect(rfq.issuedAt).not.toBeNull();
  });

  it("rejects a quote from a non-invited supplier (typed, zero residue)", async () => {
    const rfq = await issueRfqWithQuotes({ invited: [fix.suppliers.a] });
    const lines = await withTenant(S_TENANT, () => listRfqLines(rfq.id));
    await expect(
      withTenant(S_TENANT, () =>
        quoteService.submit({
          rfqId: rfq.id,
          supplierId: fix.suppliers.b, // NOT on the invited list
          quoteRef: null,
          submittedVia: "BACK_OFFICE",
          currencyCode: "SAR",
          leadTimeDays: null,
          validUntil: null,
          paymentTerms: null,
          submittedBy: S_BUYER,
          portalContact: null,
          note: null,
          lines: lines.map((l) => ({ rfqLineId: l.id, qty: l.qty, unitPrice: "1.000000", leadTimeDays: null, note: null })),
        }),
      ),
    ).rejects.toMatchObject({ code: "SUPPLIER_NOT_INVITED" });
    const quotes = await withTenant(S_TENANT, () => quoteService.listForRfq(rfq.id));
    expect(quotes).toHaveLength(0);
  });

  it("flips the round QUOTED on the first quote and rejects lifecycle misuse", async () => {
    const rfq = await issueRfqWithQuotes({ invited: [fix.suppliers.a, fix.suppliers.b] });
    await quotePrice(rfq, fix.suppliers.a, "10.000000");
    const after = await withTenant(S_TENANT, () => rfqService.find(rfq.id));
    expect(after.status).toBe("QUOTED");
    // A second issue hop is typed (the state machine owns the transitions).
    await expect(withTenant(S_TENANT, () => rfqService.issue(rfq.id, S_ACTOR))).rejects.toMatchObject({
      code: "RFQ_STATE",
    });
    // A DRAFT-only edit on a QUOTED round is typed.
    await expect(
      withTenant(S_TENANT, () => rfqService.update(rfq.id, { title: "renamed", actorId: S_ACTOR })),
    ).rejects.toMatchObject({ code: "RFQ_STATE" });
  });
});

// -- 3. the 3-bid floor (BR-062) + 4. the award --------------------------------------------

describe("PHASE-038 acceptance 3+4 — the 3-bid floor and the award", () => {
  it("rejects the award typed in ENFORCED mode below the floor", async () => {
    const rfq = await issueRfqWithQuotes({ invited: [fix.suppliers.a, fix.suppliers.b] });
    await quotePrice(rfq, fix.suppliers.a, "10.000000");
    await quotePrice(rfq, fix.suppliers.b, "12.000000");
    await setTenantSetting(S_TENANT, "purchasing.rfq.min_quote_count", 3);
    await setTenantSetting(S_TENANT, "purchasing.rfq.three_bid_mode", "ENFORCED");
    try {
      const comparison = await withTenant(S_TENANT, () =>
        awardService.prepare({ rfqId: rfq.id, actorId: S_BUYER }),
      );
      const lines = (comparison.snapshot as unknown as {
        lines: { rfqLineId: string; offers: { quoteId: string; supplierId: string; unitPrice: string }[] }[];
      }).lines;
      await expect(
        withTenant(S_TENANT, () =>
          awardService.award({
            comparisonId: comparison.id,
            decisions: [
              {
                rfqLineId: lines[0]!.rfqLineId,
                quoteId: lines[0]!.offers[0]!.quoteId,
                supplierId: lines[0]!.offers[0]!.supplierId,
                qty: "10",
                unitPrice: lines[0]!.offers[0]!.unitPrice,
              },
            ],
            blanketOrderId: null,
            note: null,
            noteAr: null,
            actorId: S_BUYER,
          }),
        ),
      ).rejects.toMatchObject({ code: "THREE_BID_RULE_VIOLATED" });
      // Zero residue: the round stays QUOTED and the comparison PREPARED.
      expect((await withTenant(S_TENANT, () => rfqService.find(rfq.id))).status).toBe("QUOTED");
      expect((await withTenant(S_TENANT, () => awardService.find(comparison.id))).status).toBe("PREPARED");
    } finally {
      await clearTenantSetting(S_TENANT, "purchasing.rfq.min_quote_count");
      await clearTenantSetting(S_TENANT, "purchasing.rfq.three_bid_mode");
    }
  });

  it("warns once in ADVISORY mode and the award proceeds with the generated PO", async () => {
    const rfq = await issueRfqWithQuotes({
      invited: [fix.suppliers.a, fix.suppliers.b],
      lines: [
        { itemId: fix.items.one, qty: "10", targetPrice: null, note: null },
        { itemId: fix.items.two, qty: "4", targetPrice: null, note: null },
      ],
    });
    await quotePrice(rfq, fix.suppliers.a, "10.000000");
    await quotePrice(rfq, fix.suppliers.b, "12.000000");
    await setTenantSetting(S_TENANT, "purchasing.rfq.min_quote_count", 3);
    await setTenantSetting(S_TENANT, "purchasing.rfq.three_bid_mode", "ADVISORY");
    try {
      const comparison = await withTenant(S_TENANT, () =>
        awardService.prepare({ rfqId: rfq.id, actorId: S_BUYER }),
      );
      const snapshot = comparison.snapshot as unknown as {
        lines: {
          rfqLineId: string;
          offers: { quoteId: string; supplierId: string; unitPrice: string; weightedScore: string }[];
        }[];
        summary: { quotesReceived: number; suppliers: number };
      };
      expect(snapshot.summary.quotesReceived).toBe(2);
      // The frozen matrix: the lowest offer anchors 100 on every leg.
      expect(snapshot.lines[0]!.offers[0]!.weightedScore).toBe("100.00");
      // A mutated decision (price != the frozen offer) is typed — the
      // matrix is the evidence, renegotiation opens a new round.
      await expect(
        withTenant(S_TENANT, () =>
          awardService.award({
            comparisonId: comparison.id,
            decisions: [
              {
                rfqLineId: snapshot.lines[0]!.rfqLineId,
                quoteId: snapshot.lines[0]!.offers[0]!.quoteId,
                supplierId: snapshot.lines[0]!.offers[0]!.supplierId,
                qty: "10",
                unitPrice: "1.000000",
              },
            ],
            blanketOrderId: null,
            note: null,
            noteAr: null,
            actorId: S_BUYER,
          }),
        ),
      ).rejects.toMatchObject({ code: "AWARD_DECISION_INVALID" });

      const awarded = await withTenant(S_TENANT, () =>
        awardService.award({
          comparisonId: comparison.id,
          decisions: [
            {
              rfqLineId: snapshot.lines[0]!.rfqLineId,
              quoteId: snapshot.lines[0]!.offers[0]!.quoteId,
              supplierId: snapshot.lines[0]!.offers[0]!.supplierId,
              qty: "10",
              unitPrice: snapshot.lines[0]!.offers[0]!.unitPrice,
            },
            {
              rfqLineId: snapshot.lines[1]!.rfqLineId,
              quoteId: snapshot.lines[0]!.offers[0]!.quoteId,
              supplierId: snapshot.lines[0]!.offers[0]!.supplierId,
              qty: "4",
              unitPrice: snapshot.lines[0]!.offers[0]!.unitPrice,
            },
          ],
          blanketOrderId: null,
          note: "line-level award",
          noteAr: null,
          actorId: S_BUYER,
        }),
      );
      // BR-063: awarding closes the round (AWARDED) + the comparison.
      expect((await withTenant(S_TENANT, () => rfqService.find(rfq.id))).status).toBe("AWARDED");
      expect(awarded.status).toBe("AWARDED");
      expect(awarded.generatedDocs).toHaveLength(1);
      const po = awarded.generatedDocs![0]!;
      expect(po.kind).toBe("PURCHASE_ORDER");
      // The generated PO carries the awarded lines with the note trace.
      const created = await withTenant(S_TENANT, () => orderService.findWithLines(po.id));
      expect(created.lines).toHaveLength(2);
      expect(created.lines[0]!.note).toContain("award");
      expect(created.lines[0]!.unitPrice).toBe("10.000000");

      // Double-award (BR-063) and post-award quotes are typed.
      await expect(
        withTenant(S_TENANT, () =>
          awardService.award({
            comparisonId: comparison.id,
            decisions: [
              {
                rfqLineId: snapshot.lines[0]!.rfqLineId,
                quoteId: snapshot.lines[0]!.offers[0]!.quoteId,
                supplierId: snapshot.lines[0]!.offers[0]!.supplierId,
                qty: "10",
                unitPrice: snapshot.lines[0]!.offers[0]!.unitPrice,
              },
            ],
            blanketOrderId: null,
            note: null,
            noteAr: null,
            actorId: S_BUYER,
          }),
        ),
      ).rejects.toMatchObject({ code: "COMPARISON_STATE" });
      await expect(
        withTenant(S_TENANT, () =>
          quoteService.submit({
            rfqId: rfq.id,
            supplierId: fix.suppliers.b,
            quoteRef: null,
            submittedVia: "BACK_OFFICE",
            currencyCode: "SAR",
            leadTimeDays: null,
            validUntil: null,
            paymentTerms: null,
            submittedBy: S_BUYER,
            portalContact: null,
            note: null,
            lines: [{ rfqLineId: snapshot.lines[0]!.rfqLineId, qty: "1", unitPrice: "1.000000", leadTimeDays: null, note: null }],
          }),
        ),
      ).rejects.toMatchObject({ code: "PORTAL_SUBMISSION_INVALID" });

      // The close hop: AWARDED → CLOSED.
      const closed = await withTenant(S_TENANT, () => rfqService.close(rfq.id, S_ACTOR));
      expect(closed.status).toBe("CLOSED");
      expect(closed.closedAt).not.toBeNull();
    } finally {
      await clearTenantSetting(S_TENANT, "purchasing.rfq.min_quote_count");
      await clearTenantSetting(S_TENANT, "purchasing.rfq.three_bid_mode");
    }
  });
});

// -- 8. the portal skeleton (P-05): happy path + the spoof battery ---------

describe("PHASE-038 acceptance 8 — the portal skeleton and the spoof battery", () => {
  it("mints a scoped token and the invited supplier submits through it (re-submit replaces)", async () => {
    const rfq = await issueRfqWithQuotes({ invited: [fix.suppliers.a, fix.suppliers.b] });
    const invite = await withTenant(S_TENANT, () =>
      quoteService.mintPortalInvite({
        rfqId: rfq.id,
        supplierId: fix.suppliers.a,
        expiresAt: "2030-01-01T00:00:00.000Z",
        actorId: S_ACTOR,
      }),
    );
    const submitted = await portalSubmitBody(rfq.id, invite.token, "9.500000");
    expect(submitted.supplierId).toBe(fix.suppliers.a);
    expect(submitted.submittedVia).toBe("PORTAL");
    expect(submitted.lines[0]!.unitPrice).toBe("9.5000");
    // Re-submission REPLACES the lines (one quote per supplier per RFQ).
    const again = await portalSubmitBody(rfq.id, invite.token, "9.000000");
    expect(again.id).toBe(submitted.id);
    expect(again.lines[0]!.unitPrice).toBe("9.0000");
  });

  it("the spoof battery fails typed: wrong RFQ, foreign token, revoked, expired, past-due", async () => {
    const rfq = await issueRfqWithQuotes({ invited: [fix.suppliers.a, fix.suppliers.b] });
    const invite = await withTenant(S_TENANT, () =>
      quoteService.mintPortalInvite({
        rfqId: rfq.id,
        supplierId: fix.suppliers.a,
        expiresAt: "2030-01-01T00:00:00.000Z",
        actorId: S_ACTOR,
      }),
    );
    // (a) the token on ANOTHER rfq of the same tenant → shape-uniform invalid.
    const other = await issueRfqWithQuotes({ invited: [fix.suppliers.a] });
    await expect(portalSubmitBody(other.id, invite.token, "1.000000")).rejects.toMatchObject({
      code: "PORTAL_TOKEN_INVALID",
    });
    // (b) a FOREIGN tenant's token on this tenant's rfq → invalid.
    const foreignInvite = await withTenant(S_FOREIGN, () =>
      quoteService.mintPortalInvite({
        rfqId: fix.foreign.rfqId,
        supplierId: fix.foreign.supplierId,
        expiresAt: "2030-01-01T00:00:00.000Z",
        actorId: S_ACTOR,
      }),
    );
    await expect(portalSubmitBody(rfq.id, foreignInvite.token, "1.000000")).rejects.toMatchObject({
      code: "PORTAL_TOKEN_INVALID",
    });
    // (c) a revoked token → invalid.
    await withTenant(S_TENANT, () =>
      quoteService.revokePortalInvite({ rfqId: rfq.id, supplierId: fix.suppliers.a, actorId: S_ACTOR }),
    );
    await expect(portalSubmitBody(rfq.id, invite.token, "1.000000")).rejects.toMatchObject({
      code: "PORTAL_TOKEN_INVALID",
    });
    // (d) an expired token → invalid.
    const expired = await withTenant(S_TENANT, () =>
      quoteService.mintPortalInvite({
        rfqId: rfq.id,
        supplierId: fix.suppliers.a,
        expiresAt: "2020-01-01T00:00:00.000Z",
        actorId: S_ACTOR,
      }),
    );
    await expect(portalSubmitBody(rfq.id, expired.token, "1.000000")).rejects.toMatchObject({
      code: "PORTAL_TOKEN_INVALID",
    });
    // (e) the supplier identity follows the TOKEN (supplier B's token
    // submits AS supplier B — the body can never claim another supplier).
    const fresh = await withTenant(S_TENANT, () =>
      quoteService.mintPortalInvite({
        rfqId: rfq.id,
        supplierId: fix.suppliers.b,
        expiresAt: "2030-01-01T00:00:00.000Z",
        actorId: S_ACTOR,
      }),
    );
    const asB = await portalSubmitBody(rfq.id, fresh.token, "8.000000");
    expect(asB.supplierId).toBe(fix.suppliers.b);
    // (f) a past-due round rejects submissions (the due-date guard).
    const pastDue = await issueRfqWithQuotes({ invited: [fix.suppliers.a] });
    const pastInvite = await withTenant(S_TENANT, () =>
      quoteService.mintPortalInvite({
        rfqId: pastDue.id,
        supplierId: fix.suppliers.a,
        expiresAt: "2030-01-01T00:00:00.000Z",
        actorId: S_ACTOR,
      }),
    );
    await withTenant(S_TENANT, () => updateRfq(pastDue.id, { dueAt: "2020-01-01T00:00:00.000Z" }));
    await expect(portalSubmitBody(pastDue.id, pastInvite.token, "1.000000")).rejects.toMatchObject({
      code: "PORTAL_SUBMISSION_INVALID",
    });
  });
});

// -- 5. blanket commitments ----------------------------------------------------------

describe("PHASE-038 acceptance 5 — blanket commitments", () => {
  it("releases decrement the remaining balance and generate the executable PO", async () => {
    const blanket = await withTenant(S_TENANT, () =>
      blanketService.create({
        branchId: fix.branchId,
        supplierId: fix.suppliers.c,
        contractId: null,
        title: "Standing stationery",
        titleAr: null,
        currencyCode: "SAR",
        validFrom: "2026-01-01",
        validTo: "2030-12-31",
        minCommitment: "100.0000",
        maxCommitment: "1000.0000",
        priceLock: [{ itemId: fix.items.one, unitPrice: "10.0000" }],
        note: null,
        noteAr: null,
        actorId: S_ACTOR,
      }),
    );
    expect(blanket.blanketNo).toMatch(/^BLK-\d{4}-\d{6}$/);
    const after = await withTenant(S_TENANT, () =>
      blanketService.release({
        blanketId: blanket.id,
        lines: [{ itemId: fix.items.one, qty: "40", unitPrice: null }],
        releaseDate: "2026-02-10",
        note: "first draw",
        actorId: S_ACTOR,
      }),
    );
    expect(after.releasedAmount).toBe("400.0000");
    expect(after.releases).toHaveLength(1);
    expect(after.releases[0]!.releaseNo).toMatch(/^BLR-\d{4}-\d{6}$/);
    // The generated PO carries the release lines at the locked price.
    const po = await withTenant(S_TENANT, () =>
      orderService.findWithLines(after.releases[0]!.purchaseOrderId),
    );
    expect(po.lines[0]!.unitPrice).toBe("10.000000");
    expect(po.lines[0]!.note).toContain("Blanket release");
    // Over-release beyond max is typed with zero residue.
    await expect(
      withTenant(S_TENANT, () =>
        blanketService.release({
          blanketId: blanket.id,
          lines: [{ itemId: fix.items.one, qty: "70", unitPrice: null }],
          releaseDate: "2026-02-11",
          note: null,
          actorId: S_ACTOR,
        }),
      ),
    ).rejects.toMatchObject({ code: "BLANKET_OVER_RELEASE" });
    const untouched = await withTenant(S_TENANT, () => blanketService.find(blanket.id));
    expect(untouched.releasedAmount).toBe("400.0000");
  });

  it("expiry blocks new releases and an unpriced un-locked line is typed", async () => {
    const expired = await withTenant(S_TENANT, () =>
      blanketService.create({
        branchId: fix.branchId,
        supplierId: fix.suppliers.c,
        contractId: null,
        title: "Expired agreement",
        titleAr: null,
        currencyCode: "SAR",
        validFrom: "2025-01-01",
        validTo: "2025-12-31",
        minCommitment: "0.0000",
        maxCommitment: "500.0000",
        priceLock: [{ itemId: fix.items.one, unitPrice: "10.0000" }],
        note: null,
        noteAr: null,
        actorId: S_ACTOR,
      }),
    );
    await expect(
      withTenant(S_TENANT, () =>
        blanketService.release({
          blanketId: expired.id,
          lines: [{ itemId: fix.items.one, qty: "1", unitPrice: null }],
          releaseDate: "2026-02-10",
          note: null,
          actorId: S_ACTOR,
        }),
      ),
    ).rejects.toMatchObject({ code: "BLANKET_EXPIRED" });
    const live = await withTenant(S_TENANT, () =>
      blanketService.create({
        branchId: fix.branchId,
        supplierId: fix.suppliers.c,
        contractId: null,
        title: "Locked-only",
        titleAr: null,
        currencyCode: "SAR",
        validFrom: "2026-01-01",
        validTo: "2030-12-31",
        minCommitment: "0.0000",
        maxCommitment: "500.0000",
        priceLock: [{ itemId: fix.items.one, unitPrice: "10.0000" }],
        note: null,
        noteAr: null,
        actorId: S_ACTOR,
      }),
    );
    await expect(
      withTenant(S_TENANT, () =>
        blanketService.release({
          blanketId: live.id,
          lines: [{ itemId: fix.items.two, qty: "1", unitPrice: null }],
          releaseDate: "2026-02-10",
          note: null,
          actorId: S_ACTOR,
        }),
      ),
    ).rejects.toMatchObject({ code: "BLANKET_RELEASE_LINE_INVALID" });
  });
});

// -- 6. G-33 supplier advances -----------------------------------------------------------

describe("PHASE-038 acceptance 6a — G-33 supplier advances", () => {
  it("SoD blocks self-approval; the unmapped control account fails closed; the worked example posts balanced", async () => {
    const advance = await withTenant(S_TENANT, () =>
      advancesService.create({
        supplierId: fix.suppliers.a,
        currencyCode: "SAR",
        amount: "2000.0000",
        note: null,
        noteAr: null,
        actorId: S_ACTOR,
      }),
    );
    expect(advance.status).toBe("DRAFT");
    // SoD: the creator can never approve.
    await expect(
      withTenant(S_TENANT, () => advancesService.approve(advance.id, S_ACTOR)),
    ).rejects.toMatchObject({ code: "SELF_APPROVAL_BLOCKED" });
    await withTenant(S_TENANT, () => advancesService.approve(advance.id, S_APPROVER));
    // The failure pack: the control account unmapped → typed, nothing posted.
    await clearTenantSetting(S_TENANT, "purchasing.supplier_advance_control_account");
    await expect(
      withTenant(S_TENANT, () =>
        advancesService.disburse({ id: advance.id, cashAccountId: fix.cashAccountId, actorId: S_ACTOR }),
      ),
    ).rejects.toMatchObject({ code: "SUPPLIER_ADVANCE_ACCOUNT_UNMAPPED" });
    const stillApproved = await withTenant(S_TENANT, () => advancesService.find(advance.id));
    expect(stillApproved.status).toBe("APPROVED");
    expect(stillApproved.postedJournalId).toBeNull();

    // The worked example: map the control + disburse → G-33 (DR 2000/CR 2000).
    await setTenantSetting(S_TENANT, "purchasing.supplier_advance_control_account", fix.advanceControlAccount);
    const disbursed = await withTenant(S_TENANT, () =>
      advancesService.disburse({ id: advance.id, cashAccountId: fix.cashAccountId, entryDate: "2026-02-10", actorId: S_ACTOR }),
    );
    expect(disbursed.status).toBe("DISBURSED");
    expect(disbursed.advanceNo).toMatch(/^ADV-\d{4}-\d{6}$/);
    expect(disbursed.postedJournalId).not.toBeNull();
    const su = await superuserClient();
    const lines = await su.query(
      `SELECT l.direction, l.amount::text AS amount, a.code
         FROM journal_lines l JOIN accounts a ON a.id = l.account_id
        WHERE l.journal_entry_id = $1 ORDER BY l.line_no`,
      [disbursed.postedJournalId],
    );
    await su.end();
    expect(lines.rows).toHaveLength(2);
    expect(lines.rows[0]).toMatchObject({ direction: "DEBIT", amount: "2000.0000" });
    expect(lines.rows[1]).toMatchObject({ direction: "CREDIT", amount: "2000.0000" });

    // The application leg nets the supplier's subledger; full apply closes.
    const applied = await withTenant(S_TENANT, () =>
      advancesService.apply({ id: advance.id, amount: "1500.0000", entryDate: "2026-02-15", actorId: S_ACTOR }),
    );
    expect(applied.appliedAmount).toBe("1500.0000");
    expect(applied.status).toBe("DISBURSED");
    // Over-applying beyond the advance is typed.
    await expect(
      withTenant(S_TENANT, () =>
        advancesService.apply({ id: advance.id, amount: "1000.0000", actorId: S_ACTOR }),
      ),
    ).rejects.toMatchObject({ code: "ADVANCE_STATE" });
    const closed = await withTenant(S_TENANT, () =>
      advancesService.apply({ id: advance.id, amount: "500.0000", entryDate: "2026-02-20", actorId: S_ACTOR }),
    );
    expect(closed.status).toBe("CLOSED");
    expect(closed.appliedAmount).toBe("2000.0000");
  });
});

// -- 6. G-34 early-payment discounts --------------------------------------------------------

describe("PHASE-038 acceptance 6b — G-34 early-payment discount capture", () => {
  let invoiceId = "";
  let paymentId = "";

  beforeAll(async () => {
    // The substrate: an APPROVED+POSTED supplier invoice (direct expense
    // line — the match disposition path) paid NET within the window.
    invoiceId = await withTenant(S_TENANT, async () => {
      const created = await supplierInvoices.create({
        branchId: fix.branchId,
        supplierId: fix.suppliers.a,
        invoiceNo: "S-G34-001",
        invoiceDate: "2026-02-10",
        dueDate: null,
        currencyCode: "SAR",
        exchangeRate: null,
        poId: null,
        note: null,
        noteAr: null,
        actorId: S_ACTOR,
        lines: [
          {
            grnLineId: null,
            itemId: null,
            accountId: fix.expenseAccountId,
            description: "early-payment substrate",
            descriptionAr: null,
            qty: "1",
            unitPrice: "10000.000000",
            taxCodeId: null,
            vatRecoverable: null,
            note: null,
          },
        ],
      });
      await supplierInvoices.recordMatch({
        id: created.id,
        dispositions: [{ invoiceLineNo: 1, type: "ACCEPT_WITH_REASON", reason: "direct expense substrate" }],
        actorId: S_BUYER,
      });
      await supplierInvoices.approve(created.id, S_APPROVER);
      const posted = await supplierInvoices.post(created.id, S_ACTOR);
      return posted.invoice.id;
    });
    // Pay NET (9,800 = 10,000 − 2%) within the 10-day window.
    paymentId = await withTenant(S_TENANT, async () => {
      const payment = await payments.create({
        cashAccountId: fix.cashAccountId,
        partnerId: fix.suppliers.a,
        method: "BANK",
        payeeName: null,
        currencyCode: "SAR",
        amount: "9800.0000",
        exchangeRate: null,
        valueDate: "2026-02-15",
        reference: "G-34 substrate",
        description: "early payment net of 2%",
        descriptionAr: null,
        actorId: S_ACTOR,
      });
      const openItems = await allocations.openItems({ partnerId: fix.suppliers.a, side: "AP", limit: 50 });
      const invoiceItem = openItems.find((i) => i.sourceId === invoiceId);
      expect(invoiceItem).toBeDefined();
      await allocations.setAllocations({
        docType: "payment",
        docId: payment.id,
        allocations: [{ openItemId: invoiceItem!.id, amount: "9800.0000" }],
        actorId: S_ACTOR,
      });
      await payments.post(payment.id, S_ACTOR);
      return payment.id;
    });
  });

  it("unapproved terms fail closed (SoD) and the creator can never approve", async () => {
    const terms = await withTenant(S_TENANT, () =>
      advancesService.upsertTerms({
        supplierId: fix.suppliers.a,
        discountPct: "2.00",
        discountDays: 10,
        minInvoiceAmount: "0.0000",
        note: null,
        actorId: S_ACTOR,
      }),
    );
    await expect(
      withTenant(S_TENANT, () =>
        advancesService.captureDiscount({ invoiceId, paymentId, actorId: S_ACTOR }),
      ),
    ).rejects.toMatchObject({ code: "DISCOUNT_TERMS_NOT_APPROVED" });
    await expect(
      withTenant(S_TENANT, () => advancesService.approveTerms(terms.id, S_ACTOR)),
    ).rejects.toMatchObject({ code: "SELF_APPROVAL_BLOCKED" });
    await withTenant(S_TENANT, () => advancesService.approveTerms(terms.id, S_APPROVER));
  });

  it("the income account unmapped fails typed; then the capture posts the balanced G-34 and replays idempotently", async () => {
    await clearTenantSetting(S_TENANT, "purchasing.early_discount_income_account");
    await expect(
      withTenant(S_TENANT, () =>
        advancesService.captureDiscount({ invoiceId, paymentId, actorId: S_ACTOR }),
      ),
    ).rejects.toMatchObject({ code: "EARLY_DISCOUNT_INCOME_ACCOUNT_UNMAPPED" });
    await setTenantSetting(S_TENANT, "purchasing.early_discount_income_account", fix.discountIncomeAccount);

    const captured = await withTenant(S_TENANT, () =>
      advancesService.captureDiscount({ invoiceId, paymentId, entryDate: "2026-02-16", actorId: S_ACTOR }),
    );
    expect(captured.discount).toBe("200.0000");
    expect(captured.idempotentReplay).toBe(false);
    const su = await superuserClient();
    const lines = await su.query(
      `SELECT l.direction, l.amount::text AS amount, a.code, l.partner_id
         FROM journal_lines l JOIN accounts a ON a.id = l.account_id
        WHERE l.journal_entry_id = $1 ORDER BY l.line_no`,
      [captured.journalEntryId],
    );
    const entry = await su.query(
      `SELECT source_type, source_id, operation FROM journal_entries WHERE id = $1`,
      [captured.journalEntryId],
    );
    await su.end();
    expect(entry.rows[0]).toMatchObject({
      source_type: "early_payment_discount",
      source_id: invoiceId,
      operation: "capture",
    });
    expect(lines.rows).toHaveLength(2);
    expect(lines.rows[0]).toMatchObject({ direction: "DEBIT", amount: "200.0000" });
    expect(lines.rows[0]!.partner_id).toBe(fix.suppliers.a);
    expect(lines.rows[1]).toMatchObject({ direction: "CREDIT", amount: "200.0000" });
    // INV-013: the replay converges on the stored journal — one capture.
    const replay = await withTenant(S_TENANT, () =>
      advancesService.captureDiscount({ invoiceId, paymentId, actorId: S_ACTOR }),
    );
    expect(replay.idempotentReplay).toBe(true);
    expect(replay.journalEntryId).toBe(captured.journalEntryId);
  });

  it("a payment outside the window is typed (DISCOUNT_WINDOW_EXPIRED)", async () => {
    const late = await withTenant(S_TENANT, async () => {
      const created = await supplierInvoices.create({
        branchId: fix.branchId,
        supplierId: fix.suppliers.a,
        invoiceNo: "S-G34-002",
        invoiceDate: "2026-01-05",
        dueDate: null,
        currencyCode: "SAR",
        exchangeRate: null,
        poId: null,
        note: null,
        noteAr: null,
        actorId: S_ACTOR,
        lines: [
          {
            grnLineId: null,
            itemId: null,
            accountId: fix.expenseAccountId,
            description: "late substrate",
            descriptionAr: null,
            qty: "1",
            unitPrice: "5000.000000",
            taxCodeId: null,
            vatRecoverable: null,
            note: null,
          },
        ],
      });
      await supplierInvoices.recordMatch({
        id: created.id,
        dispositions: [{ invoiceLineNo: 1, type: "ACCEPT_WITH_REASON", reason: "late substrate" }],
        actorId: S_BUYER,
      });
      await supplierInvoices.approve(created.id, S_APPROVER);
      const posted = await supplierInvoices.post(created.id, S_ACTOR);
      const payment = await payments.create({
        cashAccountId: fix.cashAccountId,
        partnerId: fix.suppliers.a,
        method: "BANK",
        payeeName: null,
        currencyCode: "SAR",
        amount: "5000.0000",
        exchangeRate: null,
        valueDate: "2026-03-30", // way past 2026-01-05 + 10d
        reference: "late",
        description: null,
        descriptionAr: null,
        actorId: S_ACTOR,
      });
      const openItems = await allocations.openItems({ partnerId: fix.suppliers.a, side: "AP", limit: 50 });
      const item = openItems.find((i) => i.sourceId === posted.invoice.id);
      await allocations.setAllocations({
        docType: "payment",
        docId: payment.id,
        allocations: [{ openItemId: item!.id, amount: "5000.0000" }],
        actorId: S_ACTOR,
      });
      await payments.post(payment.id, S_ACTOR);
      return { invoiceId: posted.invoice.id, paymentId: payment.id };
    });
    await expect(
      withTenant(S_TENANT, () =>
        advancesService.captureDiscount({ invoiceId: late.invoiceId, paymentId: late.paymentId, actorId: S_ACTOR }),
      ),
    ).rejects.toMatchObject({ code: "DISCOUNT_WINDOW_EXPIRED" });
  });
});

// -- 7. scorecards + the approved-vendor gate ----------------------------------------------

describe("PHASE-038 acceptance 7 — scorecards and the approved-vendor gate", () => {
  it("computes scores from the live window and the approved list gates vendor suggestions", async () => {
    const rating = await withTenant(S_TENANT, () =>
      scorecardService.recompute({ supplierId: fix.suppliers.a, windowDays: 365, computedBy: S_ACTOR }),
    );
    expect(Number(rating.overallScore)).toBeGreaterThanOrEqual(0);
    expect(Number(rating.overallScore)).toBeLessThanOrEqual(100);
    const detail = rating.detail as unknown as { invoices: number };
    expect(detail.invoices).toBeGreaterThanOrEqual(2);

    // The approved list + the gate: BLOCK rejects an unapproved vendor.
    await withTenant(S_TENANT, () =>
      scorecardService.upsertApprovedItem({
        supplierId: fix.suppliers.a,
        itemId: fix.items.one,
        status: "APPROVED",
        expiresAt: null,
        note: null,
        actorId: S_ACTOR,
      }),
    );
    await setTenantSetting(S_TENANT, "purchasing.approved_vendor_list.mode", "BLOCK");
    try {
      await expect(
        withTenant(S_TENANT, () =>
          orderService.create({
            branchId: fix.branchId,
            supplierId: fix.suppliers.b, // NOT approved for item one
            orderDate: "2026-02-20",
            expectedDate: null,
            currencyCode: "SAR",
            exchangeRate: null,
            note: null,
            noteAr: null,
            actorId: S_ACTOR,
            lines: [{ itemId: fix.items.one, qty: "1", unitPrice: "10.000000", taxCodeId: null, note: null }],
          }),
        ),
      ).rejects.toMatchObject({ code: "APPROVED_VENDOR_REQUIRED" });
      // FLAG proceeds (and flags audited) — and the APPROVED vendor passes.
      await setTenantSetting(S_TENANT, "purchasing.approved_vendor_list.mode", "FLAG");
      const flagged = await withTenant(S_TENANT, () =>
        orderService.create({
          branchId: fix.branchId,
          supplierId: fix.suppliers.b,
          orderDate: "2026-02-20",
          expectedDate: null,
          currencyCode: "SAR",
          exchangeRate: null,
          note: "flagged vendor",
          noteAr: null,
          actorId: S_ACTOR,
          lines: [{ itemId: fix.items.one, qty: "1", unitPrice: "10.000000", taxCodeId: null, note: null }],
        }),
      );
      expect(flagged.status).toBe("DRAFT");
      const approvedVendor = await withTenant(S_TENANT, () =>
        orderService.create({
          branchId: fix.branchId,
          supplierId: fix.suppliers.a,
          orderDate: "2026-02-20",
          expectedDate: null,
          currencyCode: "SAR",
          exchangeRate: null,
          note: null,
          noteAr: null,
          actorId: S_ACTOR,
          lines: [{ itemId: fix.items.one, qty: "1", unitPrice: "10.000000", taxCodeId: null, note: null }],
        }),
      );
      expect(approvedVendor.status).toBe("DRAFT");
    } finally {
      await clearTenantSetting(S_TENANT, "purchasing.approved_vendor_list.mode");
    }
  });
});

// -- 9. CAPEX requests + the 028 guard ------------------------------------------------------

describe("PHASE-038 acceptance 9 — CAPEX requests", () => {
  it("runs the workflow with SoD and the guard OFF (no budgets) then ENFORCED (over budget)", async () => {
    const request = await withTenant(S_TENANT, () =>
      capexService.create({
        branchId: fix.branchId,
        title: "Forklift replacement",
        titleAr: null,
        description: null,
        accountId: fix.advanceControlAccount,
        costCenterId: null,
        projectId: null,
        estimatedAmount: "5000.0000",
        currencyCode: "SAR",
        neededBy: "2026-03-01",
        actorId: S_ACTOR,
      }),
    );
    expect(request.status).toBe("DRAFT");
    const submitted = await withTenant(S_TENANT, () => capexService.submit(request.id, S_ACTOR));
    // No ACTIVE budgets in tenant S → the guard is OFF; the evaluation persists.
    expect(submitted.status).toBe("PENDING_APPROVAL");
    expect((submitted.budgetEvaluation as unknown as { mode: string }).mode).toBe("OFF");
    // SoD: the creator can never approve.
    await expect(withTenant(S_TENANT, () => capexService.approve(request.id, S_ACTOR))).rejects.toMatchObject({
      code: "SELF_APPROVAL_BLOCKED",
    });
    const approved = await withTenant(S_TENANT, () => capexService.approve(request.id, S_APPROVER));
    expect(approved.requestNo).toMatch(/^CAP-\d{4}-\d{6}$/);
    expect(approved.status).toBe("APPROVED");

    // ENFORCED: an ACTIVE budget of 1,000 on the same account blocks a
    // 5,000 CAPEX submit typed (the 028 discipline verbatim).
    const budgetVersions = new BudgetVersionService(audit);
    const grid = new BudgetGridService(audit, new ConsumptionService());
    const workflow = new ApprovalWorkflow(audit);
    const budget = await withTenant(S_TENANT, () =>
      budgetVersions.create(
        {
          fiscalYearId: fix.fiscalYearId,
          scope: "ACCOUNTS",
          name: "CAPEX guard budget",
          nameAr: null,
          note: null,
          noteAr: null,
        },
        S_ACTOR,
      ),
    );
    await withTenant(S_TENANT, () =>
      grid.replaceGrid(
        budget.id,
        [
          {
            fiscalPeriodId: fix.periodId, // the neededBy period (2026-03)
            accountId: fix.advanceControlAccount,
            costCenterId: null,
            projectId: null,
            branchId: null,
            amount: "1000.0000",
          },
        ],
        S_ACTOR,
      ),
    );
    await withTenant(S_TENANT, () => workflow.submit(budget.id, S_ACTOR));
    await withTenant(S_TENANT, () => workflow.approve(budget.id, S_APPROVER));
    await withTenant(S_TENANT, () => workflow.activate(budget.id, S_ACTOR));
    await setTenantSetting(S_TENANT, "budgeting.controls.mode", "ENFORCE_DRAFT");
    // The guard's active-budget index caches per tenant (≤ 1/min) — the
    // test activates a budget mid-flight, so the cache resets explicitly
    // (the production path never sees a mid-minute activation).
    const { invalidateActiveBudgetIndex } = await import("../../modules/budgeting/application/control-guard");
    invalidateActiveBudgetIndex();
    try {
      const blocked = await withTenant(S_TENANT, () =>
        capexService.create({
          branchId: fix.branchId,
          title: "Over-budget request",
          titleAr: null,
          description: null,
          accountId: fix.advanceControlAccount,
          costCenterId: null,
          projectId: null,
          estimatedAmount: "5000.0000",
          currencyCode: "SAR",
          neededBy: "2026-03-01",
          actorId: S_ACTOR,
        }),
      );
      await expect(withTenant(S_TENANT, () => capexService.submit(blocked.id, S_ACTOR))).rejects.toMatchObject({
        code: "BUDGET_EXCEEDED",
      });
      // Zero residue: the blocked request stays DRAFT.
      expect((await withTenant(S_TENANT, () => capexService.find(blocked.id))).status).toBe("DRAFT");
    } finally {
      await clearTenantSetting(S_TENANT, "budgeting.controls.mode");
    }
  });
});

// -- tender intake + the P-06 contract linkage ------------------------------------------------

describe("PHASE-038 acceptance 9b — tender intake and the contract linkage", () => {
  it("records the intake, the decision, and closes it (intake only — no bidding claims)", async () => {
    const intake = await withTenant(S_TENANT, () =>
      tenderService.create({
        title: "Municipality supply tender",
        titleAr: null,
        announcingAuthority: "Municipality of Test",
        tenderRefNo: "TND-REF-77",
        publishedAt: "2026-02-01",
        submissionDeadline: "2026-03-01T00:00:00.000Z",
        estimatedValue: "250000.0000",
        currencyCode: "SAR",
        govRegistrationNo: "GOV-REG-001",
        govRegistrationExpiry: "2027-01-01",
        classificationCode: "CLASS-A",
        sourceUrl: "https://tenders.example.gov/77",
        note: null,
        noteAr: null,
        actorId: S_ACTOR,
      }),
    );
    expect(intake.intakeNo).toMatch(/^TND-\d{4}-\d{6}$/);
    expect(intake.ourDecision).toBe("PENDING");
    const decided = await withTenant(S_TENANT, () =>
      tenderService.decide(intake.id, { ourDecision: "WILL_BID", note: null, actorId: S_ACTOR }),
    );
    expect(decided.ourDecision).toBe("WILL_BID");
    const closed = await withTenant(S_TENANT, () => tenderService.close(intake.id, S_ACTOR));
    expect(closed.status).toBe("CLOSED");
  });

  it("contract-linked purchasing resolves a LIVE contract and rejects a non-ACTIVE one", async () => {
    const linked = await withTenant(S_TENANT, () =>
      orderService.create({
        branchId: fix.branchId,
        supplierId: fix.suppliers.c,
        orderDate: "2026-02-20",
        expectedDate: null,
        currencyCode: "SAR",
        exchangeRate: null,
        note: null,
        noteAr: null,
        actorId: S_ACTOR,
        contractId: fix.contractId,
        lines: [{ itemId: fix.items.one, qty: "1", unitPrice: "10.000000", taxCodeId: null, note: null }],
      }),
    );
    expect(linked.contractId).toBe(fix.contractId);
    // A foreign contract id is a typed rejection (A7 — no disclosure).
    await expect(
      withTenant(S_TENANT, () =>
        orderService.create({
          branchId: fix.branchId,
          supplierId: fix.suppliers.c,
          orderDate: "2026-02-20",
          expectedDate: null,
          currencyCode: "SAR",
          exchangeRate: null,
          note: null,
          noteAr: null,
          actorId: S_ACTOR,
          contractId: "00000000-0000-4000-8000-0000000000ff",
          lines: [{ itemId: fix.items.one, qty: "1", unitPrice: "10.000000", taxCodeId: null, note: null }],
        }),
      ),
    ).rejects.toMatchObject({ code: "ORDER_LINE_INVALID" });
    // A DRAFT contract does not resolve a live linkage.
    const crmStore = await import("../../modules/crm/infrastructure/crm.store");
    const draft = await withTenant(S_TENANT, () =>
      crmStore.insertContract({
        partnerId: fix.suppliers.c,
        projectId: null,
        title: "Draft contract",
        titleAr: null,
        scope: null,
        feeModel: "RETAINER",
        startDate: "2026-01-01",
        endDate: "2026-12-31",
        monthlyAmount: "500.0000",
        currencyCode: "SAR",
        note: null,
        noteAr: null,
        actorId: S_ACTOR,
      }),
    );
    await expect(
      withTenant(S_TENANT, () =>
        orderService.create({
          branchId: fix.branchId,
          supplierId: fix.suppliers.c,
          orderDate: "2026-02-20",
          expectedDate: null,
          currencyCode: "SAR",
          exchangeRate: null,
          note: null,
          noteAr: null,
          actorId: S_ACTOR,
          contractId: draft.id,
          lines: [{ itemId: fix.items.one, qty: "1", unitPrice: "10.000000", taxCodeId: null, note: null }],
        }),
      ),
    ).rejects.toMatchObject({ code: "ORDER_LINE_INVALID" });
  });
});

// -- 10. the P-11 matching bands (tenant P's full chain) ----------------------------------------

describe("PHASE-038 acceptance 10 — the matching tolerance bands", () => {
  it("small lines follow the band; large lines keep the flat keys (the S-tenant chain)", async () => {
    const goodsReceipts = new (
      await import("../../modules/purchasing/application/goods-receipts")
    ).GoodsReceiptService(audit, posting, numbering);
    await setTenantSetting(S_TENANT, "purchasing.match.qty_tolerance_pct", "0");
    await setTenantSetting(S_TENANT, "purchasing.match.price_tolerance_pct", "0");
    await setTenantSetting(S_TENANT, "purchasing.match.tolerance_bands", [
      { maxLineAmount: "100.0000", qtyPct: "0", pricePct: "10" },
    ]);
    try {
      // PO 60 × 10.00 → GRN posts (G-07: DR INVENTORY / CR GRNI).
      const order = await withTenant(S_TENANT, () =>
        orderService.create({
          branchId: fix.branchId,
          supplierId: fix.suppliers.a,
          orderDate: "2026-02-01",
          expectedDate: "2026-02-01",
          currencyCode: "SAR",
          exchangeRate: null,
          note: null,
          noteAr: null,
          actorId: S_ACTOR,
          lines: [{ itemId: fix.items.one, qty: "60", unitPrice: "10.000000", taxCodeId: null, note: null }],
        }),
      );
      await withTenant(S_TENANT, () => orderService.issue(order.id, S_ACTOR));
      const orderLines = await withTenant(S_TENANT, () => orderService.findWithLines(order.id));
      const receipt = await withTenant(S_TENANT, () =>
        goodsReceipts.create({
          branchId: fix.branchId,
          supplierId: fix.suppliers.a,
          poId: order.id,
          warehouseId: fix.warehouseId,
          receiptDate: "2026-02-01",
          poLessReason: null,
          note: null,
          noteAr: null,
          actorId: S_ACTOR,
          lines: [
            {
              poLineId: orderLines.lines[0]!.id,
              itemId: fix.items.one,
              qty: "60",
              unitCost: "10.000000",
              accountId: null,
              batchNo: null,
              batchExpiry: null,
              serialIds: null,
              note: null,
            },
          ],
        }),
      );
      await withTenant(S_TENANT, () => goodsReceipts.post(receipt.id, S_ACTOR));
      const grn = await withTenant(S_TENANT, () => goodsReceipts.findWithLines(receipt.id));
      // Invoice line 1: 5 × 10.50 = 52.50 → inside the band (10%) → auto-pass.
      // Invoice line 2: 10 × 11.00 = 110 → above the band → flat 0 → PRICE_EXCEPTION.
      const invoice = await withTenant(S_TENANT, () =>
        supplierInvoices.create({
          branchId: fix.branchId,
          supplierId: fix.suppliers.a,
          invoiceNo: "S-BAND-001",
          invoiceDate: "2026-02-01",
          dueDate: null,
          currencyCode: "SAR",
          exchangeRate: null,
          poId: order.id,
          note: null,
          noteAr: null,
          actorId: S_ACTOR,
          lines: [
            {
              grnLineId: grn.lines[0]!.id,
              itemId: fix.items.one,
              accountId: null,
              description: "small (banded)",
              descriptionAr: null,
              qty: "5",
              unitPrice: "10.500000",
              taxCodeId: null,
              vatRecoverable: null,
              note: null,
            },
            {
              grnLineId: grn.lines[0]!.id,
              itemId: fix.items.one,
              accountId: null,
              description: "big (flat)",
              descriptionAr: null,
              qty: "10",
              unitPrice: "11.000000",
              taxCodeId: null,
              vatRecoverable: null,
              note: null,
            },
          ],
        }),
      );
      const result = await withTenant(S_TENANT, () =>
        supplierInvoices.matchPreview(invoice.id, S_BUYER),
      );
      expect(result.bandsApplied).toBe(true);
      expect(result.lines[0]!.outcome).toBe("PRICE_VARIANCE_WITHIN_TOLERANCE");
      expect(result.lines[1]!.outcome).toBe("PRICE_EXCEPTION");
    } finally {
      await clearTenantSetting(S_TENANT, "purchasing.match.tolerance_bands");
      await clearTenantSetting(S_TENANT, "purchasing.match.qty_tolerance_pct");
      await clearTenantSetting(S_TENANT, "purchasing.match.price_tolerance_pct");
    }
  });
});

// -- acceptance 10b: the two report contracts render over the seeded data ---------

describe("PHASE-038 — the sourcing report contracts render", () => {
  it("registers both contracts and renders the scorecard over the seeded data", async () => {
    const ids = REPORT_CONTRACTS.map((c) => c.id);
    expect(ids).toContain("purchasing.rfq-award-matrix");
    expect(ids).toContain("purchasing.supplier-scorecard");
    const scorecard = REPORT_CONTRACTS.find((c) => c.id === "purchasing.supplier-scorecard")!;
    const rendered = await withTenant(S_TENANT, () =>
      scorecard.run(
        {
          tenantId: S_TENANT,
          userId: S_ACTOR,
          effectiveBranchIds: null,
          baseCurrency: "SAR",
          permissions: new Set(["purchasing.rfqs.read"]),
        },
        { dateFrom: "2026-01-01", dateTo: "2026-12-31", locale: "en" },
      ),
    );
    expect(rendered.rows.length).toBeGreaterThanOrEqual(1);
    expect(rendered.assertionResults.every((a) => a.status === "PASS")).toBe(true);
    // The matrix contract renders the empty case gracefully (no live
    // comparison for a fresh RFQ id).
    const matrix = REPORT_CONTRACTS.find((c) => c.id === "purchasing.rfq-award-matrix")!;
    const empty = await withTenant(S_TENANT, () =>
      matrix.run(
        {
          tenantId: S_TENANT,
          userId: S_ACTOR,
          effectiveBranchIds: null,
          baseCurrency: "SAR",
          permissions: new Set(["purchasing.rfqs.read"]),
        },
        { rfqId: "00000000-0000-4000-8000-0000000000aa", locale: "en" },
      ),
    );
    expect(empty.rows).toHaveLength(0);
  });
});
