import { beforeAll, describe, expect, it } from "vitest";
import type { Client } from "pg";

import { withTenant } from "../../infra/db/tenant-context";
import { AuditService } from "../../modules/audit/api/audit";
import { DrizzleAuditStore } from "../../modules/audit/infrastructure/drizzle-audit.store";
import { AttendanceService } from "../../modules/hr/application/attendance-service";
import { FeedService } from "../../modules/hr/application/feed-service";
import { LeaveService } from "../../modules/hr/application/leave-service";
import { OvertimeService } from "../../modules/hr/application/overtime-service";
import { H_ACTOR, setupHrFixture, shiftSvc, superuserClient } from "./fixtures";

/**
 * PHASE-045 (T-10) — the payroll variable feeds pinned (PHASE-046's
 * exact inputs):
 *
 * - THE OVERTIME FEED (BR-084 at the feed boundary): APPROVED entries
 *   feed with the exact SQL-numeric multiplied sums; a PENDING entry on
 *   a rule WITHOUT the pre-approval requirement feeds (post-hoc worked
 *   time); a pre-approval-required rule's PENDING entry NEVER feeds
 *   (the exception — never silently fed); REJECTED never feeds;
 * - THE ABSENCE/LATE FEED: the DERIVATION's verdicts are the truth —
 *   ABSENT days counted, LATE minutes summed exactly, MISSING_PUNCH
 *   surfaced as its own count (never folded into absence), a PRESENT
 *   day contributes nothing;
 * - THE LEAVE SNAPSHOT at period close: the per-year cells with the
 *   SQL-computed remaining; INV-031 holds on every cell;
 * - THE PERIOD LAW + the tenant boundary: the feed answers only within
 *   the period's dates; an unknown/foreign period is the typed 404; the
 *   boundary tenant's feed is its own world.
 */

const TENANT_H = "7a7a7a7a-7a7a-7a7a-7a7a-7a7a7a7a7a7a";
const TENANT_H_RLS = "7a7a7a7a-7a7a-7a7a-7a7a-7a7a7a7a7c7c";

const FY_H = "7a7a7a7a-aaaa-4000-8000-0000000000f1";
const PERIOD_FEED = "7a7a7a7a-aaaa-4000-8000-0000000000f2"; // 2026-03-01…31
const PERIOD_OTHER = "7a7a7a7a-aaaa-4000-8000-0000000000f3"; // 2026-04-01…30

const audit = new AuditService(new DrizzleAuditStore());
const overtimeSvc = new OvertimeService(audit);
const attendanceSvc = new AttendanceService(audit);
const leaveSvc = new LeaveService(audit);
const feedSvc = new FeedService(audit);

interface FeedSpecFixture {
  employeeF1Id: string;
  requiredRuleId: string;
  postHocRuleId: string;
  leaveTypeId: string;
}

const spec: { fixture?: FeedSpecFixture } = {};

beforeAll(async () => {
  await setupHrFixture();
  const su: Client = await superuserClient();

  // The spec's OWN employee (a fresh world — never the shared H1/H2/A1/A2).
  const employeeRows = await su.query<{ id: string; code: string }>(
    `INSERT INTO employees (id, tenant_id, code, name, name_ar, hire_date, contract_type, basic_salary, created_by) VALUES
       (gen_random_uuid(), $1, 'EMP-F1', 'Farida Al-Feed', 'فريدة التغذية', '2026-01-05', 'FULL_TIME', 8000, $2)
     ON CONFLICT (tenant_id, code) DO UPDATE SET name = EXCLUDED.name
     RETURNING id, code`,
    [TENANT_H, H_ACTOR],
  );
  const employeeF1Id = employeeRows.rows[0]!.id;

  // The pay periods (the fiscal substrate; the boundary tenant carries
  // its own empty world).
  await su.query(
    `INSERT INTO fiscal_years (id, tenant_id, name, start_date, end_date) VALUES
       ($1, $2, 'FY2026-H (feed spec)', '2026-01-01', '2026-12-31'),
       ('7a7a7a7a-aaaa-4000-8000-0000000000f4', $3, 'FY2026-RLS (feed spec)', '2026-01-01', '2026-12-31')
     ON CONFLICT (id) DO NOTHING`,
    [FY_H, TENANT_H, TENANT_H_RLS],
  );
  await su.query(
    `INSERT INTO fiscal_periods (id, tenant_id, fiscal_year_id, name, kind, start_date, end_date, status) VALUES
       ($1, $2, $3, 'FY2026-H-03 (feed spec)', 'REGULAR', '2026-03-01', '2026-03-31', 'OPEN'),
       ($4, $2, $3, 'FY2026-H-04 (feed spec)', 'REGULAR', '2026-04-01', '2026-04-30', 'OPEN'),
       ('7a7a7a7a-aaaa-4000-8000-0000000000f5', $5, '7a7a7a7a-aaaa-4000-8000-0000000000f4',
        'FY2026-RLS-03 (feed spec)', 'REGULAR', '2026-03-01', '2026-03-31', 'OPEN')
     ON CONFLICT (id) DO NOTHING`,
    [PERIOD_FEED, TENANT_H, FY_H, PERIOD_OTHER, TENANT_H_RLS],
  );
  await su.end();

  // ---- the overtime world (the real service — the tier/cap laws) ----------
  const requiredRule = await withTenant(TENANT_H, () =>
    overtimeSvc.createRule({
      code: `OT-REQ-${Date.now() % 100000}`,
      name: "Feed spec required overtime 1.5x",
      nameAr: "إضافي بموافقة مسبقة (مواصفة التغذية)",
      tier: "WEEKDAY",
      multiplier: "1.50",
      preApprovalRequired: true,
      maxHoursPerDay: "8.00",
      note: null,
      noteAr: null,
      actorId: H_ACTOR,
    }),
  );
  const postHocRule = await withTenant(TENANT_H, () =>
    overtimeSvc.createRule({
      code: `OT-POST-${Date.now() % 100000}`,
      name: "Feed spec post-hoc overtime 1.25x",
      nameAr: "إضافي لاحق (مواصفة التغذية)",
      tier: "WEEKDAY",
      multiplier: "1.25",
      preApprovalRequired: false,
      maxHoursPerDay: "8.00",
      note: null,
      noteAr: null,
      actorId: H_ACTOR,
    }),
  );

  // 2026-03-10 — the four entries: APPROVED (feeds), required-PENDING
  // (the exception — never feeds), post-hoc PENDING (feeds), REJECTED
  // (never feeds).
  const approvedEntry = await withTenant(TENANT_H, () =>
    overtimeSvc.createEntry({
      employeeId: employeeF1Id,
      workDate: "2026-03-10",
      hours: "3.00",
      ruleId: requiredRule.id,
      note: null,
      actorId: H_ACTOR,
    }),
  );
  await withTenant(TENANT_H, () =>
    overtimeSvc.decide(approvedEntry.id, { approve: true, note: null, actorId: H_ACTOR }),
  );
  await withTenant(TENANT_H, () =>
    overtimeSvc.createEntry({
      employeeId: employeeF1Id,
      workDate: "2026-03-11",
      hours: "2.00",
      ruleId: requiredRule.id, // stays PENDING — the exception
      note: null,
      actorId: H_ACTOR,
    }),
  );
  await withTenant(TENANT_H, () =>
    overtimeSvc.createEntry({
      employeeId: employeeF1Id,
      workDate: "2026-03-12",
      hours: "2.00",
      ruleId: postHocRule.id, // PENDING post-hoc — feeds
      note: null,
      actorId: H_ACTOR,
    }),
  );
  const rejectedEntry = await withTenant(TENANT_H, () =>
    overtimeSvc.createEntry({
      employeeId: employeeF1Id,
      workDate: "2026-03-13",
      hours: "1.00",
      ruleId: postHocRule.id,
      note: null,
      actorId: H_ACTOR,
    }),
  );
  await withTenant(TENANT_H, () =>
    overtimeSvc.decide(rejectedEntry.id, { approve: false, note: "not sanctioned", actorId: H_ACTOR }),
  );

  // ---- the attendance world (shift + roster + punches + the derive) -------
  const feedShift = await withTenant(TENANT_H, () =>
    shiftSvc.create({
      code: `FEED-SHIFT-${Date.now() % 100000}`,
      name: "Feed spec day shift 08:00-16:00",
      nameAr: "وردية مواصفة التغذية ٠٨:٠٠-١٦:٠٠",
      startTime: "08:00",
      endTime: "16:00",
      graceMinutes: 15,
      breakMinutes: 30,
      isNight: false,
      note: null,
      noteAr: null,
      actorId: H_ACTOR,
    }),
  );
  for (const day of ["2026-03-02", "2026-03-03", "2026-03-04", "2026-03-05"]) {
    await withTenant(TENANT_H, () =>
      shiftSvc.setRosterCell({
        employeeId: employeeF1Id,
        workDate: day,
        shiftId: feedShift.id,
        note: null,
        actorId: H_ACTOR,
      }),
    );
  }
  // 03-02 LATE 45 (in 08:45 past the 15-min grace); 03-03 punchless →
  // ABSENT; 03-04 open session → MISSING_PUNCH; 03-05 on time → PRESENT.
  await withTenant(TENANT_H, () =>
    attendanceSvc.capture({
      employeeId: employeeF1Id,
      workDate: "2026-03-02",
      checkIn: "2026-03-02T08:45:00+03:00",
      checkOut: "2026-03-02T16:00:00+03:00",
      source: "MANUAL",
      deviceRef: null,
      geoLat: null,
      geoLng: null,
      note: null,
      actorId: H_ACTOR,
    }),
  );
  await withTenant(TENANT_H, () =>
    attendanceSvc.capture({
      employeeId: employeeF1Id,
      workDate: "2026-03-04",
      checkIn: "2026-03-04T08:05:00+03:00",
      checkOut: null,
      source: "MANUAL",
      deviceRef: null,
      geoLat: null,
      geoLng: null,
      note: null,
      actorId: H_ACTOR,
    }),
  );
  await withTenant(TENANT_H, () =>
    attendanceSvc.capture({
      employeeId: employeeF1Id,
      workDate: "2026-03-05",
      checkIn: "2026-03-05T08:00:00+03:00",
      checkOut: "2026-03-05T16:00:00+03:00",
      source: "MANUAL",
      deviceRef: null,
      geoLat: null,
      geoLng: null,
      note: null,
      actorId: H_ACTOR,
    }),
  );
  await withTenant(TENANT_H, () =>
    attendanceSvc.deriveDays({
      from: "2026-03-01",
      to: "2026-03-31",
      employeeIds: [employeeF1Id],
      actorId: H_ACTOR,
    }),
  );

  // ---- the leave world (the real service — INV-031 at the boundary) -------
  const feedLeaveType = await withTenant(TENANT_H, () =>
    leaveSvc.createType({
      code: `LV-FEED-${Date.now() % 100000}`,
      name: "Feed spec annual leave",
      nameAr: "إجازة سنوية (مواصفة التغذية)",
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
    leaveSvc.runAccrual({ leaveTypeId: feedLeaveType.id, year: 2026, actorId: H_ACTOR }),
  );
  const feedRequest = await withTenant(TENANT_H, () =>
    leaveSvc.createRequest({
      employeeId: employeeF1Id,
      leaveTypeId: feedLeaveType.id,
      startDate: "2026-03-15",
      endDate: "2026-03-19",
      note: null,
      actorId: H_ACTOR,
    }),
  );
  await withTenant(TENANT_H, () => leaveSvc.approve(feedRequest.id, null, H_ACTOR));

  spec.fixture = {
    employeeF1Id,
    requiredRuleId: requiredRule.id,
    postHocRuleId: postHocRule.id,
    leaveTypeId: feedLeaveType.id,
  };
});

describe("PHASE-045 T-10 — the payroll variable feeds: overtime (BR-084), absence/late, the leave snapshot, the period law", () => {
  it("(a) THE OVERTIME FEED — APPROVED + post-hoc PENDING feed with exact multiplied sums; a required rule's PENDING (the exception) and REJECTED never feed", async () => {
    const f = spec.fixture!;
    const feed = await withTenant(TENANT_H, () =>
      feedSvc.variableFeed({ periodId: PERIOD_FEED, actorId: H_ACTOR }),
    );
    const f1 = feed.employees.find((row) => row.employeeId === f.employeeF1Id)!;
    expect(f1).toBeDefined();

    // Exactly the two feeding lines (per rule).
    expect(f1.overtime.lines).toHaveLength(2);
    const requiredLine = f1.overtime.lines.find((line) => line.ruleId === f.requiredRuleId)!;
    const postHocLine = f1.overtime.lines.find((line) => line.ruleId === f.postHocRuleId)!;
    expect(requiredLine.hours).toBe("3.00");
    expect(requiredLine.multipliedHours).toBe("4.50"); // 3.00 × 1.50
    expect(postHocLine.hours).toBe("2.00");
    expect(postHocLine.multipliedHours).toBe("2.50"); // 2.00 × 1.25 (PENDING post-hoc feeds)

    // The totals — exact sums (never float).
    expect(f1.overtime.totalHours).toBe("5.00");
    expect(f1.overtime.totalMultipliedHours).toBe("7.00");

    // The required rule's PENDING entry (2.00 × 1.50 = 3.00) NEVER
    // feeds — the exception is the board's surface, not the pay line.
    expect(requiredLine.entryCount).toBe(1);
    // REJECTED never counts.
    expect(postHocLine.entryCount).toBe(1);
  });

  it("(b) THE ABSENCE/LATE FEED — the derivation's verdicts: ABSENT counted, LATE minutes exact, MISSING_PUNCH its own count, PRESENT contributes nothing", async () => {
    const f = spec.fixture!;
    const feed = await withTenant(TENANT_H, () =>
      feedSvc.variableFeed({ periodId: PERIOD_FEED, actorId: H_ACTOR }),
    );
    const f1 = feed.employees.find((row) => row.employeeId === f.employeeF1Id)!;
    expect(f1.absenceDays).toBe(1); // 2026-03-03 — rostered punchless past day
    expect(f1.missingPunchDays).toBe(1); // 2026-03-04 — its own class, never absence
    // 2026-03-02 — in 08:45: the derivation's late fact is the minutes
    // PAST THE GRACE END (08:00 + 15 → 08:15), the countable late law:
    // 45 − 15 = 30.
    expect(f1.lateMinutes).toBe(30);
  });

  it("(c) THE LEAVE SNAPSHOT — the per-year cells with the SQL-computed remaining; INV-031 on every cell", async () => {
    const f = spec.fixture!;
    const feed = await withTenant(TENANT_H, () =>
      feedSvc.variableFeed({ periodId: PERIOD_FEED, actorId: H_ACTOR }),
    );
    expect(feed.snapshotYear).toBe(2026); // the period's END year
    const f1 = feed.employees.find((row) => row.employeeId === f.employeeF1Id)!;
    const cell = f1.leaveBalances.find((row) => row.leaveTypeId === f.leaveTypeId)!;
    expect(cell.entitlementDays).toBe("20.00"); // hired 2026-01-05 → 12 months
    expect(cell.usedDays).toBe("5.00"); // the APPROVED 5-day request
    expect(cell.carriedForwardDays).toBe("0.00");
    expect(cell.remainingDays).toBe("15.00");

    // INV-031 on EVERY cell the snapshot carries (the whole roster).
    for (const row of feed.employees) {
      for (const balance of row.leaveBalances) {
        const used = Number.parseFloat(balance.usedDays);
        const cap = Number.parseFloat(balance.entitlementDays) + Number.parseFloat(balance.carriedForwardDays);
        expect(used, `${row.employeeCode} ${balance.leaveTypeCode}`).toBeLessThanOrEqual(cap);
      }
    }
  });

  it("(d) THE PERIOD LAW + the tenant boundary — the feed answers only within the period's dates; unknown/foreign periods are the typed 404; the boundary tenant is its own world", async () => {
    const f = spec.fixture!;

    // The April period: March's facts NEVER leak across period lines.
    const april = await withTenant(TENANT_H, () =>
      feedSvc.variableFeed({ periodId: PERIOD_OTHER, actorId: H_ACTOR }),
    );
    const f1April = april.employees.find((row) => row.employeeId === f.employeeF1Id);
    expect(f1April?.overtime.lines ?? []).toHaveLength(0);
    expect(f1April?.absenceDays ?? 0).toBe(0);
    expect(f1April?.lateMinutes ?? 0).toBe(0);

    // The employee filter.
    const filtered = await withTenant(TENANT_H, () =>
      feedSvc.variableFeed({ periodId: PERIOD_FEED, employeeId: f.employeeF1Id, actorId: H_ACTOR }),
    );
    expect(filtered.employees).toHaveLength(1);
    expect(filtered.employees[0]!.employeeId).toBe(f.employeeF1Id);

    // The unknown period (A7 — unknown == foreign, RLS-indistinct).
    await expect(
      withTenant(TENANT_H, () =>
        feedSvc.variableFeed({ periodId: "00000000-0000-4000-8000-0000000000f9", actorId: H_ACTOR }),
      ),
    ).rejects.toMatchObject({ code: "FEED_PERIOD_NOT_FOUND" });

    // The boundary tenant: its own period answers its own (empty) world;
    // tenant H's period is invisible there (RLS — the typed 404).
    const boundaryFeed = await withTenant(TENANT_H_RLS, () =>
      feedSvc.variableFeed({ periodId: "7a7a7a7a-aaaa-4000-8000-0000000000f5", actorId: H_ACTOR }),
    );
    expect(boundaryFeed.employees).toHaveLength(0);
    await expect(
      withTenant(TENANT_H_RLS, () =>
        feedSvc.variableFeed({ periodId: PERIOD_FEED, actorId: H_ACTOR }),
      ),
    ).rejects.toMatchObject({ code: "FEED_PERIOD_NOT_FOUND" });

    // The audit trail.
    const su: Client = await superuserClient();
    const events = await su.query<{ n: number }>(
      `SELECT count(*)::int AS n FROM audit_events
        WHERE tenant_id = $1 AND action = 'hr.payroll_feed_computed' AND entity_id = $2`,
      [TENANT_H, PERIOD_FEED],
    );
    await su.end();
    expect(Number(events.rows[0]!.n)).toBeGreaterThanOrEqual(3); // (a)+(b)+(c)+this arm
  });
});
