import { beforeAll, describe, expect, it } from "vitest";
import { sql } from "drizzle-orm";

import {
  P_ACTOR,
  P_APPROVER,
  calculation,
  employees,
  periods,
  runPosting,
  setupPayrollFixture,
  su,
  withTenant,
  workflow,
} from "./fixtures";
import { AuditService } from "../../modules/audit/api/audit";
import { DrizzleAuditStore } from "../../modules/audit/infrastructure/drizzle-audit.store";
import { AttendanceService } from "../../modules/hr/application/attendance-service";
import { LeaveService } from "../../modules/hr/application/leave-service";
import { OvertimeService } from "../../modules/hr/application/overtime-service";
import { ShiftService } from "../../modules/hr/application/shift-service";
import { StructureService } from "../../modules/payroll/application/structure-service";
import * as payrollStore from "../../modules/payroll/infrastructure/payroll.store";

/**
 * PHASE-046 (W-3, T-07) — THE VARIABLE-LINE FEED BOUNDARY (§4's
 * variable-lines matrix): the run reads the feed ONCE through the
 * service boundary (the 045 handoff contract — the registers are NEVER
 * read ad hoc, never written by payroll; the NEGATIVE LEDGER PROOF: the
 * hr registers' digests byte-identical through the full run cycle),
 * with the §4 worked numbers on the REAL hr services (the feed.spec
 * pattern — real overtime entries, real derivation verdicts, real
 * balance cells):
 *
 *   OVERTIME   4.50 multipliedHours (3.00h × 1.5×) — UNPRICED while the
 *              tenant divisor is unset (the explicit warning, zero
 *              fabricated rate), 168.7500 once
 *              payroll.variable.overtime_hours_per_day = 8 (basic
 *              9,000/30/8 = 37.5000);
 *   ABSENCE    2 ABSENT days — OFF by default (the fact recorded,
 *              nothing docked), 2 × 300.0000 = 600.0000 when ON;
 *   LATE       60 minutes — gated, 60 × 0.6250 = 37.5000 when ON (the
 *              same divisor);
 *   MISSING_PUNCH  1 day — INFORMATIONAL ONLY (its own count, never
 *              folded — the T-10 law);
 *   THE LEAVE SNAPSHOT rides the breakdown read-only — the run NEVER
 *              encashes (G-51 untouched; used_days unchanged; the
 *              existing hr/leave-posting spec stays the pin);
 *   THE NO-PROFILE STATE (D-07): this tenant carries NO statutory rows
 *              — zero statutory lines + the explicit run-level note
 *              (never a fabricated rate).
 *
 * BR-086: the run is the ONLY financial writer — the registers' digests
 * and the tenant's journal census prove it (one payroll_run journal,
 * zero leave_encashment journals).
 *
 * Isolation — THE DEDICATED TENANT (the T-20/eosb/run-statutory
 * precedent): tenant VAR carries its own CoA + FY2026 + the hr facts,
 * never the shared worlds' registers.
 */

const TENANT_VAR = "8d8d8d8d-8d8d-8d8d-8d8d-8d8d8d8d8d8d";

const audit = new AuditService(new DrizzleAuditStore());
const structures = new StructureService(audit);
const overtimeSvc = new OvertimeService(audit);
const attendanceSvc = new AttendanceService(audit);
const leaveSvc = new LeaveService(audit);
const shiftSvc = new ShiftService(audit);

interface VarWorld {
  structureId: string;
  periodIds: Record<string, string>;
  salariesExpenseAccountId: string;
  salariesPayableAccountId: string;
  employeeId: string;
}

let world: VarWorld;

/** Set a TENANT_VAR setting (the fixtures' setSetting is PAY-scoped). */
async function setVarSetting(key: string, value: unknown): Promise<void> {
  const client = await su();
  await client.query(
    `INSERT INTO tenant_settings (id, tenant_id, key, value) VALUES
       (gen_random_uuid(), $1, $2, $3::jsonb)
     ON CONFLICT (tenant_id, key) DO UPDATE SET value = EXCLUDED.value`,
    [TENANT_VAR, key, JSON.stringify(value)],
  );
  await client.end();
}

/** The registers' digest — the NEGATIVE LEDGER PROOF's fingerprint
 *  (count + md5 over the ordered whole-row text; deterministic). */
async function registersDigest(): Promise<string> {
  const client = await su();
  const result = await client.query<{ digest: string }>(
    `SELECT md5(concat_ws('|',
      (SELECT count(*)::text || ':' || coalesce(md5(string_agg(t::text, ',' ORDER BY t.id)), '') FROM overtime_entries t WHERE tenant_id = $1),
      (SELECT count(*)::text || ':' || coalesce(md5(string_agg(t::text, ',' ORDER BY t.id)), '') FROM attendance_records t WHERE tenant_id = $1),
      (SELECT count(*)::text || ':' || coalesce(md5(string_agg(t::text, ',' ORDER BY t.id)), '') FROM leave_balances t WHERE tenant_id = $1),
      (SELECT count(*)::text || ':' || coalesce(md5(string_agg(t::text, ',' ORDER BY t.id)), '') FROM leave_requests t WHERE tenant_id = $1)
    )) AS digest`,
    [TENANT_VAR],
  );
  await client.end();
  return result.rows[0]!.digest;
}

beforeAll(async () => {
  await setupPayrollFixture(); // the DB harness + the shared services
  const client = await su();
  await client.query(
    `INSERT INTO tenants (id, name, name_ar, base_currency, country_code, timezone) VALUES
       ($1, 'Tenant VAR (046 variable lines)', 'المستأجر للخطوط المتغيرة', 'SAR', 'SA', 'Asia/Riyadh')
     ON CONFLICT (id) DO NOTHING`,
    [TENANT_VAR],
  );
  await client.end();

  world = await withTenant(TENANT_VAR, async () => {
    const tenancy = await import("../../modules/tenancy/infrastructure/tenancy.store");
    const accounting = await import("../../modules/accounting/infrastructure/accounting.store");
    const treasury = await import("../../modules/treasury/infrastructure/treasury.store");
    await tenancy.seedMasterDataBasics();
    await tenancy.provisionCoaTemplate();
    const byPurpose = async (key: string): Promise<string> => {
      const mapping = await accounting.findActivePurpose(key);
      if (mapping === undefined) throw new Error(`purpose ${key} unmapped`);
      return mapping.accountId;
    };

    // ST-VAR — the basic-only structure (no components: gross = basic).
    const existing = await structures.list(50);
    const structure =
      existing.find((row) => row.code === "ST-VAR") ??
      (await structures.create({
        code: "ST-VAR",
        name: "Variable spec structure (basic-only)",
        nameAr: null,
        actorId: P_ACTOR,
      }));

    const year = await periods.createYear(P_ACTOR, {
      name: "FY2026",
      startDate: "2026-01-01",
      endDate: "2026-12-31",
    });
    const periodIds: Record<string, string> = {};
    for (const period of await accounting.listPeriods(year.id)) {
      if (period.kind === "REGULAR") periodIds[period.name] = period.id;
    }
    const byCode = async (code: string): Promise<string> => {
      const account = await accounting.findAccountByCode(code);
      if (account === undefined) throw new Error(`account ${code} missing`);
      return account.id;
    };
    await treasury.insertCashAccount({
      name: "Var Bank",
      nameAr: "بنك الخطوط المتغيرة",
      type: "BANK",
      accountId: await byCode("1121"),
      branchId: null,
      currencyCode: "SAR",
      createdBy: P_ACTOR,
    });

    // V-EE — the spec's employee (basic 9,000 — the §4 worked number).
    const list = await employees.list({ limit: 100 });
    const employee =
      list.find((row) => row.code === "EMP-VAR-001") ??
      (await employees.create({
        code: "EMP-VAR-001",
        name: "Variable Employee",
        nameAr: "موظف الخطوط المتغيرة",
        nationality: "SA",
        hireDate: "2024-01-01",
        contractType: "FULL_TIME",
        basicSalary: "9000.0000",
        salaryStructureId: structure.id,
        actorId: P_ACTOR,
      }));

    return {
      employeeId: employee.id,
      structureId: structure.id,
      periodIds,
      salariesExpenseAccountId: await byPurpose("SALARIES_EXPENSE"),
      salariesPayableAccountId: await byPurpose("SALARIES_PAYABLE"),
    };
  });

  // ---- the hr facts, through the REAL services, ONE WRITER PER UoW ----
  // (the T-20 no-expansion law: one transaction may not expand its lock
  // set backwards — the feed.spec per-call withTenant shape IS the
  // production shape; batching the writers into one UoW is exactly the
  // shape the floor refuses).
  // Overtime: 3.00h on a 1.5× post-hoc rule (PENDING feeds — BR-084) ⇒
  // totalMultipliedHours 4.50.
  const rule = await withTenant(TENANT_VAR, () =>
    overtimeSvc.createRule({
      code: "OT-VAR-15",
      name: "Variable spec overtime 1.5x",
      nameAr: "إضافي مواصفة الخطوط ١٫٥×",
      tier: "WEEKDAY",
      multiplier: "1.50",
      preApprovalRequired: false,
      maxHoursPerDay: "8.00",
      note: null,
      noteAr: null,
      actorId: P_ACTOR,
    }),
  );
  await withTenant(TENANT_VAR, () =>
    overtimeSvc.createEntry({
      employeeId: world.employeeId,
      workDate: "2026-03-10",
      hours: "3.00",
      ruleId: rule.id,
      note: null,
      actorId: P_ACTOR,
    }),
  );

  // Attendance: 03-02 LATE 60 (in 09:15 — 60 past the 08:15 grace
  // boundary; the derivation's law: late = firstIn − (start + grace));
  // 03-03 + 03-04 punchless ⇒ 2 ABSENT days; 03-05 open session ⇒
  // 1 MISSING_PUNCH day (informational only, never an absence).
  const shift = await withTenant(TENANT_VAR, () =>
    shiftSvc.create({
      code: "SHIFT-VAR",
      name: "Variable spec day shift 08:00-16:00",
      nameAr: "وردية مواصفة الخطوط ٠٨:٠٠-١٦:٠٠",
      startTime: "08:00",
      endTime: "16:00",
      graceMinutes: 15,
      breakMinutes: 30,
      isNight: false,
      note: null,
      noteAr: null,
      actorId: P_ACTOR,
    }),
  );
  for (const day of ["2026-03-02", "2026-03-03", "2026-03-04", "2026-03-05"]) {
    await withTenant(TENANT_VAR, () =>
      shiftSvc.setRosterCell({
        employeeId: world.employeeId,
        workDate: day,
        shiftId: shift.id,
        note: null,
        actorId: P_ACTOR,
      }),
    );
  }
  await withTenant(TENANT_VAR, () =>
    attendanceSvc.capture({
      employeeId: world.employeeId,
      workDate: "2026-03-02",
      checkIn: "2026-03-02T09:15:00+03:00",
      checkOut: "2026-03-02T16:00:00+03:00",
      source: "MANUAL",
      deviceRef: null,
      geoLat: null,
      geoLng: null,
      note: null,
      actorId: P_ACTOR,
    }),
  );
  await withTenant(TENANT_VAR, () =>
    attendanceSvc.capture({
      employeeId: world.employeeId,
      workDate: "2026-03-05",
      checkIn: "2026-03-05T08:05:00+03:00",
      checkOut: null,
      source: "MANUAL",
      deviceRef: null,
      geoLat: null,
      geoLng: null,
      note: null,
      actorId: P_ACTOR,
    }),
  );
  await withTenant(TENANT_VAR, () =>
    attendanceSvc.deriveDays({
      from: "2026-03-01",
      to: "2026-03-31",
      employeeIds: [world.employeeId],
      actorId: P_ACTOR,
    }),
  );

  // Leave: one type + the 2026 accrual (the snapshot cell — the run
  // reads it into the breakdown and NEVER encashes it).
  const leaveType = await withTenant(TENANT_VAR, () =>
    leaveSvc.createType({
      code: "LV-VAR",
      name: "Variable spec annual leave",
      nameAr: "إجازة سنوية (مواصفة الخطوط)",
      paid: true,
      accrualDaysPerYear: "20.00",
      monthlyGrant: false,
      prorateJoiners: true,
      carryOverCapDays: "5.00",
      note: null,
      noteAr: null,
      actorId: P_ACTOR,
    }),
  );
  await withTenant(TENANT_VAR, () =>
    leaveSvc.runAccrual({ leaveTypeId: leaveType.id, year: 2026, actorId: P_ACTOR }),
  );
});

describe("PHASE-046 W-3 T-07 — the variable lines: the feed boundary, the pricing laws, the no-profile state", () => {
  let runId = "";
  let digestBeforeRun = "";

  it("(a) THE FEED BOUNDARY + THE UNPRICED STATE + THE NO-PROFILE STATE — the facts land, nothing is fabricated, the registers are untouched", async () => {
    digestBeforeRun = await registersDigest();

    await withTenant(TENANT_VAR, async () => {
      const run = await calculation.createRun({
        fiscalPeriodId: world.periodIds["FY2026-03"]!,
        actorId: P_ACTOR,
      });
      runId = run.id;
      const calculated = await calculation.calculate(run.id, { actorId: P_ACTOR });

      // THE NO-PROFILE STATE (D-07): this tenant carries NO statutory
      // rows — zero statutory lines + the explicit run-level note.
      expect(calculated.warnings.noStatutoryProfile).toEqual([{ jurisdictionCode: "SA" }]);
      expect(calculated.warnings.unpricedNationality).toHaveLength(0);
      expect(calculated.run.statutoryEmployeeTotal).toBe("0.0000");
      expect(calculated.run.statutoryEmployerTotal).toBe("0.0000");
      expect(calculated.run.pitTotal).toBe("0.0000");
      expect(calculated.run.statutorySummary).toEqual([]);

      // THE UNPRICED OVERTIME STATE (D-08): the divisor is unset — the
      // fact lands, the amount stays 0.0000, the explicit warning fires.
      expect(calculated.warnings.variable.unpricedOvertime).toHaveLength(1);
      expect(calculated.warnings.variable.unpricedOvertime[0]).toMatchObject({
        employeeCode: "EMP-VAR-001",
        multipliedHours: "4.50",
      });
      // The gates are OFF by default: absence/late facts recorded, no dock.
      expect(calculated.warnings.variable.unpricedLate).toHaveLength(0);
      expect(calculated.warnings.variable.variableClamps).toHaveLength(0);

      expect(calculated.lines).toHaveLength(1);
      const line = calculated.lines[0]!;
      const breakdown = line.variableBreakdown;
      expect(breakdown.multipliedHours).toBe("4.50");
      expect(breakdown.overtimeHourlyRate).toBeNull();
      expect(breakdown.overtimeAmount).toBe("0.0000");
      expect(breakdown.absenceDays).toBe(2);
      expect(breakdown.absenceDailyRate).toBeNull();
      expect(breakdown.absenceAmount).toBe("0.0000");
      expect(breakdown.lateMinutes).toBe(60);
      expect(breakdown.lateRatePerMinute).toBeNull();
      expect(breakdown.lateAmount).toBe("0.0000");
      expect(breakdown.missingPunchDays).toBe(1); // informational only
      // The leave snapshot rides the breakdown read-only (the accrual
      // cell — 2026's entitlement; used 0).
      expect(breakdown.leaveBalances.length).toBeGreaterThanOrEqual(1);
      expect(breakdown.leaveBalances[0]!.usedDays).toBe("0.00");

      // The INV-025 fold with everything unpriced/off: gross = basic.
      expect(calculated.run.grossTotal).toBe("9000.0000");
      expect(calculated.run.deductionsTotal).toBe("0.0000");
      expect(calculated.run.netTotal).toBe("9000.0000");
    });

    // THE NEGATIVE LEDGER PROOF (BR-086): the registers are untouched.
    expect(await registersDigest()).toBe(digestBeforeRun);
  });

  it("(b) THE PRICED OVERTIME — the divisor set ⇒ 4.50 × 37.5000 = 168.7500 earning; the registers STILL untouched", async () => {
    await setVarSetting("payroll.variable.overtime_hours_per_day", 8);
    await withTenant(TENANT_VAR, async () => {
      const calculated = await calculation.calculate(runId, { actorId: P_ACTOR });
      expect(calculated.warnings.variable.unpricedOvertime).toHaveLength(0);
      const line = calculated.lines[0]!;
      expect(line.variableBreakdown.overtimeHourlyRate).toBe("37.5000");
      expect(line.variableOvertimeAmount).toBe("168.7500");
      expect(calculated.run.variableOvertimeTotal).toBe("168.7500");
      // The earning rides the gross (the INV-025 fold).
      expect(calculated.run.grossTotal).toBe("9168.7500");
      expect(calculated.run.netTotal).toBe("9168.7500");
    });
    expect(await registersDigest()).toBe(digestBeforeRun);
  });

  it("(c) THE GATED DEDUCTIONS — absence ON ⇒ 2 × 300.0000; late ON ⇒ 60 × 0.6250; MISSING_PUNCH never docks", async () => {
    await setVarSetting("payroll.variable.absence_deduction", "on");
    await withTenant(TENANT_VAR, async () => {
      const calculated = await calculation.calculate(runId, { actorId: P_ACTOR });
      const line = calculated.lines[0]!;
      expect(line.variableBreakdown.absenceDailyRate).toBe("300.0000");
      expect(line.variableAbsenceAmount).toBe("600.0000");
      expect(line.variableBreakdown.lateAmount).toBe("0.0000"); // late still off
      expect(calculated.run.deductionsTotal).toBe("600.0000");
      expect(calculated.run.netTotal).toBe("8568.7500");
    });

    await setVarSetting("payroll.variable.late_deduction", "on");
    await withTenant(TENANT_VAR, async () => {
      const calculated = await calculation.calculate(runId, { actorId: P_ACTOR });
      const line = calculated.lines[0]!;
      expect(line.variableBreakdown.lateRatePerMinute).toBe("0.6250");
      expect(line.variableLateAmount).toBe("37.5000");
      // MISSING_PUNCH (1 day) NEVER docks — only the 2 ABSENT days did.
      expect(line.variableBreakdown.missingPunchDays).toBe(1);
      expect(line.variableAbsenceAmount).toBe("600.0000");
      expect(calculated.run.variableAbsenceTotal).toBe("600.0000");
      expect(calculated.run.variableLateTotal).toBe("37.5000");
      expect(calculated.run.deductionsTotal).toBe("637.5000");
      expect(calculated.run.grossTotal).toBe("9168.7500");
      expect(calculated.run.netTotal).toBe("8531.2500");
    });
    expect(await registersDigest()).toBe(digestBeforeRun);
  });

  it("(d) THE POST — DR SALARIES 9,168.7500 · CR the dock release 637.5000 · CR SALARIES_PAYABLE 8,531.2500 (balanced)", async () => {
    await withTenant(TENANT_VAR, async () => {
      await workflow.submit(runId, P_ACTOR);
      await workflow.approve(runId, P_APPROVER);
      const posted = await runPosting.post(runId, P_ACTOR);
      expect(posted.status).toBe("POSTED");

      const { listLines } = await import("../../modules/accounting/infrastructure/journal.store");
      const lines = await listLines(posted.journalEntryId!);
      const sum = (direction: string): string =>
        lines
          .filter((row) => row.direction === direction)
          .reduce((acc, row) => (Number(acc) + Number(row.amount)).toFixed(4), "0.0000");
      expect(sum("DEBIT")).toBe("9168.7500");
      expect(sum("CREDIT")).toBe("9168.7500");

      const salariesLegs = lines.filter(
        (row) => row.accountId === world.salariesExpenseAccountId,
      );
      expect(salariesLegs.find((row) => row.direction === "DEBIT")!.amount).toBe("9168.7500");
      // The earned-less release (the G-54 release-mirror precedent).
      expect(salariesLegs.find((row) => row.direction === "CREDIT")!.amount).toBe("637.5000");
      expect(
        lines.find(
          (row) => row.accountId === world.salariesPayableAccountId && row.direction === "CREDIT",
        )!.amount,
      ).toBe("8531.2500");
    });
    // The registers survived the full run cycle byte-identical.
    expect(await registersDigest()).toBe(digestBeforeRun);
  });

  it("(e) THE ENCASHMENT NON-INVENTION (G-51 untouched) + BR-086 — the leave registers unwritten, the run the ONLY financial writer", async () => {
    await withTenant(TENANT_VAR, async () => {
      // The balance cell still carries used 0 — the run NEVER encashes.
      const cell = await payrollStore.requireAmbientTx().execute<{
        used_days: string;
      }>(sql`SELECT used_days::text FROM leave_balances WHERE employee_id = ${world.employeeId}`);
      expect(cell.rows[0]!.used_days).toBe("0.00");

      // The tenant's journal census: exactly ONE journal — the run's
      // (no encashment, no accrual posting, nothing outside the run).
      const census = await payrollStore.requireAmbientTx().execute<{
        total: string;
        runs: string;
        encashments: string;
      }>(sql`
        SELECT count(*)::text AS total,
               count(*) FILTER (WHERE source_type = 'payroll_run')::text AS runs,
               count(*) FILTER (WHERE source_type = 'leave_encashment')::text AS encashments
        FROM journal_entries
      `);
      expect(census.rows[0]).toMatchObject({ total: "1", runs: "1", encashments: "0" });
    });
    // The leave registers' digest one last time (the whole spec's proof).
    expect(await registersDigest()).toBe(digestBeforeRun);
  });
});
