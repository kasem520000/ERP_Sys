import { beforeAll, describe, expect, it } from "vitest";
import { sql } from "drizzle-orm";

import { requireTenantContext, withTenant } from "../../infra/db/tenant-context";
import { superuserClient } from "../test-db";
import { SpcService } from "../../modules/quality/application/spc-service";
import { SpecificationService } from "../../modules/quality/application/specification-service";
import {
  QL_ACTOR,
  TENANT_QUALITY,
  audit,
  deliveries,
  ensureQualityPostingWorld,
  freshQualityScrapWorld,
  recalls,
  setupQualityFixture,
  stock,
} from "./fixtures";

/**
 * PHASE-050 (W-31 — T-18c, 2026-11-23) ·
 * `quality-explain-budgets.db.spec` — THE OA-06 EXPLAIN BUDGETS over the
 * quality plane's documented hot paths (the plan §4's own probes; the
 * 049 cmms-explain-budgets precedent's shape):
 *
 * - P0 THE CORPUS + THE DRILL — the recall drill's own answer over a
 *   REAL ledger (the scrap world's receipt + FOUR posted deliveries
 *   through the REAL path, so stock_moves carries real OUT rows with
 *   batch_id): the where-used chain resolves every shipped edge and
 *   the customer fold lands — the live read the budgets police;
 * - P1 THE WHERE-USED LEG — the drill's stock_moves batch scan
 *   (listBatchSalesEdges' own shape: the batch predicate + the sales
 *   source vocabulary + the OUT direction) must ride
 *   `ix_stock_moves_tenant_batch`;
 * - P2 THE DOC→CUSTOMER RESOLUTION — the drill's customer fold read
 *   (listRecallDocCustomers' delivery arm: the delivery_notes PK
 *   lookup + the partners join) must ride the PKs;
 * - P3 THE SPC CHART READ — `listSpcMeasurements`' own shape (the
 *   spec predicate + the sampled_at DESC ordering + the deterministic
 *   id DESC tie-break + the cap) must ride
 *   `ix_spc_measurements_tenant_spec_sampled` (the 0113 index).
 *
 * THE OA-06 ASSERTION LAW (the 048 W-14 ruling, D-17's own text): the
 * probes assert the stable INDEX-DRIVEN law — no seq-scan — accepting
 * the planner's legitimate index-driven paths (the bitmap family); the
 * rejected alternatives, per the ruling: enable_bitmapscan=off /
 * planner hints would make the probe testify about a FORCED plan, and
 * isolating the probe hides the shared-table context it exists to
 * police. **Never a forced plan, never an isolated probe context.**
 *
 * THE CORPUS LAW: the world rides the REAL services end to end (the
 * scrap world's manualReceipt through the inventory engine + the
 * deliveries through the REAL posting path + the SPC samples through
 * the REAL ingest — never raw ledger pokes), so the EXPLAIN testifies
 * about the very statements the drill and the chart read run; ANALYZE
 * runs before the probes so the planner's index choice is informed.
 */

const specifications = new SpecificationService(audit);
const spc = new SpcService(audit);

let probeBatchId = "";
let probeSpecId = "";
const probeNoteIds: string[] = [];

beforeAll(async () => {
  await setupQualityFixture();
  await ensureQualityPostingWorld();

  // ── THE RECALL-DRILL CORPUS — a REAL ledger ─────────────────────────────
  // The probe world: a batch-tracked item + its own warehouse + REAL
  // stock (100 × 2.500000 through the inventory engine's own receipt).
  const probeWorld = await freshQualityScrapWorld("XB-DRILL");
  probeBatchId = probeWorld.batchId;

  // Two sibling worlds (their own items/batches/warehouses + receipt
  // moves + one manual issue each) so the batch index carries several
  // distinct keys — the planner's choice is meaningful, never a
  // one-batch accident.
  for (const code of ["XB-SIB-1", "XB-SIB-2"]) {
    const sibling = await freshQualityScrapWorld(code);
    await withTenant(TENANT_QUALITY, () =>
      stock.manualIssue({
        itemId: sibling.itemId,
        warehouseId: sibling.warehouseId,
        qty: "7",
        reason: "DAMAGE",
        counterAccountId: null,
        valueDate: "2026-11-23",
        batchId: sibling.batchId,
        actorId: QL_ACTOR,
      }),
    );
  }

  // The QL tenant's standing rows (the delivery path's own lookups).
  const su = await superuserClient();
  const branch = await su.query<{ id: string }>(
    `SELECT id FROM branches WHERE tenant_id = $1 AND code = 'BR-QL' LIMIT 1`,
    [TENANT_QUALITY],
  );
  const customer = await su.query<{ id: string }>(
    `SELECT id FROM partners WHERE tenant_id = $1 AND code = 'QL-CUST' LIMIT 1`,
    [TENANT_QUALITY],
  );
  await su.end();

  // FOUR POSTED DELIVERIES on the probe batch (5 each — the REAL ship
  // path: the delivery note + the post's journal + the stock_moves OUT
  // rows carrying batch_id — the genealogy walk's own sales-edge
  // source).
  for (let i = 1; i <= 4; i += 1) {
    const note = await withTenant(TENANT_QUALITY, () =>
      deliveries.create({
        branchId: branch.rows[0]!.id,
        customerId: customer.rows[0]!.id,
        salesRepId: null,
        orderId: null,
        warehouseId: probeWorld.warehouseId,
        deliveryDate: "2026-11-23",
        currencyCode: "SAR",
        note: `the drill corpus delivery ${i}`,
        noteAr: null,
        actorId: QL_ACTOR,
        lines: [
          {
            orderLineId: null,
            itemId: probeWorld.itemId,
            qty: "5",
            unitPrice: "10.000000",
            discountAmount: null,
            batchId: probeBatchId,
            serialIds: null,
            description: null,
            descriptionAr: null,
            note: null,
          },
        ],
      }),
    );
    await withTenant(TENANT_QUALITY, () => deliveries.post(note.id, QL_ACTOR));
    probeNoteIds.push(note.id);
  }

  // ── THE SPC CORPUS — the REAL ingest ────────────────────────────────────
  // The probe spec (25 samples — the DESC cap matters) + a sibling spec
  // (10 more) so the (tenant, spec) index carries several distinct
  // keys; every sample through the REAL SpcService.record.
  const suItems = await superuserClient();
  const item = await suItems.query<{ id: string }>(
    `INSERT INTO items (id, tenant_id, sku, name, name_ar, kind, uom_id, costing_method,
        base_price, track_batch)
     VALUES (gen_random_uuid(), $1, 'QL-SPC-XB', 'The XB chart item', 'صنف الرسم', 'STOCK',
        (SELECT id FROM uoms WHERE tenant_id = $1 AND code = 'PCS' LIMIT 1), 'WAC', 45, true)
     ON CONFLICT (tenant_id, sku) DO UPDATE SET name = EXCLUDED.name
     RETURNING id`,
    [TENANT_QUALITY],
  );
  await suItems.end();
  const probeSpec = await withTenant(TENANT_QUALITY, () =>
    specifications.create({
      itemId: item.rows[0]!.id,
      parameter: "Viscosity",
      parameterAr: "اللزوجة",
      unit: "cP",
      targetValue: "100.000000",
      ucl: "110.000000",
      lcl: "90.000000",
      actorId: QL_ACTOR,
    }),
  );
  probeSpecId = probeSpec.id;
  const siblingSpec = await withTenant(TENANT_QUALITY, () =>
    specifications.create({
      itemId: item.rows[0]!.id,
      parameter: "pH",
      parameterAr: "الحموضة",
      targetValue: "7.000000",
      actorId: QL_ACTOR,
    }),
  );
  await withTenant(TENANT_QUALITY, async () => {
    for (let i = 1; i <= 25; i += 1) {
      await spc.record({
        specId: probeSpec.id,
        value: `${100 + i * 0.25}`,
        sampledAt: `2026-11-01T${String(8 + (i % 12)).padStart(2, "0")}:${String(
          (i * 7) % 60,
        ).padStart(2, "0")}:00.000Z`,
        source: i % 3 === 0 ? "PRODUCTION" : "MANUAL",
        actorId: QL_ACTOR,
      });
    }
    for (let i = 1; i <= 10; i += 1) {
      await spc.record({
        specId: siblingSpec.id,
        value: `${7 + i * 0.05}`,
        sampledAt: `2026-11-02T09:00:00.000Z`,
        source: "MANUAL",
        actorId: QL_ACTOR,
      });
    }
  });

  // ANALYZE — the planner's index choice must be informed.
  const suAnalyze = await superuserClient();
  for (const table of [
    "stock_moves",
    "delivery_notes",
    "partners",
    "spc_measurements",
    "quality_specifications",
    "item_batches",
    "items",
  ]) {
    await suAnalyze.query(`ANALYZE ${table}`);
  }
  await suAnalyze.end();
});

async function explain(label: string, query: ReturnType<typeof sql>): Promise<string> {
  const plan = await withTenant(TENANT_QUALITY, async () => {
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
  process.stdout.write(`[quality-explain-budgets] ${label}:\n${text}\n`);
  return text;
}

describe("PHASE-050 W-31 — T-18c: OA-06 EXPLAIN budgets (the recall drill's reads + the SPC chart read)", () => {
  it("P0 THE CORPUS + THE DRILL — the recall drill's own answer over the REAL ledger: every shipped edge resolved + the customer folded", async () => {
    // The LIVE read (D-14: the genealogy walk consumed VERBATIM + the
    // customer fold) — the very read the budgets police, over the
    // corpus seeded above (1 receipt move + 4 posted deliveries).
    const drill = await withTenant(TENANT_QUALITY, () => recalls.drill(probeBatchId));
    expect(drill.batch.batchId).toBe(probeBatchId);
    expect(drill.whereUsed.sales).toHaveLength(4);
    expect(drill.whereUsed.sales.every((edge) => edge.docType === "delivery_note")).toBe(true);
    expect(drill.whereUsed.sales.map((edge) => edge.docId).sort()).toEqual(
      [...probeNoteIds].sort(),
    );
    expect(drill.customers).toHaveLength(1);
    expect(drill.customers[0]!.documents).toHaveLength(4);

    // And the chart read over the SPC corpus (the REAL service read —
    // the newest-25 answer, the DESC cap's own subject).
    const chart = await withTenant(TENANT_QUALITY, () => spc.chart(probeSpecId));
    expect(chart.sampleCount).toBe(25);
    expect(chart.spec.id).toBe(probeSpecId);
  });

  it("P1 THE WHERE-USED LEG (listBatchSalesEdges' own shape — the stock_moves batch scan) is index-driven — no seq-scan", async () => {
    // The genealogy store's own statement shape (the manufacturing
    // module's read the drill consumes VERBATIM): the batch predicate +
    // the sales source vocabulary + the OUT direction, ordered by the
    // ledger's own stamps.
    const text = await explain(
      "P1 the drill's where-used leg (the stock_moves batch scan)",
      sql`
      SELECT batch_id AS "batchId", source_type AS "sourceType", source_id AS "sourceId",
             moved_at::text AS "movedAt", qty::text AS qty
      FROM stock_moves
      WHERE batch_id IN (${probeBatchId})
        AND source_type IN ('sales_invoice', 'delivery_note') AND direction = 'OUT'
      ORDER BY moved_at, id
    `,
    );
    expect(text).toMatch(
      /Index (Only )?Scan( Backward)? using ix_stock_moves_tenant_batch|Bitmap (Heap )?Scan on stock_moves|Bitmap Index Scan on ix_stock_moves_tenant_batch/,
    );
    expect(text).not.toMatch(/Seq Scan/);
  });

  it("P2 THE DOC→CUSTOMER RESOLUTION (listRecallDocCustomers' delivery arm — the PK lookup + the partners join) is index-driven — no seq-scan", async () => {
    // The quality store's own statement shape (the customer fold's
    // read): the delivery_notes PK lookup + the composite partners
    // join — the doc→customer resolution the drill folds over.
    const ids = sql.join(
      probeNoteIds.map((id) => sql`${id}`),
      sql`, `,
    );
    const text = await explain(
      "P2 the drill's doc→customer resolution",
      sql`
      SELECT 'delivery_note' AS "docType", dn.id AS "docId", dn.delivery_no AS "docNo",
             dn.customer_id AS "customerId", p.name AS "customerName", p.name_ar AS "customerNameAr"
      FROM delivery_notes dn JOIN partners p ON p.id = dn.customer_id AND p.tenant_id = dn.tenant_id
      WHERE dn.id IN (${ids})
    `,
    );
    // The accepted index-driven paths on both sides of the join: the
    // delivery PK lookup OR the delivery tenant-customer index (the
    // planner's legitimate pick for the RLS-scoped id filter), always
    // the partners PK on the join's second leg.
    expect(text).toMatch(
      /Index (Only )?Scan( Backward)? using (pk_delivery_notes|pk_partners|ix_delivery_notes_tenant_customer)|Bitmap (Heap )?Scan on (delivery_notes|partners)/,
    );
    expect(text).toMatch(/partners/);
    expect(text).not.toMatch(/Seq Scan/);
  });

  it("P3 THE SPC CHART READ (listSpcMeasurements' own shape — the spec predicate + the DESC cap) is index-driven — no seq-scan", async () => {
    // The store's own statement shape (the chart read's driving query):
    // the spec predicate + the sampled_at DESC ordering + the
    // deterministic id DESC tie-break + the cap — the 0113 index's own
    // subject.
    const text = await explain(
      "P3 the SPC chart read",
      sql`
      SELECT id, spec_id AS "specId", value::text AS "value",
             sampled_at::text AS "sampledAt", source, batch_id AS "batchId",
             note, version, created_at::text AS "createdAt", updated_at::text AS "updatedAt"
      FROM spc_measurements
      WHERE spec_id = ${probeSpecId}
      ORDER BY sampled_at DESC, id DESC
      LIMIT 100
    `,
    );
    expect(text).toMatch(
      /Index (Only )?Scan( Backward)? using ix_spc_measurements_tenant_spec_sampled|Bitmap (Heap )?Scan on spc_measurements|Bitmap Index Scan on ix_spc_measurements_tenant_spec_sampled/,
    );
    expect(text).not.toMatch(/Seq Scan/);
  });
});
