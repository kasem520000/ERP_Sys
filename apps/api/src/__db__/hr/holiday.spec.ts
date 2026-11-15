import { beforeAll, describe, expect, it } from "vitest";
import type { Client } from "pg";

import { withTenant } from "../../infra/db/tenant-context";
import { AuditService } from "../../modules/audit/api/audit";
import { DrizzleAuditStore } from "../../modules/audit/infrastructure/drizzle-audit.store";
import { AttendanceService } from "../../modules/hr/application/attendance-service";
import { HolidayService } from "../../modules/hr/application/holiday-service";
import { OvertimeService } from "../../modules/hr/application/overtime-service";
import { H_ACTOR, setupHrFixture, shiftSvc } from "./fixtures";
import { superuserClient } from "../test-db";

/**
 * PHASE-045 (T-08) — the holiday-calendars service + THE INTEGRATION
 * pinned:
 *
 * - THE JURISDICTION LAW: one calendar per jurisdiction (the uq — the
 *   typed refusal), the shape bounds typed;
 * - THE ROW LAW: ONE holiday per (calendar, date) — an edit REPLACES
 *   (the upsert), a wrong row is REMOVED (the 0084 DELETE grant);
 * - THE INTEGRATION (the whole point of the calendars): a holiday
 *   added through this service flows into (1) the ATTENDANCE
 *   derivation (a rostered day with punches → HOLIDAY, never LATE)
 *   and (2) the OVERTIME tier match (the date resolves HOLIDAY) — and
 *   DEACTIVATING the calendar stops both (the active-flag gate);
 * - the tenant boundary.
 */

const TENANT_H = "7a7a7a7a-7a7a-7a7a-7a7a-7a7a7a7a7a7a";
const TENANT_H_RLS = "7a7a7a7a-7a7a-7a7a-7a7a-7a7a7a7a7c7c";

const audit = new AuditService(new DrizzleAuditStore());
const holidaySvc = new HolidayService(audit);
const attendanceSvc = new AttendanceService(audit);
const overtimeSvc = new OvertimeService(audit);

interface HolidayFixture {
  employeeK1Id: string;
  dayShiftId: string;
  calendarId: string;
}

const spec: { fixture?: HolidayFixture } = {};
let seq = 0;

function uniqueCode(prefix: string): string {
  seq += 1;
  return `${prefix}-${Date.now() % 100000}-${seq}`;
}

beforeAll(async () => {
  await setupHrFixture();
  const su: Client = await superuserClient();
  // THE WEEKEND-SETTING RESET (the T-10 round, 2026-11-15 — the
  // overtime spec's own beforeAll pattern): the overtime spec's tier
  // arm SAVES the Saudi weekend [4,5] and does not restore it; when the
  // serial order runs overtime BEFORE this spec, the post-deactivation
  // arm's date (2026-06-26, a FRIDAY) would resolve the WEEKEND tier —
  // which this spec's world (WEEKDAY + HOLIDAY rules only) cannot
  // answer. The reset makes THIS spec's world idempotent regardless of
  // who ran before (the dated-row + rule deactivation laws below).
  await su.query(
    `DELETE FROM tenant_settings WHERE tenant_id = $1 AND key = 'hr.overtime.weekend_days'`,
    [TENANT_H],
  );
  const employeeRows = await su.query<{ id: string }>(
    `INSERT INTO employees (id, tenant_id, code, name, name_ar, hire_date, contract_type, basic_salary, created_by) VALUES
       (gen_random_uuid(), $1, 'EMP-K1', 'Karim Al-Calendar', 'كريم التقويم', '2026-01-01', 'FULL_TIME', 8000, $2)
     ON CONFLICT (tenant_id, code) DO UPDATE SET name = EXCLUDED.name
     RETURNING id`,
    [TENANT_H, H_ACTOR],
  );
  await su.end();

  // The tenant-jurisdiction calendar (SA — the tenant's country) on a
  // FIXED date: 2026-06-25 (the integration arms' date). IDEMPOTENT:
  // an earlier spec in the serial suite (the import spec runs first
  // alphabetically) may already have created the SA calendar — the uq
  // law means ONE per jurisdiction, so this fixture REUSES it (the
  // dated rows are per-spec and never collide).
  const existing = await withTenant(TENANT_H, () => holidaySvc.listCalendars({}));
  const existingSa = existing.find((row) => row.jurisdictionCode === "SA");
  const calendar = existingSa ?? (await withTenant(TENANT_H, () =>
    holidaySvc.createCalendar({
      jurisdictionCode: "SA",
      name: "Saudi calendar (T-08)",
      nameAr: "التقويم السعودي (ت-٠٨)",
      note: null,
      noteAr: null,
      actorId: H_ACTOR,
    }),
  ));
  const dayShift = await withTenant(TENANT_H, () =>
    shiftSvc.create({
      code: uniqueCode("HOL-DAY"),
      name: "Holiday-integration day shift",
      nameAr: "وردية تكامل العطلة",
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
  await withTenant(TENANT_H, () =>
    shiftSvc.setRosterCell({
      employeeId: employeeRows.rows[0]!.id,
      workDate: "2026-06-25",
      shiftId: dayShift.id,
      note: null,
      actorId: H_ACTOR,
    }),
  );
  // The overtime rules (the tier arms): HOLIDAY + WEEKDAY (the
  // post-deactivation arm resolves WEEKDAY — the tier needs its rule).
  // THE IDEMPOTENT WORLD: vitest's fresh-cache order is SIZE-descending
  // (the 59085a0 diagnosis), so the overtime spec's active rules may
  // already exist — deactivate them before creating this spec's own
  // (never an ambiguity).
  const preexistingOt = await withTenant(TENANT_H, () => overtimeSvc.listRules({ active: true, limit: 500 }));
  for (const rule of preexistingOt) {
    await withTenant(TENANT_H, () => overtimeSvc.setRuleActive(rule.id, false, H_ACTOR));
  }
  await withTenant(TENANT_H, () =>
    overtimeSvc.createRule({
      code: uniqueCode("HOL-WD"),
      name: "Weekday overtime (T-08)",
      nameAr: null,
      tier: "WEEKDAY",
      multiplier: "1.50",
      preApprovalRequired: false,
      maxHoursPerDay: null,
      note: null,
      noteAr: null,
      actorId: H_ACTOR,
    }),
  );
  await withTenant(TENANT_H, () =>
    overtimeSvc.createRule({
      code: uniqueCode("HOL-OT"),
      name: "Holiday overtime (T-08)",
      nameAr: null,
      tier: "HOLIDAY",
      multiplier: "2.50",
      preApprovalRequired: false,
      maxHoursPerDay: null,
      note: null,
      noteAr: null,
      actorId: H_ACTOR,
    }),
  );
  spec.fixture = {
    employeeK1Id: employeeRows.rows[0]!.id,
    dayShiftId: dayShift.id,
    calendarId: calendar.id,
  };
});

describe("PHASE-045 T-08 — the holiday calendars + the absence/overtime-tier integration", () => {
  it("(a) THE JURISDICTION + ROW LAWS — the unique calendar per jurisdiction, the bounds typed, the one-per-date upsert, the removal", async () => {
    const f = spec.fixture!;
    // A second SA calendar → the typed refusal (the uq law).
    await expect(
      withTenant(TENANT_H, () =>
        holidaySvc.createCalendar({
          jurisdictionCode: "SA",
          name: "duplicate jurisdiction",
          nameAr: null,
          note: null,
          noteAr: null,
          actorId: H_ACTOR,
        }),
      ),
    ).rejects.toMatchObject({ code: "HOLIDAY_CALENDAR_INVALID" });
    // The jurisdiction shape (1 char) typed.
    await expect(
      withTenant(TENANT_H, () =>
        holidaySvc.createCalendar({
          jurisdictionCode: "X",
          name: "bad shape",
          nameAr: null,
          note: null,
          noteAr: null,
          actorId: H_ACTOR,
        }),
      ),
    ).rejects.toMatchObject({ code: "HOLIDAY_CALENDAR_INVALID" });

    // THE ROW LAW: the upsert REPLACES the names (one row per date).
    await withTenant(TENANT_H, () =>
      holidaySvc.upsertHoliday({
        calendarId: f.calendarId,
        holidayDate: "2026-06-25",
        name: "Founding Day",
        nameAr: "يوم التأسيس",
        actorId: H_ACTOR,
      }),
    );
    const replaced = await withTenant(TENANT_H, () =>
      holidaySvc.upsertHoliday({
        calendarId: f.calendarId,
        holidayDate: "2026-06-25",
        name: "Founding Day (corrected)",
        nameAr: "يوم التأسيس (مصحح)",
        actorId: H_ACTOR,
      }),
    );
    const rows = await withTenant(TENANT_H, () =>
      holidaySvc.listHolidays({ calendarId: f.calendarId, from: "2026-01-01", to: "2026-12-31" }),
    );
    const onDate = rows.filter((row) => row.holidayDate === "2026-06-25");
    expect(onDate).toHaveLength(1);
    expect(onDate[0]!.name).toBe("Founding Day (corrected)");
    expect(replaced.name).toBe("Founding Day (corrected)");

    // A second date + the removal.
    const second = await withTenant(TENANT_H, () =>
      holidaySvc.upsertHoliday({
        calendarId: f.calendarId,
        holidayDate: "2026-09-23",
        name: "National Day",
        nameAr: "اليوم الوطني",
        actorId: H_ACTOR,
      }),
    );
    const removed = await withTenant(TENANT_H, () => holidaySvc.removeHoliday(second.id, H_ACTOR));
    expect(removed.removed).toBe(true);
    await expect(
      withTenant(TENANT_H, () => holidaySvc.removeHoliday(second.id, H_ACTOR)),
    ).rejects.toMatchObject({ code: "HOLIDAY_NOT_FOUND" });
    // The unknown calendar + the bad range, typed.
    await expect(
      withTenant(TENANT_H, () =>
        holidaySvc.upsertHoliday({
          calendarId: "00000000-0000-4000-8000-0000000000cc",
          holidayDate: "2026-06-26",
          name: "x",
          nameAr: null,
          actorId: H_ACTOR,
        }),
      ),
    ).rejects.toMatchObject({ code: "HOLIDAY_CALENDAR_NOT_FOUND" });
  });

  it("(b) THE INTEGRATION — the holiday flows into the attendance derivation (HOLIDAY, never LATE) and the overtime tier; deactivating the calendar stops both", async () => {
    const f = spec.fixture!;
    // BEFORE the holiday exists on 2026-06-26: add it now and verify
    // both consumers; then deactivate and verify the gate.
    await withTenant(TENANT_H, () =>
      holidaySvc.upsertHoliday({
        calendarId: f.calendarId,
        holidayDate: "2026-06-26",
        name: "Integration Day",
        nameAr: "يوم التكامل",
        actorId: H_ACTOR,
      }),
    );

    // (1) The attendance derivation: a rostered K1 day with a LATE
    // punch on the HOLIDAY → HOLIDAY (never LATE — the derivation's
    // floor), with the worked facts kept.
    await withTenant(TENANT_H, () =>
      shiftSvc.setRosterCell({
        employeeId: f.employeeK1Id,
        workDate: "2026-06-26",
        shiftId: f.dayShiftId,
        note: null,
        actorId: H_ACTOR,
      }),
    );
    const record = await withTenant(TENANT_H, () =>
      attendanceSvc.capture({
        employeeId: f.employeeK1Id,
        workDate: "2026-06-26",
        checkIn: "2026-06-26T09:00:00+03:00", // 45 min past grace — LATE on a workday
        checkOut: "2026-06-26T16:00:00+03:00",
        source: "MANUAL",
        deviceRef: null,
        geoLat: null,
        geoLng: null,
        note: null,
        actorId: H_ACTOR,
      }),
    );
    expect(record.derivedStatus).toBe("HOLIDAY");
    expect(record.lateMinutes).toBeNull(); // a holiday is never late
    expect(record.workedMinutes).toBe(390); // 420 − 30 breaks

    // (2) The overtime tier: the date resolves HOLIDAY (the 2.50 rule).
    const tier = await withTenant(TENANT_H, () => overtimeSvc.resolveTier("2026-06-26"));
    expect(tier.tier).toBe("HOLIDAY");
    expect(tier.rule.multiplier).toBe("2.50");

    // THE GATE: deactivating the calendar stops both — the same date
    // now derives from the roster (LATE) and resolves WEEKDAY.
    await withTenant(TENANT_H, () => holidaySvc.setCalendarActive(f.calendarId, false, H_ACTOR));
    const tierAfter = await withTenant(TENANT_H, () => overtimeSvc.resolveTier("2026-06-26"));
    expect(tierAfter.tier).toBe("WEEKDAY");
    await withTenant(TENANT_H, () =>
      attendanceSvc.deriveDays({
        from: "2026-06-26",
        to: "2026-06-26",
        employeeIds: [f.employeeK1Id],
        actorId: H_ACTOR,
      }),
    );
    const register = await withTenant(TENANT_H, () => attendanceSvc.register("2026-06-26"));
    const row = register.rows.find((r) => r.employeeId === f.employeeK1Id);
    expect(row!.derivedStatus).toBe("LATE"); // the holiday no longer suppresses it
    expect(row!.lateMinutes).toBe(45);

    // Reactivate (the world stays coherent for the later arms).
    await withTenant(TENANT_H, () => holidaySvc.setCalendarActive(f.calendarId, true, H_ACTOR));
    // The integration read surfaces the tenant-jurisdiction dates.
    const dates = await withTenant(TENANT_H, () =>
      holidaySvc.tenantJurisdictionHolidays("2026-01-01", "2026-12-31"),
    );
    expect(dates.has("2026-06-25")).toBe(true);
    expect(dates.has("2026-06-26")).toBe(true);
    expect(dates.has("2026-09-23")).toBe(false); // removed in arm (a)
  });

  it("(c) THE BOUNDARY — the boundary tenant's empty world; the A7 refusals", async () => {
    const f = spec.fixture!;
    const foreignCalendars = await withTenant(TENANT_H_RLS, () => holidaySvc.listCalendars({}));
    expect(foreignCalendars).toHaveLength(0);
    const foreignHolidays = await withTenant(TENANT_H_RLS, () =>
      holidaySvc.listHolidays({ from: "2026-01-01", to: "2026-12-31" }),
    );
    expect(foreignHolidays).toHaveLength(0);
    await expect(
      withTenant(TENANT_H_RLS, () =>
        holidaySvc.upsertHoliday({
          calendarId: f.calendarId, // tenant H's calendar — invisible under RLS
          holidayDate: "2026-06-27",
          name: "x",
          nameAr: null,
          actorId: H_ACTOR,
        }),
      ),
    ).rejects.toMatchObject({ code: "HOLIDAY_CALENDAR_NOT_FOUND" });
    // The boundary tenant's own calendar creation works (its own world).
    const own = await withTenant(TENANT_H_RLS, () =>
      holidaySvc.createCalendar({
        jurisdictionCode: "SA",
        name: "Boundary calendar",
        nameAr: null,
        note: null,
        noteAr: null,
        actorId: H_ACTOR,
      }),
    );
    expect(own.jurisdictionCode).toBe("SA");
  });
});
