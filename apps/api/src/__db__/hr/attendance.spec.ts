import { beforeAll, describe, expect, it } from "vitest";
import type { Client } from "pg";

import { withTenant } from "../../infra/db/tenant-context";
import { AuditService } from "../../modules/audit/api/audit";
import { DrizzleAuditStore } from "../../modules/audit/infrastructure/drizzle-audit.store";
import { AttendanceService } from "../../modules/hr/application/attendance-service";
import { H_ACTOR, setupHrFixture, shiftSvc } from "./fixtures";
import { superuserClient } from "../test-db";

/**
 * PHASE-045 (T-04) — the attendance service pinned:
 *
 * - THE DERIVATION LAW: the day is the unit — HOLIDAY (the tenant-
 *   jurisdiction calendar) > ON_LEAVE (an APPROVED span) > the
 *   operational family (ABSENT / MISSING_PUNCH / LATE / PRESENT), with
 *   the minute facts exact (late past grace, early leave, worked minus
 *   breaks, overtime past the shift end — the NIGHT crossing ends on
 *   work_date + 1, all instants in the TENANT's timezone);
 * - BR-082 (the immutability window): check_out fills EXACTLY ONCE,
 *   a second fill is the typed refusal; corrections arrive as NEW
 *   rows; the derivation write touches STATUS fields only and is
 *   IDEMPOTENT (an unchanged verdict writes nothing);
 * - INV-031: intervals never overlap per employee-day (an open session
 *   blocks every later one), and the 0081 dedupe floor (the same
 *   employee + timestamp is ONE session) surfaces typed;
 * - THE ABSENT SYNTHESIS: a rostered day that already happened with
 *   no punch, no holiday, no leave is recorded as the (null, null)
 *   marker — never for a future day, never for an unrostered one;
 * - the reads (the daily register + the paginated exception board with
 *   total + hasMore) and the tenant boundary (the dedicated empty
 *   boundary tenant + the A7 foreign-employee refusal).
 *
 * Isolation: the attendance world rides its OWN employees (EMP-A1 /
 * EMP-A2 — upserted by code, the fixtures.ts precedent) so the
 * shifts-roster spec's rotation cells on the shared H1/H2 never enter
 * this spec's derivation universes; the append-only table is reset
 * (superuser purge of TENANT_H's attendance rows) because capture is
 * INSERT-only — upsert hygiene cannot make a re-run idempotent the way
 * the roster's replace-cells can.
 */

const TENANT_H = "7a7a7a7a-7a7a-7a7a-7a7a-7a7a7a7a7a7a";
const TENANT_H_RLS = "7a7a7a7a-7a7a-7a7a-7a7a-7a7a7a7a7c7c";

const audit = new AuditService(new DrizzleAuditStore());
const attendanceSvc = new AttendanceService(audit);

/** A dynamic always-future date (30 days out) — the no-synthesis arm
 * must stay future-proof as real time moves past the fixed fixtures. */
function futureIsoDate(): string {
  return new Date(Date.now() + 30 * 86_400_000).toISOString().slice(0, 10);
}

interface AttendanceFixture {
  employeeA1Id: string;
  employeeA2Id: string;
  dayShiftId: string;
  dayShiftCode: string;
  nightShiftId: string;
  futureDate: string;
}

const spec: { fixture?: AttendanceFixture } = {};
let seq = 0;

function uniqueCode(prefix: string): string {
  seq += 1;
  return `${prefix}-${Date.now() % 100000}-${seq}`;
}

beforeAll(async () => {
  await setupHrFixture();

  // The append-only reset: capture is INSERT-only, so a re-run must
  // clear the spec's own world first (the roster's replace-cells
  // hygiene does not exist for punch sessions).
  const su: Client = await superuserClient();
  await su.query(`DELETE FROM attendance_records WHERE tenant_id = $1`, [TENANT_H]);

  // The spec's OWN employees (the H1/H2 world belongs to shifts-roster;
  // a shared employee would pull that spec's rotation cells into this
  // spec's derivation universes).
  const employeeRows = await su.query<{ id: string; code: string }>(
    `INSERT INTO employees (id, tenant_id, code, name, name_ar, hire_date, contract_type, basic_salary, created_by) VALUES
       (gen_random_uuid(), $1, 'EMP-A1', 'Amine Al-Attendance', 'أمين الحضور', '2026-01-01', 'FULL_TIME', 8000, $2),
       (gen_random_uuid(), $1, 'EMP-A2', 'Aya Al-Leave', 'آية الإجازة', '2026-01-01', 'FULL_TIME', 9000, $2)
     ON CONFLICT (tenant_id, code) DO UPDATE SET name = EXCLUDED.name
     RETURNING id, code`,
    [TENANT_H, H_ACTOR],
  );
  const byCode = new Map(employeeRows.rows.map((row) => [row.code, row.id]));

  const fixture = await withTenant(TENANT_H, async () => {
    // The holiday calendar (jurisdiction SA — tenant H's country) with
    // a holiday on 2026-06-06; upserted (re-run safe).
    const { requireTenantContext } = await import("../../infra/db/tenant-context");
    const { sql } = await import("drizzle-orm");
    const tx = requireTenantContext().tx!;
    await tx.execute(sql`
      INSERT INTO holiday_calendars (id, tenant_id, jurisdiction_code, name, name_ar)
      VALUES (gen_random_uuid(), erp.current_tenant_id(), 'SA', 'Saudi national calendar', 'التقويم السعودي')
      ON CONFLICT (tenant_id, jurisdiction_code) DO UPDATE SET name = EXCLUDED.name
    `);
    const calendarRows = await tx.execute<{ id: string }>(sql`
      SELECT id::text AS id FROM holiday_calendars
      WHERE jurisdiction_code = 'SA' AND tenant_id = erp.current_tenant_id() LIMIT 1
    `);
    const calendarId = calendarRows.rows[0]!.id;
    await tx.execute(sql`
      INSERT INTO holidays (id, tenant_id, calendar_id, holiday_date, name, name_ar)
      VALUES (gen_random_uuid(), erp.current_tenant_id(), ${calendarId}, '2026-06-06'::date,
              'Founding Day fixture', 'يوم التأسيس (تثبيت)')
      ON CONFLICT (tenant_id, calendar_id, holiday_date) DO UPDATE SET name = EXCLUDED.name
    `);

    // The leave substrate: a type + an APPROVED span for A2 covering
    // 2026-06-07…09 (the leave service itself is T-07 — the fixture
    // seeds its tables directly, guarded idempotent).
    await tx.execute(sql`
      INSERT INTO leave_types (id, tenant_id, code, name, name_ar, paid)
      VALUES (gen_random_uuid(), erp.current_tenant_id(), 'ANNUAL-ATT', 'Annual (attendance spec)', 'سنوية (مواصفة الحضور)', true)
      ON CONFLICT (tenant_id, code) DO UPDATE SET name = EXCLUDED.name
    `);
    const typeRows = await tx.execute<{ id: string }>(sql`
      SELECT id::text AS id FROM leave_types
      WHERE code = 'ANNUAL-ATT' AND tenant_id = erp.current_tenant_id() LIMIT 1
    `);
    const leaveTypeId = typeRows.rows[0]!.id;
    await tx.execute(sql`
      INSERT INTO leave_requests (id, tenant_id, employee_id, leave_type_id, start_date, end_date, days, status, requested_by, decided_by, decided_at)
      SELECT gen_random_uuid(), erp.current_tenant_id(), ${byCode.get("EMP-A2")!}, ${leaveTypeId},
             '2026-06-07'::date, '2026-06-09'::date, 3, 'APPROVED', ${H_ACTOR}, ${H_ACTOR}, now()
      WHERE NOT EXISTS (
        SELECT 1 FROM leave_requests
        WHERE tenant_id = erp.current_tenant_id() AND employee_id = ${byCode.get("EMP-A2")!}
          AND leave_type_id = ${leaveTypeId} AND start_date = '2026-06-07'::date AND status = 'APPROVED')
    `);
    return {
      employeeA1Id: byCode.get("EMP-A1")!,
      employeeA2Id: byCode.get("EMP-A2")!,
      dayShiftId: "",
      dayShiftCode: "",
      nightShiftId: "",
      futureDate: futureIsoDate(),
    };
  });

  // The shifts + roster cells ride the real services (the T-03 surface
  // under test reuse — upserts and replace-cells are re-run safe).
  const dayShift = await withTenant(TENANT_H, () =>
    shiftSvc.create({
      code: uniqueCode("ATT-DAY"),
      name: "Attendance day shift 08:00–16:00",
      nameAr: "وردية نهارية ٠٨:٠٠–١٦:٠٠",
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
  const nightShift = await withTenant(TENANT_H, () =>
    shiftSvc.create({
      code: uniqueCode("ATT-NIGHT"),
      name: "Attendance night shift 22:00–06:00",
      nameAr: "وردية ليلية ٢٢:٠٠–٠٦:٠٠",
      startTime: "22:00",
      endTime: "06:00",
      graceMinutes: 10,
      breakMinutes: 45,
      isNight: true,
      note: null,
      noteAr: null,
      actorId: H_ACTOR,
    }),
  );
  const f: AttendanceFixture = {
    ...fixture,
    dayShiftId: dayShift.id,
    dayShiftCode: dayShift.code,
    nightShiftId: nightShift.id,
    futureDate: futureIsoDate(),
  };
  for (const workDate of ["2026-06-01", "2026-06-02", "2026-06-03", "2026-06-05", "2026-06-06", "2026-06-08"]) {
    await withTenant(TENANT_H, () =>
      shiftSvc.setRosterCell({
        employeeId: f.employeeA1Id,
        workDate,
        shiftId: dayShift.id,
        note: null,
        actorId: H_ACTOR,
      }),
    );
  }
  await withTenant(TENANT_H, () =>
    shiftSvc.setRosterCell({
      employeeId: f.employeeA1Id,
      workDate: "2026-06-09",
      shiftId: nightShift.id,
      note: null,
      actorId: H_ACTOR,
    }),
  );
  await withTenant(TENANT_H, () =>
    shiftSvc.setRosterCell({
      employeeId: f.employeeA1Id,
      workDate: f.futureDate,
      shiftId: dayShift.id,
      note: null,
      actorId: H_ACTOR,
    }),
  );
  await withTenant(TENANT_H, () =>
    shiftSvc.setRosterCell({
      employeeId: f.employeeA2Id,
      workDate: "2026-06-07",
      shiftId: dayShift.id,
      note: null,
      actorId: H_ACTOR,
    }),
  );
  await su.end();
  spec.fixture = f;
});

describe("PHASE-045 T-04 — the attendance service: capture, the derived daily status, the exceptions, BR-082", () => {
  it("(a) THE DERIVATION LAW on a rostered day — PRESENT within grace with the exact minute facts; LATE past grace after the one-shot checkout; an open session is MISSING_PUNCH", async () => {
    const f = spec.fixture!;

    // 2026-06-01, DAY 08:00–16:00 (grace 15, breaks 30), in 08:05 → out 16:10
    // (all instants in the tenant's timezone, Asia/Riyadh +03:00):
    // PRESENT, late 0, early 0, worked 485 − 30 = 455, overtime 10.
    const present = await withTenant(TENANT_H, () =>
      attendanceSvc.capture({
        employeeId: f.employeeA1Id,
        workDate: "2026-06-01",
        checkIn: "2026-06-01T08:05:00+03:00",
        checkOut: "2026-06-01T16:10:00+03:00",
        source: "MANUAL",
        deviceRef: null,
        geoLat: null,
        geoLng: null,
        note: null,
        actorId: H_ACTOR,
      }),
    );
    expect(present.derivedStatus).toBe("PRESENT");
    expect(present.lateMinutes).toBe(0);
    expect(present.earlyLeaveMinutes).toBe(0);
    expect(present.workedMinutes).toBe(455);
    expect(present.overtimeMinutes).toBe(10);
    expect(present.isException).toBe(false);
    expect(present.shiftCode).toBe(f.dayShiftCode);

    // 2026-06-02, open session in 08:20 (past the 08:15 grace end):
    // MISSING_PUNCH (an unclosed session is an exception), late 5.
    const open = await withTenant(TENANT_H, () =>
      attendanceSvc.capture({
        employeeId: f.employeeA1Id,
        workDate: "2026-06-02",
        checkIn: "2026-06-02T08:20:00+03:00",
        checkOut: null,
        source: "MANUAL",
        deviceRef: null,
        geoLat: null,
        geoLng: null,
        note: null,
        actorId: H_ACTOR,
      }),
    );
    expect(open.derivedStatus).toBe("MISSING_PUNCH");
    expect(open.lateMinutes).toBe(5);
    expect(open.isException).toBe(true);

    // The one-shot checkout completes the session: 16:00 out → LATE 5,
    // worked 460 − 30 = 430, no overtime, no early leave.
    const closed = await withTenant(TENANT_H, () =>
      attendanceSvc.checkout(open.id, "2026-06-02T16:00:00+03:00", H_ACTOR),
    );
    expect(closed.derivedStatus).toBe("LATE");
    expect(closed.lateMinutes).toBe(5);
    expect(closed.workedMinutes).toBe(430);
    expect(closed.overtimeMinutes).toBe(0);
    expect(closed.earlyLeaveMinutes).toBe(0);
    expect(closed.isException).toBe(true);

    // BR-082: a SECOND checkout is the typed refusal — the committed
    // check-out is immutable; corrections arrive as NEW rows.
    await expect(
      withTenant(TENANT_H, () =>
        attendanceSvc.checkout(open.id, "2026-06-02T17:00:00+03:00", H_ACTOR),
      ),
    ).rejects.toMatchObject({ code: "ATTENDANCE_IMMUTABLE" });

    // 2026-06-03, in 08:00 → out 15:00: PRESENT with an early-leave
    // FACT (60) — a fact, never an exception (no invented threshold —
    // the BR-055 discipline).
    const early = await withTenant(TENANT_H, () =>
      attendanceSvc.capture({
        employeeId: f.employeeA1Id,
        workDate: "2026-06-03",
        checkIn: "2026-06-03T08:00:00+03:00",
        checkOut: "2026-06-03T15:00:00+03:00",
        source: "MANUAL",
        deviceRef: null,
        geoLat: null,
        geoLng: null,
        note: null,
        actorId: H_ACTOR,
      }),
    );
    expect(early.derivedStatus).toBe("PRESENT");
    expect(early.earlyLeaveMinutes).toBe(60);
    expect(early.workedMinutes).toBe(390);
    expect(early.isException).toBe(false);
  });

  it("(b) INV-031 + THE DEDUPE FLOOR + THE SHAPES — overlap refused, the same check-in refused, the envelope and the geo/device shapes typed", async () => {
    const f = spec.fixture!;

    // 2026-06-05, two non-overlapping sessions: 08:10→12:00 + 13:00→16:00
    // → PRESENT, worked (230 + 180) − 30 = 380.
    const morning = await withTenant(TENANT_H, () =>
      attendanceSvc.capture({
        employeeId: f.employeeA1Id,
        workDate: "2026-06-05",
        checkIn: "2026-06-05T08:10:00+03:00",
        checkOut: "2026-06-05T12:00:00+03:00",
        source: "MANUAL",
        deviceRef: null,
        geoLat: null,
        geoLng: null,
        note: null,
        actorId: H_ACTOR,
      }),
    );
    expect(morning.derivedStatus).toBe("PRESENT");
    await withTenant(TENANT_H, () =>
      attendanceSvc.capture({
        employeeId: f.employeeA1Id,
        workDate: "2026-06-05",
        checkIn: "2026-06-05T13:00:00+03:00",
        checkOut: "2026-06-05T16:00:00+03:00",
        source: "MANUAL",
        deviceRef: null,
        geoLat: null,
        geoLng: null,
        note: null,
        actorId: H_ACTOR,
      }),
    );
    const dayRows = await withTenant(TENANT_H, () => attendanceSvc.register("2026-06-05"));
    const a1Rows = dayRows.rows.filter((row) => row.employeeId === f.employeeA1Id);
    expect(a1Rows).toHaveLength(2);
    expect(a1Rows.every((row) => row.derivedStatus === "PRESENT")).toBe(true);
    expect(a1Rows.every((row) => row.workedMinutes === 380)).toBe(true);

    // The overlap: 11:00→14:00 crosses BOTH sessions — typed, before
    // any write (INV-031).
    await expect(
      withTenant(TENANT_H, () =>
        attendanceSvc.capture({
          employeeId: f.employeeA1Id,
          workDate: "2026-06-05",
          checkIn: "2026-06-05T11:00:00+03:00",
          checkOut: "2026-06-05T14:00:00+03:00",
          source: "MANUAL",
          deviceRef: null,
          geoLat: null,
          geoLng: null,
          note: null,
          actorId: H_ACTOR,
        }),
      ),
    ).rejects.toMatchObject({ code: "ATTENDANCE_SESSION_OVERLAP" });

    // The dedupe floor: the same employee + timestamp is ONE session.
    await expect(
      withTenant(TENANT_H, () =>
        attendanceSvc.capture({
          employeeId: f.employeeA1Id,
          workDate: "2026-06-05",
          checkIn: "2026-06-05T08:10:00+03:00",
          checkOut: null,
          source: "MANUAL",
          deviceRef: null,
          geoLat: null,
          geoLng: null,
          note: null,
          actorId: H_ACTOR,
        }),
      ),
    ).rejects.toMatchObject({ code: "ATTENDANCE_DUPLICATE_PUNCH" });

    // The punch envelope: a timestamp far from the operational day is
    // refused typed.
    await expect(
      withTenant(TENANT_H, () =>
        attendanceSvc.capture({
          employeeId: f.employeeA1Id,
          workDate: "2026-06-05",
          checkIn: "2026-06-20T08:00:00+03:00",
          checkOut: null,
          source: "MANUAL",
          deviceRef: null,
          geoLat: null,
          geoLng: null,
          note: null,
          actorId: H_ACTOR,
        }),
      ),
    ).rejects.toMatchObject({ code: "ATTENDANCE_RECORD_INVALID" });

    // checkOut before checkIn — the 0081 interval law, typed.
    await expect(
      withTenant(TENANT_H, () =>
        attendanceSvc.capture({
          employeeId: f.employeeA1Id,
          workDate: "2026-06-05",
          checkIn: "2026-06-05T14:00:00+03:00",
          checkOut: "2026-06-05T13:00:00+03:00",
          source: "MANUAL",
          deviceRef: null,
          geoLat: null,
          geoLng: null,
          note: null,
          actorId: H_ACTOR,
        }),
      ),
    ).rejects.toMatchObject({ code: "ATTENDANCE_RECORD_INVALID" });

    // The device shape: DEVICE requires its deviceRef; MANUAL carries none.
    await expect(
      withTenant(TENANT_H, () =>
        attendanceSvc.capture({
          employeeId: f.employeeA1Id,
          workDate: "2026-06-05",
          checkIn: "2026-06-05T08:00:00+03:00",
          checkOut: null,
          source: "DEVICE",
          deviceRef: null,
          geoLat: null,
          geoLng: null,
          note: null,
          actorId: H_ACTOR,
        }),
      ),
    ).rejects.toMatchObject({ code: "ATTENDANCE_RECORD_INVALID" });

    // The geo bounds, typed.
    await expect(
      withTenant(TENANT_H, () =>
        attendanceSvc.capture({
          employeeId: f.employeeA1Id,
          workDate: "2026-06-05",
          checkIn: "2026-06-05T08:00:00+03:00",
          checkOut: null,
          source: "MANUAL",
          deviceRef: null,
          geoLat: 999,
          geoLng: null,
          note: null,
          actorId: H_ACTOR,
        }),
      ),
    ).rejects.toMatchObject({ code: "ATTENDANCE_RECORD_INVALID" });

    // A DEVICE-source capture WITH its deviceRef is legal (geo too).
    const device = await withTenant(TENANT_H, () =>
      attendanceSvc.capture({
        employeeId: f.employeeA2Id,
        workDate: "2026-06-05",
        checkIn: "2026-06-05T08:00:00+03:00",
        checkOut: "2026-06-05T12:00:00+03:00",
        source: "DEVICE",
        deviceRef: "ZK-TECO-01",
        geoLat: 24.7136,
        geoLng: 46.6753,
        note: null,
        actorId: H_ACTOR,
      }),
    );
    expect(device.source).toBe("DEVICE");
    expect(device.deviceRef).toBe("ZK-TECO-01");
  });

  it("(c) THE STATUS FAMILY — HOLIDAY over the roster, ON_LEAVE over the roster, the NIGHT crossing (+1 day), unrostered punches, and the ABSENT synthesis (past only, rostered only)", async () => {
    const f = spec.fixture!;

    // HOLIDAY: 2026-06-06 is a tenant-jurisdiction holiday; punches
    // exist → the day is HOLIDAY (never late/absent) with the worked
    // facts still computed (T-06's holiday-tier overtime consumes them).
    const holiday = await withTenant(TENANT_H, () =>
      attendanceSvc.capture({
        employeeId: f.employeeA1Id,
        workDate: "2026-06-06",
        checkIn: "2026-06-06T08:00:00+03:00",
        checkOut: "2026-06-06T16:00:00+03:00",
        source: "MANUAL",
        deviceRef: null,
        geoLat: null,
        geoLng: null,
        note: null,
        actorId: H_ACTOR,
      }),
    );
    expect(holiday.derivedStatus).toBe("HOLIDAY");
    expect(holiday.lateMinutes).toBeNull();
    expect(holiday.workedMinutes).toBe(450);
    expect(holiday.isException).toBe(false);

    // ON_LEAVE: A2's APPROVED span covers 2026-06-07 — the punches
    // derive ON_LEAVE (late suppressed, worked kept).
    const leave = await withTenant(TENANT_H, () =>
      attendanceSvc.capture({
        employeeId: f.employeeA2Id,
        workDate: "2026-06-07",
        checkIn: "2026-06-07T08:00:00+03:00",
        checkOut: "2026-06-07T16:00:00+03:00",
        source: "MANUAL",
        deviceRef: null,
        geoLat: null,
        geoLng: null,
        note: null,
        actorId: H_ACTOR,
      }),
    );
    expect(leave.derivedStatus).toBe("ON_LEAVE");
    expect(leave.lateMinutes).toBeNull();
    expect(leave.workedMinutes).toBe(450);
    expect(leave.isException).toBe(false);

    // THE NIGHT CROSSING: 2026-06-09 rostered 22:00→06:00 (+1); in
    // 22:00 → out 06:10 next day → PRESENT, worked 490 − 45 = 445,
    // overtime 10 (past the +1-day shift end), the checkout INSIDE the
    // envelope (work_date or the day after).
    const night = await withTenant(TENANT_H, () =>
      attendanceSvc.capture({
        employeeId: f.employeeA1Id,
        workDate: "2026-06-09",
        checkIn: "2026-06-09T22:00:00+03:00",
        checkOut: "2026-06-10T06:10:00+03:00",
        source: "MANUAL",
        deviceRef: null,
        geoLat: null,
        geoLng: null,
        note: null,
        actorId: H_ACTOR,
      }),
    );
    expect(night.derivedStatus).toBe("PRESENT");
    expect(night.workedMinutes).toBe(445);
    expect(night.overtimeMinutes).toBe(10);
    expect(night.earlyLeaveMinutes).toBe(0);

    // Unrostered punches: 2026-06-04 has no roster cell — PRESENT with
    // the raw span and NO shift-relative facts (nothing to be late
    // against; no fabricated defaults).
    const unrostered = await withTenant(TENANT_H, () =>
      attendanceSvc.capture({
        employeeId: f.employeeA1Id,
        workDate: "2026-06-04",
        checkIn: "2026-06-04T09:00:00+03:00",
        checkOut: "2026-06-04T17:30:00+03:00",
        source: "MANUAL",
        deviceRef: null,
        geoLat: null,
        geoLng: null,
        note: null,
        actorId: H_ACTOR,
      }),
    );
    expect(unrostered.derivedStatus).toBe("PRESENT");
    expect(unrostered.workedMinutes).toBe(510);
    expect(unrostered.lateMinutes).toBeNull();
    expect(unrostered.overtimeMinutes).toBeNull();
    expect(unrostered.shiftCode).toBeNull();

    // THE ABSENT SYNTHESIS: 2026-06-08 is rostered, past, punchless —
    // the derivation run synthesizes exactly ONE marker row.
    const derived = await withTenant(TENANT_H, () =>
      attendanceSvc.deriveDays({
        from: "2026-06-01",
        to: "2026-06-10",
        employeeIds: [f.employeeA1Id, f.employeeA2Id],
        actorId: H_ACTOR,
      }),
    );
    expect(derived.absentSynthesized).toBe(1);
    // Every captured row already carried its verdict (the capture-time
    // derivation), so the run updated nothing else.
    expect(derived.rowsUpdated).toBe(0);
    const absentDay = await withTenant(TENANT_H, () => attendanceSvc.register("2026-06-08"));
    const marker = absentDay.rows.find((row) => row.employeeId === f.employeeA1Id);
    expect(marker).toBeDefined();
    expect(marker!.derivedStatus).toBe("ABSENT");
    expect(marker!.checkIn).toBeNull();
    expect(marker!.checkOut).toBeNull();
    expect(marker!.isException).toBe(true);
    expect(marker!.shiftCode).toBe(f.dayShiftCode);

    // A FUTURE rostered day is NEVER absent (it has not happened yet).
    const futureRun = await withTenant(TENANT_H, () =>
      attendanceSvc.deriveDays({
        from: f.futureDate,
        to: f.futureDate,
        employeeIds: [f.employeeA1Id],
        actorId: H_ACTOR,
      }),
    );
    expect(futureRun.absentSynthesized).toBe(0);
    const futureRegister = await withTenant(TENANT_H, () => attendanceSvc.register(f.futureDate));
    expect(futureRegister.rows.filter((row) => row.employeeId === f.employeeA1Id)).toHaveLength(0);
  });

  it("(d) THE READS + THE IDEMPOTENT RE-DERIVE — the register joins the dims; the exception board paginates (total + hasMore); a re-run writes NOTHING", async () => {
    const f = spec.fixture!;

    // The register: the day's rows joined with employee + shift dims.
    const register = await withTenant(TENANT_H, () => attendanceSvc.register("2026-06-01"));
    const a1 = register.rows.find((row) => row.employeeId === f.employeeA1Id);
    expect(a1).toBeDefined();
    expect(a1!.employeeCode).toBe("EMP-A1");
    expect(a1!.employeeName).toBe("Amine Al-Attendance");
    expect(a1!.derivedStatus).toBe("PRESENT");

    // The exception board (2026-06-01…10, both spec employees): the
    // LATE row (06-02) + the ABSENT marker (06-08) — 2 in total.
    const board = await withTenant(TENANT_H, () =>
      attendanceSvc.exceptions({
        from: "2026-06-01",
        to: "2026-06-10",
        employeeIds: [f.employeeA1Id, f.employeeA2Id],
      }),
    );
    expect(board.total).toBe(2);
    expect(board.hasMore).toBe(false);
    const statuses = board.rows.map((row) => row.derivedStatus).sort();
    expect(statuses).toEqual(["ABSENT", "LATE"]);

    // The pagination law: page 1 of size 1 carries hasMore=true; page
    // 2 retrieves the rest.
    const page1 = await withTenant(TENANT_H, () =>
      attendanceSvc.exceptions({
        from: "2026-06-01",
        to: "2026-06-10",
        employeeIds: [f.employeeA1Id, f.employeeA2Id],
        page: 1,
        pageSize: 1,
      }),
    );
    expect(page1.rows).toHaveLength(1);
    expect(page1.total).toBe(2);
    expect(page1.hasMore).toBe(true);
    const page2 = await withTenant(TENANT_H, () =>
      attendanceSvc.exceptions({
        from: "2026-06-01",
        to: "2026-06-10",
        employeeIds: [f.employeeA1Id, f.employeeA2Id],
        page: 2,
        pageSize: 1,
      }),
    );
    expect(page2.rows).toHaveLength(1);
    expect(page2.hasMore).toBe(false);
    expect(page1.rows[0]!.id).not.toBe(page2.rows[0]!.id);

    // THE IDEMPOTENT RE-DERIVE: nothing changes, nothing is written —
    // rowsUpdated 0, absentSynthesized 0 (the marker already exists),
    // and the punch fields of every row are UNTOUCHED (BR-082: the
    // derivation write is status-fields-only).
    const before = await withTenant(TENANT_H, () => attendanceSvc.register("2026-06-02"));
    const reDerived = await withTenant(TENANT_H, () =>
      attendanceSvc.deriveDays({
        from: "2026-06-01",
        to: "2026-06-10",
        employeeIds: [f.employeeA1Id, f.employeeA2Id],
        actorId: H_ACTOR,
      }),
    );
    expect(reDerived.rowsUpdated).toBe(0);
    expect(reDerived.absentSynthesized).toBe(0);
    const after = await withTenant(TENANT_H, () => attendanceSvc.register("2026-06-02"));
    expect(after.rows.map((row) => `${row.id}|${row.checkIn}|${row.checkOut}`)).toEqual(
      before.rows.map((row) => `${row.id}|${row.checkIn}|${row.checkOut}`),
    );

    // The derive-input laws: the inverted range, the too-wide range,
    // and the case-varied duplicate employeeIds (the c537113 case law)
    // are all typed refusals.
    await expect(
      withTenant(TENANT_H, () =>
        attendanceSvc.deriveDays({ from: "2026-06-10", to: "2026-06-01", actorId: H_ACTOR }),
      ),
    ).rejects.toMatchObject({ code: "ATTENDANCE_RECORD_INVALID" });
    await expect(
      withTenant(TENANT_H, () =>
        attendanceSvc.deriveDays({ from: "2026-01-01", to: "2026-12-31", actorId: H_ACTOR }),
      ),
    ).rejects.toMatchObject({ code: "ATTENDANCE_RECORD_INVALID" });
    await expect(
      withTenant(TENANT_H, () =>
        attendanceSvc.deriveDays({
          from: "2026-06-01",
          to: "2026-06-10",
          employeeIds: [f.employeeA1Id, f.employeeA1Id.toUpperCase()],
          actorId: H_ACTOR,
        }),
      ),
    ).rejects.toMatchObject({ code: "ATTENDANCE_RECORD_INVALID" });
  });

  it("(e) THE TENANT BOUNDARY — the empty boundary tenant sees nothing; a foreign employee id is the A7 typed not-found", async () => {
    const f = spec.fixture!;

    const foreignRegister = await withTenant(TENANT_H_RLS, () => attendanceSvc.register("2026-06-01"));
    expect(foreignRegister.rows).toHaveLength(0);

    const foreignBoard = await withTenant(TENANT_H_RLS, () =>
      attendanceSvc.exceptions({ from: "2026-06-01", to: "2026-06-10" }),
    );
    expect(foreignBoard.total).toBe(0);

    const foreignDerive = await withTenant(TENANT_H_RLS, () =>
      attendanceSvc.deriveDays({ from: "2026-06-01", to: "2026-06-10", actorId: null }),
    );
    expect(foreignDerive.absentSynthesized).toBe(0);

    // A7: tenant H's employee is invisible under the boundary tenant's
    // RLS — the typed not-found, identical for unknown-vs-foreign.
    await expect(
      withTenant(TENANT_H_RLS, () =>
        attendanceSvc.capture({
          employeeId: f.employeeA1Id,
          workDate: "2026-06-05",
          checkIn: "2026-06-05T08:00:00+03:00",
          checkOut: null,
          source: "MANUAL",
          deviceRef: null,
          geoLat: null,
          geoLng: null,
          note: null,
          actorId: H_ACTOR,
        }),
      ),
    ).rejects.toMatchObject({ code: "HR_EMPLOYEE_NOT_FOUND" });

    // The derived-absence marker checkout guard (BR-082): a marker
    // carries no session — nothing to close.
    const tenantHBoard = await withTenant(TENANT_H, () =>
      attendanceSvc.exceptions({
        from: "2026-06-08",
        to: "2026-06-08",
        employeeIds: [f.employeeA1Id],
      }),
    );
    const markerRow = tenantHBoard.rows[0]!;
    expect(markerRow.derivedStatus).toBe("ABSENT");
    await expect(
      withTenant(TENANT_H, () => attendanceSvc.checkout(markerRow.id, "2026-06-08T16:00:00+03:00", H_ACTOR)),
    ).rejects.toMatchObject({ code: "ATTENDANCE_IMMUTABLE" });
  });
});
