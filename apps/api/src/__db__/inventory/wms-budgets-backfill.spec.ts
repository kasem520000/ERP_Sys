import { beforeAll, describe, expect, it } from "vitest";

import { sql } from "drizzle-orm";

import { superuserClient } from "../test-db";
import { withTenant } from "../../infra/db/tenant-context";
import { WmsService } from "../../modules/inventory/application/wms.service";
import * as wmsStore from "../../modules/inventory/infrastructure/wms-store";
import { AuditService } from "../../modules/audit/api/audit";
import { DrizzleAuditStore } from "../../modules/audit/infrastructure/drizzle-audit.store";
import { InboxService } from "../../modules/notifications/application/inbox-service";
import * as store from "../../modules/inventory/infrastructure/inventory.store";
import {
  I_ACTOR,
  TENANT_I,
  ensureInventoryItem,
  setupInventoryFixture,
  stock,
  type InventoryFixture,
} from "./fixtures";

/**
 * PHASE-044 T-20 — the acceptance evidence: the OA-06 EXPLAIN budgets for
 * the three hot WMS paths (the directed-pick allocation walk + the INV-029
 * probe fold over `bin_contents`, the per-serial ledger walk over
 * `serial_movements`, and the open-task board over `pick_tasks`) and the
 * legacy-stock backfill (§7's mitigation: dry-run report → the default-bin
 * landing → the fold exact → idempotent).
 *
 * The EXPLAIN method follows the PHASE-041 recorded precedent verbatim:
 * representative rows seeded first and ANALYZEd so the planner's index
 * choice is meaningful, enable_seqscan=off isolates the index proof from
 * the planner's volume-dependent cost choice — the budget under test is
 * the INDEX SHAPE servicing the hot path (the 0067–0069 indexes).
 */

let fixture: InventoryFixture;
let wms: WmsService;
let budgetItem = "";

const SKU = "INV-T20-BUDGET";
/** The legacy item: item_stock WITHOUT bin rows (the pre-WMS residue). */
const LEGACY_SKU = "INV-T20-LEGACY";
let legacyItem = "";

beforeAll(async () => {
  fixture = await setupInventoryFixture();
  wms = new WmsService(new AuditService(new DrizzleAuditStore()), new InboxService());
  const wh = fixture.warehouseMain;

  // -- The budget substrate: one item with 300 AVAILABLE rows spread over
  // received_at (the FIFO/FEFO walk's sort), 150 QUARANTINE noise rows,
  // and one serialized item with a 200-row ledger.
  budgetItem = await ensureInventoryItem(SKU, "T-20 budget item");
  const defaultBin = await withTenant(TENANT_I, () => wmsStore.ensureDefaultBin(wh));
  // The slot floor (uq_bin_contents_slot, NULLS NOT DISTINCT): one row per
  // (bin, item, batch, serial, lpn, owner, status) — so the corpus spreads
  // over one DEDICATED bin per row (300 AVAILABLE + 150 QUARANTINE), the
  // honest shape a large warehouse's directed-pick surface walks.
  await withTenant(TENANT_I, async (tx) => {
    await tx.execute(sql`
      INSERT INTO warehouse_zones (id, tenant_id, warehouse_id, code, name, zone_type)
      VALUES ('0e70b000-0000-7000-8000-0000000000b1', erp.current_tenant_id(), ${wh},
              'T20-BUDGET', 'T-20 budget zone', 'PICKING')
      ON CONFLICT DO NOTHING`);
    await tx.execute(sql`
      INSERT INTO warehouse_aisles (id, tenant_id, zone_id, code, name)
      VALUES ('0e70b000-0000-7000-8000-0000000000b2', erp.current_tenant_id(),
              '0e70b000-0000-7000-8000-0000000000b1', 'T20-A1', 'T-20 budget aisle')
      ON CONFLICT DO NOTHING`);
    await tx.execute(sql`
      INSERT INTO warehouse_racks (id, tenant_id, aisle_id, code, name)
      VALUES ('0e70b000-0000-7000-8000-0000000000b3', erp.current_tenant_id(),
              '0e70b000-0000-7000-8000-0000000000b2', 'T20-R1', 'T-20 budget rack')
      ON CONFLICT DO NOTHING`);
    await tx.execute(sql`
      INSERT INTO warehouse_bins (id, tenant_id, rack_id, warehouse_id, code, barcode,
                                  name, pick_sequence, allow_mixed_batches, is_default)
      SELECT gen_random_uuid(), erp.current_tenant_id(),
             '0e70b000-0000-7000-8000-0000000000b3', ${wh},
             'T20-BIN-' || lpad(g::text, 4, '0'), 'BIN-T20-' || lpad(g::text, 4, '0'),
             'T-20 budget bin ' || g, g + 1, true, false
      FROM generate_series(0::int, 449::int) AS g`);
    await tx.execute(sql`
      INSERT INTO bin_contents
        (id, tenant_id, bin_id, warehouse_id, item_id, status, qty, received_at)
      SELECT gen_random_uuid(), erp.current_tenant_id(), b.id, ${wh}, ${budgetItem},
             CASE WHEN b.pick_sequence <= 300 THEN 'AVAILABLE' ELSE 'QUARANTINE' END, 1,
             now() - ((b.pick_sequence - 1) * interval '1 hour')
      FROM warehouse_bins b
      WHERE b.warehouse_id = ${wh} AND b.code LIKE 'T20-BIN-%'
    `);
  });
  const serialItem = await ensureInventoryItem("INV-T20-SER", "T-20 serial item", {
    trackSerial: true,
  });
  const serialRow = await withTenant(TENANT_I, async () => {
    const { TrackingService } = await import(
      "../../modules/inventory/application/tracking-service"
    );
    const tracking = new TrackingService(new AuditService(new DrizzleAuditStore()), stock);
    return tracking.registerSerial({
      itemId: serialItem,
      serialNo: "T20-SER-0001",
      imei: null,
      actorId: I_ACTOR,
    });
  });
  await withTenant(TENANT_I, async (tx) => {
    for (let batch = 0; batch < 4; batch += 1) {
      await tx.execute(sql`
        INSERT INTO serial_movements
          (id, tenant_id, serial_id, event, move_id, source_type, source_id,
           from_bin_id, to_bin_id, moved_at, note, created_by)
        SELECT gen_random_uuid(), erp.current_tenant_id(), ${serialRow.id},
               (ARRAY['RECEIVE','PICK','TRANSFER_IN','ADJUST_IN'])[1 + (g % 4)],
               NULL, 'budget_seed', gen_random_uuid(), NULL, NULL,
               now() - (g * interval '1 minute'), 'budget seed', NULL
        FROM generate_series(${batch * 50}::int, ${batch * 50 + 49}::int) AS g`);
    }
  });
  // The open-task board: 200 open PUTAWAY + 200 open PICK + 100 completed
  // noise rows.
  await withTenant(TENANT_I, async (tx) => {
    // The direction floor (ck_pick_tasks_direction): a PICK names its
    // from_bin; a PUTAWAY names its to_bin — the seed honors both.
    for (const [kind, status, count] of [
      ["PUTAWAY", "PENDING", 200],
      ["PICK", "PENDING", 200],
      ["PICK", "COMPLETED", 100],
    ] as const) {
      const fromBin = kind === "PICK" ? (defaultBin?.id ?? null) : null;
      const toBin = kind === "PUTAWAY" ? (defaultBin?.id ?? null) : null;
      await tx.execute(sql`
        INSERT INTO pick_tasks
          (id, tenant_id, task_kind, status, item_id, qty, from_bin_id, to_bin_id,
           source_type, source_id, sequence_no, created_at, completed_at)
        SELECT gen_random_uuid(), erp.current_tenant_id(), ${kind}, ${status},
               ${budgetItem}, 1, ${fromBin}, ${toBin},
               'budget_seed', gen_random_uuid(), g + 1, now() - (g * interval '1 minute'),
               CASE WHEN ${status} = 'COMPLETED' THEN now() ELSE NULL END
        FROM generate_series(0::int, ${count - 1}::int) AS g`);
    }
  });

  // -- The legacy residue: item_stock WITHOUT bin rows. Inserted through
  // raw SQL (the honest pre-WMS shape — every economic surface today
  // writes bins, so the residue is exactly what the migration-era tables
  // looked like before 0067).
  legacyItem = await ensureInventoryItem(LEGACY_SKU, "T-20 legacy item");
  await withTenant(TENANT_I, async (tx) => {
    await tx.execute(sql`
      INSERT INTO item_stock (id, tenant_id, item_id, warehouse_id, qty, avg_cost)
      VALUES (gen_random_uuid(), erp.current_tenant_id(), ${legacyItem}, ${wh},
              75, 2.500000)
      ON CONFLICT DO NOTHING`);
  });

  // ANALYZE (superuser) so the planner reflects the seeded shapes.
  const client = await superuserClient();
  await client.query("ANALYZE bin_contents");
  await client.query("ANALYZE serial_movements");
  await client.query("ANALYZE pick_tasks");
  await client.end();
});

async function explain(query: ReturnType<typeof sql>): Promise<string> {
  const plan = await withTenant(TENANT_I, async (tx) => {
    await tx.execute(sql`SET LOCAL enable_seqscan = off`);
    const rows = await tx.execute(sql`EXPLAIN ${query}`);
    return (rows.rows as unknown as Array<{ "QUERY PLAN": string }>).map(
      (row) => row["QUERY PLAN"],
    );
  });
  return plan.join("\n");
}

describe("PHASE-044 OA-06 EXPLAIN budgets (acceptance 10)", () => {
  it("the directed-pick allocation walk is index-driven over the FEFO/FIFO index — no seq-scan", async () => {
    // listPickableRows' shape: the tenant + item + AVAILABLE + qty>0
    // predicate under the received_at order (FIFO).
    const text = await explain(sql`
      SELECT bc.id, bc.bin_id, bc.qty
      FROM bin_contents bc
      WHERE bc.warehouse_id = ${fixture.warehouseMain}
        AND bc.item_id = ${budgetItem}
        AND bc.owner_partner_id IS NULL
        AND bc.status = 'AVAILABLE'
        AND bc.qty > 0
      ORDER BY bc.received_at, bc.id
      LIMIT 100`);
    expect(text).toMatch(
      /Index (Only )?Scan( Backward)? using ix_bin_contents_(pick_fefo|tenant_item_status|tenant_wh_item_owner)|Bitmap Index Scan on ix_bin_contents_(pick_fefo|tenant_item_status|tenant_wh_item_owner|tenant_serial)/,
    );
    expect(text).not.toMatch(/Seq Scan/);
  });

  it("the INV-029 probe fold (per warehouse × item) rides the probe index — no seq-scan", async () => {
    const text = await explain(sql`
      SELECT warehouse_id, item_id, sum(qty)
      FROM bin_contents
      WHERE tenant_id = erp.current_tenant_id() AND owner_partner_id IS NULL
      GROUP BY warehouse_id, item_id`);
    expect(text).toMatch(
      /Index (Only )?Scan using ix_bin_contents_(tenant_wh_item_owner|tenant_item_status|tenant_bin|tenant_serial)|Bitmap Index Scan on ix_bin_contents_(tenant_wh_item_owner|tenant_item_status|tenant_bin|tenant_serial)/,
    );
    expect(text).not.toMatch(/Seq Scan/);
  });

  it("the serial-ledger walk (newest-first per serial) rides the ledger index — no seq-scan", async () => {
    const text = await explain(sql`
      SELECT id, event, moved_at
      FROM serial_movements
      WHERE tenant_id = erp.current_tenant_id()
        AND serial_id = (SELECT id FROM item_serials WHERE serial_no = 'T20-SER-0001' LIMIT 1)
      ORDER BY moved_at DESC
      LIMIT 200`);
    expect(text).toMatch(
      /Index (Only )?Scan( Backward)? using ix_serial_movements_(tenant_serial_time|tenant_source|tenant_move)|Bitmap Index Scan on ix_serial_movements_(tenant_serial_time|tenant_source|tenant_move)/,
    );
    expect(text).not.toMatch(/Seq Scan/);
  });

  it("the pick-task board (open tasks by kind) rides the kind-status index — no seq-scan", async () => {
    // listTasks' shape: the task_kind + status predicate under the
    // created_at order — the board's every-load query.
    const text = await explain(sql`
      SELECT id, item_id, qty, status, created_at
      FROM pick_tasks
      WHERE tenant_id = erp.current_tenant_id()
        AND task_kind = 'PICK' AND status = 'PENDING'
      ORDER BY created_at DESC
      LIMIT 200`);
    expect(text).toMatch(
      /Index (Only )?Scan( Backward)? using ix_pick_tasks_(tenant_kind_status|tenant_wave_status|tenant_assignee_status)|Bitmap Index Scan on ix_pick_tasks_(tenant_kind_status|tenant_wave_status|tenant_assignee_status)/,
    );
    expect(text).not.toMatch(/Seq Scan/);
  });
});

describe("PHASE-044 T-20 — the legacy-stock backfill (acceptance §7)", () => {
  it("DRY-RUN reports the shortfall without writing; the LIVE pass lands it on the DEFAULT bin and the fold goes exact; idempotent", async () => {
    const wh = fixture.warehouseMain;

    // The pre-state: the probe sees the legacy shortfall (bins 0 vs 75).
    const before = await withTenant(TENANT_I, () => wmsStore.reconcileBins({ warehouseId: wh }));
    const legacyBefore = before.find((row) => row.itemSku === LEGACY_SKU);
    expect(legacyBefore).toBeDefined();
    expect(legacyBefore!.binQty).toBe("0");
    expect(legacyBefore!.stockQty).toBe("75.000000");

    // DRY-RUN: the report names the shortfall, nothing written.
    const dry = await withTenant(TENANT_I, () =>
      wms.backfillDefaultBins({ dryRun: true, actorId: I_ACTOR }),
    );
    expect(dry.dryRun).toBe(true);
    expect(dry.rows).toBe(0);
    const reported = dry.report.find((row) => row.itemSku === LEGACY_SKU);
    expect(reported).toBeDefined();
    expect(reported!.shortfall).toBe("75.000000");
    const stillDrifted = await withTenant(TENANT_I, () =>
      wmsStore.reconcileBins({ warehouseId: wh }),
    );
    expect(stillDrifted.some((row) => row.itemSku === LEGACY_SKU)).toBe(true);

    // LIVE: the shortfall lands on the DEFAULT bin, AVAILABLE, tenant-owned.
    const live = await withTenant(TENANT_I, () =>
      wms.backfillDefaultBins({ dryRun: false, actorId: I_ACTOR }),
    );
    expect(live.rows).toBeGreaterThanOrEqual(1);
    expect(live.dryRun).toBe(false);
    const defaultBin = await withTenant(TENANT_I, () => wmsStore.ensureDefaultBin(wh));
    expect(defaultBin).toBeDefined();
    const landed = await withTenant(TENANT_I, () =>
      wmsStore.listBinContents({ binId: defaultBin!.id, itemId: legacyItem, limit: 10 }),
    );
    const backfillRow = landed.find((row) => row.note?.includes("backfill"));
    expect(backfillRow).toBeDefined();
    expect(backfillRow!.qty).toBe("75.000000");
    expect(backfillRow!.status).toBe("AVAILABLE");
    expect(backfillRow!.ownerPartnerId).toBeNull();

    // The fold goes exact for the legacy item and the probe clears it.
    const stockRow = await withTenant(TENANT_I, () => store.findItemStock(legacyItem, wh));
    const binSum = landed
      .filter((row) => row.ownerPartnerId === null)
      .reduce((sum, row) => sum + Number(row.qty), 0);
    expect(binSum).toBe(Number(stockRow?.qty ?? 0));
    const after = await withTenant(TENANT_I, () => wmsStore.reconcileBins({ warehouseId: wh }));
    expect(after.some((row) => row.itemSku === LEGACY_SKU)).toBe(false);

    // Idempotent: a second run finds no shortfall for THIS item (the
    // per-SKU filter is corpus-honest — tenant I accumulates other specs'
    // intentional drift elsewhere, the wms-inv029 precedent).
    const second = await withTenant(TENANT_I, () =>
      wms.backfillDefaultBins({ dryRun: false, actorId: I_ACTOR }),
    );
    expect(second.report.some((row) => row.itemSku === LEGACY_SKU)).toBe(false);
    expect(
      second.report.filter((row) => row.classification === "WRITABLE").length,
    ).toBe(0);
  });
});
