import { beforeAll, describe, expect, it } from "vitest";

import { sql } from "drizzle-orm";

import { superuserClient } from "../test-db";
import { withTenant } from "../../infra/db/tenant-context";
import {
  M_ACTOR,
  TENANT_M,
  setupMfgFixture,
  type MfgFixture,
} from "./fixtures";

/**
 * PHASE-042 OA-06 EXPLAIN budgets (acceptance §6.9): the three hot paths
 * the manufacturing-execution cluster adds — the shop-floor operation scan
 * (the terminal's live-order query, verbatim), the OEE daily view under the
 * tenant GUC (the utilization report's source), and the downtime list (the
 * terminal + the downtime-analysis report window). Representative rows are
 * seeded first and ANALYZEd so the planner's index choice is meaningful
 * (the PHASE-041 explain-budgets precedent); enable_seqscan=off then
 * isolates the index proof from the planner's volume-dependent cost choice
 * — the budget under test is the INDEX SHAPE servicing the hot path (the
 * migration 0065 §5/§7 indexes).
 */

let fixture: MfgFixture;
let scanOrderId = "";
let oeeWorkCenterId = "";

beforeAll(async () => {
  fixture = await setupMfgFixture();
  await withTenant(TENANT_M, async (tx) => {
    // One work center for the OEE + downtime folds.
    const wc = await tx.execute(sql`
      INSERT INTO work_centers
        (id, tenant_id, code, name, capacity_per_shift, shifts_per_day,
         fixed_cost_rate, var_cost_rate, status, created_by)
      VALUES (gen_random_uuid(), erp.current_tenant_id(), 'WC-EXPLAIN',
              'Explain budget center', 8, 1, 10, 5, 'ACTIVE', ${M_ACTOR})
      RETURNING id`);
    oeeWorkCenterId = (wc.rows[0] as { id: string }).id;

    // One ACTIVE routing on the bread item for the op rows' FK.
    const routing = await tx.execute(sql`
      INSERT INTO routings
        (id, tenant_id, item_id, version_no, status, output_uom_id, created_by)
      VALUES (gen_random_uuid(), erp.current_tenant_id(), ${fixture.items.bread},
              1, 'ACTIVE',
              (SELECT output_uom_id FROM bills_of_materials WHERE id = ${fixture.boms.bread.id}),
              ${M_ACTOR})
      RETURNING id`);
    const routingId = (routing.rows[0] as { id: string }).id;

    // Three DRAFT orders as op-row hosts (the terminal scans one order's
    // live operations; the others spread the table).
    const hosts = await tx.execute(sql`
      INSERT INTO production_orders
        (id, tenant_id, branch_id, status, item_id, uom_id, planned_qty,
         materials_warehouse_id, fg_warehouse_id, created_by)
      SELECT gen_random_uuid(), erp.current_tenant_id(), ${fixture.branchId},
             'DRAFT', ${fixture.items.bread},
             (SELECT output_uom_id FROM bills_of_materials WHERE id = ${fixture.boms.bread.id}),
             100, ${fixture.warehouseRaw}, ${fixture.warehouseFg}, ${M_ACTOR}
      FROM generate_series(0::int, 2::int)
      RETURNING id`);
    const hostIds = (hosts.rows as unknown as Array<{ id: string }>).map((r) => r.id);
    scanOrderId = hostIds[0]!;

    // 30 operation rows on the scanned order (statuses spread across the
    // machine, evidence-complete per the state CHECK: PENDING carries no
    // timestamps, RUNNING carries started_at, COMPLETED carries both) + 60
    // rows on the other two hosts — the scan predicate (order + status) is
    // genuinely selective.
    await tx.execute(sql`
      INSERT INTO production_order_operations
        (id, tenant_id, order_id, routing_id, sequence, work_center_id, status,
         std_setup_time, std_run_time, std_fixed_rate, std_var_rate,
         started_at, finished_at)
      SELECT gen_random_uuid(), erp.current_tenant_id(), ${scanOrderId},
             ${routingId}, (g * 10) + 10, ${oeeWorkCenterId},
             (ARRAY['PENDING','RUNNING','COMPLETED'])[1 + (g % 3)],
             1, 0.5, 10, 5,
             CASE WHEN g % 3 <> 0 THEN now() - (g * interval '2 hours') ELSE NULL END,
             CASE WHEN g % 3 = 2 THEN now() - (g * interval '2 hours') + interval '30 minutes' ELSE NULL END
      FROM generate_series(0::int, 29::int) AS g`);
    for (const host of hostIds.slice(1)) {
      await tx.execute(sql`
        INSERT INTO production_order_operations
          (id, tenant_id, order_id, routing_id, sequence, work_center_id, status,
           std_setup_time, std_run_time, std_fixed_rate, std_var_rate, started_at)
        SELECT gen_random_uuid(), erp.current_tenant_id(), ${host},
               ${routingId}, (g * 10) + 10, ${oeeWorkCenterId},
               (ARRAY['PENDING','RUNNING'])[1 + (g % 2)],
               1, 0.5, 10, 5,
               CASE WHEN g % 2 = 1 THEN now() - (g * interval '1 hour') ELSE NULL END
        FROM generate_series(0::int, 29::int) AS g`);
    }

    // 200 downtime records on the work center (reasons spread; windows
    // staggered) — the list predicate (tenant + work center, started_at
    // DESC) and the OEE availability fold get real statistics.
    await tx.execute(sql`
      INSERT INTO downtime_records
        (id, tenant_id, work_center_id, reason_code, started_at, ended_at,
         duration_minutes, created_by)
      SELECT gen_random_uuid(), erp.current_tenant_id(), ${oeeWorkCenterId},
             (ARRAY['BREAKDOWN','MAINTENANCE','MATERIAL_SHORTAGE','CHANGEOVER'])[1 + (g % 4)],
             now() - (g * interval '37 minutes'),
             now() - (g * interval '37 minutes') + interval '12 minutes',
             12, ${M_ACTOR}
      FROM generate_series(0::int, 199::int) AS g`);
  });
  // Fresh inserts carry no statistics — ANALYZE (superuser) makes the
  // planner's choice reflect the seeded shape (the 041 precedent).
  const client = await superuserClient();
  await client.query("ANALYZE production_order_operations");
  await client.query("ANALYZE downtime_records");
  await client.query("ANALYZE work_centers");
  await client.end();
});

async function explain(query: ReturnType<typeof sql>): Promise<string> {
  const plan = await withTenant(TENANT_M, async (tx) => {
    await tx.execute(sql`SET LOCAL enable_seqscan = off`);
    const rows = await tx.execute(sql`EXPLAIN ${query}`);
    return (rows.rows as unknown as Array<{ "QUERY PLAN": string }>).map(
      (row) => row["QUERY PLAN"],
    );
  });
  return plan.join("\n");
}

describe("PHASE-042 OA-06 EXPLAIN budgets (acceptance 9)", () => {
  it("the shop-floor operation scan (the terminal's live-order query) rides ix_production_order_operations_order — no seq-scan", async () => {
    const text = await explain(sql`
      SELECT id, sequence, status, started_at, operator_user_id
      FROM production_order_operations
      WHERE tenant_id = erp.current_tenant_id()
        AND order_id = ${scanOrderId}
        AND status IN ('PENDING', 'SETUP', 'RUNNING', 'PAUSED')
      ORDER BY sequence`);
    expect(text).toMatch(
      /Index (Only )?Scan( Backward)? using ix_production_order_operations_order|Bitmap Index Scan on ix_production_order_operations_order/,
    );
    expect(text).not.toMatch(/Seq Scan/);
  });

  it("the OEE daily fold (the utilization report's source view) is index-driven under the tenant GUC — no seq-scan", async () => {
    // The view folds production_order_operations (per work center under
    // started_at — the ix_production_order_operations_work_center path)
    // with the downtime LATERAL (ix_downtime_records_work_center). With
    // enable_seqscan=off both legs must ride their indexes.
    const text = await explain(sql`
      SELECT work_center_id, day, planned_hours, actual_hours, downtime_minutes
      FROM v_work_center_oee_daily
      WHERE tenant_id = erp.current_tenant_id()`);
    expect(text).toMatch(
      /Index (Only )?Scan using ix_production_order_operations_work_center|Bitmap Index Scan on ix_production_order_operations_work_center/,
    );
    expect(text).toMatch(
      /Index (Only )?Scan using ix_downtime_records_work_center|Bitmap Index Scan on ix_downtime_records_work_center/,
    );
    expect(text).not.toMatch(/Seq Scan/);
  });

  it("the downtime list (terminal + the downtime-analysis window) rides ix_downtime_records_work_center — no seq-scan", async () => {
    const text = await explain(sql`
      SELECT id, reason_code, started_at, ended_at, duration_minutes
      FROM downtime_records
      WHERE tenant_id = erp.current_tenant_id()
        AND work_center_id = ${oeeWorkCenterId}
      ORDER BY started_at DESC
      LIMIT 100`);
    expect(text).toMatch(
      /Index (Only )?Scan( Backward)? using ix_downtime_records_work_center|Bitmap Index Scan on ix_downtime_records_work_center/,
    );
    expect(text).not.toMatch(/Seq Scan/);
  });
});
