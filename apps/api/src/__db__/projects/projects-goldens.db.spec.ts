import { beforeAll, describe, expect, it } from "vitest";
import { sql } from "drizzle-orm";

import { requireTenantContext, withTenant } from "../../infra/db/tenant-context";
import { AuditService } from "../../modules/audit/api/audit";
import { DrizzleAuditStore } from "../../modules/audit/infrastructure/drizzle-audit.store";
import { NumberingService } from "../../modules/accounting/application/numbering-service";
import { PostingService } from "../../modules/accounting/application/posting-service";
import { PartnerSubledgerService } from "../../modules/partners/application/subledger-service";
import { ChangeOrderService } from "../../modules/crm/application/change-order-service";
import { SubcontractService } from "../../modules/crm/application/subcontract-service";
import { RetentionService } from "../../modules/crm/application/retention-service";
import { ProgressBillingService } from "../../modules/crm/application/progress-billing-service";
import { Ias23Service } from "../../modules/crm/application/ias23-service";
import * as partnersStore from "../../modules/partners/infrastructure/partners.store";
import { superuserClient } from "../test-db";
import {
  PJW_ACTOR,
  TENANT_PJW,
  actuals,
  budgets,
  ensureP1BudgetWorld,
  ensureProjectByCode,
  ensurePjwAccount,
  mapPjwPurpose,
  mintJournal,
  pjw,
  setPjwSetting,
  wbs,
} from "./fixtures";

/**
 * PHASE-048 (W-14 — T-18a, dated 2026-11-22) · `projects-goldens.db.spec`
 * — THE GOLDEN TRANSCRIPTS with their FAILURE PACKS (the JOURNAL_RULES
 * §7 law: every golden row is mirrored by a golden test with a
 * mandatory failure pack — the statutory-goldens precedent's shape:
 * the golden pins every journal line + the INV-013 source key + the
 * engine's own figures; the failure pack flips the world to the
 * failing shape, proves the typed refusal WITH ITS FULL PAYLOAD and
 * the ZERO residue, restores, and the same act re-runs green).
 *
 * The transcripts: G-55 (the sub-side hold at each sub certificate +
 * the customer side riding G-57) · G-56 (the release at final
 * acceptance — both sides) · G-57 (the fused billing + the
 * in-transaction invoice) · G-58 (the change-order delta, exactly
 * once) — every posting through the REAL engine with registered
 * source keys under INV-013 idempotency — plus THE INV-033 GOLDEN
 * (the coherent world's full reconciliation transcript + the poisoned
 * world's typed refusal WITH ITS FULL PER-LEG PAYLOAD) and THE IAS-23
 * GOLDEN (the capitalization posting + the single-use stamp + the
 * unverified-register refusal, the register flip-and-restore).
 *
 * Every arm rides the PJW world; the poisoned/refusal worlds are the
 * goldens' OWN projects (the poisoned-transaction law, permanent).
 */

const audit = new AuditService(new DrizzleAuditStore());
const posting = new PostingService(audit, new PartnerSubledgerService());
const numbering = new NumberingService(audit);
const changeOrders = new ChangeOrderService(audit, posting);
const subcontracts = new SubcontractService(audit, posting, actuals);
const retention = new RetentionService(audit, posting, actuals);
const billing = new ProgressBillingService(audit, posting, numbering, actuals, changeOrders);
const ias23 = new Ias23Service(audit, posting);

let gdProjectId = "";
let gdxProjectId = "";
let gdIasProjectId = "";
let gdIas2ProjectId = "";
let customerId = "";
let customerRegisterId = "";
let subRetentionRowId = "";
let agreementId = "";
let wipAccountId = "";
let reviseAccountId = "";
let pennySinkAccountId = "";

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

/** The flip-and-restore idiom's FLIP: supersede the active purpose
 * mapping (the tenant's own runtime surface — never a raw table
 * poke), so the next engine act fails closed. */
async function supersedePurposeKey(purposeKey: string): Promise<void> {
  await withTenant(TENANT_PJW, async () => {
    const tenancy = await import("../../modules/tenancy/infrastructure/tenancy.store");
    const accounting = await import("../../modules/accounting/infrastructure/accounting.store");
    const active = await tenancy.findActivePurpose(purposeKey);
    if (active !== undefined) {
      await accounting.supersedePurpose(active.id, active.activeFrom);
    }
  });
}

/** Count an INV-013 source key's entries (the idempotency proof). */
async function entryCount(docType: string, docId: string, operation: string): Promise<number> {
  const rows = await requireTenantContext().tx!.execute<{ n: number }>(sql`
    SELECT count(*)::int AS n FROM journal_entries
    WHERE source_type = ${docType} AND source_id = ${docId} AND operation = ${operation}
  `);
  return rows.rows[0]!.n;
}

const IAS_REGISTER = {
  rate: 0.05,
  source_evidence: "The goldens' weighted-average borrowing register — the 2026 facility schedule (tenant-entered with evidence)",
  verified: true,
};

beforeAll(async () => {
  await ensureP1BudgetWorld();
  const fixture = pjw();

  gdProjectId = await ensureProjectByCode("PJW-PRJ-GD", "The goldens world project");
  gdxProjectId = await ensureProjectByCode("PJW-PRJ-GDX", "The INV-033 golden failure world project");
  gdIasProjectId = await ensureProjectByCode("PJW-PRJ-GDIAS", "The IAS-23 golden project");
  gdIas2ProjectId = await ensureProjectByCode("PJW-PRJ-GDIAS2", "The IAS-23 unverified-register world project");

  // The purpose homes (idempotent — the codes the sibling specs own).
  const contractRetentionAccountId = await ensurePjwAccount({
    code: "1155",
    name: "Contract retention receivable",
    nameAr: "مستحقات الاستقطاع التعاقدي",
    type: "ASSET",
    parentCode: "1100",
  });
  const contractRevenueAccountId = await ensurePjwAccount({
    code: "4210",
    name: "Contract progress revenue",
    nameAr: "إيرادات المستخلصات التعاقدية",
    type: "REVENUE",
    parentCode: "4000",
  });
  const subCostAccountId = await ensurePjwAccount({
    code: "5140",
    name: "Subcontracted works cost",
    nameAr: "تكلفة أعمال الباطن",
    type: "EXPENSE",
    parentCode: "5000",
  });
  const subRetentionAccountId = await ensurePjwAccount({
    code: "2160",
    name: "Subcontractor retention payable",
    nameAr: "استقطاعات مقاولي الباطن المستحقة",
    type: "LIABILITY",
    parentCode: "2100",
  });
  wipAccountId = await ensurePjwAccount({
    code: "1160",
    name: "Contract work in progress",
    nameAr: "الأعمال تحت التنفيذ",
    type: "ASSET",
    parentCode: "1100",
  });
  reviseAccountId = await ensurePjwAccount({
    code: "2150",
    name: "Contract revise liability",
    nameAr: "التزامات تعديل العقود",
    type: "LIABILITY",
    parentCode: "2100",
  });
  pennySinkAccountId = await ensurePjwAccount({
    code: "4999",
    name: "The unexplained-penny sink",
    nameAr: "مصرف القرش غير المفسر",
    type: "REVENUE",
    parentCode: "4000",
  });
  await ensurePjwAccount({
    code: "1310",
    name: "Construction in progress (IAS 23)",
    nameAr: "أصول تحت الإنشاء (IAS 23)",
    type: "ASSET",
    parentCode: "1300",
  });
  await ensurePjwAccount({
    code: "5260",
    name: "Borrowing costs (IAS 23)",
    nameAr: "تكاليف الاقتراض (IAS 23)",
    type: "EXPENSE",
    parentCode: "5000",
  });

  // The idempotent mapping set (the sibling specs may have mapped some
  // already — mapPjwPurpose skips standing rows).
  await mapPjwPurpose("CONTRACT_RETENTION", contractRetentionAccountId);
  await mapPjwPurpose("CONTRACT_REVENUE", contractRevenueAccountId);
  await mapPjwPurpose("PROJECT_SUBCONTRACT_COST", subCostAccountId);
  await mapPjwPurpose("SUBCONTRACT_RETENTION", subRetentionAccountId);
  await mapPjwPurpose("CONTRACT_WIP", wipAccountId);
  await mapPjwPurpose("CONTRACT_REVISE", reviseAccountId);

  // The contract's CUSTOMER + the register + the agreement.
  await withTenant(TENANT_PJW, async () => {
    const existing = await partnersStore.findPartnerByCode("PJW-GD-CUST");
    customerId =
      existing?.id ??
      (
        await partnersStore.insertPartner({
          kind: "CUSTOMER",
          code: "PJW-GD-CUST",
          name: "The goldens customer (PJW)",
          nameAr: "عميل الذهبيات",
          taxNumber: null,
          creditLimit: null,
          creditTermsId: null,
          priceListId: null,
        })
      ).id;

    const ledger0 = await retention.ledger(gdProjectId);
    if (ledger0.length === 0) {
      const register = await retention.createRegister({
        projectId: gdProjectId,
        customerId,
        contractValue: "150000.0000",
        currencyCode: "SAR",
        holdPercent: "10.00",
        takingOverDate: null,
        defectLiabilityDate: null,
        note: "The goldens world contract",
        noteAr: null,
        actorId: PJW_ACTOR,
      });
      customerRegisterId = register.id;
    } else {
      customerRegisterId = (ledger0.find((row) => row.kind === "CUSTOMER") ?? ledger0[0]!).id;
    }
    const ledger = await retention.ledger(gdProjectId);
    const subRow = ledger.find((row) => row.kind === "SUBCONTRACTOR");
    if (subRow === undefined) {
      const agreement = await subcontracts.createAgreement({
        projectId: gdProjectId,
        partnerId: fixture.supplierPartnerId,
        agreementNo: "SA-GD-1",
        title: "The goldens earthworks package",
        titleAr: "حزمة الأعمال الترابية للذهبيات",
        scope: null,
        agreementValue: "50000.0000",
        currencyCode: "SAR",
        retentionPercent: "10.00",
        startDate: null,
        endDate: null,
        note: null,
        noteAr: null,
        actorId: PJW_ACTOR,
      });
      agreementId = agreement.id;
      const activated = await subcontracts.activateAgreement(agreement.id, PJW_ACTOR);
      void activated;
      const after = await retention.ledger(gdProjectId);
      subRetentionRowId = (after.find((row) => row.kind === "SUBCONTRACTOR") ?? after[0]!).id;
    } else {
      agreementId = subRow.subcontractorAgreementId ?? "";
      subRetentionRowId = subRow.id;
    }
  });

  // The INV-033 golden FAILURE world: a budget with no collector legs
  // + one unexplained project-stamped penny (the credit on the 4999
  // sink — never the 5210 pool).
  {
    const su = await superuserClient();
    const tasks = await su.query<{ n: number }>(
      `SELECT count(*)::int AS n FROM project_wbs_tasks WHERE tenant_id = $1 AND project_id = $2`,
      [TENANT_PJW, gdxProjectId],
    );
    await su.end();
    await withTenant(TENANT_PJW, async () => {
      let rootId = "";
      if (tasks.rows[0]!.n === 0) {
        const root = await wbs.createTask({
          projectId: gdxProjectId,
          parentTaskId: null,
          predecessorTaskId: null,
          wbsCode: "R",
          name: "The poisoned root",
          nameAr: "الجذر المسموم",
          isMilestone: false,
          startDate: "2026-01-01",
          endDate: "2026-12-31",
          weight: null,
          percentComplete: "0.00",
          note: null,
          noteAr: null,
          actorId: PJW_ACTOR,
        });
        rootId = root.id;
      } else {
        rootId = (await wbs.tree(gdxProjectId))[0]!.id;
      }
      if ((await budgets.listBudgets(gdxProjectId)).length === 0) {
        const draft = await budgets.createBudget({
          projectId: gdxProjectId,
          name: "PB-GDX",
          nameAr: null,
          note: null,
          actorId: PJW_ACTOR,
        });
        await budgets.replaceLines(
          draft.id,
          [
            {
              costType: "LABOR",
              wbsTaskId: rootId,
              periodStart: "2026-01-01",
              periodEnd: "2026-01-31",
              plannedAmount: "3100.0000",
              note: null,
            },
          ],
          PJW_ACTOR,
        );
        await budgets.approve(draft.id, PJW_ACTOR);
      }
    });
    const suJournal = await superuserClient();
    const already = await suJournal.query<{ n: number }>(
      `SELECT count(*)::int AS n FROM journal_lines jl
       JOIN journal_entries je ON je.id = jl.journal_entry_id
       WHERE je.tenant_id = $1 AND jl.project_id = $2`,
      [TENANT_PJW, gdxProjectId],
    );
    await suJournal.end();
    if (already.rows[0]!.n === 0) {
      await withTenant(TENANT_PJW, () =>
        mintJournal({
          debitAccountId: fixture.projectCostAccountId,
          creditAccountId: pennySinkAccountId,
          amount: "0.0100",
          entryDate: "2026-02-01",
          projectId: gdxProjectId,
          description: "The unexplained project penny (the INV-033 golden failure world)",
        }),
      );
    }
  }

  // The IAS-23 golden world: P-GDIAS (one dated window + one in-window
  // LABOR line 1,000 → capitalized 50.0000 at the 5% rate) and
  // P-GDIAS2 (the unverified-register world's own budget).
  await setPjwSetting("projects.ias23_capitalization_rate", IAS_REGISTER);
  for (const [projectId, code] of [
    [gdIasProjectId, "PB-GDIAS"],
    [gdIas2ProjectId, "PB-GDIAS2"],
  ] as const) {
    const su = await superuserClient();
    const tasks = await su.query<{ n: number }>(
      `SELECT count(*)::int AS n FROM project_wbs_tasks WHERE tenant_id = $1 AND project_id = $2`,
      [TENANT_PJW, projectId],
    );
    await su.end();
    await withTenant(TENANT_PJW, async () => {
      if (tasks.rows[0]!.n === 0) {
        await wbs.createTask({
          projectId,
          parentTaskId: null,
          predecessorTaskId: null,
          wbsCode: "W",
          name: "The qualifying construction window",
          nameAr: "نافذة الإنشاء المؤهلة",
          isMilestone: false,
          startDate: "2026-03-01",
          endDate: "2026-06-30",
          weight: null,
          percentComplete: "0.00",
          note: null,
          noteAr: null,
          actorId: PJW_ACTOR,
        });
      }
      if (!(await budgets.listBudgets(projectId)).some((row) => row.name === code)) {
        const draft = await budgets.createBudget({
          projectId,
          name: code,
          nameAr: null,
          note: null,
          actorId: PJW_ACTOR,
        });
        await budgets.replaceLines(
          draft.id,
          [
            {
              costType: "LABOR",
              wbsTaskId: null,
              periodStart: "2026-03-01",
              periodEnd: "2026-06-30",
              plannedAmount: "1000.0000",
              note: null,
            },
          ],
          PJW_ACTOR,
        );
        await budgets.approve(draft.id, PJW_ACTOR);
      }
    });
  }
});

describe("PHASE-048 W-14 — T-18a: the projects goldens (G-55…G-58 + INV-033 + IAS-23)", () => {
  it("(a) THE G-57 GOLDEN TRANSCRIPT: the fused billing + the in-transaction invoice + the register accrual, and the replay refusal", async () => {
    let pc1 = "";
    await withTenant(TENANT_PJW, async () => {
      const created = await billing.createCertificate({
        projectId: gdProjectId,
        certificateNo: "PC-GD-1",
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

      // THE TRANSCRIPT (D-18's G-57 wording verbatim): DR AR (net,
      // partner-stamped) + DR the retention account (held) / CR
      // CONTRACT_REVENUE (gross) — NO project stamps (INV-033's cost
      // carry untouched), ONE entry under the INV-013 source key.
      expect(await linesBySource("progress_certificate", pc1, "approve")).toEqual([
        { direction: "DEBIT", code: "1130", amount: "22500.0000", projectId: null },
        { direction: "DEBIT", code: "1155", amount: "2500.0000", projectId: null },
        { direction: "CREDIT", code: "4210", amount: "25000.0000", projectId: null },
      ]);
      expect(await entryCount("progress_certificate", pc1, "approve")).toBe(1);

      // THE GENERATED INVOICE (in-transaction): POSTED, SAL-numbered,
      // the net, its journal = the G-57 entry.
      expect(result.invoice.status).toBe("POSTED");
      expect(result.invoice.invoiceNo).toMatch(/^SAL-2026-\d{6}$/);
      expect(result.invoice.customerId).toBe(customerId);
      expect(result.invoice.totalNet).toBe("22500.0000");
      expect(result.invoice.postedJournalId).toBe(result.billingJournalEntryId);

      // The register's accrual (G-55's customer-side hold rides G-57).
      const register = await retention.register(gdProjectId);
      expect(register.accruedBalance).toBe("2500.0000");

      // INV-033 green on the goldens' project (the billing legs carry
      // no project stamps — AC 0 = the dimension 0).
      const report = await actuals.inv033(gdProjectId);
      expect(report.acTotal).toBe("0.0000");
      expect(report.residual).toBe("0.0000");
    });

    // THE FAILURE PACK — the replay: a second approval is the typed
    // refusal WITH ITS PAYLOAD, and the entry count stays ONE.
    const refusal = await withTenant(TENANT_PJW, () =>
      billing.approve({ id: pc1, actorId: PJW_ACTOR }),
    ).catch((error: unknown) => error);
    expect(refusal).toMatchObject({
      code: "PROGRESS_CERTIFICATE_STATE",
      details: { certificateId: pc1, status: "APPROVED" },
    });
    await withTenant(TENANT_PJW, async () => {
      expect(await entryCount("progress_certificate", pc1, "approve")).toBe(1);
    });
  });

  it("(b) THE G-57 FAILURE PACK (flip-and-restore): the unmapped retention purpose refuses AND rolls the whole approval back; the restore re-runs green", async () => {
    // The FLIP: supersede CONTRACT_RETENTION (the tenant's own runtime
    // surface — the statutory-goldens idiom).
    await supersedePurposeKey("CONTRACT_RETENTION");
    let pc2 = "";
    await withTenant(TENANT_PJW, async () => {
      const created = await billing.createCertificate({
        projectId: gdProjectId,
        certificateNo: "PC-GD-2",
        certificateDate: "2026-05-01",
        kind: "PROGRESS",
        cumulativePercent: "35.00",
        grossValue: "15000.0000",
        note: null,
        noteAr: null,
        actorId: PJW_ACTOR,
      });
      pc2 = created.id;
      await billing.submit(pc2, PJW_ACTOR);
    });

    // The refusal — the engine resolves the purpose fail-closed.
    const refusal = await withTenant(TENANT_PJW, () =>
      billing.approve({ id: pc2, actorId: PJW_ACTOR }),
    ).catch((error: unknown) => error);
    expect((refusal as { code?: string }).code).toBe("PURPOSE_NOT_MAPPED");

    // ZERO RESIDUE: no entry, no invoice, the certificate STILL
    // SUBMITTED, the register unmoved.
    await withTenant(TENANT_PJW, async () => {
      const after = await billing.get(pc2);
      expect(after.status).toBe("SUBMITTED");
      expect(after.salesInvoiceId).toBeNull();
      expect(await linesBySource("progress_certificate", pc2, "approve")).toHaveLength(0);
      expect((await retention.register(gdProjectId)).accruedBalance).toBe("2500.0000");
    });

    // THE RESTORE: the mapping lands again — the SAME act re-runs green.
    await mapPjwPurpose("CONTRACT_RETENTION", (await pjwAccountByCode("1155"))!);
    const result = await withTenant(TENANT_PJW, () =>
      billing.approve({ id: pc2, actorId: PJW_ACTOR }),
    );
    expect(result.certificate.status).toBe("APPROVED");
    await withTenant(TENANT_PJW, async () => {
      expect(await linesBySource("progress_certificate", pc2, "approve")).toEqual([
        { direction: "DEBIT", code: "1130", amount: "13500.0000", projectId: null },
        { direction: "DEBIT", code: "1155", amount: "1500.0000", projectId: null },
        { direction: "CREDIT", code: "4210", amount: "15000.0000", projectId: null },
      ]);
      expect((await retention.register(gdProjectId)).accruedBalance).toBe("4000.0000");
    });
  });

  it("(c) THE G-55 GOLDEN TRANSCRIPT (the sub side): the AP linkage + the hold, the approved extract the SOLE actuals source, and the replay refusal", async () => {
    let subCertId = "";
    await withTenant(TENANT_PJW, async () => {
      const created = await subcontracts.createCertificate({
        agreementId,
        certificateNo: "C-GD-1",
        certificateDate: "2026-03-01",
        progressPercent: "20.00",
        grossValue: "10000.0000",
        note: null,
        noteAr: null,
        actorId: PJW_ACTOR,
      });
      expect(created.retentionWithheld).toBe("1000.0000");
      expect(created.netPayable).toBe("9000.0000");
      subCertId = created.id;
      const result = await subcontracts.approveCertificate({ id: subCertId, actorId: PJW_ACTOR });
      expect(result.certificate.status).toBe("APPROVED");

      // THE TRANSCRIPT — posting 1 (the AP linkage): DR the
      // subcontract cost (the NET, PROJECT-STAMPED — the actuals' own
      // GL carry) · CR AP (partner-stamped).
      expect(await linesBySource("subcontractor_certificate", subCertId, "approve")).toEqual([
        { direction: "DEBIT", code: "5140", amount: "9000.0000", projectId: gdProjectId },
        { direction: "CREDIT", code: "2110", amount: "9000.0000", projectId: null },
      ]);
      // THE TRANSCRIPT — posting 2 (G-55's sub-side hold): DR the cost
      // family (the held, UNPROJECTED) · CR the retention liability.
      expect(await linesBySource("subcontractor_certificate", subCertId, "hold_retention")).toEqual([
        { direction: "DEBIT", code: "5140", amount: "1000.0000", projectId: null },
        { direction: "CREDIT", code: "2160", amount: "1000.0000", projectId: null },
      ]);

      // The approved extract IS the sole actuals source: the
      // collector's net = the GL project dimension (INV-033 green).
      const report = await actuals.inv033(gdProjectId);
      expect(report.subcontract).toBe("9000.0000");
      expect(report.acTotal).toBe("9000.0000");
      expect(report.residual).toBe("0.0000");

      // The sub row's accrual (G-55's hold).
      expect(result.retentionAccruedBalance).toBe("1000.0000");
    });

    // THE FAILURE PACK — the replay: the terminal APPROVED is the
    // typed refusal WITH ITS PAYLOAD; still exactly the two entries.
    const refusal = await withTenant(TENANT_PJW, () =>
      subcontracts.approveCertificate({ id: subCertId, actorId: PJW_ACTOR }),
    ).catch((error: unknown) => error);
    expect(refusal).toMatchObject({
      code: "SUBCONTRACT_CERTIFICATE_ALREADY_APPROVED",
      details: { certificateId: subCertId },
    });
    await withTenant(TENANT_PJW, async () => {
      expect(await entryCount("subcontractor_certificate", subCertId, "approve")).toBe(1);
      expect(await entryCount("subcontractor_certificate", subCertId, "hold_retention")).toBe(1);
    });
  });

  it("(d) THE G-56 GOLDEN TRANSCRIPT: the release at final acceptance — the schedule's gates first (the failure pack), then both sides' postings + the single-use CAS", async () => {
    await withTenant(TENANT_PJW, async () => {
      // THE FAILURE PACK (the gates): no schedule → TAKING_OVER_MISSING
      // with the payload; the taking-over set but the DLP future → the
      // gate again — ZERO residue (no entry).
      await expect(retention.release({ id: customerRegisterId, actorId: PJW_ACTOR })).rejects.toMatchObject({
        code: "RETENTION_RELEASE_GATE",
        details: { blocker: "TAKING_OVER_MISSING" },
      });
      await retention.patchRegister({
        id: customerRegisterId,
        takingOverDate: "2026-01-01",
        defectLiabilityDate: "2027-06-01",
        actorId: PJW_ACTOR,
      });
      await expect(retention.release({ id: customerRegisterId, actorId: PJW_ACTOR })).rejects.toMatchObject({
        code: "RETENTION_RELEASE_GATE",
        details: { blocker: "DEFECT_LIABILITY_NOT_ELAPSED" },
      });
      expect(await linesBySource("retention_account", customerRegisterId, "release")).toHaveLength(0);

      // THE GOLDEN: the DLP elapsed → DR AR (partner) / CR
      // CONTRACT_RETENTION at the accrued 4,000 (2,500 + 1,500).
      await retention.patchRegister({
        id: customerRegisterId,
        defectLiabilityDate: "2026-06-01",
        actorId: PJW_ACTOR,
      });
      const released = await retention.release({ id: customerRegisterId, actorId: PJW_ACTOR });
      expect(released.account.status).toBe("RELEASED");
      expect(released.releasedAmount).toBe("4000.0000");
      expect(await linesBySource("retention_account", customerRegisterId, "release")).toEqual([
        { direction: "DEBIT", code: "1130", amount: "4000.0000", projectId: null },
        { direction: "CREDIT", code: "1155", amount: "4000.0000", projectId: null },
      ]);

      // THE SINGLE-USE CAS (the failure pack): a second release is the
      // typed refusal WITH ITS PAYLOAD.
      await expect(retention.release({ id: customerRegisterId, actorId: PJW_ACTOR })).rejects.toMatchObject({
        code: "RETENTION_STATE",
        details: { retentionAccountId: customerRegisterId, status: "RELEASED" },
      });

      // THE SUB SIDE (D-18's G-56 wording literal): DR the retention
      // liability (it clears) · CR AP (the sub collects).
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
    });
  });

  it("(e) THE G-58 GOLDEN TRANSCRIPT: the change-order delta exactly once + the ceiling re-baseline, and the two failure packs", async () => {
    let coGd = "";
    await withTenant(TENANT_PJW, async () => {
      const created = await changeOrders.create({
        projectId: gdProjectId,
        coNo: "CO-GD-1",
        title: "The goldens retaining wall",
        titleAr: "جدار الذهبيات",
        scopeDelta: null,
        scopeDeltaAr: null,
        priceDelta: "20000.0000",
        scheduleDeltaDays: 10,
        note: null,
        noteAr: null,
        actorId: PJW_ACTOR,
      });
      coGd = created.id;
      await changeOrders.submit(coGd, PJW_ACTOR);
      // The ceiling BEFORE: the order is INERT (BR-094).
      const before = await changeOrders.ceiling(gdProjectId);
      expect(before.priceDeltaSum).toBe("0.0000");
      expect(before.effectiveContractValue).toBe("150000.0000");

      const result = await changeOrders.approve(coGd, PJW_ACTOR);
      expect(result.order.status).toBe("APPROVED");
      expect(result.effectAppliedAt).not.toBeNull();

      // THE TRANSCRIPT: the positive delta DR the WIP · CR the revise
      // (D-18's G-58 wording), ONE entry under the source key.
      expect(
        await linesBySource("change_order", coGd, "apply_effect"),
      ).toEqual([
        { direction: "DEBIT", code: "1160", amount: "20000.0000", projectId: null },
        { direction: "CREDIT", code: "2150", amount: "20000.0000", projectId: null },
      ]);
      expect(await entryCount("change_order", coGd, "apply_effect")).toBe(1);

      // The ceiling NOW carries the delta — once (150,000 → 170,000).
      const after = await changeOrders.ceiling(gdProjectId);
      expect(after.priceDeltaSum).toBe("20000.0000");
      expect(after.approvedChangeOrders).toBe(1);
      expect(after.effectiveContractValue).toBe("170000.0000");
    });

    // THE FAILURE PACK 1 — the replay: only SUBMITTED orders approve.
    const replay = await withTenant(TENANT_PJW, () =>
      changeOrders.approve(coGd, PJW_ACTOR),
    ).catch((error: unknown) => error);
    expect(replay).toMatchObject({
      code: "CHANGE_ORDER_STATE",
      details: { changeOrderId: coGd, status: "APPROVED" },
    });

    // THE FAILURE PACK 2 — the flip-and-restore: the unmapped WIP
    // refuses AND rolls the verdict back (no stamp, no entry); the
    // restore re-runs green.
    await supersedePurposeKey("CONTRACT_WIP");
    let coGd2 = "";
    await withTenant(TENANT_PJW, async () => {
      const created = await changeOrders.create({
        projectId: gdProjectId,
        coNo: "CO-GD-2",
        title: "The goldens second wall",
        titleAr: null,
        scopeDelta: null,
        scopeDeltaAr: null,
        priceDelta: "500.0000",
        scheduleDeltaDays: null,
        note: null,
        noteAr: null,
        actorId: PJW_ACTOR,
      });
      coGd2 = created.id;
      await changeOrders.submit(coGd2, PJW_ACTOR);
    });
    const refusal = await withTenant(TENANT_PJW, () =>
      changeOrders.approve(coGd2, PJW_ACTOR),
    ).catch((error: unknown) => error);
    expect((refusal as { code?: string }).code).toBe("PURPOSE_NOT_MAPPED");
    await withTenant(TENANT_PJW, async () => {
      const after = await changeOrders.get(coGd2);
      expect(after.status).toBe("SUBMITTED");
      expect(after.effectAppliedAt).toBeNull();
      expect(await linesBySource("change_order", coGd2, "apply_effect")).toHaveLength(0);
    });
    await mapPjwPurpose("CONTRACT_WIP", wipAccountId);
    const restored = await withTenant(TENANT_PJW, () => changeOrders.approve(coGd2, PJW_ACTOR));
    expect(restored.order.status).toBe("APPROVED");
    await withTenant(TENANT_PJW, async () => {
      expect(
        await linesBySource("change_order", coGd2, "apply_effect"),
      ).toEqual([
        { direction: "DEBIT", code: "1160", amount: "500.0000", projectId: null },
        { direction: "CREDIT", code: "2150", amount: "500.0000", projectId: null },
      ]);
    });
  });

  it("(f) THE INV-033 GOLDEN: the coherent world's full reconciliation transcript + the poisoned world's typed refusal WITH ITS FULL PAYLOAD", async () => {
    await withTenant(TENANT_PJW, async () => {
      // THE GOLDEN TRANSCRIPT — P1's coherent four-leg world, every
      // figure the engine's own output, verbatim.
      const report = await actuals.inv033(pjw().project1Id);
      expect(report).toMatchObject({
        labor: "820.3125",
        materials: "500.0000",
        subcontract: "9000.0000",
        overheadAllocated: "625.0000",
        acTotal: "10945.3125",
        glProjectDimension: { debit: "10945.3125", credit: "0", net: "10945.3125" },
        residual: "0.0000",
      });

      // THE FAILURE PACK — the poisoned own world: the typed refusal
      // carries the FULL per-leg payload (the rejection WITH its
      // payload — the owner's clause), zero values reconciled against
      // the unexplained penny.
      const refusal = await actuals.inv033(gdxProjectId).catch((error: unknown) => error);
      expect(refusal).toMatchObject({
        code: "INV033_RECONCILIATION",
        details: {
          labor: "0.0000",
          materials: "0.0000",
          subcontract: "0.0000",
          overheadAllocated: "0.0000",
          acTotal: "0.0000",
          glProjectDimension: "0.0100",
          residual: "-0.0100",
        },
      });
      expect((refusal as Error).message).toContain("residual -0.0100");
    });
  });

  it("(g) THE IAS-23 GOLDEN: the capitalization posting + the scope rows + the single-use stamp + the unverified-register failure pack (the flip-and-restore)", async () => {
    // The purposes land for the golden (and are SUPERSEDED after — the
    // ias23 spec's own unmapped-refusal arm must still find them
    // unmapped; the flip-and-restore law at the tenant surface).
    const cipAccountId = (await pjwAccountByCode("1310"))!;
    const borrowingAccountId = (await pjwAccountByCode("5260"))!;
    try {
      await mapPjwPurpose("IAS23_QUALIFYING_ASSET", cipAccountId);
      await mapPjwPurpose("IAS23_BORROWING_COST", borrowingAccountId);
      await setPjwSetting("projects.ias23_capitalization_rate", IAS_REGISTER);

      const result = await withTenant(TENANT_PJW, () =>
        ias23.capitalize(gdIasProjectId, "2026-06-30", PJW_ACTOR),
      );
      expect(result.journalEntryId).toBeTruthy();
      expect(result.totals.capitalized).toBe("50.0000"); // 1,000 × 5%

      await withTenant(TENANT_PJW, async () => {
        // THE TRANSCRIPT: DR the qualifying asset · CR the borrowing
        // costs at Σ capitalized — ONE entry under the source key
        // (post_20260301 — the window's start).
        expect(await linesBySource("ias_capitalization", gdIasProjectId, "post_20260301")).toEqual([
          { direction: "DEBIT", code: "1310", amount: "50.0000", projectId: null },
          { direction: "CREDIT", code: "5260", amount: "50.0000", projectId: null },
        ]);
        // The scope rows: POSTED, the rate snapshot, the window.
        const rows = await ias23.listCapitalizations(gdIasProjectId);
        expect(rows).toHaveLength(1);
        expect(rows[0]!.status).toBe("POSTED");
        expect(rows[0]!.rateSnapshot).toBe("0.050000");
        expect(rows[0]!.windowStart).toBe("2026-03-01");
        expect(rows[0]!.expendituresAmount).toBe("1000.0000");
        expect(rows[0]!.capitalizedAmount).toBe("50.0000");
        // The expensed leg: the OUT-OF-WINDOW expenditures (the stop
        // rules) — the single in-window line leaves it zero (the
        // capitalized/expensed split at the window boundary).
        expect(rows[0]!.expensedAmount).toBe("0.0000");
        // INV-033 green on the golden's project (no project stamps).
        const report = await actuals.inv033(gdIasProjectId);
        expect(report.residual).toBe("0.0000");
      });

      // THE FAILURE PACK 1 — the single-use stamp: the same window
      // never capitalizes twice (the typed refusal WITH ITS PAYLOAD).
      const replay = await withTenant(TENANT_PJW, () =>
        ias23.capitalize(gdIasProjectId, "2026-06-30", PJW_ACTOR),
      ).catch((error: unknown) => error);
      expect((replay as { code?: string }).code).toBe("IAS23_ALREADY_POSTED");
      await withTenant(TENANT_PJW, async () => {
        expect(await entryCount("ias_capitalization", gdIasProjectId, "post_20260301")).toBe(1);
      });

      // THE FAILURE PACK 2 — the unverified register (the flip): the
      // REQUIRES_VERIFICATION tenant DATA law — the capitalize on the
      // fresh world refuses; the register restore returns the posture.
      await setPjwSetting("projects.ias23_capitalization_rate", {
        ...IAS_REGISTER,
        verified: false,
      });
      const unverified = await withTenant(TENANT_PJW, () =>
        ias23.capitalize(gdIas2ProjectId, "2026-06-30", PJW_ACTOR),
      ).catch((error: unknown) => error);
      expect((unverified as { code?: string }).code).toBe("IAS23_RATE_UNVERIFIED");
      await withTenant(TENANT_PJW, async () => {
        // ZERO residue: no capitalization rows, no entry.
        expect(await ias23.listCapitalizations(gdIas2ProjectId)).toHaveLength(0);
        expect(await entryCount("ias_capitalization", gdIas2ProjectId, "post_20260301")).toBe(0);
      });
    } finally {
      // THE RESTORE (both flips): the register verified again + the
      // IAS-23 purposes superseded back to unmapped (the ias23 spec's
      // own refusal arms must still find them unmapped — the family's
      // order-robustness law).
      await setPjwSetting("projects.ias23_capitalization_rate", IAS_REGISTER);
      await supersedePurposeKey("IAS23_QUALIFYING_ASSET");
      await supersedePurposeKey("IAS23_BORROWING_COST");
    }
  });
});

/** An account id by code (the tenant's own chart). */
async function pjwAccountByCode(code: string): Promise<string | undefined> {
  const su = await superuserClient();
  const rows = await su.query<{ id: string }>(
    `SELECT id FROM accounts WHERE tenant_id = $1 AND code = $2 LIMIT 1`,
    [TENANT_PJW, code],
  );
  await su.end();
  return rows.rows[0]?.id;
}
