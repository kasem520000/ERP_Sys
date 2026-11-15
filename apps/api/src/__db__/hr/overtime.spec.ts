import { beforeAll, describe, expect, it } from "vitest";
import type { Client } from "pg";

import { withTenant } from "../../infra/db/tenant-context";
import { AuditService } from "../../modules/audit/api/audit";
import { DrizzleAuditStore } from "../../modules/audit/infrastructure/drizzle-audit.store";
import { OvertimeService } from "../../modules/hr/application/overtime-service";
import { H_ACTOR, setupHrFixture } from "./fixtures";
import { superuserClient } from "../test-db";

/**
 * PHASE-045 (T-06) — the overtime engine pinned:
 *
 * - THE RULE LAWS: the code unique, the tier/multiplier/cap bounds
 *   typed before any write (the 0082 CHECKs surfaced);
 * - THE TIER-MATCHING LAW: HOLIDAY (the tenant-jurisdiction calendar)
 *   > WEEKEND (the tenant's weekend setting — NO fabricated default:
 *   while unconfigured the WEEKEND tier never auto-matches) >
 *   WEEKDAY; an ambiguity (two ACTIVE rules on the tier) and an
 *   unavailability (none) are typed refusals — never a silent pick;
 * - BR-084: a pre-approval-required rule's PENDING entry is the
 *   EXCEPTION (never silently fed); a rule without the requirement
 *   records post-hoc worked time (PENDING is not an exception); the
 *   APPROVE/REJECT decisions clear the exception (a decided verdict
 *   is not an open exception) and stamp the approver; a decided entry
 *   never re-decides;
 * - THE PER-DAY CAP: the sanctionable day-total under one rule
 *   (PENDING + APPROVED — REJECTED never counts) bounds the day,
 *   typed before any write;
 * - THE MULTIPLIER APPLICATION: hours × multiplier computed in SQL
 *   numeric math (exact — never float);
 * - the tenant boundary.
 */

const TENANT_H = "7a7a7a7a-7a7a-7a7a-7a7a-7a7a7a7a7a7a";
const TENANT_H_RLS = "7a7a7a7a-7a7a-7a7a-7a7a-7a7a7a7a7c7c";

const audit = new AuditService(new DrizzleAuditStore());
const overtimeSvc = new OvertimeService(audit);

interface OvertimeFixture {
  employeeO1Id: string;
  weekdayRuleId: string;
  weekendRuleId: string;
  holidayRuleId: string;
}

const spec: { fixture?: OvertimeFixture } = {};
let seq = 0;

function uniqueCode(prefix: string): string {
  seq += 1;
  return `${prefix}-${Date.now() % 100000}-${seq}`;
}

beforeAll(async () => {
  await setupHrFixture();
  // The spec's own employee + the weekend-setting reset (a persisted
  // setting from an earlier run would leak into the tier arms).
  const su: Client = await superuserClient();
  await su.query(
    `DELETE FROM tenant_settings WHERE tenant_id = $1 AND key = 'hr.overtime.weekend_days'`,
    [TENANT_H],
  );
  const employeeRows = await su.query<{ id: string; code: string }>(
    `INSERT INTO employees (id, tenant_id, code, name, name_ar, hire_date, contract_type, basic_salary, created_by) VALUES
       (gen_random_uuid(), $1, 'EMP-O1', 'Omar Al-Overtime', 'عمر الإضافي', '2026-01-01', 'FULL_TIME', 8000, $2)
     ON CONFLICT (tenant_id, code) DO UPDATE SET name = EXCLUDED.name
     RETURNING id, code`,
    [TENANT_H, H_ACTOR],
  );
  await su.end();

  // THE IDEMPOTENT WORLD (the serial suite's alphabetical order runs
  // the holiday spec first — its HOLIDAY/WEEKDAY rules would make this
  // spec's tier arms ambiguous): deactivate every pre-existing ACTIVE
  // rule on the three tiers BEFORE creating this spec's own.
  const preexisting = await withTenant(TENANT_H, () => overtimeSvc.listRules({ active: true, limit: 500 }));
  for (const rule of preexisting) {
    await withTenant(TENANT_H, () => overtimeSvc.setRuleActive(rule.id, false, H_ACTOR));
  }
  const weekday = await withTenant(TENANT_H, () =>
    overtimeSvc.createRule({
      code: uniqueCode("OT-WD"),
      name: "Weekday overtime 1.5×",
      nameAr: "إضافي أيام العمل ١٫٥×",
      tier: "WEEKDAY",
      multiplier: "1.50",
      preApprovalRequired: true,
      maxHoursPerDay: "4.00",
      note: null,
      noteAr: null,
      actorId: H_ACTOR,
    }),
  );
  const weekend = await withTenant(TENANT_H, () =>
    overtimeSvc.createRule({
      code: uniqueCode("OT-WE"),
      name: "Weekend overtime 2×",
      nameAr: "إضافي العطلة الأسبوعية ٢×",
      tier: "WEEKEND",
      multiplier: "2.00",
      preApprovalRequired: false,
      maxHoursPerDay: null,
      note: null,
      noteAr: null,
      actorId: H_ACTOR,
    }),
  );
  const holiday = await withTenant(TENANT_H, () =>
    overtimeSvc.createRule({
      code: uniqueCode("OT-HD"),
      name: "Holiday overtime 2.5×",
      nameAr: "إضافي العطلة الرسمية ٢٫٥×",
      tier: "HOLIDAY",
      multiplier: "2.50",
      preApprovalRequired: true,
      maxHoursPerDay: "8.00",
      note: null,
      noteAr: null,
      actorId: H_ACTOR,
    }),
  );
  // A holiday on 2026-06-20 (Saturday) via the tenant-jurisdiction
  // calendar (upserted, re-run safe — the attendance.spec precedent).
  await withTenant(TENANT_H, async () => {
    const { requireTenantContext } = await import("../../infra/db/tenant-context");
    const { sql } = await import("drizzle-orm");
    const tx = requireTenantContext().tx!;
    await tx.execute(sql`
      INSERT INTO holiday_calendars (id, tenant_id, jurisdiction_code, name, name_ar)
      VALUES (gen_random_uuid(), erp.current_tenant_id(), 'SA', 'Saudi national calendar (OT)', 'التقويم السعودي (الإضافي)')
      ON CONFLICT (tenant_id, jurisdiction_code) DO UPDATE SET name = EXCLUDED.name
    `);
    const calendarRows = await tx.execute<{ id: string }>(sql`
      SELECT id::text AS id FROM holiday_calendars
      WHERE jurisdiction_code = 'SA' AND tenant_id = erp.current_tenant_id() LIMIT 1
    `);
    await tx.execute(sql`
      INSERT INTO holidays (id, tenant_id, calendar_id, holiday_date, name, name_ar)
      VALUES (gen_random_uuid(), erp.current_tenant_id(), ${calendarRows.rows[0]!.id}, '2026-06-20'::date,
              'OT fixture holiday', 'عطلة تثبيت الإضافي')
      ON CONFLICT (tenant_id, calendar_id, holiday_date) DO UPDATE SET name = EXCLUDED.name
    `);
  });

  spec.fixture = {
    employeeO1Id: employeeRows.rows[0]!.id,
    weekdayRuleId: weekday.id,
    weekendRuleId: weekend.id,
    holidayRuleId: holiday.id,
  };
});

describe("PHASE-045 T-06 — the overtime engine: the tiers, BR-084, the per-day cap, the multiplier", () => {
  it("(a) THE RULE LAWS — the code unique, the bounds typed, deactivation filters and blocks", async () => {
    const code = uniqueCode("OT-DUP");
    // The duplicate pair's FIRST rule stays ACTIVE — deactivate it so
    // the tier arms see exactly ONE active WEEKDAY rule (the fixture's).
    const duplicateFirst = await withTenant(TENANT_H, () =>
      overtimeSvc.createRule({
        code,
        name: "first",
        nameAr: null,
        tier: "WEEKDAY",
        multiplier: "1.00",
        preApprovalRequired: false,
        maxHoursPerDay: null,
        note: null,
        noteAr: null,
        actorId: H_ACTOR,
      }),
    );
    await withTenant(TENANT_H, () => overtimeSvc.setRuleActive(duplicateFirst.id, false, H_ACTOR));
    await expect(
      withTenant(TENANT_H, () =>
        overtimeSvc.createRule({
          code,
          name: "duplicate",
          nameAr: null,
          tier: "WEEKDAY",
          multiplier: "1.00",
          preApprovalRequired: false,
          maxHoursPerDay: null,
          note: null,
          noteAr: null,
          actorId: H_ACTOR,
        }),
      ),
    ).rejects.toMatchObject({ code: "OVERTIME_RULE_INVALID" });

    await expect(
      withTenant(TENANT_H, () =>
        overtimeSvc.createRule({
          code: uniqueCode("OT-BAD-MULT"),
          name: "too much",
          nameAr: null,
          tier: "WEEKDAY",
          multiplier: "9.00",
          preApprovalRequired: false,
          maxHoursPerDay: null,
          note: null,
          noteAr: null,
          actorId: H_ACTOR,
        }),
      ),
    ).rejects.toMatchObject({ code: "OVERTIME_RULE_INVALID" });

    await expect(
      withTenant(TENANT_H, () =>
        overtimeSvc.createRule({
          code: uniqueCode("OT-BAD-CAP"),
          name: "cap too high",
          nameAr: null,
          tier: "WEEKDAY",
          multiplier: "1.00",
          preApprovalRequired: false,
          maxHoursPerDay: "20.00",
          note: null,
          noteAr: null,
          actorId: H_ACTOR,
        }),
      ),
    ).rejects.toMatchObject({ code: "OVERTIME_RULE_INVALID" });

    // The multiplier string law: floats are refused (exact strings only).
    await expect(
      withTenant(TENANT_H, () =>
        overtimeSvc.createRule({
          code: uniqueCode("OT-BAD-STR"),
          name: "not a string",
          nameAr: null,
          tier: "WEEKDAY",
          multiplier: 1.5 as unknown as string,
          preApprovalRequired: false,
          maxHoursPerDay: null,
          note: null,
          noteAr: null,
          actorId: H_ACTOR,
        }),
      ),
    ).rejects.toMatchObject({ code: "OVERTIME_RULE_INVALID" });

    const inactive = await withTenant(TENANT_H, () =>
      overtimeSvc.createRule({
        code: uniqueCode("OT-OFF"),
        name: "to deactivate",
        nameAr: null,
        tier: "WEEKDAY",
        multiplier: "1.00",
        preApprovalRequired: false,
        maxHoursPerDay: null,
        note: null,
        noteAr: null,
        actorId: H_ACTOR,
      }),
    );
    const off = await withTenant(TENANT_H, () =>
      overtimeSvc.setRuleActive(inactive.id, false, H_ACTOR),
    );
    expect(off.active).toBe(false);
    // An inactive rule never matches the tier and never accepts time.
    await expect(
      withTenant(TENANT_H, () =>
        overtimeSvc.createEntry({
          employeeId: spec.fixture!.employeeO1Id,
          workDate: "2026-06-15",
          hours: "1.00",
          ruleId: inactive.id,
          note: null,
          actorId: H_ACTOR,
        }),
      ),
    ).rejects.toMatchObject({ code: "OVERTIME_RULE_INACTIVE" });
  });

  it("(b) THE TIER-MATCHING LAW — HOLIDAY > the configured WEEKEND > WEEKDAY; no fabricated default; ambiguity and unavailability typed", async () => {
    // While the weekend setting is UNCONFIGURED: a Saturday resolves
    // WEEKDAY (the weekend tier never auto-matches — no fabricated
    // default).
    const unconfigured = await withTenant(TENANT_H, () =>
      overtimeSvc.resolveTier("2026-06-13"),
    ); // 2026-06-13 is a Saturday
    expect(unconfigured.tier).toBe("WEEKDAY");
    expect(unconfigured.rule.tier).toBe("WEEKDAY");
    expect(unconfigured.weekendDays).toEqual([]);

    // Configure the Saudi weekend (Friday=4, Saturday=5): the same
    // Saturday now resolves WEEKEND.
    await withTenant(TENANT_H, () => overtimeSvc.saveWeekendDays([4, 5], H_ACTOR));
    const weekend = await withTenant(TENANT_H, () => overtimeSvc.resolveTier("2026-06-13"));
    expect(weekend.tier).toBe("WEEKEND");
    expect(weekend.rule.multiplier).toBe("2.00");

    // A holiday beats the weekend: 2026-06-20 (Saturday, a holiday).
    const holiday = await withTenant(TENANT_H, () => overtimeSvc.resolveTier("2026-06-20"));
    expect(holiday.tier).toBe("HOLIDAY");
    expect(holiday.rule.multiplier).toBe("2.50");

    // A plain weekday stays WEEKDAY.
    const weekday = await withTenant(TENANT_H, () => overtimeSvc.resolveTier("2026-06-15"));
    expect(weekday.tier).toBe("WEEKDAY");

    // The ambiguity: a second ACTIVE WEEKDAY rule → the typed refusal.
    await withTenant(TENANT_H, () =>
      overtimeSvc.createRule({
        code: uniqueCode("OT-WD2"),
        name: "second weekday rule",
        nameAr: null,
        tier: "WEEKDAY",
        multiplier: "1.75",
        preApprovalRequired: false,
        maxHoursPerDay: null,
        note: null,
        noteAr: null,
        actorId: H_ACTOR,
      }),
    );
    await expect(
      withTenant(TENANT_H, () => overtimeSvc.resolveTier("2026-06-15")),
    ).rejects.toMatchObject({ code: "OVERTIME_TIER_AMBIGUOUS" });
    // The entry without an explicit rule surfaces the same refusal.
    await expect(
      withTenant(TENANT_H, () =>
        overtimeSvc.createEntry({
          employeeId: spec.fixture!.employeeO1Id,
          workDate: "2026-06-15",
          hours: "1.00",
          ruleId: null,
          note: null,
          actorId: H_ACTOR,
        }),
      ),
    ).rejects.toMatchObject({ code: "OVERTIME_TIER_AMBIGUOUS" });
    // Deactivate the second rule → unambiguous again.
    const second = await withTenant(TENANT_H, () =>
      overtimeSvc.listRules({ active: true, limit: 500 }),
    );
    const secondRule = second.find((rule) => rule.multiplier === "1.75")!;
    await withTenant(TENANT_H, () => overtimeSvc.setRuleActive(secondRule.id, false, H_ACTOR));
    const resolved = await withTenant(TENANT_H, () => overtimeSvc.resolveTier("2026-06-15"));
    expect(resolved.rule.multiplier).toBe("1.50");

    // The bad weekend setting, typed.
    await expect(
      withTenant(TENANT_H, () => overtimeSvc.saveWeekendDays([9], H_ACTOR)),
    ).rejects.toMatchObject({ code: "OVERTIME_RULE_INVALID" });
  });

  it("(c) BR-084 — a pre-approval-required rule's PENDING entry is the EXCEPTION; approve clears it and applies the multiplier exactly; the cap bounds the day; reject never counts", async () => {
    const f = spec.fixture!;
    const employeeId = f.employeeO1Id;

    // A PENDING entry under the REQUIRED weekday rule (cap 4h): 2.5h
    // → is_exception true (BR-084 — never silently fed).
    const pending = await withTenant(TENANT_H, () =>
      overtimeSvc.createEntry({
        employeeId,
        workDate: "2026-06-15",
        hours: "2.50",
        ruleId: f.weekdayRuleId,
        note: "evening maintenance window",
        actorId: H_ACTOR,
      }),
    );
    expect(pending.status).toBe("PENDING");
    expect(pending.isException).toBe(true);
    expect(pending.multipliedHours).toBe("3.75"); // 2.50 × 1.50 — exact numeric math

    // THE CAP: 2.5h PENDING + 2.0h new = 4.5 > 4.00 → typed refusal.
    await expect(
      withTenant(TENANT_H, () =>
        overtimeSvc.createEntry({
          employeeId,
          workDate: "2026-06-15",
          hours: "2.00",
          ruleId: f.weekdayRuleId,
          note: null,
          actorId: H_ACTOR,
        }),
      ),
    ).rejects.toMatchObject({ code: "OVERTIME_ENTRY_INVALID" });
    // 1.5h more stays within the cap (2.5 + 1.5 = 4.0 ≤ 4.0).
    const second = await withTenant(TENANT_H, () =>
      overtimeSvc.createEntry({
        employeeId,
        workDate: "2026-06-15",
        hours: "1.50",
        ruleId: f.weekdayRuleId,
        note: null,
        actorId: H_ACTOR,
      }),
    );
    expect(second.isException).toBe(true);

    // The entry hours bounds, typed (0 and > 16).
    await expect(
      withTenant(TENANT_H, () =>
        overtimeSvc.createEntry({
          employeeId,
          workDate: "2026-06-16",
          hours: "0.00",
          ruleId: f.weekdayRuleId,
          note: null,
          actorId: H_ACTOR,
        }),
      ),
    ).rejects.toMatchObject({ code: "OVERTIME_ENTRY_INVALID" });

    // APPROVE: the exception clears, the approver + timestamp stamp,
    // the multiplied hours carry the exact product.
    const approved = await withTenant(TENANT_H, () =>
      overtimeSvc.decide(pending.id, { approve: true, note: "approved by ops", actorId: H_ACTOR }),
    );
    expect(approved.status).toBe("APPROVED");
    expect(approved.isException).toBe(false);
    expect(approved.decidedBy).toBe(H_ACTOR);
    expect(approved.decidedAt).not.toBeNull();
    expect(approved.multipliedHours).toBe("3.75");

    // A decided entry never re-decides (the typed lifecycle conflict).
    await expect(
      withTenant(TENANT_H, () =>
        overtimeSvc.decide(pending.id, { approve: false, note: null, actorId: H_ACTOR }),
      ),
    ).rejects.toMatchObject({ code: "OVERTIME_ENTRY_RESOLVED" });

    // The not-required WEEKEND rule (2×): PENDING is NOT an exception
    // (post-hoc worked time feeds; REJECTED never feeds).
    const weekendEntry = await withTenant(TENANT_H, () =>
      overtimeSvc.createEntry({
        employeeId,
        workDate: "2026-06-13",
        hours: "3.00",
        ruleId: f.weekendRuleId,
        note: null,
        actorId: H_ACTOR,
      }),
    );
    expect(weekendEntry.status).toBe("PENDING");
    expect(weekendEntry.isException).toBe(false);
    expect(weekendEntry.multipliedHours).toBe("6.00");

    const rejected = await withTenant(TENANT_H, () =>
      overtimeSvc.decide(weekendEntry.id, { approve: false, note: "double-punch artifact", actorId: H_ACTOR }),
    );
    expect(rejected.status).toBe("REJECTED");
    expect(rejected.isException).toBe(false);

    // REJECTED time never counts against the cap: the day 2026-06-13's
    // rule has NO cap (null) — verify via the weekday rule instead:
    // the 2026-06-15 day has 2.5 APPROVED + 1.5 PENDING = 4.0 (at the
    // cap); rejecting the 1.5 frees 1.5h more.
    await withTenant(TENANT_H, () =>
      overtimeSvc.decide(second.id, { approve: false, note: "freed", actorId: H_ACTOR }),
    );
    const afterReject = await withTenant(TENANT_H, () =>
      overtimeSvc.createEntry({
        employeeId,
        workDate: "2026-06-15",
        hours: "1.50",
        ruleId: f.weekdayRuleId,
        note: null,
        actorId: H_ACTOR,
      }),
    );
    expect(afterReject.status).toBe("PENDING");

    // The exception board: only the open BR-084 exceptions surface.
    const board = await withTenant(TENANT_H, () =>
      overtimeSvc.listEntries({ from: "2026-06-01", to: "2026-06-30", onlyExceptions: true }),
    );
    expect(board.total).toBeGreaterThanOrEqual(1);
    expect(board.rows.every((row) => row.isException && row.status === "PENDING")).toBe(true);
  });

  it("(d) THE READS + THE BOUNDARY — pagination with total + hasMore; the boundary tenant sees nothing; the foreign employee is the A7 not-found", async () => {
    const f = spec.fixture!;
    const entries = await withTenant(TENANT_H, () =>
      overtimeSvc.listEntries({
        from: "2026-06-01",
        to: "2026-06-30",
        employeeIds: [f.employeeO1Id],
      }),
    );
    expect(entries.total).toBe(4); // approved 2.5 + rejected 3.0 + rejected 1.5 + pending 1.5
    const statuses = entries.rows.map((row) => row.status).sort();
    expect(statuses).toEqual(["APPROVED", "PENDING", "REJECTED", "REJECTED"]);

    const page1 = await withTenant(TENANT_H, () =>
      overtimeSvc.listEntries({
        from: "2026-06-01",
        to: "2026-06-30",
        employeeIds: [f.employeeO1Id],
        page: 1,
        pageSize: 3,
      }),
    );
    expect(page1.rows).toHaveLength(3);
    expect(page1.hasMore).toBe(true);
    const page2 = await withTenant(TENANT_H, () =>
      overtimeSvc.listEntries({
        from: "2026-06-01",
        to: "2026-06-30",
        employeeIds: [f.employeeO1Id],
        page: 2,
        pageSize: 3,
      }),
    );
    expect(page2.rows).toHaveLength(1);
    expect(page2.hasMore).toBe(false);

    // The status filter + the bad filter, typed.
    const approvedOnly = await withTenant(TENANT_H, () =>
      overtimeSvc.listEntries({
        from: "2026-06-01",
        to: "2026-06-30",
        employeeIds: [f.employeeO1Id],
        status: "APPROVED",
      }),
    );
    expect(approvedOnly.total).toBe(1);
    await expect(
      withTenant(TENANT_H, () =>
        overtimeSvc.listEntries({ from: "2026-06-01", to: "2026-06-30", status: "WEIRD" }),
      ),
    ).rejects.toMatchObject({ code: "OVERTIME_ENTRY_INVALID" });

    // The boundary tenant: empty world, the A7 foreign refusals.
    const foreign = await withTenant(TENANT_H_RLS, () =>
      overtimeSvc.listEntries({ from: "2026-06-01", to: "2026-06-30" }),
    );
    expect(foreign.total).toBe(0);
    await expect(
      withTenant(TENANT_H_RLS, () =>
        overtimeSvc.createEntry({
          employeeId: f.employeeO1Id,
          workDate: "2026-06-15",
          hours: "1.00",
          ruleId: f.weekdayRuleId,
          note: null,
          actorId: H_ACTOR,
        }),
      ),
    ).rejects.toMatchObject({ code: "HR_EMPLOYEE_NOT_FOUND" });
    await expect(
      withTenant(TENANT_H_RLS, () =>
        overtimeSvc.resolveTier("2026-06-15"),
      ),
    ).rejects.toMatchObject({ code: "OVERTIME_TIER_UNAVAILABLE" });
  });
});
