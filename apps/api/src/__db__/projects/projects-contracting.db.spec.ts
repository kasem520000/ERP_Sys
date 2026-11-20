import { beforeAll, describe, expect, it } from "vitest";
import { sql } from "drizzle-orm";

import { requireTenantContext, withTenant } from "../../infra/db/tenant-context";
import {
  BillingCeilingExceededError,
  ProgressCertificateStateError,
  RetentionInputInvalidError,
  RetentionRegisterExistsError,
  RetentionRegisterImmutableError,
  RetentionRegisterMissingError,
  RetentionReleaseGateError,
  RetentionStateError,
  SubcontractCertificateAlreadyApprovedError,
  SubcontractStateError,
  ContractingInputInvalidError,
} from "../../modules/crm/domain/projects-errors";
import { ChangeOrderService } from "../../modules/crm/application/change-order-service";
import { ProgressBillingService } from "../../modules/crm/application/progress-billing-service";
import { RetentionService } from "../../modules/crm/application/retention-service";
import { SubcontractService } from "../../modules/crm/application/subcontract-service";
import { AuditService } from "../../modules/audit/api/audit";
import { DrizzleAuditStore } from "../../modules/audit/infrastructure/drizzle-audit.store";
import { NumberingService } from "../../modules/accounting/application/numbering-service";
import { PostingService } from "../../modules/accounting/application/posting-service";
import { PartnerSubledgerService } from "../../modules/partners/application/subledger-service";
import {
  actuals,
  ensureP1BudgetWorld,
  ensurePjwAccount,
  ensureProjectByCode,
  mapPjwPurpose,
  PJW_ACTOR,
  pjw,
  seedRetentionCustomer,
  TENANT_PJW,
} from "./fixtures";

/**
 * PHASE-048 (W-11 — T-10 + T-11 + T-12) — the contracting core pinned
 * over real PostgreSQL 16 (the plan §4's `projects-contracting.db.spec`
 * — acceptance #6's posting arms + #7): the subcontracting lifecycle +
 * THE AP LINKAGE + G-55's sub-side hold (D-08), the retention ledger +
 * the register + G-56's release (D-09), and the progress-certificate
 * billing — BR-092's engine-derived retention, BR-093's ceiling typed
 * refusal, G-57 + the generated-in-transaction invoice, and the
 * advance amortization (the G-33 mirror) (D-10).
 *
 * THE DEDICATED WORLD (CT "PJW-PRJ-CT"): the CUSTOMER register
 * (150,000.0000 SAR · hold 10% · the customer PJW-CUST-1) + the sub
 * agreement SA-1 (50,000 · retention 10% · the fixture's supplier):
 *   SA-1/C-1  gross 10,000 → retention 1,000 · net 9,000  (the AP
 *              linkage: DR 5140 9,000 project-stamped · CR 2110 9,000
 *              partner — INV-033's collector-vs-dimension pin; the
 *              hold: DR 5140 1,000 UNPROJECTED · CR 2160 1,000)
 *   PC-1 PROGRESS  gross 25,000 → 2,500/22,500 (G-57: DR 1130 22,500
 *              partner · DR 1155 2,500 · CR 4210 25,000 + the invoice)
 *   PC-2 ADVANCE   gross 15,000 → 0/15,000  (DR 1130 15,000 · CR 2170
 *              15,000 + the invoice at 15,000)
 *   PC-3 PROGRESS  gross 10,000 → 1,000/9,000  (the amortization: the
 *              advance absorbs the FULL net 9,000 — DR 2170 · CR 1130)
 *   PC-4 PROGRESS  gross  8,000 → 800/7,200   (the exhausted advance:
 *              applies only the remaining 6,000, unapplied 1,200)
 *   PC-5 PROGRESS  gross 105,000 → the BR-093 refusal (cumulative
 *              58,000 + 105,000 = 163,000 > 150,000, overage 13,000)
 *              → the change order CO-CT +20,000 through the REAL gate
 *              → the ceiling 170,000 → approved at 163,000.
 * The register's accrued retention: 2,500 + 1,000 + 800 + 800 = 5,100
 * (G-56's customer release); the sub row's: 1,000 (G-56's sub release).
 */

const audit = new AuditService(new DrizzleAuditStore());
const posting = new PostingService(audit, new PartnerSubledgerService());
const numbering = new NumberingService(audit);
const changeOrders = new ChangeOrderService(audit, posting);
const subcontracts = new SubcontractService(audit, posting, actuals);
const retention = new RetentionService(audit, posting, actuals);
const billing = new ProgressBillingService(audit, posting, numbering, actuals, changeOrders);

let ctProjectId = "";
let rawProjectId = "";
let customerId = "";
let retentionCostAccountId = "";
let subRetentionAccountId = "";
let contractRetentionAccountId = "";
let contractRevenueAccountId = "";
let customerAdvanceAccountId = "";
let agreementId = "";
let subRetentionRowId = "";
let customerRegisterId = "";

beforeAll(async () => {
  await ensureP1BudgetWorld();
  ctProjectId = await ensureProjectByCode("PJW-PRJ-CT", "The contracting world project");
  rawProjectId = await ensureProjectByCode("PJW-PRJ-RAW", "The raw register project");

  // The five W-11 purpose homes (the 0077 parenting precedent — new
  // leaves under existing groups; the MAPPINGS land inside arm (b),
  // AFTER the unmapped-refusal proof).
  retentionCostAccountId = await ensurePjwAccount({
    code: "5140",
    name: "Subcontracted works cost",
    nameAr: "تكلفة أعمال الباطن",
    type: "EXPENSE",
    parentCode: "5000",
  });
  subRetentionAccountId = await ensurePjwAccount({
    code: "2160",
    name: "Subcontractor retention payable",
    nameAr: "استقطاعات مقاولي الباطن المستحقة",
    type: "LIABILITY",
    parentCode: "2100",
  });
  contractRetentionAccountId = await ensurePjwAccount({
    code: "1155",
    name: "Contract retention receivable",
    nameAr: "مستحقات الاستقطاع التعاقدي",
    type: "ASSET",
    parentCode: "1100",
  });
  contractRevenueAccountId = await ensurePjwAccount({
    code: "4210",
    name: "Contract progress revenue",
    nameAr: "إيرادات المستخلصات التعاقدية",
    type: "REVENUE",
    parentCode: "4000",
  });
  customerAdvanceAccountId = await ensurePjwAccount({
    code: "2170",
    name: "Customer advances",
    nameAr: "الدفعات المقدمة من العملاء",
    type: "LIABILITY",
    parentCode: "2100",
  });

  // The contract's CUSTOMER (the register binds it — the G-57 AR stamp
  // + the invoice's customer).
  await withTenant(TENANT_PJW, async () => {
    const partnersStore = await import("../../modules/partners/infrastructure/partners.store");
    const existing = await partnersStore.findPartnerByCode("PJW-CUST-1");
    customerId =
      existing?.id ??
      (
        await partnersStore.insertPartner({
          kind: "CUSTOMER",
          code: "PJW-CUST-1",
          name: "The Contracting Customer (PJW)",
          nameAr: "عميل المقاولات",
          taxNumber: null,
          creditLimit: null,
          creditTermsId: null,
          priceListId: null,
        })
      ).id;
  });

  // The RAW project's register (the pre-W-11 shape — no customer, the
  // seed helper's own row): the missing-customer law's world.
  await seedRetentionCustomer({
    projectId: rawProjectId,
    contractValue: "50000.0000",
    currencyCode: "SAR",
    holdPercent: "5.00",
  });
});

/** The journal lines a source-keyed entry posted (direction + account
 * code + the project stamp, by the INV-013 source key). */
async function linesBySource(
  docType: string,
  docId: string,
  operation: string,
): Promise<
  ReadonlyArray<{ direction: string; code: string; amount: string; projectId: string | null }>
> {
  const rows = await requireTenantContext().tx!.execute<{
    direction: string;
    code: string;
    amount: string;
    projectId: string | null;
  }>(sql`
    SELECT jl.direction, a.code, jl.base_amount::text AS amount, jl.project_id::text AS "projectId"
    FROM journal_lines jl
    JOIN journal_entries je ON je.id = jl.journal_entry_id
    JOIN accounts a ON a.id = jl.account_id
    WHERE je.source_type = ${docType} AND je.source_id = ${docId}
      AND je.operation = ${operation}
    ORDER BY jl.line_no
  `);
  return rows.rows;
}

describe("PHASE-048 W-11 — the contracting core (T-10 + T-11 + T-12)", () => {
  let subCertificateId = "";

  it("(a) THE SUB LIFECYCLE + THE LEDGER ROW: DRAFT → ACTIVE opens the agreement's SUBCONTRACTOR retention row (the SAME ledger — D-08)", async () => {
    await withTenant(TENANT_PJW, async () => {
      const fixture = pjw();
      const created = await subcontracts.createAgreement({
        projectId: ctProjectId,
        partnerId: fixture.supplierPartnerId,
        agreementNo: "SA-1",
        title: "The earthworks package",
        titleAr: "حزمة الأعمال الترابية",
        scope: "Excavation and backfilling",
        agreementValue: "50000.0000",
        currencyCode: "SAR",
        retentionPercent: "10.00",
        startDate: "2026-01-01",
        endDate: "2026-12-31",
        note: null,
        noteAr: null,
        actorId: PJW_ACTOR,
      });
      expect(created.status).toBe("DRAFT");
      agreementId = created.id;
      // A DRAFT agreement cannot close (the ladder).
      await expect(subcontracts.closeAgreement(agreementId, PJW_ACTOR)).rejects.toBeInstanceOf(
        SubcontractStateError,
      );
      const activated = await subcontracts.activateAgreement(agreementId, PJW_ACTOR);
      expect(activated.agreement.status).toBe("ACTIVE");
      expect(activated.agreement.activatedAt).not.toBeNull();
      // The SUBCONTRACTOR retention row — the SAME ledger, one per
      // agreement (the 0103 side law: the commercial columns NULL, the
      // terms read from the agreement).
      const row = activated.agreement;
      void row;
      const ledgerRows = await retention.ledger(ctProjectId);
      const subRow = ledgerRows.find((r) => r.kind === "SUBCONTRACTOR" && r.subcontractorAgreementId === agreementId);
      expect(subRow).toBeDefined();
      expect(subRow!.contractValue).toBeNull();
      expect(subRow!.holdPercent).toBeNull();
      expect(subRow!.accruedBalance).toBe("0.0000");
      subRetentionRowId = subRow!.id;
      // The re-activation is the CAS refusal.
      await expect(subcontracts.activateAgreement(agreementId, PJW_ACTOR)).rejects.toBeInstanceOf(
        SubcontractStateError,
      );
    });
    // The duplicate agreement_no is the 23505 arm — its OWN transaction
    // (the W-9 SQL-error lesson: a failed query poisons the ambient tx;
    // the refusal rides a fresh one).
    await expect(
      withTenant(TENANT_PJW, () =>
        subcontracts.createAgreement({
          projectId: ctProjectId,
          partnerId: pjw().supplierPartnerId,
          agreementNo: "SA-1",
          title: "Duplicate",
          titleAr: null,
          scope: null,
          agreementValue: "1000.0000",
          currencyCode: "SAR",
          retentionPercent: "10.00",
          startDate: null,
          endDate: null,
          note: null,
          noteAr: null,
          actorId: PJW_ACTOR,
        }),
      ),
    ).rejects.toBeInstanceOf(ContractingInputInvalidError);
    // A CUSTOMER partner cannot be a subcontractor (its own tx — the
    // poisoned-tx law above).
    await expect(
      withTenant(TENANT_PJW, () =>
        subcontracts.createAgreement({
          projectId: ctProjectId,
          partnerId: customerId,
          agreementNo: "SA-X",
          title: "Not a supplier",
          titleAr: null,
          scope: null,
          agreementValue: "1000.0000",
          currencyCode: "SAR",
          retentionPercent: "10.00",
          startDate: null,
          endDate: null,
          note: null,
          noteAr: null,
          actorId: PJW_ACTOR,
        }),
      ),
    ).rejects.toBeInstanceOf(ContractingInputInvalidError);
  });

  it("(b) THE SUB CERTIFICATE: the unmapped pair refuses AND rolls back; the mappings land; the approval drives the AP linkage + G-55's hold — and the APPROVED EXTRACT IS THE SOLE ACTUALS SOURCE (INV-033 green: the collector's net = the GL dimension)", async () => {
    await withTenant(TENANT_PJW, async () => {
      // The authoring: BR-092 PER AGREEMENT — the pair DERIVED from the
      // agreement's own 10% (the caller supplied the gross only).
      const certificate = await subcontracts.createCertificate({
        agreementId,
        certificateNo: "C-1",
        certificateDate: "2026-03-01",
        progressPercent: "20.00",
        grossValue: "10000.0000",
        note: null,
        noteAr: null,
        actorId: PJW_ACTOR,
      });
      expect(certificate.status).toBe("DRAFT");
      expect(certificate.retentionWithheld).toBe("1000.0000");
      expect(certificate.netPayable).toBe("9000.0000");
      subCertificateId = certificate.id;
    });

    // Phase 1 — THE UNMAPPED REFUSAL (its OWN transaction, the .catch
    // OUTSIDE — the W-10 pattern: the failed posting rolls the verdict
    // CAS back with the whole ambient tx; swallowing inside would
    // commit the orphan verdict).
    const refusal = await withTenant(TENANT_PJW, () =>
      subcontracts.approveCertificate({ id: subCertificateId, actorId: PJW_ACTOR }),
    ).catch((error: unknown) => error);
    expect((refusal as { code?: string }).code).toBe("PURPOSE_NOT_MAPPED");

    // Phase 2 — THE ROLLBACK PROOF (a fresh transaction): the
    // certificate is STILL DRAFT, nothing posted, nothing accrued, no
    // stamp.
    await withTenant(TENANT_PJW, async () => {
      const afterRefusal = await subcontracts.getCertificate(subCertificateId);
      expect(afterRefusal.status).toBe("DRAFT");
      expect(afterRefusal.apJournalEntryId).toBeNull();
      expect(await linesBySource("subcontractor_certificate", subCertificateId, "approve")).toHaveLength(0);
      const subRowBefore = (await retention.ledger(ctProjectId)).find(
        (r) => r.id === subRetentionRowId,
      );
      expect(subRowBefore!.accruedBalance).toBe("0.0000");
    });

    // Phase 3 — the five mappings land (the tenant's own runtime
    // surface), and the approval NOW drives the linkage + the hold.
    await mapPjwPurpose("PROJECT_SUBCONTRACT_COST", retentionCostAccountId);
    await mapPjwPurpose("SUBCONTRACT_RETENTION", subRetentionAccountId);
    const result = await withTenant(TENANT_PJW, () =>
      subcontracts.approveCertificate({ id: subCertificateId, actorId: PJW_ACTOR }),
    );
    expect(result.certificate.status).toBe("APPROVED");
    expect(result.certificate.approvedAt).not.toBeNull();
    expect(result.certificate.apJournalEntryId).toBeTruthy();

    await withTenant(TENANT_PJW, async () => {
      // THE AP LINKAGE (posting 1): DR the subcontract cost (the NET,
      // PROJECT-STAMPED — the actuals' own GL carry) · CR AP (the net,
      // partner-stamped).
      expect(await linesBySource("subcontractor_certificate", subCertificateId, "approve")).toEqual([
        { direction: "DEBIT", code: "5140", amount: "9000.0000", projectId: ctProjectId },
        { direction: "CREDIT", code: "2110", amount: "9000.0000", projectId: null },
      ]);
      // G-55's sub-side hold (posting 2): DR the cost family (the
      // held, UNPROJECTED — the W-9 net law keeps INV-033 whole) · CR
      // the retention liability (partner-stamped).
      expect(
        await linesBySource("subcontractor_certificate", subCertificateId, "hold_retention"),
      ).toEqual([
        { direction: "DEBIT", code: "5140", amount: "1000.0000", projectId: null },
        { direction: "CREDIT", code: "2160", amount: "1000.0000", projectId: null },
      ]);
      // THE CLAUSE-2 PIN — the approved extract is the SOLE actuals
      // source: T-07's collector reads the certificate's net (9,000)
      // and the GL project dimension carries EXACTLY that (INV-033
      // green — checked inside the approval after EACH posting, and
      // re-proven here read-only).
      const report = await actuals.inv033(ctProjectId);
      expect(report.subcontract).toBe("9000.0000");
      expect(report.acTotal).toBe("9000.0000");
      expect(report.residual).toBe("0.0000");
      // The ledger accrual: the sub row carries the withheld 1,000.
      expect(result.retentionAccruedBalance).toBe("1000.0000");
    });
  });

  it("(c) THE SINGLE-CONSUMPTION LAW: a second approval is the typed refusal — still exactly the two journals, the accrual unmoved", async () => {
    const refusal = await withTenant(TENANT_PJW, () =>
      subcontracts.approveCertificate({ id: subCertificateId, actorId: PJW_ACTOR }),
    ).catch((error: unknown) => error);
    expect(refusal).toBeInstanceOf(SubcontractCertificateAlreadyApprovedError);
    await withTenant(TENANT_PJW, async () => {
      expect(await linesBySource("subcontractor_certificate", subCertificateId, "approve")).toHaveLength(2);
      expect(
        await linesBySource("subcontractor_certificate", subCertificateId, "hold_retention"),
      ).toHaveLength(2);
      const rows = await requireTenantContext().tx!.execute<{ n: number }>(sql`
        SELECT count(*)::int AS n FROM journal_entries
        WHERE source_type = 'subcontractor_certificate' AND source_id = ${subCertificateId}
      `);
      expect(rows.rows[0]?.n).toBe(2);
      const subRow = (await retention.ledger(ctProjectId)).find((r) => r.id === subRetentionRowId);
      expect(subRow!.accruedBalance).toBe("1000.0000");
      // An APPROVED certificate is terminal: no VOID (0103's CHECK).
      await expect(
        subcontracts.voidCertificate(subCertificateId, "impossible", PJW_ACTOR),
      ).rejects.toBeInstanceOf(SubcontractCertificateAlreadyApprovedError);
    });
  });

  it("(d) THE CUSTOMER REGISTER: the commercial spine — ONE per project, the immutable core, the patchable schedule", async () => {
    await withTenant(TENANT_PJW, async () => {
      const register = await retention.createRegister({
        projectId: ctProjectId,
        customerId,
        contractValue: "150000.0000",
        currencyCode: "SAR",
        holdPercent: "10.00",
        takingOverDate: null,
        defectLiabilityDate: null,
        note: "The main construction contract",
        noteAr: null,
        actorId: PJW_ACTOR,
      });
      expect(register.kind).toBe("CUSTOMER");
      expect(register.customerId).toBe(customerId);
      expect(register.contractValue).toBe("150000.0000");
      customerRegisterId = register.id;
      // ONE register per project (0103's partial unique — the typed
      // refusal, never a silent replace).
      await expect(
        retention.createRegister({
          projectId: ctProjectId,
          customerId,
          contractValue: "999.0000",
          currencyCode: "SAR",
          holdPercent: "5.00",
          takingOverDate: null,
          defectLiabilityDate: null,
          note: null,
          noteAr: null,
          actorId: PJW_ACTOR,
        }),
      ).rejects.toBeInstanceOf(RetentionRegisterExistsError);
      // THE IMMUTABLE CORE: the value/currency/customer never move —
      // the change-order gate is the only re-planning path.
      await expect(
        retention.patchRegister({
          id: customerRegisterId,
          contractValue: "200000.0000",
          actorId: PJW_ACTOR,
        }),
      ).rejects.toBeInstanceOf(RetentionRegisterImmutableError);
      // The patchable terms: the hold % + the schedule.
      const patched = await retention.patchRegister({
        id: customerRegisterId,
        holdPercent: "10.00",
        actorId: PJW_ACTOR,
      });
      expect(patched.holdPercent).toBe("10.00");
      // A CUSTOMER partner is required (a supplier refuses — the
      // partner check precedes the register check; P2 carries no
      // register either way). Its own tx (the poisoned-tx law).
      const fixture = pjw();
      await expect(
        withTenant(TENANT_PJW, () =>
          retention.createRegister({
            projectId: fixture.project2Id,
            customerId: fixture.supplierPartnerId,
            contractValue: "1.0000",
            currencyCode: "SAR",
            holdPercent: "0.00",
            takingOverDate: null,
            defectLiabilityDate: null,
            note: null,
            noteAr: null,
            actorId: PJW_ACTOR,
          }),
        ),
      ).rejects.toBeInstanceOf(RetentionInputInvalidError);
    });
  });

  it("(e) G-57 + THE GENERATED INVOICE: the engine-derived retention (BR-092 — the caller never supplies it), the fused billing posting, the in-transaction POSTED invoice, and the register's accrual", async () => {
    await mapPjwPurpose("CONTRACT_RETENTION", contractRetentionAccountId);
    await mapPjwPurpose("CONTRACT_REVENUE", contractRevenueAccountId);
    await mapPjwPurpose("CUSTOMER_ADVANCE", customerAdvanceAccountId);

    let pc1 = "";
    await withTenant(TENANT_PJW, async () => {
      // The authoring: the register's 10% DERIVES the pair.
      const created = await billing.createCertificate({
        projectId: ctProjectId,
        certificateNo: "PC-1",
        certificateDate: "2026-04-01",
        kind: "PROGRESS",
        cumulativePercent: "20.00",
        grossValue: "25000.0000",
        note: null,
        noteAr: null,
        actorId: PJW_ACTOR,
      });
      expect(created.retentionAmount).toBe("2500.0000");
      expect(created.netValue).toBe("22500.0000");
      pc1 = created.id;
      await billing.submit(pc1, PJW_ACTOR);
      const result = await billing.approve({ id: pc1, actorId: PJW_ACTOR });
      expect(result.certificate.status).toBe("APPROVED");
      // G-57 — the fused billing posting (the D-18 wording verbatim):
      // DR AR (net, partner-stamped) + DR CONTRACT_RETENTION (held) /
      // CR CONTRACT_REVENUE (gross). NO project stamps (INV-033's cost
      // carry untouched).
      expect(await linesBySource("progress_certificate", pc1, "approve")).toEqual([
        { direction: "DEBIT", code: "1130", amount: "22500.0000", projectId: null },
        { direction: "DEBIT", code: "1155", amount: "2500.0000", projectId: null },
        { direction: "CREDIT", code: "4210", amount: "25000.0000", projectId: null },
      ]);
      // The apply journal never fired (no advances stand).
      expect(result.applyJournalEntryId).toBeNull();
      // THE GENERATED INVOICE (in-transaction): POSTED, SAL-numbered,
      // the contract's customer, the net, its journal = the G-57 entry.
      expect(result.invoice.status).toBe("POSTED");
      expect(result.invoice.invoiceNo).toMatch(/^SAL-2026-\d{6}$/);
      expect(result.invoice.customerId).toBe(customerId);
      expect(result.invoice.totalNet).toBe("22500.0000");
      expect(result.invoice.postedJournalId).toBe(result.billingJournalEntryId);
      // The certificate's single-use invoice stamp.
      const after = await billing.get(pc1);
      expect(after.salesInvoiceId).toBe(result.invoice.id);
      // The register's accrual (G-55's customer-side hold rides G-57).
      const register = await retention.register(ctProjectId);
      expect(register.accruedBalance).toBe("2500.0000");
      // INV-033 green (the billing legs carry no project stamps — the
      // subcontract leg 9,000 = the dimension, unchanged).
      const report = await actuals.inv033(ctProjectId);
      expect(report.acTotal).toBe("9000.0000");
      expect(report.residual).toBe("0.0000");
    });
  });

  it("(f) THE ADVANCE + THE AMORTIZATION (the G-33 mirror): the ADVANCE posts as a customer advance; later certificates amortize against it oldest-first", async () => {
    // The ADVANCE certificate: no retention (a دفعة مقدمة is
    // pre-earning), the liability posting + the invoice at gross.
    let advanceId = "";
    await withTenant(TENANT_PJW, async () => {
      const created = await billing.createCertificate({
        projectId: ctProjectId,
        certificateNo: "PC-2",
        certificateDate: "2026-04-15",
        kind: "ADVANCE",
        cumulativePercent: "0.00",
        grossValue: "15000.0000",
        note: null,
        noteAr: null,
        actorId: PJW_ACTOR,
      });
      expect(created.retentionAmount).toBe("0.0000");
      expect(created.netValue).toBe("15000.0000");
      advanceId = created.id;
    });
    // The ADVANCE percent law (its own tx): a non-zero percent refuses.
    await expect(
      withTenant(TENANT_PJW, () =>
        billing.createCertificate({
          projectId: ctProjectId,
          certificateNo: "PC-X",
          certificateDate: "2026-04-16",
          kind: "ADVANCE",
          cumulativePercent: "10.00",
          grossValue: "1.0000",
          note: null,
          noteAr: null,
          actorId: PJW_ACTOR,
        }),
      ),
    ).rejects.toBeInstanceOf(ContractingInputInvalidError);
    await withTenant(TENANT_PJW, async () => {
      await billing.submit(advanceId, PJW_ACTOR);
      const result = await billing.approve({ id: advanceId, actorId: PJW_ACTOR });
      expect(result.certificate.status).toBe("APPROVED");
      // The G-33 DISBURSE mirror: DR AR (gross, partner) / CR
      // CUSTOMER_ADVANCE (the liability).
      expect(await linesBySource("progress_certificate", advanceId, "approve")).toEqual([
        { direction: "DEBIT", code: "1130", amount: "15000.0000", projectId: null },
        { direction: "CREDIT", code: "2170", amount: "15000.0000", projectId: null },
      ]);
      expect(result.invoice.totalNet).toBe("15000.0000");
    });

    // The later PROGRESS certificate: the amortization applies.
    let pc3 = "";
    await withTenant(TENANT_PJW, async () => {
      const created = await billing.createCertificate({
        projectId: ctProjectId,
        certificateNo: "PC-3",
        certificateDate: "2026-05-01",
        kind: "PROGRESS",
        cumulativePercent: "30.00",
        grossValue: "10000.0000",
        note: null,
        noteAr: null,
        actorId: PJW_ACTOR,
      });
      pc3 = created.id;
      await billing.submit(pc3, PJW_ACTOR);
      const result = await billing.approve({ id: pc3, actorId: PJW_ACTOR });
      // The G-33 APPLY mirror: the advance absorbs the FULL net 9,000.
      expect(result.totalAdvanceApplied).toBe("9000.0000");
      expect(result.applyJournalEntryId).toBeTruthy();
      expect(await linesBySource("progress_certificate", pc3, "apply_advance")).toEqual([
        { direction: "DEBIT", code: "2170", amount: "9000.0000", projectId: null },
        { direction: "CREDIT", code: "1130", amount: "9000.0000", projectId: null },
      ]);
      // The amortization state: the advance row carries 9,000 applied.
      const advanceRow = await billing.get(advanceId);
      expect(advanceRow.advanceAppliedAmount).toBe("9000.0000");
    });

    // The exhaustion: the next certificate applies only the remaining
    // 6,000 (the honest residual rides the AR).
    await withTenant(TENANT_PJW, async () => {
      const created = await billing.createCertificate({
        projectId: ctProjectId,
        certificateNo: "PC-4",
        certificateDate: "2026-05-20",
        kind: "PROGRESS",
        cumulativePercent: "35.00",
        grossValue: "8000.0000",
        note: null,
        noteAr: null,
        actorId: PJW_ACTOR,
      });
      await billing.submit(created.id, PJW_ACTOR);
      const result = await billing.approve({ id: created.id, actorId: PJW_ACTOR });
      expect(result.totalAdvanceApplied).toBe("6000.0000");
      const advanceRow = await billing.get(advanceId);
      expect(advanceRow.advanceAppliedAmount).toBe("15000.0000"); // fully applied
      // The register's accrued retention: 2,500 + 1,000 + 800 = 4,300.
      const register = await retention.register(ctProjectId);
      expect(register.accruedBalance).toBe("4300.0000");
    });
  });

  it("(g) BR-093 — THE CEILING'S TYPED REFUSAL (no silent truncation) at the statute's position; the change order through the REAL gate re-baselines it", async () => {
    let pc5 = "";
    await withTenant(TENANT_PJW, async () => {
      const created = await billing.createCertificate({
        projectId: ctProjectId,
        certificateNo: "PC-5",
        certificateDate: "2026-06-01",
        kind: "PROGRESS",
        cumulativePercent: "80.00",
        grossValue: "105000.0000",
        note: null,
        noteAr: null,
        actorId: PJW_ACTOR,
      });
      pc5 = created.id;
      await billing.submit(pc5, PJW_ACTOR);
    });
    // Cumulative 58,000 + 105,000 = 163,000 > 150,000 — the typed
    // refusal carrying the FULL figures (overage 13,000). Its OWN
    // transaction (the W-10 pattern — the refusal at the statute's
    // position, BEFORE any write).
    const refusal = await withTenant(TENANT_PJW, () =>
      billing.approve({ id: pc5, actorId: PJW_ACTOR }),
    ).catch((error: unknown) => error);
    expect(refusal).toBeInstanceOf(BillingCeilingExceededError);
    const details = (refusal as BillingCeilingExceededError).details as Record<string, string>;
    expect(details.alreadyBilled).toBe("58000.0000");
    expect(details.thisGross).toBe("105000.0000");
    expect(details.cumulativeAfter).toBe("163000.0000");
    expect(details.ceiling).toBe("150000.0000");
    expect(details.overage).toBe("13000.0000");
    // Nothing posted, nothing stamped — still SUBMITTED.
    await withTenant(TENANT_PJW, async () => {
      const after = await billing.get(pc5);
      expect(after.status).toBe("SUBMITTED");
      expect(after.salesInvoiceId).toBeNull();
      expect(await linesBySource("progress_certificate", pc5, "approve")).toHaveLength(0);
      // The billing state read surfaces the same law.
      const state = await billing.billingState(ctProjectId);
      expect(state.cumulativeGross).toBe("58000.0000");
      expect(state.effectiveContractValue).toBe("150000.0000");
      expect(state.remaining).toBe("92000.0000");
    });

    // The change order +20,000 through the REAL gate (the G-58 pair —
    // the W-10 spec's own fixture homes; the mappings may have been
    // superseded by a sibling spec, so map idempotently first).
    await withTenant(TENANT_PJW, async () => {
      const wip = await ensurePjwAccount({
        code: "1160",
        name: "Contract work in progress",
        nameAr: "أعمال العقد تحت التنفيذ",
        type: "ASSET",
        parentCode: "1100",
      });
      const revise = await ensurePjwAccount({
        code: "2150",
        name: "Contract revision reserve",
        nameAr: "احتياطي تعديلات العقد",
        type: "LIABILITY",
        parentCode: "2100",
      });
      await mapPjwPurpose("CONTRACT_WIP", wip);
      await mapPjwPurpose("CONTRACT_REVISE", revise);
      const order = await changeOrders.create({
        projectId: ctProjectId,
        coNo: "CO-CT",
        title: "The extra basement",
        titleAr: "البدروم الإضافي",
        scopeDelta: null,
        scopeDeltaAr: null,
        priceDelta: "20000.0000",
        scheduleDeltaDays: null,
        note: null,
        noteAr: null,
        actorId: PJW_ACTOR,
      });
      await changeOrders.submit(order.id, PJW_ACTOR);
      const approved = await changeOrders.approve(order.id, PJW_ACTOR);
      expect(approved.order.status).toBe("APPROVED");
      expect(approved.journalEntryId).toBeTruthy();
    });

    // The ceiling is now 170,000: the SAME certificate approves at
    // 163,000 (one law, three engines — the gate's own read).
    await withTenant(TENANT_PJW, async () => {
      const result = await billing.approve({ id: pc5, actorId: PJW_ACTOR });
      expect(result.certificate.status).toBe("APPROVED");
      expect(result.invoice.totalNet).toBe(result.certificate.netValue);
      const state = await billing.billingState(ctProjectId);
      expect(state.cumulativeGross).toBe("163000.0000");
      expect(state.effectiveContractValue).toBe("170000.0000");
    });
  });

  it("(h) G-56 — THE RELEASE: the schedule's gates, the two sides' postings, the single-use CAS", async () => {
    await withTenant(TENANT_PJW, async () => {
      // The gates: no schedule → TAKING_OVER_MISSING.
      await expect(retention.release({ id: customerRegisterId, actorId: PJW_ACTOR })).rejects.toMatchObject({
        code: "RETENTION_RELEASE_GATE",
        details: { blocker: "TAKING_OVER_MISSING" },
      });
      // The taking-over set but the DLP future → DEFECT_LIABILITY_NOT_ELAPSED.
      await retention.patchRegister({
        id: customerRegisterId,
        takingOverDate: "2026-01-01",
        defectLiabilityDate: "2027-06-01",
        actorId: PJW_ACTOR,
      });
      await expect(retention.release({ id: customerRegisterId, actorId: PJW_ACTOR })).rejects.toBeInstanceOf(
        RetentionReleaseGateError,
      );
      // The DLP elapsed → the release: DR AR (partner) / CR
      // CONTRACT_RETENTION — the retention receivable returns to AR.
      // The accrued balance: 2,500 + 1,000 + 800 + 10,500 (PC-5) =
      // 14,800.
      await retention.patchRegister({
        id: customerRegisterId,
        defectLiabilityDate: "2026-06-01",
        actorId: PJW_ACTOR,
      });
      const released = await retention.release({ id: customerRegisterId, actorId: PJW_ACTOR });
      expect(released.account.status).toBe("RELEASED");
      expect(released.releasedAmount).toBe("14800.0000");
      expect(await linesBySource("retention_account", customerRegisterId, "release")).toEqual([
        { direction: "DEBIT", code: "1130", amount: "14800.0000", projectId: null },
        { direction: "CREDIT", code: "1155", amount: "14800.0000", projectId: null },
      ]);
      // The single-use CAS: a second release refuses.
      await expect(retention.release({ id: customerRegisterId, actorId: PJW_ACTOR })).rejects.toBeInstanceOf(
        RetentionStateError,
      );

      // The sub side — the D-18 G-56 wording's literal shape: DR the
      // retention account (the liability clears) · CR AP (the sub
      // collects, partner-stamped).
      await retention.patchRegister({
        id: subRetentionRowId,
        takingOverDate: "2026-02-01",
        defectLiabilityDate: null,
        actorId: PJW_ACTOR,
      });
      const subRelease = await retention.release({ id: subRetentionRowId, actorId: PJW_ACTOR });
      expect(subRelease.releasedAmount).toBe("1000.0000");
      expect(await linesBySource("retention_account", subRetentionRowId, "release")).toEqual([
        { direction: "DEBIT", code: "2160", amount: "1000.0000", projectId: null },
        { direction: "CREDIT", code: "2110", amount: "1000.0000", projectId: null },
      ]);
      // A zero-balance row refuses (the honest shape).
      await expect(retention.release({ id: subRetentionRowId, actorId: PJW_ACTOR })).rejects.toBeInstanceOf(
        RetentionStateError,
      );
    });
  });

  it("(i) THE LIFECYCLE REFUSALS: the DRAFT approve, the mandatory reasons, the terminal APPROVED, the void laws", async () => {
    await withTenant(TENANT_PJW, async () => {
      const draft = await billing.createCertificate({
        projectId: ctProjectId,
        certificateNo: "PC-D",
        certificateDate: "2026-07-01",
        kind: "PROGRESS",
        cumulativePercent: "81.00",
        grossValue: "1000.0000",
        note: null,
        noteAr: null,
        actorId: PJW_ACTOR,
      });
      // A DRAFT certificate cannot approve (the gate runs through
      // SUBMITTED).
      await expect(billing.approve({ id: draft.id, actorId: PJW_ACTOR })).rejects.toBeInstanceOf(
        ProgressCertificateStateError,
      );
      await billing.submit(draft.id, PJW_ACTOR);
      await expect(billing.submit(draft.id, PJW_ACTOR)).rejects.toBeInstanceOf(
        ProgressCertificateStateError,
      );
      // The void reason is mandatory.
      await expect(billing.void(draft.id, "no", PJW_ACTOR)).rejects.toBeInstanceOf(
        ContractingInputInvalidError,
      );
      const voided = await billing.void(draft.id, "Withdrawn by the contractor", PJW_ACTOR);
      expect(voided.status).toBe("VOID");
      expect(voided.voidReason).toBe("Withdrawn by the contractor");
      // A VOID certificate is decided.
      await expect(billing.submit(draft.id, PJW_ACTOR)).rejects.toBeInstanceOf(
        ProgressCertificateStateError,
      );
      // A re-approve of the approved PC-1 is the state refusal (and
      // the invoice stamp is single-use).
      const pc1 = (await billing.list(ctProjectId)).find((row) => row.certificateNo === "PC-1")!;
      await expect(billing.approve({ id: pc1.id, actorId: PJW_ACTOR })).rejects.toBeInstanceOf(
        ProgressCertificateStateError,
      );
      // A sub certificate on a non-ACTIVE agreement refuses at
      // authoring (SA-1 is ACTIVE — close it first on a THROWAWAY
      // agreement instead).
      const fixture = pjw();
      const throwaway = await subcontracts.createAgreement({
        projectId: ctProjectId,
        partnerId: fixture.supplierPartnerId,
        agreementNo: "SA-T",
        title: "Throwaway",
        titleAr: null,
        scope: null,
        agreementValue: "1000.0000",
        currencyCode: "SAR",
        retentionPercent: "10.00",
        startDate: null,
        endDate: null,
        note: null,
        noteAr: null,
        actorId: PJW_ACTOR,
      });
      await expect(
        subcontracts.createCertificate({
          agreementId: throwaway.id,
          certificateNo: null,
          certificateDate: "2026-07-02",
          progressPercent: "5.00",
          grossValue: "100.0000",
          note: null,
          noteAr: null,
          actorId: PJW_ACTOR,
        }),
      ).rejects.toBeInstanceOf(SubcontractStateError);
      // The agreement cancel with its mandatory reason.
      await expect(subcontracts.cancelAgreement(throwaway.id, "no", PJW_ACTOR)).rejects.toBeInstanceOf(
        ContractingInputInvalidError,
      );
      const cancelled = await subcontracts.cancelAgreement(
        throwaway.id,
        "Scope withdrawn",
        PJW_ACTOR,
      );
      expect(cancelled.status).toBe("CANCELLED");
      expect(cancelled.cancelReason).toBe("Scope withdrawn");
    });
  });

  it("(j) THE HONEST ABSENCES: no register → no billing (BR-092's fail-closed law); the pre-W-11 register without a customer refuses at approval; the billing state reads null, never fabricated zeros", async () => {
    await withTenant(TENANT_PJW, async () => {
      const fixture = pjw();
      // P2 carries no register: the authoring refuses.
      await expect(
        billing.createCertificate({
          projectId: fixture.project2Id,
          certificateNo: "PC-P2",
          certificateDate: "2026-07-05",
          kind: "PROGRESS",
          cumulativePercent: "10.00",
          grossValue: "1000.0000",
          note: null,
          noteAr: null,
          actorId: PJW_ACTOR,
        }),
      ).rejects.toBeInstanceOf(RetentionRegisterMissingError);
      // The billing state: the honest nulls.
      const state = await billing.billingState(fixture.project2Id);
      expect(state.register).toBeNull();
      expect(state.effectiveContractValue).toBeNull();
      expect(state.remaining).toBeNull();
      expect(state.cumulativeGross).toBe("0.0000");
      // The RAW project's pre-W-11 register (no customer): the
      // authoring stands (the register exists) but the APPROVAL
      // refuses — the AR stamp and the invoice require the contract's
      // customer.
      const raw = await billing.createCertificate({
        projectId: rawProjectId,
        certificateNo: "PC-RAW",
        certificateDate: "2026-07-06",
        kind: "PROGRESS",
        cumulativePercent: "10.00",
        grossValue: "1000.0000",
        note: null,
        noteAr: null,
        actorId: PJW_ACTOR,
      });
      await billing.submit(raw.id, PJW_ACTOR);
      await expect(billing.approve({ id: raw.id, actorId: PJW_ACTOR })).rejects.toBeInstanceOf(
        RetentionRegisterMissingError,
      );
    });
  });

  it("(k) THE W-9 COHERENT WORLD UNCHANGED: the W-11 engines add no parallel actuals path — P1's INV-033 stands at 10,945.3125", async () => {
    await withTenant(TENANT_PJW, async () => {
      const fixture = pjw();
      const report = await actuals.inv033(fixture.project1Id);
      expect(report.acTotal).toBe("10945.3125");
      expect(report.subcontract).toBe("9000.0000");
      expect(report.residual).toBe("0.0000");
    });
  });
});
