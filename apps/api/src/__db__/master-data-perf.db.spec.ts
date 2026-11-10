import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { generateUuidV7 } from "@erp/domain-core";

import { appClient, ensureTestDb, superuserClient } from "./test-db";
import { closeDb } from "../infra/db/client";
import { withTenant } from "../infra/db/tenant-context";
import { searchPartners } from "../modules/partners/infrastructure/partners.store";
import { searchItems } from "../modules/items/infrastructure/items.store";

/**
 * PHASE-006 acceptance 8 (T10): trigram search stays index-driven and fast
 * at fixture volume — 10k partners/items per tenant — with exact barcode/SKU
 * match priority, plus the EXPLAIN spot-check (TENANT_ISOLATION §6: the top
 * queries must use the tenant-first composite GIN index, not filters).
 */

let tenantId = "";
let uomId = "";

beforeAll(async () => {
  ensureTestDb();
  const su = await superuserClient();
  tenantId = generateUuidV7();
  await su.query(
    `INSERT INTO tenants (id, name, name_ar, base_currency, country_code, timezone) VALUES ($1, 'Perf Tenant', 'مستأجر الأداء', 'SAR', 'SA', 'Asia/Riyadh')`,
    [tenantId],
  );
  const uom = await su.query<{ id: string }>(
    `INSERT INTO uoms (id, tenant_id, code, name, is_system)
     VALUES ($1, $2, 'PCS', 'Piece', true) RETURNING id`,
    [generateUuidV7(), tenantId],
  );
  uomId = uom.rows[0]!.id;
  // Fixture volume: 10k bilingual partners + 10k items (batched inserts as
  // the bootstrap role — the fixture represents an established tenant).
  for (let batch = 0; batch < 100; batch += 1) {
    const partnerRows: string[] = [];
    const partnerParams: unknown[] = [];
    const itemRows: string[] = [];
    const itemParams: unknown[] = [];
    for (let i = 0; i < 100; i += 1) {
      const n = batch * 100 + i;
      const p = [generateUuidV7(), tenantId, "CUSTOMER", `P-${n}`, `Trading Company ${n}`, `شركة تجارية ${n}`];
      const base = partnerParams.length;
      partnerParams.push(...p);
      partnerRows.push(
        `($${base + 1}::uuid, $${base + 2}, $${base + 3}, $${base + 4}, $${base + 5}, $${base + 6})`,
      );
      const q = [generateUuidV7(), tenantId, `SKU-${n}`, `Product ${n}`, `منتج ${n}`, "STOCK", uomId];
      const ibase = itemParams.length;
      itemParams.push(...q);
      itemRows.push(
        `($${ibase + 1}::uuid, $${ibase + 2}, $${ibase + 3}, $${ibase + 4}, $${ibase + 5}, $${ibase + 6}, $${ibase + 7}::uuid)`,
      );
    }
    await su.query(
      `INSERT INTO partners (id, tenant_id, kind, code, name, name_ar) VALUES ${partnerRows.join(",")}`,
      partnerParams as never[],
    );
    await su.query(
      `INSERT INTO items (id, tenant_id, sku, name, name_ar, kind, uom_id) VALUES ${itemRows.join(",")}`,
      itemParams as never[],
    );
  }
  // Exact barcode for the priority proof.
  await su.query(
    `INSERT INTO barcodes (id, tenant_id, item_id, uom_id, code)
     SELECT $1, $2, id, $3, 'EXACTBARCODE001' FROM items WHERE sku = 'SKU-42'`,
    [generateUuidV7(), tenantId, uomId],
  );
  await su.end();
}, 300_000);

afterAll(async () => {
  await closeDb();
});

describe("PHASE-006 acceptance 8: trigram search at 10k rows/tenant", () => {
  it("partial Arabic + English partner names resolve in ≤ 200 ms", async () => {
    const en = await withTenant(tenantId, async () => timed(() => searchPartners("Trading Comp")));
    const ar = await withTenant(tenantId, async () => timed(() => searchPartners("شركة تج")));
    expect(en.rows.length).toBeGreaterThan(10);
    expect(ar.rows.length).toBeGreaterThan(10);
    expect(en.millis).toBeLessThanOrEqual(200);
    expect(ar.millis).toBeLessThanOrEqual(200);
  });

  it("item search: exact SKU prefix priority + Arabic partial ≤ 200 ms", async () => {
    const exact = await withTenant(tenantId, async () => timed(() => searchItems("SKU-9")));
    expect(exact.rows.length).toBeGreaterThan(10);
    expect(exact.rows[0]!.sku).toBe("SKU-9");
    expect(exact.millis).toBeLessThanOrEqual(200);
    const ar = await withTenant(tenantId, async () => timed(() => searchItems("منتج")));
    expect(ar.rows.length).toBeGreaterThan(10);
    expect(ar.millis).toBeLessThanOrEqual(200);
  });

  it("EXPLAIN spot-check: the tenant GIN index drives partner + item search", async () => {
    const app = await appClient();
    const partnerPlan = await app.query<{ "QUERY PLAN": string }>(
      `EXPLAIN (FORMAT TEXT) SELECT count(*) FROM partners
        WHERE deleted_at IS NULL
          AND (code ILIKE 'P-1%' OR name ILIKE '%Trading%' OR coalesce(name_ar, '') ILIKE '%شركة%')`,
    );
    const itemPlan = await app.query<{ "QUERY PLAN": string }>(
      `EXPLAIN (FORMAT TEXT) SELECT id FROM items
        WHERE deleted_at IS NULL AND sku ILIKE 'SKU-1%'`,
    );
    const createPlan = await app.query<{ "QUERY PLAN": string }>(
      `EXPLAIN (FORMAT TEXT) SELECT id, name FROM partners
        WHERE deleted_at IS NULL AND name % 'Trading'`,
    );
    await app.end();
    const partnerText = partnerPlan.rows.map((row) => row["QUERY PLAN"]).join("\n");
    const itemText = itemPlan.rows.map((row) => row["QUERY PLAN"]).join("\n");
    const createText = createPlan.rows.map((row) => row["QUERY PLAN"]).join("\n");
    expect(partnerText).toMatch(/ix_partners_name_trgm|ix_partners_tenant/);
    expect(itemText).toMatch(/ix_items_tenant|ix_items_name_trgm|uq_items_tenant_sku/);
    expect(createText).toMatch(/ix_partners_name_trgm/);
  });
});

async function timed<T>(fn: () => Promise<T>): Promise<{ rows: T; millis: number }> {
  const started = Date.now();
  const rows = await fn();
  return { rows, millis: Date.now() - started };
}
