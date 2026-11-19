import { beforeAll, describe, expect, it } from "vitest";
import type { Client } from "pg";

import { generateUuidV7 } from "@erp/domain-core";

import { withTenant } from "../../infra/db/tenant-context";
import { AuditService } from "../../modules/audit/api/audit";
import { DrizzleAuditStore } from "../../modules/audit/infrastructure/drizzle-audit.store";
import { TalentBridgesService } from "../../modules/hr/application/talent-bridges-service";
import { TalentGoalsService } from "../../modules/hr/application/talent-goals-service";
import { TalentOrgService } from "../../modules/hr/application/talent-org-service";
import { TalentPerformanceService } from "../../modules/hr/application/talent-performance-service";
import { TalentTrainingService } from "../../modules/hr/application/talent-training-service";
import {
  BridgeImportInvalidError,
  CycleStateConflictError,
  TalentCycleNotFoundError,
} from "../../modules/hr/domain/talent-errors";
import { ensureTestDb, seedTenants, superuserClient } from "../test-db";
import { H_ACTOR, setupHrFixture } from "./fixtures";
import { materializeCanonicalCompetencyScale } from "../../modules/hr/infrastructure/talent-canonical";

/**
 * PHASE-047 (W-4 — T-10, D-07) — the external HR bridges pinned over
 * real PostgreSQL 16 (the plan §4's `talent-bridges.db.spec`):
 * acceptance #9's bridge criteria — the three export contracts
 * (employee master + org snapshot as CSV/JSON with the A-4 PII
 * cross-check proven against SEEDED BAIT columns) and the two import
 * paths with row-level validation reports (every typed reason arm,
 * the in-file collapse law, the idempotence laws: ALREADY_COMPLETED
 * never re-stamps completed_at, ALREADY_SUBMITTED never rewrites an
 * immutable review).
 *
 * THE DEDICATED TENANT (the reorder-inapp precedent): a fresh
 * TENANT_HB whose employee EMP-BR-1 carries the full PII bait
 * (national_id, bank fields, nationality, probation_end — the A-4
 * forbidden axes). Every export payload assertion includes the bait
 * scan: the values must NEVER appear in any rendered byte.
 *
 * BR-090's posture is pinned from the export side: the seeded 360
 * PEER input and the DRAFT manager review NEVER ride the
 * appraisal-results contract, and no reviewer column exists.
 */

const audit = new AuditService(new DrizzleAuditStore());
const performanceSvc = new TalentPerformanceService(audit);
const trainingSvc = new TalentTrainingService(audit);
const orgSvc = new TalentOrgService(audit);
const goalsSvc = new TalentGoalsService(audit);
const bridgesSvc = new TalentBridgesService(audit, performanceSvc, trainingSvc);

/** THE DEDICATED BRIDGE TENANT. */
const TENANT_HB = "7a7a7a7a-7a7a-7a7a-7a7a-7a7a7a7a7b4b";
const HB_ACTOR = "7a7a7a7a-0000-4000-8000-0000000007b4";

/** The A-4 bait values (unique strings — the payload scan keys). */
const BAIT = {
  nationalId: "BAIT-NID-998877",
  bankIban: "BAITIBAN000000",
  bankAccount: "BAIT-ACCOUNT-1",
  bankName: "BAIT BANK",
  nationality: "SB",
} as const;

const spec: {
  employees?: Map<string, string>;
  activeCycleId?: string;
  calibrationCycleId?: string;
  competencyId?: string;
  programActiveId?: string;
  programRetiredId?: string;
} = {};

beforeAll(async () => {
  await setupHrFixture();
  ensureTestDb();
  const su: Client = await superuserClient();
  await seedTenants(su as never);
  // The canonical 1–5 scale for the bridge tenant — the fixture tenant
  // is raw-created (neither the 0098 §4 migration sweep nor the
  // onboarding hook runs for it), so the spec materializes the scale
  // itself (the W-2 performance spec's exact precedent).
  await su.query(
    `INSERT INTO tenants (id, name, name_ar, base_currency, country_code, timezone) VALUES
       ($1, 'Tenant HB (hr bridges)', 'المستأجر هـ-ب', 'SAR', 'SA', 'Asia/Riyadh')
     ON CONFLICT (id) DO NOTHING`,
    [TENANT_HB],
  );
  await withTenant(TENANT_HB, () => materializeCanonicalCompetencyScale());
  await su.query(
    `INSERT INTO users (id, email, full_name, password_hash, status, locale)
     VALUES ($1, 'hb-actor@fixture.test', 'HB Bridge Actor', 'x', 'ACTIVE', 'ar')
     ON CONFLICT (id) DO NOTHING`,
    [HB_ACTOR],
  );
  // The cast: six employees — BR-1 (manager, the PII bait carrier),
  // BR-2 (the submitted-reviewee with goals), BR-3 (the peer + the
  // draft reviewee), BR-4 (position-less), BR-10 (the import reviewee
  // with clean goals… none), BR-11 (the BR-089 arm's reviewee, goals
  // summing 80%).
  const employees = await su.query<{ id: string; code: string }>(
    `INSERT INTO employees (id, tenant_id, code, name, name_ar, hire_date, contract_type, basic_salary,
                            national_id, bank_name, bank_iban, bank_account, nationality, probation_end, created_by) VALUES
       (gen_random_uuid(), $1, 'EMP-BR-1', 'Bridge Manager', 'مدير الجسور', '2025-01-01', 'FULL_TIME', 9500,
        $2, $3, $4, $5, $6, CURRENT_DATE + 30, $7),
       (gen_random_uuid(), $1, 'EMP-BR-2', 'Submitted Reviewee', 'موظف مُقيَّم', '2025-02-01', 'FULL_TIME', 9000, NULL, NULL, NULL, NULL, NULL, NULL, $7),
       (gen_random_uuid(), $1, 'EMP-BR-3', 'Peer Reviewer', 'زميل مُقيِّم', '2025-03-01', 'FULL_TIME', 8500, NULL, NULL, NULL, NULL, NULL, NULL, $7),
       (gen_random_uuid(), $1, 'EMP-BR-4', 'No Position', 'بلا وظيفة', '2025-04-01', 'PART_TIME', 7500, NULL, NULL, NULL, NULL, NULL, NULL, $7),
       (gen_random_uuid(), $1, 'EMP-BR-10', 'Import Reviewee', 'موظف الاستيراد', '2025-05-01', 'FULL_TIME', 8200, NULL, NULL, NULL, NULL, NULL, NULL, $7),
       (gen_random_uuid(), $1, 'EMP-BR-11', 'Bad Weights', 'أوزان ناقصة', '2025-05-01', 'FULL_TIME', 8200, NULL, NULL, NULL, NULL, NULL, NULL, $7),
       (gen_random_uuid(), $1, 'EMP-BR-5', 'Terminated Reviewee', 'موظف منتهي', '2024-01-01', 'FULL_TIME', 8000, NULL, NULL, NULL, NULL, NULL, NULL, $7)
     ON CONFLICT (tenant_id, code) DO UPDATE SET name = EXCLUDED.name
     RETURNING id, code`,
    [
      TENANT_HB,
      BAIT.nationalId,
      BAIT.bankName,
      BAIT.bankIban,
      BAIT.bankAccount,
      BAIT.nationality,
      HB_ACTOR,
    ],
  );
  spec.employees = new Map(employees.rows.map((row) => [row.code, row.id]));

  // The org tree + positions (the D-09 laws ride the service).
  const hq = await withTenant(TENANT_HB, () =>
    orgSvc.createOrgUnit({
      code: "HQ",
      name: "Headquarters",
      nameAr: "المقر الرئيسي",
      parentId: null,
      actorId: HB_ACTOR,
    }),
  );
  const sales = await withTenant(TENANT_HB, () =>
    orgSvc.createOrgUnit({
      code: "SALES_EAST",
      name: "Sales East",
      nameAr: "المبيعات الشرقية",
      parentId: hq.id,
      actorId: HB_ACTOR,
    }),
  );
  const ceoPosition = await withTenant(TENANT_HB, () =>
    orgSvc.createPosition({
      code: "CEO",
      title: "Chief Executive",
      titleAr: "الرئيس التنفيذي",
      grade: "A",
      orgUnitId: hq.id,
      reportsTo: null,
      actorId: HB_ACTOR,
    }),
  );
  const salesManager = await withTenant(TENANT_HB, () =>
    orgSvc.createPosition({
      code: "SALESMGR",
      title: "Sales Manager",
      titleAr: "مدير المبيعات",
      grade: "B",
      orgUnitId: sales.id,
      reportsTo: ceoPosition.id,
      actorId: HB_ACTOR,
    }),
  );
  // The placement seeds (the spec's raw writes — D-01: no 047 route
  // writes the employees table; the bridge only READS it).
  await su.query(
    `UPDATE employees SET position_id = $2 WHERE tenant_id = $1 AND code IN ('EMP-BR-1', 'EMP-BR-10')`,
    [TENANT_HB, salesManager.id],
  );
  await su.query(
    `UPDATE employees SET position_id = $2 WHERE tenant_id = $1 AND code = 'EMP-BR-2'`,
    [TENANT_HB, ceoPosition.id],
  );

  await su.query(
    `UPDATE employees SET position_id = $2, status = 'TERMINATED', termination_date = '2025-06-30'
      WHERE tenant_id = $1 AND code = 'EMP-BR-5'`,
    [TENANT_HB, salesManager.id],
  );

  // The competency dictionary (the scorecard law's axis).
  const competency = await withTenant(TENANT_HB, () =>
    performanceSvc.createCompetency({
      code: "COMM-B",
      name: "Bridge Communication",
      nameAr: "تواصل الجسور",
      category: null,
      actorId: HB_ACTOR,
    }),
  );
  spec.competencyId = competency.id;

  // CYCLE 1 (the ACTIVE cycle): goals seeded while DRAFT (the window
  // law) — BR-2's set sums exactly 100% (40+60, the W-2 worked
  // example: rollup 40%@50 + 60%@75 = 65.00); BR-11's set sums 80%
  // (the BR-089 import arm).
  const activeCycle = await withTenant(TENANT_HB, () =>
    performanceSvc.createCycle({
      name: "HB Active Cycle",
      nameAr: null,
      periodStart: "2026-01-01",
      periodEnd: "2026-12-31",
      reviewDueDate: null,
      scopeOrgUnitIds: [],
      actorId: HB_ACTOR,
    }),
  );
  await withTenant(TENANT_HB, async () => {
    const goalA = await goalsSvc.createGoal({
      cycleId: activeCycle.id,
      ownerEmployeeId: spec.employees!.get("EMP-BR-2")!,
      parentGoalId: null,
      title: "HB Goal A",
      titleAr: null,
      weight: "40.00",
      kriTarget: null,
      dueDate: null,
      actorId: HB_ACTOR,
    });
    await goalsSvc.createGoal({
      cycleId: activeCycle.id,
      ownerEmployeeId: spec.employees!.get("EMP-BR-2")!,
      parentGoalId: null,
      title: "HB Goal B",
      titleAr: null,
      weight: "60.00",
      kriTarget: null,
      dueDate: null,
      actorId: HB_ACTOR,
    });
    await goalsSvc.createGoal({
      cycleId: activeCycle.id,
      ownerEmployeeId: spec.employees!.get("EMP-BR-11")!,
      parentGoalId: null,
      title: "HB Short Goal",
      titleAr: null,
      weight: "80.00",
      kriTarget: null,
      dueDate: null,
      actorId: HB_ACTOR,
    });
    await performanceSvc.transitionCycle(activeCycle.id, "activate", HB_ACTOR);
    // The rollup's worked example: 40%@50 + 60%@75 = 65.00 (the W-2
    // spec's own arithmetic, reused as the export pin).
    await goalsSvc.updateOwnGoalProgress({
      goalId: goalA.id,
      actingEmployeeId: spec.employees!.get("EMP-BR-2")!,
      progressPct: "50.00",
      actorId: HB_ACTOR,
    });
    const own = await goalsSvc.listOwnGoals(spec.employees!.get("EMP-BR-2")!, activeCycle.id);
    const goalB = own.find((goal) => goal.title === "HB Goal B")!;
    await goalsSvc.updateOwnGoalProgress({
      goalId: goalB.id,
      actingEmployeeId: spec.employees!.get("EMP-BR-2")!,
      progressPct: "75.00",
      actorId: HB_ACTOR,
    });
  });
  spec.activeCycleId = activeCycle.id;

  // The submitted MANAGER review (the export's row: BR-2 by BR-1,
  // score 88.50, rollup 65.00), the PEER input (NEVER exports), and
  // the DRAFT manager review for BR-3 (NEVER exports).
  await withTenant(TENANT_HB, () =>
    performanceSvc.submitReview({
      cycleId: activeCycle.id,
      reviewerEmployeeId: spec.employees!.get("EMP-BR-1")!,
      revieweeEmployeeId: spec.employees!.get("EMP-BR-2")!,
      kind: "MANAGER",
      overallScore: "88.50",
      competencyScores: { [competency.id]: 4 },
      comments: null,
      actorId: HB_ACTOR,
    }),
  );
  await withTenant(TENANT_HB, () =>
    performanceSvc.submitReview({
      cycleId: activeCycle.id,
      reviewerEmployeeId: spec.employees!.get("EMP-BR-3")!,
      revieweeEmployeeId: spec.employees!.get("EMP-BR-2")!,
      kind: "PEER",
      overallScore: "70.00",
      competencyScores: {},
      comments: null,
      actorId: HB_ACTOR,
    }),
  );
  await withTenant(TENANT_HB, () =>
    performanceSvc.saveReviewDraft({
      cycleId: activeCycle.id,
      reviewerEmployeeId: spec.employees!.get("EMP-BR-1")!,
      revieweeEmployeeId: spec.employees!.get("EMP-BR-3")!,
      kind: "MANAGER",
      overallScore: "60.00",
      competencyScores: {},
      comments: null,
      actorId: HB_ACTOR,
    }),
  );

  // CYCLE 2 (the CALIBRATION cycle): BR-3's manager review submitted
  // then calibrated — the CALIBRATED export arm.
  const calibrationCycle = await withTenant(TENANT_HB, () =>
    performanceSvc.createCycle({
      name: "HB Calibration Cycle",
      nameAr: null,
      periodStart: "2025-01-01",
      periodEnd: "2025-12-31",
      reviewDueDate: null,
      scopeOrgUnitIds: [],
      actorId: HB_ACTOR,
    }),
  );
  await withTenant(TENANT_HB, async () => {
    await performanceSvc.transitionCycle(calibrationCycle.id, "activate", HB_ACTOR);
    await performanceSvc.submitReview({
      cycleId: calibrationCycle.id,
      reviewerEmployeeId: spec.employees!.get("EMP-BR-1")!,
      revieweeEmployeeId: spec.employees!.get("EMP-BR-3")!,
      kind: "MANAGER",
      overallScore: "72.00",
      competencyScores: {},
      comments: null,
      actorId: HB_ACTOR,
    });
    await performanceSvc.transitionCycle(calibrationCycle.id, "calibrate", HB_ACTOR);
    await performanceSvc.calibrateReview({
      cycleId: calibrationCycle.id,
      revieweeEmployeeId: spec.employees!.get("EMP-BR-3")!,
      overallScore: "75.00",
      comments: null,
      actorId: HB_ACTOR,
    });
  });
  spec.calibrationCycleId = calibrationCycle.id;

  // The training fixtures: PROG-B (ACTIVE) with three enrollments
  // (COMPLETED for BR-2, WITHDRAWN for BR-3, ENROLLED for BR-4) and
  // PROG-R (RETIRED — the import's PROGRAM_RETIRED arm).
  const programActive = await withTenant(TENANT_HB, () =>
    trainingSvc.createProgram({
      code: "PROG-B",
      name: "Bridge Program",
      nameAr: null,
      kind: "INTERNAL",
      provider: null,
      cost: "1500.00",
      notes: null,
      actorId: HB_ACTOR,
    }),
  );
  spec.programActiveId = programActive.id;
  await withTenant(TENANT_HB, async () => {
    const completed = await trainingSvc.enroll({
      programId: programActive.id,
      employeeId: spec.employees!.get("EMP-BR-2")!,
      notes: null,
      actorId: HB_ACTOR,
    });
    await trainingSvc.updateEnrollment({
      id: completed.id,
      status: "COMPLETED",
      attendancePct: "100.00",
      completionPct: "90.00",
      result: "PASSED",
      notes: null,
      actorId: HB_ACTOR,
    });
    const withdrawn = await trainingSvc.enroll({
      programId: programActive.id,
      employeeId: spec.employees!.get("EMP-BR-3")!,
      notes: null,
      actorId: HB_ACTOR,
    });
    await trainingSvc.updateEnrollment({
      id: withdrawn.id,
      status: "WITHDRAWN",
      attendancePct: null,
      completionPct: null,
      result: null,
      notes: null,
      actorId: HB_ACTOR,
    });
    await trainingSvc.enroll({
      programId: programActive.id,
      employeeId: spec.employees!.get("EMP-BR-4")!,
      notes: null,
      actorId: HB_ACTOR,
    });
    const programRetired = await trainingSvc.createProgram({
      code: "PROG-R",
      name: "Retired Program",
      nameAr: null,
      kind: "INTERNAL",
      provider: null,
      cost: null,
      notes: null,
      actorId: HB_ACTOR,
    });
    await trainingSvc.updateProgram({
      id: programRetired.id,
      status: "RETIRED",
      actorId: HB_ACTOR,
    });
    spec.programRetiredId = programRetired.id;
  });
  await su.end();
});

/** The bait scan: NO forbidden value ever appears in a rendered payload. */
function assertNoBait(payload: string): void {
  expect(payload).not.toContain(BAIT.nationalId);
  expect(payload).not.toContain(BAIT.bankIban);
  expect(payload).not.toContain(BAIT.bankAccount);
  expect(payload).not.toContain(BAIT.bankName);
  // The 2-char nationality code rides the low-entropy scan through the
  // dedicated columns law instead (it would false-positive on any
  // occurrence of "SB" in base64/ids): the contract's column list
  // carries no nationality axis (unit-pinned), and the payload scan
  // pins the high-entropy baits.
}

describe("PHASE-047 W-4 — the three export contracts (acceptance #9, A-4)", () => {
  it("(a1) employee-master CSV: BOM + CRLF + the locale header + every employee row, the placement-free seven columns", async () => {
    const result = await withTenant(TENANT_HB, () =>
      bridgesSvc.exportContract({
        contract: "hr.employee-master",
        format: "csv",
        locale: "en",
        actorId: HB_ACTOR,
      }),
    );
    expect(result.contentType).toBe("text/csv; charset=utf-8");
    expect(result.filename).toMatch(/^hr-employee-master-\d{4}-\d{2}-\d{2}\.csv$/);
    expect(result.rowCount).toBe(7);
    const csv = result.bytes.toString("utf8");
    expect(csv.startsWith("\uFEFF")).toBe(true);
    const lines = csv.replace(/^\uFEFF/, "").split("\r\n");
    expect(lines[0]).toBe(
      "Employee Code,Employee Name,Employee Name (AR),Contract Type,Employment Status,Hire Date,Termination Date",
    );
    const managerRow = lines.find((line) => line.startsWith("EMP-BR-1,"))!;
    expect(managerRow).toContain("Bridge Manager");
    expect(managerRow).toContain("مدير الجسور");
    expect(managerRow).toContain("FULL_TIME");
    expect(managerRow).toContain("2025-01-01");
    // A-4: the bait never rides the file (the high-entropy values).
    assertNoBait(csv);
    // The Arabic header at locale=ar.
    const arabic = await withTenant(TENANT_HB, () =>
      bridgesSvc.exportContract({
        contract: "hr.employee-master",
        format: "csv",
        locale: "ar",
        actorId: HB_ACTOR,
      }),
    );
    expect(arabic.bytes.toString("utf8")).toContain("رمز الموظف");
  });

  it("(a2) employee-master JSON: the self-describing envelope with the same rows", async () => {
    const result = await withTenant(TENANT_HB, () =>
      bridgesSvc.exportContract({
        contract: "hr.employee-master",
        format: "json",
        locale: "en",
        actorId: HB_ACTOR,
      }),
    );
    expect(result.contentType).toBe("application/json; charset=utf-8");
    const envelope = JSON.parse(result.bytes.toString("utf8")) as {
      contract: string;
      version: number;
      rowCount: number;
      columns: { id: string }[];
      rows: Record<string, string | null>[];
    };
    expect(envelope.contract).toBe("hr.employee-master");
    expect(envelope.version).toBe(1);
    expect(envelope.rowCount).toBe(7);
    expect(envelope.columns.map((column) => column.id)).toEqual([
      "employeeCode",
      "employeeName",
      "employeeNameAr",
      "contractType",
      "employmentStatus",
      "hireDate",
      "terminationDate",
    ]);
    const manager = envelope.rows.find((row) => row.employeeCode === "EMP-BR-1")!;
    expect(manager.employeeName).toBe("Bridge Manager");
    assertNoBait(result.bytes.toString("utf8"));
  });

  it("(b) employment-org-snapshot: the placement + org axes ship; the position-less employee ships with empty columns; A-4 holds", async () => {
    const result = await withTenant(TENANT_HB, () =>
      bridgesSvc.exportContract({
        contract: "hr.employment-org-snapshot",
        format: "json",
        locale: "en",
        actorId: HB_ACTOR,
      }),
    );
    const envelope = JSON.parse(result.bytes.toString("utf8")) as {
      rows: Record<string, string | null | boolean>[];
    };
    const manager = envelope.rows.find((row) => row.employeeCode === "EMP-BR-1")!;
    expect(manager.positionCode).toBe("SALESMGR");
    expect(manager.orgUnitCode).toBe("SALES_EAST");
    expect(manager.orgUnitPath).toBe("HQ.SALES_EAST");
    expect(manager.reportsToPositionCode).toBe("CEO");
    const unplaced = envelope.rows.find((row) => row.employeeCode === "EMP-BR-4")!;
    expect(unplaced.positionCode).toBeNull();
    expect(unplaced.orgUnitCode).toBeNull();
    assertNoBait(result.bytes.toString("utf8"));
  });

  it("(c) appraisal-results: the SUBMITTED + CALIBRATED manager outcomes ship with the exact rollup; the PEER input and the DRAFT row NEVER; no reviewer axis", async () => {
    const result = await withTenant(TENANT_HB, () =>
      bridgesSvc.exportContract({
        contract: "hr.appraisal-results",
        format: "json",
        locale: "en",
        actorId: HB_ACTOR,
      }),
    );
    const envelope = JSON.parse(result.bytes.toString("utf8")) as {
      rows: Record<string, string | null>[];
      columns: { id: string }[];
    };
    expect(envelope.columns.map((column) => column.id)).not.toContain("reviewerEmployeeCode");
    // BR-2 in the active cycle: SUBMITTED, 88.50 + the goal rollup.
    const submitted = envelope.rows.find(
      (row) => row.employeeCode === "EMP-BR-2" && row.reviewStatus === "SUBMITTED",
    )!;
    expect(submitted.overallScore).toBe("88.50");
    expect(submitted.goalRollup).toBe("65.00");
    expect(submitted.cycleName).toBe("HB Active Cycle");
    // BR-3 in the calibration cycle: CALIBRATED at the calibrated score.
    const calibrated = envelope.rows.find(
      (row) => row.employeeCode === "EMP-BR-3" && row.reviewStatus === "CALIBRATED",
    )!;
    expect(calibrated.overallScore).toBe("75.00");
    // The never-ships: the PEER input (BR-3 → BR-2) and BR-3's DRAFT
    // manager review — BR-3 appears ONCE (the calibrated row).
    expect(
      envelope.rows.filter((row) => row.employeeCode === "EMP-BR-3"),
    ).toHaveLength(1);
    expect(envelope.rows.every((row) => row.employeeCode !== "EMP-BR-2" || row.reviewStatus !== "DRAFT")).toBe(true);
    assertNoBait(result.bytes.toString("utf8"));
  });

  it("(c2) the cycleId filter + the typed 404 for an unknown/foreign cycle (A7 parity)", async () => {
    const filtered = await withTenant(TENANT_HB, () =>
      bridgesSvc.exportContract({
        contract: "hr.appraisal-results",
        format: "json",
        locale: "en",
        cycleId: spec.calibrationCycleId,
        actorId: HB_ACTOR,
      }),
    );
    const envelope = JSON.parse(filtered.bytes.toString("utf8")) as {
      rows: Record<string, string | null>[];
    };
    expect(envelope.rows).toHaveLength(1);
    expect(envelope.rows[0]!.cycleName).toBe("HB Calibration Cycle");
    await expect(
      withTenant(TENANT_HB, () =>
        bridgesSvc.exportContract({
          contract: "hr.appraisal-results",
          format: "json",
          locale: "en",
          cycleId: generateUuidV7(),
          actorId: HB_ACTOR,
        }),
      ),
    ).rejects.toBeInstanceOf(TalentCycleNotFoundError);
  });

  it("(f) the tenant boundary: the exports are RLS-scoped — the shared tenant H sees ZERO HB rows", async () => {
    const result = await withTenant(
      "7a7a7a7a-7a7a-7a7a-7a7a-7a7a7a7a7a7a",
      () =>
        bridgesSvc.exportContract({
          contract: "hr.employee-master",
          format: "json",
          locale: "en",
          actorId: H_ACTOR,
        }),
    );
    const envelope = JSON.parse(result.bytes.toString("utf8")) as {
      rows: Record<string, string | null>[];
    };
    expect(envelope.rows.every((row) => !row.employeeCode!.startsWith("EMP-BR-"))).toBe(true);
  });

  it("(g) the generation is audited (hr.bridge_exported — the remittance precedent's audited-artifact law)", async () => {
    const su: Client = await superuserClient();
    const rows = await su.query<{ n: number }>(
      `SELECT count(*)::int AS n FROM audit_events
        WHERE tenant_id = $1 AND action = 'hr.bridge_exported'
          AND entity_type = 'hr_bridge' AND after->>'contract' = 'hr.employee-master'`,
      [TENANT_HB],
    );
    await su.end();
    expect(rows.rows[0]!.n).toBeGreaterThanOrEqual(2);
  });
});

describe("PHASE-047 W-4 — the appraisal-results import (the row-level report)", () => {
  it("(d1) the happy rows: a MANAGER row by competency CODE lands SUBMITTED with the scorecard translated; a PEER input row lands too", async () => {
    const report = await withTenant(TENANT_HB, () =>
      bridgesSvc.importAppraisalResults({
        cycleId: spec.activeCycleId!,
        rows: [
          {
            revieweeCode: "EMP-BR-10",
            reviewerCode: "EMP-BR-1",
            kind: "MANAGER",
            overallScore: "91.25",
            competencyScores: { "COMM-B": 5 },
            comments: "imported appraisal",
          },
          {
            revieweeCode: "EMP-BR-10",
            reviewerCode: "EMP-BR-3",
            kind: "PEER",
            overallScore: "80.00",
            competencyScores: {},
            comments: null,
          },
        ],
        actorId: HB_ACTOR,
      }),
    );
    expect(report.kind).toBe("appraisal-results");
    expect(report.acceptedCount).toBe(2);
    expect(report.rejectedCount).toBe(0);
    // The created reviews read back SUBMITTED with the exact payload.
    const su: Client = await superuserClient();
    const reviews = await su.query<{ status: string; overall: string | null; scores: Record<string, number> }>(
      `SELECT r.status, r.overall_score::text AS overall, r.competency_scores AS scores
         FROM performance_reviews r
        WHERE r.tenant_id = $1 AND r.cycle_id = $2 AND r.reviewee_employee_id = $3
          AND r.reviewer_employee_id IN ($4, $5)`,
      [
        TENANT_HB,
        spec.activeCycleId,
        spec.employees!.get("EMP-BR-10")!,
        spec.employees!.get("EMP-BR-1")!,
        spec.employees!.get("EMP-BR-3")!,
      ],
    );
    await su.end();
    expect(reviews.rows).toHaveLength(2);
    expect(reviews.rows.every((row) => row.status === "SUBMITTED")).toBe(true);
    const manager = reviews.rows.find((row) => row.overall === "91.25")!;
    expect(manager.scores[spec.competencyId!]).toBe(5);
  });

  it("(d2) the typed rejections: every reason arm in ONE file (the report continues past bad rows)", async () => {
    const report = await withTenant(TENANT_HB, () =>
      bridgesSvc.importAppraisalResults({
        cycleId: spec.activeCycleId!,
        rows: [
          // A legal row first (the anchor).
          {
            revieweeCode: "EMP-BR-4",
            reviewerCode: "EMP-BR-1",
            kind: "MANAGER",
            overallScore: "70.00",
            competencyScores: {},
            comments: null,
          },
          // DUPLICATE_IN_FILE: the same natural key again.
          {
            revieweeCode: "EMP-BR-4",
            reviewerCode: "EMP-BR-1",
            kind: "MANAGER",
            overallScore: "71.00",
            competencyScores: {},
            comments: null,
          },
          // UNKNOWN_REVIEWEE.
          {
            revieweeCode: "EMP-NOPE",
            reviewerCode: "EMP-BR-1",
            kind: "MANAGER",
            overallScore: "70.00",
            competencyScores: {},
            comments: null,
          },
          // UNKNOWN_REVIEWER.
          {
            revieweeCode: "EMP-BR-4",
            reviewerCode: "EMP-GHOST",
            kind: "MANAGER",
            overallScore: "70.00",
            competencyScores: {},
            comments: null,
          },
          // SELF_KIND_MISMATCH (SELF with a different reviewer).
          {
            revieweeCode: "EMP-BR-4",
            reviewerCode: "EMP-BR-1",
            kind: "SELF",
            overallScore: "70.00",
            competencyScores: {},
            comments: null,
          },
          // INVALID_FIELD (a number, not a 2-dp string).
          {
            revieweeCode: "EMP-BR-4",
            reviewerCode: "EMP-BR-2",
            kind: "MANAGER",
            overallScore: 70,
            competencyScores: {},
            comments: null,
          },
          // UNKNOWN_COMPETENCY (a code the tenant does not carry).
          {
            revieweeCode: "EMP-BR-4",
            reviewerCode: "EMP-BR-2",
            kind: "MANAGER",
            overallScore: "70.00",
            competencyScores: { "NO-SUCH-COMP": 3 },
            comments: null,
          },
          // ALREADY_SUBMITTED: BR-2's natural key from the seed.
          {
            revieweeCode: "EMP-BR-2",
            reviewerCode: "EMP-BR-1",
            kind: "MANAGER",
            overallScore: "99.00",
            competencyScores: {},
            comments: null,
          },
          // GOAL_WEIGHTS_INVALID: BR-11's goals sum 80% (BR-089).
          {
            revieweeCode: "EMP-BR-11",
            reviewerCode: "EMP-BR-1",
            kind: "MANAGER",
            overallScore: "70.00",
            competencyScores: {},
            comments: null,
          },
          // NOT_IN_CYCLE_SCOPE: a TERMINATED employee is out of the
          // empty-scope cycle's ACTIVE workforce (the scope law).
          {
            revieweeCode: "EMP-BR-5",
            reviewerCode: "EMP-BR-1",
            kind: "MANAGER",
            overallScore: "70.00",
            competencyScores: {},
            comments: null,
          },
          // NOT_IN_CYCLE_SCOPE's sibling: a foreign tenant's employee
          // code (A7 parity — unknown and foreign render identically).
          {
            revieweeCode: "EMP-H1",
            reviewerCode: "EMP-BR-1",
            kind: "MANAGER",
            overallScore: "70.00",
            competencyScores: {},
            comments: null,
          },
        ],
        actorId: HB_ACTOR,
      }),
    );
    expect(report.totalCount).toBe(11);
    expect(report.acceptedCount).toBe(1);
    expect(report.rejectedCount).toBe(10);
    const byIndex = new Map(report.rows.map((entry) => [entry.index, entry]));
    expect(byIndex.get(1)?.reason).toBe("DUPLICATE_IN_FILE");
    expect(byIndex.get(2)?.reason).toBe("UNKNOWN_REVIEWEE");
    expect(byIndex.get(3)?.reason).toBe("UNKNOWN_REVIEWER");
    expect(byIndex.get(4)?.reason).toBe("SELF_KIND_MISMATCH");
    expect(byIndex.get(5)?.reason).toBe("INVALID_FIELD");
    expect(byIndex.get(6)?.reason).toBe("UNKNOWN_COMPETENCY");
    expect(byIndex.get(7)?.reason).toBe("ALREADY_SUBMITTED");
    expect(byIndex.get(8)?.reason).toBe("GOAL_WEIGHTS_INVALID");
    expect(byIndex.get(8)?.detail).toContain("80.00");
    expect(byIndex.get(9)?.reason).toBe("NOT_IN_CYCLE_SCOPE");
    expect(byIndex.get(10)?.reason).toBe("UNKNOWN_REVIEWEE");
    // The rejected rows carry the raw row (the evidence).
    expect(byIndex.get(2)?.row).toMatchObject({ revieweeCode: "EMP-NOPE" });
  });

  it("(d3) the file-level refusals: unknown cycle 404 · non-ACTIVE cycle 409 · the empty/oversized batch 422", async () => {
    await expect(
      withTenant(TENANT_HB, () =>
        bridgesSvc.importAppraisalResults({
          cycleId: generateUuidV7(),
          rows: [
            {
              revieweeCode: "EMP-BR-4",
              reviewerCode: "EMP-BR-1",
              kind: "MANAGER",
              overallScore: "70.00",
              competencyScores: {},
              comments: null,
            },
          ],
          actorId: HB_ACTOR,
        }),
      ),
    ).rejects.toBeInstanceOf(TalentCycleNotFoundError);
    // The CALIBRATION cycle: submissions refuse (the window law).
    await expect(
      withTenant(TENANT_HB, () =>
        bridgesSvc.importAppraisalResults({
          cycleId: spec.calibrationCycleId!,
          rows: [
            {
              revieweeCode: "EMP-BR-4",
              reviewerCode: "EMP-BR-1",
              kind: "MANAGER",
              overallScore: "70.00",
              competencyScores: {},
              comments: null,
            },
          ],
          actorId: HB_ACTOR,
        }),
      ),
    ).rejects.toBeInstanceOf(CycleStateConflictError);
    await expect(
      withTenant(TENANT_HB, () =>
        bridgesSvc.importAppraisalResults({
          cycleId: spec.activeCycleId!,
          rows: [],
          actorId: HB_ACTOR,
        }),
      ),
    ).rejects.toBeInstanceOf(BridgeImportInvalidError);
  });
});

describe("PHASE-047 W-4 — the training-completions import (the row-level report)", () => {
  it("(e1) the happy rows: an ENROLLED row completes; a fresh pair enrolls then completes — read back with the exact stamps", async () => {
    const report = await withTenant(TENANT_HB, () =>
      bridgesSvc.importTrainingCompletions({
        rows: [
          // EMP-BR-4's ENROLLED row on PROG-B completes.
          {
            programCode: "PROG-B",
            employeeCode: "EMP-BR-4",
            attendancePct: "95.00",
            completionPct: "88.50",
            result: "PASSED",
            notes: "bridge completion",
          },
          // A fresh pair enrolls then completes.
          {
            programCode: "PROG-B",
            employeeCode: "EMP-BR-10",
            attendancePct: "100.00",
            completionPct: "92.00",
            result: "PASSED",
            notes: null,
          },
        ],
        actorId: HB_ACTOR,
      }),
    );
    expect(report.acceptedCount).toBe(2);
    const su: Client = await superuserClient();
    const rows = await su.query<{
      employee_code: string;
      status: string;
      result: string | null;
      completed_at: string | null;
    }>(
      `SELECT e.code AS employee_code, en.status, en.result, en.completed_at::text AS completed_at
         FROM training_enrollments en JOIN employees e ON e.id = en.employee_id
        WHERE en.tenant_id = $1 AND en.program_id = $2 AND e.code IN ('EMP-BR-4', 'EMP-BR-10')`,
      [TENANT_HB, spec.programActiveId],
    );
    await su.end();
    expect(rows.rows).toHaveLength(2);
    expect(rows.rows.every((row) => row.status === "COMPLETED")).toBe(true);
    expect(rows.rows.every((row) => row.result === "PASSED")).toBe(true);
    expect(rows.rows.every((row) => row.completed_at !== null)).toBe(true);
  });

  it("(e2) the typed rejections + the idempotence law: ALREADY_COMPLETED never re-stamps completed_at; WITHDRAWN/RETIRED/unknown/duplicate/shape arms", async () => {
    // The completed_at BEFORE the import (EMP-BR-2 completed in the seed).
    const su: Client = await superuserClient();
    const before = await su.query<{ completed_at: string }>(
      `SELECT en.completed_at::text AS completed_at FROM training_enrollments en
         JOIN employees e ON e.id = en.employee_id
        WHERE en.tenant_id = $1 AND en.program_id = $2 AND e.code = 'EMP-BR-2'`,
      [TENANT_HB, spec.programActiveId],
    );
    const completedAtBefore = before.rows[0]!.completed_at;

    const report = await withTenant(TENANT_HB, () =>
      bridgesSvc.importTrainingCompletions({
        rows: [
          // ALREADY_COMPLETED (the idempotence law).
          {
            programCode: "PROG-B",
            employeeCode: "EMP-BR-2",
            attendancePct: "10.00",
            completionPct: "10.00",
            result: "FAILED",
            notes: null,
          },
          // ENROLLMENT_WITHDRAWN.
          {
            programCode: "PROG-B",
            employeeCode: "EMP-BR-3",
            attendancePct: "50.00",
            completionPct: "50.00",
            result: "PENDING",
            notes: null,
          },
          // PROGRAM_RETIRED.
          {
            programCode: "PROG-R",
            employeeCode: "EMP-BR-4",
            attendancePct: null,
            completionPct: null,
            result: "PASSED",
            notes: null,
          },
          // UNKNOWN_PROGRAM.
          {
            programCode: "PROG-NOPE",
            employeeCode: "EMP-BR-4",
            attendancePct: null,
            completionPct: null,
            result: "PASSED",
            notes: null,
          },
          // UNKNOWN_EMPLOYEE (a foreign tenant's code too — A7 parity).
          {
            programCode: "PROG-B",
            employeeCode: "EMP-H1",
            attendancePct: null,
            completionPct: null,
            result: "PASSED",
            notes: null,
          },
          // INVALID_FIELD (a number percentage).
          {
            programCode: "PROG-B",
            employeeCode: "EMP-BR-11",
            attendancePct: 100,
            completionPct: null,
            result: "PASSED",
            notes: null,
          },
          // A legal anchor + its DUPLICATE_IN_FILE twin.
          {
            programCode: "PROG-B",
            employeeCode: "EMP-BR-11",
            attendancePct: "80.00",
            completionPct: "80.00",
            result: "PENDING",
            notes: null,
          },
          {
            programCode: "PROG-B",
            employeeCode: "EMP-BR-11",
            attendancePct: "85.00",
            completionPct: "85.00",
            result: "PASSED",
            notes: null,
          },
        ],
        actorId: HB_ACTOR,
      }),
    );
    expect(report.totalCount).toBe(8);
    expect(report.acceptedCount).toBe(1);
    expect(report.rejectedCount).toBe(7);
    const byIndex = new Map(report.rows.map((entry) => [entry.index, entry]));
    expect(byIndex.get(0)?.reason).toBe("ALREADY_COMPLETED");
    expect(byIndex.get(1)?.reason).toBe("ENROLLMENT_WITHDRAWN");
    expect(byIndex.get(2)?.reason).toBe("PROGRAM_RETIRED");
    expect(byIndex.get(3)?.reason).toBe("UNKNOWN_PROGRAM");
    expect(byIndex.get(4)?.reason).toBe("UNKNOWN_EMPLOYEE");
    expect(byIndex.get(5)?.reason).toBe("INVALID_FIELD");
    expect(byIndex.get(7)?.reason).toBe("DUPLICATE_IN_FILE");

    // THE IDEMPOTENCE LAW: EMP-BR-2's completed_at is UNTOUCHED.
    const after = await su.query<{ completed_at: string; result: string | null }>(
      `SELECT en.completed_at::text AS completed_at, en.result FROM training_enrollments en
         JOIN employees e ON e.id = en.employee_id
        WHERE en.tenant_id = $1 AND en.program_id = $2 AND e.code = 'EMP-BR-2'`,
      [TENANT_HB, spec.programActiveId],
    );
    await su.end();
    expect(after.rows[0]!.completed_at).toBe(completedAtBefore);
    expect(after.rows[0]!.result).toBe("PASSED");
  });

  it("(e3) the batch ceiling + the import audits", async () => {
    await expect(
      withTenant(TENANT_HB, () =>
        bridgesSvc.importTrainingCompletions({ rows: [], actorId: HB_ACTOR }),
      ),
    ).rejects.toBeInstanceOf(BridgeImportInvalidError);
    const su: Client = await superuserClient();
    const audits = await su.query<{ n: number }>(
      `SELECT count(*)::int AS n FROM audit_events
        WHERE tenant_id = $1 AND action = 'hr.bridge_import_run' AND after->>'kind' = 'training-completions'`,
      [TENANT_HB],
    );
    await su.end();
    expect(audits.rows[0]!.n).toBeGreaterThanOrEqual(2);
  });
});
