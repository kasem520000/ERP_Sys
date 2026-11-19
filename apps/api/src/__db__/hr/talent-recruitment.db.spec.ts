import { beforeAll, describe, expect, it } from "vitest";
import type { Client } from "pg";

import { withTenant } from "../../infra/db/tenant-context";
import { AuditService } from "../../modules/audit/api/audit";
import { DrizzleAuditStore } from "../../modules/audit/infrastructure/drizzle-audit.store";
import { TalentRecruitmentService } from "../../modules/hr/application/talent-recruitment-service";
import {
  ApplicantAlreadyHiredError,
  ApplicantNotHireableError,
  ApplicantNotFoundError,
  InterviewNotPanelistError,
  InterviewSlotTakenError,
  ReopenInvalidError,
  StageTransitionInvalidError,
  TalentCodeTakenError,
  TalentInvalidError,
  VacancyNotFoundError,
  VacancyStateConflictError,
} from "../../modules/hr/domain/talent-errors";
import { EmployeeNotFoundError } from "../../modules/hr/domain/hr-errors";
import * as store from "../../modules/hr/infrastructure/talent-recruitment.store";
import { superuserClient } from "../test-db";
import { H_ACTOR, setupHrFixture, TENANT_H, TENANT_H_RLS } from "./fixtures";

/**
 * PHASE-047 (W-3 — T-07) — the recruitment engine pinned over real
 * PostgreSQL 16 (the plan §4's `talent-recruitment.db.spec`):
 * acceptance #3 — the monotonic pipeline (BR-088) with the recorded
 * reopen and the hire→employee link, the interview scorecards per
 * panelist per round, the vacancy lifecycle, the stage CAS raced for
 * real, and the tenant boundary.
 */

const audit = new AuditService(new DrizzleAuditStore());
const recruitmentSvc = new TalentRecruitmentService(audit);

interface RecruitmentFixture {
  /** EMP-RC-P — the panelist employee (the scorecard's own-rows arm). */
  panelistId: string;
  /** EMP-RC-H — the hire link's target (an EXISTING 045-master employee). */
  hireEmployeeId: string;
  /** EMP-RC-X — the non-panelist (the own-rows refusal arm). */
  outsiderId: string;
}

const spec: { fixture?: RecruitmentFixture } = {};

beforeAll(async () => {
  await setupHrFixture();
  const su: Client = await superuserClient();
  const employees = await su.query<{ id: string; code: string }>(
    `INSERT INTO employees (id, tenant_id, code, name, name_ar, hire_date, contract_type, basic_salary, created_by) VALUES
       (gen_random_uuid(), $1, 'EMP-RC-P', 'Panelist Person', 'عضو اللجنة', '2024-01-01', 'FULL_TIME', 9000, $2),
       (gen_random_uuid(), $1, 'EMP-RC-H', 'Hire Target', 'موظف التعيين', '2024-01-01', 'FULL_TIME', 9500, $2),
       (gen_random_uuid(), $1, 'EMP-RC-X', 'Outsider', 'خارجي', '2024-01-01', 'FULL_TIME', 7000, $2)
     ON CONFLICT (tenant_id, code) DO UPDATE SET name = EXCLUDED.name
     RETURNING id, code`,
    [TENANT_H, H_ACTOR],
  );
  await su.end();
  const byCode = new Map(employees.rows.map((row) => [row.code, row.id]));
  spec.fixture = {
    panelistId: byCode.get("EMP-RC-P")!,
    hireEmployeeId: byCode.get("EMP-RC-H")!,
    outsiderId: byCode.get("EMP-RC-X")!,
  };
});

/** A fresh OPEN vacancy per arm (unique code — the shared-world law). */
let vacancySeq = 0;
async function freshVacancy() {
  vacancySeq += 1;
  return withTenant(TENANT_H, () =>
    recruitmentSvc.createVacancy({
      code: `VAC-W3-${vacancySeq}-${Date.now() % 100000}`,
      positionId: null,
      title: "W-3 Senior Engineer",
      titleAr: "مهندس أول",
      headcount: 1,
      notes: null,
      actorId: H_ACTOR,
    }),
  );
}

/** A fresh NEW applicant per arm. */
async function freshApplicant(vacancyId: string) {
  return withTenant(TENANT_H, () =>
    recruitmentSvc.createApplicant({
      vacancyId,
      fullName: `W-3 Candidate ${Date.now() % 100000}`,
      fullNameAr: null,
      email: null,
      phone: null,
      source: "referral",
      notes: null,
      actorId: H_ACTOR,
    }),
  );
}

describe("PHASE-047 W-3 — (a) the vacancy lifecycle: the typed CAS transitions", () => {
  it("(a1) creates OPEN with the typed validations (the code shape, the headcount floor, the taken code)", async () => {
    await expect(
      withTenant(TENANT_H, () =>
        recruitmentSvc.createVacancy({
          code: "bad code!",
          positionId: null,
          title: "t",
          titleAr: null,
          headcount: 1,
          notes: null,
          actorId: H_ACTOR,
        }),
      ),
    ).rejects.toBeInstanceOf(TalentInvalidError);
    await expect(
      withTenant(TENANT_H, () =>
        recruitmentSvc.createVacancy({
          code: "VAC-BAD-HC",
          positionId: null,
          title: "t",
          titleAr: null,
          headcount: 0,
          notes: null,
          actorId: H_ACTOR,
        }),
      ),
    ).rejects.toBeInstanceOf(TalentInvalidError);
    const vacancy = await freshVacancy();
    await expect(
      withTenant(TENANT_H, () =>
        recruitmentSvc.createVacancy({
          code: vacancy.code,
          positionId: null,
          title: "dup",
          titleAr: null,
          headcount: 2,
          notes: null,
          actorId: H_ACTOR,
        }),
      ),
    ).rejects.toBeInstanceOf(TalentCodeTakenError);
    expect(vacancy.status).toBe("OPEN");
  });

  it("(a2) the ladder: hold↔resume, fill stamps filled_at, cancel; every illegal edge is the typed conflict", async () => {
    const holdable = await freshVacancy();
    const onHold = await withTenant(TENANT_H, () =>
      recruitmentSvc.transitionVacancy(holdable.id, "hold", H_ACTOR),
    );
    expect(onHold.status).toBe("ON_HOLD");
    const resumed = await withTenant(TENANT_H, () =>
      recruitmentSvc.transitionVacancy(holdable.id, "resume", H_ACTOR),
    );
    expect(resumed.status).toBe("OPEN");
    const filled = await withTenant(TENANT_H, () =>
      recruitmentSvc.transitionVacancy(holdable.id, "fill", H_ACTOR),
    );
    expect(filled.status).toBe("FILLED");
    expect(filled.filledAt).not.toBeNull();
    // FILLED is terminal — every action refuses typed.
    for (const action of ["hold", "resume", "fill", "cancel"] as const) {
      await expect(
        withTenant(TENANT_H, () =>
          recruitmentSvc.transitionVacancy(holdable.id, action, H_ACTOR),
        ),
      ).rejects.toBeInstanceOf(VacancyStateConflictError);
    }
    const cancellable = await freshVacancy();
    const cancelled = await withTenant(TENANT_H, () =>
      recruitmentSvc.transitionVacancy(cancellable.id, "cancel", H_ACTOR),
    );
    expect(cancelled.status).toBe("CANCELLED");
    await expect(
      withTenant(TENANT_H, () =>
        recruitmentSvc.transitionVacancy(cancellable.id, "hold", H_ACTOR),
      ),
    ).rejects.toBeInstanceOf(VacancyStateConflictError);
  });

  it("(a3) the unknown vacancy is the typed 404 (A7 parity)", async () => {
    await expect(
      withTenant(TENANT_H, () =>
        recruitmentSvc.getVacancy("11111111-1111-4111-8111-111111111111"),
      ),
    ).rejects.toBeInstanceOf(VacancyNotFoundError);
  });
});

describe("PHASE-047 W-3 — (b) BR-088: the monotonic stage ladder (forward always, backward never)", () => {
  it("(b1) the one-step walk NEW→SCREEN→INTERVIEW→OFFER records every hop in stage_history", async () => {
    const vacancy = await freshVacancy();
    const applicant = await freshApplicant(vacancy.id);
    expect(applicant.stage).toBe("NEW");
    expect(applicant.stageHistory).toEqual([]);
    const screened = await withTenant(TENANT_H, () =>
      recruitmentSvc.advanceStage(applicant.id, "SCREEN", H_ACTOR),
    );
    expect(screened.stage).toBe("SCREEN");
    expect(screened.stageHistory).toHaveLength(1);
    expect(screened.stageHistory[0]).toMatchObject({
      from: "NEW",
      to: "SCREEN",
      action: "ADVANCE",
    });
    const interviewed = await withTenant(TENANT_H, () =>
      recruitmentSvc.advanceStage(applicant.id, "INTERVIEW", H_ACTOR),
    );
    expect(interviewed.stage).toBe("INTERVIEW");
    const offered = await withTenant(TENANT_H, () =>
      recruitmentSvc.advanceStage(applicant.id, "OFFER", H_ACTOR),
    );
    expect(offered.stage).toBe("OFFER");
    expect(offered.stageHistory).toHaveLength(3);
    expect(offered.version).toBeGreaterThanOrEqual(4);
  });

  it("(b2) the skip is monotonic (NEW→INTERVIEW) and the early rejection reaches the terminal rank from SCREEN", async () => {
    const vacancy = await freshVacancy();
    const skipper = await freshApplicant(vacancy.id);
    const skipped = await withTenant(TENANT_H, () =>
      recruitmentSvc.advanceStage(skipper.id, "INTERVIEW", H_ACTOR),
    );
    expect(skipped.stage).toBe("INTERVIEW");
    expect(skipped.stageHistory).toHaveLength(1);

    const rejectable = await freshApplicant(vacancy.id);
    const rejected = await withTenant(TENANT_H, () =>
      recruitmentSvc.advanceStage(rejectable.id, "REJECTED", H_ACTOR),
    );
    expect(rejected.stage).toBe("REJECTED");
  });

  it("(b3) backward, sideways, and self moves all refuse typed — the monotonic law's zero tolerance", async () => {
    const vacancy = await freshVacancy();
    const applicant = await freshApplicant(vacancy.id);
    await withTenant(TENANT_H, () => recruitmentSvc.advanceStage(applicant.id, "INTERVIEW", H_ACTOR));
    await expect(
      withTenant(TENANT_H, () => recruitmentSvc.advanceStage(applicant.id, "SCREEN", H_ACTOR)),
    ).rejects.toBeInstanceOf(StageTransitionInvalidError);
    await expect(
      withTenant(TENANT_H, () => recruitmentSvc.advanceStage(applicant.id, "NEW", H_ACTOR)),
    ).rejects.toBeInstanceOf(StageTransitionInvalidError);
    await expect(
      withTenant(TENANT_H, () => recruitmentSvc.advanceStage(applicant.id, "INTERVIEW", H_ACTOR)),
    ).rejects.toBeInstanceOf(StageTransitionInvalidError);
    // The HIRED stage is NEVER a bare hop — the hire act owns it.
    await expect(
      withTenant(TENANT_H, () => recruitmentSvc.advanceStage(applicant.id, "HIRED", H_ACTOR)),
    ).rejects.toBeInstanceOf(TalentInvalidError);
    // An unknown stage string refuses typed.
    await expect(
      withTenant(TENANT_H, () => recruitmentSvc.advanceStage(applicant.id, "ONBOARDING", H_ACTOR)),
    ).rejects.toBeInstanceOf(TalentInvalidError);
  });

  it("(b4) the terminals accept nothing: a REJECTED applicant cannot advance; the reopen is the only way back", async () => {
    const vacancy = await freshVacancy();
    const applicant = await freshApplicant(vacancy.id);
    await withTenant(TENANT_H, () => recruitmentSvc.advanceStage(applicant.id, "REJECTED", H_ACTOR));
    for (const to of ["SCREEN", "OFFER", "REJECTED"] as const) {
      await expect(
        withTenant(TENANT_H, () => recruitmentSvc.advanceStage(applicant.id, to, H_ACTOR)),
      ).rejects.toBeInstanceOf(StageTransitionInvalidError);
    }
  });
});

describe("PHASE-047 W-3 — (c) the ONE recorded backward edge: the reopen", () => {
  it("(c1) REJECTED → SCREEN via the dedicated act, the REOPEN record in history, and the pipeline lives again", async () => {
    const vacancy = await freshVacancy();
    const applicant = await freshApplicant(vacancy.id);
    await withTenant(TENANT_H, () => recruitmentSvc.advanceStage(applicant.id, "REJECTED", H_ACTOR));
    const reopened = await withTenant(TENANT_H, () =>
      recruitmentSvc.reopenApplicant(applicant.id, H_ACTOR),
    );
    expect(reopened.stage).toBe("SCREEN");
    const reopenEntry = reopened.stageHistory.at(-1)!;
    expect(reopenEntry).toMatchObject({ from: "REJECTED", to: "SCREEN", action: "REOPEN" });
    // The pipeline lives: the reopened applicant walks forward again.
    const reOffered = await withTenant(TENANT_H, () =>
      recruitmentSvc.advanceStage(applicant.id, "OFFER", H_ACTOR),
    );
    expect(reOffered.stage).toBe("OFFER");
    expect(reOffered.stageHistory).toHaveLength(3);
  });

  it("(c2) only a REJECTED applicant reopens — the live stages and HIRED refuse typed", async () => {
    const vacancy = await freshVacancy();
    const live = await freshApplicant(vacancy.id);
    await expect(
      withTenant(TENANT_H, () => recruitmentSvc.reopenApplicant(live.id, H_ACTOR)),
    ).rejects.toBeInstanceOf(ReopenInvalidError);
    const hired = await freshApplicant(vacancy.id);
    await withTenant(TENANT_H, () => recruitmentSvc.advanceStage(hired.id, "OFFER", H_ACTOR));
    await withTenant(TENANT_H, () =>
      recruitmentSvc.hireApplicant(hired.id, spec.fixture!.hireEmployeeId, H_ACTOR),
    );
    await expect(
      withTenant(TENANT_H, () => recruitmentSvc.reopenApplicant(hired.id, H_ACTOR)),
    ).rejects.toBeInstanceOf(ReopenInvalidError);
  });
});

describe("PHASE-047 W-3 — (d) the hire act: the written-once employee link (acceptance #3)", () => {
  it("(d1) the hire requires OFFER — the earlier stages refuse typed; the link is written once; the unknown employee is the A7 404", async () => {
    const vacancy = await freshVacancy();
    const early = await freshApplicant(vacancy.id);
    await expect(
      withTenant(TENANT_H, () =>
        recruitmentSvc.hireApplicant(early.id, spec.fixture!.hireEmployeeId, H_ACTOR),
      ),
    ).rejects.toBeInstanceOf(ApplicantNotHireableError);
    await withTenant(TENANT_H, () => recruitmentSvc.advanceStage(early.id, "OFFER", H_ACTOR));
    await expect(
      withTenant(TENANT_H, () =>
        recruitmentSvc.hireApplicant(early.id, "11111111-1111-4111-8111-111111111199", H_ACTOR),
      ),
    ).rejects.toBeInstanceOf(EmployeeNotFoundError);
    const hired = await withTenant(TENANT_H, () =>
      recruitmentSvc.hireApplicant(early.id, spec.fixture!.hireEmployeeId, H_ACTOR),
    );
    expect(hired.stage).toBe("HIRED");
    expect(hired.hiredEmployeeId).toBe(spec.fixture!.hireEmployeeId);
    const hireEntry = hired.stageHistory.at(-1)!;
    expect(hireEntry).toMatchObject({ from: "OFFER", to: "HIRED", action: "HIRE" });
    // The link is written ONCE — the second hire is the typed 409,
    // never a silent relink.
    await expect(
      withTenant(TENANT_H, () =>
        recruitmentSvc.hireApplicant(early.id, spec.fixture!.hireEmployeeId, H_ACTOR),
      ),
    ).rejects.toBeInstanceOf(ApplicantAlreadyHiredError);
    // The hired record reads back with the link (the 360 extension's
    // source record — the read side of acceptance #3).
    const readBack = await withTenant(TENANT_H, () => recruitmentSvc.getApplicant(early.id));
    expect(readBack.hiredEmployeeId).toBe(spec.fixture!.hireEmployeeId);
    // The unknown applicant is the typed 404 (A7 parity).
    await expect(
      withTenant(TENANT_H, () => recruitmentSvc.getApplicant("11111111-1111-4111-8111-111111111188")),
    ).rejects.toBeInstanceOf(ApplicantNotFoundError);
  });

  it("(d2) THE NF-10 WRITTEN-ONCE ARM (the owner's W-3 verification finding, deepened 2026-11-19/W-4): a hire CAS against a row pinned at OFFER but ALREADY LINKED matches ZERO rows — the second defense line is structural, the row untouched", async () => {
    const vacancy = await freshVacancy();
    const applicant = await freshApplicant(vacancy.id);
    await withTenant(TENANT_H, () => recruitmentSvc.advanceStage(applicant.id, "OFFER", H_ACTOR));
    // A state no API path produces (OFFER + an existing link): the raw
    // seed pins it — the W-3 law held via the stage pin alone because
    // no ladder path leads back to OFFER; the NF-10 arm makes the
    // link's written-once law hold EVEN IF a future path ever did.
    const su: Client = await superuserClient();
    await su.query(
      `UPDATE applicants SET hired_employee_id = $3 WHERE tenant_id = $1 AND id = $2`,
      [TENANT_H, applicant.id, spec.fixture!.hireEmployeeId],
    );
    await su.end();
    const before = await withTenant(TENANT_H, () => recruitmentSvc.getApplicant(applicant.id));
    // The store-level CAS with a hire link: ZERO rows (the arm refuses).
    const cas = await withTenant(TENANT_H, () =>
      store.casAdvanceStage({
        applicantId: applicant.id,
        from: "OFFER",
        to: "HIRED",
        action: "HIRE",
        actorId: H_ACTOR,
        at: new Date().toISOString(),
        hiredEmployeeId: spec.fixture!.hireEmployeeId,
      }),
    );
    expect(cas).toBeUndefined();
    // ZERO RESIDUE: still OFFER, still the ORIGINAL link, version
    // unbumped, no HIRE record in the history.
    const after = await withTenant(TENANT_H, () => recruitmentSvc.getApplicant(applicant.id));
    expect(after.stage).toBe("OFFER");
    expect(after.hiredEmployeeId).toBe(spec.fixture!.hireEmployeeId);
    expect(after.version).toBe(before.version);
    expect(after.stageHistory.some((entry) => entry.action === "HIRE")).toBe(false);
  });
});

describe("PHASE-047 W-3 — (e) the panel scorecards: one row per panelist per round, the own-rows law", () => {
  it("(e1) schedules the slot, records the panelist's OWN card, and lists the panel record", async () => {
    const vacancy = await freshVacancy();
    const applicant = await freshApplicant(vacancy.id);
    await withTenant(TENANT_H, () => recruitmentSvc.advanceStage(applicant.id, "INTERVIEW", H_ACTOR));
    const slot = await withTenant(TENANT_H, () =>
      recruitmentSvc.scheduleInterview({
        applicantId: applicant.id,
        round: 1,
        panelistEmployeeId: spec.fixture!.panelistId,
        scheduledStart: "2026-12-01T09:00:00Z",
        scheduledEnd: "2026-12-01T10:00:00Z",
        mode: "ONSITE",
        actorId: H_ACTOR,
      }),
    );
    expect(slot.round).toBe(1);
    expect(slot.verdict).toBeNull();
    const scored = await withTenant(TENANT_H, () =>
      recruitmentSvc.recordScorecard({
        interviewId: slot.id,
        panelistEmployeeId: spec.fixture!.panelistId,
        scorecard: { communication: 4, depth: 5 },
        verdict: "HIRE",
        comments: "Strong systems thinking",
      }),
    );
    expect(scored.verdict).toBe("HIRE");
    expect(scored.scorecard).toEqual({ communication: 4, depth: 5 });
    const panel = await withTenant(TENANT_H, () =>
      recruitmentSvc.listInterviews({ applicantId: applicant.id }),
    );
    expect(panel).toHaveLength(1);
  });

  it("(e2) the duplicate slot is the typed 409; the inverted window and the bad mode refuse typed", async () => {
    const vacancy = await freshVacancy();
    const applicant = await freshApplicant(vacancy.id);
    await withTenant(TENANT_H, () =>
      recruitmentSvc.scheduleInterview({
        applicantId: applicant.id,
        round: 1,
        panelistEmployeeId: spec.fixture!.panelistId,
        scheduledStart: "2026-12-01T09:00:00Z",
        scheduledEnd: "2026-12-01T10:00:00Z",
        mode: "VIDEO",
        actorId: H_ACTOR,
      }),
    );
    await expect(
      withTenant(TENANT_H, () =>
        recruitmentSvc.scheduleInterview({
          applicantId: applicant.id,
          round: 1,
          panelistEmployeeId: spec.fixture!.panelistId,
          scheduledStart: "2026-12-02T09:00:00Z",
          scheduledEnd: "2026-12-02T10:00:00Z",
          mode: "ONSITE",
          actorId: H_ACTOR,
        }),
      ),
    ).rejects.toBeInstanceOf(InterviewSlotTakenError);
    await expect(
      withTenant(TENANT_H, () =>
        recruitmentSvc.scheduleInterview({
          applicantId: applicant.id,
          round: 2,
          panelistEmployeeId: spec.fixture!.panelistId,
          scheduledStart: "2026-12-01T11:00:00Z",
          scheduledEnd: "2026-12-01T10:00:00Z",
          mode: "ONSITE",
          actorId: H_ACTOR,
        }),
      ),
    ).rejects.toBeInstanceOf(TalentInvalidError);
    await expect(
      withTenant(TENANT_H, () =>
        recruitmentSvc.scheduleInterview({
          applicantId: applicant.id,
          round: 2,
          panelistEmployeeId: spec.fixture!.panelistId,
          scheduledStart: "2026-12-01T11:00:00Z",
          scheduledEnd: "2026-12-01T12:00:00Z",
          mode: "CARRIER_PIGEON",
          actorId: H_ACTOR,
        }),
      ),
    ).rejects.toBeInstanceOf(TalentInvalidError);
  });

  it("(e3) the own-rows law: a non-panelist's scorecard write is the typed refusal", async () => {
    const vacancy = await freshVacancy();
    const applicant = await freshApplicant(vacancy.id);
    const slot = await withTenant(TENANT_H, () =>
      recruitmentSvc.scheduleInterview({
        applicantId: applicant.id,
        round: 1,
        panelistEmployeeId: spec.fixture!.panelistId,
        scheduledStart: "2026-12-01T09:00:00Z",
        scheduledEnd: "2026-12-01T10:00:00Z",
        mode: "PHONE",
        actorId: H_ACTOR,
      }),
    );
    await expect(
      withTenant(TENANT_H, () =>
        recruitmentSvc.recordScorecard({
          interviewId: slot.id,
          panelistEmployeeId: spec.fixture!.outsiderId,
          scorecard: { sabotage: 1 },
          verdict: "NO_HIRE",
          comments: null,
        }),
      ),
    ).rejects.toBeInstanceOf(InterviewNotPanelistError);
    // The slot is untouched by the refused write.
    const untouched = await withTenant(TENANT_H, () =>
      recruitmentSvc.listInterviews({ applicantId: applicant.id }),
    );
    expect(untouched[0]!.verdict).toBeNull();
  });
});

describe("PHASE-047 W-3 — (f) the stage CAS race: a real two-transaction duel", () => {
  it("(f1) two writers on the same edge: the row lock serializes, the loser's WHERE re-evaluates → zero rows, one version bump", async () => {
    const vacancy = await freshVacancy();
    const applicant = await freshApplicant(vacancy.id);
    const suA: Client = await superuserClient();
    const suB: Client = await superuserClient();
    try {
      await suA.query("BEGIN");
      const a = await suA.query(
        `UPDATE applicants SET stage = 'SCREEN', version = version + 1
         WHERE id = $1 AND stage = 'NEW' RETURNING id`,
        [applicant.id],
      );
      expect(a.rowCount).toBe(1);
      const bPromise = suB
        .query(
          `UPDATE applicants SET stage = 'SCREEN', version = version + 1
           WHERE id = $1 AND stage = 'NEW' RETURNING id`,
          [applicant.id],
        )
        .then((res) => res.rowCount)
        .catch(() => -1);
      await new Promise((resolve) => setTimeout(resolve, 150));
      await suA.query("COMMIT");
      const bCount = await bPromise;
      expect(bCount).toBe(0);
      await suB.query("ROLLBACK");
      // The store now holds exactly ONE flip; the service's stale read
      // (NEW) refuses typed.
      await expect(
        withTenant(TENANT_H, () => recruitmentSvc.advanceStage(applicant.id, "SCREEN", H_ACTOR)),
      ).rejects.toBeInstanceOf(StageTransitionInvalidError);
      const after = await withTenant(TENANT_H, () => recruitmentSvc.getApplicant(applicant.id));
      expect(after.stage).toBe("SCREEN");
      expect(after.version).toBe(2);
    } finally {
      await suA.end().catch(() => undefined);
      await suB.end().catch(() => undefined);
    }
  });
});

describe("PHASE-047 W-3 — (g) the tenant boundary", () => {
  it("(g1) the empty world BY CONSTRUCTION + the A7 404/invalid parity for foreign ids", async () => {
    // TENANT_H_RLS is empty BY CONSTRUCTION (the fixtures' law).
    const rlsVacancies = await withTenant(TENANT_H_RLS, () => recruitmentSvc.listVacancies({}));
    expect(rlsVacancies).toHaveLength(0);
    const rlsApplicants = await withTenant(TENANT_H_RLS, () =>
      recruitmentSvc.listApplicants({}),
    );
    expect(rlsApplicants).toHaveLength(0);
    // A foreign (tenant H) vacancy id renders as unknown on the RLS
    // tenant — A7 parity, no existence disclosure.
    const ownVacancy = await freshVacancy();
    await expect(
      withTenant(TENANT_H_RLS, () => recruitmentSvc.getVacancy(ownVacancy.id)),
    ).rejects.toBeInstanceOf(VacancyNotFoundError);
    const ownApplicant = await freshApplicant(ownVacancy.id);
    await expect(
      withTenant(TENANT_H_RLS, () =>
        recruitmentSvc.advanceStage(ownApplicant.id, "SCREEN", H_ACTOR),
      ),
    ).rejects.toBeInstanceOf(ApplicantNotFoundError);
    // The foreign hire link's employee is invisible on the RLS tenant.
    await withTenant(TENANT_H_RLS, async () => {
      const localVacancy = await recruitmentSvc.createVacancy({
        code: `VAC-RLS-${Date.now() % 100000}`,
        positionId: null,
        title: "RLS vacancy",
        titleAr: null,
        headcount: 1,
        notes: null,
        actorId: H_ACTOR,
      });
      const localApplicant = await recruitmentSvc.createApplicant({
        vacancyId: localVacancy.id,
        fullName: "RLS candidate",
        fullNameAr: null,
        email: null,
        phone: null,
        source: null,
        notes: null,
        actorId: H_ACTOR,
      });
      await recruitmentSvc.advanceStage(localApplicant.id, "OFFER", H_ACTOR);
      await expect(
        recruitmentSvc.hireApplicant(localApplicant.id, spec.fixture!.hireEmployeeId, H_ACTOR),
      ).rejects.toBeInstanceOf(EmployeeNotFoundError);
    });
  });
});
