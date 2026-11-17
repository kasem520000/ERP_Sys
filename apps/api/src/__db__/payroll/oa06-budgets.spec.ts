import { beforeAll, describe, expect, it } from "vitest";

import { sql } from "drizzle-orm";

import { ensureTestDb, seedTenants, superuserClient } from "../test-db";
import { requireTenantContext, withTenant } from "../../infra/db/tenant-context";

/**
 * PHASE-046 T-16 — the acceptance evidence: the OA-06 EXPLAIN budgets for
 * the phase's four hot reads (the plan's §5 T-16 row): the PIT
 * bracket-set resolution (`payroll_tax_brackets` — the 0089 index), the
 * EOSB entitlement query (the tier resolution on `eosb_rules` + the
 * per-employee evidence walk on `eosb_calculations` — the 0090 indexes),
 * the statutory-summary walk (the T-13 report's per-(period × code) fold
 * over `payroll_run_lines` × `payroll_runs` × `fiscal_periods` + the
 * frozen jsonb breakdowns — the 0043 indexes), and the remittance
 * liability read (the run-gated outstanding lookup on `payroll_runs` —
 * the PK ride G-52's settlement leg re-reads under the lock).
 *
 * The EXPLAIN method follows the PHASE-041/044/045 recorded precedent
 * verbatim: representative rows seeded first and ANALYZEd so the
 * planner's index choice is meaningful; `enable_seqscan = off` isolates
 * the index proof from the planner's volume-dependent cost choice — the
 * budget under test is the INDEX SHAPE servicing the hot path. Every
 * probe's plan is LOGGED (the suite output kept in the gate evidence).
 *
 * THE ISOLATION LAW (the suite's serial discipline): the corpus lives on
 * a DEDICATED tenant (`TENANT_P_OA6` — the PAY hex family's 0a06 arm,
 * never the shared PAY/GOLD/RACEP worlds) so no other spec's tenant-wide
 * reads can ever observe it, and this spec's own probes stay RLS-scoped
 * to its world alone. The corpus rows are seeded DIRECTLY (the 045
 * precedent: representative shapes ANALYZEd — the golden suites own the
 * end-to-end service-path proofs; the synthetic VERIFIED bracket set is
 * this tenant's own, exactly the pit.spec idiom).
 */

/** The dedicated OA-06 tenant (the PAY hex family, the 0a06 arm). */
const TENANT_P_OA6 = "8f8f8f8f-8f8f-8f8f-8f8f-8f8f8f8f0a06";

let probeEmployee = "";
let probeRun = "";

beforeAll(async () => {
  ensureTestDb();
  const suClient = await superuserClient();
  await seedTenants(suClient as never);
  await suClient.query(
    `INSERT INTO tenants (id, name, name_ar, base_currency, country_code, timezone) VALUES
       ($1, 'Tenant P-OA6 (explain budgets)', 'المستأجر ب للميزانيات', 'SAR', 'SA', 'Asia/Riyadh')
     ON CONFLICT (id) DO NOTHING`,
    [TENANT_P_OA6],
  );
  await suClient.end();

  await withTenant(TENANT_P_OA6, async () => {
    const tx = requireTenantContext().tx!;

    // -- FY2026-OA + six REGULAR OPEN periods (2026-01 … 2026-06).
    const fy = await tx.execute<{ id: string }>(sql`
      INSERT INTO fiscal_years (id, tenant_id, name, start_date, end_date, status)
      VALUES (gen_random_uuid(), erp.current_tenant_id(), 'FY2026-OA', '2026-01-01', '2026-12-31', 'OPEN')
      RETURNING id
    `);
    const fyId = fy.rows[0]!.id;
    const periods = await tx.execute<{ id: string; name: string }>(sql`
      INSERT INTO fiscal_periods (id, tenant_id, fiscal_year_id, name, kind, start_date, end_date, status)
      SELECT gen_random_uuid(), erp.current_tenant_id(), ${fyId}::uuid,
             'FY2026-' || lpad(g::text, 2, '0'), 'REGULAR',
             make_date(2026, g, 1), (make_date(2026, g, 1) + interval '1 month - 1 day')::date, 'OPEN'
      FROM generate_series(1, 6) AS g
      RETURNING id, name
    `);
    const periodIds = periods.rows.map((row) => row.id);

    // -- 40 employees (EMP-PO01…40 — the payroll-OA prefix, distinct from
    //    every other spec's employee codes).
    const employees = await tx.execute<{ id: string }>(sql`
      INSERT INTO employees (id, tenant_id, code, name, name_ar, hire_date, contract_type, basic_salary, created_by)
      SELECT gen_random_uuid(), erp.current_tenant_id(),
             'EMP-PO' || lpad(g::text, 2, '0'),
             'Payroll Explain Employee ' || g, 'موظف ميزانية الرواتب ' || g,
             '2020-01-01', 'FULL_TIME', 9000 + (g * 25), NULL
      FROM generate_series(1, 40) AS g
      RETURNING id
    `);
    const employeeIds = employees.rows.map((row) => row.id);
    probeEmployee = employeeIds[0]!;

    // -- the synthetic VERIFIED bracket set (the pit.spec idiom — this
    //    dedicated tenant's own SA rows: 0% to 10k · 10% 10–30k · 20%
    //    above; VERIFIED rows carry the citation shape the 0089 CHECK
    //    demands).
    await tx.execute(sql`
      INSERT INTO payroll_tax_brackets
        (id, tenant_id, jurisdiction_code, code, floor, ceiling, rate, sort,
         personal_allowance_default, per_dependent_allowance,
         effective_from, status, source_name, source_ref, verified_at, review_note)
      SELECT gen_random_uuid(), erp.current_tenant_id(), 'SA', 'PIT-SYNTH',
             f.floor, f.ceiling, f.rate, f.sort, 5000, 1000,
             DATE '2020-01-01', 'VERIFIED',
             'OA-06 synthetic corpus set (the pit.spec idiom — this tenant only)', NULL, now(), NULL
      FROM (VALUES
        (0::numeric, 10000::numeric, 0::numeric, 1),
        (10000::numeric, 30000::numeric, 10::numeric, 2),
        (30000::numeric, NULL::numeric, 20::numeric, 3)
      ) AS f(floor, ceiling, rate, sort)
    `);

    // -- the EOSB tier sets: the KSA default two + a CONTRACTOR override
    //    (the P2 resolution arms — VERIFIED rows carry the source shape).
    await tx.execute(sql`
      INSERT INTO eosb_rules
        (id, tenant_id, jurisdiction_code, from_years, to_years, days_per_year,
         contract_type, effective_from, status, source_name, source_ref, verified_at, review_note)
      VALUES
        (gen_random_uuid(), erp.current_tenant_id(), 'SA', 0.00, 5.00, 15.00, NULL, DATE '2020-01-01', 'VERIFIED',
         'OA-06 corpus (the canonical tier shape)', NULL, now(), NULL),
        (gen_random_uuid(), erp.current_tenant_id(), 'SA', 5.00, NULL, 30.00, NULL, DATE '2020-01-01', 'VERIFIED',
         'OA-06 corpus (the canonical tier shape)', NULL, now(), NULL),
        (gen_random_uuid(), erp.current_tenant_id(), 'SA', 0.00, NULL, 21.00, 'CONTRACTOR', DATE '2020-01-01', 'VERIFIED',
         'OA-06 corpus (the contract-type override shape)', NULL, now(), NULL)
    `);

    // -- six POSTED runs (one per period) with the frozen statutory
    //    summary (the G-52 liability the settlement leg folds) + their
    //    40 lines each with the frozen per-line breakdown jsonb.
    for (let i = 0; i < periodIds.length; i += 1) {
      const periodId = periodIds[i]!;
      const runRows = await tx.execute<{ id: string }>(sql`
        INSERT INTO payroll_runs
          (id, tenant_id, run_no, fiscal_period_id, status,
           gross_total, deductions_total, net_total, paid_net_total,
           employer_contributions_total, eos_accrual_total,
           statutory_employee_total, statutory_employer_total, pit_total,
           journal_entry_id, posted_at,
           statutory_summary)
        VALUES (gen_random_uuid(), erp.current_tenant_id(),
                ${`PR-2026-${100 + i}`}, ${periodId}::uuid, 'POSTED',
                50000.0000, 6000.0000, 44000.0000, 0.0000,
                7000.0000, 0.0000,
                5970.0000, 7000.0000, 1200.0000,
                gen_random_uuid(), now(),
                ${JSON.stringify([
                  { code: "GOSI-PENSION", kind: "CONTRIBUTION", accrued: "3040.0000", remitted: "3040.0000" },
                  { code: "GOSI-SANED", kind: "CONTRIBUTION", accrued: "120.0000", remitted: "120.0000" },
                  { code: "GOSI-OH", kind: "CONTRIBUTION", accrued: "2810.0000", remitted: "2810.0000" },
                  { code: "PIT", kind: "PIT", accrued: "1200.0000", remitted: "0.0000" },
                ])}::jsonb)
        RETURNING id
      `);
      const runId = runRows.rows[0]!.id;
      if (i === 0) {
        probeRun = runId;
      }
      await tx.execute(sql`
        INSERT INTO payroll_run_lines
          (id, tenant_id, run_id, employee_id, component_snapshot,
           gross_amount, deductions_amount, net_amount,
           employer_contributions, eos_accrual,
           statutory_employee_share, statutory_employer_share, pit_withheld,
           statutory_breakdown)
        SELECT gen_random_uuid(), erp.current_tenant_id(), ${runId}::uuid, e.id,
               '{"components":[]}'::jsonb,
               1250.0000, 150.0000, 1100.0000,
               175.0000, 0.0000,
               149.2500, 175.0000, 30.0000,
               ${JSON.stringify(
                 [
                   {
                     code: "GOSI-PENSION",
                     kind: "CONTRIBUTION",
                     base: "1250.0000",
                     clampedBase: "1250.0000",
                     clampedBy: null,
                     employeeAmount: "112.5000",
                     employerAmount: "112.5000",
                   },
                   {
                     code: "GOSI-SANED",
                     kind: "CONTRIBUTION",
                     base: "1250.0000",
                     clampedBase: "1250.0000",
                     clampedBy: null,
                     employeeAmount: "9.3750",
                     employerAmount: "9.3750",
                   },
                   {
                     code: "GOSI-OH",
                     kind: "CONTRIBUTION",
                     base: "1250.0000",
                     clampedBase: "1250.0000",
                     clampedBy: null,
                     employeeAmount: "0.0000",
                     employerAmount: "25.0000",
                   },
                 ],
               )}::jsonb
        FROM employees e
        WHERE e.tenant_id = erp.current_tenant_id() AND e.code LIKE 'EMP-PO%'
      `);
    }

    // -- the EOSB evidence walk corpus: 40 employees × 2 kinds, the CHECK
    //    laws honored (delta = entitlement − provision exactly).
    await tx.execute(sql`
      INSERT INTO eosb_calculations
        (id, tenant_id, employee_id, kind, service_years, tier_breakdown,
         wage_base_snapshot, entitlement_amount, provision_balance, delta,
         status, entry_date)
      SELECT gen_random_uuid(), erp.current_tenant_id(), e.id,
             k.kind, 6.50,
             '[]'::jsonb, '{}'::jsonb,
             (19500 + (e.g * 10))::numeric(19,4),
             (17000 + (e.g * 10))::numeric(19,4),
             2500.0000,
             'COMPUTED', DATE '2026-06-30'
      FROM (SELECT id, row_number() OVER (ORDER BY code) AS g FROM employees
            WHERE tenant_id = erp.current_tenant_id() AND code LIKE 'EMP-PO%') e
      CROSS JOIN (VALUES ('OPENING'), ('PERIOD_TRUE_UP')) AS k(kind)
    `);
  });

  // ANALYZE — the planner's index choice must be informed.
  const client = await superuserClient();
  await client.query("ANALYZE payroll_tax_brackets");
  await client.query("ANALYZE eosb_rules");
  await client.query("ANALYZE eosb_calculations");
  await client.query("ANALYZE payroll_runs");
  await client.query("ANALYZE payroll_run_lines");
  await client.query("ANALYZE fiscal_periods");
  await client.end();
});

async function explain(label: string, query: ReturnType<typeof sql>): Promise<string> {
  const plan = await withTenant(TENANT_P_OA6, async () => {
    const tx = requireTenantContext().tx!;
    await tx.execute(sql`SET LOCAL enable_seqscan = off`);
    const rows = await tx.execute(sql`EXPLAIN ${query}`);
    return (rows.rows as unknown as Array<{ "QUERY PLAN": string }>).map(
      (row) => row["QUERY PLAN"],
    );
  });
  const text = plan.join("\n");
  // The plans are LOGGED (the plan's §4 row: audit-evidence keeps the
  // suite output — the OA-06 explain plans log).
  process.stdout.write(`[oa06-budgets] ${label}:\n${text}\n`);
  return text;
}

describe("PHASE-046 T-16 — OA-06 EXPLAIN budgets (payroll compliance)", () => {
  it("P1 the PIT bracket-set resolution (tenant + jurisdiction + effective window, the set's own order) rides ix_payroll_tax_brackets_tenant_jurisdiction_effective — no seq-scan", async () => {
    // The PitEngine's driving read: the effective-dated set the engine
    // validates SET-CONSISTENT before any fold (D-03).
    const text = await explain(
      "P1 bracket-set resolution",
      sql`
      SELECT id, code, floor, ceiling, rate, sort,
             personal_allowance_default, per_dependent_allowance, status
      FROM payroll_tax_brackets
      WHERE jurisdiction_code = 'SA'
        AND effective_from <= '2026-03-31'::date
        AND (effective_to IS NULL OR effective_to >= '2026-03-31'::date)
      ORDER BY code, sort`,
    );
    expect(text).toMatch(
      /Index (Only )?Scan( Backward)? using (ix_payroll_tax_brackets_tenant_jurisdiction_effective|uq_payroll_tax_brackets_set_sort)|Bitmap Index Scan on (ix_payroll_tax_brackets_tenant_jurisdiction_effective|uq_payroll_tax_brackets_set_sort)/,
    );
    expect(text).not.toMatch(/Seq Scan/);
  });

  it("P2 the EOSB entitlement query — the tier resolution rides ix_eosb_rules_tenant_jurisdiction_effective AND the per-employee evidence walk rides ix_eosb_calculations_tenant_employee_kind — no seq-scan", async () => {
    // (a) The entitlement fold's driving read: the contract-type-aware
    // tier set in from_years order (CONTRACTOR rows REPLACE the default —
    // never a mixed fold).
    const tiers = await explain(
      "P2a the EOSB tier resolution",
      sql`
      SELECT id, from_years, to_years, days_per_year, contract_type, status
      FROM eosb_rules
      WHERE jurisdiction_code = 'SA'
        AND effective_from <= '2026-06-30'::date
        AND (effective_to IS NULL OR effective_to >= '2026-06-30'::date)
        AND (contract_type IS NULL OR contract_type = 'FULL_TIME')
      ORDER BY from_years`,
    );
    expect(tiers).toMatch(
      /Index (Only )?Scan( Backward)? using (ix_eosb_rules_tenant_jurisdiction_effective|uq_eosb_rules_tier)|Bitmap Index Scan on (ix_eosb_rules_tenant_jurisdiction_effective|uq_eosb_rules_tier)/,
    );
    expect(tiers).not.toMatch(/Seq Scan/);

    // (b) The reconciliation view's per-employee arm: the latest
    // calculations by kind — the eosb-liability report's evidence walk.
    const walk = await explain(
      "P2b the per-employee calculations walk",
      sql`
      SELECT id, kind, service_years, entitlement_amount, provision_balance, delta, status
      FROM eosb_calculations
      WHERE employee_id = ${probeEmployee}::uuid
      ORDER BY created_at DESC, id DESC
      LIMIT 50`,
    );
    expect(walk).toMatch(
      /Index (Only )?Scan( Backward)? using ix_eosb_calculations_tenant_employee_kind|Bitmap Index Scan on ix_eosb_calculations_tenant_employee_kind/,
    );
    expect(walk).not.toMatch(/Seq Scan/);
  });

  it("P3 the statutory-summary walk (the T-13 report's per-(period × code) fold over the frozen breakdowns) rides the 0043 indexes — no seq-scan", async () => {
    // payrollQueries.statutorySummary's contribution arm: the POSTED runs
    // in the window, their lines' frozen jsonb breakdowns re-folded — the
    // render-time INV-032(b) re-check every export rides.
    const text = await explain(
      "P3 the statutory-summary walk",
      sql`
      SELECT p.name AS period_name, entry->>'code' AS code,
             SUM((entry->>'employeeAmount')::numeric)::numeric(19,4)::text AS employee_share,
             SUM((entry->>'employerAmount')::numeric)::numeric(19,4)::text AS employer_share
      FROM payroll_run_lines l
      JOIN payroll_runs r ON r.id = l.run_id
      JOIN fiscal_periods p ON p.id = r.fiscal_period_id
      CROSS JOIN LATERAL jsonb_array_elements(COALESCE(l.statutory_breakdown, '[]'::jsonb)) AS entry
      WHERE r.status = 'POSTED'
        AND p.start_date >= '2026-01-01'::date AND p.start_date <= '2026-06-30'::date
        AND entry->>'kind' = 'CONTRIBUTION'
      GROUP BY p.name, entry->>'code'
      ORDER BY p.name, entry->>'code'`,
    );
    expect(text).toMatch(
      /Index (Only )?Scan( Backward)? using (ix_payroll_runs_tenant_period_status|ix_payroll_run_lines_tenant_run|pk_payroll_runs)|Bitmap (Heap )?Scan on (ix_payroll_runs_tenant_period_status|ix_payroll_run_lines_tenant_run)|Bitmap Index Scan on (ix_payroll_runs_tenant_period_status|ix_payroll_run_lines_tenant_run)/,
    );
    expect(text).not.toMatch(/Seq Scan/);
  });

  it("P4 the remittance liability read (the run-gated outstanding lookup G-52's settlement leg re-reads under the lock) rides pk_payroll_runs — no seq-scan", async () => {
    // The remit act's driving read: findRunById — the frozen
    // statutory_summary (accrued vs remitted) + the totals the outstanding
    // computation folds, re-read INSIDE the run gate's serialized window.
    const text = await explain(
      "P4 the remittance liability read",
      sql`
      SELECT id, status, gross_total, deductions_total, net_total, paid_net_total,
             statutory_employee_total, statutory_employer_total, pit_total,
             statutory_summary
      FROM payroll_runs
      WHERE id = ${probeRun}::uuid
      LIMIT 1`,
    );
    expect(text).toMatch(
      /Index (Only )?Scan( Backward)? using (pk_payroll_runs|uq_payroll_runs_id_tenant)|Bitmap Index Scan on (pk_payroll_runs|uq_payroll_runs_id_tenant)/,
    );
    expect(text).not.toMatch(/Seq Scan/);
  });
});
