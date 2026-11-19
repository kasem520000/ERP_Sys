import { beforeAll, describe, expect, it } from "vitest";
import type { Client } from "pg";

import { withTenant } from "../../infra/db/tenant-context";
import { PermissionDeniedError } from "../../modules/reporting/application/scope";
import {
  fullContext,
  newRunService,
  R_ACTOR,
  ALL_KNOWN_PERMISSIONS,
} from "./fixtures";
import { ensureTestDb, seedTenants, superuserClient } from "../test-db";

/**
 * PHASE-047 (W-6, T-15) verification — the four talent report
 * contracts (REPORT_CATALOG §9's PHASE-047 rows, registry 106 → 110):
 *
 * - `hr.performance-cycle-results` (hr.performance.view): one row per
 *   (cycle × reviewee) MANAGER review in SUBMITTED/CALIBRATED state —
 *   BR-090's posture at the report BY CONSTRUCTION: the seeded 360
 *   PEER/SELF input rows and the DRAFT manager review NEVER ride, and
 *   no reviewer axis exists in the projection (the W-4
 *   appraisal-bridge posture, pinned from the report side).
 * - `hr.recruitment-pipeline` (hr.recruitment.view): one row per
 *   vacancy with BR-088's FIXED ladder as count columns — COUNTS ONLY
 *   (amendment A-4: the applicant's personal data never crosses into
 *   exports), the stage-total-tie PASS, the zero-applicant vacancy's
 *   honest zero row.
 * - `hr.training-completions` (hr.training.view): one row per
 *   COMPLETED enrollment inside the window — the once-stamped
 *   completed_at + the result; ENROLLED/WITHDRAWN and outside-window
 *   rows never ride.
 * - `hr.document-expiry` (hr.documents.manage): one row per document
 *   inside the window with the band folded from the TENANT'S
 *   configured sweep windows (seeded [30, 7, 0] — the same
 *   hr_alert_jobs source the sweep reads); NULL expiry never rides;
 *   the document NUMBER never ships (the A-4 bait scan).
 *
 * Isolation — THE DEDICATED TENANT (the 045 hr-reports precedent's
 * own-tenant discipline, strengthened): a fresh TENANT_T47 carries
 * the whole talent world; the shared TENANT_R never observes a
 * talent row and this spec never perturbs the golden book.
 */

/** THE DEDICATED TALENT-REPORTS TENANT (the hex family's 047 arm). */
const TENANT_T47 = "7a7a7a7a-7a7a-7a7a-7a7a-7a7a7a7a04a7";

/** The A-4 bait: the document number must NEVER appear in any
 * rendered byte (the payslips law — the number is PII). */
const DOC_BAIT = "T47-BAIT-IQAMA-4477";

const spec: {
  employees?: Map<string, string>;
  cycleId?: string;
  otherCycleId?: string;
  vacancyBusyId?: string;
  vacancyFilledId?: string;
  vacancyEmptyId?: string;
  programCourseId?: string;
  programWorkshopId?: string;
} = {};

beforeAll(async () => {
  ensureTestDb();
  const su: Client = await superuserClient();
  await seedTenants(su as never);
  await su.query(
    `INSERT INTO tenants (id, name, name_ar, base_currency, country_code, timezone) VALUES
       ($1, 'Tenant T47 (talent reports)', 'المستأجر لتقارير المواهب', 'SAR', 'SA', 'Asia/Riyadh')
     ON CONFLICT (id) DO NOTHING`,
    [TENANT_T47],
  );
  await su.query(
    `INSERT INTO users (id, email, full_name, password_hash, status)
     VALUES ($1, 't47-actor@fixture.test', 'T47 Report Actor', 'x', 'ACTIVE')
     ON CONFLICT (id) DO NOTHING`,
    [R_ACTOR],
  );

  // The world — seeded DIRECTLY under the tenant's scope via withTenant
  // (the 045 hr-reports precedent). IDEMPOTENT BY CONSTRUCTION (the
  // embedded cluster persists across runs): every write rides a
  // natural key with ON CONFLICT DO UPDATE (stable ids across
  // re-runs) or a FIXED uuid with ON CONFLICT DO NOTHING (the
  // no-natural-key registers: applicants, employee_documents).
  await withTenant(TENANT_T47, async () => {
    const { sql } = await import("drizzle-orm");
    const tx = (await import("../../infra/db/tenant-context")).requireTenantContext().tx!;

    // Three employees: R1 (the submitted reviewee + documents), R2
    // (the calibrated reviewee + the second iqama), R3 (the draft
    // reviewee + the enrollments that never ride).
    const employees = await tx.execute<{ id: string; code: string }>(sql`
      INSERT INTO employees (id, tenant_id, code, name, name_ar, hire_date, contract_type, basic_salary, created_by)
      VALUES
        (gen_random_uuid(), erp.current_tenant_id(), 'EMP-T47-1', 'T47 First', 'الأول', '2026-01-01', 'FULL_TIME', 9000, ${R_ACTOR}),
        (gen_random_uuid(), erp.current_tenant_id(), 'EMP-T47-2', 'T47 Second', 'الثاني', '2026-02-01', 'FULL_TIME', 8500, ${R_ACTOR}),
        (gen_random_uuid(), erp.current_tenant_id(), 'EMP-T47-3', 'T47 Third', 'الثالث', '2026-03-01', 'FULL_TIME', 8000, ${R_ACTOR})
      ON CONFLICT (tenant_id, code) DO UPDATE SET name = EXCLUDED.name
      RETURNING id, code
    `);
    spec.employees = new Map(employees.rows.map((row) => [row.code, row.id]));
    const r1 = spec.employees.get("EMP-T47-1")!;
    const r2 = spec.employees.get("EMP-T47-2")!;
    const r3 = spec.employees.get("EMP-T47-3")!;

    // ── The performance plane: one ACTIVE cycle + one CALIBRATION
    //    cycle, the MANAGER outcomes (R1 SUBMITTED, R2 CALIBRATED),
    //    the never-riding arms (R3's DRAFT manager review; R1's PEER
    //    + SELF 360 inputs).
    const cycles = await tx.execute<{ id: string; name: string }>(sql`
      INSERT INTO performance_cycles (id, tenant_id, name, period_start, period_end, status, created_by)
      VALUES
        ('64646464-0000-4000-8000-000000004701', erp.current_tenant_id(), 'T47 FY2026 Cycle', '2026-01-01', '2026-12-31', 'ACTIVE', ${R_ACTOR}),
        ('64646464-0000-4000-8000-000000004702', erp.current_tenant_id(), 'T47 Prior Cycle', '2025-01-01', '2025-12-31', 'CALIBRATION', ${R_ACTOR})
      ON CONFLICT (id, tenant_id) DO UPDATE SET name = EXCLUDED.name
      RETURNING id, name
    `);
    const cycleByName = new Map(cycles.rows.map((row) => [row.name, row.id]));
    spec.cycleId = cycleByName.get("T47 FY2026 Cycle")!;
    spec.otherCycleId = cycleByName.get("T47 Prior Cycle")!;

    await tx.execute(sql`
      INSERT INTO performance_reviews
        (id, tenant_id, cycle_id, reviewer_employee_id, reviewee_employee_id, kind, status,
         overall_score, goal_rollup, created_by)
      VALUES
        (gen_random_uuid(), erp.current_tenant_id(), ${spec.cycleId}, ${r2}, ${r1}, 'MANAGER', 'SUBMITTED', 87.50, 65.00, ${R_ACTOR}),
        (gen_random_uuid(), erp.current_tenant_id(), ${spec.cycleId}, ${r1}, ${r2}, 'MANAGER', 'CALIBRATED', 92.00, NULL, ${R_ACTOR}),
        (gen_random_uuid(), erp.current_tenant_id(), ${spec.cycleId}, ${r1}, ${r3}, 'MANAGER', 'DRAFT', NULL, NULL, ${R_ACTOR}),
        (gen_random_uuid(), erp.current_tenant_id(), ${spec.cycleId}, ${r2}, ${r1}, 'PEER', 'SUBMITTED', 70.00, NULL, ${R_ACTOR}),
        (gen_random_uuid(), erp.current_tenant_id(), ${spec.cycleId}, ${r2}, ${r2}, 'SELF', 'SUBMITTED', 75.00, NULL, ${R_ACTOR})
      ON CONFLICT DO NOTHING
    `);

    // ── The recruitment plane: the busy vacancy's funnel (2 NEW, 1
    //    SCREEN, 1 INTERVIEW, 1 OFFER, 1 HIRED, 1 REJECTED = 7), the
    //    filled vacancy (1 HIRED), the empty vacancy (the LEFT JOIN's
    //    honest zero row). Applicants carry NO natural key — fixed
    //    uuids keep re-runs idempotent.
    const vacancies = await tx.execute<{ id: string; code: string }>(sql`
      INSERT INTO vacancies (id, tenant_id, code, title, headcount, status, created_by)
      VALUES
        (gen_random_uuid(), erp.current_tenant_id(), 'V-BUSY', 'Busy Role', 2, 'OPEN', ${R_ACTOR}),
        (gen_random_uuid(), erp.current_tenant_id(), 'V-FILLED', 'Filled Role', 1, 'FILLED', ${R_ACTOR}),
        (gen_random_uuid(), erp.current_tenant_id(), 'V-EMPTY', 'Empty Role', 1, 'OPEN', ${R_ACTOR})
      ON CONFLICT (tenant_id, code) DO UPDATE SET title = EXCLUDED.title
      RETURNING id, code
    `);
    const vacancyByCode = new Map(vacancies.rows.map((row) => [row.code, row.id]));
    spec.vacancyBusyId = vacancyByCode.get("V-BUSY")!;
    spec.vacancyFilledId = vacancyByCode.get("V-FILLED")!;
    spec.vacancyEmptyId = vacancyByCode.get("V-EMPTY")!;

    await tx.execute(sql`
      INSERT INTO applicants (id, tenant_id, vacancy_id, full_name, stage, created_by)
      VALUES
        ('64646464-0000-4000-8000-000000004711', erp.current_tenant_id(), ${spec.vacancyBusyId}, 'A One', 'NEW', ${R_ACTOR}),
        ('64646464-0000-4000-8000-000000004712', erp.current_tenant_id(), ${spec.vacancyBusyId}, 'A Two', 'NEW', ${R_ACTOR}),
        ('64646464-0000-4000-8000-000000004713', erp.current_tenant_id(), ${spec.vacancyBusyId}, 'A Three', 'SCREEN', ${R_ACTOR}),
        ('64646464-0000-4000-8000-000000004714', erp.current_tenant_id(), ${spec.vacancyBusyId}, 'A Four', 'INTERVIEW', ${R_ACTOR}),
        ('64646464-0000-4000-8000-000000004715', erp.current_tenant_id(), ${spec.vacancyBusyId}, 'A Five', 'OFFER', ${R_ACTOR}),
        ('64646464-0000-4000-8000-000000004716', erp.current_tenant_id(), ${spec.vacancyBusyId}, 'A Six', 'HIRED', ${R_ACTOR}),
        ('64646464-0000-4000-8000-000000004717', erp.current_tenant_id(), ${spec.vacancyBusyId}, 'A Seven', 'REJECTED', ${R_ACTOR}),
        ('64646464-0000-4000-8000-000000004718', erp.current_tenant_id(), ${spec.vacancyFilledId}, 'B One', 'HIRED', ${R_ACTOR})
      ON CONFLICT (id, tenant_id) DO NOTHING
    `);

    // ── The training plane: the course's two in-window completions
    //    (July 2026), the workshop's outside-window completion, and
    //    the never-riding arms (ENROLLED, WITHDRAWN).
    const programs = await tx.execute<{ id: string; code: string }>(sql`
      INSERT INTO training_programs (id, tenant_id, code, name, kind, cost, status, created_by)
      VALUES
        (gen_random_uuid(), erp.current_tenant_id(), 'TR-COURSE', 'T47 Course', 'INTERNAL', 1500.0000, 'ACTIVE', ${R_ACTOR}),
        (gen_random_uuid(), erp.current_tenant_id(), 'TR-WORKSHOP', 'T47 Workshop', 'EXTERNAL', 500.0000, 'ACTIVE', ${R_ACTOR})
      ON CONFLICT (tenant_id, code) DO UPDATE SET name = EXCLUDED.name
      RETURNING id, code
    `);
    const programByCode = new Map(programs.rows.map((row) => [row.code, row.id]));
    spec.programCourseId = programByCode.get("TR-COURSE")!;
    spec.programWorkshopId = programByCode.get("TR-WORKSHOP")!;

    await tx.execute(sql`
      INSERT INTO training_enrollments
        (id, tenant_id, program_id, employee_id, status, attendance_pct, completion_pct, result, completed_at, created_by)
      VALUES
        (gen_random_uuid(), erp.current_tenant_id(), ${spec.programCourseId}, ${r1}, 'COMPLETED', 95.00, 100.00, 'PASSED', '2026-07-10 12:00:00+00', ${R_ACTOR}),
        (gen_random_uuid(), erp.current_tenant_id(), ${spec.programCourseId}, ${r2}, 'COMPLETED', 80.00, 90.00, 'PASSED', '2026-07-15 12:00:00+00', ${R_ACTOR}),
        (gen_random_uuid(), erp.current_tenant_id(), ${spec.programCourseId}, ${r3}, 'ENROLLED', NULL, NULL, NULL, NULL, ${R_ACTOR}),
        (gen_random_uuid(), erp.current_tenant_id(), ${spec.programWorkshopId}, ${r3}, 'COMPLETED', 100.00, 100.00, 'PASSED', '2026-05-01 12:00:00+00', ${R_ACTOR}),
        (gen_random_uuid(), erp.current_tenant_id(), ${spec.programWorkshopId}, ${r2}, 'WITHDRAWN', NULL, NULL, NULL, NULL, ${R_ACTOR})
      ON CONFLICT DO NOTHING
    `);

    // ── The document plane: R1's four windows (expired −5, +10, +25,
    //    +90-beyond-the-default-window) + the NULL-expiry doc; R2's
    //    +3 iqama. Documents carry NO natural key — fixed uuids keep
    //    re-runs idempotent. NO hr_alert_jobs row is registered for
    //    this tenant yet: the documented 30/7/0 default fires (the
    //    fail-closed law; the tenant-config arm registers one below).
    await tx.execute(sql`
      INSERT INTO employee_documents
        (id, tenant_id, employee_id, kind, number, issued_on, expires_on, created_by)
      VALUES
        ('64646464-0000-4000-8000-000000004721', erp.current_tenant_id(), ${r1}, 'IQAMA', ${DOC_BAIT}, '2022-01-01', CURRENT_DATE - 5, ${R_ACTOR}),
        ('64646464-0000-4000-8000-000000004722', erp.current_tenant_id(), ${r1}, 'PASSPORT', 'T47-P-1', '2022-06-01', CURRENT_DATE + 10, ${R_ACTOR}),
        ('64646464-0000-4000-8000-000000004723', erp.current_tenant_id(), ${r1}, 'VISA', 'T47-V-1', '2023-01-01', CURRENT_DATE + 25, ${R_ACTOR}),
        ('64646464-0000-4000-8000-000000004724', erp.current_tenant_id(), ${r1}, 'CONTRACT', 'T47-C-1', '2026-01-01', CURRENT_DATE + 90, ${R_ACTOR}),
        ('64646464-0000-4000-8000-000000004725', erp.current_tenant_id(), ${r1}, 'OTHER', 'T47-O-1', '2026-01-01', NULL, ${R_ACTOR}),
        ('64646464-0000-4000-8000-000000004726', erp.current_tenant_id(), ${r2}, 'IQAMA', 'T47-I-2', '2022-03-01', CURRENT_DATE + 3, ${R_ACTOR})
      ON CONFLICT (id, tenant_id) DO NOTHING
    `);
  });
  await su.end();
});

describe("PHASE-047 W-6 · the talent report set (registry 106 → 110)", () => {
  it("hr.performance-cycle-results ships the MANAGER outcomes only — BR-090's posture at the report", async () => {
    const outcome = await withTenant(TENANT_T47, () =>
      newRunService().run({
        reportKey: "hr.performance-cycle-results",
        params: { cycleId: spec.cycleId!, locale: "en" },
        ctx: fullContext(TENANT_T47),
      }),
    );
    expect(outcome.status).toBe("SUCCEEDED");
    expect(outcome.result).toBeDefined();
    const rows = outcome.result!.rows;
    // Exactly the two MANAGER outcomes in SUBMITTED/CALIBRATED — the
    // DRAFT manager review, the PEER input, and the SELF input never
    // ride (BR-090: the 360 inputs never ship).
    expect(rows).toHaveLength(2);
    const byEmployee = new Map(rows.map((row) => [row.values.employee as string, row]));
    expect(byEmployee.get("EMP-T47-1 — T47 First")).toBeDefined();
    expect(byEmployee.get("EMP-T47-1 — T47 First")!.values.overallScore).toBe("87.50");
    expect(byEmployee.get("EMP-T47-1 — T47 First")!.values.goalRollup).toBe("65.00");
    expect(byEmployee.get("EMP-T47-1 — T47 First")!.values.reviewStatus).toBe("SUBMITTED");
    expect(byEmployee.get("EMP-T47-2 — T47 Second")!.values.overallScore).toBe("92.00");
    expect(byEmployee.get("EMP-T47-2 — T47 Second")!.values.reviewStatus).toBe("CALIBRATED");
    // NO REVIEWER AXIS: the rendered values carry no reviewer key at all.
    for (const row of rows) {
      expect(Object.keys(row.values).some((key) => key.toLowerCase().includes("reviewer"))).toBe(false);
    }
    // The manager-only-source assertion PASSes.
    const assertion = outcome.result!.assertions.find(
      (result) => result.id === "performance-manager-only-source",
    );
    expect(assertion?.status).toBe("PASS");
    // The totals: 2 outcomes, the exact 2dp average (87.50 + 92.00)/2.
    const totals = new Map(outcome.result!.totals.map((total) => [total.id, total]));
    expect(totals.get("reviewedCount")?.amount).toBe("2");
    expect(totals.get("avgOverallScore")?.amount).toBe("89.75");
  });

  it("the employeeId filter narrows the appraisal outcomes", async () => {
    const outcome = await withTenant(TENANT_T47, () =>
      newRunService().run({
        reportKey: "hr.performance-cycle-results",
        params: {
          cycleId: spec.cycleId!,
          employeeId: spec.employees!.get("EMP-T47-2")!,
          locale: "en",
        },
        ctx: fullContext(TENANT_T47),
      }),
    );
    expect(outcome.status).toBe("SUCCEEDED");
    expect(outcome.result!.rows).toHaveLength(1);
    expect(outcome.result!.rows[0]!.values.reviewStatus).toBe("CALIBRATED");
  });

  it("hr.recruitment-pipeline renders the FIXED-ladder counts with the stage-total tie PASS", async () => {
    const outcome = await withTenant(TENANT_T47, () =>
      newRunService().run({
        reportKey: "hr.recruitment-pipeline",
        params: { locale: "en" },
        ctx: fullContext(TENANT_T47),
      }),
    );
    expect(outcome.status).toBe("SUCCEEDED");
    const rows = outcome.result!.rows;
    const byVacancy = new Map(rows.map((row) => [row.values.vacancy as string, row]));
    // The busy vacancy's funnel.
    const busy = byVacancy.get("V-BUSY")!;
    expect(busy.values.newCount).toBe(2);
    expect(busy.values.screenCount).toBe(1);
    expect(busy.values.interviewCount).toBe(1);
    expect(busy.values.offerCount).toBe(1);
    expect(busy.values.hiredCount).toBe(1);
    expect(busy.values.rejectedCount).toBe(1);
    expect(busy.values.totalCount).toBe(7);
    expect(busy.values.status).toBe("OPEN");
    // The filled vacancy + the EMPTY vacancy's honest zero row (the
    // LEFT JOIN never fabricates applicants).
    expect(byVacancy.get("V-FILLED")!.values.hiredCount).toBe(1);
    expect(byVacancy.get("V-FILLED")!.values.totalCount).toBe(1);
    expect(byVacancy.get("V-EMPTY")!.values.totalCount).toBe(0);
    expect(byVacancy.get("V-EMPTY")!.values.newCount).toBe(0);
    // COUNTS ONLY: no applicant name ever rides (amendment A-4).
    const rendered = JSON.stringify(rows);
    for (const name of ["A One", "A Two", "A Three", "A Four", "A Five", "A Six", "A Seven", "B One"]) {
      expect(rendered).not.toContain(name);
    }
    // The stage-total tie PASSes on every row.
    const tie = outcome.result!.assertions.find(
      (result) => result.id === "pipeline-stage-total-tie",
    );
    expect(tie?.status).toBe("PASS");
    // The grand totals: 8 applicants, 2 hired.
    const totals = new Map(outcome.result!.totals.map((total) => [total.id, total]));
    expect(totals.get("applicantTotal")?.amount).toBe("8");
    expect(totals.get("hiredTotal")?.amount).toBe("2");
  });

  it("the vacancyId and status filters narrow the pipeline", async () => {
    const byVacancy = await withTenant(TENANT_T47, () =>
      newRunService().run({
        reportKey: "hr.recruitment-pipeline",
        params: { vacancyId: spec.vacancyFilledId!, locale: "en" },
        ctx: fullContext(TENANT_T47),
      }),
    );
    expect(byVacancy.status).toBe("SUCCEEDED");
    expect(byVacancy.result!.rows).toHaveLength(1);
    expect(byVacancy.result!.rows[0]!.values.vacancy).toBe("V-FILLED");

    const byStatus = await withTenant(TENANT_T47, () =>
      newRunService().run({
        reportKey: "hr.recruitment-pipeline",
        params: { status: "FILLED", locale: "en" },
        ctx: fullContext(TENANT_T47),
      }),
    );
    expect(byStatus.status).toBe("SUCCEEDED");
    expect(byStatus.result!.rows.map((row) => row.values.vacancy)).toEqual(["V-FILLED"]);
  });

  it("hr.training-completions ships the in-window completions with the shape check PASS", async () => {
    const outcome = await withTenant(TENANT_T47, () =>
      newRunService().run({
        reportKey: "hr.training-completions",
        params: { dateFrom: "2026-07-01", dateTo: "2026-07-31", locale: "en" },
        ctx: fullContext(TENANT_T47),
      }),
    );
    expect(outcome.status).toBe("SUCCEEDED");
    const rows = outcome.result!.rows;
    // Exactly the course's two in-window completions — the ENROLLED
    // and WITHDRAWN rows and the workshop's outside-window completion
    // never ride.
    expect(rows).toHaveLength(2);
    const byEmployee = new Map(rows.map((row) => [row.values.employee as string, row]));
    expect(byEmployee.get("EMP-T47-1 — T47 First")!.values.result).toBe("PASSED");
    expect(byEmployee.get("EMP-T47-1 — T47 First")!.values.completionPct).toBe("100.00");
    expect(byEmployee.get("EMP-T47-1 — T47 First")!.values.completedAt).toBe("2026-07-10");
    expect(byEmployee.get("EMP-T47-2 — T47 Second")!.values.completionPct).toBe("90.00");
    // The completion-shape assertion PASSes.
    const shape = outcome.result!.assertions.find(
      (result) => result.id === "training-completion-shape",
    );
    expect(shape?.status).toBe("PASS");
    // The totals: 2 completions, the exact 2dp average (100 + 90)/2.
    const totals = new Map(outcome.result!.totals.map((total) => [total.id, total]));
    expect(totals.get("completedCount")?.amount).toBe("2");
    expect(totals.get("avgCompletionPct")?.amount).toBe("95.00");
  });

  it("the programId filter narrows to the workshop's outside-window world (empty in-window)", async () => {
    const outcome = await withTenant(TENANT_T47, () =>
      newRunService().run({
        reportKey: "hr.training-completions",
        params: {
          dateFrom: "2026-07-01",
          dateTo: "2026-07-31",
          programId: spec.programWorkshopId!,
          locale: "en",
        },
        ctx: fullContext(TENANT_T47),
      }),
    );
    expect(outcome.status).toBe("SUCCEEDED");
    expect(outcome.result!.rows).toHaveLength(0);
  });

  it("hr.document-expiry renders the banded register with the A-4 bait scan and the vocabulary PASS", async () => {
    const outcome = await withTenant(TENANT_T47, () =>
      newRunService().run({
        reportKey: "hr.document-expiry",
        params: { daysAhead: 30, locale: "en" },
        ctx: fullContext(TENANT_T47),
      }),
    );
    expect(outcome.status).toBe("SUCCEEDED");
    const rows = outcome.result!.rows;
    // Exactly the four in-window documents: the expired iqama (−5),
    // the +10 passport, the +25 visa, the +3 iqama. The +90 contract
    // (beyond the 30-day window) and the NULL-expiry doc never ride.
    expect(rows).toHaveLength(4);
    const byDays = new Map(rows.map((row) => [row.values.daysRemaining as number, row]));
    expect(byDays.get(-5)!.values.kind).toBe("IQAMA");
    expect(byDays.get(-5)!.values.band).toBe("BAND_0");
    expect(byDays.get(10)!.values.kind).toBe("PASSPORT");
    expect(byDays.get(10)!.values.band).toBe("BAND_30");
    expect(byDays.get(25)!.values.kind).toBe("VISA");
    expect(byDays.get(25)!.values.band).toBe("BAND_30");
    expect(byDays.get(3)!.values.kind).toBe("IQAMA");
    expect(byDays.get(3)!.values.band).toBe("BAND_7"); // the (0,7] band
    // THE A-4 BAIT SCAN: the document number never appears in any
    // rendered byte (the payslips law).
    expect(JSON.stringify(rows)).not.toContain(DOC_BAIT);
    // The band vocabulary PASSes.
    const vocabulary = outcome.result!.assertions.find(
      (result) => result.id === "document-band-vocabulary",
    );
    expect(vocabulary?.status).toBe("PASS");
    // The totals: 4 documents, 1 already expired.
    const totals = new Map(outcome.result!.totals.map((total) => [total.id, total]));
    expect(totals.get("documentCount")?.amount).toBe("4");
    expect(totals.get("expiredCount")?.amount).toBe("1");
  });

  it("the wider window surfaces the beyond-band contract with the honest BEYOND label", async () => {
    const outcome = await withTenant(TENANT_T47, () =>
      newRunService().run({
        reportKey: "hr.document-expiry",
        params: { daysAhead: 90, locale: "en" },
        ctx: fullContext(TENANT_T47),
      }),
    );
    expect(outcome.status).toBe("SUCCEEDED");
    const rows = outcome.result!.rows;
    expect(rows).toHaveLength(5);
    const contractRow = rows.find((row) => row.values.kind === "CONTRACT");
    expect(contractRow).toBeDefined();
    // The +90 contract sits past every configured band → BEYOND.
    expect(contractRow!.values.band).toBe("BEYOND");
    // The vocabulary still PASSes (BEYOND is the honest label).
    const vocabulary = outcome.result!.assertions.find(
      (result) => result.id === "document-band-vocabulary",
    );
    expect(vocabulary?.status).toBe("PASS");
  });

  it("the kind filter narrows to the iqama register", async () => {
    const outcome = await withTenant(TENANT_T47, () =>
      newRunService().run({
        reportKey: "hr.document-expiry",
        params: { daysAhead: 30, kind: "IQAMA", locale: "en" },
        ctx: fullContext(TENANT_T47),
      }),
    );
    expect(outcome.status).toBe("SUCCEEDED");
    expect(outcome.result!.rows).toHaveLength(2);
    for (const row of outcome.result!.rows) {
      expect(row.values.kind).toBe("IQAMA");
    }
  });

  it("THE TENANT-CONFIG ARM (red line 5): a registered threshold row re-bands the register — the bands follow the tenant's DATA, never constants", async () => {
    // Register the tenant's own sweep config with [60, 15] — the
    // documented 30/7/0 default must give way to the tenant's DATA
    // (the same hr_alert_jobs source the sweep reads).
    const su: Client = await superuserClient();
    await su.query(
      `INSERT INTO hr_alert_jobs (id, tenant_id, job_kind, thresholds, is_active, note, created_by)
       VALUES (gen_random_uuid(), $1, 'EXPIRY_SWEEP', '[60, 15]'::jsonb, true, 'T47 re-band probe', $2)
       ON CONFLICT (tenant_id, job_kind) DO UPDATE SET thresholds = EXCLUDED.thresholds`,
      [TENANT_T47, R_ACTOR],
    );
    await su.end();

    const outcome = await withTenant(TENANT_T47, () =>
      newRunService().run({
        reportKey: "hr.document-expiry",
        params: { daysAhead: 30, locale: "en" },
        ctx: fullContext(TENANT_T47),
      }),
    );
    expect(outcome.status).toBe("SUCCEEDED");
    const rows = outcome.result!.rows;
    expect(rows).toHaveLength(4);
    const byDays = new Map(rows.map((row) => [row.values.daysRemaining as number, row]));
    // The re-banded windows: (15, 60] and the open-edge ≤ 15.
    expect(byDays.get(25)!.values.band).toBe("BAND_60");
    expect(byDays.get(10)!.values.band).toBe("BAND_15");
    expect(byDays.get(3)!.values.band).toBe("BAND_15");
    expect(byDays.get(-5)!.values.band).toBe("BAND_15");
    // The vocabulary still PASSes (the labels are the tenant's own
    // thresholds now).
    const vocabulary = outcome.result!.assertions.find(
      (result) => result.id === "document-band-vocabulary",
    );
    expect(vocabulary?.status).toBe("PASS");
  });

  it("the talent world stays tenant-scoped (the T47-isolation floor)", async () => {
    // A cross-tenant probe: the world exists under TENANT_T47 through
    // superuser while every report above ran only inside its scope.
    const su: Client = await superuserClient();
    const counted = await su.query(
      `SELECT
         (SELECT count(*)::int FROM applicants WHERE tenant_id = $1) AS applicants,
         (SELECT count(*)::int FROM employee_documents WHERE tenant_id = $1) AS documents,
         (SELECT count(*)::int FROM performance_reviews WHERE tenant_id = $1) AS reviews`,
      [TENANT_T47],
    );
    await su.end();
    expect(counted.rows[0]!.applicants).toBe(8);
    expect(counted.rows[0]!.documents).toBe(6);
    expect(counted.rows[0]!.reviews).toBe(5);
  });

  it("sessions without the module key are denied before params bind (one per contract)", async () => {
    const deniedCtx = fullContext(TENANT_T47, {
      permissions: new Set(["reporting.reports.run"]),
    });
    const cases: Array<{
      reportKey: string;
      params: Record<string, unknown>;
      key: string;
    }> = [
      {
        reportKey: "hr.performance-cycle-results",
        params: { cycleId: spec.cycleId!, locale: "en" },
        key: "hr.performance.view",
      },
      {
        reportKey: "hr.recruitment-pipeline",
        params: { locale: "en" },
        key: "hr.recruitment.view",
      },
      {
        reportKey: "hr.training-completions",
        params: { dateFrom: "2026-07-01", dateTo: "2026-07-31", locale: "en" },
        key: "hr.training.view",
      },
      {
        reportKey: "hr.document-expiry",
        params: { daysAhead: 30, locale: "en" },
        key: "hr.documents.manage",
      },
    ];
    for (const { reportKey, params } of cases) {
      await expect(
        withTenant(TENANT_T47, () =>
          newRunService().run({
            reportKey,
            params,
            ctx: deniedCtx,
          }),
        ),
      ).rejects.toThrowError(PermissionDeniedError);
    }
    // And the keys themselves are in the known catalog the fixture
    // grants (the §12 convention's boot parity).
    for (const { key } of cases) {
      expect(ALL_KNOWN_PERMISSIONS.has(key)).toBe(true);
    }
  });
});
