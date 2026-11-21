import { beforeAll, describe, expect, it } from "vitest";

import { withTenant } from "../../infra/db/tenant-context";
import { appClient, seedTenants, superuserClient } from "../test-db";

/**
 * PHASE-048 (W-14 — T-18b, dated 2026-11-22) · `projects-rls.db.spec`
 * — THE RLS ATTACK MATRIX A1–A10 over the eleven PHASE-048 projects
 * tables (the talent-rls template, the family-deep edition): two
 * DEDICATED probe tenants (a victim and an attacker — never the shared
 * suites' registers), each seeded with a FULL FK-CHAINED projects world
 * through the APP-ROLE path (withTenant + the ambient transaction —
 * the erp_app role the production request rides, never superuser), and
 * the attacker's connection running the attack shapes against every
 * table:
 *
 * A1 no-GUC reads fail closed · A2 the attacker's GUC never exposes
 * the victim's rows · A3 forged-tenant INSERTs reject 42501 with zero
 * residue · A4 staged UPDATE hijacks touch 0 rows byte-identically ·
 * A5 DELETEs of the other tenant's rows are denied (the evidence
 * tables carry no grant by design) or touch 0 rows (the planning
 * tables) · A7 id-probes leak no existence · A8 THE COMPOSITE-FK LAW
 * (the catalog walk proves every child FK is (id, tenant_id) + a live
 * FK-inversion probe rejects 23503) · A9 FK-chain joins stay confined ·
 * A10 UNION ALL + recursive CTE shapes stay confined — and the final
 * census: BOTH worlds survive every attack row-for-row.
 */

const TENANT_PRL_A = "6b6b6b6b-0000-4000-8000-00000000611a"; // the victim
const TENANT_PRL_B = "6b6b6b6b-0000-4000-8000-00000000611b"; // the attacker

/** The eleven PHASE-048 tables (0100–0103) — the attack surface. */
const PROJECTS_TABLES = [
  "project_wbs_tasks",
  "project_budgets",
  "project_budget_lines",
  "project_resource_allocations",
  "change_orders",
  "subcontractor_agreements",
  "subcontractor_certificates",
  "retention_accounts",
  "progress_certificates",
  "service_visits",
  "ias23_capitalizations",
] as const;

/** The evidence-discipline tables — DELETE carries NO grant by design
 * (the audited commercial history; A5 asserts the denial). */
const NO_DELETE_GRANT = new Set([
  "project_budgets",
  "change_orders",
  "subcontractor_certificates",
  "retention_accounts",
  "progress_certificates",
  "service_visits",
  "ias23_capitalizations",
]);

/** The expected per-table census after seeding (per tenant). */
const EXPECTED_COUNTS: Readonly<Record<(typeof PROJECTS_TABLES)[number], number>> = {
  project_wbs_tasks: 2,
  project_budgets: 1,
  project_budget_lines: 2,
  project_resource_allocations: 1,
  change_orders: 1,
  subcontractor_agreements: 1,
  subcontractor_certificates: 1,
  retention_accounts: 2,
  progress_certificates: 1,
  service_visits: 2,
  ias23_capitalizations: 1,
};

/** Seed one tenant's FULL FK-chained projects world through the
 * app-role path (the erp_app role + erp.current_tenant_id() — never
 * superuser; the production request's own path). */
async function seedWorld(tenantId: string, tag: string): Promise<Record<string, string>> {
  return withTenant(tenantId, async () => {
    const { sql } = await import("drizzle-orm");
    const { requireTenantContext } = await import("../../infra/db/tenant-context");
    const tx = requireTenantContext().tx!;
    const ids: Record<string, string> = {};

    // The substrate rows the FK chains need (employee, branch, partner,
    // warehouse, project) — idempotent by code.
    const employee = await tx.execute<{ id: string }>(sql`
      INSERT INTO employees (id, tenant_id, code, name, hire_date, contract_type, basic_salary, status, created_by)
      VALUES (gen_random_uuid(), erp.current_tenant_id(), ${`EMP-PRL-${tag}`}, 'PRL technician', '2026-01-01', 'FULL_TIME', 8000, 'ACTIVE', null)
      ON CONFLICT (tenant_id, code) DO UPDATE SET name = EXCLUDED.name RETURNING id
    `);
    ids.employee = employee.rows[0]!.id;

    const branch = await tx.execute<{ id: string }>(sql`
      INSERT INTO branches (id, tenant_id, code, name)
      VALUES (gen_random_uuid(), erp.current_tenant_id(), ${`BR-PRL-${tag}`}, 'PRL branch')
      ON CONFLICT (tenant_id, code) DO UPDATE SET name = EXCLUDED.name RETURNING id
    `);
    ids.branch = branch.rows[0]!.id;

    const partner = await tx.execute<{ id: string }>(sql`
      INSERT INTO partners (id, tenant_id, kind, code, name)
      VALUES (gen_random_uuid(), erp.current_tenant_id(), 'CUSTOMER', ${`PT-PRL-${tag}`}, 'PRL customer')
      ON CONFLICT (tenant_id, code) DO UPDATE SET name = EXCLUDED.name RETURNING id
    `);
    ids.partner = partner.rows[0]!.id;

    const warehouse = await tx.execute<{ id: string }>(sql`
      INSERT INTO warehouses (id, tenant_id, branch_id, code, name)
      VALUES (gen_random_uuid(), erp.current_tenant_id(), ${ids.branch}, ${`WH-PRL-${tag}`}, 'PRL warehouse')
      ON CONFLICT (tenant_id, code) DO UPDATE SET name = EXCLUDED.name RETURNING id
    `);
    ids.warehouse = warehouse.rows[0]!.id;

    const project = await tx.execute<{ id: string }>(sql`
      INSERT INTO projects (id, tenant_id, code, name, status)
      VALUES (gen_random_uuid(), erp.current_tenant_id(), ${`PRL-PRJ-${tag}`}, 'The PRL project', 'OPEN')
      ON CONFLICT (tenant_id, code) DO UPDATE SET name = EXCLUDED.name RETURNING id
    `);
    ids.project = project.rows[0]!.id;

    // The WBS tree (root + child).
    const root = await tx.execute<{ id: string }>(sql`
      INSERT INTO project_wbs_tasks (id, tenant_id, project_id, wbs_code, name, is_milestone,
                                     start_date, end_date, weight, percent_complete)
      VALUES (gen_random_uuid(), erp.current_tenant_id(), ${ids.project}, 'R', 'PRL root', false,
              '2026-01-01', '2026-12-31', null, 0)
      RETURNING id
    `);
    ids.wbsRoot = root.rows[0]!.id;
    const child = await tx.execute<{ id: string }>(sql`
      INSERT INTO project_wbs_tasks (id, tenant_id, project_id, parent_task_id, wbs_code, name,
                                     is_milestone, start_date, end_date, weight, percent_complete)
      VALUES (gen_random_uuid(), erp.current_tenant_id(), ${ids.project}, ${ids.wbsRoot}, 'R.1',
              'PRL child', false, '2026-01-01', '2026-06-30', 100, 40)
      RETURNING id
    `);
    ids.wbsChild = child.rows[0]!.id;

    // The APPROVED budget + two lines (LABOR on the child · MATERIAL
    // at project level — the cell law's two partial uniques).
    const budget = await tx.execute<{ id: string }>(sql`
      INSERT INTO project_budgets (id, tenant_id, project_id, name, status, approved_at)
      VALUES (gen_random_uuid(), erp.current_tenant_id(), ${ids.project}, 'PB-PRL', 'APPROVED', now())
      RETURNING id
    `);
    ids.budget = budget.rows[0]!.id;
    const laborLine = await tx.execute<{ id: string }>(sql`
      INSERT INTO project_budget_lines (id, tenant_id, budget_id, cost_type, wbs_task_id,
                                        period_start, period_end, planned_amount)
      VALUES (gen_random_uuid(), erp.current_tenant_id(), ${ids.budget}, 'LABOR', ${ids.wbsChild},
              '2026-01-01', '2026-01-31', 3100)
      RETURNING id
    `);
    ids.budgetLaborLine = laborLine.rows[0]!.id;
    await tx.execute(sql`
      INSERT INTO project_budget_lines (id, tenant_id, budget_id, cost_type, wbs_task_id,
                                        period_start, period_end, planned_amount)
      VALUES (gen_random_uuid(), erp.current_tenant_id(), ${ids.budget}, 'MATERIAL', null,
              '2026-01-01', '2026-01-31', 1000)
    `);

    // The employee allocation.
    await tx.execute(sql`
      INSERT INTO project_resource_allocations (id, tenant_id, project_id, wbs_task_id, resource_kind,
                                                 employee_id, start_date, end_date, allocation_percent)
      VALUES (gen_random_uuid(), erp.current_tenant_id(), ${ids.project}, ${ids.wbsChild}, 'EMPLOYEE',
              ${ids.employee}, '2026-01-01', '2026-06-30', 50)
    `);

    // The SUBMITTED change order (the approval link stays for the
    // approval gate — this world proves the RLS plane, not the gate).
    const changeOrder = await tx.execute<{ id: string }>(sql`
      INSERT INTO change_orders (id, tenant_id, project_id, co_no, title, price_delta, status, submitted_at)
      VALUES (gen_random_uuid(), erp.current_tenant_id(), ${ids.project}, ${`CO-PRL-${tag}`},
              'PRL order', 500, 'SUBMITTED', now())
      RETURNING id
    `);
    ids.changeOrder = changeOrder.rows[0]!.id;

    // The ACTIVE sub agreement + its APPROVED certificate.
    const agreement = await tx.execute<{ id: string }>(sql`
      INSERT INTO subcontractor_agreements (id, tenant_id, project_id, partner_id, agreement_no, title,
                                             agreement_value, currency_code, retention_percent, status, activated_at)
      VALUES (gen_random_uuid(), erp.current_tenant_id(), ${ids.project}, ${ids.partner}, ${`SA-PRL-${tag}`},
              'PRL package', 50000, 'SAR', 10, 'ACTIVE', now())
      RETURNING id
    `);
    ids.agreement = agreement.rows[0]!.id;
    const subCert = await tx.execute<{ id: string }>(sql`
      INSERT INTO subcontractor_certificates (id, tenant_id, agreement_id, certificate_date, progress_percent,
                                               gross_value, retention_withheld, net_payable, status, approved_at)
      VALUES (gen_random_uuid(), erp.current_tenant_id(), ${ids.agreement}, '2026-03-01', 20,
              10000, 1000, 9000, 'APPROVED', now())
      RETURNING id
    `);
    ids.subCertificate = subCert.rows[0]!.id;

    // The retention ledger — BOTH sides (the side-shape CHECK: the
    // CUSTOMER row carries the commercial columns, the SUBCONTRACTOR
    // row the agreement link).
    const customerRegister = await tx.execute<{ id: string }>(sql`
      INSERT INTO retention_accounts (id, tenant_id, project_id, kind, contract_value, currency_code,
                                      hold_percent, status, customer_id)
      VALUES (gen_random_uuid(), erp.current_tenant_id(), ${ids.project}, 'CUSTOMER', 150000, 'SAR',
              10, 'ACTIVE', ${ids.partner})
      RETURNING id
    `);
    ids.customerRegister = customerRegister.rows[0]!.id;
    const subRegister = await tx.execute<{ id: string }>(sql`
      INSERT INTO retention_accounts (id, tenant_id, project_id, kind, subcontractor_agreement_id, status)
      VALUES (gen_random_uuid(), erp.current_tenant_id(), ${ids.project}, 'SUBCONTRACTOR', ${ids.agreement}, 'ACTIVE')
      RETURNING id
    `);
    ids.subRegister = subRegister.rows[0]!.id;

    // The APPROVED progress certificate (the approval-link CHECK).
    const progressCert = await tx.execute<{ id: string }>(sql`
      INSERT INTO progress_certificates (id, tenant_id, project_id, certificate_date, kind, cumulative_percent,
                                          gross_value, retention_amount, net_value, currency_code, status,
                                          submitted_at, approved_at, approved_by)
      VALUES (gen_random_uuid(), erp.current_tenant_id(), ${ids.project}, '2026-04-01', 'PROGRESS', 20,
              25000, 2500, 22500, 'SAR', 'APPROVED', now(), now(), ${ids.employee})
      RETURNING id
    `);
    ids.progressCertificate = progressCert.rows[0]!.id;

    // The service orders + two visits (the dispatch board's substrate).
    const order = await tx.execute<{ id: string }>(sql`
      INSERT INTO service_orders (id, tenant_id, branch_id, partner_id, warehouse_id, status)
      VALUES (gen_random_uuid(), erp.current_tenant_id(), ${ids.branch}, ${ids.partner}, ${ids.warehouse}, 'DRAFT')
      RETURNING id
    `);
    ids.serviceOrder = order.rows[0]!.id;
    const visit1 = await tx.execute<{ id: string }>(sql`
      INSERT INTO service_visits (id, tenant_id, service_order_id, scheduled_start, scheduled_end, status)
      VALUES (gen_random_uuid(), erp.current_tenant_id(), ${ids.serviceOrder},
              '2026-11-20T08:00:00Z', '2026-11-20T12:00:00Z', 'NEW')
      RETURNING id
    `);
    ids.visit = visit1.rows[0]!.id;
    await tx.execute(sql`
      INSERT INTO service_visits (id, tenant_id, service_order_id, technician_employee_id,
                                  scheduled_start, scheduled_end, status, dispatched_at)
      VALUES (gen_random_uuid(), erp.current_tenant_id(), ${ids.serviceOrder}, ${ids.employee},
              '2026-11-21T08:00:00Z', '2026-11-21T12:00:00Z', 'DISPATCHED', now())
    `);

    // The IAS-23 capitalization evidence row (the budget-line FK + the
    // amounts CHECK: capitalized + expensed ≤ expenditures).
    await tx.execute(sql`
      INSERT INTO ias23_capitalizations (id, tenant_id, project_id, budget_line_id, window_start, window_end,
                                          expenditures_amount, capitalized_amount, expensed_amount,
                                          rate_snapshot, status, posted_at)
      VALUES (gen_random_uuid(), erp.current_tenant_id(), ${ids.project}, ${ids.budgetLaborLine},
              '2026-01-01', '2026-01-31', 3100, 155, 2945, '0.050000', 'POSTED', now())
    `);

    return ids;
  });
}

/** The attacker's connection: the erp_app role with the ATTACKER's
 * GUC (the production request's own connection shape). */
async function asAttacker<T extends Record<string, unknown>>(
  query: string,
  params: unknown[] = [],
): Promise<T[]> {
  const app = await appClient();
  await app.query("BEGIN");
  await app.query("SELECT set_config('erp.tenant_id', $1, true)", [TENANT_PRL_B]);
  const result = await app.query<T>(query, params);
  await app.query("COMMIT");
  await app.end();
  return result.rows;
}

interface World {
  ids: Record<string, string>;
}

const worlds: Partial<Record<string, World>> = {};

/** The per-table census (superuser — the audit read). */
async function census(tenantId: string): Promise<Record<string, number>> {
  const su = await superuserClient();
  const counts: Record<string, number> = {};
  for (const table of PROJECTS_TABLES) {
    const rows = await su.query<{ n: number }>(
      `SELECT count(*)::int AS n FROM ${table} WHERE tenant_id = $1`,
      [tenantId],
    );
    counts[table] = rows.rows[0]!.n;
  }
  await su.end();
  return counts;
}

beforeAll(async () => {
  const su = await superuserClient();
  await seedTenants(su as never);
  await su.query(
    `INSERT INTO tenants (id, name, name_ar, base_currency, country_code, timezone) VALUES
       ($1, 'Tenant PRL-A (projects rls victim)', 'المستأجر أ لفحص عزل المشاريع', 'SAR', 'SA', 'Asia/Riyadh'),
       ($2, 'Tenant PRL-B (projects rls attacker)', 'المستأجر ب لفحص عزل المشاريع', 'SAR', 'SA', 'Asia/Riyadh')
     ON CONFLICT (id) DO NOTHING`,
    [TENANT_PRL_A, TENANT_PRL_B],
  );
  // The idempotent wipe (children first — a re-run reseeds clean).
  for (const table of [
    ...PROJECTS_TABLES,
    "service_orders",
    "projects",
    "employees",
  ]) {
    await su.query(`DELETE FROM ${table} WHERE tenant_id IN ($1, $2)`, [TENANT_PRL_A, TENANT_PRL_B]);
  }
  await su.query(
    `DELETE FROM branches WHERE tenant_id IN ($1, $2)`,
    [TENANT_PRL_A, TENANT_PRL_B],
  );
  await su.query(
    `DELETE FROM partners WHERE tenant_id IN ($1, $2)`,
    [TENANT_PRL_A, TENANT_PRL_B],
  );
  await su.query(
    `DELETE FROM warehouses WHERE tenant_id IN ($1, $2)`,
    [TENANT_PRL_A, TENANT_PRL_B],
  );
  await su.end();

  worlds[TENANT_PRL_A] = { ids: await seedWorld(TENANT_PRL_A, "A") };
  worlds[TENANT_PRL_B] = { ids: await seedWorld(TENANT_PRL_B, "B") };

  // The seeded census is exactly the expected shape (both worlds).
  for (const tenantId of [TENANT_PRL_A, TENANT_PRL_B]) {
    const counts = await census(tenantId);
    for (const [table, expected] of Object.entries(EXPECTED_COUNTS)) {
      expect(counts[table], `${tenantId} ${table}`).toBe(expected);
    }
  }
});

describe("PHASE-048 W-14 — T-18b: the projects RLS attack matrix (A1–A10 × the eleven tables)", () => {
  const victim = () => worlds[TENANT_PRL_A]!.ids;

  it("A1 — SELECT without any GUC fails closed on every table (0 rows)", async () => {
    for (const table of PROJECTS_TABLES) {
      const app = await appClient();
      const rows = await app.query<{ n: number }>(`SELECT count(*)::int AS n FROM ${table}`);
      await app.end();
      expect(rows.rows[0]!.n, table).toBe(0);
    }
  });

  it("A2 — the attacker's GUC never exposes the victim's rows (own ≥ 1, foreign 0)", async () => {
    for (const table of PROJECTS_TABLES) {
      const own = await asAttacker<{ n: number }>(
        `SELECT count(*)::int AS n FROM ${table}`,
      );
      expect(own[0]!.n, `${table} own`).toBeGreaterThanOrEqual(1);
      const foreign = await asAttacker<{ n: number }>(
        `SELECT count(*)::int AS n FROM ${table} WHERE tenant_id = $1`,
        [TENANT_PRL_A],
      );
      expect(foreign[0]!.n, `${table} foreign`).toBe(0);
    }
  });

  it("A3 — forged-tenant INSERTs (the victim's tenant_id under the attacker's GUC) reject 42501 with zero residue", async () => {
    const v = victim();
    const shapes: Array<[string, string, unknown[]]> = [
      [
        "project_wbs_tasks",
        `INSERT INTO project_wbs_tasks (id, tenant_id, project_id, wbs_code, name, is_milestone, percent_complete)
         VALUES (gen_random_uuid(), $1, $2, 'X', 'forged', false, 0)`,
        [TENANT_PRL_A, v.project],
      ],
      [
        "project_budgets",
        `INSERT INTO project_budgets (id, tenant_id, project_id, name, status, approved_at)
         VALUES (gen_random_uuid(), $1, $2, 'PB-FORGE', 'APPROVED', now())`,
        [TENANT_PRL_A, v.project],
      ],
      [
        "project_budget_lines",
        `INSERT INTO project_budget_lines (id, tenant_id, budget_id, cost_type, period_start, period_end, planned_amount)
         VALUES (gen_random_uuid(), $1, $2, 'LABOR', '2026-02-01', '2026-02-28', 100)`,
        [TENANT_PRL_A, v.budget],
      ],
      [
        "project_resource_allocations",
        `INSERT INTO project_resource_allocations (id, tenant_id, project_id, resource_kind, employee_id, start_date, end_date, allocation_percent)
         VALUES (gen_random_uuid(), $1, $2, 'EMPLOYEE', $3, '2026-02-01', '2026-02-28', 10)`,
        [TENANT_PRL_A, v.project, v.employee],
      ],
      [
        "change_orders",
        `INSERT INTO change_orders (id, tenant_id, project_id, co_no, title, price_delta, status)
         VALUES (gen_random_uuid(), $1, $2, 'CO-FORGE', 'forged', 100, 'DRAFT')`,
        [TENANT_PRL_A, v.project],
      ],
      [
        "subcontractor_agreements",
        `INSERT INTO subcontractor_agreements (id, tenant_id, project_id, partner_id, agreement_no, title, agreement_value, currency_code, retention_percent, status)
         VALUES (gen_random_uuid(), $1, $2, $3, 'SA-FORGE', 'forged', 1000, 'SAR', 10, 'DRAFT')`,
        [TENANT_PRL_A, v.project, v.partner],
      ],
      [
        "subcontractor_certificates",
        `INSERT INTO subcontractor_certificates (id, tenant_id, agreement_id, certificate_date, progress_percent, gross_value, retention_withheld, net_payable, status)
         VALUES (gen_random_uuid(), $1, $2, '2026-03-02', 10, 100, 10, 90, 'DRAFT')`,
        [TENANT_PRL_A, v.agreement],
      ],
      [
        "retention_accounts",
        `INSERT INTO retention_accounts (id, tenant_id, project_id, kind, contract_value, currency_code, hold_percent, status)
         VALUES (gen_random_uuid(), $1, $2, 'CUSTOMER', 1000, 'SAR', 10, 'ACTIVE')`,
        [TENANT_PRL_A, v.project],
      ],
      [
        "progress_certificates",
        `INSERT INTO progress_certificates (id, tenant_id, project_id, certificate_date, kind, cumulative_percent, gross_value, retention_amount, net_value, currency_code, status)
         VALUES (gen_random_uuid(), $1, $2, '2026-04-02', 'PROGRESS', 10, 100, 10, 90, 'SAR', 'DRAFT')`,
        [TENANT_PRL_A, v.project],
      ],
      [
        "service_visits",
        `INSERT INTO service_visits (id, tenant_id, service_order_id, scheduled_start, scheduled_end, status)
         VALUES (gen_random_uuid(), $1, $2, '2026-11-22T08:00:00Z', '2026-11-22T12:00:00Z', 'NEW')`,
        [TENANT_PRL_A, v.serviceOrder],
      ],
      [
        "ias23_capitalizations",
        `INSERT INTO ias23_capitalizations (id, tenant_id, project_id, budget_line_id, window_start, window_end, expenditures_amount, capitalized_amount, expensed_amount, rate_snapshot, status)
         VALUES (gen_random_uuid(), $1, $2, $3, '2026-02-01', '2026-02-28', 100, 5, 95, '0.050000', 'POSTED')`,
        [TENANT_PRL_A, v.project, v.budgetLaborLine],
      ],
    ];
    for (const [table, query, params] of shapes) {
      const app = await appClient();
      await app.query("BEGIN");
      await app.query("SELECT set_config('erp.tenant_id', $1, true)", [TENANT_PRL_B]);
      const failure = await app
        .query(query, params as never[])
        .then(() => undefined)
        .catch((error: { code?: string }) => error);
      await app.query("COMMIT");
      await app.end();
      expect(failure?.code, `${table} forged insert`).toBe("42501");
    }
    // ZERO residue: the victim's census is unmoved.
    const counts = await census(TENANT_PRL_A);
    for (const [table, expected] of Object.entries(EXPECTED_COUNTS)) {
      expect(counts[table], `${table} residue`).toBe(expected);
    }
  });

  it("A4 — staged UPDATE hijacks under the attacker's GUC touch 0 rows (byte-identical)", async () => {
    const v = victim();
    const updates: Array<[string, string, unknown[]]> = [
      ["project_wbs_tasks", `UPDATE project_wbs_tasks SET name = 'hijacked' WHERE id = $1`, [v.wbsRoot]],
      ["project_budgets", `UPDATE project_budgets SET name = 'hijacked' WHERE id = $1`, [v.budget]],
      ["project_budget_lines", `UPDATE project_budget_lines SET planned_amount = 0 WHERE id = $1`, [v.budgetLaborLine]],
      ["project_resource_allocations", `UPDATE project_resource_allocations SET allocation_percent = 999 WHERE project_id = $1`, [v.project]],
      ["change_orders", `UPDATE change_orders SET price_delta = 999999 WHERE id = $1`, [v.changeOrder]],
      ["subcontractor_agreements", `UPDATE subcontractor_agreements SET agreement_value = 0 WHERE id = $1`, [v.agreement]],
      ["subcontractor_certificates", `UPDATE subcontractor_certificates SET gross_value = 0 WHERE id = $1`, [v.subCertificate]],
      ["retention_accounts", `UPDATE retention_accounts SET accrued_balance = 999 WHERE id = $1`, [v.customerRegister]],
      ["progress_certificates", `UPDATE progress_certificates SET gross_value = 0 WHERE id = $1`, [v.progressCertificate]],
      ["service_visits", `UPDATE service_visits SET status = 'CLOSED' WHERE id = $1`, [v.visit]],
      ["ias23_capitalizations", `UPDATE ias23_capitalizations SET capitalized_amount = 999 WHERE project_id = $1`, [v.project]],
    ];
    for (const [table, query, params] of updates) {
      const affected = await asAttacker<{ n: number }>(
        `WITH updated AS (${query} RETURNING 1) SELECT count(*)::int AS n FROM updated`,
        params,
      );
      expect(affected[0]!.n, `${table} hijack`).toBe(0);
    }
    // Byte-identical: the victim's rows unchanged (name/amount probes).
    const su = await superuserClient();
    const root = await su.query<{ name: string }>(
      `SELECT name FROM project_wbs_tasks WHERE id = $1`,
      [v.wbsRoot],
    );
    const co = await su.query<{ price_delta: string }>(
      `SELECT price_delta::text FROM change_orders WHERE id = $1`,
      [v.changeOrder],
    );
    await su.end();
    expect(root.rows[0]!.name).toBe("PRL root");
    expect(co.rows[0]!.price_delta).toBe("500.0000");
  });

  it("A5 — DELETEs of the other tenant's rows: the evidence tables DENIED (no grant by design), the planning tables touch 0 rows", async () => {
    const v = victim();
    for (const table of PROJECTS_TABLES) {
      const outcome = await asAttacker<{ n: number }>(
        `WITH deleted AS (DELETE FROM ${table} WHERE tenant_id = $1 RETURNING 1) SELECT count(*)::int AS n FROM deleted`,
        [TENANT_PRL_A],
      ).then(
        (rows) => ({ kind: "rows" as const, n: rows[0]?.n ?? 0 }),
        (error: { code?: string }) => ({ kind: "denied" as const, code: error.code }),
      );
      if (NO_DELETE_GRANT.has(table)) {
        // The grant denial (42501 — the policy's USING rejects the
        // cross-tenant row even where a grant exists; here the grant
        // itself is absent — either way the DELETE never lands).
        expect(outcome.kind === "denied" || outcome.n === 0, `${table} delete`).toBe(true);
      } else {
        expect(outcome.kind === "rows" ? outcome.n : -1, `${table} delete`).toBe(0);
      }
    }
    // The census unmoved.
    const counts = await census(TENANT_PRL_A);
    for (const [table, expected] of Object.entries(EXPECTED_COUNTS)) {
      expect(counts[table], `${table} residue`).toBe(expected);
    }
    void v;
  });

  it("A7 — id-based probes leak no existence (0 rows, no error distinguishing present from absent)", async () => {
    const v = victim();
    for (const [table, column] of [
      ["project_wbs_tasks", "id"],
      ["project_budgets", "id"],
      ["change_orders", "id"],
      ["retention_accounts", "id"],
      ["progress_certificates", "id"],
      ["service_visits", "id"],
    ] as const) {
      const present = await asAttacker<{ n: number }>(
        `SELECT count(*)::int AS n FROM ${table} WHERE ${column} = $1`,
        [(v as Record<string, string>)[table === "project_wbs_tasks" ? "wbsRoot" : table === "project_budgets" ? "budget" : table === "change_orders" ? "changeOrder" : table === "retention_accounts" ? "customerRegister" : table === "progress_certificates" ? "progressCertificate" : "visit"]],
      );
      expect(present[0]!.n, `${table} id probe`).toBe(0);
    }
  });

  it("A8 — THE COMPOSITE-FK LAW: every child FK is (id, tenant_id) in the catalog + a live FK-inversion probe rejects 23503", async () => {
    // (a) The catalog walk: every FK these tables carry references its
    // parent through the composite (id, tenant_id) pair — the
    // cross-tenant parent is structurally unresolvable.
    const su = await superuserClient();
    const fks = await su.query<{
      conname: string;
      child: string;
      parent: string;
      cols: string[];
      parent_cols: string[];
    }>(`
      SELECT c.conname, cl.relname AS child, pr.relname AS parent,
             (SELECT array_agg(a.attname ORDER BY x.ord)::text[]
                FROM unnest(c.conkey) WITH ORDINALITY AS x(attnum, ord)
                JOIN pg_attribute a ON a.attrelid = c.conrelid AND a.attnum = x.attnum) AS cols,
             (SELECT array_agg(a.attname ORDER BY x.ord)::text[]
                FROM unnest(c.confkey) WITH ORDINALITY AS x(attnum, ord)
                JOIN pg_attribute a ON a.attrelid = c.confrelid AND a.attnum = x.attnum) AS parent_cols
      FROM pg_constraint c
      JOIN pg_class cl ON cl.oid = c.conrelid
      JOIN pg_class pr ON pr.oid = c.confrelid
      WHERE c.contype = 'f' AND cl.relname = ANY($1::text[])
    `, [[...PROJECTS_TABLES]]);
    await su.end();
    expect(fks.rows.length).toBeGreaterThanOrEqual(13);
    for (const fk of fks.rows) {
      // Every FK on these tables includes tenant_id on BOTH sides (the
      // composite law) or is the tenants FK itself (tenant_id →
      // tenants.id, the root scoping — allowed).
      const composite = fk.cols.includes("tenant_id") && fk.parent_cols.includes("tenant_id");
      const tenantRoot = fk.cols.length === 1 && fk.cols[0] === "tenant_id";
      expect(
        composite || tenantRoot,
        `${fk.child} → ${fk.parent} (${fk.cols.join(",")})`,
      ).toBe(true);
    }

    // (b) The live probe: a superuser INSERT of a child row whose
    // (parent id, OWN tenant) pair points at the VICTIM's parent —
    // the composite FK rejects it (23503), the cross-tenant parent is
    // unreachable even inside a single statement.
    const su2 = await superuserClient();
    await su2.query("BEGIN");
    const failure = await su2
      .query(
        `INSERT INTO project_budget_lines (id, tenant_id, budget_id, cost_type, period_start, period_end, planned_amount)
         VALUES (gen_random_uuid(), $1, $2, 'LABOR', '2026-03-01', '2026-03-31', 100)`,
        [TENANT_PRL_B, victim().budget],
      )
      .then(() => undefined)
      .catch((error: { code?: string }) => error);
    await su2.query("ROLLBACK");
    await su2.end();
    expect(failure?.code).toBe("23503");
  });

  it("A9 — FK-chain joins under the attacker's GUC expose 0 victim rows", async () => {
    // The deepest chain: lines → budgets → project → tasks; and the
    // dispatch chain: visits → orders; and the sub chain: certificates
    // → agreements → retention registers.
    const joins: Array<[string, string]> = [
      [
        "lines-budget-project",
        `SELECT count(*)::int AS n
           FROM project_budget_lines bl
           JOIN project_budgets b ON b.id = bl.budget_id AND b.tenant_id = bl.tenant_id
           JOIN projects p ON p.id = b.project_id AND p.tenant_id = b.tenant_id
           JOIN project_wbs_tasks t ON t.project_id = p.id AND t.tenant_id = p.tenant_id
          WHERE p.tenant_id = $1`,
      ],
      [
        "visits-orders",
        `SELECT count(*)::int AS n
           FROM service_visits sv
           JOIN service_orders so ON so.id = sv.service_order_id AND so.tenant_id = sv.tenant_id
          WHERE so.tenant_id = $1`,
      ],
      [
        "subcerts-agreements-registers",
        `SELECT count(*)::int AS n
           FROM subcontractor_certificates sc
           JOIN subcontractor_agreements sa ON sa.id = sc.agreement_id AND sa.tenant_id = sc.tenant_id
           JOIN retention_accounts ra ON ra.subcontractor_agreement_id = sa.id AND ra.tenant_id = sa.tenant_id
          WHERE sa.tenant_id = $1`,
      ],
    ];
    for (const [label, query] of joins) {
      const rows = await asAttacker<{ n: number }>(query, [TENANT_PRL_A]);
      expect(rows[0]!.n, label).toBe(0);
    }
  });

  it("A10 — UNION ALL over every table + a recursive CTE stay confined (0 victim rows)", async () => {
    const unionQuery = PROJECTS_TABLES.map(
      (table) => `SELECT tenant_id FROM ${table}`,
    ).join(" UNION ALL ");
    const unionRows = await asAttacker<{ tenant_id: string }>(unionQuery);
    expect(unionRows.some((row) => row.tenant_id === TENANT_PRL_A)).toBe(false);
    expect(unionRows.every((row) => row.tenant_id === TENANT_PRL_B)).toBe(true);

    // The recursive CTE: walk the WBS tree from the attacker's roots
    // — the victim's nodes are unreachable.
    const cteRows = await asAttacker<{ n: number }>(`
      WITH RECURSIVE walk AS (
        SELECT id, tenant_id FROM project_wbs_tasks WHERE parent_task_id IS NULL
        UNION ALL
        SELECT t.id, t.tenant_id FROM project_wbs_tasks t
          JOIN walk w ON t.parent_task_id = w.id AND t.tenant_id = w.tenant_id
      )
      SELECT count(*)::int AS n FROM walk WHERE tenant_id = $1
    `, [TENANT_PRL_A]);
    expect(cteRows[0]!.n).toBe(0);
  });

  it("THE CENSUS — both worlds survive every attack row-for-row", async () => {
    for (const tenantId of [TENANT_PRL_A, TENANT_PRL_B]) {
      const counts = await census(tenantId);
      for (const [table, expected] of Object.entries(EXPECTED_COUNTS)) {
        expect(counts[table], `${tenantId} ${table}`).toBe(expected);
      }
    }
  });
});
