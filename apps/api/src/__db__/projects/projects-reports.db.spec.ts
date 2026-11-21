import { beforeAll, describe, expect, it } from "vitest";

import { withTenant } from "../../infra/db/tenant-context";
import { AuditService } from "../../modules/audit/api/audit";
import { DrizzleAuditStore } from "../../modules/audit/infrastructure/drizzle-audit.store";
import { NumberingService } from "../../modules/accounting/application/numbering-service";
import { PostingService } from "../../modules/accounting/application/posting-service";
import { PartnerSubledgerService } from "../../modules/partners/application/subledger-service";
import { TaxResolverService } from "../../modules/tax/application/tax-resolver-service";
import { ReservationService } from "../../modules/inventory/application/reservation-service";
import { SalesInvoiceService } from "../../modules/sales/application/invoices";
import { ServiceOrderService } from "../../modules/crm/application/service-order-service";
import { ServiceOrderPosting } from "../../modules/crm/application/service-order-posting";
import { ChangeOrderService } from "../../modules/crm/application/change-order-service";
import { SubcontractService } from "../../modules/crm/application/subcontract-service";
import { RetentionService } from "../../modules/crm/application/retention-service";
import { ProgressBillingService } from "../../modules/crm/application/progress-billing-service";
import { FieldserviceService } from "../../modules/crm/application/fieldservice-service";
import { EvmService } from "../../modules/crm/application/evm-service";
import { InboxService } from "../../modules/notifications/application/inbox-service";
import { PermissionDeniedError } from "../../modules/reporting/application/scope";
import { ALL_KNOWN_PERMISSIONS, fullContext, newRunService } from "../reporting/fixtures";
import { superuserClient } from "../test-db";
import * as partnersStore from "../../modules/partners/infrastructure/partners.store";
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
 * PHASE-048 (W-14 — T-17, dated 2026-11-22) · `projects-reports.db.spec`
 * — the four projects report contracts over the real engines (the
 * talent-reports pattern): every arm runs the contract through the REAL
 * RunService on the PJW world and pins THE ENGINE-VERBATIM LAW (zero
 * parallel computation — every rendered figure re-checked against the
 * engine's own direct output), the assertions' PASS/FAIL posture, the
 * deny paths (one per contract), the tenant-isolation floor, and the
 * report-never-records law (the SLA readout fires NO notification).
 *
 * The world: P1 (the fixture's coherent four-leg world — the EVM +
 * INV-033 green arm) + PJW-PRJ-RP (the contracting world: register +
 * agreement + the G-57 certificate approved) + PJW-PRJ-RPX (the
 * INV-033 FAIL world: a budget with no collector legs + one unexplained
 * project-stamped penny) + the field-service visits (one frozen
 * completed visit with a seeded pause + one undispatched NEW visit).
 */

const audit = new AuditService(new DrizzleAuditStore());
const posting = new PostingService(audit, new PartnerSubledgerService());
const numbering = new NumberingService(audit);
const changeOrders = new ChangeOrderService(audit, posting);
const subcontracts = new SubcontractService(audit, posting, actuals);
const retention = new RetentionService(audit, posting, actuals);
const billing = new ProgressBillingService(audit, posting, numbering, actuals, changeOrders);
const evm = new EvmService(budgets, actuals);
const invoices = new SalesInvoiceService(audit, posting, numbering, new TaxResolverService());
const postings = new ServiceOrderPosting(posting, invoices, new ReservationService(audit));
const serviceOrders = new ServiceOrderService(audit, numbering);
serviceOrders.setPostingPort(postings);
const fieldservice = new FieldserviceService(audit, new InboxService(), postings);

const HOUR = 3_600_000;

let rpProjectId = "";
let xProjectId = "";
let customerId = "";
let branchId = "";
let technicianId = "";
let frozenVisitId = "";
let frozenOrderId = "";
let freshOrderId = "";

/** Backdate the clock's raw input stamps by DIRECT SQL (the
 * fixture-seed precedent — the honest alternative to sleeping hours). */
async function backdateStamps(
  visitId: string,
  offsets: { dispatchedHours?: number; respondedHours?: number; completedHours?: number },
): Promise<void> {
  const su = await superuserClient();
  const sets: string[] = [];
  const params: unknown[] = [visitId];
  const push = (column: string, hours: number | undefined): void => {
    if (hours === undefined) return;
    params.push(hours);
    sets.push(`${column} = now() - ($${params.length}::double precision * interval '1 hour')`);
  };
  push("dispatched_at", offsets.dispatchedHours);
  push("first_responded_at", offsets.respondedHours);
  push("completed_at", offsets.completedHours);
  await su.query(`UPDATE service_visits SET ${sets.join(", ")} WHERE id = $1`, params);
  await su.end();
}

/** Seed ONE pause interval on the append-only audit trail (both events
 * in a SINGLE statement — one now(), the interval EXACT). */
async function seedPauseInterval(
  visitId: string,
  pausedHoursAgo: number,
  resumedHoursAgo: number,
): Promise<void> {
  const su = await superuserClient();
  await su.query(
    `WITH t AS (SELECT now() AS ts)
     INSERT INTO audit_events (id, tenant_id, action, entity_type, entity_id, at)
     SELECT gen_random_uuid(), $1::uuid, 'crm.service_visit.paused', 'service_visit', $2::uuid,
            t.ts - ($3::double precision * interval '1 hour') FROM t
     UNION ALL
     SELECT gen_random_uuid(), $1::uuid, 'crm.service_visit.resumed', 'service_visit', $2::uuid,
            t.ts - ($4::double precision * interval '1 hour') FROM t`,
    [TENANT_PJW, visitId, pausedHoursAgo, resumedHoursAgo],
  );
  await su.end();
}

async function notificationCount(): Promise<number> {
  const su = await superuserClient();
  const rows = await su.query<{ n: number }>(`SELECT count(*)::int AS n FROM notifications`);
  await su.end();
  return rows.rows[0]!.n;
}

/** Run one report contract through the REAL RunService (the
 * talent-reports pattern). */
async function runReport(reportKey: string, params: Record<string, unknown>) {
  const outcome = await withTenant(TENANT_PJW, () =>
    newRunService().run({
      reportKey,
      params,
      ctx: fullContext(TENANT_PJW),
    }),
  );
  expect(outcome.status).toBe("SUCCEEDED");
  return outcome.result!;
}

beforeAll(async () => {
  await ensureP1BudgetWorld();
  const fixture = pjw();
  technicianId = fixture.employeeId;

  rpProjectId = await ensureProjectByCode("PJW-PRJ-RP", "The reports world project");
  xProjectId = await ensureProjectByCode("PJW-PRJ-RPX", "The INV-033 failure world project");

  // The G-57 purpose homes (idempotent — the contracting spec's own
  // codes; standalone runs map them here).
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
  await mapPjwPurpose("CONTRACT_RETENTION", contractRetentionAccountId);
  await mapPjwPurpose("CONTRACT_REVENUE", contractRevenueAccountId);

  // The contract's CUSTOMER + the register + the agreement + the G-57
  // certificate (the contracting world on the reports' own project).
  await withTenant(TENANT_PJW, async () => {
    const existing = await partnersStore.findPartnerByCode("PJW-RP-CUST");
    customerId =
      existing?.id ??
      (
        await partnersStore.insertPartner({
          kind: "CUSTOMER",
          code: "PJW-RP-CUST",
          name: "The reports customer (PJW)",
          nameAr: "عميل التقارير",
          taxNumber: null,
          creditLimit: null,
          creditTermsId: null,
          priceListId: null,
        })
      ).id;

    const existingRegister = await retention.ledger(rpProjectId);
    if (existingRegister.length === 0) {
      await retention.createRegister({
        projectId: rpProjectId,
        customerId,
        contractValue: "150000.0000",
        currencyCode: "SAR",
        holdPercent: "10.00",
        takingOverDate: null,
        defectLiabilityDate: null,
        note: "The reports world contract",
        noteAr: null,
        actorId: PJW_ACTOR,
      });
    }
    const ledger = await retention.ledger(rpProjectId);
    if (!ledger.some((row) => row.kind === "SUBCONTRACTOR")) {
      const agreement = await subcontracts.createAgreement({
        projectId: rpProjectId,
        partnerId: fixture.supplierPartnerId,
        agreementNo: "SA-RP-1",
        title: "The reports earthworks package",
        titleAr: "حزمة الأعمال الترابية للتقارير",
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
      await subcontracts.activateAgreement(agreement.id, PJW_ACTOR);
    }
    const certificates = await billing.list(rpProjectId);
    if (certificates.length === 0) {
      const created = await billing.createCertificate({
        projectId: rpProjectId,
        certificateNo: "PC-RP-1",
        certificateDate: "2026-05-01",
        kind: "PROGRESS",
        cumulativePercent: "20.00",
        grossValue: "25000.0000",
        note: null,
        noteAr: null,
        actorId: PJW_ACTOR,
      });
      await billing.submit(created.id, PJW_ACTOR);
      await billing.approve({ id: created.id, actorId: PJW_ACTOR });
    }
  });

  // The INV-033 FAIL world: a budget with no collector legs + ONE
  // unexplained project-stamped penny (the residual the report's
  // assertion must surface — its OWN project, the poisoned-transaction
  // law's world isolation).
  {
    const su = await superuserClient();
    const tasks = await su.query<{ n: number }>(
      `SELECT count(*)::int AS n FROM project_wbs_tasks WHERE tenant_id = $1 AND project_id = $2`,
      [TENANT_PJW, xProjectId],
    );
    await su.end();
    let xTaskId = "";
    await withTenant(TENANT_PJW, async () => {
      if (tasks.rows[0]!.n === 0) {
        const root = await wbs.createTask({
          projectId: xProjectId,
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
        xTaskId = root.id;
      } else {
        const tree = await wbs.tree(xProjectId);
        xTaskId = tree[0]!.id;
      }
      const existingBudgets = await budgets.listBudgets(xProjectId);
      if (existingBudgets.length === 0) {
        const draft = await budgets.createBudget({
          projectId: xProjectId,
          name: "PB-RPX",
          nameAr: null,
          note: null,
          actorId: PJW_ACTOR,
        });
        await budgets.replaceLines(
          draft.id,
          [
            {
              costType: "LABOR",
              wbsTaskId: xTaskId,
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
    // The unexplained penny: a project-stamped journal with NO
    // collector leg (AC 0 ≠ GL net 0.01 — the residual). The credit
    // side rides a DEDICATED sink account — never the 5210 overhead
    // pool (the pool's net feeds P1's allocation; touching it would
    // poison the coherent world — the probe's own finding, corrected
    // here at the claim site).
    const pennySinkAccountId = await ensurePjwAccount({
      code: "4999",
      name: "The unexplained-penny sink",
      nameAr: "مصرف القرش غير المفسر",
      type: "REVENUE",
      parentCode: "4000",
    });
    const suJournal = await superuserClient();
    const already = await suJournal.query<{ n: number }>(
      `SELECT count(*)::int AS n FROM journal_lines jl
       JOIN journal_entries je ON je.id = jl.journal_entry_id
       WHERE je.tenant_id = $1 AND jl.project_id = $2`,
      [TENANT_PJW, xProjectId],
    );
    await suJournal.end();
    if (already.rows[0]!.n === 0) {
      await withTenant(TENANT_PJW, () =>
        mintJournal({
          debitAccountId: fixture.projectCostAccountId,
          creditAccountId: pennySinkAccountId,
          amount: "0.0100",
          entryDate: "2026-02-01",
          projectId: xProjectId,
          description: "The unexplained project penny (the INV-033 report FAIL world)",
        }),
      );
    }
  }

  // The field-service world: one FROZEN completed visit (dispatched
  // −7h · responded −6h · completed −1h · a seeded pause [−5h, −2h]) +
  // one undispatched NEW visit — both deterministic.
  const suBranch = await superuserClient();
  const branch = await suBranch.query<{ id: string }>(
    `SELECT id FROM branches WHERE tenant_id = $1 AND code = 'MAIN' LIMIT 1`,
    [TENANT_PJW],
  );
  branchId = branch.rows[0]!.id;
  const existingVisits = await suBranch.query<{ id: string; status: string; scheduled_start: string }>(
    `SELECT id, status, scheduled_start::text AS scheduled_start FROM service_visits
     WHERE tenant_id = $1 AND note IN ('the W-14 reports frozen visit', 'the W-14 reports fresh visit')`,
    [TENANT_PJW],
  );
  await suBranch.end();
  const frozen = existingVisits.rows.find((row) => row.scheduled_start.startsWith("2026-11-20"));
  const fresh = existingVisits.rows.find((row) => row.scheduled_start.startsWith("2026-12-01"));

  // The SLA register (the report's targets source): response 0.5h (the
  // frozen visit's 1h response BREACHES by exactly 0.5h — deterministic)
  // · resolution 5h (the 3h pause-subtracted reading stays within).
  await setPjwSetting("projects.fieldservice_sla_targets", {
    response_target_hours: 0.5,
    resolution_target_hours: 5,
  });

  if (frozen === undefined) {
    frozenOrderId = (
      await withTenant(TENANT_PJW, () =>
      serviceOrders.create({
        branchId,
        partnerId: customerId,
        contractId: null,
        warehouseId: fixture.warehouseId,
        note: "the W-14 reports frozen order",
        noteAr: null,
        actorId: PJW_ACTOR,
        lines: [
          {
            lineType: "SERVICE",
            itemId: fixture.feeItemId,
            qty: null,
            unitPrice: "250",
            estimatedHours: "2",
            description: "Field hours",
            descriptionAr: null,
            note: null,
          },
        ],
      }),
    )).id;
    const visit = await withTenant(TENANT_PJW, () =>
      fieldservice.createVisit({
        serviceOrderId: frozenOrderId,
        technicianEmployeeId: technicianId,
        scheduledStart: "2026-11-20T08:00:00Z",
        scheduledEnd: "2026-11-20T12:00:00Z",
        note: "the W-14 reports frozen visit",
        noteAr: null,
        actorId: PJW_ACTOR,
      }),
    );
    frozenVisitId = visit.id;
    await withTenant(TENANT_PJW, () =>
      fieldservice.dispatch(frozenVisitId, { technicianEmployeeId: null, actorId: PJW_ACTOR }),
    );
    await withTenant(TENANT_PJW, () => fieldservice.start(frozenVisitId, { actorId: PJW_ACTOR }));
    await withTenant(TENANT_PJW, () =>
      fieldservice.complete(frozenVisitId, {
        completionNotes: "done",
        completionNotesAr: null,
        issueParts: false,
        actorId: PJW_ACTOR,
      }),
    );
    await backdateStamps(frozenVisitId, { dispatchedHours: 7, respondedHours: 6, completedHours: 1 });
    await seedPauseInterval(frozenVisitId, 5, 2);
  } else {
    frozenVisitId = frozen.id;
  }

  if (fresh === undefined) {
    freshOrderId = (
      await withTenant(TENANT_PJW, () =>
      serviceOrders.create({
        branchId,
        partnerId: customerId,
        contractId: null,
        warehouseId: fixture.warehouseId,
        note: "the W-14 reports fresh order",
        noteAr: null,
        actorId: PJW_ACTOR,
        lines: [
          {
            lineType: "SERVICE",
            itemId: fixture.feeItemId,
            qty: null,
            unitPrice: "250",
            estimatedHours: "2",
            description: "Field hours",
            descriptionAr: null,
            note: null,
          },
        ],
      }),
    )).id;
    await withTenant(TENANT_PJW, () =>
      fieldservice.createVisit({
        serviceOrderId: freshOrderId,
        technicianEmployeeId: technicianId,
        scheduledStart: "2026-12-01T08:00:00Z",
        scheduledEnd: "2026-12-01T12:00:00Z",
        note: "the W-14 reports fresh visit",
        noteAr: null,
        actorId: PJW_ACTOR,
      }),
    );
    // (the fresh visit rides the note lookup — no id needed beyond the report rows)
  }
});

describe("W-14 T-17 — the four projects report contracts (the reports wave)", () => {
  it("(a) projects.evm-summary: the engine's own snapshot verbatim + the INV-033 tie PASS", async () => {
    const asOf = "2026-12-31";
    // The engine's own direct output (the verbatim reference).
    const snapshot = await withTenant(TENANT_PJW, () => evm.snapshot(fixtureProject1(), asOf));
    const report = await runReport("projects.evm-summary", {
      projectId: fixtureProject1(),
      asOf,
      locale: "en",
    });

    // The totals are the snapshot's own figures (zero parallel
    // computation — re-checked against the engine's direct output).
    const totals = new Map(report.totals.map((total) => [total.id, total.amount]));
    expect(totals.get("bac")).toBe(snapshot.budget.bac);
    expect(totals.get("pv")).toBe(snapshot.pv);
    expect(totals.get("acTotal")).toBe(snapshot.ac.total);
    expect(totals.get("eac")).toBe(snapshot.forecast.eac);

    // The rows are the engine's node list verbatim.
    expect(report.rows).toHaveLength(snapshot.nodes.length);
    const byCode = new Map(report.rows.map((row) => [row.values.wbsCode as string, row]));
    for (const node of snapshot.nodes) {
      const row = byCode.get(node.wbsCode);
      expect(row, node.wbsCode).toBeDefined();
      expect(row!.values.pv).toBe(node.pv);
      expect(row!.values.ev).toBe(node.ev);
      expect(row!.values.rolledPercent).toBe(node.rolledPercent);
      expect(row!.values.acLabor).toBe(node.acLabor);
    }

    // INV-033 PASS with the engine's compared figures.
    const tie = report.assertions.find((assertion) => assertion.id === "evm-ac-gl-tie");
    expect(tie?.status).toBe("PASS");
    expect(tie?.compared).toEqual({
      left: snapshot.ac.total,
      right: snapshot.ac.total, // the reconciled world: GL net === AC
    });
  });

  it("(b) projects.evm-summary: the INV-033 residual FAILS the assertion and blocks the export (the poisoned own world)", async () => {
    const report = await runReport("projects.evm-summary", {
      projectId: xProjectId,
      asOf: "2026-12-31",
      locale: "en",
    });
    // The run SUCCEEDED (the assertion governs the EXPORT, not the run)
    // — and the tie carries the engine's own legs in `compared`.
    const tie = report.assertions.find((assertion) => assertion.id === "evm-ac-gl-tie");
    expect(tie?.status).toBe("FAIL");
    expect(tie?.compared).toEqual({ left: "0.0000", right: "0.0100" });
    expect(tie?.detail?.en).toContain("0.0100");
  });

  it("(c) projects.contract-progress: the certificates register + the BR-093 ceiling card's own figures + BR-092 PASS", async () => {
    const state = await withTenant(TENANT_PJW, () => billing.billingState(rpProjectId));
    const certificates = await withTenant(TENANT_PJW, () => billing.list(rpProjectId));
    const report = await runReport("projects.contract-progress", {
      projectId: rpProjectId,
      locale: "en",
    });

    expect(report.rows).toHaveLength(certificates.length);
    const row = report.rows[0]!;
    expect(row.values.certificateNo).toBe("PC-RP-1");
    expect(row.values.grossValue).toBe("25000.0000");
    expect(row.values.retentionAmount).toBe("2500.0000");
    expect(row.values.netValue).toBe("22500.0000");
    expect(row.values.status).toBe("APPROVED");

    // The ceiling card's OWN figures as the totals (never a client sum).
    const totals = new Map(report.totals.map((total) => [total.id, total.amount]));
    expect(totals.get("approvedCertificates")).toBe(state.approvedCertificates.toString());
    expect(totals.get("cumulativeGross")).toBe(state.cumulativeGross);
    expect(totals.get("effectiveContractValue")).toBe(state.effectiveContractValue);
    expect(totals.get("remaining")).toBe(state.remaining);

    // BR-092's pair re-check PASSES on the engine-derived pair.
    const pair = report.assertions.find((assertion) => assertion.id === "br-092-pair-integrity");
    expect(pair?.status).toBe("PASS");
  });

  it("(d) projects.retention-statement: the whole ledger verbatim, NO amount totals by design, the shape check PASS", async () => {
    const ledger = await withTenant(TENANT_PJW, () => retention.ledger(rpProjectId));
    const report = await runReport("projects.retention-statement", {
      projectId: rpProjectId,
      locale: "en",
    });

    expect(report.rows).toHaveLength(ledger.length);
    // The CUSTOMER register + the SUBCONTRACTOR row both present.
    const kinds = report.rows.map((row) => row.values.kind);
    expect(kinds).toContain("CUSTOMER");
    expect(kinds).toContain("SUBCONTRACTOR");
    const customerRow = report.rows.find((row) => row.values.kind === "CUSTOMER")!;
    expect(customerRow.values.accruedBalance).toBe("2500.0000"); // G-57's hold
    expect(customerRow.values.contractValue).toBe("150000.0000");
    expect(customerRow.values.holdPercent).toBe("10.00");

    // THE NO-TOTALS LAW: the count is the statement's ONLY total.
    expect(report.totals).toHaveLength(1);
    expect(report.totals[0]!.id).toBe("ledgerRows");
    expect(report.totals[0]!.amount).toBe(ledger.length.toString());

    const shape = report.assertions.find((assertion) => assertion.id === "retention-ledger-shape");
    expect(shape?.status).toBe("PASS");
  });

  it("(e) projects.fieldservice-sla: the pure readout's exact figures + NOTHING recorded (the report is never the evaluation act)", async () => {
    const before = await notificationCount();
    const readout = await withTenant(TENANT_PJW, () => fieldservice.slaReadout(frozenVisitId));
    // The order-scoped runs (the W-12 fieldservice spec's visits share
    // the tenant in the family envelope — the board filter is the
    // report's own parameter surface).
    const report = await runReport("projects.fieldservice-sla", {
      serviceOrderId: frozenOrderId,
      locale: "en",
    });
    const freshReport = await runReport("projects.fieldservice-sla", {
      serviceOrderId: freshOrderId,
      locale: "en",
    });

    // NOTHING recorded — the notification count is unchanged (the
    // pure-readout law; a report is never the evaluation act).
    expect(await notificationCount()).toBe(before);

    expect(report.rows).toHaveLength(1);
    const frozenRow = report.rows[0]!;
    expect(freshReport.rows).toHaveLength(1);
    const freshRow = freshReport.rows[0]!;

    // THE PAUSE SUBTRACTION rendered on the report: response 1h wall
    // (paused 0 — the window closes before the pause opens) ·
    // resolution 6h wall − 3h paused = 3h.
    expect(frozenRow.values.responseElapsedMs).toBe(readout.response.elapsedMs);
    expect(frozenRow.values.responseElapsedMs).toBe(HOUR);
    expect(frozenRow.values.responsePausedMs).toBe(0);
    expect(frozenRow.values.responseTargetH).toBe("0.50");
    expect(frozenRow.values.responseBreached).toContain("BREACHED"); // 1h > 0.5h
    expect(frozenRow.values.resolutionElapsedMs).toBe(readout.resolution.elapsedMs);
    expect(frozenRow.values.resolutionElapsedMs).toBe(3 * HOUR);
    expect(frozenRow.values.resolutionPausedMs).toBe(3 * HOUR);
    expect(frozenRow.values.resolutionTargetH).toBe("5.00");
    expect(frozenRow.values.resolutionBreached).toBe("—"); // 3h < 5h
    // The hours view is the one display division: 10,800,000 ms → 3.00.
    expect(frozenRow.values.resolutionElapsedH).toBe("3.00");

    // The undispatched clock never starts — the honest zero.
    expect(freshRow.values.status).toBe("NEW");
    expect(freshRow.values.responseElapsedMs).toBe(0);
    expect(freshRow.values.responseBreached).toBe("—");

    // The counts (the frozen run): one visit, one response breach,
    // zero resolution breaches.
    const totals = new Map(report.totals.map((total) => [total.id, total.amount]));
    expect(totals.get("visits")).toBe("1");
    expect(totals.get("responseBreached")).toBe("1");
    expect(totals.get("resolutionBreached")).toBe("0");
    const freshTotals = new Map(freshReport.totals.map((total) => [total.id, total.amount]));
    expect(freshTotals.get("visits")).toBe("1");
    expect(freshTotals.get("responseBreached")).toBe("0");

    const noFabricated = report.assertions.find(
      (assertion) => assertion.id === "sla-no-fabricated-target",
    );
    expect(noFabricated?.status).toBe("PASS");
  });

  it("(f) projects.fieldservice-sla under the UNSET register: NO_TARGET is the honest absence at the report", async () => {
    await setPjwSetting("projects.fieldservice_sla_targets", null);
    try {
      const report = await runReport("projects.fieldservice-sla", {
        serviceOrderId: frozenOrderId,
        locale: "en",
      });
      const frozenRow = report.rows[0]!;
      expect(frozenRow.values.responseTargetH).toBe("—");
      expect(frozenRow.values.resolutionTargetH).toBe("—");
      expect(frozenRow.values.responseBreached).toBe("—");
      expect(frozenRow.values.resolutionBreached).toBe("—");
      const totals = new Map(report.totals.map((total) => [total.id, total.amount]));
      expect(totals.get("responseBreached")).toBe("0");
      expect(totals.get("resolutionBreached")).toBe("0");
      const noFabricated = report.assertions.find(
        (assertion) => assertion.id === "sla-no-fabricated-target",
      );
      expect(noFabricated?.status).toBe("PASS");
    } finally {
      // Restore the register for any later reader.
      await setPjwSetting("projects.fieldservice_sla_targets", {
        response_target_hours: 0.5,
        resolution_target_hours: 5,
      });
    }
  });

  it("(g) the deny paths: sessions without the module key are denied before params bind (one per contract)", async () => {
    const deniedCtx = fullContext(TENANT_PJW, {
      permissions: new Set(["reporting.reports.run"]),
    });
    const cases: Array<{ reportKey: string; params: Record<string, unknown>; key: string }> = [
      { reportKey: "projects.evm-summary", params: { projectId: fixtureProject1(), locale: "en" }, key: "projects.evm.view" },
      { reportKey: "projects.contract-progress", params: { projectId: rpProjectId, locale: "en" }, key: "projects.contracting.view" },
      { reportKey: "projects.retention-statement", params: { projectId: rpProjectId, locale: "en" }, key: "projects.contracting.view" },
      { reportKey: "projects.fieldservice-sla", params: { locale: "en" }, key: "projects.fieldservice.view" },
    ];
    for (const { reportKey, params } of cases) {
      await expect(
        withTenant(TENANT_PJW, () =>
          newRunService().run({ reportKey, params, ctx: deniedCtx }),
        ),
      ).rejects.toThrowError(PermissionDeniedError);
    }
    // And the keys themselves are in the known catalog the fixture
    // grants (the §12 convention's boot parity).
    for (const { key } of cases) {
      expect(ALL_KNOWN_PERMISSIONS.has(key)).toBe(true);
    }
  });

  it("(h) the reports world stays tenant-scoped (the isolation floor)", async () => {
    const su = await superuserClient();
    const certificates = await su.query<{ n: number }>(
      `SELECT count(*)::int AS n FROM progress_certificates WHERE tenant_id = $1 AND project_id = $2`,
      [TENANT_PJW, rpProjectId],
    );
    const registers = await su.query<{ n: number }>(
      `SELECT count(*)::int AS n FROM retention_accounts WHERE tenant_id = $1 AND project_id = $2`,
      [TENANT_PJW, rpProjectId],
    );
    await su.end();
    expect(certificates.rows[0]!.n).toBe(1);
    expect(registers.rows[0]!.n).toBe(2); // the CUSTOMER register + the agreement's sub row
  });
});

/** The fixture's P1 (module-scope accessor — the coherent four-leg
 * world the EVM arm reads). */
function fixtureProject1(): string {
  return pjw().project1Id;
}
