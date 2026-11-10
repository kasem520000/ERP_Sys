import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { withTenant } from "../../infra/db/tenant-context";
import * as inventoryStore from "../../modules/inventory/infrastructure/inventory.store";
import { TENANT_M, genealogy, setupMfgFixture, type MfgFixture } from "./fixtures";

/**
 * PHASE-018 T39 — the genealogy recall walks (MASTER-PLAN §10) over the §8
 * golden chain: upstream materials (bread → dough+packaging → flour+yeast),
 * downstream productions + the sale edge, and the batch summaries — pure
 * READS on the fixture's own rows (the chain completed inside
 * setupMfgFixture; this spec never writes anything).
 *
 * Shared-suite discipline (tenant M, sequential run, vitest order NOT
 * guaranteed): the upstream walks and every dough/bread/packaging downstream
 * walk touch edges ONLY the golden chain created, so they pin EXACT edge
 * sets. The one exception is downstream(flour): the shared suite's other
 * packs (orders.spec/costing.spec) FEFO-consume the golden flour batch M-F1,
 * so that walk pins the CHAIN's own edges (the dough hop at level 1, the
 * bread hop at level 2, the single sale at level 3) plus the invariants that
 * hold regardless of the extra level-1 consumers — never the absolute list.
 *
 * The read-only guarantee (§10: "genealogy NEVER writes") is proven by
 * capturing journal count, audit count, the bread stock position, and the
 * chain batch statuses before the walks and asserting them unchanged after
 * every read — plus zero audit rows with a manufacturing.genealogy* action.
 */

let fixture: MfgFixture;

/** Read-only baseline, captured in beforeAll and re-asserted in afterAll. */
let baseline = {
  journals: 0,
  auditEvents: 0,
  breadStock: { qty: "0.000000", avgCost: "0.000000" },
  doughBatchStatus: "",
  breadBatchStatus: "",
};

async function countRows(sqlText: string): Promise<number> {
  return withTenant(TENANT_M, async () => {
    const { sql } = await import("drizzle-orm");
    const { requireTenantContext } = await import("../../infra/db/tenant-context");
    const rows = await requireTenantContext().tx!.execute<{ n: number }>(sql.raw(sqlText));
    return rows.rows[0]!.n;
  });
}

async function captureBaseline() {
  const breadStock = await withTenant(TENANT_M, () =>
    inventoryStore.findItemStock(fixture.items.bread, fixture.warehouseFg),
  );
  const doughBatch = await withTenant(TENANT_M, () =>
    inventoryStore.findBatchById(fixture.chain.doughBatchId),
  );
  const breadBatch = await withTenant(TENANT_M, () =>
    inventoryStore.findBatchById(fixture.chain.breadBatchId),
  );
  baseline = {
    journals: await countRows(`SELECT count(*)::int AS n FROM journal_entries`),
    auditEvents: await countRows(`SELECT count(*)::int AS n FROM audit_events`),
    breadStock: { qty: breadStock?.qty ?? "0.000000", avgCost: breadStock?.avgCost ?? "0.000000" },
    doughBatchStatus: doughBatch!.status,
    breadBatchStatus: breadBatch!.status,
  };
}

beforeAll(async () => {
  fixture = await setupMfgFixture();
  await captureBaseline();
});

afterAll(async () => {
  // The read-only guarantee: nothing the walks touched moved.
  const breadStock = await withTenant(TENANT_M, () =>
    inventoryStore.findItemStock(fixture.items.bread, fixture.warehouseFg),
  );
  expect(breadStock?.qty ?? "0.000000").toBe(baseline.breadStock.qty);
  expect(breadStock?.avgCost ?? "0.000000").toBe(baseline.breadStock.avgCost);
  expect(await countRows(`SELECT count(*)::int AS n FROM journal_entries`)).toBe(baseline.journals);
  expect(await countRows(`SELECT count(*)::int AS n FROM audit_events`)).toBe(baseline.auditEvents);
  expect((await withTenant(TENANT_M, () => inventoryStore.findBatchById(fixture.chain.doughBatchId)))!.status).toBe(
    baseline.doughBatchStatus,
  );
  expect((await withTenant(TENANT_M, () => inventoryStore.findBatchById(fixture.chain.breadBatchId)))!.status).toBe(
    baseline.breadBatchStatus,
  );
  // … and the walks never audit: zero manufacturing.genealogy* rows exist.
  expect(await countRows(`SELECT count(*)::int AS n FROM audit_events WHERE action LIKE 'manufacturing.genealogy%'`)).toBe(
    0,
  );
});

describe("PHASE-018 T39 genealogy — upstream (materials of the golden chain)", () => {
  it("upstream(bread) — 4 edges over 2 levels: dough+packaging at 1, flour+yeast at 2 (the dough hop carries its producing order)", async () => {
    const chain = fixture.chain;
    const result = await withTenant(TENANT_M, () => genealogy.upstream(chain.breadBatchId));
    expect(result.batch).toEqual({
      batchId: chain.breadBatchId,
      batchNo: chain.breadBatchNo,
      itemId: fixture.items.bread,
      sku: "M-BREAD",
      status: "ACTIVE",
      expiryDate: "2026-03-10",
    });
    expect(result.materials).toHaveLength(4);
    expect(result.materials.map((edge) => edge.level)).toEqual([1, 1, 2, 2]);

    const level1 = new Map(result.materials.filter((e) => e.level === 1).map((e) => [e.batchId, e]));
    expect(level1.get(chain.doughBatchId)).toEqual({
      level: 1,
      batchId: chain.doughBatchId,
      batchNo: chain.doughBatchNo,
      itemId: fixture.items.dough,
      sku: "M-DOUGH",
      qty: "937.500000",
      consumedByOrderId: chain.breadOrder.id,
      consumedByOrderNo: chain.breadOrder.orderNo,
      producedByOrderId: chain.doughOrder.id,
      producedByOrderNo: chain.doughOrder.orderNo,
    });
    expect(level1.get(chain.packagingBatchId)).toEqual({
      level: 1,
      batchId: chain.packagingBatchId,
      batchNo: "M-P1",
      itemId: fixture.items.pack,
      sku: "M-PACK",
      qty: "234.375000",
      consumedByOrderId: chain.breadOrder.id,
      consumedByOrderNo: chain.breadOrder.orderNo,
      producedByOrderId: null, // purchased — no producing order
      producedByOrderNo: null,
    });

    const level2 = new Map(result.materials.filter((e) => e.level === 2).map((e) => [e.batchId, e]));
    expect(level2.get(chain.flourBatchId)).toEqual({
      level: 2,
      batchId: chain.flourBatchId,
      batchNo: "M-F1",
      itemId: fixture.items.flour,
      sku: "M-FLOUR",
      qty: "637.500000",
      consumedByOrderId: chain.doughOrder.id,
      consumedByOrderNo: chain.doughOrder.orderNo,
      producedByOrderId: null,
      producedByOrderNo: null,
    });
    expect(level2.get(chain.yeastBatchId)).toEqual({
      level: 2,
      batchId: chain.yeastBatchId,
      batchNo: "M-Y1",
      itemId: fixture.items.yeast,
      sku: "M-YEAST",
      qty: "125.000000",
      consumedByOrderId: chain.doughOrder.id,
      consumedByOrderNo: chain.doughOrder.orderNo,
      producedByOrderId: null,
      producedByOrderNo: null,
    });
  });

  it("upstream(dough) — level 1 = flour 637.500000 + yeast 125.000000 consumed by the dough order; no level 2", async () => {
    const chain = fixture.chain;
    const result = await withTenant(TENANT_M, () => genealogy.upstream(chain.doughBatchId));
    expect(result.batch.batchId).toBe(chain.doughBatchId);
    expect(result.batch.status).toBe("ACTIVE");
    expect(result.materials).toHaveLength(2);
    expect(result.materials.every((edge) => edge.level === 1)).toBe(true);
    expect(result.materials.every((edge) => edge.consumedByOrderId === chain.doughOrder.id)).toBe(true);
    const bySku = new Map(result.materials.map((edge) => [edge.sku, edge]));
    expect(bySku.get("M-FLOUR")!.qty).toBe("637.500000");
    expect(bySku.get("M-FLOUR")!.batchId).toBe(chain.flourBatchId);
    expect(bySku.get("M-YEAST")!.qty).toBe("125.000000");
    expect(bySku.get("M-YEAST")!.producedByOrderId).toBeNull();
  });

  it("upstream(purchased batch) — materials [] (flour was never produced)", async () => {
    const chain = fixture.chain;
    const result = await withTenant(TENANT_M, () => genealogy.upstream(chain.flourBatchId));
    expect(result.batch.sku).toBe("M-FLOUR");
    expect(result.materials).toEqual([]);
  });
});

describe("PHASE-018 T39 genealogy — downstream (productions + sales off the golden chain)", () => {
  it("downstream(flour) — the chain's own hops: dough order at 1, bread order at 2, the single sale at 3", async () => {
    const chain = fixture.chain;
    const result = await withTenant(TENANT_M, () => genealogy.downstream(chain.flourBatchId));
    expect(result.batch.batchId).toBe(chain.flourBatchId);

    // The chain's own production edges (see the header note: other packs
    // FEFO-consume M-F1, so the walk pins the CHAIN edges + invariants).
    const doughHop = result.productions.find((edge) => edge.orderId === chain.doughOrder.id);
    expect(doughHop).toEqual({
      level: 1,
      fromBatchId: chain.flourBatchId,
      fromBatchNo: "M-F1",
      orderId: chain.doughOrder.id,
      orderNo: chain.doughOrder.orderNo,
      orderStatus: "COMPLETED",
      fgBatchId: chain.doughBatchId,
      fgBatchNo: chain.doughBatchNo,
      fgItemId: fixture.items.dough,
      fgSku: "M-DOUGH",
      qty: "637.500000",
    });
    const breadHop = result.productions.find((edge) => edge.orderId === chain.breadOrder.id);
    expect(breadHop).toEqual({
      level: 2,
      fromBatchId: chain.doughBatchId,
      fromBatchNo: chain.doughBatchNo,
      orderId: chain.breadOrder.id,
      orderNo: chain.breadOrder.orderNo,
      orderStatus: "COMPLETED",
      fgBatchId: chain.breadBatchId,
      fgBatchNo: chain.breadBatchNo,
      fgItemId: fixture.items.bread,
      fgSku: "M-BREAD",
      qty: "937.500000",
    });
    // Invariants regardless of the shared flour pool: every level-1 edge
    // starts at the flour batch, and each chain order appears exactly once.
    expect(result.productions.filter((edge) => edge.level === 1).every((edge) => edge.fromBatchId === chain.flourBatchId)).toBe(true);
    expect(result.productions.filter((edge) => edge.orderId === chain.doughOrder.id)).toHaveLength(1);
    expect(result.productions.filter((edge) => edge.orderId === chain.breadOrder.id)).toHaveLength(1);
    expect(result.productions.filter((edge) => edge.orderId === chain.breadOrder.id)[0]!.level).toBe(2);

    // Sales: EXACTLY the golden invoice — 100 bread off the produced batch,
    // three hops deep (flour → dough batch → bread batch → the sale).
    expect(result.sales).toEqual([
      {
        level: 3,
        batchId: chain.breadBatchId,
        docType: "sales_invoice",
        docId: chain.saleInvoiceId,
        docDate: "2026-03-06",
        qty: "100.000000",
      },
    ]);
  });

  it("downstream(dough) — level 1 = the bread order; sales level 2 = the invoice", async () => {
    const chain = fixture.chain;
    const result = await withTenant(TENANT_M, () => genealogy.downstream(chain.doughBatchId));
    expect(result.productions).toHaveLength(1);
    expect(result.productions[0]).toEqual({
      level: 1,
      fromBatchId: chain.doughBatchId,
      fromBatchNo: chain.doughBatchNo,
      orderId: chain.breadOrder.id,
      orderNo: chain.breadOrder.orderNo,
      orderStatus: "COMPLETED",
      fgBatchId: chain.breadBatchId,
      fgBatchNo: chain.breadBatchNo,
      fgItemId: fixture.items.bread,
      fgSku: "M-BREAD",
      qty: "937.500000",
    });
    expect(result.sales).toEqual([
      {
        level: 2,
        batchId: chain.breadBatchId,
        docType: "sales_invoice",
        docId: chain.saleInvoiceId,
        docDate: "2026-03-06",
        qty: "100.000000",
      },
    ]);
  });

  it("downstream(bread) — sales level 1 = the invoice (100); no further productions", async () => {
    const chain = fixture.chain;
    const result = await withTenant(TENANT_M, () => genealogy.downstream(chain.breadBatchId));
    expect(result.productions).toEqual([]);
    expect(result.sales).toEqual([
      {
        level: 1,
        batchId: chain.breadBatchId,
        docType: "sales_invoice",
        docId: chain.saleInvoiceId,
        docDate: "2026-03-06",
        qty: "100.000000",
      },
    ]);
  });

  it("downstream(packaging) — level 1 = the bread order only (the golden packaging batch was consumed once)", async () => {
    const chain = fixture.chain;
    const result = await withTenant(TENANT_M, () => genealogy.downstream(chain.packagingBatchId));
    expect(result.productions).toHaveLength(1);
    expect(result.productions[0]!.orderId).toBe(chain.breadOrder.id);
    expect(result.productions[0]!.level).toBe(1);
    expect(result.productions[0]!.qty).toBe("234.375000");
    expect(result.sales).toEqual([
      {
        level: 2,
        batchId: chain.breadBatchId,
        docType: "sales_invoice",
        docId: chain.saleInvoiceId,
        docDate: "2026-03-06",
        qty: "100.000000",
      },
    ]);
  });
});

describe("PHASE-018 T39 genealogy — batch summaries", () => {
  it("batchSummary(bread) — producing order, on-hand 650, no consumers, 1 sale; batchSummary(dough) — on-hand 12.5, consumed by the bread order", async () => {
    const chain = fixture.chain;
    const bread = await withTenant(TENANT_M, () => genealogy.batchSummary(chain.breadBatchId));
    expect(bread.batch.batchId).toBe(chain.breadBatchId);
    expect(bread.batch.status).toBe("ACTIVE");
    expect(bread.producingOrderId).toBe(chain.breadOrder.id);
    expect(bread.producingOrderNo).toBe(chain.breadOrder.orderNo);
    expect(bread.onHand).toBe("650.000000"); // 750 produced − 100 sold
    expect(bread.consumedByOrders).toEqual([]);
    expect(bread.salesCount).toBe(1);
    expect(bread.inspectionsCount).toBe(0); // the chain ran with the gate OFF

    const dough = await withTenant(TENANT_M, () => genealogy.batchSummary(chain.doughBatchId));
    expect(dough.producingOrderId).toBe(chain.doughOrder.id);
    expect(dough.producingOrderNo).toBe(chain.doughOrder.orderNo);
    expect(dough.onHand).toBe("12.500000"); // 950 produced − 937.5 consumed
    expect(dough.consumedByOrders).toEqual([
      { orderId: chain.breadOrder.id, orderNo: chain.breadOrder.orderNo, qty: "937.500000" },
    ]);
    expect(dough.salesCount).toBe(0);
    expect(dough.inspectionsCount).toBe(0);
  });
});

describe("PHASE-018 T39 genealogy — A7 + the read-only guarantee", () => {
  it("unknown batch ids are the typed 404 on every entry point (upstream, downstream, batchSummary)", async () => {
    const unknown = "12345678-1234-1234-1234-123456789012";
    await expect(withTenant(TENANT_M, () => genealogy.upstream(unknown))).rejects.toMatchObject({
      code: "GENEALOGY_BATCH_NOT_FOUND",
    });
    await expect(withTenant(TENANT_M, () => genealogy.downstream(unknown))).rejects.toMatchObject({
      code: "GENEALOGY_BATCH_NOT_FOUND",
    });
    await expect(withTenant(TENANT_M, () => genealogy.batchSummary(unknown))).rejects.toMatchObject({
      code: "GENEALOGY_BATCH_NOT_FOUND",
    });
  });

  it("the walks mutate nothing — journal count, audit count, bread stock, and the chain batch statuses are unchanged after every read", async () => {
    const chain = fixture.chain;
    // Re-run every read surface once more, then re-assert the baseline.
    await withTenant(TENANT_M, async () => {
      await genealogy.upstream(chain.breadBatchId);
      await genealogy.downstream(chain.flourBatchId);
      await genealogy.batchSummary(chain.doughBatchId);
    });
    const breadStock = await withTenant(TENANT_M, () =>
      inventoryStore.findItemStock(fixture.items.bread, fixture.warehouseFg),
    );
    expect(breadStock?.qty ?? "0.000000").toBe(baseline.breadStock.qty);
    expect(breadStock?.avgCost ?? "0.000000").toBe(baseline.breadStock.avgCost);
    expect(await countRows(`SELECT count(*)::int AS n FROM journal_entries`)).toBe(baseline.journals);
    expect(await countRows(`SELECT count(*)::int AS n FROM audit_events`)).toBe(baseline.auditEvents);
    expect((await withTenant(TENANT_M, () => inventoryStore.findBatchById(chain.doughBatchId)))!.status).toBe(
      baseline.doughBatchStatus,
    );
    expect((await withTenant(TENANT_M, () => inventoryStore.findBatchById(chain.breadBatchId)))!.status).toBe(
      baseline.breadBatchStatus,
    );
    expect(
      await countRows(`SELECT count(*)::int AS n FROM audit_events WHERE action LIKE 'manufacturing.genealogy%'`),
    ).toBe(0);
  });
});
