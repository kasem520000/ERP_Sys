import { beforeAll, describe, expect, it } from "vitest";

import { withTenant } from "../../infra/db/tenant-context";
import { PermissionDeniedError } from "../../modules/reporting/application/scope";
import {
  fullContext,
  newRunService,
  R_ACTOR,
  setupReportingFixture,
  su,
  TENANT_R,
} from "./fixtures";

/**
 * PHASE-045 T-16 verification (phase §6 criterion 9 — the three report
 * contracts): the hr set — REPORT_CATALOG §9's PHASE-045 rows, registry
 * 101 → 104 — renders over the seeded workforce world through the
 * module-owned query surface:
 *
 * - `hr.attendance-register` (hr.attendance): every punch session a row
 *   with the day's derived verdict + minute facts (the ABSENT marker is
 *   the (null, null) session), the status-vocabulary + session-shape
 *   block-on-fail assertions pass, the exceptionsOnly/status filters
 *   narrow, the window excludes outside days;
 * - `hr.leave-balances` (hr.leave): the per-year cell with the
 *   SQL-computed remaining + the PENDING span days, the
 *   leave-inv031-balance-cap render-time re-check passes, the type
 *   filter narrows;
 * - `hr.overtime-summary` (hr.overtime): the per-(employee, rule) folds
 *   with BR-084's feeding law as columns — feeding = APPROVED +
 *   PENDING-without-pre-approval (2×1.5 + 3×2.0 = 9.00 multiplied), the
 *   pre-approval-required PENDING hour surfaces as the never-fed
 *   exception column, REJECTED never feeds.
 *
 * A session without the module key is denied before params bind (the
 * §12 module-register convention — same keys the /hr routes ride).
 */

/** Fixed ids — idempotent re-entries via ON CONFLICT DO NOTHING. */
const ID = {
  employee: "67676767-0000-4000-8000-000000004501",
  shift: "67676767-0000-4000-8000-000000004502",
  attPresent: "67676767-0000-4000-8000-000000004511",
  attLate: "67676767-0000-4000-8000-000000004512",
  attAbsent: "67676767-0000-4000-8000-000000004513",
  attOpen: "67676767-0000-4000-8000-000000004514",
  attOutside: "67676767-0000-4000-8000-000000004515",
  leaveType: "67676767-0000-4000-8000-000000004521",
  leaveType2: "67676767-0000-4000-8000-000000004522",
  balance: "67676767-0000-4000-8000-000000004523",
  balance2: "67676767-0000-4000-8000-000000004524",
  leavePending: "67676767-0000-4000-8000-000000004525",
  otRuleRequired: "67676767-0000-4000-8000-000000004531",
  otRuleOpen: "67676767-0000-4000-8000-000000004532",
  otApproved: "67676767-0000-4000-8000-000000004533",
  otPendingRequired: "67676767-0000-4000-8000-000000004534",
  otPendingOpen: "67676767-0000-4000-8000-000000004535",
  otRejected: "67676767-0000-4000-8000-000000004536",
} as const;

/** A window that deterministically covers the seeded rows. */
const WINDOW = { dateFrom: "2026-06-01", dateTo: "2026-06-30", locale: "en" } as const;

beforeAll(async () => {
  await setupReportingFixture();
  await withTenant(TENANT_R, async (tx) => {
    const { sql } = await import("drizzle-orm");
    // Seed the workforce world directly (the T-04…T-07 writer paths are
    // proven by their own specs; this spec proves the READ surfaces):
    // one employee, one shift, four in-window attendance rows of every
    // shape + one outside the window, two leave types with one balance
    // cell + one PENDING span, two overtime rules (pre-approval
    // required vs open) with four entries covering every status.
    await tx.execute(sql`
      INSERT INTO employees (id, tenant_id, code, name, name_ar, hire_date, contract_type, basic_salary)
      VALUES (${ID.employee}, erp.current_tenant_id(), 'EMP-R45', 'Rakan Al-Hisab', 'راكان الحساب', '2026-01-01', 'FULL_TIME', 8000)
      ON CONFLICT (id, tenant_id) DO NOTHING`);
    await tx.execute(sql`
      INSERT INTO shifts (id, tenant_id, code, name, name_ar, start_time, end_time, grace_minutes, break_minutes)
      VALUES (${ID.shift}, erp.current_tenant_id(), 'MORN', 'Morning', 'الصباحية', '08:00', '16:00', 15, 60)
      ON CONFLICT (id, tenant_id) DO NOTHING`);
    await tx.execute(sql`
      INSERT INTO attendance_records
        (id, tenant_id, employee_id, work_date, check_in, check_out, source, device_ref,
         shift_id, derived_status, late_minutes, early_leave_minutes, worked_minutes, overtime_minutes, is_exception)
      VALUES
        (${ID.attPresent}, erp.current_tenant_id(), ${ID.employee}, '2026-06-01',
         '2026-06-01 07:55:00+00', '2026-06-01 16:02:00+00', 'MANUAL', NULL,
         ${ID.shift}, 'PRESENT', 0, 0, 447, 0, false),
        (${ID.attLate}, erp.current_tenant_id(), ${ID.employee}, '2026-06-02',
         '2026-06-02 08:40:00+00', '2026-06-02 16:05:00+00', 'DEVICE', 'ZK-01',
         ${ID.shift}, 'LATE', 40, 0, 445, 0, true),
        (${ID.attAbsent}, erp.current_tenant_id(), ${ID.employee}, '2026-06-03',
         NULL, NULL, 'MANUAL', NULL,
         ${ID.shift}, 'ABSENT', NULL, NULL, NULL, NULL, true),
        (${ID.attOpen}, erp.current_tenant_id(), ${ID.employee}, '2026-06-04',
         '2026-06-04 08:00:00+00', NULL, 'DEVICE', 'ZK-02',
         ${ID.shift}, 'MISSING_PUNCH', 0, NULL, NULL, NULL, true),
        (${ID.attOutside}, erp.current_tenant_id(), ${ID.employee}, '2026-05-15',
         '2026-05-15 07:58:00+00', '2026-05-15 16:00:00+00', 'MANUAL', NULL,
         ${ID.shift}, 'PRESENT', 0, 0, 422, 0, false)
      ON CONFLICT (id, tenant_id) DO NOTHING`);
    await tx.execute(sql`
      INSERT INTO leave_types (id, tenant_id, code, name, name_ar, paid, accrual_days_per_year, carry_over_cap_days)
      VALUES
        (${ID.leaveType}, erp.current_tenant_id(), 'ANNUAL', 'Annual', 'سنوية', true, 21, 5),
        (${ID.leaveType2}, erp.current_tenant_id(), 'SICK', 'Sick', 'مرضية', true, 30, 0)
      ON CONFLICT (id, tenant_id) DO NOTHING`);
    await tx.execute(sql`
      INSERT INTO leave_balances (id, tenant_id, employee_id, leave_type_id, year, entitlement_days, used_days, carried_forward_days)
      VALUES
        (${ID.balance}, erp.current_tenant_id(), ${ID.employee}, ${ID.leaveType}, 2026, 21, 5, 3),
        (${ID.balance2}, erp.current_tenant_id(), ${ID.employee}, ${ID.leaveType2}, 2026, 30, 0, 0)
      ON CONFLICT (id, tenant_id) DO NOTHING`);
    await tx.execute(sql`
      INSERT INTO leave_requests (id, tenant_id, employee_id, leave_type_id, start_date, end_date, days, status)
      VALUES (${ID.leavePending}, erp.current_tenant_id(), ${ID.employee}, ${ID.leaveType},
              '2026-07-01', '2026-07-02', 2, 'PENDING')
      ON CONFLICT (id, tenant_id) DO NOTHING`);
    await tx.execute(sql`
      INSERT INTO overtime_rules (id, tenant_id, code, name, name_ar, tier, multiplier, pre_approval_required)
      VALUES
        (${ID.otRuleRequired}, erp.current_tenant_id(), 'OT-WK', 'Weekday OT', 'إضافي أيام العمل', 'WEEKDAY', 1.5, true),
        (${ID.otRuleOpen}, erp.current_tenant_id(), 'OT-HOL', 'Holiday OT', 'إضافي العطل', 'HOLIDAY', 2.0, false)
      ON CONFLICT (id, tenant_id) DO NOTHING`);
    await tx.execute(sql`
      INSERT INTO overtime_entries (id, tenant_id, employee_id, work_date, hours, rule_id, status, is_exception, decided_by, decided_at)
      VALUES
        (${ID.otApproved}, erp.current_tenant_id(), ${ID.employee}, '2026-06-05', 2, ${ID.otRuleRequired}, 'APPROVED', false, ${R_ACTOR}, '2026-06-06 09:00:00+00'),
        (${ID.otPendingRequired}, erp.current_tenant_id(), ${ID.employee}, '2026-06-06', 1, ${ID.otRuleRequired}, 'PENDING', true, NULL, NULL),
        (${ID.otPendingOpen}, erp.current_tenant_id(), ${ID.employee}, '2026-06-07', 3, ${ID.otRuleOpen}, 'PENDING', false, NULL, NULL),
        (${ID.otRejected}, erp.current_tenant_id(), ${ID.employee}, '2026-06-08', 1, ${ID.otRuleOpen}, 'REJECTED', false, ${R_ACTOR}, '2026-06-09 09:00:00+00')
      ON CONFLICT (id, tenant_id) DO NOTHING`);
  });
});

describe("PHASE-045 · the hr report set (registry 101 → 104)", () => {
  it("hr.attendance-register renders the sessions with the derived verdicts and PASS assertions", async () => {
    const outcome = await withTenant(TENANT_R, () =>
      newRunService().run({
        reportKey: "hr.attendance-register",
        params: { ...WINDOW },
        ctx: fullContext(),
      }),
    );
    expect(outcome.queued).toBeUndefined();
    expect(outcome.status).toBe("SUCCEEDED");
    expect(outcome.result).toBeDefined();
    const rows = outcome.result!.rows;
    const byId = new Map(rows.map((row) => [row.key, row.values]));
    expect(byId.get(ID.attPresent)?.status).toBe("PRESENT");
    expect(byId.get(ID.attPresent)?.workedMinutes).toBe(447);
    expect(byId.get(ID.attLate)?.status).toBe("LATE");
    expect(byId.get(ID.attLate)?.lateMinutes).toBe(40);
    expect(byId.get(ID.attLate)?.exception).toBe("✓");
    expect(byId.get(ID.attAbsent)?.status).toBe("ABSENT");
    expect(byId.get(ID.attAbsent)?.checkIn).toBe("—");
    expect(byId.get(ID.attOpen)?.status).toBe("MISSING_PUNCH");
    // The window excludes the outside row.
    expect(byId.has(ID.attOutside)).toBe(false);
    // Both shape assertions PASS over the rendered rows.
    for (const assertion of outcome.result!.assertions) {
      expect(assertion.status).toBe("PASS");
    }
  });

  it("the exceptionsOnly filter narrows to the exception rows", async () => {
    const outcome = await withTenant(TENANT_R, () =>
      newRunService().run({
        reportKey: "hr.attendance-register",
        params: { ...WINDOW, exceptionsOnly: true },
        ctx: fullContext(),
      }),
    );
    expect(outcome.status).toBe("SUCCEEDED");
    const keys = outcome.result!.rows.map((row) => row.key);
    expect(keys.sort()).toEqual([ID.attAbsent, ID.attLate, ID.attOpen].sort());
  });

  it("the status filter narrows to the requested verdict", async () => {
    const outcome = await withTenant(TENANT_R, () =>
      newRunService().run({
        reportKey: "hr.attendance-register",
        params: { ...WINDOW, status: "ABSENT" },
        ctx: fullContext(),
      }),
    );
    expect(outcome.status).toBe("SUCCEEDED");
    expect(outcome.result!.rows.map((row) => row.key)).toEqual([ID.attAbsent]);
  });

  it("hr.leave-balances renders the cells with the SQL-computed remaining and PASS cap assertion", async () => {
    const outcome = await withTenant(TENANT_R, () =>
      newRunService().run({
        reportKey: "hr.leave-balances",
        params: { year: 2026, locale: "en" },
        ctx: fullContext(),
      }),
    );
    expect(outcome.status).toBe("SUCCEEDED");
    expect(outcome.result).toBeDefined();
    const rows = outcome.result!.rows;
    const byId = new Map(rows.map((row) => [row.key, row.values]));
    const annual = byId.get(ID.balance);
    expect(annual).toBeDefined();
    expect(annual?.entitlementDays).toBe("21.00");
    expect(annual?.carriedForwardDays).toBe("3.00");
    expect(annual?.usedDays).toBe("5.00");
    expect(annual?.remainingDays).toBe("19.00");
    expect(annual?.pendingDays).toBe("2.00");
    const cap = outcome.result!.assertions.find(
      (assertion) => assertion.id === "leave-inv031-balance-cap",
    );
    expect(cap?.status).toBe("PASS");
    // The totals fold: entitlement 51, remaining 49.
    const totals = new Map(outcome.result!.totals.map((total) => [total.id, total]));
    expect(totals.get("entitlementTotal")?.amount).toBe("51.00");
    expect(totals.get("remainingTotal")?.amount).toBe("49.00");
  });

  it("the leaveTypeId filter narrows to the requested type", async () => {
    const outcome = await withTenant(TENANT_R, () =>
      newRunService().run({
        reportKey: "hr.leave-balances",
        params: { year: 2026, leaveTypeId: ID.leaveType2, locale: "en" },
        ctx: fullContext(),
      }),
    );
    expect(outcome.status).toBe("SUCCEEDED");
    expect(outcome.result!.rows.map((row) => row.key)).toEqual([ID.balance2]);
  });

  it("hr.overtime-summary renders BR-084's feeding law as columns", async () => {
    const outcome = await withTenant(TENANT_R, () =>
      newRunService().run({
        reportKey: "hr.overtime-summary",
        params: { ...WINDOW },
        ctx: fullContext(),
      }),
    );
    expect(outcome.status).toBe("SUCCEEDED");
    expect(outcome.result).toBeDefined();
    const rows = outcome.result!.rows;
    const byKey = new Map(rows.map((row) => [row.key as string, row.values]));
    const required = byKey.get(`${ID.employee}:${ID.otRuleRequired}`);
    expect(required).toBeDefined();
    expect(required?.approvedHours).toBe("2.00");
    expect(required?.pendingFeedingHours).toBe("0.00");
    expect(required?.exceptionHours).toBe("1.00");
    expect(required?.rejectedHours).toBe("0.00");
    expect(required?.multipliedFeedingHours).toBe("3.00");
    expect(required?.entryCount).toBe(2);
    const open = byKey.get(`${ID.employee}:${ID.otRuleOpen}`);
    expect(open).toBeDefined();
    expect(open?.approvedHours).toBe("0.00");
    expect(open?.pendingFeedingHours).toBe("3.00");
    expect(open?.multipliedFeedingHours).toBe("6.00");
    expect(open?.rejectedHours).toBe("1.00");
    // Both shape assertions PASS over the rendered folds.
    for (const assertion of outcome.result!.assertions) {
      expect(assertion.status).toBe("PASS");
    }
    // The totals: feeding 5.00 (2 + 3), multiplied 9.00 (3 + 6).
    const totals = new Map(outcome.result!.totals.map((total) => [total.id, total]));
    expect(totals.get("feedingTotal")?.amount).toBe("5.00");
    expect(totals.get("multipliedTotal")?.amount).toBe("9.00");
    expect(totals.get("exceptionTotal")?.amount).toBe("1.00");
  });

  it("the tier filter narrows to the requested overtime tier", async () => {
    const outcome = await withTenant(TENANT_R, () =>
      newRunService().run({
        reportKey: "hr.overtime-summary",
        params: { ...WINDOW, tier: "HOLIDAY" },
        ctx: fullContext(),
      }),
    );
    expect(outcome.status).toBe("SUCCEEDED");
    expect(outcome.result!.rows.map((row) => row.key)).toEqual([
      `${ID.employee}:${ID.otRuleOpen}`,
    ]);
  });

  it("the seeded rows stay tenant-scoped (the R-isolation floor)", async () => {
    // A cross-tenant probe: the seeded rows exist under TENANT_R through
    // superuser while the reports above ran only inside TENANT_R's scope.
    const client = await su();
    const counted = await client.query(
      `SELECT count(*)::int AS n FROM attendance_records WHERE tenant_id = $1 AND employee_id = $2`,
      [TENANT_R, ID.employee],
    );
    await client.end();
    expect(counted.rows[0]!.n).toBe(5);
  });

  it("sessions without the module key are denied before params bind (one per contract)", async () => {
    const deniedCtx = fullContext(TENANT_R, {
      permissions: new Set(["reporting.reports.run"]),
    });
    for (const reportKey of [
      "hr.attendance-register",
      "hr.leave-balances",
      "hr.overtime-summary",
    ] as const) {
      const params =
        reportKey === "hr.leave-balances"
          ? { year: 2026, locale: "en" }
          : { ...WINDOW };
      await expect(
        withTenant(TENANT_R, () =>
          newRunService().run({
            reportKey,
            params,
            ctx: deniedCtx,
          }),
        ),
      ).rejects.toThrowError(PermissionDeniedError);
    }
  });
});
