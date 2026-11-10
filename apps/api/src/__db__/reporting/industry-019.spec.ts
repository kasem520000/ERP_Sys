import { beforeAll, describe, expect, it } from "vitest";

import {
  ALL_KNOWN_PERMISSIONS,
  R_ACTOR,
  fullContext,
  newRunService,
  withTenant,
} from "./fixtures";
import { ensureTestDb, superuserClient } from "../test-db";
import { AuditService } from "../../modules/audit/api/audit";
import { DrizzleAuditStore } from "../../modules/audit/infrastructure/drizzle-audit.store";
import { PostingService } from "../../modules/accounting/application/posting-service";
import { PeriodService } from "../../modules/accounting/application/period-service";
import { NumberingService } from "../../modules/accounting/application/numbering-service";
import { PartnerSubledgerService } from "../../modules/partners/application/subledger-service";
import { ResolveEffectiveConfigService } from "../../modules/configuration/application/resolve/resolve-service";
import { ConfigRepository } from "../../modules/configuration/infrastructure/config-repository";
import { TaxResolverService } from "../../modules/tax/application/tax-resolver-service";
import { TaxCodesService } from "../../modules/tax/application/codes-service";
import { RegistrationService } from "../../modules/tax/application/registration-service";
import { AccountService } from "../../modules/treasury/application/account-service";
import { ReceiptService } from "../../modules/treasury/application/receipt-service";
import { SettlementCore } from "../../modules/treasury/application/fx-settlement";
import { SalesInvoiceService } from "../../modules/sales/application/invoices";
import { ContractService } from "../../modules/crm/application/contract-service";
import { BillingRunService } from "../../modules/crm/application/billing-run-service";
import { DeferralService } from "../../modules/crm/application/deferral-service";
import { InboxService } from "../../modules/notifications/application/inbox-service";
import { PermissionDeniedError } from "../../modules/reporting/application/scope";
import * as accountingStore from "../../modules/accounting/infrastructure/accounting.store";
import * as journal from "../../modules/accounting/infrastructure/journal.store";
import * as salesStore from "../../modules/sales/infrastructure/sales.store";
import * as crmStore from "../../modules/crm/infrastructure/crm.store";
import * as itemsStore from "../../modules/items/infrastructure/items.store";
import * as partnersStore from "../../modules/partners/infrastructure/partners.store";
import type { ReportResult } from "../../modules/reporting/application/contract";

/**
 * PHASE-019 T49 · the two services report fixtures (industries/reports/README
 * PHASE-019 rows; the README rule 5: "cover with a fixture asserting totals
 * against journal lines where applicable"): the contracts over a dedicated,
 * fully-journaled tenant R19 whose book is the §15 fixture set on ONE tenant,
 * run only through the real services (ContractService activate →
 * BillingRunService runs → SalesInvoiceService approve+post with the
 * contract-billing port wired → DeferralService's J-REL) and the reports run
 * through the REAL reporting engine (RunService over the frozen registry):
 *
 * - C1 the retainer chain (2026-01-15 → 2026-06-14, 1000/mo FEE-RET,
 *   CASE-01): 6 schedule entries; the run drafts Jan+Feb; the JANUARY draft
 *   is approved+posted (J-INV 1150 gross) and FEBRUARY stays DRAFT —
 *   contracted 6000 / invoiced 1000 / draft 1000 / backlog 4000.
 * - C2 the deferral chain (2026-01-15 → 2026-02-14, 1000/mo): the §15
 *   receipt 500 on-account 2025-12-15 (J-RCP), tagged with policy
 *   `crm.defer_advance_recognition` ON (J-DEF), then the FEBRUARY draft
 *   posted → J-INV2 + J-REL; invoice open 650 — contracted 2000 /
 *   invoiced 1000 / draft 1000 / backlog 0.
 * - C3 the milestone chain (Signing 5000 @ 2026-03-01 drafted, Delivery
 *   7000 @ 2026-05-01 still PLANNED) — contracted 12000 / draft 5000 /
 *   backlog 7000.
 * - C4 the hourly chain (2026-03-01 → 2026-04-30): the §15 slips (3.0 h
 *   Research 2026-03-28, 2.0 h Drafting 2026-04-03, 1.5 h narrative-less
 *   2026-04-10 skipped) — March draft 750 net, April draft 500 net;
 *   contracted/backlog NULL (the honest HOURLY operational labeling).
 *
 * The window run (2026-01-01..2026-06-30, asOf 2026-06-30) then asserts: 12
 * rows; the GL tie Σ invoiced net 2000.0000 == Σ SERVICE_REVENUE credits of
 * the two posted journals exactly; the reconciliation invariant per contract;
 * the overdue buckets (1150 + 650 = 1800.0000) matching the AR open-item
 * computation for the same asOf; BR-028 determinism (two recomputed runs are
 * byte-identical); the time-billing row (6.5/6.5/5.0 h, 1625/1625/1250);
 * and permission gating (no crm.contracts.manage → PermissionDeniedError).
 */

/** Dedicated PHASE-019 reporting tenant (owns its book end to end). */
export const TENANT_R19 = "6d6d6d6d-6d6d-6d6d-6d6d-6d6d6d6d6d6d";

// -- the service graph (constructed manually — §18 lesson 6: the port is ---
// -- wired on THIS spec's own salesInvoices instance exactly as CrmModule) --

const audit = new AuditService(new DrizzleAuditStore());
const posting = new PostingService(audit, new PartnerSubledgerService());
const numbering = new NumberingService(audit);
const resolver = new TaxResolverService();
const salesInvoices = new SalesInvoiceService(audit, posting, numbering, resolver);
const resolveConfig = new ResolveEffectiveConfigService(new ConfigRepository());
const contracts = new ContractService(audit, posting, numbering, resolveConfig);
const periods = new PeriodService(audit);
const taxCodes = new TaxCodesService(audit);
const registrations = new RegistrationService(audit);
const treasuryAccounts = new AccountService(audit);
const receipts = new ReceiptService(audit, new SettlementCore(audit, posting, numbering));
const inbox = new InboxService();
const deferral = new DeferralService(audit, posting, inbox);
const billingRuns = new BillingRunService(audit, salesInvoices, contracts, resolveConfig);

salesInvoices.setContractBillingPort({
  validateContract: async (contractId: string) =>
    (await crmStore.findContractById(contractId)) !== undefined,
  onContractInvoicePosted: (contractId: string, invoiceId: string, actorId: string | null) =>
    deferral.onContractInvoicePosted(contractId, invoiceId, actorId),
});

interface R19Fixture {
  partnerId: string;
  case01Id: string;
  c1Id: string;
  c1No: string;
  c2Id: string;
  c2No: string;
  c3Id: string;
  c3No: string;
  c4Id: string;
  c4No: string;
  /** The posted January invoice of C1 (J-INV). */
  c1JanInvoiceId: string;
  /** The posted February invoice of C2 (J-INV2 + J-REL). */
  c2FebInvoiceId: string;
  /** The §15 advance (J-DEF → released by the February post, J-REL). */
  advanceId: string;
  jDefId: string | null;
  jRelId: string | null;
}

let fixture: R19Fixture | undefined;

const C1_TITLE = "R19 reports retainer chain";
const C2_TITLE = "R19 deferral chain retainer";
const C3_TITLE = "R19 delivery project (milestones)";
const C4_TITLE = "R19 hourly advisory";

function assertDefined<T>(value: T | undefined | null, label: string): T {
  if (value === undefined || value === null) throw new Error(`fixture ${label} missing`);
  return value;
}

/** Upsert a tenant setting with `updated_at = now()` (the resolve-cache fingerprint bump). */
async function setSetting(key: string, value: string | boolean): Promise<void> {
  const su = await superuserClient();
  await su.query(
    `INSERT INTO tenant_settings (id, tenant_id, key, value)
     VALUES (gen_random_uuid(), $1, $2, $3::jsonb)
     ON CONFLICT (tenant_id, key) DO UPDATE SET value = EXCLUDED.value, updated_at = now()`,
    [TENANT_R19, key, JSON.stringify(value)],
  );
  await su.end();
}

/** Boots tenant R19's §15 book (idempotent — guarded by C1's title). */
async function setupR19Fixture(): Promise<R19Fixture> {
  if (fixture !== undefined) return fixture;
  ensureTestDb();
  const su = await superuserClient();
  await su.query(
    `INSERT INTO tenants (id, name, name_ar, base_currency, country_code, timezone) VALUES
       ($1, 'Tenant R19 (services reporting 019)', 'المستأجر ر-١٩', 'SAR', 'SA', 'Asia/Riyadh')
     ON CONFLICT (id) DO NOTHING`,
    [TENANT_R19],
  );
  await su.query(
    `INSERT INTO users (id, email, full_name, password_hash, status)
     VALUES ($1, 'reporting-actor@fixture.test', 'Reporting Actor', 'x', 'ACTIVE')
     ON CONFLICT (id) DO NOTHING`,
    [R_ACTOR],
  );
  await su.end();

  fixture = await withTenant(TENANT_R19, async () => {
    const { provisionCoaTemplate, seedMasterDataBasics, insertAccountPurpose, insertBranch } =
      await import("../../modules/tenancy/infrastructure/tenancy.store");
    const { findAccountByCode, findActivePurpose, findFiscalYearByName } = await import(
      "../../modules/accounting/infrastructure/accounting.store"
    );
    await seedMasterDataBasics();
    await provisionCoaTemplate();

    // Purpose map (§15: AR_CONTROL→1130, SALES_REVENUE→4100,
    // SERVICE_REVENUE→4200, VAT_PAYABLE→2120, DEFERRED_REVENUE→2130; the
    // template marks most — explicit is the idempotent belt-and-braces).
    const byCode = async (code: string) => {
      const account = await findAccountByCode(code);
      if (account === undefined) throw new Error(`fixture account ${code} missing`);
      return account;
    };
    const mapPurpose = async (purposeKey: string, code: string) => {
      const existing = await findActivePurpose(purposeKey);
      if (existing !== undefined) return existing.accountId;
      const account = await byCode(code);
      await insertAccountPurpose({
        purposeKey,
        accountId: account.id,
        activeFrom: "2025-12-01",
      });
      return account.id;
    };
    await mapPurpose("AR_CONTROL", "1130");
    await mapPurpose("SALES_REVENUE", "4100");
    await mapPurpose("SERVICE_REVENUE", "4200");
    await mapPurpose("VAT_PAYABLE", "2120");
    await mapPurpose("DEFERRED_REVENUE", "2130");
    await mapPurpose("COGS", "5100");
    await mapPurpose("INVENTORY", "1140");

    // FY2025 (the 2025-12-15 receipt) + FY2026 (the §15 windows), all OPEN.
    if ((await findFiscalYearByName("FY2025")) === undefined) {
      await periods.createYear(R_ACTOR, {
        name: "FY2025",
        startDate: "2025-01-01",
        endDate: "2025-12-31",
      });
    }
    if ((await findFiscalYearByName("FY2026")) === undefined) {
      await periods.createYear(R_ACTOR, {
        name: "FY2026",
        startDate: "2026-01-01",
        endDate: "2026-12-31",
      });
    }

    await insertBranch({ code: "MAIN", name: "Main branch", nameAr: "الفرع الرئيسي", address: null });

    // Tax: SA REGISTERED + the STD 15% code (§15's 15% rides the fee items).
    if ((await registrations.list()).length === 0) {
      await registrations.upsert({
        countryCode: "SA",
        status: "REGISTERED",
        registrationNumber: "310000000000003",
        effectiveFrom: "2016-01-01",
        effectiveTo: null,
        actorId: R_ACTOR,
        note: "R19 reports fixture registration",
      });
    }
    const existingCodes = await taxCodes.list({ countryCode: "SA" });
    const TAX_STD =
      existingCodes.find((row) => row.code === "STD")?.id ??
      (
        await taxCodes.create({
          code: "STD",
          name: "Standard (SA)",
          nameAr: null,
          countryCode: "SA",
          defaultTreatment: "STANDARD_RATED",
          actorId: R_ACTOR,
        })
      ).id;

    // §15: Partner P-000001 (CUSTOMER, NET30) + project CASE-01.
    const terms = await partnersStore.listCreditTerms();
    const net30 = terms.find((t) => t.days === 30) ?? terms[0]!;
    const partnerId = (
      await partnersStore.insertPartner({
        kind: "CUSTOMER",
        code: "P-000001",
        name: "Gulf Advisory Group",
        nameAr: "مجموعة الخليج للاستشارات",
        taxNumber: null,
        creditLimit: null,
        creditTermsId: net30.id,
        priceListId: null,
      })
    ).id;
    const case01Id = (
      await accountingStore.insertProject({
        code: "CASE-01",
        name: "Advisory case 1",
        nameAr: null,
        parentId: null,
      })
    ).id;

    // §15 fee items (SERVICE, each WITH the STD 15% tax code).
    const uoms = await itemsStore.listUoms();
    const hr = uoms.find((u) => u.code === "HR") ?? uoms[0]!;
    const pcs = uoms.find((u) => u.code === "PCS") ?? uoms[0]!;
    const ensureItem = async (sku: string, uomId: string) =>
      itemsStore.insertItem({
        sku,
        name: `${sku} fee item`,
        nameAr: null,
        kind: "SERVICE",
        uomId,
        categoryId: null,
        taxCodeId: TAX_STD,
        costingMethod: "WAC",
        trackBatch: false,
        trackSerial: false,
        trackImei: false,
        hasExpiry: false,
        reorderLevel: null,
        reorderQty: null,
        basePrice: null,
      });
    const FEE_RET = (await ensureItem("FEE-RET", pcs.id)).id;
    const FEE_MIL = (await ensureItem("FEE-MIL", pcs.id)).id;
    const FEE_HR = (await ensureItem("FEE-HR", hr.id)).id;

    const GL_CASH = (await byCode("1111")).id;
    const CASH_ACCOUNT = (
      await treasuryAccounts.open({
        name: "R19 main cash",
        nameAr: null,
        type: "CASH",
        accountId: GL_CASH,
        branchId: null,
        currencyCode: "SAR",
        actorId: R_ACTOR,
      })
    ).id;

    // -- re-entry recovery (the book is guarded by C1's title) -------------
    const existingContracts = await crmStore.listContracts({ limit: 1000 });
    const existingC1 = existingContracts.find((row) => row.title === C1_TITLE);
    if (existingC1 !== undefined) {
      const c2 = assertDefined(existingContracts.find((row) => row.title === C2_TITLE), "C2");
      const c3 = assertDefined(existingContracts.find((row) => row.title === C3_TITLE), "C3");
      const c4 = assertDefined(existingContracts.find((row) => row.title === C4_TITLE), "C4");
      const invoiceOf = async (contractId: string, periodKey: string) => {
        const guards = await crmStore.listContractInvoices({ contractId, limit: 50 });
        return assertDefined(
          guards.find((row) => row.periodKey === periodKey),
          `guard ${periodKey}`,
        ).invoiceId;
      };
      const advance = assertDefined(
        (await crmStore.listContractAdvances(c2.id))[0],
        "the advance",
      );
      return {
        partnerId,
        case01Id,
        c1Id: existingC1.id,
        c1No: assertDefined(existingC1.contractNo, "C1 no"),
        c2Id: c2.id,
        c2No: assertDefined(c2.contractNo, "C2 no"),
        c3Id: c3.id,
        c3No: assertDefined(c3.contractNo, "C3 no"),
        c4Id: c4.id,
        c4No: assertDefined(c4.contractNo, "C4 no"),
        c1JanInvoiceId: await invoiceOf(existingC1.id, "2026-01"),
        c2FebInvoiceId: await invoiceOf(c2.id, "2026-02"),
        advanceId: advance.id,
        jDefId: advance.deferJournalId,
        jRelId: advance.releasedJournalId,
      };
    }

    // -- the book (staged so every run drafts exactly what its chain needs) -
    // 1. C3 the milestone chain first: run asOf 2026-03-01 drafts ONLY the
    //    Signing milestone (nothing else exists yet).
    const c3 = await contracts.create({
      partnerId,
      projectId: case01Id,
      title: C3_TITLE,
      titleAr: null,
      scope: null,
      feeModel: "MILESTONES",
      startDate: "2026-01-01",
      endDate: "2026-06-30",
      monthlyAmount: null,
      feeItemId: FEE_MIL,
      milestones: [
        { label: "Signing", labelAr: null, dueDate: "2026-03-01", amount: "5000", feeItemId: null },
        { label: "Delivery", labelAr: null, dueDate: "2026-05-01", amount: "7000", feeItemId: null },
      ],
      currencyCode: null,
      note: null,
      noteAr: null,
      actorId: R_ACTOR,
    });
    const c3Active = await contracts.activate(c3.contract.id, R_ACTOR);
    {
      const run = await billingRuns.run({ asOf: "2026-03-01", actorId: R_ACTOR });
      expect(run.draftsCreated).toHaveLength(1);
      expect(run.draftsCreated[0]!.contractId).toBe(c3Active.contract.id); // Signing 5000
    }

    // 2. C4 the hourly chain (mode gate "hourly"): the §15 slips, weekly
    //    review, then March (asOf 2026-04-15) and April (asOf 2026-04-30)
    //    drafts — before any retainer exists that those asOf dates would
    //    also draft.
    await setSetting("crm.contract_billing_mode", "hourly");
    const c4 = await contracts.create({
      partnerId,
      projectId: case01Id,
      title: C4_TITLE,
      titleAr: null,
      scope: null,
      feeModel: "HOURLY",
      startDate: "2026-03-01",
      endDate: "2026-04-30",
      monthlyAmount: null,
      feeItemId: FEE_HR,
      milestones: null,
      currencyCode: null,
      note: null,
      noteAr: null,
      actorId: R_ACTOR,
    });
    const c4Active = await contracts.activate(c4.contract.id, R_ACTOR);
    await crmStore.insertTimeEntry({
      entryDate: "2026-04-03",
      hours: "2.000000",
      feeItemId: FEE_HR,
      projectId: case01Id,
      contractId: c4Active.contract.id,
      feeEarnerUserId: R_ACTOR,
      unitRate: "250.000000",
      narrative: "Drafting",
      billable: true,
      actorId: R_ACTOR,
    });
    await crmStore.insertTimeEntry({
      entryDate: "2026-04-10",
      hours: "1.500000",
      feeItemId: FEE_HR,
      projectId: case01Id,
      contractId: c4Active.contract.id,
      feeEarnerUserId: R_ACTOR,
      unitRate: "250.000000",
      narrative: null,
      billable: true,
      actorId: R_ACTOR,
    });
    await crmStore.insertTimeEntry({
      entryDate: "2026-03-28",
      hours: "3.000000",
      feeItemId: FEE_HR,
      projectId: case01Id,
      contractId: c4Active.contract.id,
      feeEarnerUserId: R_ACTOR,
      unitRate: "250.000000",
      narrative: "Research",
      billable: true,
      actorId: R_ACTOR,
    });
    await crmStore.approveWeekTimeEntries("2026-03-23", "2026-03-29");
    await crmStore.approveWeekTimeEntries("2026-03-30", "2026-04-05");
    await crmStore.approveWeekTimeEntries("2026-04-06", "2026-04-12");
    {
      const march = await billingRuns.run({ asOf: "2026-04-15", actorId: R_ACTOR });
      expect(march.draftsCreated).toHaveLength(1); // 3.0 h Research → 750 net
      const april = await billingRuns.run({ asOf: "2026-04-30", actorId: R_ACTOR });
      expect(april.draftsCreated).toHaveLength(1); // 2.0 h Drafting → 500 net
      expect(april.needsNarrative).toHaveLength(1); // the narrative-less slip, skipped
    }
    await setSetting("crm.contract_billing_mode", "retainer_or_milestones");

    // 3. C1 the retainer chain: run asOf 2026-02-01 → Jan+Feb drafts; the
    //    JANUARY draft is approved+posted (J-INV), FEBRUARY stays DRAFT.
    const c1 = await contracts.create({
      partnerId,
      projectId: case01Id,
      title: C1_TITLE,
      titleAr: null,
      scope: "Monthly legal counsel",
      feeModel: "RETAINER",
      startDate: "2026-01-15",
      endDate: "2026-06-14",
      monthlyAmount: "1000",
      feeItemId: FEE_RET,
      milestones: null,
      currencyCode: null,
      note: null,
      noteAr: null,
      actorId: R_ACTOR,
    });
    const c1Active = await contracts.activate(c1.contract.id, R_ACTOR);
    {
      const run = await billingRuns.run({ asOf: "2026-02-01", actorId: R_ACTOR });
      expect(run.draftsCreated.map((draft) => draft.periodKey)).toEqual(["2026-01", "2026-02"]);
    }
    // Post the JANUARY draft only (February stays DRAFT): the run's guard
    // rows locate the invoice id; approve+post is the ordinary chain.
    const c1Guards = await crmStore.listContractInvoices({
      contractId: c1Active.contract.id,
      limit: 10,
    });
    const c1JanInvoiceId = assertDefined(
      c1Guards.find((row) => row.periodKey === "2026-01"),
      "C1 January guard",
    ).invoiceId;
    await salesInvoices.approve(c1JanInvoiceId, R_ACTOR, false);
    await salesInvoices.post(c1JanInvoiceId, R_ACTOR);

    // 4. C2 the deferral chain: the §15 receipt (500 on-account 2025-12-15),
    //    tagged with the deferral policy ON (J-DEF), then the FEBRUARY draft
    //    posted → J-INV2 + J-REL (invoice open 650).
    const c2 = await contracts.create({
      partnerId,
      projectId: case01Id,
      title: C2_TITLE,
      titleAr: null,
      scope: null,
      feeModel: "RETAINER",
      startDate: "2026-01-15",
      endDate: "2026-02-14",
      monthlyAmount: "1000",
      feeItemId: FEE_RET,
      milestones: null,
      currencyCode: null,
      note: null,
      noteAr: null,
      actorId: R_ACTOR,
    });
    const c2Active = await contracts.activate(c2.contract.id, R_ACTOR);
    const receipt = await receipts.create({
      cashAccountId: CASH_ACCOUNT,
      partnerId,
      method: "CASH",
      payerName: "Client P-000001",
      currencyCode: "SAR",
      amount: "500",
      exchangeRate: null,
      valueDate: "2025-12-15",
      reference: null,
      description: "R19 advance receipt (on-account)",
      descriptionAr: null,
      actorId: R_ACTOR,
    });
    await receipts.post(receipt.id, R_ACTOR);
    await setSetting("crm.defer_advance_recognition", true);
    const advance = await contracts.tagAdvance({
      contractId: c2Active.contract.id,
      receiptId: receipt.id,
      amount: "500",
      note: "R19 advance tag",
      noteAr: null,
      actorId: R_ACTOR,
    });
    expect(advance.deferJournalId).not.toBeNull(); // J-DEF posted

    {
      const run = await billingRuns.run({ asOf: "2026-02-01", actorId: R_ACTOR });
      const c2Drafts = run.draftsCreated.filter((draft) => draft.contractId === c2Active.contract.id);
      expect(c2Drafts.map((draft) => draft.periodKey)).toEqual(["2026-01", "2026-02"]);
    }
    // Post FEBRUARY only (January stays DRAFT): the release fires at the post.
    const c2Guards = await crmStore.listContractInvoices({
      contractId: c2Active.contract.id,
      limit: 10,
    });
    const c2FebInvoiceId = assertDefined(
      c2Guards.find((row) => row.periodKey === "2026-02"),
      "C2 February guard",
    ).invoiceId;
    await salesInvoices.approve(c2FebInvoiceId, R_ACTOR, false);
    await salesInvoices.post(c2FebInvoiceId, R_ACTOR);

    const released = await crmStore.findContractAdvanceById(advance.id);
    return {
      partnerId,
      case01Id,
      c1Id: c1Active.contract.id,
      c1No: assertDefined(c1Active.contract.contractNo, "C1 no"),
      c2Id: c2Active.contract.id,
      c2No: assertDefined(c2Active.contract.contractNo, "C2 no"),
      c3Id: c3Active.contract.id,
      c3No: assertDefined(c3Active.contract.contractNo, "C3 no"),
      c4Id: c4Active.contract.id,
      c4No: assertDefined(c4Active.contract.contractNo, "C4 no"),
      c1JanInvoiceId,
      c2FebInvoiceId,
      advanceId: advance.id,
      jDefId: advance.deferJournalId,
      jRelId: released?.releasedJournalId ?? null,
    };
  });

  return fixture;
}

function runReport(
  reportKey: string,
  params: Record<string, unknown>,
): Promise<{ runId: string; result?: ReportResult; status: string }> {
  return withTenant(TENANT_R19, () =>
    newRunService().run({ reportKey, params, ctx: fullContext(TENANT_R19) }),
  );
}

beforeAll(async () => {
  await setupR19Fixture();
});

// -- the §15 book sanity (the journals the reports reconcile over) ----------------

describe("the R19 book (the §15 chains, journal-pinned)", () => {
  it("C1 January posted (J-INV) and C2 February posted with the advance chain (J-RCP → J-DEF → J-INV2 + J-REL, open 650)", async () => {
    const fx = await setupR19Fixture();

    // J-INV: DR AR 1150 (partner+project) · CR SERVICE_REVENUE 1000 · CR VAT 150.
    const jan = await withTenant(TENANT_R19, () => salesInvoices.find(fx.c1JanInvoiceId));
    expect(jan.status).toBe("POSTED");
    expect(jan.totalNet).toBe("1000.0000");
    expect(jan.totalGross).toBe("1150.0000");
    const janLines = await withTenant(TENANT_R19, () => journal.listLines(jan.postedJournalId!));
    expect(janLines.map((l) => `${l.accountCode}:${l.direction}:${l.amount}`)).toEqual([
      "1130:DEBIT:1150.0000",
      "4200:CREDIT:1000.0000",
      "2120:CREDIT:150.0000",
    ]);

    // The deferral chain: J-DEF exists (the tag), J-REL exists (the release),
    // and the February invoice's open item is 1150 − 500 = 650.
    expect(fx.jDefId).not.toBeNull();
    expect(fx.jRelId).not.toBeNull();
    const openItem = await withTenant(TENANT_R19, () =>
      crmStore.findInvoiceArOpenItem(fx.c2FebInvoiceId),
    );
    expect(openItem).toBeDefined();
    expect(openItem!.settledAmount).toBe("500.0000");
    expect(openItem!.outstanding).toBe("650.0000");

    // The grids: C1 6 entries (Jan+Feb INVOICED, Mar..Jun PLANNED); C4's
    // HOURLY rows carry NULL amounts (the operational labeling).
    const c1Grid = await withTenant(TENANT_R19, () => contracts.listSchedule(fx.c1Id));
    expect(c1Grid.map((row) => `${row.periodKey}:${row.status}`)).toEqual([
      "2026-01:INVOICED",
      "2026-02:INVOICED",
      "2026-03:PLANNED",
      "2026-04:PLANNED",
      "2026-05:PLANNED",
      "2026-06:PLANNED",
    ]);
    const c4Grid = await withTenant(TENANT_R19, () => contracts.listSchedule(fx.c4Id));
    expect(c4Grid.map((row) => `${row.periodKey}:${row.amount}`)).toEqual([
      "2026-03:null",
      "2026-04:null",
    ]);
  });
});

// -- services.contract_revenue_schedule ---------------------------------------------

describe("services.contract_revenue_schedule (PHASE-019 T49; GL tie + reconciliation + overdue)", () => {
  const WINDOW = { dateFrom: "2026-01-01", dateTo: "2026-06-30", asOf: "2026-06-30", locale: "en" };

  it("lays out the §15 chains: contracted / invoiced / draft / backlog per contract × period, GL tie exact", async () => {
    const fx = await setupR19Fixture();
    const outcome = await runReport("services.contract_revenue_schedule", WINDOW);
    expect(outcome.status).toBe("SUCCEEDED");
    const result = outcome.result!;
    expect(result.reportId).toBe("services.contract_revenue_schedule");

    // 12 rows: C3 2 milestones + C4 2 hourly periods + C1 6 retainer periods
    // + C2 2 retainer periods (ordered by contractNo then billDate).
    expect(result.rows).toHaveLength(12);
    const byKey = (contractNo: string, key: string) =>
      result.rows.find(
        (row) =>
          row.values.contractNo === contractNo &&
          (row.values.periodKey === key || row.values.milestoneLabel === key),
      );

    // -- C1 the retainer chain (6×1000; January posted, February draft) ----
    const c1Jan = byKey(fx.c1No, "2026-01")!;
    expect(c1Jan.values).toMatchObject({
      partnerName: "Gulf Advisory Group",
      partnerNameAr: "مجموعة الخليج للاستشارات",
      projectCode: "CASE-01",
      entryType: "RETAINER_PERIOD",
      entryStatus: "INVOICED",
      contracted: "1000.0000",
      invoicedNet: "1000.0000",
      invoicedVat: "150.0000",
      invoicedGross: "1150.0000",
      draftNet: "0.0000",
      backlog: "0.0000",
      overdue: "1150.0000", // due 2026-02-14 < asOf, open, unallocated
    });
    const c1Feb = byKey(fx.c1No, "2026-02")!;
    expect(c1Feb.values).toMatchObject({
      entryStatus: "INVOICED",
      contracted: "1000.0000",
      invoicedNet: "0.0000",
      draftNet: "1000.0000",
      backlog: "0.0000",
      overdue: "0.0000",
    });
    for (const period of ["2026-03", "2026-04", "2026-05", "2026-06"]) {
      const row = byKey(fx.c1No, period)!;
      expect(row.values).toMatchObject({
        entryStatus: "PLANNED",
        contracted: "1000.0000",
        invoicedNet: "0.0000",
        draftNet: "0.0000",
        backlog: "1000.0000",
        overdue: "0.0000",
      });
    }

    // -- C2 the deferral chain (February posted with the 500 release) ------
    const c2Jan = byKey(fx.c2No, "2026-01")!;
    expect(c2Jan.values).toMatchObject({
      contracted: "1000.0000",
      invoicedNet: "0.0000",
      draftNet: "1000.0000",
      backlog: "0.0000",
    });
    const c2Feb = byKey(fx.c2No, "2026-02")!;
    expect(c2Feb.values).toMatchObject({
      contracted: "1000.0000",
      invoicedNet: "1000.0000",
      invoicedGross: "1150.0000",
      draftNet: "0.0000",
      backlog: "0.0000",
      overdue: "650.0000", // 1150 gross − 500 released (the J-REL allocation)
    });

    // -- C3 the milestone chain (Signing drafted, Delivery planned) --------
    const signing = byKey(fx.c3No, "Signing")!;
    expect(signing.values).toMatchObject({
      entryType: "MILESTONE",
      periodKey: null,
      milestoneLabel: "Signing",
      contracted: "5000.0000",
      invoicedNet: "0.0000",
      draftNet: "5000.0000",
      backlog: "0.0000",
      overdue: "0.0000",
    });
    const delivery = byKey(fx.c3No, "Delivery")!;
    expect(delivery.values).toMatchObject({
      contracted: "7000.0000",
      invoicedNet: "0.0000",
      draftNet: "0.0000",
      backlog: "7000.0000",
    });

    // -- C4 the hourly chain (operational rows: contracted/backlog NULL) ---
    const march = byKey(fx.c4No, "2026-03")!;
    expect(march.values).toMatchObject({
      entryType: "HOURLY_PERIOD",
      contracted: null,
      invoicedNet: "0.0000",
      draftNet: "750.0000", // 3.0 h × 250
      backlog: null,
    });
    const april = byKey(fx.c4No, "2026-04")!;
    expect(april.values).toMatchObject({
      contracted: null,
      draftNet: "500.0000", // 2.0 h × 250 (the narrative-less slip skipped)
      backlog: null,
    });

    // Totals: contracted 6000 + 2000 + 12000; invoiced net 2000; drafts
    // 1000 + 1000 + 5000 + 750 + 500; backlog 4000 + 7000; overdue 1800.
    const totals = new Map(result.totals.map((total) => [total.id, total.amount]));
    expect(totals.get("contractedTotal")).toBe("20000.0000");
    expect(totals.get("invoicedNetTotal")).toBe("2000.0000");
    expect(totals.get("draftNetTotal")).toBe("8250.0000");
    expect(totals.get("backlogTotal")).toBe("11000.0000");
    expect(totals.get("overdueTotal")).toBe("1800.0000");

    // The GL tie: Σ invoiced net == Σ revenue credits of the two posted
    // journals, tolerance 0 (assertExact).
    const tie = result.assertions.find((a) => a.id === "contract-revenue-gl-tie")!;
    expect(tie.status).toBe("PASS");
    expect(tie.compared).toEqual({ left: "2000.0000", right: "2000.0000" });

    // The reconciliation invariant: per contract (where contracted defined)
    // Σ contracted == Σ invoiced + Σ draft + Σ backlog — PASS both as the
    // report's assertion AND as independent spec-side math over the rows.
    const reconciliation = result.assertions.find((a) => a.id === "schedule-reconciliation")!;
    expect(reconciliation.status).toBe("PASS");
    expect(reconciliation.compared).toEqual({ left: "20000.0000", right: "20000.0000" });
    const perContract = new Map<string, { c: number; i: number; d: number; b: number }>();
    for (const row of result.rows) {
      if (row.values.contracted === null) continue;
      const bucket = perContract.get(String(row.values.contractNo)) ?? { c: 0, i: 0, d: 0, b: 0 };
      bucket.c += Number(row.values.contracted);
      bucket.i += Number(row.values.invoicedNet);
      bucket.d += Number(row.values.draftNet);
      bucket.b += Number(row.values.backlog ?? 0);
      perContract.set(String(row.values.contractNo), bucket);
    }
    expect(perContract.size).toBe(3); // C1 + C2 + C3 (C4 HOURLY excluded)
    for (const [no, bucket] of perContract) {
      expect(`${no}: ${bucket.c} == ${bucket.i + bucket.d + bucket.b}`).toBe(
        `${no}: ${bucket.c} == ${bucket.c}`,
      );
    }
  });

  it("the overdue buckets match the AR open-item computation for the same asOf (BR-028 formula)", async () => {
    const fx = await setupR19Fixture();
    const asOf = "2026-06-30";
    const outcome = await runReport("services.contract_revenue_schedule", {
      dateFrom: "2026-01-01",
      dateTo: "2026-06-30",
      asOf,
      locale: "en",
    });
    expect(outcome.status).toBe("SUCCEEDED");
    const reportOverdue = new Map(
      outcome.result!.totals.map((total) => [total.id, total.amount]),
    ).get("overdueTotal");

    // The independent read: the sales store's open-items surface (the same
    // substrate ar.aging buckets), filtered to the posted contract invoices
    // past due at asOf.
    const items = await withTenant(TENANT_R19, () =>
      salesStore.arOpenItemsAsOf({ asOf, openOnly: true, limit: 10000 }),
    );
    const contractInvoiceIds = new Set([fx.c1JanInvoiceId, fx.c2FebInvoiceId]);
    let expected = "0.0000";
    const { addExact } = await import("../../modules/accounting/application/decimal-strings");
    for (const item of items) {
      const isContractInvoice =
        item.sourceType === "sales_invoice" &&
        item.sourceId !== null &&
        contractInvoiceIds.has(item.sourceId);
      const pastDue = item.dueDate !== null && item.dueDate < asOf;
      if (isContractInvoice && pastDue) {
        expected = addExact(expected, item.outstanding);
      }
    }
    expect(expected).toBe("1800.0000");
    expect(reportOverdue).toBe(expected);

    // The J-DEF reclass debit row (T47 deviation 9) stays an open item on
    // the aging surface — visible at an asOf after its posting date (the
    // §15 tag happens "today") but NEVER netted into this report's overdue
    // (it is not a contract-invoice row; the documented netting decision).
    // At the report's asOf 2026-06-30 it is honestly absent — it postdates
    // the as-of (the open-items surface is as-of-correct).
    expect(items.filter((item) => item.sourceType === "contract_advance")).toHaveLength(0);
    expect(items.some((item) => item.sourceId === fx.c1JanInvoiceId)).toBe(true);
    expect(items.some((item) => item.sourceId === fx.c2FebInvoiceId)).toBe(true);
    const today = new Date().toISOString().slice(0, 10);
    const itemsNow = await withTenant(TENANT_R19, () =>
      salesStore.arOpenItemsAsOf({ asOf: today, openOnly: true, limit: 10000 }),
    );
    const jdefNow = itemsNow.find((item) => item.sourceType === "contract_advance");
    expect(jdefNow?.outstanding).toBe("500.0000"); // the advance-held exposure on the aging surface
    expect(itemsNow.filter((item) => item.sourceType === "sales_invoice")).toHaveLength(2);
  });

  it("BR-028 determinism: two recomputed runs at the same asOf are byte-identical", async () => {
    const first = (await runReport("services.contract_revenue_schedule", WINDOW)).result!;
    const second = (await runReport("services.contract_revenue_schedule", WINDOW)).result!;
    expect(JSON.stringify(second.rows)).toBe(JSON.stringify(first.rows));
    expect(JSON.stringify(second.totals)).toBe(JSON.stringify(first.totals));
    expect(JSON.stringify(second.assertions)).toBe(JSON.stringify(first.assertions));
  });

  it("the contractId filter scopes the rows to the one contract", async () => {
    const fx = await setupR19Fixture();
    const outcome = await runReport("services.contract_revenue_schedule", {
      ...WINDOW,
      contractId: fx.c1Id,
    });
    expect(outcome.status).toBe("SUCCEEDED");
    const result = outcome.result!;
    expect(result.rows).toHaveLength(6);
    expect(result.rows.every((row) => row.values.contractNo === fx.c1No)).toBe(true);
    const totals = new Map(result.totals.map((total) => [total.id, total.amount]));
    expect(totals.get("contractedTotal")).toBe("6000.0000");
    expect(totals.get("invoicedNetTotal")).toBe("1000.0000");
    const tie = result.assertions.find((a) => a.id === "contract-revenue-gl-tie")!;
    expect(tie.compared).toEqual({ left: "1000.0000", right: "1000.0000" });
  });

  it("an empty window is honestly empty (zero rows, zero tie)", async () => {
    const outcome = await runReport("services.contract_revenue_schedule", {
      dateFrom: "2025-01-01",
      dateTo: "2025-01-31",
      asOf: "2025-01-31",
      locale: "en",
    });
    expect(outcome.status).toBe("SUCCEEDED");
    expect(outcome.result!.rows).toHaveLength(0);
    const tie = outcome.result!.assertions.find((a) => a.id === "contract-revenue-gl-tie")!;
    expect(tie.status).toBe("PASS");
    expect(tie.compared).toEqual({ left: "0.0000", right: "0.0000" });
  });
});

// -- services.time_billing_summary --------------------------------------------------

describe("services.time_billing_summary (PHASE-019 T49; the operational hours surface)", () => {
  it("aggregates the §15 slips per project × fee-earner: recorded vs billable vs invoiced, amounts = hours × snapshotted rate", async () => {
    const fx = await setupR19Fixture();
    const outcome = await runReport("services.time_billing_summary", {
      dateFrom: "2026-01-01",
      dateTo: "2026-06-30",
      locale: "en",
    });
    expect(outcome.status).toBe("SUCCEEDED");
    const result = outcome.result!;

    // One row: CASE-01 × the fee earner (all three slips, one project).
    expect(result.rows).toHaveLength(1);
    const row = result.rows[0]!;
    expect(row.values).toMatchObject({
      projectCode: "CASE-01",
      projectName: "Advisory case 1",
      feeEarnerName: "Reporting Actor",
      recordedHours: "6.500000", // 3.0 + 2.0 + 1.5 (non-VOID)
      billableHours: "6.500000", // every slip billable
      invoicedHours: "5.000000", // Research + Drafting BILLED; narrative-less unbilled
      recordedAmount: "1625.0000", // 6.5 × 250
      billableAmount: "1625.0000",
      invoicedAmount: "1250.0000", // 5.0 × 250
      entryCount: 3,
    });

    const totals = new Map(result.totals.map((total) => [total.id, total.amount]));
    expect(totals.get("recordedHoursTotal")).toBe("6.500000");
    expect(totals.get("billableHoursTotal")).toBe("6.500000");
    expect(totals.get("invoicedHoursTotal")).toBe("5.000000");
    expect(totals.get("recordedAmountTotal")).toBe("1625.0000");
    expect(totals.get("billableAmountTotal")).toBe("1625.0000");
    expect(totals.get("invoicedAmountTotal")).toBe("1250.0000");

    // Operational — README rule 2 (no GL assertion) + the labeling note.
    expect(result.assertions).toHaveLength(0);
    expect(result.notes?.some((note) => note.en.includes("Operational report"))).toBe(true);

    // The projectId filter scopes to the same single row.
    const scoped = await runReport("services.time_billing_summary", {
      dateFrom: "2026-01-01",
      dateTo: "2026-06-30",
      projectId: fx.case01Id,
      locale: "en",
    });
    expect(scoped.status).toBe("SUCCEEDED");
    expect(scoped.result!.rows).toHaveLength(1);
  });

  it("a window before the slips is honestly empty", async () => {
    const outcome = await runReport("services.time_billing_summary", {
      dateFrom: "2026-01-01",
      dateTo: "2026-02-28",
      locale: "en",
    });
    expect(outcome.status).toBe("SUCCEEDED");
    expect(outcome.result!.rows).toHaveLength(0);
  });
});

// -- registry integration + permission gating ---------------------------------------

describe("registry integration + permission gating (the shared contract)", () => {
  it("the two PHASE-019 keys are registered with the industry category and the 0027 permission", async () => {
    const snapshot = newRunService().contracts();
    const expected: [string, string][] = [
      ["services.contract_revenue_schedule", "crm.contracts.manage"],
      ["services.time_billing_summary", "crm.contracts.manage"],
    ];
    for (const [id, permission] of expected) {
      const contract = snapshot.find((c) => c.id === id);
      expect(contract, id).toBeDefined();
      expect(contract!.category).toBe("industry");
      expect(contract!.requiredPermission).toBe(permission);
      expect(contract!.executionClass).toBe("inline");
      expect(ALL_KNOWN_PERMISSIONS.has(permission), permission).toBe(true);
    }
    expect(snapshot).toHaveLength(81); // PHASE-028: +2 budgeting; PHASE-029: +3 payroll contracts
  });

  it("a session without crm.contracts.manage cannot run either report (PermissionDeniedError, before params bind)", async () => {
    const deniedCtx = fullContext(TENANT_R19, {
      permissions: new Set(["reporting.reports.run"]),
    });
    await expect(
      withTenant(TENANT_R19, () =>
        newRunService().run({
          reportKey: "services.contract_revenue_schedule",
          params: { dateFrom: "2026-01-01", dateTo: "2026-06-30", locale: "en" },
          ctx: deniedCtx,
        }),
      ),
    ).rejects.toThrowError(PermissionDeniedError);
    await expect(
      withTenant(TENANT_R19, () =>
        newRunService().run({
          reportKey: "services.time_billing_summary",
          params: { dateFrom: "2026-01-01", dateTo: "2026-06-30", locale: "en" },
          ctx: deniedCtx,
        }),
      ),
    ).rejects.toThrowError(PermissionDeniedError);
    // The grant itself unlocks the run (the same context + the key passes).
    const allowed = await withTenant(TENANT_R19, () =>
      newRunService().run({
        reportKey: "services.time_billing_summary",
        params: { dateFrom: "2026-01-01", dateTo: "2026-06-30", locale: "en" },
        ctx: fullContext(TENANT_R19, {
          permissions: new Set(["crm.contracts.manage"]),
        }),
      }),
    );
    expect(allowed.status).toBe("SUCCEEDED");
  });

  it("exports flow through the shared contract (CSV renderer over the stored envelope)", async () => {
    const { renderCsv } = await import("../../modules/reporting/application/export/csv");
    const outcome = await runReport("services.contract_revenue_schedule", {
      dateFrom: "2026-01-01",
      dateTo: "2026-06-30",
      asOf: "2026-06-30",
      locale: "en",
    });
    const csv = renderCsv(outcome.result!).toString("utf8");
    expect(csv).toContain("CT-2026-");
    expect(csv).toContain("2000.0000");
    expect(csv).toContain("contract-revenue-gl-tie,PASS");
    expect(csv).toContain("schedule-reconciliation,PASS");
  });
});
