import { beforeAll, describe, expect, it } from "vitest";

import { withTenant } from "../../infra/db/tenant-context";
import { appClient, seedTenants, superuserClient } from "../test-db";

/**
 * PHASE-049 (W-22 — T-17b, dated 2026-11-22) · `cmms-rls.db.spec` —
 * THE RLS ATTACK MATRIX A1–A10 over the TEN CMMS FAMILY TABLES (the
 * 0105–0109 family — the plan's eight new tables PLUS the two 0109
 * D-02 tables; the projects-rls template, the family-deep edition):
 * two DEDICATED probe tenants (a victim and an attacker — never the
 * shared suites' registers), each seeded with a FULL FK-CHAINED CMMS
 * world through the APP-ROLE path (withTenant + the ambient
 * transaction — the erp_app role the production request rides, never
 * superuser), and the attacker's connection running the attack shapes
 * against every table:
 *
 * A1 no-GUC reads fail closed · A2 the attacker's GUC never exposes
 * the victim's rows · A3 forged-tenant INSERTs reject 42501 with zero
 * residue · A4 staged UPDATE hijacks touch 0 rows byte-identically ·
 * A5 DELETEs of the other tenant's rows are denied (the evidence
 * tables carry no grant by design — the orders/readings/transfers/
 * steps) or touch 0 rows (the master-data tables) · A7 id-probes leak
 * no existence · A8 THE COMPOSITE-FK LAW (the pg_constraint catalog
 * walk — every child FK is (id, tenant_id) or the tenants root + a
 * live FK-inversion probe rejects 23503) · A9 the FK-chain joins stay
 * confined · A10 UNION ALL + a recursive CTE stay confined — and the
 * final census: BOTH worlds survive every attack row-for-row.
 */

const TENANT_CRL_A = "3c3c3c3c-0000-4000-8000-00000000711a"; // the victim
const TENANT_CRL_B = "3c3c3c3c-0000-4000-8000-00000000711b"; // the attacker

/** The TEN CMMS family tables (0105–0109) — the attack surface. */
const CMMS_TABLES = [
  "maintenance_work_orders",
  "maintenance_plans",
  "maintenance_plan_tasks",
  "maintenance_cost_lines",
  "maintenance_work_order_steps",
  "asset_meters",
  "asset_meter_readings",
  "asset_spares",
  "asset_transfers",
  "asset_tags",
] as const;

/** The evidence-discipline tables — DELETE carries NO grant by design
 * (the order history is the timeline's spine; the readings log and the
 * carried steps are the machine's own record; the transfers are the
 * approval's evidence — A5 asserts the denial). */
const NO_DELETE_GRANT = new Set([
  "maintenance_work_orders",
  "asset_meter_readings",
  "maintenance_work_order_steps",
  "asset_transfers",
]);

/** The expected per-table census after seeding (per tenant). */
const EXPECTED_COUNTS: Readonly<Record<(typeof CMMS_TABLES)[number], number>> = {
  maintenance_work_orders: 2,
  maintenance_plans: 1,
  maintenance_plan_tasks: 1,
  maintenance_cost_lines: 1,
  maintenance_work_order_steps: 1,
  asset_meters: 1,
  asset_meter_readings: 2,
  asset_spares: 1,
  asset_transfers: 1,
  asset_tags: 1,
};

/** Seed one tenant's FULL FK-chained CMMS world through the app-role
 * path (the erp_app role + erp.current_tenant_id() — never superuser;
 * the production request's own path). */
async function seedWorld(tenantId: string, tag: string): Promise<Record<string, string>> {
  return withTenant(tenantId, async () => {
    const { sql } = await import("drizzle-orm");
    const { requireTenantContext } = await import("../../infra/db/tenant-context");
    const tx = requireTenantContext().tx!;
    const ids: Record<string, string> = {};

    // The substrate rows the FK chains need (branches ×2 — the
    // transfer's both sides, the category, the asset, the employee,
    // the partner, the uom + item + warehouse — the spare's chain).
    const branch1 = await tx.execute<{ id: string }>(sql`
      INSERT INTO branches (id, tenant_id, code, name, name_ar)
      VALUES (gen_random_uuid(), erp.current_tenant_id(), ${`BR-CRL-${tag}`}, 'CRL branch 1',
              'فرع الفحص ١')
      ON CONFLICT (tenant_id, code) DO UPDATE SET name = EXCLUDED.name RETURNING id
    `);
    ids.branch1 = branch1.rows[0]!.id;
    const branch2 = await tx.execute<{ id: string }>(sql`
      INSERT INTO branches (id, tenant_id, code, name, name_ar)
      VALUES (gen_random_uuid(), erp.current_tenant_id(), ${`BR-CRL2-${tag}`}, 'CRL branch 2',
              'فرع الفحص ٢')
      ON CONFLICT (tenant_id, code) DO UPDATE SET name = EXCLUDED.name RETURNING id
    `);
    ids.branch2 = branch2.rows[0]!.id;

    const category = await tx.execute<{ id: string }>(sql`
      INSERT INTO asset_categories (id, tenant_id, code, name, name_ar, useful_life_months_default)
      VALUES (gen_random_uuid(), erp.current_tenant_id(), ${`CAT-CRL-${tag}`}, 'CRL equipment',
              'معدات الفحص', 60)
      ON CONFLICT (tenant_id, code) DO UPDATE SET name = EXCLUDED.name RETURNING id
    `);
    ids.category = category.rows[0]!.id;

    const asset = await tx.execute<{ id: string }>(sql`
      INSERT INTO assets (id, tenant_id, code, name, name_ar, category_id, acquisition_date, cost,
                          useful_life_months, branch_id)
      VALUES (gen_random_uuid(), erp.current_tenant_id(), ${`AS-CRL-${tag}`}, 'The CRL asset',
              'أصل الفحص', ${ids.category}, '2026-01-01', 50000, 60, ${ids.branch1})
      ON CONFLICT (tenant_id, code) DO UPDATE SET name = EXCLUDED.name RETURNING id
    `);
    ids.asset = asset.rows[0]!.id;

    const employee = await tx.execute<{ id: string }>(sql`
      INSERT INTO employees (id, tenant_id, code, name, hire_date, contract_type, basic_salary, status)
      VALUES (gen_random_uuid(), erp.current_tenant_id(), ${`EMP-CRL-${tag}`}, 'CRL technician',
              '2026-01-01', 'FULL_TIME', 8000, 'ACTIVE')
      ON CONFLICT (tenant_id, code) DO UPDATE SET name = EXCLUDED.name RETURNING id
    `);
    ids.employee = employee.rows[0]!.id;

    const partner = await tx.execute<{ id: string }>(sql`
      INSERT INTO partners (id, tenant_id, kind, code, name)
      VALUES (gen_random_uuid(), erp.current_tenant_id(), 'SUPPLIER', ${`PT-CRL-${tag}`}, 'CRL supplier')
      ON CONFLICT (tenant_id, code) DO UPDATE SET name = EXCLUDED.name RETURNING id
    `);
    ids.partner = partner.rows[0]!.id;

    const uom = await tx.execute<{ id: string }>(sql`
      INSERT INTO uoms (id, tenant_id, code, name)
      VALUES (gen_random_uuid(), erp.current_tenant_id(), ${`UOM-CRL-${tag}`}, 'CRL pieces')
      ON CONFLICT (tenant_id, code) DO UPDATE SET name = EXCLUDED.name RETURNING id
    `);
    ids.uom = uom.rows[0]!.id;
    const item = await tx.execute<{ id: string }>(sql`
      INSERT INTO items (id, tenant_id, sku, name, kind, uom_id, costing_method, base_price)
      VALUES (gen_random_uuid(), erp.current_tenant_id(), ${`ITM-CRL-${tag}`}, 'CRL spare', 'STOCK',
              ${ids.uom}, 'WAC', 10)
      ON CONFLICT (tenant_id, sku) DO UPDATE SET name = EXCLUDED.name RETURNING id
    `);
    ids.item = item.rows[0]!.id;
    const warehouse = await tx.execute<{ id: string }>(sql`
      INSERT INTO warehouses (id, tenant_id, branch_id, code, name)
      VALUES (gen_random_uuid(), erp.current_tenant_id(), ${ids.branch1}, ${`WH-CRL-${tag}`}, 'CRL warehouse')
      ON CONFLICT (tenant_id, code) DO UPDATE SET name = EXCLUDED.name RETURNING id
    `);
    ids.warehouse = warehouse.rows[0]!.id;

    // The work orders (one REQUESTED + one IN_PROGRESS with both the
    // plan and the start stamps — the stamp law's own shape).
    const order1 = await tx.execute<{ id: string }>(sql`
      INSERT INTO maintenance_work_orders (id, tenant_id, asset_id, order_no, problem, priority,
                                            status, technician_employee_id)
      VALUES (gen_random_uuid(), erp.current_tenant_id(), ${ids.asset}, ${`MO-CRL-${tag}-1`},
              'CRL request', 'MEDIUM', 'REQUESTED', ${ids.employee})
      RETURNING id
    `);
    ids.order1 = order1.rows[0]!.id;
    const order2 = await tx.execute<{ id: string }>(sql`
      INSERT INTO maintenance_work_orders (id, tenant_id, asset_id, order_no, problem, priority,
                                            status, technician_employee_id, planned_at, started_at)
      VALUES (gen_random_uuid(), erp.current_tenant_id(), ${ids.asset}, ${`MO-CRL-${tag}-2`},
              'CRL started', 'HIGH', 'IN_PROGRESS', ${ids.employee}, now(), now())
      RETURNING id
    `);
    ids.order2 = order2.rows[0]!.id;

    // The plan + its task (the CALENDAR trigger's XOR shape).
    const plan = await tx.execute<{ id: string }>(sql`
      INSERT INTO maintenance_plans (id, tenant_id, asset_id, name, trigger_type, interval_days,
                                      next_due_date, is_active)
      VALUES (gen_random_uuid(), erp.current_tenant_id(), ${ids.asset}, 'CRL plan', 'CALENDAR', 30,
              '2026-12-01', true)
      RETURNING id
    `);
    ids.plan = plan.rows[0]!.id;
    const task = await tx.execute<{ id: string }>(sql`
      INSERT INTO maintenance_plan_tasks (id, tenant_id, plan_id, seq, title)
      VALUES (gen_random_uuid(), erp.current_tenant_id(), ${ids.plan}, 1, 'CRL task')
      RETURNING id
    `);
    ids.task = task.rows[0]!.id;

    // The cost line (the EXTERNAL leg's XOR shape — the supplier link).
    await tx.execute(sql`
      INSERT INTO maintenance_cost_lines (id, tenant_id, work_order_id, line_no, leg_type,
                                           partner_id, amount)
      VALUES (gen_random_uuid(), erp.current_tenant_id(), ${ids.order2}, 1, 'EXTERNAL',
              ${ids.partner}, 100)
    `);

    // The carried step (the task snapshot — the BR-098 gate's own row).
    await tx.execute(sql`
      INSERT INTO maintenance_work_order_steps (id, tenant_id, work_order_id, source_task_id,
                                                  seq, title)
      VALUES (gen_random_uuid(), erp.current_tenant_id(), ${ids.order2}, ${ids.task}, 1, 'CRL step')
    `);

    // The meter + two readings (one MANUAL + one JOB linked to the
    // started order — the JOB-source law's own shape).
    const meter = await tx.execute<{ id: string }>(sql`
      INSERT INTO asset_meters (id, tenant_id, asset_id, name, type, unit, is_odometer, last_value)
      VALUES (gen_random_uuid(), erp.current_tenant_id(), ${ids.asset}, 'CRL hours', 'HOURS', 'h',
              false, 200)
      RETURNING id
    `);
    ids.meter = meter.rows[0]!.id;
    await tx.execute(sql`
      INSERT INTO asset_meter_readings (id, tenant_id, meter_id, value, effective_date, source)
      VALUES (gen_random_uuid(), erp.current_tenant_id(), ${ids.meter}, 100, '2026-02-01', 'MANUAL')
    `);
    await tx.execute(sql`
      INSERT INTO asset_meter_readings (id, tenant_id, meter_id, value, effective_date, source,
                                         work_order_id)
      VALUES (gen_random_uuid(), erp.current_tenant_id(), ${ids.meter}, 200, '2026-03-01', 'JOB',
              ${ids.order2})
    `);

    // The spare (the BOM row — the item chain).
    await tx.execute(sql`
      INSERT INTO asset_spares (id, tenant_id, asset_id, item_id, qty)
      VALUES (gen_random_uuid(), erp.current_tenant_id(), ${ids.asset}, ${ids.item}, 2)
    `);

    // The transfer (DRAFT — the ladder's own first state, both branches).
    const transfer = await tx.execute<{ id: string }>(sql`
      INSERT INTO asset_transfers (id, tenant_id, asset_id, from_branch_id, to_branch_id, reason,
                                    status)
      VALUES (gen_random_uuid(), erp.current_tenant_id(), ${ids.asset}, ${ids.branch1},
              ${ids.branch2}, 'CRL relocation', 'DRAFT')
      RETURNING id
    `);
    ids.transfer = transfer.rows[0]!.id;

    // The tag (the signed-code register's row — the code-length floor).
    const tagRow = await tx.execute<{ id: string }>(sql`
      INSERT INTO asset_tags (id, tenant_id, asset_id, code)
      VALUES (gen_random_uuid(), erp.current_tenant_id(), ${ids.asset},
              ${`crl-${tag}-0123456789abcdef`})
      RETURNING id
    `);
    ids.tag = tagRow.rows[0]!.id;

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
  await app.query("SELECT set_config('erp.tenant_id', $1, true)", [TENANT_CRL_B]);
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
  for (const table of CMMS_TABLES) {
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
       ($1, 'Tenant CRL-A (cmms rls victim)', 'المستأجر أ لفحص عزل الصيانة', 'SAR', 'SA', 'Asia/Riyadh'),
       ($2, 'Tenant CRL-B (cmms rls attacker)', 'المستأجر ب لفحص عزل الصيانة', 'SAR', 'SA', 'Asia/Riyadh')
     ON CONFLICT (id) DO NOTHING`,
    [TENANT_CRL_A, TENANT_CRL_B],
  );
  // The idempotent wipe (children first — a re-run reseeds clean).
  for (const table of [
    ...CMMS_TABLES,
    "assets",
    "asset_categories",
    "warehouses",
    "items",
    "uoms",
    "employees",
  ]) {
    await su.query(`DELETE FROM ${table} WHERE tenant_id IN ($1, $2)`, [TENANT_CRL_A, TENANT_CRL_B]);
  }
  for (const table of ["partners", "branches"]) {
    await su.query(`DELETE FROM ${table} WHERE tenant_id IN ($1, $2)`, [TENANT_CRL_A, TENANT_CRL_B]);
  }
  await su.end();

  worlds[TENANT_CRL_A] = { ids: await seedWorld(TENANT_CRL_A, "A") };
  worlds[TENANT_CRL_B] = { ids: await seedWorld(TENANT_CRL_B, "B") };

  // The seeded census is exactly the expected shape (both worlds).
  for (const tenantId of [TENANT_CRL_A, TENANT_CRL_B]) {
    const counts = await census(tenantId);
    for (const [table, expected] of Object.entries(EXPECTED_COUNTS)) {
      expect(counts[table], `${tenantId} ${table}`).toBe(expected);
    }
  }
});

describe("PHASE-049 W-22 — T-17b: the CMMS RLS attack matrix (A1–A10 × the ten family tables)", () => {
  const victim = () => worlds[TENANT_CRL_A]!.ids;

  it("A1 — SELECT without any GUC fails closed on every table (0 rows)", async () => {
    for (const table of CMMS_TABLES) {
      const app = await appClient();
      const rows = await app.query<{ n: number }>(`SELECT count(*)::int AS n FROM ${table}`);
      await app.end();
      expect(rows.rows[0]!.n, table).toBe(0);
    }
  });

  it("A2 — the attacker's GUC never exposes the victim's rows (own ≥ 1, foreign 0)", async () => {
    for (const table of CMMS_TABLES) {
      const own = await asAttacker<{ n: number }>(
        `SELECT count(*)::int AS n FROM ${table}`,
      );
      expect(own[0]!.n, `${table} own`).toBeGreaterThanOrEqual(1);
      const foreign = await asAttacker<{ n: number }>(
        `SELECT count(*)::int AS n FROM ${table} WHERE tenant_id = $1`,
        [TENANT_CRL_A],
      );
      expect(foreign[0]!.n, `${table} foreign`).toBe(0);
    }
  });

  it("A3 — forged-tenant INSERTs (the victim's tenant_id under the attacker's GUC) reject 42501 with zero residue", async () => {
    const v = victim();
    const shapes: Array<[string, string, unknown[]]> = [
      [
        "maintenance_work_orders",
        `INSERT INTO maintenance_work_orders (id, tenant_id, asset_id, order_no, problem, status)
         VALUES (gen_random_uuid(), $1, $2, 'MO-FORGE', 'forged', 'REQUESTED')`,
        [TENANT_CRL_A, v.asset],
      ],
      [
        "maintenance_plans",
        `INSERT INTO maintenance_plans (id, tenant_id, asset_id, name, trigger_type, interval_days, next_due_date)
         VALUES (gen_random_uuid(), $1, $2, 'forged plan', 'CALENDAR', 30, '2026-12-31')`,
        [TENANT_CRL_A, v.asset],
      ],
      [
        "maintenance_plan_tasks",
        `INSERT INTO maintenance_plan_tasks (id, tenant_id, plan_id, seq, title)
         VALUES (gen_random_uuid(), $1, $2, 2, 'forged task')`,
        [TENANT_CRL_A, v.plan],
      ],
      [
        "maintenance_cost_lines",
        `INSERT INTO maintenance_cost_lines (id, tenant_id, work_order_id, line_no, leg_type, partner_id, amount)
         VALUES (gen_random_uuid(), $1, $2, 2, 'EXTERNAL', $3, 50)`,
        [TENANT_CRL_A, v.order2, v.partner],
      ],
      [
        "maintenance_work_order_steps",
        `INSERT INTO maintenance_work_order_steps (id, tenant_id, work_order_id, source_task_id, seq, title)
         VALUES (gen_random_uuid(), $1, $2, $3, 2, 'forged step')`,
        [TENANT_CRL_A, v.order2, v.task],
      ],
      [
        "asset_meters",
        `INSERT INTO asset_meters (id, tenant_id, asset_id, name, type, unit)
         VALUES (gen_random_uuid(), $1, $2, 'forged meter', 'HOURS', 'h')`,
        [TENANT_CRL_A, v.asset],
      ],
      [
        "asset_meter_readings",
        `INSERT INTO asset_meter_readings (id, tenant_id, meter_id, value, effective_date, source)
         VALUES (gen_random_uuid(), $1, $2, 300, '2026-04-01', 'MANUAL')`,
        [TENANT_CRL_A, v.meter],
      ],
      [
        "asset_spares",
        `INSERT INTO asset_spares (id, tenant_id, asset_id, item_id, qty)
         VALUES (gen_random_uuid(), $1, $2, $3, 1)`,
        [TENANT_CRL_A, v.asset, v.item],
      ],
      [
        "asset_transfers",
        `INSERT INTO asset_transfers (id, tenant_id, asset_id, from_branch_id, to_branch_id, reason, status)
         VALUES (gen_random_uuid(), $1, $2, $3, $4, 'forged move', 'DRAFT')`,
        [TENANT_CRL_A, v.asset, v.branch1, v.branch2],
      ],
      [
        "asset_tags",
        `INSERT INTO asset_tags (id, tenant_id, asset_id, code)
         VALUES (gen_random_uuid(), $1, $2, 'forged-tag-0123456789abcdef')`,
        [TENANT_CRL_A, v.asset],
      ],
    ];
    for (const [table, query, params] of shapes) {
      const app = await appClient();
      await app.query("BEGIN");
      await app.query("SELECT set_config('erp.tenant_id', $1, true)", [TENANT_CRL_B]);
      const failure = await app
        .query(query, params as never[])
        .then(() => undefined)
        .catch((error: { code?: string }) => error);
      await app.query("COMMIT");
      await app.end();
      expect(failure?.code, `${table} forged insert`).toBe("42501");
    }
    // ZERO residue: the victim's census is unmoved.
    const counts = await census(TENANT_CRL_A);
    for (const [table, expected] of Object.entries(EXPECTED_COUNTS)) {
      expect(counts[table], `${table} residue`).toBe(expected);
    }
  });

  it("A4 — staged UPDATE hijacks under the attacker's GUC touch 0 rows (byte-identical)", async () => {
    const v = victim();
    const updates: Array<[string, string, unknown[]]> = [
      ["maintenance_work_orders", `UPDATE maintenance_work_orders SET problem = 'hijacked' WHERE id = $1`, [v.order1]],
      ["maintenance_plans", `UPDATE maintenance_plans SET interval_days = 999 WHERE id = $1`, [v.plan]],
      ["maintenance_plan_tasks", `UPDATE maintenance_plan_tasks SET title = 'hijacked' WHERE id = $1`, [v.task]],
      ["maintenance_cost_lines", `UPDATE maintenance_cost_lines SET amount = 0 WHERE work_order_id = $1`, [v.order2]],
      ["maintenance_work_order_steps", `UPDATE maintenance_work_order_steps SET result = 'PASS' WHERE work_order_id = $1`, [v.order2]],
      ["asset_meters", `UPDATE asset_meters SET last_value = 999 WHERE id = $1`, [v.meter]],
      ["asset_meter_readings", `UPDATE asset_meter_readings SET value = 999 WHERE meter_id = $1`, [v.meter]],
      ["asset_spares", `UPDATE asset_spares SET qty = 999 WHERE asset_id = $1`, [v.asset]],
      ["asset_transfers", `UPDATE asset_transfers SET status = 'APPROVED' WHERE id = $1`, [v.transfer]],
      ["asset_tags", `UPDATE asset_tags SET printed_at = now() WHERE id = $1`, [v.tag]],
    ];
    for (const [table, query, params] of updates) {
      const affected = await asAttacker<{ n: number }>(
        `WITH updated AS (${query} RETURNING 1) SELECT count(*)::int AS n FROM updated`,
        params,
      );
      expect(affected[0]!.n, `${table} hijack`).toBe(0);
    }
    // Byte-identical: the victim's rows unchanged (the probe pair).
    const su = await superuserClient();
    const order = await su.query<{ problem: string }>(
      `SELECT problem FROM maintenance_work_orders WHERE id = $1`,
      [v.order1],
    );
    const transfer = await su.query<{ status: string }>(
      `SELECT status FROM asset_transfers WHERE id = $1`,
      [v.transfer],
    );
    await su.end();
    expect(order.rows[0]!.problem).toBe("CRL request");
    expect(transfer.rows[0]!.status).toBe("DRAFT");
  });

  it("A5 — DELETEs of the other tenant's rows: the evidence tables DENIED (no grant by design), the master-data tables touch 0 rows", async () => {
    for (const table of CMMS_TABLES) {
      const outcome = await asAttacker<{ n: number }>(
        `WITH deleted AS (DELETE FROM ${table} WHERE tenant_id = $1 RETURNING 1) SELECT count(*)::int AS n FROM deleted`,
        [TENANT_CRL_A],
      ).then(
        (rows) => ({ kind: "rows" as const, n: rows[0]?.n ?? 0 }),
        (error: { code?: string }) => ({ kind: "denied" as const, code: error.code }),
      );
      if (NO_DELETE_GRANT.has(table)) {
        expect(outcome.kind === "denied" || outcome.n === 0, `${table} delete`).toBe(true);
      } else {
        expect(outcome.kind === "rows" ? outcome.n : -1, `${table} delete`).toBe(0);
      }
    }
    // The census unmoved.
    const counts = await census(TENANT_CRL_A);
    for (const [table, expected] of Object.entries(EXPECTED_COUNTS)) {
      expect(counts[table], `${table} residue`).toBe(expected);
    }
  });

  it("A7 — id-based probes leak no existence (0 rows, no error distinguishing present from absent)", async () => {
    const v = victim();
    const probes: Array<[string, string, string | undefined]> = [
      ["maintenance_work_orders", "id", v.order1],
      ["maintenance_plans", "id", v.plan],
      ["maintenance_plan_tasks", "id", v.task],
      ["maintenance_cost_lines", "work_order_id", v.order2],
      ["maintenance_work_order_steps", "work_order_id", v.order2],
      ["asset_meters", "id", v.meter],
      ["asset_meter_readings", "meter_id", v.meter],
      ["asset_spares", "asset_id", v.asset],
      ["asset_transfers", "id", v.transfer],
      ["asset_tags", "id", v.tag],
    ];
    for (const [table, column, value] of probes) {
      const present = await asAttacker<{ n: number }>(
        `SELECT count(*)::int AS n FROM ${table} WHERE ${column} = $1::uuid`,
        [value ?? null],
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
    `, [[...CMMS_TABLES]]);
    await su.end();
    expect(fks.rows.length).toBeGreaterThanOrEqual(16);
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
        `INSERT INTO maintenance_cost_lines (id, tenant_id, work_order_id, line_no, leg_type, partner_id, amount)
         VALUES (gen_random_uuid(), $1, $2, 3, 'EXTERNAL', $3, 10)`,
        [TENANT_CRL_B, victim().order2, victim().partner],
      )
      .then(() => undefined)
      .catch((error: { code?: string }) => error);
    await su2.query("ROLLBACK");
    await su2.end();
    expect(failure?.code).toBe("23503");
  });

  it("A9 — FK-chain joins under the attacker's GUC expose 0 victim rows", async () => {
    // The deepest chains: readings → meter → asset; steps → order +
    // steps → task → plan → asset; cost lines → order → asset; and
    // the transfer's both branches.
    const joins: Array<[string, string]> = [
      [
        "readings-meter-asset",
        `SELECT count(*)::int AS n
           FROM asset_meter_readings r
           JOIN asset_meters m ON m.id = r.meter_id AND m.tenant_id = r.tenant_id
           JOIN assets a ON a.id = m.asset_id AND a.tenant_id = m.tenant_id
          WHERE a.tenant_id = $1`,
      ],
      [
        "steps-order-task-plan-asset",
        `SELECT count(*)::int AS n
           FROM maintenance_work_order_steps s
           JOIN maintenance_work_orders o ON o.id = s.work_order_id AND o.tenant_id = s.tenant_id
           JOIN maintenance_plan_tasks t ON t.id = s.source_task_id AND t.tenant_id = s.tenant_id
           JOIN maintenance_plans p ON p.id = t.plan_id AND p.tenant_id = t.tenant_id
          WHERE p.tenant_id = $1`,
      ],
      [
        "lines-order-asset",
        `SELECT count(*)::int AS n
           FROM maintenance_cost_lines cl
           JOIN maintenance_work_orders o ON o.id = cl.work_order_id AND o.tenant_id = cl.tenant_id
           JOIN assets a ON a.id = o.asset_id AND a.tenant_id = o.tenant_id
          WHERE a.tenant_id = $1`,
      ],
      [
        "transfers-branches-asset",
        `SELECT count(*)::int AS n
           FROM asset_transfers tr
           JOIN assets a ON a.id = tr.asset_id AND a.tenant_id = tr.tenant_id
           JOIN branches fb ON fb.id = tr.from_branch_id AND fb.tenant_id = tr.tenant_id
           JOIN branches tb ON tb.id = tr.to_branch_id AND tb.tenant_id = tr.tenant_id
          WHERE a.tenant_id = $1`,
      ],
    ];
    for (const [label, query] of joins) {
      const rows = await asAttacker<{ n: number }>(query, [TENANT_CRL_A]);
      expect(rows[0]!.n, label).toBe(0);
    }
  });

  it("A10 — UNION ALL over every table + a recursive CTE stay confined (0 victim rows)", async () => {
    const unionQuery = CMMS_TABLES.map(
      (table) => `SELECT tenant_id FROM ${table}`,
    ).join(" UNION ALL ");
    const unionRows = await asAttacker<{ tenant_id: string }>(unionQuery);
    expect(unionRows.some((row) => row.tenant_id === TENANT_CRL_A)).toBe(false);
    expect(unionRows.every((row) => row.tenant_id === TENANT_CRL_B)).toBe(true);

    // The recursive CTE: walk the family's own cycle — plan → its
    // generated orders → their carried steps → the steps' source
    // tasks → those tasks' plan — from the attacker's ACTIVE plans;
    // the victim's rows are unreachable at every hop.
    const cteRows = await asAttacker<{ n: number }>(`
      WITH RECURSIVE walk AS (
        SELECT p.id AS plan_id, p.tenant_id
          FROM maintenance_plans p WHERE p.is_active
        UNION
        SELECT pl.id, pl.tenant_id
          FROM maintenance_plan_tasks t
          JOIN walk w ON w.tenant_id = t.tenant_id
          JOIN maintenance_work_order_steps s ON s.source_task_id = t.id AND s.tenant_id = t.tenant_id
          JOIN maintenance_work_orders o ON o.id = s.work_order_id AND o.tenant_id = s.tenant_id
          JOIN maintenance_plans pl ON pl.id = o.plan_id AND pl.tenant_id = o.tenant_id
         WHERE t.plan_id = w.plan_id AND o.plan_id IS NOT NULL
      )
      SELECT count(*)::int AS n FROM walk WHERE tenant_id = $1
    `, [TENANT_CRL_A]);
    expect(cteRows[0]!.n).toBe(0);
  });

  it("THE CENSUS — both worlds survive every attack row-for-row", async () => {
    for (const tenantId of [TENANT_CRL_A, TENANT_CRL_B]) {
      const counts = await census(tenantId);
      for (const [table, expected] of Object.entries(EXPECTED_COUNTS)) {
        expect(counts[table], `${tenantId} ${table}`).toBe(expected);
      }
    }
  });
});
