import { beforeAll, describe, expect, it } from "vitest";

import { sql } from "drizzle-orm";

import { superuserClient } from "../test-db";
import { withTenant } from "../../infra/db/tenant-context";
import * as itemsStore from "../../modules/items/infrastructure/items.store";
import {
  M_ACTOR,
  TENANT_M,
  boms,
  setupMfgFixture,
  type MfgFixture,
} from "./fixtures";

/**
 * PHASE-043 OA-06 EXPLAIN budgets (T-19, acceptance §6.9): the hot paths
 * the planning cluster adds — the MRP engine's whole-graph BOM explosion
 * read (`loadActiveBomGraph`, the deterministic once-per-run walk the
 * kernel consumes), the suggestions board (`listSuggestions`, the
 * /manufacturing/mrp screen's primary load — status + type + the due-date
 * ordering), the run-history list (`listMrpRuns`, the screen's first
 * panel), and the netting drill-down (`listMrpDemandLines`, the run
 * detail's per-item fold). Representative rows are seeded first and
 * ANALYZEd so the planner's index choice is meaningful (the PHASE-042
 * explain-budgets precedent); `enable_seqscan=off` then isolates the index
 * proof from the planner's volume-dependent cost choice — the budget under
 * test is the INDEX SHAPE servicing the hot path (the 0026 BOM indexes +
 * the 0076 MRP indexes).
 *
 * The spec owns its items/BOMs/runs (the goldens discipline — never the
 * §8 chain rows and never another spec's planning corpus): every seeded
 * row carries the M-XP- marker and the suggestion/status spread makes the
 * (status, suggestion_type) predicate genuinely selective.
 */

let fixture: MfgFixture;
let xpFg = "";
let xpC1 = "";
let xpRunA = "";
let xpRunB = "";

beforeAll(async () => {
  fixture = await setupMfgFixture();
  await withTenant(TENANT_M, async () => {
    // The explosion corpus: one owned FG + three owned components, one
    // ACTIVE BOM with twelve lines (one phantom — the M-08 flattening
    // shape), plus the fixture's own ACTIVE BOMs for realistic volume.
    const ensure = async (sku: string, name: string): Promise<string> => {
      const found = await itemsStore.findItemBySku(sku);
      if (found !== undefined) return found.id;
      const uoms = await itemsStore.listUoms();
      const pcs = uoms.find((u) => u.code === "PCS") ?? uoms[0]!;
      const created = await itemsStore.insertItem({
        sku,
        name,
        nameAr: null,
        kind: "STOCK",
        uomId: pcs.id,
        categoryId: null,
        taxCodeId: null,
        costingMethod: "WAC",
        trackBatch: true,
        trackSerial: false,
        trackImei: false,
        hasExpiry: false,
        shelfLifeDays: null,
        reorderLevel: null,
        reorderQty: null,
        basePrice: null,
      });
      return created.id;
    };
    xpFg = await ensure("M-XP-FG", "Explain budget planning FG");
    // Twelve distinct components — the service enforces one line per
    // component per BOM version (BomLineInvalidError), so the corpus
    // gets its own item per line.
    const comps = await Promise.all(
      Array.from({ length: 12 }, (_, i) =>
        ensure(`M-XP-C${i + 1}`, `Explain budget component ${i + 1}`),
      ),
    );

    const draft = await boms.create({
      itemId: xpFg,
      outputUomId: (await itemsStore.findItemById(xpFg))!.uomId,
      yieldPct: "100.0000",
      note: "OA-06 explosion corpus BOM",
      noteAr: null,
      actorId: M_ACTOR,
      lines: [
        // Ten plain components + the phantom sub-assembly + its inner leg.
        ...comps.slice(0, 10).map((componentItemId, i) => ({
          componentItemId,
          qtyPerOutput: `${1 + (i % 4)}.000000`,
          scrapPct: "0",
        })),
        { componentItemId: comps[10]!, qtyPerOutput: "2.000000", scrapPct: "0", phantomFlag: true },
        { componentItemId: comps[11]!, qtyPerOutput: "0.500000", scrapPct: "5.0000" },
      ],
    });
    await boms.activate(draft.id, { effectiveFrom: "2026-03-01", actorId: M_ACTOR });
    xpC1 = comps[0]!;
  });

  await withTenant(TENANT_M, async (tx) => {
    // Two owned runs (the COMPLETED history anchor + the RUNNING live one)
    // under the fixture's M-RAW warehouse.
    const runs = await tx.execute(sql`
      INSERT INTO mrp_runs
        (id, tenant_id, status, run_mode, bucket_size, horizon_buckets,
         warehouse_id, as_of_date, params, stats, created_by)
      VALUES
        (gen_random_uuid(), erp.current_tenant_id(), 'COMPLETED', 'REGENERATIVE',
         'DAY', 30, ${fixture.warehouseRaw}, current_date,
         '{"planningHorizonDays":30}'::jsonb, '{"suggestions":40}'::jsonb, ${M_ACTOR}),
        (gen_random_uuid(), erp.current_tenant_id(), 'RUNNING', 'NET_CHANGE',
         'DAY', 30, ${fixture.warehouseRaw}, current_date,
         '{"planningHorizonDays":30}'::jsonb, NULL, ${M_ACTOR})
      RETURNING id`);
    const runIds = (runs.rows as unknown as Array<{ id: string }>).map((r) => r.id);
    xpRunA = runIds[0]!;
    xpRunB = runIds[1]!;

    // The suggestions board corpus: 60 rows on the completed run spread
    // across the three types and the four statuses (the board's default
    // SUGGESTED + PURCHASE_ORDER predicate is genuinely selective), plus
    // 20 rows on the live run — the (run, status) cross-filter has shape.
    await tx.execute(sql`
      INSERT INTO mrp_suggestions
        (id, tenant_id, run_id, item_id, warehouse_id, from_warehouse_id,
         suggestion_type, qty, due_date, release_date, frozen_fence, status,
         netting, dismissed_reason, converted_doc_type, converted_doc_id, created_by)
      SELECT gen_random_uuid(), erp.current_tenant_id(), ${xpRunA}, ${xpFg},
             ${fixture.warehouseRaw},
             CASE WHEN g % 3 = 2 THEN ${fixture.warehouseFg}::uuid ELSE NULL END,
             (ARRAY['PURCHASE_ORDER','PRODUCTION_ORDER','TRANSFER'])[1 + (g % 3)],
             (g + 1)::numeric,
             current_date + ((g % 21) + 1),
             current_date,
             (g % 7 = 0),
             CASE
               WHEN g % 5 = 4 THEN 'DISMISSED'
               WHEN g % 5 = 3 THEN 'ACCEPTED'
               WHEN g % 5 = 2 THEN 'SUPERSEDED'
               ELSE 'SUGGESTED'
             END,
             '{"onHand":"0","demand":"1"}'::jsonb,
             CASE WHEN g % 5 = 4 THEN 'board corpus dismissal' ELSE NULL END,
             CASE WHEN g % 5 = 3 THEN 'purchase_order' ELSE NULL END,
             CASE WHEN g % 5 = 3 THEN gen_random_uuid() ELSE NULL END,
             ${M_ACTOR}
      FROM generate_series(0::int, 59::int) AS g`);
    await tx.execute(sql`
      INSERT INTO mrp_suggestions
        (id, tenant_id, run_id, item_id, warehouse_id, suggestion_type, qty,
         due_date, release_date, status, netting, created_by)
      SELECT gen_random_uuid(), erp.current_tenant_id(), ${xpRunB}, ${xpFg},
             ${fixture.warehouseRaw},
             (ARRAY['PURCHASE_ORDER','PRODUCTION_ORDER'])[1 + (g % 2)],
             (g + 1)::numeric,
             current_date + ((g % 14) + 1),
             current_date,
             CASE WHEN g % 4 = 3 THEN 'SUPERSEDED' ELSE 'SUGGESTED' END,
             '{"onHand":"0","demand":"1"}'::jsonb,
             ${M_ACTOR}
      FROM generate_series(0::int, 19::int) AS g`);

    // The drill-down corpus: the run's demand snapshot — buckets × kinds ×
    // the parent-item axis (BOM_EXPLOSION rows carry the parent), so the
    // (run, item, bucket) index predicate is genuinely selective.
    await tx.execute(sql`
      INSERT INTO mrp_demand_lines
        (id, tenant_id, run_id, warehouse_id, item_id, bucket_index,
         bucket_start, demand_kind, qty, parent_item_id)
      SELECT gen_random_uuid(), erp.current_tenant_id(), ${xpRunA},
             ${fixture.warehouseRaw}, ${xpFg}, b,
             current_date + b,
             (ARRAY['MPS','SALES_ORDER','SAFETY_STOCK','BOM_EXPLOSION'])[1 + (k % 4)],
             (b * 10 + k)::numeric,
             CASE WHEN k % 4 = 3 THEN ${xpFg}::uuid ELSE NULL END
      FROM generate_series(0::int, 13::int) AS b,
           generate_series(0::int, 3::int) AS k`);
    // Selectivity corpus: the same fold on other items (240 rows) and the
    // live run (56 rows) — the drill-down predicate (run + item) is then a
    // small fraction of the tenant's demand rows, so the planner's index
    // choice reflects the production shape, not an all-rows corner.
    await tx.execute(sql`
      INSERT INTO mrp_demand_lines
        (id, tenant_id, run_id, warehouse_id, item_id, bucket_index,
         bucket_start, demand_kind, qty, parent_item_id)
      SELECT gen_random_uuid(), erp.current_tenant_id(), ${xpRunA},
             ${fixture.warehouseRaw}, ${xpC1}, b,
             current_date + b,
             (ARRAY['MPS','SALES_ORDER','SAFETY_STOCK','BOM_EXPLOSION'])[1 + (k % 4)],
             (b * 10 + k)::numeric,
             NULL
      FROM generate_series(0::int, 59::int) AS b,
           generate_series(0::int, 3::int) AS k`);
    await tx.execute(sql`
      INSERT INTO mrp_demand_lines
        (id, tenant_id, run_id, warehouse_id, item_id, bucket_index,
         bucket_start, demand_kind, qty, parent_item_id)
      SELECT gen_random_uuid(), erp.current_tenant_id(), ${xpRunB},
             ${fixture.warehouseRaw}, ${xpFg}, b,
             current_date + b,
             (ARRAY['MPS','SALES_ORDER','SAFETY_STOCK','BOM_EXPLOSION'])[1 + (k % 4)],
             (b * 10 + k)::numeric,
             NULL
      FROM generate_series(0::int, 13::int) AS b,
           generate_series(0::int, 3::int) AS k`);
  });

  // Fresh inserts carry no statistics — ANALYZE (superuser) makes the
  // planner's choice reflect the seeded shape (the 041/042 precedent).
  const client = await superuserClient();
  await client.query("ANALYZE bills_of_materials");
  await client.query("ANALYZE bom_lines");
  await client.query("ANALYZE mrp_runs");
  await client.query("ANALYZE mrp_suggestions");
  await client.query("ANALYZE mrp_demand_lines");
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

describe("PHASE-043 OA-06 EXPLAIN budgets (T-19, acceptance 9)", () => {
  it("the explosion graph load (the engine's once-per-run BOM walk) is index-driven on both join legs — no seq-scan", async () => {
    // `loadActiveBomGraph` verbatim (the tenant predicate is the RLS-
    // injected effective filter, written out as the 042 precedent). The
    // plan shape is corpus-volume dependent — a small tenant drives from
    // the LINES leg (uq_bom_lines_bom_line, the BOM leg per bom_id through
    // pk_bills_of_materials under a Memoize); a fuller corpus hash-joins
    // the lines Bitmap (ix_bom_lines_tenant_component) with the ACTIVE
    // partial (uq_bills_of_materials_active_item). The BUDGET is the
    // invariant across both shapes: every leg index-served, the
    // deterministic line_no ordering available — never a seq scan.
    const text = await explain(sql`
      SELECT b.id, b.item_id, b.yield_pct, l.id, l.component_item_id,
             l.qty_per_output, l.scrap_pct, l.phantom_flag
      FROM bills_of_materials b JOIN bom_lines l ON l.bom_id = b.id
      WHERE b.tenant_id = erp.current_tenant_id()
        AND l.tenant_id = erp.current_tenant_id()
        AND b.status = 'ACTIVE'
      ORDER BY b.item_id, l.line_no`);
    expect(text).toMatch(
      /Index (Only )?Scan( Backward)? using (uq_bom_lines_bom_line|ix_bom_lines_tenant_component)|Bitmap Index Scan on (uq_bom_lines_bom_line|ix_bom_lines_tenant_component)/,
    );
    expect(text).toMatch(
      /Index (Only )?Scan( Backward)? using (pk_bills_of_materials|uq_bills_of_materials_active_item|ix_bills_of_materials_tenant_status)|Bitmap Index Scan on (pk_bills_of_materials|uq_bills_of_materials_active_item|ix_bills_of_materials_tenant_status)/,
    );
    expect(text).not.toMatch(/Seq Scan/);
  });

  it("the suggestions board (the /manufacturing/mrp primary load) rides ix_mrp_suggestions_tenant_status — no seq-scan", async () => {
    // `listSuggestions` with the board's default filters (status +
    // suggestion_type + the due-date ordering, limit 200) — the
    // (tenant_id, status, suggestion_type) covering prefix.
    const text = await explain(sql`
      SELECT id, run_id, item_id, warehouse_id, suggestion_type, qty,
             due_date, release_date, frozen_fence, status, netting
      FROM mrp_suggestions
      WHERE tenant_id = erp.current_tenant_id()
        AND status = 'SUGGESTED'
        AND suggestion_type = 'PURCHASE_ORDER'
      ORDER BY due_date, item_id
      LIMIT 200`);
    expect(text).toMatch(
      /Index (Only )?Scan( Backward)? using ix_mrp_suggestions_tenant_status|Bitmap Index Scan on ix_mrp_suggestions_tenant_status/,
    );
    expect(text).not.toMatch(/Seq Scan/);
  });

  it("the run-history list (the screen's first panel) rides ix_mrp_runs_tenant_wh_created — no seq-scan", async () => {
    // `listMrpRuns` scoped to the warehouse (created_at DESC, limit 50) —
    // the (tenant_id, warehouse_id, created_at) path.
    const text = await explain(sql`
      SELECT id, status, run_mode, bucket_size, horizon_buckets, warehouse_id,
             as_of_date, stats, created_at
      FROM mrp_runs
      WHERE tenant_id = erp.current_tenant_id()
        AND warehouse_id = ${fixture.warehouseRaw}
      ORDER BY created_at DESC
      LIMIT 50`);
    expect(text).toMatch(
      /Index (Only )?Scan( Backward)? using ix_mrp_runs_tenant_wh_created|Bitmap Index Scan on ix_mrp_runs_tenant_wh_created/,
    );
    expect(text).not.toMatch(/Seq Scan/);
  });

  it("the netting drill-down (the run detail's per-item fold) rides ix_mrp_demand_lines_run_item — no seq-scan", async () => {
    // `listMrpDemandLines` for one run narrowed to one item — the store's
    // verbatim ordering (item_id, bucket_index, demand_kind) matches the
    // (tenant_id, run_id, item_id, bucket_index) tail, so the per-item
    // fold rides the index order.
    const text = await explain(sql`
      SELECT id, item_id, bucket_index, bucket_start, demand_kind, qty,
             parent_item_id
      FROM mrp_demand_lines
      WHERE tenant_id = erp.current_tenant_id()
        AND run_id = ${xpRunA}
        AND item_id = ${xpFg}
      ORDER BY item_id, bucket_index, demand_kind`);
    expect(text).toMatch(
      /Index (Only )?Scan( Backward)? using ix_mrp_demand_lines_run_item|Bitmap Index Scan on ix_mrp_demand_lines_run_item/,
    );
    expect(text).not.toMatch(/Seq Scan/);
  });
});
