import { beforeAll, describe, expect, it } from "vitest";

import { sql } from "drizzle-orm";

import { ensureTestDb, seedTenants, superuserClient } from "../test-db";
import { requireTenantContext, withTenant } from "../../infra/db/tenant-context";

/**
 * PHASE-045 T-19 — the acceptance evidence: the OA-06 EXPLAIN budgets for
 * the phase's two hot tables (the plan's §5 T-19 row): `attendance_records`
 * (the daily register walk, the exception board, and the employee-day
 * derivation/dedupe lookup — the 0081 indexes) and `leave_balances` (the
 * balance cell, the per-employee panel, and the tenant-year snapshot walk
 * — the 0083 indexes).
 *
 * The EXPLAIN method follows the PHASE-041/044 recorded precedent
 * verbatim: representative rows seeded first and ANALYZEd so the
 * planner's index choice is meaningful; `enable_seqscan = off` isolates
 * the index proof from the planner's volume-dependent cost choice — the
 * budget under test is the INDEX SHAPE servicing the hot path.
 *
 * THE ISOLATION LAW (the suite's serial discipline): the seed lives on a
 * DEDICATED tenant (`TENANT_H_OA6`) — never the shared tenant H — so no
 * other spec's tenant-wide reads (registers, boards, snapshots, feeds)
 * can ever observe this corpus, and this spec's own probes stay
 * RLS-scoped to its world alone.
 */

/** The dedicated OA-06 tenant (tenant H's hex family, the 0a06 arm). */
const TENANT_H_OA6 = "7a7a7a7a-7a7a-7a7a-7a7a-7a7a7a7a0a06";

let probeEmployee = "";
let probeLeaveType = "";

beforeAll(async () => {
  ensureTestDb();
  const suClient = await superuserClient();
  await seedTenants(suClient as never);
  await suClient.query(
    `INSERT INTO tenants (id, name, name_ar, base_currency, country_code, timezone) VALUES
       ($1, 'Tenant H-OA6 (explain budgets)', 'المستأجر هـ للميزانيات', 'SAR', 'SA', 'Asia/Riyadh')
     ON CONFLICT (id) DO NOTHING`,
    [TENANT_H_OA6],
  );
  await suClient.end();

  await withTenant(TENANT_H_OA6, async () => {
    const tx = requireTenantContext().tx!;
    // -- 60 employees (EMP-OA01…60 — the OA prefix, distinct from the
    // bridge spec's EMP-B* and the INV-031 property spec's EMP-M*).
    const employees = await tx.execute<{ id: string }>(sql`
      INSERT INTO employees (id, tenant_id, code, name, name_ar, hire_date, contract_type, basic_salary, created_by)
      SELECT gen_random_uuid(), erp.current_tenant_id(),
             'EMP-OA' || lpad(g::text, 2, '0'),
             'Explain Employee ' || g, 'موظف الميزانية ' || g,
             '2026-01-01', 'FULL_TIME', 8000 + (g * 50), NULL
      FROM generate_series(1, 60) AS g
      RETURNING id
    `);
    const ids = employees.rows.map((row) => row.id);
    probeEmployee = ids[0]!;

    // -- 3 leave types, the accrual shapes varied.
    const types = await tx.execute<{ id: string }>(sql`
      INSERT INTO leave_types (id, tenant_id, code, name, accrual_days_per_year, monthly_grant, carry_over_cap_days)
      VALUES
        (gen_random_uuid(), erp.current_tenant_id(), 'LT-OA-ANNUAL', 'Annual (OA)', 21, false, 10),
        (gen_random_uuid(), erp.current_tenant_id(), 'LT-OA-SICK', 'Sick (OA)', 30, false, 0),
        (gen_random_uuid(), erp.current_tenant_id(), 'LT-OA-COMP', 'Compensatory (OA)', 7, true, 3)
      RETURNING id
    `);
    probeLeaveType = types.rows[0]!.id;

    // -- attendance_records: 60 employees × 90 days (2026-07-01 + 0…89) ×
    // 2 sessions = 10,800 rows; every 9th employee-day flags the
    // exception board's arm (~600 exception rows). MANUAL source (no
    // device/import shape constraints).
    await tx.execute(sql`
      INSERT INTO attendance_records
        (id, tenant_id, employee_id, work_date, check_in, check_out, source,
         derived_status, late_minutes, worked_minutes, is_exception)
      SELECT gen_random_uuid(), erp.current_tenant_id(), e.id, d::date,
             ((d::date::text || ' ' || lpad((8 + (e.g % 2))::text, 2, '0') || ':05:00')::timestamp AT TIME ZONE 'Asia/Riyadh'),
             ((d::date::text || ' 12:00:00')::timestamp AT TIME ZONE 'Asia/Riyadh'),
             'MANUAL',
             CASE WHEN (e.g + extract(day from d)::int) % 9 = 0 THEN 'LATE' ELSE 'PRESENT' END,
             CASE WHEN (e.g + extract(day from d)::int) % 9 = 0 THEN 25 ELSE 0 END,
             235, (e.g + extract(day from d)::int) % 9 = 0
      FROM (SELECT id, row_number() OVER (ORDER BY code) AS g FROM employees
            WHERE tenant_id = erp.current_tenant_id() AND code LIKE 'EMP-OA%') e
      CROSS JOIN generate_series('2026-07-01'::date, '2026-07-01'::date + 89, interval '1 day') d
    `);
    await tx.execute(sql`
      INSERT INTO attendance_records
        (id, tenant_id, employee_id, work_date, check_in, check_out, source,
         derived_status, worked_minutes, is_exception)
      SELECT gen_random_uuid(), erp.current_tenant_id(), e.id, d::date,
             ((d::date::text || ' 13:00:00')::timestamp AT TIME ZONE 'Asia/Riyadh'),
             ((d::date::text || ' 17:00:00')::timestamp AT TIME ZONE 'Asia/Riyadh'),
             'MANUAL', 'PRESENT', 240, false
      FROM (SELECT id, row_number() OVER (ORDER BY code) AS g FROM employees
            WHERE tenant_id = erp.current_tenant_id() AND code LIKE 'EMP-OA%') e
      CROSS JOIN generate_series('2026-07-01'::date, '2026-07-01'::date + 89, interval '1 day') d
    `);

    // -- leave_balances: 60 employees × 3 types × 2 years = 360 cells,
    // the INV-031-legal value shapes (used ≤ entitlement + carried).
    await tx.execute(sql`
      INSERT INTO leave_balances
        (id, tenant_id, employee_id, leave_type_id, year,
         entitlement_days, used_days, carried_forward_days)
      SELECT gen_random_uuid(), erp.current_tenant_id(), e.id, t.id, y.year,
             (10 + (e.g % 8))::numeric(7,2),
             ((e.g + y.year - 2026) % 9)::numeric(7,2),
             (y.year - 2025)::numeric(7,2)
      FROM (SELECT id, row_number() OVER (ORDER BY code) AS g FROM employees
            WHERE tenant_id = erp.current_tenant_id() AND code LIKE 'EMP-OA%') e
      CROSS JOIN (SELECT id FROM leave_types
                  WHERE tenant_id = erp.current_tenant_id() AND code LIKE 'LT-OA%') t
      CROSS JOIN (VALUES (2026), (2027)) AS y(year)
    `);
  });

  // ANALYZE — the planner's index choice must be informed.
  const client = await superuserClient();
  await client.query("ANALYZE attendance_records");
  await client.query("ANALYZE leave_balances");
  await client.end();
});

async function explain(query: ReturnType<typeof sql>): Promise<string> {
  const plan = await withTenant(TENANT_H_OA6, async () => {
    const tx = requireTenantContext().tx!;
    await tx.execute(sql`SET LOCAL enable_seqscan = off`);
    const rows = await tx.execute(sql`EXPLAIN ${query}`);
    return (rows.rows as unknown as Array<{ "QUERY PLAN": string }>).map(
      (row) => row["QUERY PLAN"],
    );
  });
  return plan.join("\n");
}

describe("PHASE-045 T-19 — OA-06 EXPLAIN budgets (attendance_records + leave_balances)", () => {
  it("P1 the daily register walk (tenant + one date, the punch order) rides ix_attendance_records_tenant_date — no seq-scan", async () => {
    // listRegisterRows' driving shape: the tenant's day, ordered by the
    // punch clock (check_in NULLS FIRST — the ABSENT markers lead).
    const text = await explain(sql`
      SELECT id, employee_id, check_in, check_out, derived_status, is_exception
      FROM attendance_records
      WHERE tenant_id = erp.current_tenant_id()
        AND work_date = '2026-08-15'::date
      ORDER BY check_in NULLS FIRST, created_at
      LIMIT 500`);
    expect(text).toMatch(
      /Index (Only )?Scan( Backward)? using ix_attendance_records_(tenant_date|tenant_employee_date)|Bitmap Index Scan on ix_attendance_records_(tenant_date|tenant_employee_date)/,
    );
    expect(text).not.toMatch(/Seq Scan/);
  });

  it("P2 the exception board (tenant + date range + is_exception) rides the PARTIAL ix_attendance_records_tenant_exception — no seq-scan", async () => {
    // listExceptionRows' shape: the board's every-load query — the
    // partial index exists precisely for this predicate.
    const text = await explain(sql`
      SELECT id, employee_id, work_date, derived_status, late_minutes
      FROM attendance_records
      WHERE tenant_id = erp.current_tenant_id()
        AND work_date >= '2026-08-01'::date AND work_date <= '2026-08-31'::date
        AND is_exception
      ORDER BY work_date, check_in NULLS FIRST
      LIMIT 200`);
    expect(text).toMatch(
      /Index (Only )?Scan( Backward)? using ix_attendance_records_tenant_exception|Bitmap Index Scan on ix_attendance_records_tenant_exception/,
    );
    expect(text).not.toMatch(/Seq Scan/);
  });

  it("P3 the employee-day derivation/dedupe lookup (tenant + employee + date range) rides ix_attendance_records_tenant_employee_date — no seq-scan", async () => {
    // listDerivationRows' capture-path shape: the exact rows the INV-031
    // classification and the 0081 dedupe floor compare against — the
    // hottest per-write path in the cluster.
    const text = await explain(sql`
      SELECT id, check_in, check_out, derived_status
      FROM attendance_records
      WHERE tenant_id = erp.current_tenant_id()
        AND employee_id = ${probeEmployee}::uuid
        AND work_date >= '2026-08-01'::date AND work_date <= '2026-08-01'::date
    `);
    expect(text).toMatch(
      /Index (Only )?Scan( Backward)? using ix_attendance_records_tenant_employee_date|Bitmap Index Scan on ix_attendance_records_tenant_employee_date/,
    );
    expect(text).not.toMatch(/Seq Scan/);
  });

  it("P4 the balance cell (tenant + employee + type + year — the approve-boundary cap check) rides uq_leave_balances_cell — no seq-scan", async () => {
    // findBalanceCell's shape: the get-or-create / cap-check arm every
    // leave write rides — the unique cell floor doubles as its index.
    const text = await explain(sql`
      SELECT id, entitlement_days, used_days, carried_forward_days
      FROM leave_balances
      WHERE tenant_id = erp.current_tenant_id()
        AND employee_id = ${probeEmployee}::uuid
        AND leave_type_id = ${probeLeaveType}::uuid
        AND year = 2026
      LIMIT 1`);
    expect(text).toMatch(
      /Index (Only )?Scan( Backward)? using (uq_leave_balances_cell|ix_leave_balances_tenant_employee_year)|Bitmap Index Scan on (uq_leave_balances_cell|ix_leave_balances_tenant_employee_year)/,
    );
    expect(text).not.toMatch(/Seq Scan/);
  });

  it("P5 the per-employee balance panel (tenant + employee + year) rides ix_leave_balances_tenant_employee_year — no seq-scan", async () => {
    // listBalances' employee arm: the balances panel and the T-16 report's
    // per-employee cells.
    const text = await explain(sql`
      SELECT id, leave_type_id, year, entitlement_days, used_days, carried_forward_days
      FROM leave_balances
      WHERE tenant_id = erp.current_tenant_id()
        AND employee_id = ${probeEmployee}::uuid
        AND year = 2027
      ORDER BY year`);
    expect(text).toMatch(
      /Index (Only )?Scan( Backward)? using (ix_leave_balances_tenant_employee_year|uq_leave_balances_cell)|Bitmap Index Scan on (ix_leave_balances_tenant_employee_year|uq_leave_balances_cell)/,
    );
    expect(text).not.toMatch(/Seq Scan/);
  });

  it("P6 the tenant-year snapshot walk (the T-10 feed / T-16 report shape) rides the tenant prefix of the composite — no seq-scan", async () => {
    // The snapshot's driving shape: every cell of the tenant's year,
    // joined to the dims for the codes — the register-read budget is the
    // tenant-scoped index walk (the year filters within it).
    const text = await explain(sql`
      SELECT b.employee_id, b.leave_type_id, b.entitlement_days, b.used_days, b.carried_forward_days
      FROM leave_balances b
      WHERE b.tenant_id = erp.current_tenant_id()
        AND b.year = 2026
      ORDER BY b.employee_id, b.leave_type_id
      LIMIT 500`);
    expect(text).toMatch(
      /Index (Only )?Scan( Backward)? using (ix_leave_balances_tenant_employee_year|uq_leave_balances_cell|pk_leave_balances)|Bitmap (Heap )?Scan on (ix_leave_balances_tenant_employee_year|uq_leave_balances_cell|pk_leave_balances)|Bitmap Index Scan on (ix_leave_balances_tenant_employee_year|uq_leave_balances_cell|pk_leave_balances)/,
    );
    expect(text).not.toMatch(/Seq Scan/);
  });
});
