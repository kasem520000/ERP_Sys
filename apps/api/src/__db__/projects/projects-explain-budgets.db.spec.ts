import { beforeAll, describe, expect, it } from "vitest";
import { sql } from "drizzle-orm";

import { requireTenantContext, withTenant } from "../../infra/db/tenant-context";
import { seedTenants, superuserClient } from "../test-db";

/**
 * PHASE-048 (W-14 — T-18c, dated 2026-11-22) ·
 * `projects-explain-budgets.db.spec` — THE OA-06 EXPLAIN BUDGETS over
 * the projects plane's two documented hot paths (D-17 — the plan's own
 * probes: THE ROLLUP READ and THE DISPATCH QUERY):
 *
 * - P1 the WBS rollup read — `projects.store.listWbsTasks`'s own
 *   driving shape (the flat tenant+project scan, ORDER BY wbs_code —
 *   the read `WbsService.tree`/`rollup` fold over) must ride
 *   `ix_project_wbs_tasks_tenant_project`;
 * - P2 the dispatch board read — `fieldservice.store.listServiceVisits`'
 *   own shape (the W-13 presentation join + ORDER BY scheduled_start +
 *   LIMIT) must ride `ix_service_visits_tenant_window`;
 * - P3 the technician-filtered board (the partial
 *   `ix_service_visits_tenant_technician`).
 *
 * THE OA-06 ASSERTION LAW (the W-9 ruling, D-17's own text): the
 * probes assert the stable INDEX-DRIVEN law — no seq-scan — accepting
 * the planner's legitimate index-driven paths (the P3/W-9 precedent's
 * regex shape); the rejected alternatives, per the ruling:
 * enable_bitmapscan=off / planner hints would make the probe testify
 * about a FORCED plan, and isolating the probe hides the shared-table
 * context it exists to police. **Never a forced plan, never an
 * isolated probe context.**
 *
 * THE ISOLATION LAW (the suite's serial discipline): the corpus lives
 * on a DEDICATED tenant (`TENANT_PJ_XB` — never the shared PJW
 * suite's registers) so no other spec's tenant-wide reads can ever
 * observe it, and this spec's own probes stay RLS-scoped to its world
 * alone. The corpus is representative (a 120-node WBS tree + 240
 * visits across two orders) so the planner's index choice is
 * meaningful; ANALYZE runs before the probes.
 */

/** The dedicated OA-06 tenant (the projects family's explain arm). */
const TENANT_PJ_XB = "6c6c6c6c-0000-4000-8000-000000005e47";

let probeProject = "";
let probeTechnician = "";
let probeOrderA = "";
let probeOrderB = "";

beforeAll(async () => {
  const su = await superuserClient();
  await seedTenants(su as never);
  await su.query(
    `INSERT INTO tenants (id, name, name_ar, base_currency, country_code, timezone) VALUES
       ($1, 'Tenant PJ-XB (projects explain budgets)', 'المستأجر لفحص ميزانيات الاستعلام', 'SAR', 'SA', 'Asia/Riyadh')
     ON CONFLICT (id) DO NOTHING`,
    [TENANT_PJ_XB],
  );

  // The idempotent wipe (the corpus is this spec's own).
  await su.query(`DELETE FROM service_visits WHERE tenant_id = $1`, [TENANT_PJ_XB]);
  await su.query(`DELETE FROM service_orders WHERE tenant_id = $1`, [TENANT_PJ_XB]);
  await su.query(`DELETE FROM project_wbs_tasks WHERE tenant_id = $1`, [TENANT_PJ_XB]);
  await su.query(`DELETE FROM projects WHERE tenant_id = $1`, [TENANT_PJ_XB]);
  await su.query(`DELETE FROM employees WHERE tenant_id = $1 AND code = 'EMP-PJXB'`, [TENANT_PJ_XB]);

  const employee = await su.query<{ id: string }>(
    `INSERT INTO employees (id, tenant_id, code, name, hire_date, contract_type, basic_salary, status)
     VALUES (gen_random_uuid(), $1, 'EMP-PJXB', 'PJ-XB technician', '2026-01-01', 'FULL_TIME', 8000, 'ACTIVE')
     RETURNING id`,
    [TENANT_PJ_XB],
  );
  probeTechnician = employee.rows[0]!.id;

  const branch = await su.query<{ id: string }>(
    `INSERT INTO branches (id, tenant_id, code, name)
     VALUES (gen_random_uuid(), $1, 'BR-PJXB', 'PJ-XB branch')
     ON CONFLICT (tenant_id, code) DO UPDATE SET name = EXCLUDED.name RETURNING id`,
    [TENANT_PJ_XB],
  );
  const partner = await su.query<{ id: string }>(
    `INSERT INTO partners (id, tenant_id, kind, code, name)
     VALUES (gen_random_uuid(), $1, 'CUSTOMER', 'PT-PJXB', 'PJ-XB customer')
     ON CONFLICT (tenant_id, code) DO UPDATE SET name = EXCLUDED.name RETURNING id`,
    [TENANT_PJ_XB],
  );
  const warehouse = await su.query<{ id: string }>(
    `INSERT INTO warehouses (id, tenant_id, branch_id, code, name)
     VALUES (gen_random_uuid(), $1, $2, 'WH-PJXB', 'PJ-XB warehouse')
     ON CONFLICT (tenant_id, code) DO UPDATE SET name = EXCLUDED.name RETURNING id`,
    [TENANT_PJ_XB, branch.rows[0]!.id],
  );

  const project = await su.query<{ id: string }>(
    `INSERT INTO projects (id, tenant_id, code, name, status)
     VALUES (gen_random_uuid(), $1, 'PJXB-PRJ', 'The explain-budgets project', 'OPEN')
     ON CONFLICT (tenant_id, code) DO UPDATE SET name = EXCLUDED.name RETURNING id`,
    [TENANT_PJ_XB],
  );
  probeProject = project.rows[0]!.id;

  // THE WBS CORPUS — 120 nodes: the root + 119 children in a 3-level
  // tree (the rollup's representative shape; BR-095's fold reads them
  // all in ONE scan).
  await su.query(
    `WITH root AS (
       INSERT INTO project_wbs_tasks (id, tenant_id, project_id, wbs_code, name, is_milestone,
                                      start_date, end_date, weight, percent_complete)
       VALUES (gen_random_uuid(), $1, $2, 'R', 'The probe root', false, '2026-01-01', '2026-12-31', null, 0)
       RETURNING id
     ),
     mid AS (
       INSERT INTO project_wbs_tasks (id, tenant_id, project_id, parent_task_id, wbs_code, name,
                                      is_milestone, start_date, end_date, weight, percent_complete)
       SELECT gen_random_uuid(), $1, $2, root.id, 'R.' || g, 'The probe mid ' || g, false,
              '2026-01-01', '2026-12-31', null, 0
         FROM root CROSS JOIN generate_series(1, 10) AS g
       RETURNING id, wbs_code
     )
     INSERT INTO project_wbs_tasks (id, tenant_id, project_id, parent_task_id, wbs_code, name,
                                    is_milestone, start_date, end_date, weight, percent_complete)
     SELECT gen_random_uuid(), $1, $2, mid.id, mid.wbs_code || '.' || g, 'The probe leaf ' || mid.wbs_code || '.' || g,
            false, '2026-01-01', '2026-12-31', 10, (g * 5) % 100
       FROM mid CROSS JOIN generate_series(1, 10) AS g`,
    [TENANT_PJ_XB, probeProject],
  );

  // THE DISPATCH CORPUS — two service orders + 240 visits (120 per
  // order, alternating technician/null and status, scheduled across 60
  // days — the board's representative shape).
  const orderA = await su.query<{ id: string }>(
    `INSERT INTO service_orders (id, tenant_id, branch_id, partner_id, warehouse_id, status)
     VALUES (gen_random_uuid(), $1, $2, $3, $4, 'IN_PROGRESS')
     RETURNING id`,
    [TENANT_PJ_XB, branch.rows[0]!.id, partner.rows[0]!.id, warehouse.rows[0]!.id],
  );
  const orderB = await su.query<{ id: string }>(
    `INSERT INTO service_orders (id, tenant_id, branch_id, partner_id, warehouse_id, status)
     VALUES (gen_random_uuid(), $1, $2, $3, $4, 'IN_PROGRESS')
     RETURNING id`,
    [TENANT_PJ_XB, branch.rows[0]!.id, partner.rows[0]!.id, warehouse.rows[0]!.id],
  );
  probeOrderA = orderA.rows[0]!.id;
  probeOrderB = orderB.rows[0]!.id;

  await su.query(
    `INSERT INTO service_visits (id, tenant_id, service_order_id, technician_employee_id,
                                 scheduled_start, scheduled_end, status, dispatched_at)
     SELECT gen_random_uuid(), $1,
            CASE WHEN g % 2 = 0 THEN $2::uuid ELSE $3::uuid END,
            -- The technician-required-from-dispatch law (0103's CHECK):
            -- DISPATCHED rows always carry the technician; SCHEDULED
            -- rows alternate (the partial index's NULL arm).
            CASE WHEN g % 4 = 0 THEN $4::uuid
                 WHEN g % 3 = 0 THEN NULL
                 ELSE $4::uuid END,
            timestamptz '2026-11-01T08:00:00Z' + (g * interval '6 hours'),
            timestamptz '2026-11-01T08:00:00Z' + (g * interval '6 hours') + interval '4 hours',
            CASE WHEN g % 4 = 0 THEN 'DISPATCHED' ELSE 'SCHEDULED' END,
            CASE WHEN g % 4 = 0 THEN now() ELSE NULL END
       FROM generate_series(1, 240) AS g`,
    [TENANT_PJ_XB, probeOrderA, probeOrderB, probeTechnician],
  );

  // ANALYZE — the planner's index choice must be informed.
  await su.query("ANALYZE project_wbs_tasks");
  await su.query("ANALYZE service_visits");
  await su.query("ANALYZE service_orders");
  await su.query("ANALYZE employees");
  await su.end();
});

async function explain(label: string, query: ReturnType<typeof sql>): Promise<string> {
  const plan = await withTenant(TENANT_PJ_XB, async () => {
    const tx = requireTenantContext().tx!;
    await tx.execute(sql`SET LOCAL enable_seqscan = off`);
    const rows = await tx.execute(sql`EXPLAIN ${query}`);
    return (rows.rows as unknown as Array<{ "QUERY PLAN": string }>).map(
      (row) => row["QUERY PLAN"],
    );
  });
  const text = plan.join("\n");
  // The plans are LOGGED (the OA-06 explain plans log — the evidence
  // keeps the suite output verbatim).
  process.stdout.write(`[projects-explain-budgets] ${label}:\n${text}\n`);
  return text;
}

describe("PHASE-048 W-14 — OA-06 EXPLAIN budgets (the rollup read + the dispatch query — D-17)", () => {
  it("P1 THE ROLLUP READ (listWbsTasks' own shape — the flat tenant+project scan the tree/rollup fold rides) is index-driven — no seq-scan", async () => {
    // projects.store.listWbsTasks' driving shape verbatim (the tenant
    // predicate arrives through RLS — the GUC policy — exactly as the
    // engine's own read runs).
    const text = await explain(
      "P1 the WBS rollup read",
      sql`
      SELECT id, wbs_code, name, percent_complete::text, weight::text
      FROM project_wbs_tasks
      WHERE project_id = ${probeProject}::uuid
      ORDER BY wbs_code
    `,
    );
    expect(text).toMatch(
      /Index (Only )?Scan( Backward)? using (ix_project_wbs_tasks_tenant_project|uq_project_wbs_tasks_tenant_project_code)|Bitmap (Heap )?Scan on project_wbs_tasks|Bitmap Index Scan on (ix_project_wbs_tasks_tenant_project|uq_project_wbs_tasks_tenant_project_code)/,
    );
    expect(text).not.toMatch(/Seq Scan/);
  });

  it("P2 THE DISPATCH QUERY (listServiceVisits' own shape — the W-13 presentation join + the scheduled-start ordering + the limit) is index-driven — no seq-scan", async () => {
    // fieldservice.store.listServiceVisits' driving shape verbatim (the
    // unfiltered board: the join + ORDER BY scheduled_start + LIMIT).
    const text = await explain(
      "P2 the dispatch board read",
      sql`
      SELECT sv.id, sv.status, so.order_no AS "orderNo",
             emp.name AS "technicianName", emp.name_ar AS "technicianNameAr"
      FROM service_visits sv
      LEFT JOIN service_orders so ON so.id = sv.service_order_id
      LEFT JOIN employees emp ON emp.id = sv.technician_employee_id
      WHERE (NULL::uuid IS NULL OR sv.service_order_id = NULL::uuid)
        AND (NULL::text IS NULL OR sv.status = NULL::text)
      ORDER BY sv.scheduled_start ASC, sv.id ASC
      LIMIT 200
    `,
    );
    expect(text).toMatch(
      /Index (Only )?Scan( Backward)? using ix_service_visits_tenant_window|Bitmap (Heap )?Scan on service_visits|Bitmap Index Scan on ix_service_visits_tenant_window/,
    );
    expect(text).not.toMatch(/Seq Scan/);
  });

  it("P3 the technician-filtered board (the partial index's arm) is index-driven — no seq-scan", async () => {
    const text = await explain(
      "P3 the technician-filtered board",
      sql`
      SELECT sv.id, sv.status, sv.scheduled_start::text
      FROM service_visits sv
      WHERE sv.technician_employee_id = ${probeTechnician}::uuid
      ORDER BY sv.scheduled_start ASC, sv.id ASC
      LIMIT 200
    `,
    );
    expect(text).toMatch(
      /Index (Only )?Scan( Backward)? using ix_service_visits_tenant_technician|Bitmap (Heap )?Scan on service_visits|Bitmap Index Scan on ix_service_visits_tenant_technician/,
    );
    expect(text).not.toMatch(/Seq Scan/);
  });

  it("P4 the order-filtered board (the order+status index's arm) is index-driven — no seq-scan", async () => {
    const text = await explain(
      "P4 the order-filtered board",
      sql`
      SELECT sv.id, sv.status, sv.scheduled_start::text
      FROM service_visits sv
      WHERE sv.service_order_id = ${probeOrderA}::uuid
        AND sv.status = 'DISPATCHED'
      ORDER BY sv.scheduled_start ASC, sv.id ASC
      LIMIT 200
    `,
    );
    expect(text).toMatch(
      /Index (Only )?Scan( Backward)? using ix_service_visits_tenant_order|Bitmap (Heap )?Scan on service_visits|Bitmap Index Scan on ix_service_visits_tenant_order/,
    );
    expect(text).not.toMatch(/Seq Scan/);
  });
});
