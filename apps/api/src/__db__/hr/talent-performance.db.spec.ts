import { beforeAll, describe, expect, it } from "vitest";
import type { Client } from "pg";

import { withTenant } from "../../infra/db/tenant-context";
import { AuditService } from "../../modules/audit/api/audit";
import { DrizzleAuditStore } from "../../modules/audit/infrastructure/drizzle-audit.store";
import { TalentGoalsService } from "../../modules/hr/application/talent-goals-service";
import { TalentPerformanceService } from "../../modules/hr/application/talent-performance-service";
import {
  CompetencyLevelNotFoundError,
  CompetencyNotFoundError,
  CycleStateConflictError,
  FeedbackBelowThresholdError,
  GoalWeightsInvalidError,
  OrgCycleError,
  ReviewAlreadySubmittedError,
  TalentCycleNotFoundError,
  TalentCodeTakenError,
  TalentInvalidError,
} from "../../modules/hr/domain/talent-errors";
import { materializeCanonicalCompetencyScale } from "../../modules/hr/infrastructure/talent-canonical";
import { superuserClient } from "../test-db";
import { H_ACTOR, setupHrFixture, TENANT_H, TENANT_H_RLS } from "./fixtures";

/**
 * PHASE-047 (W-2 — T-05 + T-06) — the performance + goals engines
 * pinned over real PostgreSQL 16 (the plan §4's
 * `talent-performance.db.spec`): the end-to-end cycle (acceptance #2)
 * + BR-089/090 proven BOTH WAYS + the cycle CAS raced both ways + the
 * KRI triage + the cascade's D-09 guard + the competency framework +
 * the tenant boundary.
 *
 * THE HONEST ENGINEERING NOTE (this spec's own finding, unit-first):
 * the pure wouldCreateCycle's first shape tested "newly added" with
 * `!seen.add(cursor)` — Set.add returns the SET (always truthy), so
 * the walk NEVER terminated on a pre-existing loop; the unit spec's
 * (c) arm hung the run and the fix (`has` before `add`) landed BEFORE
 * any service or DB layer ever consumed the guard — D-08's
 * unit-tested-FIRST law doing exactly its job.
 */

const audit = new AuditService(new DrizzleAuditStore());
const performanceSvc = new TalentPerformanceService(audit);
const goalsSvc = new TalentGoalsService(audit);

interface TalentFixture {
  /** EMP-TM — the manager (the MANAGER reviewer). */
  managerId: string;
  /** EMP-TR — the reviewee. */
  revieweeId: string;
  /** EMP-TP1..TP3 — the three peers (BR-090's ≥ 3 arm). */
  peerIds: [string, string, string];
  /** EMP-TS1..TS2 — the two subordinates (the below-threshold arm). */
  subordinateIds: [string, string];
  /** The scoped cycle's org unit + position (the scope law). */
  scopedOrgUnitId: string;
  scopedPositionId: string;
  /** The in-scope employee (sits in the scoped org unit). */
  scopedEmployeeId: string;
  /** The out-of-scope employee (no position). */
  unpositionedEmployeeId: string;
}

const spec: { fixture?: TalentFixture } = {};

beforeAll(async () => {
  await setupHrFixture();
  // The canonical 1–5 scale for tenant H — the fixture tenants are
  // raw-created (neither the 0098 §4 migration sweep nor the onboarding
  // hook runs for them), so the spec materializes the scale itself (the
  // reporting/payroll fixtures' materializeCanonicalStatutorySet
  // precedent — one source, both paths).
  await withTenant(TENANT_H, () => materializeCanonicalCompetencyScale());
  const su: Client = await superuserClient();
  // The talent cast — direct SQL on the employees/org substrate (the
  // leave.spec precedent: the substrate rows seed raw; the engine's
  // laws are the service's).
  const employees = await su.query<{ id: string; code: string }>(
    `INSERT INTO employees (id, tenant_id, code, name, name_ar, hire_date, contract_type, basic_salary, created_by) VALUES
       (gen_random_uuid(), $1, 'EMP-TM', 'Tarik Al-Manager', 'طارق المدير', '2024-01-01', 'FULL_TIME', 12000, $2),
       (gen_random_uuid(), $1, 'EMP-TR', 'Rana Al-Reviewee', 'رنا المقيمة', '2024-02-01', 'FULL_TIME', 9000, $2),
       (gen_random_uuid(), $1, 'EMP-TP1', 'Peer One', 'زميل أول', '2024-03-01', 'FULL_TIME', 8000, $2),
       (gen_random_uuid(), $1, 'EMP-TP2', 'Peer Two', 'زميل ثانٍ', '2024-03-01', 'FULL_TIME', 8000, $2),
       (gen_random_uuid(), $1, 'EMP-TP3', 'Peer Three', 'زميل ثالث', '2024-03-01', 'FULL_TIME', 8000, $2),
       (gen_random_uuid(), $1, 'EMP-TS1', 'Sub One', 'مرؤوس أول', '2024-04-01', 'FULL_TIME', 7000, $2),
       (gen_random_uuid(), $1, 'EMP-TS2', 'Sub Two', 'مرؤوس ثانٍ', '2024-04-01', 'FULL_TIME', 7000, $2),
       (gen_random_uuid(), $1, 'EMP-TSC', 'Scoped Employee', 'موظف داخل النطاق', '2024-05-01', 'FULL_TIME', 7500, $2),
       (gen_random_uuid(), $1, 'EMP-TUN', 'Unpositioned', 'موظف بلا وظيفة', '2024-05-01', 'FULL_TIME', 7500, $2)
     ON CONFLICT (tenant_id, code) DO UPDATE SET name = EXCLUDED.name
     RETURNING id, code`,
    [TENANT_H, H_ACTOR],
  );
  // The scoped cycle's org unit + position (0097's tables — the W-3
  // API is not there yet; the rows seed raw, the scope law is the
  // engine's read).
  const orgUnit = await su.query<{ id: string }>(
    `INSERT INTO org_units (id, tenant_id, code, name, name_ar, path, created_by)
     VALUES (gen_random_uuid(), $1, 'OU-TAL', 'Talent Unit', 'وحدة المواهب', 'OU-TAL', $2)
     ON CONFLICT (tenant_id, code) DO UPDATE SET name = EXCLUDED.name
     RETURNING id`,
    [TENANT_H, H_ACTOR],
  );
  const position = await su.query<{ id: string }>(
    `INSERT INTO positions (id, tenant_id, code, title, title_ar, org_unit_id, created_by)
     VALUES (gen_random_uuid(), $1, 'POS-TAL', 'Talent Analyst', 'محلل مواهب', $2, $3)
     ON CONFLICT (tenant_id, code) DO UPDATE SET title = EXCLUDED.title
     RETURNING id`,
    [TENANT_H, orgUnit.rows[0]!.id, H_ACTOR],
  );
  await su.query(
    `UPDATE employees SET position_id = $2 WHERE tenant_id = $1 AND code = 'EMP-TSC'`,
    [TENANT_H, position.rows[0]!.id],
  );
  await su.end();

  const byCode = new Map(employees.rows.map((row) => [row.code, row.id]));
  spec.fixture = {
    managerId: byCode.get("EMP-TM")!,
    revieweeId: byCode.get("EMP-TR")!,
    peerIds: [byCode.get("EMP-TP1")!, byCode.get("EMP-TP2")!, byCode.get("EMP-TP3")!],
    subordinateIds: [byCode.get("EMP-TS1")!, byCode.get("EMP-TS2")!],
    scopedOrgUnitId: orgUnit.rows[0]!.id,
    scopedPositionId: position.rows[0]!.id,
    scopedEmployeeId: byCode.get("EMP-TSC")!,
    unpositionedEmployeeId: byCode.get("EMP-TUN")!,
  };
});

/** A fresh DRAFT cycle per arm (unique name — the shared-world law). */
let cycleSeq = 0;
async function freshCycle(
  overrides: Partial<{
    periodStart: string;
    periodEnd: string;
    reviewDueDate: string | null;
    scopeOrgUnitIds: string[];
  }> = {},
) {
  cycleSeq += 1;
  return withTenant(TENANT_H, () =>
    performanceSvc.createCycle({
      name: `W-2 cycle ${cycleSeq} ${Date.now() % 100000}`,
      nameAr: null,
      periodStart: overrides.periodStart ?? "2026-01-01",
      periodEnd: overrides.periodEnd ?? "2026-12-31",
      reviewDueDate: overrides.reviewDueDate ?? null,
      scopeOrgUnitIds: overrides.scopeOrgUnitIds ?? [],
      actorId: H_ACTOR,
    }),
  );
}

const MANAGER_REVIEW = {
  kind: "MANAGER" as const,
  overallScore: "82.50" as string | null,
  competencyScores: {},
  comments: "Solid year overall" as string | null,
};

describe("PHASE-047 W-2 — (a) the cycle lifecycle: the one-way CAS ladder", () => {
  it("(a1) creates DRAFT with the window validations typed (the inverted period, the early review-due, the unknown scope unit)", async () => {
    await expect(
      withTenant(TENANT_H, () =>
        performanceSvc.createCycle({
          name: "inverted window",
          nameAr: null,
          periodStart: "2026-12-31",
          periodEnd: "2026-01-01",
          reviewDueDate: null,
          scopeOrgUnitIds: [],
          actorId: H_ACTOR,
        }),
      ),
    ).rejects.toBeInstanceOf(TalentInvalidError);
    await expect(
      withTenant(TENANT_H, () =>
        performanceSvc.createCycle({
          name: "early due",
          nameAr: null,
          periodStart: "2026-06-01",
          periodEnd: "2026-12-31",
          reviewDueDate: "2026-05-01",
          scopeOrgUnitIds: [],
          actorId: H_ACTOR,
        }),
      ),
    ).rejects.toBeInstanceOf(TalentInvalidError);
    await expect(
      withTenant(TENANT_H, () =>
        performanceSvc.createCycle({
          name: "unknown scope unit",
          nameAr: null,
          periodStart: "2026-01-01",
          periodEnd: "2026-12-31",
          reviewDueDate: null,
          scopeOrgUnitIds: ["33333333-3333-4333-8333-333333333333"],
          actorId: H_ACTOR,
        }),
      ),
    ).rejects.toBeInstanceOf(TalentInvalidError);

    const cycle = await freshCycle({ scopeOrgUnitIds: [spec.fixture!.scopedOrgUnitId] });
    expect(cycle.status).toBe("DRAFT");
    expect(cycle.scopeOrgUnitIds).toEqual([spec.fixture!.scopedOrgUnitId]);
  });

  it("(a2) walks the ladder DRAFT→ACTIVE→CALIBRATION→CLOSED and refuses EVERY illegal edge (one forward edge per state)", async () => {
    const cycle = await freshCycle();
    // Illegal edges from DRAFT.
    await expect(
      withTenant(TENANT_H, () => performanceSvc.transitionCycle(cycle.id, "calibrate", H_ACTOR)),
    ).rejects.toBeInstanceOf(CycleStateConflictError);
    await expect(
      withTenant(TENANT_H, () => performanceSvc.transitionCycle(cycle.id, "close", H_ACTOR)),
    ).rejects.toBeInstanceOf(CycleStateConflictError);
    // The legal walk.
    const active = await withTenant(TENANT_H, () =>
      performanceSvc.transitionCycle(cycle.id, "activate", H_ACTOR),
    );
    expect(active.status).toBe("ACTIVE");
    // Illegal from ACTIVE: activate again (the stale/repeat move).
    await expect(
      withTenant(TENANT_H, () => performanceSvc.transitionCycle(cycle.id, "activate", H_ACTOR)),
    ).rejects.toBeInstanceOf(CycleStateConflictError);
    const calibrating = await withTenant(TENANT_H, () =>
      performanceSvc.transitionCycle(cycle.id, "calibrate", H_ACTOR),
    );
    expect(calibrating.status).toBe("CALIBRATION");
    await expect(
      withTenant(TENANT_H, () => performanceSvc.transitionCycle(cycle.id, "calibrate", H_ACTOR)),
    ).rejects.toBeInstanceOf(CycleStateConflictError);
    const closed = await withTenant(TENANT_H, () =>
      performanceSvc.transitionCycle(cycle.id, "close", H_ACTOR),
    );
    expect(closed.status).toBe("CLOSED");
    // CLOSED is immutable history — every edge refuses.
    for (const action of ["activate", "calibrate", "close"] as const) {
      await expect(
        withTenant(TENANT_H, () => performanceSvc.transitionCycle(cycle.id, action, H_ACTOR)),
      ).rejects.toBeInstanceOf(CycleStateConflictError);
    }
  });

  it("(a3) THE CAS RACE — two transactions dueling on the same edge: the row lock serializes them, the loser's WHERE re-evaluates against the winner's commit and matches ZERO rows", async () => {
    const cycle = await freshCycle();
    const suA: Client = await superuserClient();
    const suB: Client = await superuserClient();
    try {
      // A: the conditional update inside an OPEN transaction (uncommitted).
      await suA.query("BEGIN");
      const a = await suA.query(
        `UPDATE performance_cycles SET status = 'ACTIVE', version = version + 1
         WHERE id = $1 AND status = 'DRAFT' RETURNING id`,
        [cycle.id],
      );
      expect(a.rowCount).toBe(1);
      // B: the same CAS from the same expected state — blocks on A's row
      // lock; A commits; B's WHERE re-evaluates → zero rows.
      const bPromise = suB
        .query(
          `UPDATE performance_cycles SET status = 'ACTIVE', version = version + 1
           WHERE id = $1 AND status = 'DRAFT' RETURNING id`,
          [cycle.id],
        )
        .then((res) => res.rowCount)
        .catch(() => -1);
      await new Promise((resolve) => setTimeout(resolve, 150));
      await suA.query("COMMIT");
      const bCount = await bPromise;
      expect(bCount).toBe(0); // the CAS refused the raced move — atomically
      await suB.query("ROLLBACK");
      // The store now holds exactly ONE flip: the service's stale read
      // (DRAFT) refuses typed.
      await expect(
        withTenant(TENANT_H, () =>
          performanceSvc.transitionCycle(cycle.id, "activate", H_ACTOR),
        ),
      ).rejects.toBeInstanceOf(CycleStateConflictError);
      const after = await withTenant(TENANT_H, () => performanceSvc.getCycle(cycle.id));
      expect(after.status).toBe("ACTIVE");
      expect(after.version).toBe(2); // exactly one version bump — one winner
    } finally {
      await suA.end().catch(() => undefined);
      await suB.end().catch(() => undefined);
    }
  });
});

describe("PHASE-047 W-2 — (b) the review submission: the window, the scope, the scorecard, the immutability", () => {
  it("(b1) THE WINDOW LAW — a submission refuses while DRAFT, submits while ACTIVE, refuses after CALIBRATION/CLOSED", async () => {
    const f = spec.fixture!;
    const cycle = await freshCycle();
    await expect(
      withTenant(TENANT_H, () =>
        performanceSvc.submitReview({
          reviewerEmployeeId: f.managerId,
          cycleId: cycle.id,
          revieweeEmployeeId: f.revieweeId,
          ...MANAGER_REVIEW,
          actorId: H_ACTOR,
        }),
      ),
    ).rejects.toBeInstanceOf(CycleStateConflictError);
    await withTenant(TENANT_H, () => performanceSvc.transitionCycle(cycle.id, "activate", H_ACTOR));
    const submitted = await withTenant(TENANT_H, () =>
      performanceSvc.submitReview({
        reviewerEmployeeId: f.managerId,
        cycleId: cycle.id,
        revieweeEmployeeId: f.revieweeId,
        ...MANAGER_REVIEW,
        actorId: H_ACTOR,
      }),
    );
    expect(submitted.status).toBe("SUBMITTED");
    // The re-submit refuses typed (immutable until calibration).
    await expect(
      withTenant(TENANT_H, () =>
        performanceSvc.submitReview({
          reviewerEmployeeId: f.managerId,
          cycleId: cycle.id,
          revieweeEmployeeId: f.revieweeId,
          ...MANAGER_REVIEW,
          actorId: H_ACTOR,
        }),
      ),
    ).rejects.toBeInstanceOf(ReviewAlreadySubmittedError);
    // CALIBRATION: submissions refuse (the window closed).
    await withTenant(TENANT_H, () => performanceSvc.transitionCycle(cycle.id, "calibrate", H_ACTOR));
    await expect(
      withTenant(TENANT_H, () =>
        performanceSvc.submitReview({
          reviewerEmployeeId: f.peerIds[0],
          cycleId: cycle.id,
          revieweeEmployeeId: f.revieweeId,
          kind: "PEER",
          overallScore: "70.00",
          competencyScores: {},
          comments: null,
          actorId: H_ACTOR,
        }),
      ),
    ).rejects.toBeInstanceOf(CycleStateConflictError);
  });

  it("(b2) THE DRAFT PLANE — a draft saves and re-saves while ACTIVE; a SUBMITTED natural-key row refuses the re-save typed; the SELF⟺reviewee law is typed", async () => {
    const f = spec.fixture!;
    const cycle = await freshCycle();
    await withTenant(TENANT_H, () => performanceSvc.transitionCycle(cycle.id, "activate", H_ACTOR));
    const draft = await withTenant(TENANT_H, () =>
      performanceSvc.saveReviewDraft({
        reviewerEmployeeId: f.managerId,
        cycleId: cycle.id,
        revieweeEmployeeId: f.revieweeId,
        ...MANAGER_REVIEW,
        actorId: H_ACTOR,
      }),
    );
    expect(draft.status).toBe("DRAFT");
    const redraft = await withTenant(TENANT_H, () =>
      performanceSvc.saveReviewDraft({
        reviewerEmployeeId: f.managerId,
        cycleId: cycle.id,
        revieweeEmployeeId: f.revieweeId,
        ...MANAGER_REVIEW,
        overallScore: "85.00",
        actorId: H_ACTOR,
      }),
    );
    expect(redraft.overallScore).toBe("85.00");
    expect(redraft.id).toBe(draft.id); // the natural key upsert — one row
    await withTenant(TENANT_H, () =>
      performanceSvc.submitReview({
        reviewerEmployeeId: f.managerId,
        cycleId: cycle.id,
        revieweeEmployeeId: f.revieweeId,
        ...MANAGER_REVIEW,
        actorId: H_ACTOR,
      }),
    );
    await expect(
      withTenant(TENANT_H, () =>
        performanceSvc.saveReviewDraft({
          reviewerEmployeeId: f.managerId,
          cycleId: cycle.id,
          revieweeEmployeeId: f.revieweeId,
          ...MANAGER_REVIEW,
          actorId: H_ACTOR,
        }),
      ),
    ).rejects.toBeInstanceOf(ReviewAlreadySubmittedError);
    // SELF⟺reviewee: a SELF review by anyone else is typed-invalid.
    await expect(
      withTenant(TENANT_H, () =>
        performanceSvc.submitReview({
          reviewerEmployeeId: f.managerId,
          cycleId: cycle.id,
          revieweeEmployeeId: f.revieweeId,
          kind: "SELF",
          overallScore: "90.00",
          competencyScores: {},
          comments: null,
          actorId: H_ACTOR,
        }),
      ),
    ).rejects.toBeInstanceOf(TalentInvalidError);
  });

  it("(b3) THE SCOPE LAW + THE SCORECARD LAW — out-of-scope reviewees, unknown/inactive competencies, and unconfigured levels all refuse typed before any write", async () => {
    const f = spec.fixture!;
    const scopedCycle = await freshCycle({ scopeOrgUnitIds: [f.scopedOrgUnitId] });
    await withTenant(TENANT_H, () =>
      performanceSvc.transitionCycle(scopedCycle.id, "activate", H_ACTOR),
    );
    // In-scope: the positioned employee inside the scoped unit.
    const ok = await withTenant(TENANT_H, () =>
      performanceSvc.submitReview({
        reviewerEmployeeId: f.managerId,
        cycleId: scopedCycle.id,
        revieweeEmployeeId: f.scopedEmployeeId,
        ...MANAGER_REVIEW,
        actorId: H_ACTOR,
      }),
    );
    expect(ok.status).toBe("SUBMITTED");
    // Out-of-scope: the unpositioned employee (an empty scope would
    // take the whole ACTIVE workforce — a scoped cycle does not).
    await expect(
      withTenant(TENANT_H, () =>
        performanceSvc.submitReview({
          reviewerEmployeeId: f.managerId,
          cycleId: scopedCycle.id,
          revieweeEmployeeId: f.unpositionedEmployeeId,
          ...MANAGER_REVIEW,
          actorId: H_ACTOR,
        }),
      ),
    ).rejects.toBeInstanceOf(TalentInvalidError);
    // Out-of-scope: a fixture employee from the unscoped world.
    await expect(
      withTenant(TENANT_H, () =>
        performanceSvc.submitReview({
          reviewerEmployeeId: f.managerId,
          cycleId: scopedCycle.id,
          revieweeEmployeeId: f.revieweeId,
          ...MANAGER_REVIEW,
          actorId: H_ACTOR,
        }),
      ),
    ).rejects.toBeInstanceOf(TalentInvalidError);

    // The scorecard laws (an unscoped cycle — the reviewee is in
    // scope by the empty-scope law).
    const cycle = await freshCycle();
    await withTenant(TENANT_H, () => performanceSvc.transitionCycle(cycle.id, "activate", H_ACTOR));
    const competency = await withTenant(TENANT_H, () =>
      performanceSvc.createCompetency({
        code: `COMM-${Date.now() % 100000}`,
        name: "Communication",
        nameAr: "التواصل",
        category: "core",
        actorId: H_ACTOR,
      }),
    );
    await expect(
      withTenant(TENANT_H, () =>
        performanceSvc.submitReview({
          reviewerEmployeeId: f.managerId,
          cycleId: cycle.id,
          revieweeEmployeeId: f.revieweeId,
          ...MANAGER_REVIEW,
          competencyScores: { "44444444-4444-4444-8444-444444444444": 3 },
          actorId: H_ACTOR,
        }),
      ),
    ).rejects.toBeInstanceOf(CompetencyNotFoundError);
    await expect(
      withTenant(TENANT_H, () =>
        performanceSvc.submitReview({
          reviewerEmployeeId: f.managerId,
          cycleId: cycle.id,
          revieweeEmployeeId: f.revieweeId,
          ...MANAGER_REVIEW,
          competencyScores: { [competency.id]: 6 },
          actorId: H_ACTOR,
        }),
      ),
    ).rejects.toBeInstanceOf(CompetencyLevelNotFoundError);
    // An inactive competency is refused (deactivation blocks the
    // scorecard — the 1–5 scale seed's active floor).
    await withTenant(TENANT_H, () =>
      performanceSvc.setCompetencyActive(competency.id, false, H_ACTOR),
    );
    await expect(
      withTenant(TENANT_H, () =>
        performanceSvc.submitReview({
          reviewerEmployeeId: f.managerId,
          cycleId: cycle.id,
          revieweeEmployeeId: f.revieweeId,
          ...MANAGER_REVIEW,
          competencyScores: { [competency.id]: 3 },
          actorId: H_ACTOR,
        }),
      ),
    ).rejects.toBeInstanceOf(CompetencyNotFoundError);
    // The green scorecard round-trips.
    await withTenant(TENANT_H, () =>
      performanceSvc.setCompetencyActive(competency.id, true, H_ACTOR),
    );
    const scored = await withTenant(TENANT_H, () =>
      performanceSvc.submitReview({
        reviewerEmployeeId: f.managerId,
        cycleId: cycle.id,
        revieweeEmployeeId: f.revieweeId,
        ...MANAGER_REVIEW,
        competencyScores: { [competency.id]: 4 },
        actorId: H_ACTOR,
      }),
    );
    expect(scored.competencyScores[competency.id]).toBe(4);
  });
});

describe("PHASE-047 W-2 — (c) BR-090 BOTH WAYS: the 360 anonymity law", () => {
  it("(c1) below the threshold a relationship is HIDDEN (null, never a count) and an EXPLICIT request is the typed 422; at ≥ 3 the aggregate surfaces — and NO attributed source ever leaves the boundary", async () => {
    const f = spec.fixture!;
    const cycle = await freshCycle();
    await withTenant(TENANT_H, () => performanceSvc.transitionCycle(cycle.id, "activate", H_ACTOR));

    const submitInput = (reviewerId: string, kind: "SELF" | "PEER" | "SUBORDINATE", score: string) =>
      withTenant(TENANT_H, () =>
        performanceSvc.submitReview({
          reviewerEmployeeId: reviewerId,
          cycleId: cycle.id,
          revieweeEmployeeId: f.revieweeId,
          kind,
          overallScore: score,
          competencyScores: {},
          comments: null,
          actorId: H_ACTOR,
        }),
      );

    // The raw substrate: 1 SELF + 2 PEER + 2 SUBORDINATE.
    await submitInput(f.revieweeId, "SELF", "90.00");
    await submitInput(f.peerIds[0], "PEER", "70.00");
    await submitInput(f.peerIds[1], "PEER", "80.00");
    await submitInput(f.subordinateIds[0], "SUBORDINATE", "60.00");
    await submitInput(f.subordinateIds[1], "SUBORDINATE", "70.50");

    // BELOW the threshold (2 peers): PEER hidden, SUBORDINATE hidden,
    // SELF hidden (1 — can never reach 3 by the natural key).
    const below = await withTenant(TENANT_H, () =>
      performanceSvc.getAggregate360(cycle.id, f.revieweeId),
    );
    expect(below.aggregates.PEER).toBeNull();
    expect(below.aggregates.SUBORDINATE).toBeNull();
    expect(below.aggregates.SELF).toBeNull();
    // The EXPLICIT below-threshold request: the typed refusal.
    await expect(
      withTenant(TENANT_H, () =>
        performanceSvc.getAggregate360(cycle.id, f.revieweeId, "PEER"),
      ),
    ).rejects.toBeInstanceOf(FeedbackBelowThresholdError);

    // AT the threshold: the third peer surfaces the aggregate.
    await submitInput(f.peerIds[2], "PEER", "90.00");
    const at = await withTenant(TENANT_H, () =>
      performanceSvc.getAggregate360(cycle.id, f.revieweeId),
    );
    expect(at.aggregates.PEER).toEqual({
      kind: "PEER",
      count: 3,
      mean: "80.00",
      min: "70.00",
      max: "90.00",
    });
    // SUBORDINATE stays hidden (2) — the explicit request still 422s.
    expect(at.aggregates.SUBORDINATE).toBeNull();
    await expect(
      withTenant(TENANT_H, () =>
        performanceSvc.getAggregate360(cycle.id, f.revieweeId, "SUBORDINATE"),
      ),
    ).rejects.toBeInstanceOf(FeedbackBelowThresholdError);
    // The explicit AT-threshold request passes.
    const explicit = await withTenant(TENANT_H, () =>
      performanceSvc.getAggregate360(cycle.id, f.revieweeId, "PEER"),
    );
    expect(explicit.aggregates.PEER?.count).toBe(3);

    // THE ATTRIBUTION LAW: the payload carries no source identity —
    // stringify the whole view and assert none of the reviewer ids
    // (or any reviewerEmployeeId key) appears.
    const payload = JSON.stringify(at);
    // The SUBJECT (reviewee) id is the view's own echo (the route's path
    // param) — the law protects the SOURCES: none of the 360 reviewers'
    // ids may appear, and no reviewer field exists in the shape at all.
    for (const reviewerId of [...f.peerIds, ...f.subordinateIds]) {
      expect(payload).not.toContain(reviewerId);
    }
    expect(payload).not.toContain("reviewerEmployeeId");
    // The raw rows DO exist (the audit substrate — BR-090's raw side).
    const su = await superuserClient();
    try {
      const raw = await su.query(
        `SELECT count(*)::int AS n FROM performance_reviews
         WHERE tenant_id = $1 AND cycle_id = $2 AND kind IN ('SELF','PEER','SUBORDINATE')`,
        [TENANT_H, cycle.id],
      );
      expect(raw.rows[0].n).toBe(6); // 1 SELF + 3 PEER + 2 SUBORDINATE
    } finally {
      await su.end();
    }
  });
});

describe("PHASE-047 W-2 — (d) BR-089 + the end-to-end cycle (acceptance #2)", () => {
  it("(d1) BR-089 BOTH WAYS at the submission gate — weights summing 80% refuse typed with ZERO residue; exactly 100% submits with the exact rollup (40%@50 + 60%@75 = 65.00)", async () => {
    const f = spec.fixture!;
    const cycle = await freshCycle();
    // Goals while DRAFT (the window law allows it) — 30 + 50 = 80.
    const g30 = await withTenant(TENANT_H, () =>
      goalsSvc.createGoal({
        cycleId: cycle.id,
        ownerEmployeeId: f.revieweeId,
        parentGoalId: null,
        title: "Reduce churn",
        titleAr: null,
        weight: "30.00",
        kriTarget: "churn < 5%",
        dueDate: null,
        actorId: H_ACTOR,
      }),
    );
    await withTenant(TENANT_H, () =>
      goalsSvc.createGoal({
        cycleId: cycle.id,
        ownerEmployeeId: f.revieweeId,
        parentGoalId: null,
        title: "Grow revenue",
        titleAr: null,
        weight: "50.00",
        kriTarget: "+15% YoY",
        dueDate: null,
        actorId: H_ACTOR,
      }),
    );
    // The explicit check (the drafting read): 80.00, invalid.
    const check = await withTenant(TENANT_H, () =>
      goalsSvc.validateGoalWeights(cycle.id, f.revieweeId),
    );
    expect(check.sum).toBe("80.00");
    expect(check.valid).toBe(false);

    await withTenant(TENANT_H, () => performanceSvc.transitionCycle(cycle.id, "activate", H_ACTOR));
    // The submission refuses typed — BEFORE any write (zero residue:
    // no review row exists for the natural key).
    await expect(
      withTenant(TENANT_H, () =>
        performanceSvc.submitReview({
          reviewerEmployeeId: f.managerId,
          cycleId: cycle.id,
          revieweeEmployeeId: f.revieweeId,
          ...MANAGER_REVIEW,
          actorId: H_ACTOR,
        }),
      ),
    ).rejects.toBeInstanceOf(GoalWeightsInvalidError);
    const su0 = await superuserClient();
    try {
      const residue = await su0.query(
        `SELECT count(*)::int AS n FROM performance_reviews WHERE tenant_id = $1 AND cycle_id = $2`,
        [TENANT_H, cycle.id],
      );
      expect(residue.rows[0].n).toBe(0);
    } finally {
      await su0.end();
    }

    // Fix to exactly 100: 30 + 50 + 20 (the third goal at 0 progress).
    await withTenant(TENANT_H, () =>
      goalsSvc.createGoal({
        cycleId: cycle.id,
        ownerEmployeeId: f.revieweeId,
        parentGoalId: null,
        title: "Ship the portal",
        titleAr: null,
        weight: "20.00",
        kriTarget: "Q3 launch",
        dueDate: null,
        actorId: H_ACTOR,
      }),
    );
    // Progress the goals: 50%, 75%, and the third stays 0 (null).
    await withTenant(TENANT_H, () =>
      goalsSvc.updateOwnGoalProgress({
        goalId: g30.id,
        actingEmployeeId: f.revieweeId,
        progressPct: "50.00",
        actorId: H_ACTOR,
      }),
    );
    const goals = await withTenant(TENANT_H, () =>
      goalsSvc.listOwnGoals(f.revieweeId, cycle.id),
    );
    const revenue = goals.find((goal) => goal.title === "Grow revenue")!;
    await withTenant(TENANT_H, () =>
      goalsSvc.updateOwnGoalProgress({
        goalId: revenue.id,
        actingEmployeeId: f.revieweeId,
        progressPct: "75.00",
        actorId: H_ACTOR,
      }),
    );
    // The submission now carries the exact rollup:
    // 0.30×50 + 0.50×75 + 0.20×0 = 15 + 37.5 + 0 = 52.50.
    const submitted = await withTenant(TENANT_H, () =>
      performanceSvc.submitReview({
        reviewerEmployeeId: f.managerId,
        cycleId: cycle.id,
        revieweeEmployeeId: f.revieweeId,
        ...MANAGER_REVIEW,
        actorId: H_ACTOR,
      }),
    );
    expect(submitted.goalRollup).toBe("52.50");
    expect(submitted.status).toBe("SUBMITTED");
  });

  it("(d2) THE FULL CYCLE — goals → activate → reviews (manager + self + 3 peers + 2 subordinates) → the aggregate read → calibrate → the calibrated score → close → the CLOSED immutability", async () => {
    const f = spec.fixture!;
    const cycle = await freshCycle();
    // Two goals at exactly 100: 40 + 60.
    await withTenant(TENANT_H, () =>
      goalsSvc.createGoal({
        cycleId: cycle.id,
        ownerEmployeeId: f.revieweeId,
        parentGoalId: null,
        title: "OKR-A",
        titleAr: null,
        weight: "40.00",
        kriTarget: null,
        dueDate: null,
        actorId: H_ACTOR,
      }),
    );
    await withTenant(TENANT_H, () =>
      goalsSvc.createGoal({
        cycleId: cycle.id,
        ownerEmployeeId: f.revieweeId,
        parentGoalId: null,
        title: "OKR-B",
        titleAr: null,
        weight: "60.00",
        kriTarget: null,
        dueDate: null,
        actorId: H_ACTOR,
      }),
    );
    await withTenant(TENANT_H, () => performanceSvc.transitionCycle(cycle.id, "activate", H_ACTOR));
    // Progress: 50% and 75% → the rollup 0.4×50 + 0.6×75 = 65.00.
    const own = await withTenant(TENANT_H, () => goalsSvc.listOwnGoals(f.revieweeId, cycle.id));
    await withTenant(TENANT_H, () =>
      goalsSvc.updateOwnGoalProgress({
        goalId: own[0]!.id,
        actingEmployeeId: f.revieweeId,
        progressPct: "50.00",
        actorId: H_ACTOR,
      }),
    );
    await withTenant(TENANT_H, () =>
      goalsSvc.updateOwnGoalProgress({
        goalId: own[1]!.id,
        actingEmployeeId: f.revieweeId,
        progressPct: "75.00",
        actorId: H_ACTOR,
      }),
    );
    // The review set.
    const manager = await withTenant(TENANT_H, () =>
      performanceSvc.submitReview({
        reviewerEmployeeId: f.managerId,
        cycleId: cycle.id,
        revieweeEmployeeId: f.revieweeId,
        ...MANAGER_REVIEW,
        actorId: H_ACTOR,
      }),
    );
    expect(manager.goalRollup).toBe("65.00");
    await withTenant(TENANT_H, () =>
      performanceSvc.submitReview({
        reviewerEmployeeId: f.revieweeId,
        cycleId: cycle.id,
        revieweeEmployeeId: f.revieweeId,
        kind: "SELF",
        overallScore: "90.00",
        competencyScores: {},
        comments: null,
        actorId: H_ACTOR,
      }),
    );
    for (const peerId of f.peerIds) {
      await withTenant(TENANT_H, () =>
        performanceSvc.submitReview({
          reviewerEmployeeId: peerId,
          cycleId: cycle.id,
          revieweeEmployeeId: f.revieweeId,
          kind: "PEER",
          overallScore: "75.00",
          competencyScores: {},
          comments: null,
          actorId: H_ACTOR,
        }),
      );
    }
    for (const subId of f.subordinateIds) {
      await withTenant(TENANT_H, () =>
        performanceSvc.submitReview({
          reviewerEmployeeId: subId,
          cycleId: cycle.id,
          revieweeEmployeeId: f.revieweeId,
          kind: "SUBORDINATE",
          overallScore: "80.00",
          competencyScores: {},
          comments: null,
          actorId: H_ACTOR,
        }),
      );
    }
    // The aggregate read: PEER ≥ 3 surfaces; SUBORDINATE (2) and SELF
    // (1) stay hidden.
    const agg = await withTenant(TENANT_H, () =>
      performanceSvc.getAggregate360(cycle.id, f.revieweeId),
    );
    expect(agg.aggregates.PEER).toEqual({
      kind: "PEER",
      count: 3,
      mean: "75.00",
      min: "75.00",
      max: "75.00",
    });
    expect(agg.aggregates.SUBORDINATE).toBeNull();
    expect(agg.aggregates.SELF).toBeNull();
    // Calibrate.
    await withTenant(TENANT_H, () => performanceSvc.transitionCycle(cycle.id, "calibrate", H_ACTOR));
    const calibrated = await withTenant(TENANT_H, () =>
      performanceSvc.calibrateReview({
        cycleId: cycle.id,
        revieweeEmployeeId: f.revieweeId,
        overallScore: "88.00",
        comments: "Calibrated: strong delivery, growing scope",
        actorId: H_ACTOR,
      }),
    );
    expect(calibrated.status).toBe("CALIBRATED");
    expect(calibrated.overallScore).toBe("88.00");
    expect(calibrated.goalRollup).toBe("65.00"); // the submission's fold stays
    // Close.
    const closed = await withTenant(TENANT_H, () =>
      performanceSvc.transitionCycle(cycle.id, "close", H_ACTOR),
    );
    expect(closed.status).toBe("CLOSED");
    // CLOSED immutability: goal writes and submissions refuse typed.
    await expect(
      withTenant(TENANT_H, () =>
        goalsSvc.createGoal({
          cycleId: cycle.id,
          ownerEmployeeId: f.revieweeId,
          parentGoalId: null,
          title: "late goal",
          titleAr: null,
          weight: "10.00",
          kriTarget: null,
          dueDate: null,
          actorId: H_ACTOR,
        }),
      ),
    ).rejects.toBeInstanceOf(CycleStateConflictError);
    await expect(
      withTenant(TENANT_H, () =>
        goalsSvc.updateOwnGoalProgress({
          goalId: own[0]!.id,
          actingEmployeeId: f.revieweeId,
          progressPct: "99.00",
          actorId: H_ACTOR,
        }),
      ),
    ).rejects.toBeInstanceOf(CycleStateConflictError);
    // The reads stay alive on a CLOSED cycle (history is readable).
    const reviewsAfter = await withTenant(TENANT_H, () =>
      performanceSvc.listCycleReviews(cycle.id),
    );
    expect(reviewsAfter.length).toBe(7); // MANAGER + SELF + 3 PEER + 2 SUBORDINATE
    const aggAfter = await withTenant(TENANT_H, () =>
      performanceSvc.getAggregate360(cycle.id, f.revieweeId),
    );
    expect(aggAfter.aggregates.PEER?.count).toBe(3);
  });
});

describe("PHASE-047 W-2 — (e) the KRI triage + the goal status ladder", () => {
  it("(e1) the pace fold over the cycle window — a PAST window triages 40% AT_RISK and 100% ACHIEVED; a FUTURE window triages 40% ACTIVE (expected 0); CANCELLED is terminal", async () => {
    const f = spec.fixture!;
    // PAST window: everything is due.
    const pastCycle = await freshCycle({ periodStart: "2026-01-01", periodEnd: "2026-06-30" });
    const pastGoal = await withTenant(TENANT_H, () =>
      goalsSvc.createGoal({
        cycleId: pastCycle.id,
        ownerEmployeeId: f.revieweeId,
        parentGoalId: null,
        title: "Past OKR",
        titleAr: null,
        weight: "100.00",
        kriTarget: null,
        dueDate: null,
        actorId: H_ACTOR,
      }),
    );
    const atRisk = await withTenant(TENANT_H, () =>
      goalsSvc.updateOwnGoalProgress({
        goalId: pastGoal.id,
        actingEmployeeId: f.revieweeId,
        kriActual: "42 of target",
        progressPct: "40.00",
        actorId: H_ACTOR,
      }),
    );
    expect(atRisk.status).toBe("AT_RISK");
    expect(atRisk.kriActual).toBe("42 of target");
    const achieved = await withTenant(TENANT_H, () =>
      goalsSvc.updateOwnGoalProgress({
        goalId: pastGoal.id,
        actingEmployeeId: f.revieweeId,
        progressPct: "100.00",
        actorId: H_ACTOR,
      }),
    );
    expect(achieved.status).toBe("ACHIEVED");
    // A progress state re-derives downward too (the corrected KRI).
    const relapsed = await withTenant(TENANT_H, () =>
      goalsSvc.updateOwnGoalProgress({
        goalId: pastGoal.id,
        actingEmployeeId: f.revieweeId,
        progressPct: "90.00",
        actorId: H_ACTOR,
      }),
    );
    expect(relapsed.status).toBe("AT_RISK");

    // FUTURE window: nothing is due yet — 40% is ON track (ACTIVE).
    const futureCycle = await freshCycle({ periodStart: "2027-01-01", periodEnd: "2027-12-31" });
    const futureGoal = await withTenant(TENANT_H, () =>
      goalsSvc.createGoal({
        cycleId: futureCycle.id,
        ownerEmployeeId: f.revieweeId,
        parentGoalId: null,
        title: "Future OKR",
        titleAr: null,
        weight: "100.00",
        kriTarget: null,
        dueDate: null,
        actorId: H_ACTOR,
      }),
    );
    const onTrack = await withTenant(TENANT_H, () =>
      goalsSvc.updateOwnGoalProgress({
        goalId: futureGoal.id,
        actingEmployeeId: f.revieweeId,
        progressPct: "40.00",
        actorId: H_ACTOR,
      }),
    );
    expect(onTrack.status).toBe("ACTIVE");

    // CANCELLED is terminal — every further write refuses.
    const cancelled = await withTenant(TENANT_H, () =>
      goalsSvc.updateGoal({
        goalId: futureGoal.id,
        status: "CANCELLED",
        actorId: H_ACTOR,
      }),
    );
    expect(cancelled.status).toBe("CANCELLED");
    await expect(
      withTenant(TENANT_H, () =>
        goalsSvc.updateOwnGoalProgress({
          goalId: futureGoal.id,
          actingEmployeeId: f.revieweeId,
          progressPct: "50.00",
          actorId: H_ACTOR,
        }),
      ),
    ).rejects.toBeInstanceOf(TalentInvalidError);
    await expect(
      withTenant(TENANT_H, () =>
        goalsSvc.updateGoal({ goalId: futureGoal.id, status: "ACTIVE", actorId: H_ACTOR }),
      ),
    ).rejects.toBeInstanceOf(TalentInvalidError);
    // A CANCELLED goal keeps its title slot (the natural key spans
    // every status — the evidence discipline's price).
    await expect(
      withTenant(TENANT_H, () =>
        goalsSvc.createGoal({
          cycleId: futureCycle.id,
          ownerEmployeeId: f.revieweeId,
          parentGoalId: null,
          title: "Future OKR",
          titleAr: null,
          weight: "10.00",
          kriTarget: null,
          dueDate: null,
          actorId: H_ACTOR,
        }),
      ),
    ).rejects.toBeInstanceOf(TalentInvalidError);
  });

  it("(e2) the own-rows law — a goal that is not the acting employee's own refuses typed", async () => {
    const f = spec.fixture!;
    const cycle = await freshCycle();
    const goal = await withTenant(TENANT_H, () =>
      goalsSvc.createGoal({
        cycleId: cycle.id,
        ownerEmployeeId: f.revieweeId,
        parentGoalId: null,
        title: "Not yours",
        titleAr: null,
        weight: "100.00",
        kriTarget: null,
        dueDate: null,
        actorId: H_ACTOR,
      }),
    );
    await expect(
      withTenant(TENANT_H, () =>
        goalsSvc.updateOwnGoalProgress({
          goalId: goal.id,
          actingEmployeeId: f.peerIds[0],
          progressPct: "50.00",
          actorId: H_ACTOR,
        }),
      ),
    ).rejects.toBeInstanceOf(TalentInvalidError);
  });
});

describe("PHASE-047 W-2 — (f) the cascade tree: the D-09 guard + the natural key", () => {
  it("(f1) the tree nests parent → children; a re-parent that closes a loop refuses typed BEFORE any write; the cross-cycle parent and the duplicate title refuse typed", async () => {
    const f = spec.fixture!;
    const cycle = await freshCycle();
    // The cascade: org goal (manager-owned root) → team goal → the
    // reviewee's employee goal.
    const org = await withTenant(TENANT_H, () =>
      goalsSvc.createGoal({
        cycleId: cycle.id,
        ownerEmployeeId: f.managerId,
        parentGoalId: null,
        title: "Org: market expansion",
        titleAr: null,
        weight: "100.00",
        kriTarget: null,
        dueDate: null,
        actorId: H_ACTOR,
      }),
    );
    const team = await withTenant(TENANT_H, () =>
      goalsSvc.createGoal({
        cycleId: cycle.id,
        ownerEmployeeId: f.managerId,
        parentGoalId: org.id,
        title: "Team: pipeline build",
        titleAr: null,
        weight: "60.00",
        kriTarget: null,
        dueDate: null,
        actorId: H_ACTOR,
      }),
    );
    await withTenant(TENANT_H, () =>
      goalsSvc.createGoal({
        cycleId: cycle.id,
        ownerEmployeeId: f.revieweeId,
        parentGoalId: team.id,
        title: "Employee: close 20 deals",
        titleAr: null,
        weight: "100.00",
        kriTarget: null,
        dueDate: null,
        actorId: H_ACTOR,
      }),
    );
    const tree = await withTenant(TENANT_H, () => goalsSvc.listGoalTree(cycle.id));
    expect(tree.roots.length).toBe(1);
    expect(tree.roots[0]!.title).toBe("Org: market expansion");
    expect(tree.roots[0]!.children[0]!.title).toBe("Team: pipeline build");
    expect(tree.roots[0]!.children[0]!.children[0]!.title).toBe("Employee: close 20 deals");

    // D-09: moving the ORG root under its own descendant refuses
    // typed (the loop: org → team → … → org).
    await expect(
      withTenant(TENANT_H, () =>
        goalsSvc.updateGoal({ goalId: org.id, parentGoalId: team.id, actorId: H_ACTOR }),
      ),
    ).rejects.toBeInstanceOf(OrgCycleError);
    // The cross-cycle parent refuses typed.
    const otherCycle = await freshCycle();
    const otherRoot = await withTenant(TENANT_H, () =>
      goalsSvc.createGoal({
        cycleId: otherCycle.id,
        ownerEmployeeId: f.managerId,
        parentGoalId: null,
        title: "Other cycle root",
        titleAr: null,
        weight: "100.00",
        kriTarget: null,
        dueDate: null,
        actorId: H_ACTOR,
      }),
    );
    await expect(
      withTenant(TENANT_H, () =>
        goalsSvc.createGoal({
          cycleId: cycle.id,
          ownerEmployeeId: f.revieweeId,
          parentGoalId: otherRoot.id,
          title: "cross-cycle child",
          titleAr: null,
          weight: "10.00",
          kriTarget: null,
          dueDate: null,
          actorId: H_ACTOR,
        }),
      ),
    ).rejects.toBeInstanceOf(TalentInvalidError);
    // The duplicate title refuses typed (the natural key).
    await expect(
      withTenant(TENANT_H, () =>
        goalsSvc.createGoal({
          cycleId: cycle.id,
          ownerEmployeeId: f.revieweeId,
          parentGoalId: null,
          title: "Employee: close 20 deals",
          titleAr: null,
          weight: "10.00",
          kriTarget: null,
          dueDate: null,
          actorId: H_ACTOR,
        }),
      ),
    ).rejects.toBeInstanceOf(TalentInvalidError);
  });
});

describe("PHASE-047 W-2 — (g) the competency framework (the performance cluster's master data)", () => {
  it("(g1) CRUD + the code's uniqueness typed + the scale is tenant data (the descriptor patch) + the 1–5 band floor", async () => {
    const code = `LEAD-${Date.now() % 100000}`;
    const created = await withTenant(TENANT_H, () =>
      performanceSvc.createCompetency({
        code,
        name: "Leadership",
        nameAr: "القيادة",
        category: "core",
        actorId: H_ACTOR,
      }),
    );
    expect(created.active).toBe(true);
    await expect(
      withTenant(TENANT_H, () =>
        performanceSvc.createCompetency({
          code,
          name: "Leadership again",
          nameAr: null,
          category: null,
          actorId: H_ACTOR,
        }),
      ),
    ).rejects.toBeInstanceOf(TalentCodeTakenError);
    const renamed = await withTenant(TENANT_H, () =>
      performanceSvc.updateCompetency({
        id: created.id,
        name: "Leadership & mentorship",
        actorId: H_ACTOR,
      }),
    );
    expect(renamed.name).toBe("Leadership & mentorship");
    // The scale: the seeded 1–5 rows read back; the descriptor patch
    // (tenant data — BR-055's law); the band floor typed.
    const levels = await withTenant(TENANT_H, () => performanceSvc.listCompetencyLevels());
    expect(levels.map((level) => level.level)).toEqual([1, 2, 3, 4, 5]);
    const patched = await withTenant(TENANT_H, () =>
      performanceSvc.updateCompetencyLevel({
        level: 3,
        descriptor: "The tenant's own words for proficiency",
        actorId: H_ACTOR,
      }),
    );
    expect(patched.descriptor).toBe("The tenant's own words for proficiency");
    await expect(
      withTenant(TENANT_H, () =>
        performanceSvc.updateCompetencyLevel({ level: 6, descriptor: "no", actorId: H_ACTOR }),
      ),
    ).rejects.toBeInstanceOf(CompetencyLevelNotFoundError);
  });
});

describe("PHASE-047 W-2 — (h) the tenant boundary (A7 + the empty world)", () => {
  it("(h1) the boundary tenant's world is empty BY CONSTRUCTION; a foreign cycle/goal id is the typed 404/invalid (never an existence disclosure); the cross-tenant parent refuses", async () => {
    const f = spec.fixture!;
    // The home cycle (tenant H) — its ids are foreign to H-RLS.
    const homeCycle = await freshCycle();
    const homeGoal = await withTenant(TENANT_H, () =>
      goalsSvc.createGoal({
        cycleId: homeCycle.id,
        ownerEmployeeId: f.revieweeId,
        parentGoalId: null,
        title: "Home goal",
        titleAr: null,
        weight: "100.00",
        kriTarget: null,
        dueDate: null,
        actorId: H_ACTOR,
      }),
    );
    // The boundary tenant's empty world.
    const rlsCycles = await withTenant(TENANT_H_RLS, () => performanceSvc.listCycles({}));
    expect(rlsCycles).toEqual([]);
    // A7: the foreign cycle id reads as NOT FOUND in the boundary
    // tenant (identical to an unknown id — no existence disclosure).
    await expect(
      withTenant(TENANT_H_RLS, () => performanceSvc.getCycle(homeCycle.id)),
    ).rejects.toBeInstanceOf(TalentCycleNotFoundError);
    await expect(
      withTenant(TENANT_H_RLS, () =>
        performanceSvc.transitionCycle(homeCycle.id, "activate", H_ACTOR),
      ),
    ).rejects.toBeInstanceOf(TalentCycleNotFoundError);
    // A foreign goal id (the goals engine's A7 shape — the typed
    // invalid, never a not-found that would disclose).
    await expect(
      withTenant(TENANT_H_RLS, () =>
        goalsSvc.updateGoal({ goalId: homeGoal.id, weight: "50.00", actorId: H_ACTOR }),
      ),
    ).rejects.toBeInstanceOf(TalentInvalidError);
    // The boundary tenant's own cycle works end-to-end (the world is
    // empty, not broken).
    const rlsCycle = await withTenant(TENANT_H_RLS, () =>
      performanceSvc.createCycle({
        name: "RLS cycle",
        nameAr: null,
        periodStart: "2026-01-01",
        periodEnd: "2026-12-31",
        reviewDueDate: null,
        scopeOrgUnitIds: [],
        actorId: H_ACTOR,
      }),
    );
    expect(rlsCycle.status).toBe("DRAFT");
    // The cross-tenant parent refuses typed (RLS makes the foreign
    // parent indistinguishable from unknown).
    await expect(
      withTenant(TENANT_H_RLS, () =>
        goalsSvc.createGoal({
          cycleId: rlsCycle.id,
          ownerEmployeeId: f.revieweeId,
          parentGoalId: homeGoal.id,
          title: "cross-tenant child",
          titleAr: null,
          weight: "10.00",
          kriTarget: null,
          dueDate: null,
          actorId: H_ACTOR,
        }),
      ),
    ).rejects.toBeInstanceOf(TalentInvalidError);
  });
});
