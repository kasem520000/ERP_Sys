import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { generateUuidV7 } from "@erp/domain-core";

import { setupHrFixture, superuserClient as su, withTenant } from "./fixtures";
import { AuditService } from "../../modules/audit/api/audit";
import { DrizzleAuditStore } from "../../modules/audit/infrastructure/drizzle-audit.store";
import { TalentGoalsService } from "../../modules/hr/application/talent-goals-service";
import { TalentOrgService } from "../../modules/hr/application/talent-org-service";
import { TalentPerformanceService } from "../../modules/hr/application/talent-performance-service";
import { TalentRecruitmentService } from "../../modules/hr/application/talent-recruitment-service";
import { reloadEnv } from "../../config/env";
import { AppModule } from "../../app.module";
import { closeDb } from "../../infra/db/client";
import { stopBoss } from "../../infra/jobs/boss";
import { PasswordService } from "../../modules/identity/application/password-service";
import * as identityStore from "../../modules/identity/infrastructure/identity.store";

/**
 * PHASE-047 (W-5) — THE ROUTE-LEVEL SPEC (the statutory-routes idiom:
 * the FULL Nest pipeline — middleware → session → permission guard →
 * controller → ERROR_MODEL filter — against the real PostgreSQL stack)
 * for the four talent families' SCREEN-SUBSTRATE routes:
 *
 * (a) THE FOUR READ GATES — anonymous 401; the viewer (no talent key —
 *     0098 §1 grants owner + accountant only) 403 FORBIDDEN naming the
 *     exact family key; the owner passes every guard.
 *
 * (b) THE 360 COMPOSITION READS (this wave's four new routes): the
 *     placement read's null-axes law (a position-less employee ships
 *     null — a valid state, never an error), the trend read's
 *     MANAGER-only law (BR-090 by construction — the 360 input rows
 *     never ride this surface), the goals read, and the
 *     applicant-by-employee read's null law (A7-indistinguishable: no
 *     hire link reads null, never a 404).
 *
 * (c) THE OWN-ROWS LAW AT HTTP: a review submission from an UNLINKED
 *     account (all twelve keys held, no employee row) is the typed
 *     HR_SELF_NOT_LINKED refusal — the reviewer identity is the
 *     session's bridge, never the body.
 *
 * (d) THE LADDER + BR-088 THROUGH THE ERROR FILTER: the one-way cycle
 *     ladder's typed CYCLE_STATE_CONFLICT 409 on a skip-ahead close,
 *     and the applicant stage move's typed STAGE_TRANSITION_INVALID
 *     422 on a backward step — the SAME typed codes the web mirror
 *     localizes, proven end-to-end through the filter.
 *
 * Isolation — THE DEDICATED TENANT (the REMIT precedent): tenant TRT
 * carries its own login users (owner + viewer, cloned templates) and
 * its own talent world, never the H suite's registers.
 */

const TENANT_TRT = "7a7a7a7a-7a7a-7a7a-7a7a-7a7a7a7a7d5d";
const SPEC_PASSWORD = "talent-routes-passphrase-9";

const audit = new AuditService(new DrizzleAuditStore());
const performanceSvc = new TalentPerformanceService(audit);
const goalsSvc = new TalentGoalsService(audit);
const orgSvc = new TalentOrgService(audit);
const recruitmentSvc = new TalentRecruitmentService(audit);

const owner = { email: `trt-owner-${generateUuidV7().slice(0, 8)}@fixture.test`, userId: "", token: "" };
const viewer = { email: `trt-viewer-${generateUuidV7().slice(0, 8)}@fixture.test`, userId: "", token: "" };
/** The unlinked manager: every twelve keys, no employee row — the
 * own-rows law's HTTP arm. */
const unlinked = { email: `trt-unlinked-${generateUuidV7().slice(0, 8)}@fixture.test`, userId: "", token: "" };

interface TrtWorld {
  cycleId: string;
  /** EMP-TRT-1 — the owner-linked employee (position + probation_end). */
  linkedEmployeeId: string;
  /** EMP-TRT-2 — the position-less reviewee (the hire link's target). */
  revieweeId: string;
  vacancyId: string;
  applicantId: string;
}

let world: TrtWorld;
let httpBase: string;
let shutdown: (() => Promise<void>) | undefined;

async function post(path: string, body: unknown, headers: Record<string, string> = {}) {
  const merged: Record<string, string> = {
    "content-type": "application/json",
    "idempotency-key": generateUuidV7(),
    ...headers,
  };
  return fetch(`${httpBase}${path}`, {
    method: "POST",
    headers: merged,
    body: JSON.stringify(body),
  });
}

async function get(path: string, headers: Record<string, string> = {}) {
  return fetch(`${httpBase}${path}`, { headers });
}

beforeAll(async () => {
  reloadEnv();
  await setupHrFixture(); // the DB harness + the shared tenants

  // The dedicated TRT tenant + its three login users (the REMIT idiom:
  // cloned templates — owner carries all twelve talent keys, viewer
  // carries none, the unlinked manager carries owner's keys but no
  // employee row).
  const client = await su();
  await client.query(
    `INSERT INTO tenants (id, name, name_ar, base_currency, country_code, timezone) VALUES
       ($1, 'Tenant TRT (047 routes)', 'المستأجر لمسارات المواهب', 'SAR', 'SA', 'Asia/Riyadh')
     ON CONFLICT (id) DO NOTHING`,
    [TENANT_TRT],
  );
  const passwordService = new PasswordService();
  // Run-unique role keys (the embedded cluster persists across runs —
  // the uuid suffix keeps re-runs green; the REMIT idiom's fixed suffix
  // collided on the second boot).
  const roleSuffix = generateUuidV7().slice(0, 8);
  let roleSeq = 0;
  async function seedUserWithRole(
    account: { email: string; userId: string },
    templateKey: "owner" | "viewer",
  ): Promise<void> {
    roleSeq += 1;
    const hash = await passwordService.hashFromNewPassword(SPEC_PASSWORD);
    const user = await identityStore.insertUser({
      email: account.email,
      fullName: `TRT ${templateKey}`,
      passwordHash: hash,
      status: "ACTIVE",
    });
    account.userId = user.id;
    const roleId = generateUuidV7();
    const template = await client.query<{ id: string }>(
      `SELECT id FROM roles WHERE tenant_id IS NULL AND key = $1`,
      [templateKey],
    );
    await client.query(
      `INSERT INTO roles (id, tenant_id, key, name, name_ar) VALUES ($1, $2, $3, $4, $5)`,
      [roleId, TENANT_TRT, `${templateKey}_trt_${roleSuffix}_${roleSeq}`, templateKey, "دور"],
    );
    await client.query(
      `INSERT INTO role_permissions (role_id, tenant_id, permission_id)
       SELECT $1, $2, rp.permission_id FROM role_permissions rp WHERE rp.role_id = $3`,
      [roleId, TENANT_TRT, template.rows[0]!.id],
    );
    await client.query(
      `INSERT INTO memberships (id, tenant_id, user_id, role_id) VALUES ($1, $2, $3, $4)`,
      [generateUuidV7(), TENANT_TRT, user.id, roleId],
    );
  }
  await seedUserWithRole(owner, "owner");
  await seedUserWithRole(viewer, "viewer");
  await seedUserWithRole(unlinked, "owner");

  // The TRT world: the org plane (unit + graded position), the two
  // employees (the owner-linked reviewer WITH placement + probation; the
  // position-less reviewee), the cycle + BR-089's 100% goal + the
  // submitted MANAGER review, and the recruitment chain to the hire.
  world = await withTenant(TENANT_TRT, async () => {
    const { requireTenantContext } = await import("../../infra/db/tenant-context");
    const { sql } = await import("drizzle-orm");

    // THE ATOMICITY FLOOR'S LOCK ORDER (one transaction for the whole
    // world build): the cycle cluster's keys (talent.cycle|<id>) come
    // FIRST, the org plane's (talent.org-plane — sorts AFTER) second;
    // the review submission after the employee INSERT is a legal
    // RE-ENTRY of the already-held cycle key.
    const cycle = await performanceSvc.createCycle({
      name: "FY2027 Routes Cycle",
      nameAr: "دورة مسارات 2027",
      periodStart: "2027-01-01",
      periodEnd: "2027-06-30",
      reviewDueDate: "2027-06-20",
      scopeOrgUnitIds: [],
      actorId: owner.userId,
    });
    await performanceSvc.transitionCycle(cycle.id, "activate", owner.userId);

    const unit = await orgSvc.createOrgUnit({
      code: "OPS",
      name: "Operations",
      nameAr: "العمليات",
      parentId: null,
      actorId: owner.userId,
    });
    const position = await orgSvc.createPosition({
      code: "POS-TECH",
      title: "Technician",
      titleAr: "فني",
      grade: "G5",
      orgUnitId: unit.id,
      reportsTo: null,
      actorId: owner.userId,
    });

    const rows = await requireTenantContext().tx!.execute<{ id: string; code: string }>(sql`
      INSERT INTO employees (id, tenant_id, code, name, name_ar, hire_date, contract_type,
                             basic_salary, user_id, position_id, probation_end, created_by)
      VALUES
        (gen_random_uuid(), erp.current_tenant_id(), 'EMP-TRT-1', 'Route Linked Employee',
         'الموظف المرتبط', '2026-01-01', 'FULL_TIME', 9000, ${owner.userId}, ${position.id},
         '2027-01-01', ${owner.userId}),
        (gen_random_uuid(), erp.current_tenant_id(), 'EMP-TRT-2', 'Route Reviewee',
         'الموظف المُقيَّم', '2026-02-01', 'FULL_TIME', 8000, NULL, NULL, NULL, ${owner.userId})
      ON CONFLICT (tenant_id, code) DO UPDATE SET name = EXCLUDED.name
      RETURNING id, code
    `);
    const byCode = new Map(rows.rows.map((row) => [row.code, row.id]));
    const linkedEmployeeId = byCode.get("EMP-TRT-1")!;
    const revieweeId = byCode.get("EMP-TRT-2")!;

    // The reviewee's 100% goal (BR-089's gate at submit) + the MANAGER
    // review by the LINKED reviewer — both legal RE-ENTRIES of the
    // transaction's already-held cycle key (the floor's own law).
    await goalsSvc.createGoal({
      cycleId: cycle.id,
      ownerEmployeeId: revieweeId,
      parentGoalId: null,
      title: "Ship the routes module",
      titleAr: null,
      weight: "100.00",
      kriTarget: null,
      dueDate: null,
      actorId: owner.userId,
    });
    await performanceSvc.submitReview({
      reviewerEmployeeId: linkedEmployeeId,
      cycleId: cycle.id,
      revieweeEmployeeId: revieweeId,
      kind: "MANAGER",
      overallScore: "85.50",
      competencyScores: {},
      comments: null,
      actorId: owner.userId,
    });

    // The recruitment chain: vacancy → applicant → OFFER (the hire + the
    // backward-refusal targets).
    const vacancy = await recruitmentSvc.createVacancy({
      code: "VAC-TRT-01",
      positionId: position.id,
      title: "Technician",
      titleAr: null,
      headcount: 1,
      notes: null,
      actorId: owner.userId,
    });
    const applicant = await recruitmentSvc.createApplicant({
      vacancyId: vacancy.id,
      fullName: "Route Applicant",
      fullNameAr: null,
      email: null,
      phone: null,
      source: "routes-spec",
      notes: null,
      actorId: owner.userId,
    });
    await recruitmentSvc.advanceStage(applicant.id, "SCREEN", owner.userId);
    await recruitmentSvc.advanceStage(applicant.id, "INTERVIEW", owner.userId);
    await recruitmentSvc.advanceStage(applicant.id, "OFFER", owner.userId);

    return {
      cycleId: cycle.id,
      linkedEmployeeId,
      revieweeId,
      vacancyId: vacancy.id,
      applicantId: applicant.id,
    };
  });

  // Boot the real application (HTTP + guards + the error filter).
  const { NestFactory } = await import("@nestjs/core");
  const server = await NestFactory.create(AppModule, { logger: false });
  await server.listen(0);
  const httpServer = server.getHttpServer() as import("node:http").Server;
  const port = (httpServer.address() as import("node:net").AddressInfo).port;
  httpBase = `http://127.0.0.1:${port}`;
  shutdown = async () => {
    await server.close();
  };

  // Logins (the rotating session tokens).
  for (const account of [owner, viewer, unlinked]) {
    const response = await post("/api/v1/identity/sessions", {
      email: account.email,
      password: SPEC_PASSWORD,
    });
    expect(response.status).toBe(200);
    const body = (await response.json()) as { data: { token: string } };
    account.token = body.data.token;
  }
}, 240_000);

afterAll(async () => {
  if (shutdown !== undefined) {
    await shutdown();
  }
  await stopBoss();
  await closeDb();
});

describe("PHASE-047 W-5 — the talent screen substrate (the four families' route gates)", () => {
  it("(a) the four read gates: anonymous 401; viewer 403 FORBIDDEN naming the exact family key; owner 200", async () => {
    const families: ReadonlyArray<{ path: string; key: string }> = [
      { path: "/api/v1/hr/performance/cycles", key: "hr.performance.view" },
      { path: "/api/v1/hr/recruitment/vacancies", key: "hr.recruitment.view" },
      { path: "/api/v1/hr/training/programs", key: "hr.training.view" },
      { path: "/api/v1/hr/org/units", key: "hr.org.view" },
    ];
    for (const family of families) {
      const anonymous = await get(family.path);
      expect(anonymous.status, family.path).toBe(401);

      const denied = await get(family.path, { "x-session-token": viewer.token });
      expect(denied.status, family.path).toBe(403);
      const deniedBody = (await denied.json()) as {
        error: { code: string; details: { permissionKey: string } };
      };
      expect(deniedBody.error.code, family.path).toBe("FORBIDDEN");
      expect(deniedBody.error.details.permissionKey, family.path).toBe(family.key);

      const allowed = await get(family.path, { "x-session-token": owner.token });
      expect(allowed.status, family.path).toBe(200);
    }
  });

  it("(b1) THE PLACEMENT READ: the owner-linked employee ships the position + the org unit + probation_end; the position-less employee ships null axes", async () => {
    const placed = await get(`/api/v1/hr/org/placement/${world.linkedEmployeeId}`, {
      "x-session-token": owner.token,
    });
    expect(placed.status).toBe(200);
    const placedBody = (await placed.json()) as {
      data: { position: { code: string; grade: string | null } | null; orgUnit: { path: string } | null; probationEnd: string | null };
    };
    expect(placedBody.data.position?.code).toBe("POS-TECH");
    expect(placedBody.data.position?.grade).toBe("G5");
    expect(placedBody.data.orgUnit?.path).toBe("OPS");
    expect(placedBody.data.probationEnd).toBe("2027-01-01");

    const unplaced = await get(`/api/v1/hr/org/placement/${world.revieweeId}`, {
      "x-session-token": owner.token,
    });
    expect(unplaced.status).toBe(200);
    const unplacedBody = (await unplaced.json()) as {
      data: { position: unknown; orgUnit: unknown; probationEnd: unknown };
    };
    expect(unplacedBody.data.position).toBeNull();
    expect(unplacedBody.data.orgUnit).toBeNull();
    expect(unplacedBody.data.probationEnd).toBeNull();
  });

  it("(b2) THE TREND READ: the reviewee's row rides the MANAGER review with its cycle metadata — BR-090 by construction (no 360 input rows on this surface)", async () => {
    const response = await get(`/api/v1/hr/performance/reviews/for-employee/${world.revieweeId}`, {
      "x-session-token": owner.token,
    });
    expect(response.status).toBe(200);
    const body = (await response.json()) as {
      data: {
        employeeId: string;
        reviews: ReadonlyArray<{
          kind: string;
          status: string;
          overallScore: string | null;
          cycleName: string;
          cycleStatus: string;
        }>;
      };
    };
    expect(body.data.employeeId).toBe(world.revieweeId);
    expect(body.data.reviews).toHaveLength(1);
    const row = body.data.reviews[0]!;
    expect(row.kind).toBe("MANAGER");
    expect(row.status).toBe("SUBMITTED");
    expect(row.overallScore).toBe("85.50");
    expect(row.cycleName).toBe("FY2027 Routes Cycle");
    expect(row.cycleStatus).toBe("ACTIVE");
  });

  it("(b3) THE GOALS READ: the reviewee's 100% goal surfaces on the manage-side plane", async () => {
    const response = await get(`/api/v1/hr/goals/for-employee/${world.revieweeId}`, {
      "x-session-token": owner.token,
    });
    expect(response.status).toBe(200);
    const body = (await response.json()) as {
      data: ReadonlyArray<{ weight: string; status: string; ownerEmployeeId: string }>;
    };
    expect(body.data).toHaveLength(1);
    expect(body.data[0]!.weight).toBe("100.00");
    expect(body.data[0]!.ownerEmployeeId).toBe(world.revieweeId);
  });

  it("(b4) THE APPLICANT-BY-EMPLOYEE READ: null for no hire link (A7-indistinguishable, never a 404); the linked employee's applicant after the hire", async () => {
    // before the hire: the reviewee has no applicant link — null
    const before = await get(`/api/v1/hr/recruitment/applicants/by-employee/${world.revieweeId}`, {
      "x-session-token": owner.token,
    });
    expect(before.status).toBe(200);
    expect(((await before.json()) as { data: unknown }).data).toBeNull();

    // the hire act (the written-once link) through the HTTP plane
    const hired = await post(
      `/api/v1/hr/recruitment/applicants/${world.applicantId}/hire`,
      { employeeId: world.revieweeId },
      { "x-session-token": owner.token },
    );
    expect(hired.status).toBe(201);
    const hiredBody = (await hired.json()) as { data: { stage: string; hiredEmployeeId: string } };
    expect(hiredBody.data.stage).toBe("HIRED");
    expect(hiredBody.data.hiredEmployeeId).toBe(world.revieweeId);

    // after the hire: the source record reads back with the link
    const after = await get(`/api/v1/hr/recruitment/applicants/by-employee/${world.revieweeId}`, {
      "x-session-token": owner.token,
    });
    expect(after.status).toBe(200);
    const afterBody = (await after.json()) as { data: { id: string; stage: string } | null };
    expect(afterBody.data?.id).toBe(world.applicantId);
    expect(afterBody.data?.stage).toBe("HIRED");

    // an employee with no link still reads null (the common case)
    const unlinkedRead = await get(
      `/api/v1/hr/recruitment/applicants/by-employee/${world.linkedEmployeeId}`,
      { "x-session-token": owner.token },
    );
    expect(unlinkedRead.status).toBe(200);
    expect(((await unlinkedRead.json()) as { data: unknown }).data).toBeNull();
  });

  it("(c) THE OWN-ROWS LAW AT HTTP: the unlinked manager's review submission is the typed HR_SELF_NOT_LINKED refusal — the reviewer is the session's bridge, never the body", async () => {
    const response = await post(
      "/api/v1/hr/performance/reviews/submit",
      {
        cycleId: world.cycleId,
        revieweeEmployeeId: world.revieweeId,
        kind: "MANAGER",
        overallScore: "70.00",
        competencyScores: {},
        comments: null,
      },
      { "x-session-token": unlinked.token },
    );
    expect(response.status).toBe(422);
    const body = (await response.json()) as { error: { code: string } };
    expect(body.error.code).toBe("HR_SELF_NOT_LINKED");
  });

  it("(d1) THE LADDER'S TYPED REFUSAL: closing an ACTIVE cycle is the CYCLE_STATE_CONFLICT 409 through the error filter", async () => {
    const response = await post(
      `/api/v1/hr/performance/cycles/${world.cycleId}/close`,
      {},
      { "x-session-token": owner.token },
    );
    expect(response.status).toBe(409);
    const body = (await response.json()) as { error: { code: string } };
    expect(body.error.code).toBe("CYCLE_STATE_CONFLICT");
  });

  it("(d2) BR-088'S TYPED REFUSAL: the HIRED applicant's backward stage move is the STAGE_TRANSITION_INVALID 422 — the same typed code the web mirror localizes", async () => {
    const response = await post(
      `/api/v1/hr/recruitment/applicants/${world.applicantId}/stage`,
      { to: "SCREEN" },
      { "x-session-token": owner.token },
    );
    expect(response.status).toBe(422);
    const body = (await response.json()) as { error: { code: string } };
    expect(body.error.code).toBe("STAGE_TRANSITION_INVALID");
  });

  it("(e) the viewer never reaches the manage plane: the cycle create is the 403 naming hr.performance.manage (zero residue on the register)", async () => {
    const before = await get("/api/v1/hr/performance/cycles", { "x-session-token": owner.token });
    const beforeCount = ((await before.json()) as { data: unknown[] }).data.length;

    const denied = await post(
      "/api/v1/hr/performance/cycles",
      {
        name: "Never Created",
        nameAr: null,
        periodStart: "2027-07-01",
        periodEnd: "2027-12-31",
        reviewDueDate: null,
        scopeOrgUnitIds: [],
      },
      { "x-session-token": viewer.token },
    );
    expect(denied.status).toBe(403);
    const deniedBody = (await denied.json()) as {
      error: { details: { permissionKey: string } };
    };
    expect(deniedBody.error.details.permissionKey).toBe("hr.performance.manage");

    const after = await get("/api/v1/hr/performance/cycles", { "x-session-token": owner.token });
    const afterCount = ((await after.json()) as { data: unknown[] }).data.length;
    expect(afterCount).toBe(beforeCount);
  });
});
