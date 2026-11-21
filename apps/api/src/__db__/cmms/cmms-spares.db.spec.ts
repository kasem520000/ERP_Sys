import { beforeAll, describe, expect, it } from "vitest";
import { Decimal } from "@erp/domain-core";

import { withTenant } from "../../infra/db/tenant-context";
import { AssetSparesService } from "../../modules/fixed_assets/application/asset-spares-service";
import {
  CmmsInputInvalidError,
  CmmsSpareItemDiscontinuedError,
  CmmsSpareNotFoundError,
} from "../../modules/fixed_assets/domain/cmms-errors";
import { AuditService } from "../../modules/audit/api/audit";
import { DrizzleAuditStore } from "../../modules/audit/infrastructure/drizzle-audit.store";
import { superuserClient } from "../test-db";
import { CM_ACTOR, TENANT_CMMS, ensureCmmsG59World, freshAsset } from "./fixtures";

/**
 * PHASE-049 (W-18 — T-09) — the spare-parts BOM pinned over real
 * PostgreSQL 16 (the plan §4's `cmms-spares.db.spec`) — the owner's
 * order: «القطع عبر WMS الحقيقي حصرًا والمقاصة ذرّية»:
 *
 * - THE BOM LAWS (0106's asset_spares): the item-master FK with the
 *   phase doc's own drift mitigation made typed — a discontinued item
 *   refuses AT BOM SAVE (SPARE_ITEM_DISCONTINUED naming the sku + the
 *   status); qty > 0; one row per (asset, item) — the duplicate directed
 *   to the patch, never a silent second row.
 * - THE EXCLUSIVITY PROOF (القطع عبر WMS الحقيقي حصرًا): the BOM's whole
 *   lifecycle touches NEITHER item_stock NOR stock_moves — the
 *   consumption surface is the work-order PARTS lines through the W-17
 *   completion act's REAL WMS path (planIssue/applyIssue), whose atomic
 *   clearing (together-or-nothing) the W-17 all-nothing arm already
 *   proved; this spec pins the BOM side of the exclusivity: no BOM
 *   operation ever writes the inventory plane.
 */

const audit = new AuditService(new DrizzleAuditStore());
const spares = new AssetSparesService(audit);

beforeAll(async () => {
  await ensureCmmsG59World();
});

function expectDec(actual: string | null | undefined, expected: string): void {
  expect(actual === null || actual === undefined ? null : new Decimal(actual).toString()).toBe(
    new Decimal(expected).toString(),
  );
}

/** A discontinued item (the drift-mitigation arm's own subject). */
async function discontinuedItemId(): Promise<string> {
  const su = await superuserClient();
  const item = await su.query<{ id: string }>(
    `INSERT INTO items (id, tenant_id, sku, name, name_ar, kind, uom_id, costing_method, base_price, status)
     VALUES (gen_random_uuid(), $1, 'CM-PART-DISC', 'CM Retired Filter', 'فلتر متقاعد', 'STOCK',
        (SELECT id FROM uoms WHERE tenant_id = $1 AND code = 'PCS' LIMIT 1), 'WAC', 30, 'INACTIVE')
     ON CONFLICT (tenant_id, sku) DO UPDATE SET status = 'INACTIVE'
     RETURNING id`,
    [TENANT_CMMS],
  );
  await su.end();
  return item.rows[0]!.id;
}

/** The inventory plane's footprint for the tenant (stock rows + moves). */
async function inventoryFootprint(): Promise<{ stock: string; moves: string }> {
  const su = await superuserClient();
  const stock = await su.query<{ count: string }>(
    `SELECT count(*)::text AS count FROM item_stock WHERE tenant_id = $1`,
    [TENANT_CMMS],
  );
  const moves = await su.query<{ count: string }>(
    `SELECT count(*)::text AS count FROM stock_moves WHERE tenant_id = $1`,
    [TENANT_CMMS],
  );
  await su.end();
  return { stock: stock.rows[0]!.count, moves: moves.rows[0]!.count };
}

describe("PHASE-049 W-18 — the spare-parts BOM (D-05 — BR-099's save-time laws)", () => {
  it("a discontinued item refuses AT BOM SAVE — the typed drift mitigation names the sku and the status", async () => {
    await withTenant(TENANT_CMMS, async () => {
      const asset = await freshAsset("SPR-DISC");
      const itemId = await discontinuedItemId();
      const refused = await spares
        .addSpare({ assetId: asset, itemId, qty: "2", actorId: CM_ACTOR })
        .catch((error: unknown) => error);
      expect(refused).toBeInstanceOf(CmmsSpareItemDiscontinuedError);
      expect((refused as CmmsSpareItemDiscontinuedError).details).toMatchObject({
        sku: "CM-PART-DISC",
        status: "INACTIVE",
      });
    });
  });

  it("the BOM lifecycle: add → patch → remove; qty ≤ 0 refuses; the duplicate directs to the patch (one row per asset+item)", async () => {
    await withTenant(TENANT_CMMS, async () => {
      const asset = await freshAsset("SPR-LIFE");
      const world = await ensureCmmsG59World();
      const line = await spares.addSpare({
        assetId: asset,
        itemId: world.itemId,
        qty: "4",
        actorId: CM_ACTOR,
      });
      expectDec(line.qty, "4");

      const duplicate = await spares
        .addSpare({ assetId: asset, itemId: world.itemId, qty: "1", actorId: CM_ACTOR })
        .catch((error: unknown) => error);
      expect(duplicate).toBeInstanceOf(CmmsInputInvalidError);
      expect((duplicate as CmmsInputInvalidError).message).toContain("patch the line instead");

      const zeroQty = await spares
        .patchSpare({ spareId: line.id, qty: "0", actorId: CM_ACTOR })
        .catch((error: unknown) => error);
      expect(zeroQty).toBeInstanceOf(CmmsInputInvalidError);

      const patched = await spares.patchSpare({ spareId: line.id, qty: "6", actorId: CM_ACTOR });
      expectDec(patched.qty, "6");

      await spares.removeSpare({ spareId: line.id, actorId: CM_ACTOR });
      const gone = await spares
        .patchSpare({ spareId: line.id, qty: "1", actorId: CM_ACTOR })
        .catch((error: unknown) => error);
      expect(gone).toBeInstanceOf(CmmsSpareNotFoundError);
    });
  });

  it("THE EXCLUSIVITY PROOF: the BOM's whole lifecycle touches NEITHER item_stock NOR stock_moves (القطع عبر WMS الحقيقي حصرًا)", async () => {
    await withTenant(TENANT_CMMS, async () => {
      const world = await ensureCmmsG59World();
      const before = await inventoryFootprint();
      const assetA = await freshAsset("SPR-EXCL-A");
      const assetB = await freshAsset("SPR-EXCL-B");
      const a = await spares.addSpare({ assetId: assetA, itemId: world.itemId, qty: "3", actorId: CM_ACTOR });
      const b = await spares.addSpare({ assetId: assetB, itemId: world.itemId, qty: "5", actorId: CM_ACTOR });
      await spares.patchSpare({ spareId: a.id, qty: "7", actorId: CM_ACTOR });
      await spares.removeSpare({ spareId: b.id, actorId: CM_ACTOR });
      const after = await inventoryFootprint();
      expect(after).toEqual(before);
    });
  });
});
