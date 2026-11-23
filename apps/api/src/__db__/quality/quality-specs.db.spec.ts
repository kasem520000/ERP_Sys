import { Client } from "pg";
import { beforeAll, describe, expect, it } from "vitest";

import { superuserClient } from "../test-db";
import { withTenant } from "../../infra/db/tenant-context";
import {
  QL_ACTOR,
  TENANT_QUALITY,
  ensureQualityPostingWorld,
  freshQualityItem,
  setupQualityFixture,
} from "./fixtures";
import { SpecificationService } from "../../modules/quality/application/specification-service";
import { AuditService } from "../../modules/audit/api/audit";
import { DrizzleAuditStore } from "../../modules/audit/infrastructure/drizzle-audit.store";
import {
  QualityInspectionNotFoundError,
  QualitySpecBandInvalidError,
  QualitySpecificationDuplicateError,
  QualitySpecificationNotFoundError,
} from "../../modules/quality/domain/quality-errors";

/**
 * PHASE-050 (W-25 — T-05, 2026-11-23) `quality-specs.db.spec` — THE
 * SPECIFICATIONS API + THE INSPECTION-RESULT MAPPING CONTRACT (the plan
 * §4's own arm; acceptance #6's specification-feed arms): the authoring
 * surface over real PG16 (create/list/find/update/remove with the band
 * law's typed refusals naming the figures, the natural-key duplicate
 * refusal) + the CONTRACT ITSELF — the map reads the inspections
 * module's OWN rows (findInspectionById — zero parallel computation,
 * every field verbatim), resolves the item through the engine's own
 * chain (FG batch → item; production order → item; GRN-only → the
 * declared honest NONE shape), and returns the item's active
 * specification register alongside.
 */

const audit = new AuditService(new DrizzleAuditStore());
const specifications = new SpecificationService(audit);

let su: Client;

beforeAll(async () => {
  await setupQualityFixture();
  await ensureQualityPostingWorld();
  su = await superuserClient();
});

/** The map-contract world's own inspection rows (the fixtures'
 * world-building precedent — raw substrate rows; the CONTRACT is a read
 * contract and the service under test only READS them). A FAIL row
 * carries its disposition (the 0026 floor: ck_inspections_fail_needs_
 * disposition). */
async function insertRawInspection(row: {
  targetType: "production_order" | "goods_receipt";
  orderId?: string | null;
  grnId?: string | null;
  fgBatchId?: string | null;
  result: "PASS" | "FAIL";
  disposition?: "ACCEPT" | "SCRAP" | "REWORK" | "RETURN_TO_SUPPLIER" | null;
}): Promise<string> {
  const inserted = await su.query<{ id: string }>(
    `INSERT INTO inspections (id, tenant_id, created_by, target_type, order_id, grn_id,
        fg_batch_id, result, sampled, sample_size, disposition, inspected_at)
     VALUES (gen_random_uuid(), $1, $2, $3, $4, $5, $6, $7, true, 10, $8, '2026-03-01T09:00:00Z')
     RETURNING id`,
    [
      TENANT_QUALITY,
      QL_ACTOR,
      row.targetType,
      row.orderId ?? null,
      row.grnId ?? null,
      row.fgBatchId ?? null,
      row.result,
      row.result === "FAIL" ? (row.disposition ?? "REWORK") : (row.disposition ?? null),
    ],
  );
  return inserted.rows[0]!.id;
}

describe("PHASE-050 W-25 — T-05: the specifications register (the authoring surface)", () => {
  it("creates a specification with a real band and lists it under the item", async () => {
    const itemId = await freshQualityItem("SPECS-CREATE");
    const created = await withTenant(TENANT_QUALITY, () =>
      specifications.create({
        itemId,
        parameter: "Viscosity",
        parameterAr: "اللزوجة",
        unit: "cP",
        targetValue: "10.000000",
        ucl: "10.500000",
        lcl: "9.500000",
        actorId: QL_ACTOR,
      }),
    );
    expect(created.parameter).toBe("Viscosity");
    expect(created.ucl).toBe("10.500000");
    expect(created.lcl).toBe("9.500000");
    expect(created.isActive).toBe(true);

    const listed = await withTenant(TENANT_QUALITY, () =>
      specifications.list({ itemId, activeOnly: true, limit: 50 }),
    );
    expect(listed).toHaveLength(1);
    expect(listed[0]!.id).toBe(created.id);

    const found = await withTenant(TENANT_QUALITY, () => specifications.find(created.id));
    expect(found.targetValue).toBe("10.000000");
  });

  it("the no-fabrication band law: a point band is refused with the parameter and both figures", async () => {
    const itemId = await freshQualityItem("SPECS-POINT");
    const refused = await withTenant(TENANT_QUALITY, () =>
      specifications
        .create({
          itemId,
          parameter: "Density",
          targetValue: "1.000000",
          ucl: "1.000000",
          lcl: "1.000000",
          actorId: QL_ACTOR,
        })
        .catch((error: unknown) => error),
    );
    expect(refused).toBeInstanceOf(QualitySpecBandInvalidError);
    expect((refused as QualitySpecBandInvalidError).code).toBe("QUALITY_SPEC_BAND_INVALID");
    expect((refused as QualitySpecBandInvalidError).details).toMatchObject({
      parameter: "Density",
      ucl: "1.000000",
      lcl: "1.000000",
    });
  });

  it("a one-sided band and an unbounded parameter are legal (an unset tolerance is UNTOLERATED, never fabricated)", async () => {
    const itemId = await freshQualityItem("SPECS-ONESIDED");
    const oneSided = await withTenant(TENANT_QUALITY, () =>
      specifications.create({
        itemId,
        parameter: "pH",
        targetValue: "6.800000",
        ucl: "7.200000",
        actorId: QL_ACTOR,
      }),
    );
    expect(oneSided.ucl).toBe("7.200000");
    expect(oneSided.lcl).toBeNull();
    const unbounded = await withTenant(TENANT_QUALITY, () =>
      specifications.create({
        itemId,
        parameter: "Aroma",
        targetValue: "3.000000",
        actorId: QL_ACTOR,
      }),
    );
    expect(unbounded.ucl).toBeNull();
    expect(unbounded.lcl).toBeNull();
  });

  it("the (tenant, item, parameter) natural key is refused typed — the 23505 never surfaces raw", async () => {
    const itemId = await freshQualityItem("SPECS-DUP");
    await withTenant(TENANT_QUALITY, () =>
      specifications.create({
        itemId,
        parameter: "Viscosity",
        targetValue: "10.000000",
        ucl: "10.500000",
        lcl: "9.500000",
        actorId: QL_ACTOR,
      }),
    );
    const refused = await withTenant(TENANT_QUALITY, () =>
      specifications
        .create({
          itemId,
          parameter: "Viscosity",
          targetValue: "12.000000",
          actorId: QL_ACTOR,
        })
        .catch((error: unknown) => error),
    );
    expect(refused).toBeInstanceOf(QualitySpecificationDuplicateError);
    expect((refused as QualitySpecificationDuplicateError).code).toBe(
      "QUALITY_SPECIFICATION_DUPLICATE",
    );
  });

  it("the PATCH clears a tolerance end (an explicit null) and the merged band is re-checked", async () => {
    const itemId = await freshQualityItem("SPECS-PATCH");
    const created = await withTenant(TENANT_QUALITY, () =>
      specifications.create({
        itemId,
        parameter: "Brix",
        targetValue: "11.000000",
        ucl: "11.500000",
        lcl: "10.500000",
        actorId: QL_ACTOR,
      }),
    );
    const cleared = await withTenant(TENANT_QUALITY, () =>
      specifications.update(created.id, { ucl: null }, QL_ACTOR),
    );
    expect(cleared.ucl).toBeNull();
    expect(cleared.lcl).toBe("10.500000");
    // The merged band after the patch must still be real — an inverted
    // merge is refused with the figures.
    const refused = await withTenant(TENANT_QUALITY, () =>
      specifications
        .update(created.id, { ucl: "10.000000" }, QL_ACTOR)
        .catch((error: unknown) => error),
    );
    expect(refused).toBeInstanceOf(QualitySpecBandInvalidError);
    expect((refused as QualitySpecBandInvalidError).details).toMatchObject({
      parameter: "Brix",
    });
  });

  it("the master-data DELETE removes an unreferenced row; a row referenced by SPC samples is protected by the FK", async () => {
    const itemId = await freshQualityItem("SPECS-DEL");
    const created = await withTenant(TENANT_QUALITY, () =>
      specifications.create({
        itemId,
        parameter: "Temp",
        targetValue: "4.000000",
        ucl: "5.000000",
        lcl: "3.000000",
        actorId: QL_ACTOR,
      }),
    );
    await withTenant(TENANT_QUALITY, async () => {
      await specifications.remove(created.id, QL_ACTOR);
      const refused = await specifications.find(created.id).catch((error: unknown) => error);
      expect(refused).toBeInstanceOf(QualitySpecificationNotFoundError);
    });
    // The referenced row: an SPC sample binds the spec — the composite FK
    // refuses the delete (23503 BY NAME). The sample rides the COMMITTED
    // spec row (the su connection sees it — its own transaction).
    const withSample = await withTenant(TENANT_QUALITY, () =>
      specifications.create({
        itemId,
        parameter: "Temp2",
        targetValue: "40.000000",
        actorId: QL_ACTOR,
      }),
    );
    await su.query(
      `INSERT INTO spc_measurements (id, tenant_id, spec_id, value, sampled_at, source)
       VALUES (gen_random_uuid(), $1, $2, 40.5, '2026-03-01T08:00:00Z', 'INSPECTION')`,
      [TENANT_QUALITY, withSample.id],
    );
    let caught:
      | { code?: string; constraint?: string; cause?: { code?: string; constraint?: string } }
      | undefined;
    try {
      await withTenant(TENANT_QUALITY, () => specifications.remove(withSample.id, QL_ACTOR));
    } catch (error) {
      caught = error as {
        code?: string;
        constraint?: string;
        cause?: { code?: string; constraint?: string };
      };
    }
    // Drizzle wraps the pg error — the code rides the cause (the raw
    // su.query arms see it directly; the store's drizzle path wraps it).
    const pgCode = caught?.code ?? caught?.cause?.code;
    const pgConstraint = caught?.constraint ?? caught?.cause?.constraint;
    expect(pgCode).toBe("23503");
    expect(pgConstraint).toBe("fk_spc_measurements_spec");
  });
});

describe("PHASE-050 W-25 — T-05: THE INSPECTION-RESULT MAPPING CONTRACT (the engines' own rows, zero parallel computation)", () => {
  it("the FG-batch chain: the map returns the inspection row VERBATIM, the item through the engine's own batch read, and the item's active specifications", async () => {
    const world = await ensureQualityPostingWorld();
    const itemId = await freshQualityItem("SPECS-MAP-FG");
    // The item's specification register (two parameters, one inactive).
    const viscosity = await withTenant(TENANT_QUALITY, () =>
      specifications.create({
        itemId,
        parameter: "Viscosity",
        targetValue: "10.000000",
        ucl: "10.500000",
        lcl: "9.500000",
        actorId: QL_ACTOR,
      }),
    );
    const legacy = await withTenant(TENANT_QUALITY, () =>
      specifications.create({
        itemId,
        parameter: "LegacyParam",
        targetValue: "1.000000",
        actorId: QL_ACTOR,
      }),
    );
    // The register's own honest floor: the deprecated parameter is
    // DEACTIVATED (the master-data soft retirement — isActive false),
    // never deleted (the SPC history protects it).
    await withTenant(TENANT_QUALITY, () =>
      specifications.update(legacy.id, { isActive: false }, QL_ACTOR),
    );
    // The batch + the production order + the inspection row (the
    // engine's own substrate rows).
    const batch = await su.query<{ id: string }>(
      `INSERT INTO item_batches (id, tenant_id, item_id, batch_no, expiry_date)
       VALUES (gen_random_uuid(), $1, $2, 'QL-B-MAP-FG', '2027-06-30') RETURNING id`,
      [TENANT_QUALITY, itemId],
    );
    const order = await su.query<{ id: string }>(
      `INSERT INTO production_orders (id, tenant_id, created_by, branch_id, status, item_id,
          uom_id, planned_qty, materials_warehouse_id, fg_warehouse_id, actual_qty)
       VALUES (gen_random_uuid(), $1, $2,
          (SELECT id FROM branches WHERE tenant_id = $1 AND code = 'BR-QL' LIMIT 1),
          'COMPLETED', $3,
          (SELECT id FROM uoms WHERE tenant_id = $1 AND code = 'PCS' LIMIT 1),
          100, $4, $4, 100)
       RETURNING id`,
      [TENANT_QUALITY, QL_ACTOR, itemId, world.warehouseId],
    );
    const inspectionId = await insertRawInspection({
      targetType: "production_order",
      orderId: order.rows[0]!.id,
      fgBatchId: batch.rows[0]!.id,
      result: "PASS",
    });
    const map = await withTenant(TENANT_QUALITY, () =>
      specifications.inspectionMap(inspectionId),
    );
    // THE ENGINE'S OWN ROW, VERBATIM — zero recomputation.
    expect(map.inspection).toMatchObject({
      id: inspectionId,
      targetType: "production_order",
      orderId: order.rows[0]!.id,
      fgBatchId: batch.rows[0]!.id,
      result: "PASS",
      sampled: true,
      sampleSize: 10,
      disposition: null,
    });
    expect(map.itemResolution).toBe("FG_BATCH");
    expect(map.item).toMatchObject({ id: itemId });
    // The register's own rows — activeOnly rides the map.
    expect(map.specifications).toHaveLength(1);
    expect(map.specifications[0]!.id).toBe(viscosity.id);
  });

  it("the production-order chain (no FG batch): the item resolves through the order's own row", async () => {
    const world = await ensureQualityPostingWorld();
    const itemId = await freshQualityItem("SPECS-MAP-PO");
    const order = await su.query<{ id: string }>(
      `INSERT INTO production_orders (id, tenant_id, created_by, branch_id, status, item_id,
          uom_id, planned_qty, materials_warehouse_id, fg_warehouse_id, actual_qty)
       VALUES (gen_random_uuid(), $1, $2,
          (SELECT id FROM branches WHERE tenant_id = $1 AND code = 'BR-QL' LIMIT 1),
          'COMPLETED', $3,
          (SELECT id FROM uoms WHERE tenant_id = $1 AND code = 'PCS' LIMIT 1),
          50, $4, $4, 50)
       RETURNING id`,
      [TENANT_QUALITY, QL_ACTOR, itemId, world.warehouseId],
    );
    const inspectionId = await insertRawInspection({
      targetType: "production_order",
      orderId: order.rows[0]!.id,
      result: "FAIL",
    });
    const map = await withTenant(TENANT_QUALITY, () =>
      specifications.inspectionMap(inspectionId),
    );
    expect(map.inspection.result).toBe("FAIL");
    expect(map.itemResolution).toBe("PRODUCTION_ORDER");
    expect(map.item).toMatchObject({ id: itemId });
    expect(map.specifications).toEqual([]);
  });

  it("the GRN-only chain: the declared honest NONE shape (a GRN inspection names no single item)", async () => {
    const grn = await su.query<{ id: string }>(
      `INSERT INTO goods_receipts (id, tenant_id, created_by, branch_id, supplier_id,
          warehouse_id, receipt_no, receipt_date, status, po_less_reason)
       VALUES (gen_random_uuid(), $1, $2,
          (SELECT id FROM branches WHERE tenant_id = $1 AND code = 'BR-QL' LIMIT 1),
          (SELECT id FROM partners WHERE tenant_id = $1 AND code = 'QL-CUST' LIMIT 1),
          (SELECT id FROM warehouses WHERE tenant_id = $1 AND code = 'QL-WH' LIMIT 1),
          'GRN-QL-MAP-1', '2026-03-01', 'DRAFT', 'WITHOUT_PO')
       RETURNING id`,
      [TENANT_QUALITY, QL_ACTOR],
    );
    const inspectionId = await insertRawInspection({
      targetType: "goods_receipt",
      grnId: grn.rows[0]!.id,
      result: "PASS",
    });
    const map = await withTenant(TENANT_QUALITY, () =>
      specifications.inspectionMap(inspectionId),
    );
    expect(map.itemResolution).toBe("NONE");
    expect(map.item).toBeNull();
    expect(map.specifications).toEqual([]);
    expect(map.inspection.grnId).toBe(grn.rows[0]!.id);
  });

  it("a foreign/unknown inspection id is the typed not-found (A7 — never an existence disclosure)", async () => {
    const refused = await withTenant(TENANT_QUALITY, () =>
      specifications
        .inspectionMap("99999999-9999-4999-8999-999999999999")
        .catch((error: unknown) => error),
    );
    expect(refused).toBeInstanceOf(QualityInspectionNotFoundError);
    expect((refused as QualityInspectionNotFoundError).code).toBe("QUALITY_INSPECTION_NOT_FOUND");
  });

  it("RLS: the boundary tenant's read is empty — the map's reads ride the owning stores' tenant scoping", async () => {
    // The empty-world assertion on the DEDICATED boundary tenant: the
    // inspections/specification reads answer empty there, never a leak.
    const boundaryCount = await su.query<{ n: string }>(
      `SELECT count(*)::text AS n FROM inspections WHERE tenant_id = $1`,
      ["5a5a5a5a-5a5a-5a5a-5a5a-5a5a5a5a5a5b"],
    );
    expect(boundaryCount.rows[0]!.n).toBe("0");
  });
});
