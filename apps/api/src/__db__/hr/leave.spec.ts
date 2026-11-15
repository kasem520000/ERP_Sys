import { beforeAll, describe, expect, it } from "vitest";
import type { Client } from "pg";

import { withTenant } from "../../infra/db/tenant-context";
import { AuditService } from "../../modules/audit/api/audit";
import { DrizzleAuditStore } from "../../modules/audit/infrastructure/drizzle-audit.store";
import { LeaveService } from "../../modules/hr/application/leave-service";
import { H_ACTOR, setupHrFixture } from "./fixtures";
import { superuserClient } from "../test-db";

/**
 * PHASE-045 (T-07) — the leave engine pinned:
 *
 * - THE TYPE CATALOG: the code unique, the accrual/cap bounds typed,
 *   and THE BR-055 LAW — a type accrues 0.00 until configured (the
 *   accrual run refuses a 0-accrual type);
 * - INV-031 AT THE APPROVE BOUNDARY: used never exceeds entitlement +
 *   carried at any moment (the typed refusal BEFORE the decrement,
 *   never a negative remaining); the charge lands on the START year's
 *   cell (the documented convention);
 * - THE SPAN LAW: an employee is never on two leaves at once (a
 *   PENDING-or-APPROVED span never overlaps);
 * - THE LIFECYCLE: PENDING → APPROVED (the balance decrement in the
 *   same ambient transaction) / REJECTED / CANCELLED (the 0083 decided
 *   stamps); a decided request never re-decides;
 * - THE ACCRUAL RUN: the entitlement RECOMPUTE (idempotent — never an
 *   increment), the annual grant, the monthly vesting through asOfMonth,
 *   the joiner proration on/off, and the INV-031 preservation (a
 *   recompute that would lower an entitlement below the used days is
 *   the typed all-or-nothing refusal);
 * - THE CARRY-OVER ROLLOVER: carried = min(remaining, cap) — the excess
 *   TRUNCATES with the audit line; a 0-cap carries nothing; idempotent;
 * - the tenant boundary.
 */

const TENANT_H = "7a7a7a7a-7a7a-7a7a-7a7a-7a7a7a7a7a7a";
const TENANT_H_RLS = "7a7a7a7a-7a7a-7a7a-7a7a-7a7a7a7a7c7c";

const audit = new AuditService(new DrizzleAuditStore());
const leaveSvc = new LeaveService(audit);

interface LeaveFixture {
  employeeL1Id: string;
  annualTypeId: string;
}

const spec: { fixture?: LeaveFixture } = {};
let seq = 0;

function uniqueCode(prefix: string): string {
  seq += 1;
  return `${prefix}-${Date.now() % 100000}-${seq}`;
}

beforeAll(async () => {
  await setupHrFixture();
  // The spec's own employee — a MID-YEAR JOINER (hired 2026-04-10 → 9
  // employment months in 2026: Apr..Dec) for the proration arms.
  const su: Client = await superuserClient();
  const employeeRows = await su.query<{ id: string; code: string }>(
    `INSERT INTO employees (id, tenant_id, code, name, name_ar, hire_date, contract_type, basic_salary, created_by) VALUES
       (gen_random_uuid(), $1, 'EMP-L1', 'Lina Al-Leave', 'لينا الإجازة', '2026-04-10', 'FULL_TIME', 8000, $2)
     ON CONFLICT (tenant_id, code) DO UPDATE SET name = EXCLUDED.name
     RETURNING id, code`,
    [TENANT_H, H_ACTOR],
  );
  await su.end();

  const annualType = await withTenant(TENANT_H, () =>
    leaveSvc.createType({
      code: uniqueCode("LV-ANNUAL"),
      name: "Annual leave (T-07)",
      nameAr: "إجازة سنوية (ت-٠٧)",
      paid: true,
      accrualDaysPerYear: "30.00",
      monthlyGrant: false,
      prorateJoiners: true,
      carryOverCapDays: "10.00",
      note: null,
      noteAr: null,
      actorId: H_ACTOR,
    }),
  );
  spec.fixture = {
    employeeL1Id: employeeRows.rows[0]!.id,
    annualTypeId: annualType.id,
  };
});

describe("PHASE-045 T-07 — the leave engine: the catalog, INV-031, the lifecycle, the accrual, the rollover", () => {
  it("(a) THE TYPE CATALOG — the code unique, the bounds typed, THE BR-055 LAW (an unconfigured accrual refuses the run)", async () => {
    const code = uniqueCode("LV-DUP");
    await withTenant(TENANT_H, () =>
      leaveSvc.createType({
        code,
        name: "first",
        nameAr: null,
        paid: true,
        accrualDaysPerYear: "0.00",
        monthlyGrant: false,
        prorateJoiners: false,
        carryOverCapDays: "0.00",
        note: null,
        noteAr: null,
        actorId: H_ACTOR,
      }),
    );
    await expect(
      withTenant(TENANT_H, () =>
        leaveSvc.createType({
          code,
          name: "duplicate",
          nameAr: null,
          paid: true,
          accrualDaysPerYear: "0.00",
          monthlyGrant: false,
          prorateJoiners: false,
          carryOverCapDays: "0.00",
          note: null,
          noteAr: null,
          actorId: H_ACTOR,
        }),
      ),
    ).rejects.toMatchObject({ code: "LEAVE_TYPE_INVALID" });

    // The accrual bound (≤ 366) typed.
    await expect(
      withTenant(TENANT_H, () =>
        leaveSvc.createType({
          code: uniqueCode("LV-BAD"),
          name: "too much",
          nameAr: null,
          paid: true,
          accrualDaysPerYear: "400.00",
          monthlyGrant: false,
          prorateJoiners: false,
          carryOverCapDays: "0.00",
          note: null,
          noteAr: null,
          actorId: H_ACTOR,
        }),
      ),
    ).rejects.toMatchObject({ code: "LEAVE_TYPE_INVALID" });

    // THE BR-055 LAW: the 0-accrual type refuses the accrual run.
    const zeroType = await withTenant(TENANT_H, () =>
      leaveSvc.listTypes({ active: true, limit: 500 }),
    );
    const zero = zeroType.find((row) => row.accrualDaysPerYear === "0.00" && row.code.startsWith("LV-DUP"))!;
    await expect(
      withTenant(TENANT_H, () =>
        leaveSvc.runAccrual({ leaveTypeId: zero.id, year: 2026, actorId: H_ACTOR }),
      ),
    ).rejects.toMatchObject({ code: "LEAVE_ACCRUAL_INVALID" });

    // Deactivation blocks requests.
    const off = await withTenant(TENANT_H, () => leaveSvc.setTypeActive(zero.id, false, H_ACTOR));
    expect(off.active).toBe(false);
    await expect(
      withTenant(TENANT_H, () =>
        leaveSvc.createRequest({
          employeeId: spec.fixture!.employeeL1Id,
          leaveTypeId: zero.id,
          startDate: "2026-07-01",
          endDate: "2026-07-05",
          note: null,
          actorId: H_ACTOR,
        }),
      ),
    ).rejects.toMatchObject({ code: "LEAVE_TYPE_INACTIVE" });
  });

  it("(b) THE ACCRUAL RUN — the annual grant with joiner proration (the mid-year hire), the monthly vesting, idempotence, and the INV-031 preservation", async () => {
    const f = spec.fixture!;
    // The joiner (hired 2026-04-10, 9 employment months Apr..Dec) with a
    // 30-day annual rate, prorated: 30 × 9 / 12 = 22.50.
    const annual = await withTenant(TENANT_H, () =>
      leaveSvc.runAccrual({ leaveTypeId: f.annualTypeId, year: 2026, actorId: H_ACTOR }),
    );
    expect(annual.employees).toBeGreaterThanOrEqual(1);
    const balances = await withTenant(TENANT_H, () =>
      leaveSvc.balances({ employeeId: f.employeeL1Id, year: 2026 }),
    );
    const cell = balances.find((row) => row.leaveTypeId === f.annualTypeId)!;
    expect(cell.entitlementDays).toBe("22.50");
    expect(cell.usedDays).toBe("0.00");
    expect(cell.remainingDays).toBe("22.50");

    // Idempotent: the recompute writes the same entitlement.
    await withTenant(TENANT_H, () =>
      leaveSvc.runAccrual({ leaveTypeId: f.annualTypeId, year: 2026, actorId: H_ACTOR }),
    );
    const after = await withTenant(TENANT_H, () =>
      leaveSvc.balances({ employeeId: f.employeeL1Id, year: 2026 }),
    );
    expect(after.find((row) => row.leaveTypeId === f.annualTypeId)!.entitlementDays).toBe("22.50");

    // The monthly vesting: a monthly type with asOfMonth=6 → 30 × 6/12
    // = 15.00 (capped by the joiner's 9 months — 6 < 9 so 15.00).
    const monthlyType = await withTenant(TENANT_H, () =>
      leaveSvc.createType({
        code: uniqueCode("LV-MONTHLY"),
        name: "Monthly-vesting leave",
        nameAr: null,
        paid: true,
        accrualDaysPerYear: "30.00",
        monthlyGrant: true,
        prorateJoiners: true,
        carryOverCapDays: "0.00",
        note: null,
        noteAr: null,
        actorId: H_ACTOR,
      }),
    );
    await withTenant(TENANT_H, () =>
      leaveSvc.runAccrual({ leaveTypeId: monthlyType.id, year: 2026, asOfMonth: 6, actorId: H_ACTOR }),
    );
    const monthlyBalances = await withTenant(TENANT_H, () =>
      leaveSvc.balances({ employeeId: f.employeeL1Id, year: 2026 }),
    );
    const monthlyCell = monthlyBalances.find((row) => row.leaveTypeId === monthlyType.id)!;
    expect(monthlyCell.entitlementDays).toBe("15.00");

    // No joiner proration: the joiner still gets the full annual (30).
    const fullType = await withTenant(TENANT_H, () =>
      leaveSvc.createType({
        code: uniqueCode("LV-FULL"),
        name: "Full-annual leave",
        nameAr: null,
        paid: true,
        accrualDaysPerYear: "30.00",
        monthlyGrant: false,
        prorateJoiners: false,
        carryOverCapDays: "0.00",
        note: null,
        noteAr: null,
        actorId: H_ACTOR,
      }),
    );
    await withTenant(TENANT_H, () =>
      leaveSvc.runAccrual({ leaveTypeId: fullType.id, year: 2026, actorId: H_ACTOR }),
    );
    const fullBalances = await withTenant(TENANT_H, () =>
      leaveSvc.balances({ employeeId: f.employeeL1Id, year: 2026 }),
    );
    expect(fullBalances.find((row) => row.leaveTypeId === fullType.id)!.entitlementDays).toBe("30.00");

    // THE INV-031 PRESERVATION: after using 10 days, a recompute that
    // would LOWER the entitlement below the used days is the typed
    // all-or-nothing refusal (the annual type: use 10, then lower the
    // accrual so the prorated entitlement < 10).
    const used = await withTenant(TENANT_H, () =>
      leaveSvc.createRequest({
        employeeId: f.employeeL1Id,
        leaveTypeId: f.annualTypeId,
        startDate: "2026-07-01",
        endDate: "2026-07-10",
        note: null,
        actorId: H_ACTOR,
      }),
    );
    expect(used.days).toBe("10.00");
    await withTenant(TENANT_H, () => leaveSvc.approve(used.id, null, H_ACTOR));
    const usedBalances = await withTenant(TENANT_H, () =>
      leaveSvc.balances({ employeeId: f.employeeL1Id, year: 2026 }),
    );
    const usedCell = usedBalances.find((row) => row.leaveTypeId === f.annualTypeId)!;
    expect(usedCell.usedDays).toBe("10.00");
    expect(usedCell.remainingDays).toBe("12.50");

    // Lower the accrual to 12.00 → prorated 9.00 < used 10.00 → the
    // typed refusal, nothing changes.
    await withTenant(TENANT_H, () =>
      leaveSvc.updateType(f.annualTypeId, { accrualDaysPerYear: "12.00" }, H_ACTOR),
    );
    await expect(
      withTenant(TENANT_H, () =>
        leaveSvc.runAccrual({ leaveTypeId: f.annualTypeId, year: 2026, actorId: H_ACTOR }),
      ),
    ).rejects.toMatchObject({ code: "LEAVE_ACCRUAL_INVALID" });
    const preserved = await withTenant(TENANT_H, () =>
      leaveSvc.balances({ employeeId: f.employeeL1Id, year: 2026 }),
    );
    expect(preserved.find((row) => row.leaveTypeId === f.annualTypeId)!.entitlementDays).toBe("22.50");
    // Restore the 30-day rate for the later arms.
    await withTenant(TENANT_H, () =>
      leaveSvc.updateType(f.annualTypeId, { accrualDaysPerYear: "30.00" }, H_ACTOR),
    );
  });

  it("(c) THE LIFECYCLE + INV-031 — the span law, the insufficient refusal, reject/cancel without a balance change, the re-decide refusal", async () => {
    const f = spec.fixture!;

    // THE SPAN LAW: the approved 07-01..07-10 overlaps a new 07-08 span.
    await expect(
      withTenant(TENANT_H, () =>
        leaveSvc.createRequest({
          employeeId: f.employeeL1Id,
          leaveTypeId: f.annualTypeId,
          startDate: "2026-07-08",
          endDate: "2026-07-12",
          note: null,
          actorId: H_ACTOR,
        }),
      ),
    ).rejects.toMatchObject({ code: "LEAVE_SPAN_OVERLAP" });

    // A non-overlapping second request: 5 more days (used would be 15
    // ≤ 22.50 → approves).
    const second = await withTenant(TENANT_H, () =>
      leaveSvc.createRequest({
        employeeId: f.employeeL1Id,
        leaveTypeId: f.annualTypeId,
        startDate: "2026-08-03",
        endDate: "2026-08-07",
        note: null,
        actorId: H_ACTOR,
      }),
    );
    expect(second.days).toBe("5.00");
    const approvedSecond = await withTenant(TENANT_H, () => leaveSvc.approve(second.id, "ok", H_ACTOR));
    expect(approvedSecond.status).toBe("APPROVED");
    expect(approvedSecond.decidedBy).toBe(H_ACTOR);

    // INV-031: used 15 + requested 8 = 23 > 22.50 → the typed refusal
    // BEFORE the decrement (the balance stays 15 used).
    const over = await withTenant(TENANT_H, () =>
      leaveSvc.createRequest({
        employeeId: f.employeeL1Id,
        leaveTypeId: f.annualTypeId,
        startDate: "2026-09-01",
        endDate: "2026-09-08",
        note: null,
        actorId: H_ACTOR,
      }),
    );
    await expect(
      withTenant(TENANT_H, () => leaveSvc.approve(over.id, null, H_ACTOR)),
    ).rejects.toMatchObject({ code: "LEAVE_BALANCE_INSUFFICIENT" });
    const midBalances = await withTenant(TENANT_H, () =>
      leaveSvc.balances({ employeeId: f.employeeL1Id, year: 2026 }),
    );
    expect(midBalances.find((row) => row.leaveTypeId === f.annualTypeId)!.usedDays).toBe("15.00");

    // REJECT the over-request: no balance change; the decided stamps.
    const rejected = await withTenant(TENANT_H, () =>
      leaveSvc.decideAgainst(over.id, "REJECTED", "insufficient balance", H_ACTOR),
    );
    expect(rejected.status).toBe("REJECTED");
    expect(rejected.decisionNote).toBe("insufficient balance");

    // CANCEL: a fresh pending request cancels with the stamps.
    const toCancel = await withTenant(TENANT_H, () =>
      leaveSvc.createRequest({
        employeeId: f.employeeL1Id,
        leaveTypeId: f.annualTypeId,
        startDate: "2026-10-01",
        endDate: "2026-10-02",
        note: null,
        actorId: H_ACTOR,
      }),
    );
    const cancelled = await withTenant(TENANT_H, () =>
      leaveSvc.decideAgainst(toCancel.id, "CANCELLED", "planner changed", H_ACTOR),
    );
    expect(cancelled.status).toBe("CANCELLED");
    const finalBalances = await withTenant(TENANT_H, () =>
      leaveSvc.balances({ employeeId: f.employeeL1Id, year: 2026 }),
    );
    expect(finalBalances.find((row) => row.leaveTypeId === f.annualTypeId)!.usedDays).toBe("15.00");

    // A decided request never re-decides (typed).
    await expect(
      withTenant(TENANT_H, () => leaveSvc.approve(second.id, null, H_ACTOR)),
    ).rejects.toMatchObject({ code: "LEAVE_REQUEST_DECIDED" });
    // The inverted span + the bad status filter, typed.
    await expect(
      withTenant(TENANT_H, () =>
        leaveSvc.createRequest({
          employeeId: f.employeeL1Id,
          leaveTypeId: f.annualTypeId,
          startDate: "2026-09-10",
          endDate: "2026-09-01",
          note: null,
          actorId: H_ACTOR,
        }),
      ),
    ).rejects.toMatchObject({ code: "LEAVE_REQUEST_INVALID" });
  });

  it("(d) THE CARRY-OVER ROLLOVER — min(remaining, cap) with the truncation audited; a 0-cap carries nothing; idempotent", async () => {
    const f = spec.fixture!;
    // Remaining 22.50 − 15.00 = 7.50 ≤ cap 10.00 → carries fully.
    const rollover = await withTenant(TENANT_H, () =>
      leaveSvc.rollover({ leaveTypeId: f.annualTypeId, fromYear: 2026, toYear: 2027, actorId: H_ACTOR }),
    );
    expect(rollover.cellsWritten).toBeGreaterThanOrEqual(1);
    // The accrual run is TENANT-WIDE (every ACTIVE employee's cell) — the
    // truncation count reflects the whole roster (the 12-month hires'
    // 30-day entitlements truncate at the 10-day cap), never just the
    // spec's employee; L1's own carry is the assertion below.
    const balances2027 = await withTenant(TENANT_H, () =>
      leaveSvc.balances({ employeeId: f.employeeL1Id, year: 2027 }),
    );
    const cell2027 = balances2027.find((row) => row.leaveTypeId === f.annualTypeId)!;
    expect(cell2027.carriedForwardDays).toBe("7.50");
    expect(cell2027.remainingDays).toBe("7.50");

    // Idempotent: the SET, never an increment.
    await withTenant(TENANT_H, () =>
      leaveSvc.rollover({ leaveTypeId: f.annualTypeId, fromYear: 2026, toYear: 2027, actorId: H_ACTOR }),
    );
    const again = await withTenant(TENANT_H, () =>
      leaveSvc.balances({ employeeId: f.employeeL1Id, year: 2027 }),
    );
    expect(again.find((row) => row.leaveTypeId === f.annualTypeId)!.carriedForwardDays).toBe("7.50");

    // THE TRUNCATION: a type with cap 5.00 and remaining 7.50 → carries
    // 5.00, truncates 2.50 (the audit line records it).
    const cappedType = await withTenant(TENANT_H, () =>
      leaveSvc.createType({
        code: uniqueCode("LV-CAPPED"),
        name: "Capped leave",
        nameAr: null,
        paid: true,
        accrualDaysPerYear: "20.00",
        monthlyGrant: false,
        prorateJoiners: true,
        carryOverCapDays: "5.00",
        note: null,
        noteAr: null,
        actorId: H_ACTOR,
      }),
    );
    await withTenant(TENANT_H, () =>
      leaveSvc.runAccrual({ leaveTypeId: cappedType.id, year: 2026, actorId: H_ACTOR }),
    );
    const capRequest = await withTenant(TENANT_H, () =>
      leaveSvc.createRequest({
        employeeId: f.employeeL1Id,
        leaveTypeId: cappedType.id,
        startDate: "2026-11-02",
        endDate: "2026-11-06",
        note: null,
        actorId: H_ACTOR,
      }),
    );
    await withTenant(TENANT_H, () => leaveSvc.approve(capRequest.id, null, H_ACTOR));
    // Entitlement 20 × 9/12 = 15.00, used 5 → remaining 10 > cap 5.
    const cappedRollover = await withTenant(TENANT_H, () =>
      leaveSvc.rollover({ leaveTypeId: cappedType.id, fromYear: 2026, toYear: 2027, actorId: H_ACTOR }),
    );
    expect(cappedRollover.truncatedCount).toBeGreaterThanOrEqual(1);
    expect(cappedRollover.truncatedDays).not.toBe("0.00");
    const capped2027 = await withTenant(TENANT_H, () =>
      leaveSvc.balances({ employeeId: f.employeeL1Id, year: 2027 }),
    );
    expect(capped2027.find((row) => row.leaveTypeId === cappedType.id)!.carriedForwardDays).toBe("5.00");

    // A 0-cap carries nothing.
    const allTypes = await withTenant(TENANT_H, () => leaveSvc.listTypes({ active: true, limit: 500 }));
    const zeroCapType = allTypes.find((row) => row.carryOverCapDays === "0.00" && row.monthlyGrant === true)!;
    const zeroCapRollover = await withTenant(TENANT_H, () =>
      leaveSvc.rollover({ leaveTypeId: zeroCapType.id, fromYear: 2026, toYear: 2027, actorId: H_ACTOR }),
    );
    expect(zeroCapRollover.cellsWritten).toBe(0);

    // The one-year-forward law, typed.
    await expect(
      withTenant(TENANT_H, () =>
        leaveSvc.rollover({ leaveTypeId: f.annualTypeId, fromYear: 2026, toYear: 2028, actorId: H_ACTOR }),
      ),
    ).rejects.toMatchObject({ code: "LEAVE_ACCRUAL_INVALID" });
  });

  it("(e) THE READS + THE BOUNDARY — the request list paginated; the boundary tenant's empty world; the A7 refusals", async () => {
    const f = spec.fixture!;
    const requests = await withTenant(TENANT_H, () =>
      leaveSvc.listRequests({
        from: "2026-01-01",
        to: "2026-12-31",
        employeeIds: [f.employeeL1Id],
      }),
    );
    // 07-01..10 approved, 08-03..07 approved, 09-01..08 rejected,
    // 10-01..02 cancelled, 11-02..06 approved (the capped type).
    expect(requests.total).toBe(5);
    const statuses = requests.rows.map((row) => row.status).sort();
    expect(statuses).toEqual(["APPROVED", "APPROVED", "APPROVED", "CANCELLED", "REJECTED"]);

    const page1 = await withTenant(TENANT_H, () =>
      leaveSvc.listRequests({ from: "2026-01-01", to: "2026-12-31", employeeIds: [f.employeeL1Id], page: 1, pageSize: 3 }),
    );
    expect(page1.rows).toHaveLength(3);
    expect(page1.hasMore).toBe(true);
    const page2 = await withTenant(TENANT_H, () =>
      leaveSvc.listRequests({ from: "2026-01-01", to: "2026-12-31", employeeIds: [f.employeeL1Id], page: 2, pageSize: 3 }),
    );
    expect(page2.rows).toHaveLength(2);
    expect(page2.hasMore).toBe(false);

    // The boundary tenant: empty world, the A7 foreign refusals.
    const foreignBalances = await withTenant(TENANT_H_RLS, () => leaveSvc.balances({}));
    expect(foreignBalances).toHaveLength(0);
    const foreignRequests = await withTenant(TENANT_H_RLS, () =>
      leaveSvc.listRequests({ from: "2026-01-01", to: "2026-12-31" }),
    );
    expect(foreignRequests.total).toBe(0);
    await expect(
      withTenant(TENANT_H_RLS, () =>
        leaveSvc.createRequest({
          employeeId: f.employeeL1Id,
          leaveTypeId: f.annualTypeId,
          startDate: "2026-12-01",
          endDate: "2026-12-02",
          note: null,
          actorId: H_ACTOR,
        }),
      ),
    ).rejects.toMatchObject({ code: "HR_EMPLOYEE_NOT_FOUND" });
    await expect(
      withTenant(TENANT_H_RLS, () => leaveSvc.approve("00000000-0000-4000-8000-0000000000bb", null, H_ACTOR)),
    ).rejects.toMatchObject({ code: "LEAVE_REQUEST_NOT_FOUND" });
  });
});
