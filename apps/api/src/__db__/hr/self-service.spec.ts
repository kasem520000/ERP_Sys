import { beforeAll, describe, expect, it } from "vitest";
import type { Client } from "pg";

import { withTenant } from "../../infra/db/tenant-context";
import { AuditService } from "../../modules/audit/api/audit";
import { DrizzleAuditStore } from "../../modules/audit/infrastructure/drizzle-audit.store";
import { AttendanceService } from "../../modules/hr/application/attendance-service";
import { BridgeService } from "../../modules/hr/application/bridge-service";
import { LeaveService } from "../../modules/hr/application/leave-service";
import { SelfServiceService } from "../../modules/hr/application/self-service-service";
import { ShiftService } from "../../modules/hr/application/shift-service";
import { insertUser } from "../../modules/identity/api/identity";
import { H_ACTOR, setupHrFixture, superuserClient } from "./fixtures";

/**
 * PHASE-045 (T-14) — the employee self-service plane pinned:
 *
 * - THE SCOPE LAW (the isolation law): the employee scope is resolved
 *   from the ACTING USER through the identity bridge — a linked user
 *   sees ONLY their own attendance days, roster cells, balances, and
 *   requests; a SAME-TENANT colleague's rows (present in the tables,
 *   readable under hr.* by HR) are invisible on this plane by
 *   construction;
 * - THE NOT-LINKED LAW: an unlinked user (the field workforce / a
 *   pure back-office user) renders `employee: null` on the summary and
 *   the typed HR_SELF_NOT_LINKED refusal on every scoped surface; the
 *   same user in ANOTHER tenant is unlinked there too (the bridge is
 *   tenant-scoped — the boundary arm);
 * - THE WRITE LAW: create-own-request lands on the RESOLVED employee
 *   (the leave family's own laws apply unchanged — the span overlap
 *   refusal rides the self path); cancel-own-PENDING is the ONE
 *   decision an employee owns, and A7 parity holds — ANOTHER
 *   employee's request id and an unknown id render the SAME
 *   LEAVE_REQUEST_NOT_FOUND (never an ownership disclosure);
 * - THE ACTIVE-ONLY TYPE CATALOG: the request form's axis carries
 *   ACTIVE types only (an inactive type is not requestable — the
 *   leave family's own law, seen from the self plane);
 * - THE SHAPE LAWS: inverted and over-wide ranges are the typed
 *   refusals (the derivation-cap precedent), never raw driver errors.
 */

const TENANT_H = "7a7a7a7a-7a7a-7a7a-7a7a-7a7a7a7a7a7a";
const TENANT_H_RLS = "7a7a7a7a-7a7a-7a7a-7a7a-7a7a7a7a7c7c";

const audit = new AuditService(new DrizzleAuditStore());
const bridgeSvc = new BridgeService(audit);
const shiftSvc = new ShiftService(audit);
const attendanceSvc = new AttendanceService(audit);
const leaveSvc = new LeaveService(audit);
const selfSvc = new SelfServiceService(bridgeSvc, leaveSvc);

interface SelfFixture {
  employeeS1Id: string;
  employeeS2Id: string;
  userLinked: string;
  userUnlinked: string;
  activeTypeId: string;
  activeTypeCode: string;
  inactiveTypeId: string;
  ownPendingRequestId: string;
  otherEmployeeRequestId: string;
  rosterDate: string;
}

const spec: { fixture?: SelfFixture } = {};
let seq = 0;

function uniqueCode(prefix: string): string {
  seq += 1;
  return `${prefix}-${Date.now() % 100000}-${seq}`;
}

beforeAll(async () => {
  await setupHrFixture();

  // The spec's OWN employees (the H1/H2/A1/A2/B1..B3 worlds belong to
  // the earlier specs; a shared employee would pull their rows into
  // this spec's isolation assertions).
  const su: Client = await superuserClient();
  const employeeRows = await su.query<{ id: string; code: string }>(
    `INSERT INTO employees (id, tenant_id, code, name, name_ar, hire_date, contract_type, basic_salary, created_by) VALUES
       (gen_random_uuid(), $1, 'EMP-S1', 'Sami Al-Self', 'سامي الخدمة الذاتية', '2026-01-01', 'FULL_TIME', 8000, $2),
       (gen_random_uuid(), $1, 'EMP-S2', 'Salma Al-Other', 'سلمى الأخرى', '2026-01-01', 'FULL_TIME', 9000, $2)
     ON CONFLICT (tenant_id, code) DO UPDATE SET name = EXCLUDED.name
     RETURNING id, code`,
    [TENANT_H, H_ACTOR],
  );
  const byCode = new Map(employeeRows.rows.map((row) => [row.code, row.id]));
  const employeeS1Id = byCode.get("EMP-S1")!;
  const employeeS2Id = byCode.get("EMP-S2")!;

  // Two members of tenant H under an EMPTY role (zero grants — the
  // self-service plane's runtime grant lives at the guard; the empty
  // role proves the OWN-ROWS plane needs no hr.* template key).
  const stamp = Date.now() % 100000;
  const linked = await insertUser({
    email: `self-u1-${stamp}@fixture.test`,
    fullName: "Self User One (linked)",
    passwordHash: "x",
    status: "ACTIVE",
  });
  const unlinked = await insertUser({
    email: `self-u2-${stamp}@fixture.test`,
    fullName: "Self User Two (unlinked)",
    passwordHash: "x",
    status: "ACTIVE",
  });
  const emptyRoleId = (
    await su.query<{ id: string }>(
      `INSERT INTO roles (id, tenant_id, key, name) VALUES (gen_random_uuid(), $1, 'self_empty_${stamp}', 'Self-service empty role (T-14)')
       RETURNING id`,
      [TENANT_H],
    )
  ).rows[0]!.id;
  await su.query(
    `INSERT INTO memberships (id, tenant_id, user_id, role_id) VALUES
       (gen_random_uuid(), $1, $2, $3), (gen_random_uuid(), $1, $4, $3)
     ON CONFLICT (user_id, tenant_id) DO NOTHING`,
    [TENANT_H, linked.id, emptyRoleId, unlinked.id],
  );
  await su.end();

  const fixture = await withTenant(TENANT_H, async () => {
    // The link (the bridge's own law-tested path).
    await bridgeSvc.link({ employeeId: employeeS1Id, userId: linked.id, actorId: H_ACTOR });

    // The type catalog: one ACTIVE + one INACTIVE type (the self
    // plane's catalog axis is the active-only read).
    const activeType = await leaveSvc.createType({
      code: uniqueCode("SELF-ANNUAL"),
      name: "Self annual",
      nameAr: "سنوية ذاتية",
      paid: true,
      accrualDaysPerYear: "21.00",
      monthlyGrant: false,
      prorateJoiners: true,
      carryOverCapDays: "0.00",
      note: null,
      noteAr: null,
      actorId: H_ACTOR,
    });
    const inactiveType = await leaveSvc.createType({
      code: uniqueCode("SELF-OLD"),
      name: "Self old type",
      nameAr: "نوع قديم",
      paid: false,
      accrualDaysPerYear: "7.00",
      monthlyGrant: false,
      prorateJoiners: false,
      carryOverCapDays: "0.00",
      note: null,
      noteAr: null,
      actorId: H_ACTOR,
    });
    await leaveSvc.setTypeActive(inactiveType.id, false, H_ACTOR);

    // The roster: a shift + cells for BOTH employees (the isolation
    // arm needs the colleague's cell present in the table).
    const rosterDate = "2026-10-05";
    const shift = await shiftSvc.create({
      code: uniqueCode("SELF-SHIFT"),
      name: "Self day shift",
      nameAr: "وردية نهارية ذاتية",
      startTime: "08:00",
      endTime: "16:00",
      graceMinutes: 15,
      breakMinutes: 30,
      isNight: false,
      note: null,
      noteAr: null,
      actorId: H_ACTOR,
    });
    await shiftSvc.setRosterCell({
      employeeId: employeeS1Id,
      workDate: rosterDate,
      shiftId: shift.id,
      note: null,
      actorId: H_ACTOR,
    });
    await shiftSvc.setRosterCell({
      employeeId: employeeS2Id,
      workDate: rosterDate,
      shiftId: shift.id,
      note: null,
      actorId: H_ACTOR,
    });

    return {
      activeType,
      inactiveType,
      rosterDate,
    };
  });

  // The attendance days: S1 carries a closed session + an open one;
  // S2 carries one closed session (present in the table, invisible
  // on S1's plane). THE NO-EXPANSION LAW (the PHASE-046 pinned-note
  // round): each capture runs in its OWN UoW — the production shape
  // (one request, one transaction); a second employee's day keys
  // inside one transaction would expand the reserved set backwards
  // (uuid order), which the floor's reservation ledger refuses.
  await withTenant(TENANT_H, async () => {
    await attendanceSvc.capture({
      employeeId: employeeS1Id,
      workDate: fixture.rosterDate,
      checkIn: "2026-10-05T05:00:00Z",
      checkOut: "2026-10-05T13:00:00Z",
      source: "MANUAL",
      deviceRef: null,
      geoLat: null,
      geoLng: null,
      note: null,
      actorId: H_ACTOR,
    });
  });
  await withTenant(TENANT_H, async () => {
    await attendanceSvc.capture({
      employeeId: employeeS1Id,
      workDate: "2026-10-06",
      checkIn: "2026-10-06T05:10:00Z",
      checkOut: null,
      source: "MANUAL",
      deviceRef: null,
      geoLat: null,
      geoLng: null,
      note: null,
      actorId: H_ACTOR,
    });
  });
  await withTenant(TENANT_H, async () => {
    await attendanceSvc.capture({
      employeeId: employeeS2Id,
      workDate: fixture.rosterDate,
      checkIn: "2026-10-05T06:00:00Z",
      checkOut: "2026-10-05T14:00:00Z",
      source: "MANUAL",
      deviceRef: null,
      geoLat: null,
      geoLng: null,
      note: null,
      actorId: H_ACTOR,
    });
  });

  // The leave world — each writer in its OWN UoW (the no-expansion
  // law above): the accrual run gives the year's entitlements (ALL
  // active employees — the colleague's cell exists too); S2 carries
  // an APPROVED request (used days on its cell); S1 carries a PENDING
  // one (the cancel arm's target) — everything visible under
  // hr.leave, only the own rows on the self plane.
  await withTenant(TENANT_H, async () => {
    await leaveSvc.runAccrual({
      leaveTypeId: fixture.activeType.id,
      year: 2026,
      actorId: H_ACTOR,
    });
  });
  const otherRequest = await withTenant(TENANT_H, async () =>
    leaveSvc.createRequest({
      employeeId: employeeS2Id,
      leaveTypeId: fixture.activeType.id,
      startDate: "2026-11-02",
      endDate: "2026-11-04",
      note: null,
      actorId: H_ACTOR,
    }),
  );
  await withTenant(TENANT_H, async () => {
    await leaveSvc.approve(otherRequest.id, null, H_ACTOR);
  });
  const ownRequest = await withTenant(TENANT_H, async () =>
    leaveSvc.createRequest({
      employeeId: employeeS1Id,
      leaveTypeId: fixture.activeType.id,
      startDate: "2026-11-09",
      endDate: "2026-11-10",
      note: "own pending request",
      actorId: H_ACTOR,
    }),
  );

  spec.fixture = {
    employeeS1Id,
    employeeS2Id,
    userLinked: linked.id,
    userUnlinked: unlinked.id,
    activeTypeId: fixture.activeType.id,
    activeTypeCode: fixture.activeType.code,
    inactiveTypeId: fixture.inactiveType.id,
    ownPendingRequestId: ownRequest.id,
    otherEmployeeRequestId: otherRequest.id,
    rosterDate: fixture.rosterDate,
  };
});

describe("PHASE-045 T-14 — the employee self-service plane: the scope law, the not-linked law, the write law", () => {
  it("(a) THE SUMMARY — the linked user's own card; the unlinked user's honest null", async () => {
    const f = spec.fixture!;

    const linkedSummary = await withTenant(TENANT_H, () => selfSvc.summary(f.userLinked));
    expect(linkedSummary.employee).not.toBeNull();
    expect(linkedSummary.employee!.id).toBe(f.employeeS1Id);
    expect(linkedSummary.employee!.code).toBe("EMP-S1");
    expect(linkedSummary.employee!.status).toBe("ACTIVE");

    const unlinkedSummary = await withTenant(TENANT_H, () => selfSvc.summary(f.userUnlinked));
    expect(unlinkedSummary.employee).toBeNull();
  });

  it("(b) THE SCOPE LAW — the attendance calendar carries ONLY the own days (the colleague's rows are invisible by construction)", async () => {
    const f = spec.fixture!;

    const calendar = await withTenant(TENANT_H, () =>
      selfSvc.attendance(f.userLinked, { from: "2026-10-01", to: "2026-10-31" }),
    );
    expect(calendar.employee.id).toBe(f.employeeS1Id);
    expect(calendar.rows.length).toBe(2); // the closed session + the open one
    expect(calendar.rows.every((row) => row.employeeId === f.employeeS1Id)).toBe(true);
    expect(calendar.rows.some((row) => row.workDate === f.rosterDate && row.checkOut !== null)).toBe(true);
    expect(calendar.rows.some((row) => row.workDate === "2026-10-06" && row.checkOut === null)).toBe(true);
    // EMP-S2's 2026-10-05 session exists in the table but never here.
    expect(calendar.rows.some((row) => row.employeeId === f.employeeS2Id)).toBe(false);
  });

  it("(c) THE SCOPE LAW — the roster read carries ONLY the own cells, paginated with total + hasMore", async () => {
    const f = spec.fixture!;

    const grid = await withTenant(TENANT_H, () =>
      selfSvc.roster(f.userLinked, { from: "2026-10-01", to: "2026-10-31" }),
    );
    expect(grid.employee.id).toBe(f.employeeS1Id);
    expect(grid.rows.length).toBe(1);
    expect(grid.rows[0]!.employeeId).toBe(f.employeeS1Id);
    expect(grid.rows[0]!.workDate).toBe(f.rosterDate);
    expect(grid.total).toBe(1);
    expect(grid.hasMore).toBe(false);
  });

  it("(d) THE TYPE CATALOG — the request form's axis is the ACTIVE-only read", async () => {
    const f = spec.fixture!;

    const types = await withTenant(TENANT_H, () => selfSvc.leaveTypes(f.userLinked));
    expect(types.length).toBeGreaterThan(0);
    expect(types.every((type) => type.active)).toBe(true);
    expect(types.some((type) => type.id === f.activeTypeId)).toBe(true);
    expect(types.some((type) => type.id === f.inactiveTypeId)).toBe(false);
  });

  it("(e) THE SCOPE LAW — the balances read carries ONLY the own cells (the colleague's cells exist under hr.leave, never here)", async () => {
    const f = spec.fixture!;

    // The colleague's approved request created S2's balance cell via
    // the approve path; the own plane must still answer ONLY S1.
    const balances = await withTenant(TENANT_H, () =>
      selfSvc.leaveBalances(f.userLinked, 2026),
    );
    expect(balances.every((row) => row.employeeId === f.employeeS1Id)).toBe(true);
    expect(balances.some((row) => row.employeeId === f.employeeS2Id)).toBe(false);
  });

  it("(f) THE SCOPE LAW — the requests register carries ONLY the own requests", async () => {
    const f = spec.fixture!;

    const page = await withTenant(TENANT_H, () =>
      selfSvc.leaveRequests(f.userLinked, { from: "2026-11-01", to: "2026-11-30" }),
    );
    expect(page.employee.id).toBe(f.employeeS1Id);
    expect(page.rows.length).toBe(1);
    expect(page.rows[0]!.id).toBe(f.ownPendingRequestId);
    expect(page.rows[0]!.employeeId).toBe(f.employeeS1Id);
    expect(page.total).toBe(1);
  });

  it("(g) THE WRITE LAW — create-own lands on the RESOLVED employee; the span-overlap law rides the self path", async () => {
    const f = spec.fixture!;

    const created = await withTenant(TENANT_H, () =>
      selfSvc.createLeaveRequest(f.userLinked, {
        leaveTypeId: f.activeTypeId,
        startDate: "2026-12-01",
        endDate: "2026-12-03",
        note: "from the self plane",
      }),
    );
    expect(created.employeeId).toBe(f.employeeS1Id); // resolved, never supplied
    expect(created.status).toBe("PENDING");
    expect(created.days).toBe("3.00");

    // The overlap law (never two leaves at once) — the own pending span
    // above blocks an overlapping create through the self path.
    await expect(
      withTenant(TENANT_H, () =>
        selfSvc.createLeaveRequest(f.userLinked, {
          leaveTypeId: f.activeTypeId,
          startDate: "2026-12-03",
          endDate: "2026-12-05",
          note: null,
        }),
      ),
    ).rejects.toMatchObject({ code: "LEAVE_SPAN_OVERLAP" });
  });

  it("(h) THE CANCEL LAW + A7 PARITY — own PENDING cancels; another employee's id and an unknown id are INDISTINGUISHABLE", async () => {
    const f = spec.fixture!;

    // The OTHER employee's request (visible under hr.leave) reads as
    // not-found on the self plane — never an ownership disclosure.
    await expect(
      withTenant(TENANT_H, () =>
        selfSvc.cancelLeaveRequest(f.userLinked, f.otherEmployeeRequestId, null),
      ),
    ).rejects.toMatchObject({ code: "LEAVE_REQUEST_NOT_FOUND" });

    // An unknown id renders the SAME shape (A7).
    await expect(
      withTenant(TENANT_H, () =>
        selfSvc.cancelLeaveRequest(
          f.userLinked,
          "00000000-0000-4000-8000-0000000005e7",
          null,
        ),
      ),
    ).rejects.toMatchObject({ code: "LEAVE_REQUEST_NOT_FOUND" });

    // The own PENDING request cancels (the one decision an employee owns).
    const cancelled = await withTenant(TENANT_H, () =>
      selfSvc.cancelLeaveRequest(f.userLinked, f.ownPendingRequestId, "plans changed"),
    );
    expect(cancelled.status).toBe("CANCELLED");
    expect(cancelled.decisionNote).toBe("plans changed");

    // A second cancel on the now-decided request is the family's own
    // decided refusal (the 0083 CHECK, seen from the self plane).
    await expect(
      withTenant(TENANT_H, () =>
        selfSvc.cancelLeaveRequest(f.userLinked, f.ownPendingRequestId, null),
      ),
    ).rejects.toMatchObject({ code: "LEAVE_REQUEST_DECIDED" });
  });

  it("(i) THE NOT-LINKED LAW — the unlinked user's scoped surfaces are the typed refusal; the summary stays the honest null", async () => {
    const f = spec.fixture!;

    await expect(
      withTenant(TENANT_H, () =>
        selfSvc.attendance(f.userUnlinked, { from: "2026-10-01", to: "2026-10-31" }),
      ),
    ).rejects.toMatchObject({ code: "HR_SELF_NOT_LINKED" });
    await expect(
      withTenant(TENANT_H, () =>
        selfSvc.roster(f.userUnlinked, { from: "2026-10-01", to: "2026-10-31" }),
      ),
    ).rejects.toMatchObject({ code: "HR_SELF_NOT_LINKED" });
    await expect(
      withTenant(TENANT_H, () => selfSvc.leaveTypes(f.userUnlinked)),
    ).rejects.toMatchObject({ code: "HR_SELF_NOT_LINKED" });
    await expect(
      withTenant(TENANT_H, () => selfSvc.leaveBalances(f.userUnlinked, 2026)),
    ).rejects.toMatchObject({ code: "HR_SELF_NOT_LINKED" });
    await expect(
      withTenant(TENANT_H, () =>
        selfSvc.leaveRequests(f.userUnlinked, { from: "2026-11-01", to: "2026-11-30" }),
      ),
    ).rejects.toMatchObject({ code: "HR_SELF_NOT_LINKED" });
    await expect(
      withTenant(TENANT_H, () =>
        selfSvc.createLeaveRequest(f.userUnlinked, {
          leaveTypeId: f.activeTypeId,
          startDate: "2026-12-01",
          endDate: "2026-12-02",
          note: null,
        }),
      ),
    ).rejects.toMatchObject({ code: "HR_SELF_NOT_LINKED" });
  });

  it("(j) THE TENANT BOUNDARY — the same user is nobody's employee in ANOTHER tenant (the link is tenant-scoped)", async () => {
    const f = spec.fixture!;

    const there = await withTenant(TENANT_H_RLS, () => selfSvc.summary(f.userLinked));
    expect(there.employee).toBeNull();
    await expect(
      withTenant(TENANT_H_RLS, () =>
        selfSvc.attendance(f.userLinked, { from: "2026-10-01", to: "2026-10-31" }),
      ),
    ).rejects.toMatchObject({ code: "HR_SELF_NOT_LINKED" });
  });

  it("(k) THE SHAPE LAWS — inverted and over-wide ranges are the typed refusals (the derivation-cap precedent)", async () => {
    const f = spec.fixture!;

    await expect(
      withTenant(TENANT_H, () =>
        selfSvc.attendance(f.userLinked, { from: "2026-10-31", to: "2026-10-01" }),
      ),
    ).rejects.toMatchObject({ code: "ATTENDANCE_RECORD_INVALID" });
    await expect(
      withTenant(TENANT_H, () =>
        selfSvc.attendance(f.userLinked, { from: "2026-01-01", to: "2026-12-31" }),
      ),
    ).rejects.toMatchObject({ code: "ATTENDANCE_RECORD_INVALID" });
    await expect(
      withTenant(TENANT_H, () =>
        selfSvc.roster(f.userLinked, { from: "2026-10-31", to: "2026-10-01" }),
      ),
    ).rejects.toMatchObject({ code: "ATTENDANCE_RECORD_INVALID" });
    await expect(
      withTenant(TENANT_H, () =>
        selfSvc.leaveRequests(f.userLinked, { from: "2026-11-30", to: "2026-11-01" }),
      ),
    ).rejects.toMatchObject({ code: "LEAVE_REQUEST_INVALID" });
  });
});
