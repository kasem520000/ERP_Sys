import { beforeAll, describe, expect, it } from "vitest";
import type { Client } from "pg";

import { withTenant } from "../../infra/db/tenant-context";
import { AuditService } from "../../modules/audit/api/audit";
import { DrizzleAuditStore } from "../../modules/audit/infrastructure/drizzle-audit.store";
import { TalentOrgService } from "../../modules/hr/application/talent-org-service";
import { TalentTrainingService } from "../../modules/hr/application/talent-training-service";
import {
  CertificationNotFoundError,
  DuplicateEnrollmentError,
  OrgCycleError,
  OrgUnitNotFoundError,
  TalentCodeTakenError,
  TalentInvalidError,
  TrainingProgramNotFoundError,
} from "../../modules/hr/domain/talent-errors";
import { superuserClient } from "../test-db";
import { H_ACTOR, setupHrFixture, TENANT_H, TENANT_H_RLS } from "./fixtures";

/**
 * PHASE-047 (W-3 — T-08) — the training + org engines pinned over
 * real PostgreSQL 16 (the plan §4's `talent-training-org.db.spec`):
 * acceptance #4 — enrollments record completion and results,
 * certifications feed the expiry sweep with issuer and expiry intact
 * (the sweep side rides talent-documents-sweep.db.spec); D-09's org
 * tree — the cycle rejection at write time, the materialized-path
 * subtree rewrite on moves; and the tenant boundary.
 */

const audit = new AuditService(new DrizzleAuditStore());
const trainingSvc = new TalentTrainingService(audit);
const orgSvc = new TalentOrgService(audit);

interface TrainingOrgFixture {
  /** EMP-TN-1 — the enrollee/certification holder. */
  employeeId: string;
  /** EMP-TN-2 — the second enrollee (the duplicate-arm contrast). */
  secondEmployeeId: string;
}

const spec: { fixture?: TrainingOrgFixture } = {};

beforeAll(async () => {
  await setupHrFixture();
  const su: Client = await superuserClient();
  const employees = await su.query<{ id: string; code: string }>(
    `INSERT INTO employees (id, tenant_id, code, name, name_ar, hire_date, contract_type, basic_salary, created_by) VALUES
       (gen_random_uuid(), $1, 'EMP-TN-1', 'Trainee One', 'متدرب أول', '2024-06-01', 'FULL_TIME', 8000, $2),
       (gen_random_uuid(), $1, 'EMP-TN-2', 'Trainee Two', 'متدرب ثانٍ', '2024-06-01', 'FULL_TIME', 8000, $2)
     ON CONFLICT (tenant_id, code) DO UPDATE SET name = EXCLUDED.name
     RETURNING id, code`,
    [TENANT_H, H_ACTOR],
  );
  await su.end();
  const byCode = new Map(employees.rows.map((row) => [row.code, row.id]));
  spec.fixture = {
    employeeId: byCode.get("EMP-TN-1")!,
    secondEmployeeId: byCode.get("EMP-TN-2")!,
  };
});

let programSeq = 0;
async function freshProgram(overrides: Partial<{ cost: string | null }> = {}) {
  programSeq += 1;
  return withTenant(TENANT_H, () =>
    trainingSvc.createProgram({
      code: `TRN-W3-${programSeq}-${Date.now() % 100000}`,
      name: "W-3 Compliance Bootcamp",
      nameAr: "معسكر الامتثال",
      kind: "EXTERNAL",
      provider: "Gulf Training Institute",
      cost: overrides.cost ?? "2500.0000",
      notes: null,
      actorId: H_ACTOR,
    }),
  );
}

let orgSeq = 0;
async function freshOrgUnit(parentId: string | null) {
  orgSeq += 1;
  return withTenant(TENANT_H, () =>
    orgSvc.createOrgUnit({
      code: `OU-W3-${orgSeq}-${Date.now() % 100000}`,
      name: "W-3 Unit",
      nameAr: null,
      parentId,
      actorId: H_ACTOR,
    }),
  );
}

describe("PHASE-047 W-3 — (a) the training program catalog", () => {
  it("(a1) creates with the exact-decimal cost (ADR-0009), the kind enum, and the taken-code refusal", async () => {
    const program = await freshProgram();
    expect(program.cost).toBe("2500.0000");
    expect(program.kind).toBe("EXTERNAL");
    expect(program.status).toBe("ACTIVE");
    await expect(
      withTenant(TENANT_H, () =>
        trainingSvc.createProgram({
          code: program.code,
          name: "dup",
          nameAr: null,
          kind: "INTERNAL",
          provider: null,
          cost: null,
          notes: null,
          actorId: H_ACTOR,
        }),
      ),
    ).rejects.toBeInstanceOf(TalentCodeTakenError);
    await expect(
      withTenant(TENANT_H, () =>
        trainingSvc.createProgram({
          code: "TRN-BAD-KIND",
          name: "bad",
          nameAr: null,
          kind: "MYSTERY",
          provider: null,
          cost: null,
          notes: null,
          actorId: H_ACTOR,
        }),
      ),
    ).rejects.toBeInstanceOf(TalentInvalidError);
    // A float-shaped string is refused (the decimal-string law).
    await expect(
      freshProgram({ cost: "2500.00001" }),
    ).rejects.toBeInstanceOf(TalentInvalidError);
    // The RETIRED flip + the retirement's enrollment gate.
    const retired = await freshProgram({ cost: null });
    const flipped = await withTenant(TENANT_H, () =>
      trainingSvc.updateProgram({ id: retired.id, status: "RETIRED", actorId: H_ACTOR }),
    );
    expect(flipped.status).toBe("RETIRED");
    await expect(
      withTenant(TENANT_H, () =>
        trainingSvc.enroll({
          programId: retired.id,
          employeeId: spec.fixture!.employeeId,
          notes: null,
          actorId: H_ACTOR,
        }),
      ),
    ).rejects.toBeInstanceOf(TalentInvalidError);
  });
});

describe("PHASE-047 W-3 — (b) the enrollments: the natural key, the ladder, the completion act (acceptance #4)", () => {
  it("(b1) enrolls once per (program, employee) — the duplicate is the typed 409; the ladder walks with the validated percentages", async () => {
    const program = await freshProgram();
    const enrolled = await withTenant(TENANT_H, () =>
      trainingSvc.enroll({
        programId: program.id,
        employeeId: spec.fixture!.employeeId,
        notes: null,
        actorId: H_ACTOR,
      }),
    );
    expect(enrolled.status).toBe("ENROLLED");
    await expect(
      withTenant(TENANT_H, () =>
        trainingSvc.enroll({
          programId: program.id,
          employeeId: spec.fixture!.employeeId,
          notes: null,
          actorId: H_ACTOR,
        }),
      ),
    ).rejects.toBeInstanceOf(DuplicateEnrollmentError);
    // A second employee on the SAME program is a distinct record.
    const second = await withTenant(TENANT_H, () =>
      trainingSvc.enroll({
        programId: program.id,
        employeeId: spec.fixture!.secondEmployeeId,
        notes: null,
        actorId: H_ACTOR,
      }),
    );
    expect(second.id).not.toBe(enrolled.id);
    // The percentage shapes validate (the 2-dp decimal-string law).
    await expect(
      withTenant(TENANT_H, () =>
        trainingSvc.updateEnrollment({
          id: enrolled.id,
          attendancePct: "101.00",
          actorId: H_ACTOR,
        }),
      ),
    ).rejects.toBeInstanceOf(TalentInvalidError);
    const inProgress = await withTenant(TENANT_H, () =>
      trainingSvc.updateEnrollment({
        id: enrolled.id,
        status: "IN_PROGRESS",
        attendancePct: "92.50",
        actorId: H_ACTOR,
      }),
    );
    expect(inProgress.status).toBe("IN_PROGRESS");
    expect(inProgress.attendancePct).toBe("92.50");
  });

  it("(b2) the completion act stamps completed_at with the result; WITHDRAWN is terminal", async () => {
    const program = await freshProgram();
    const enrolled = await withTenant(TENANT_H, () =>
      trainingSvc.enroll({
        programId: program.id,
        employeeId: spec.fixture!.employeeId,
        notes: null,
        actorId: H_ACTOR,
      }),
    );
    const completed = await withTenant(TENANT_H, () =>
      trainingSvc.updateEnrollment({
        id: enrolled.id,
        status: "COMPLETED",
        attendancePct: "100.00",
        completionPct: "100.00",
        result: "PASSED",
        actorId: H_ACTOR,
      }),
    );
    expect(completed.status).toBe("COMPLETED");
    expect(completed.result).toBe("PASSED");
    expect(completed.completedAt).not.toBeNull();
    expect(completed.completionPct).toBe("100.00");
    // The withdrawn record is terminal — the soft path (no DELETE).
    const withdrawnProgram = await freshProgram();
    const withdrawn = await withTenant(TENANT_H, () =>
      trainingSvc.enroll({
        programId: withdrawnProgram.id,
        employeeId: spec.fixture!.employeeId,
        notes: null,
        actorId: H_ACTOR,
      }),
    );
    await withTenant(TENANT_H, () =>
      trainingSvc.updateEnrollment({ id: withdrawn.id, status: "WITHDRAWN", actorId: H_ACTOR }),
    );
    await expect(
      withTenant(TENANT_H, () =>
        trainingSvc.updateEnrollment({ id: withdrawn.id, status: "IN_PROGRESS", actorId: H_ACTOR }),
      ),
    ).rejects.toBeInstanceOf(TalentInvalidError);
  });
});

describe("PHASE-047 W-3 — (c) the certification register: issuer and expiry intact (acceptance #4)", () => {
  it("(c1) registers with the validated window; the renewal UPDATE keeps the issuer/expiry coherent; the register lists per employee", async () => {
    await expect(
      withTenant(TENANT_H, () =>
        trainingSvc.registerCertification({
          employeeId: spec.fixture!.employeeId,
          name: "Inverted",
          nameAr: null,
          issuer: "Bad Issuer",
          issueDate: "2027-01-01",
          expiryDate: "2026-01-01",
          certificateNumber: null,
          notes: null,
          actorId: H_ACTOR,
        }),
      ),
    ).rejects.toBeInstanceOf(TalentInvalidError);
    const registered = await withTenant(TENANT_H, () =>
      trainingSvc.registerCertification({
        employeeId: spec.fixture!.employeeId,
        name: "NEBOSH General",
        nameAr: "نيبوش العامة",
        issuer: "NEBOSH",
        issueDate: "2025-01-15",
        expiryDate: "2028-01-15",
        certificateNumber: "NEB-2025-8891",
        notes: null,
        actorId: H_ACTOR,
      }),
    );
    expect(registered.issuer).toBe("NEBOSH");
    expect(registered.expiryDate).toBe("2028-01-15");
    // The renewal act: a new window, the issuer may change.
    const renewed = await withTenant(TENANT_H, () =>
      trainingSvc.renewCertification({
        id: registered.id,
        issueDate: "2028-01-10",
        expiryDate: "2031-01-10",
        actorId: H_ACTOR,
      }),
    );
    expect(renewed.expiryDate).toBe("2031-01-10");
    expect(renewed.issuer).toBe("NEBOSH");
    const listed = await withTenant(TENANT_H, () =>
      trainingSvc.listCertifications({ employeeId: spec.fixture!.employeeId }),
    );
    expect(listed.some((row) => row.id === registered.id)).toBe(true);
    await expect(
      withTenant(TENANT_H, () =>
        trainingSvc.renewCertification({
          id: "11111111-1111-4111-8111-111111111177",
          expiryDate: "2031-01-10",
          actorId: H_ACTOR,
        }),
      ),
    ).rejects.toBeInstanceOf(CertificationNotFoundError);
  });
});

describe("PHASE-047 W-3 — (d) the org tree: D-09's cycle-safe moves + the materialized path", () => {
  it("(d1) builds the tree with dot-joined paths; the dot-free code law is typed", async () => {
    const root = await freshOrgUnit(null);
    expect(root.path).toBe(root.code);
    expect(root.parentId).toBeNull();
    const child = await freshOrgUnit(root.id);
    expect(child.path).toBe(`${root.code}.${child.code}`);
    const grandchild = await freshOrgUnit(child.id);
    expect(grandchild.path).toBe(`${root.code}.${child.code}.${grandchild.code}`);
    await expect(
      withTenant(TENANT_H, () =>
        orgSvc.createOrgUnit({
          code: "BAD.CODE",
          name: "dotted",
          nameAr: null,
          parentId: null,
          actorId: H_ACTOR,
        }),
      ),
    ).rejects.toBeInstanceOf(TalentInvalidError);
    // The taken code refuses typed.
    await expect(
      withTenant(TENANT_H, () =>
        orgSvc.createOrgUnit({
          code: root.code,
          name: "dup",
          nameAr: null,
          parentId: null,
          actorId: H_ACTOR,
        }),
      ),
    ).rejects.toBeInstanceOf(TalentCodeTakenError);
  });

  it("(d2) the move rewrites the WHOLE subtree's paths atomically", async () => {
    const rootA = await freshOrgUnit(null);
    const rootB = await freshOrgUnit(null);
    const mid = await freshOrgUnit(rootA.id);
    const leaf = await freshOrgUnit(mid.id);
    expect(leaf.path).toBe(`${rootA.code}.${mid.code}.${leaf.code}`);
    // Move `mid` under rootB — mid AND leaf re-path.
    const moved = await withTenant(TENANT_H, () =>
      orgSvc.patchOrgUnit({ id: mid.id, parentId: rootB.id, actorId: H_ACTOR }),
    );
    expect(moved.parentId).toBe(rootB.id);
    expect(moved.path).toBe(`${rootB.code}.${mid.code}`);
    const leafAfter = await withTenant(TENANT_H, () => orgSvc.getOrgUnit(leaf.id));
    expect(leafAfter.path).toBe(`${rootB.code}.${mid.code}.${leaf.code}`);
    // Move to root: mid becomes a root, leaf follows.
    const toRoot = await withTenant(TENANT_H, () =>
      orgSvc.patchOrgUnit({ id: mid.id, parentId: null, actorId: H_ACTOR }),
    );
    expect(toRoot.path).toBe(mid.code);
    const leafRooted = await withTenant(TENANT_H, () => orgSvc.getOrgUnit(leaf.id));
    expect(leafRooted.path).toBe(`${mid.code}.${leaf.code}`);
  });

  it("(d3) the cycle-closing move refuses typed BEFORE any write — and the tree stays intact", async () => {
    const root = await freshOrgUnit(null);
    const child = await freshOrgUnit(root.id);
    const grandchild = await freshOrgUnit(child.id);
    // Moving the root under its own grandchild closes the loop.
    await expect(
      withTenant(TENANT_H, () =>
        orgSvc.patchOrgUnit({ id: root.id, parentId: grandchild.id, actorId: H_ACTOR }),
      ),
    ).rejects.toBeInstanceOf(OrgCycleError);
    // Self-parent refuses typed.
    await expect(
      withTenant(TENANT_H, () =>
        orgSvc.patchOrgUnit({ id: root.id, parentId: root.id, actorId: H_ACTOR }),
      ),
    ).rejects.toBeInstanceOf(OrgCycleError);
    // The tree is intact after the refusals.
    const childAfter = await withTenant(TENANT_H, () => orgSvc.getOrgUnit(child.id));
    expect(childAfter.parentId).toBe(root.id);
    expect(childAfter.path).toBe(`${root.code}.${child.code}`);
    const grandchildAfter = await withTenant(TENANT_H, () => orgSvc.getOrgUnit(grandchild.id));
    expect(grandchildAfter.path).toBe(`${root.code}.${child.code}.${grandchild.code}`);
    // The unknown parent is the typed 404 (A7 parity).
    await expect(
      withTenant(TENANT_H, () =>
        orgSvc.patchOrgUnit({
          id: root.id,
          parentId: "11111111-1111-4111-8111-111111111166",
          actorId: H_ACTOR,
        }),
      ),
    ).rejects.toBeInstanceOf(OrgUnitNotFoundError);
  });
});

describe("PHASE-047 W-3 — (e) the positions: reports_to with the same D-09 guard", () => {
  it("(e1) creates the bilingual slot; the reports_to cycle refuses typed; RETIRED flips", async () => {
    const unit = await freshOrgUnit(null);
    const ceo = await withTenant(TENANT_H, () =>
      orgSvc.createPosition({
        code: `POS-W3-CEO-${Date.now() % 100000}`,
        title: "Chief Executive",
        titleAr: "الرئيس التنفيذي",
        grade: "G1",
        orgUnitId: unit.id,
        reportsTo: null,
        actorId: H_ACTOR,
      }),
    );
    const director = await withTenant(TENANT_H, () =>
      orgSvc.createPosition({
        code: `POS-W3-DR-${Date.now() % 100000}`,
        title: "Director",
        titleAr: "مدير",
        grade: "G2",
        orgUnitId: unit.id,
        reportsTo: ceo.id,
        actorId: H_ACTOR,
      }),
    );
    expect(director.reportsTo).toBe(ceo.id);
    // The manager under the report refuses typed (the cycle).
    await expect(
      withTenant(TENANT_H, () =>
        orgSvc.patchPosition({ id: ceo.id, reportsTo: director.id, actorId: H_ACTOR }),
      ),
    ).rejects.toBeInstanceOf(OrgCycleError);
    // Self-report refuses typed.
    await expect(
      withTenant(TENANT_H, () =>
        orgSvc.patchPosition({ id: ceo.id, reportsTo: ceo.id, actorId: H_ACTOR }),
      ),
    ).rejects.toBeInstanceOf(OrgCycleError);
    // The retirement flip.
    const retired = await withTenant(TENANT_H, () =>
      orgSvc.patchPosition({ id: director.id, status: "RETIRED", actorId: H_ACTOR }),
    );
    expect(retired.status).toBe("RETIRED");
    // The unknown program/position render the typed 404s (A7 parity).
    await expect(
      withTenant(TENANT_H, () =>
        trainingSvc.getProgram("11111111-1111-4111-8111-111111111155"),
      ),
    ).rejects.toBeInstanceOf(TrainingProgramNotFoundError);
  });
});

describe("PHASE-047 W-3 — (f) the tenant boundary", () => {
  it("(f1) the empty worlds BY CONSTRUCTION + the A7 parity for foreign ids", async () => {
    const rlsPrograms = await withTenant(TENANT_H_RLS, () => trainingSvc.listPrograms({}));
    expect(rlsPrograms).toHaveLength(0);
    const rlsUnits = await withTenant(TENANT_H_RLS, () => orgSvc.listOrgUnits());
    expect(rlsUnits).toHaveLength(0);
    const rlsPositions = await withTenant(TENANT_H_RLS, () => orgSvc.listPositions({}));
    expect(rlsPositions).toHaveLength(0);
    const rlsDocs = await withTenant(TENANT_H_RLS, () => orgSvc.listDocuments({}));
    expect(rlsDocs).toHaveLength(0);
    // Foreign (tenant H) ids render as unknown on the RLS tenant.
    const program = await freshProgram({ cost: null });
    await expect(
      withTenant(TENANT_H_RLS, () => trainingSvc.getProgram(program.id)),
    ).rejects.toBeInstanceOf(TrainingProgramNotFoundError);
    const unit = await freshOrgUnit(null);
    await expect(
      withTenant(TENANT_H_RLS, () => orgSvc.getOrgUnit(unit.id)),
    ).rejects.toBeInstanceOf(OrgUnitNotFoundError);
    // The cross-tenant org parent refuses typed (never a silent link).
    await expect(
      withTenant(TENANT_H_RLS, () =>
        orgSvc.createOrgUnit({
          code: "OU-RLS-1",
          name: "RLS unit",
          nameAr: null,
          parentId: unit.id,
          actorId: H_ACTOR,
        }),
      ),
    ).rejects.toBeInstanceOf(OrgUnitNotFoundError);
  });
});
