import { sql } from "drizzle-orm";
import { beforeAll, describe, expect, it } from "vitest";

import type { Client } from "pg";

import { requireTenantContext, withTenant } from "../../infra/db/tenant-context";
import {
  QL_ACTOR,
  TENANT_QUALITY,
  TENANT_QUALITY_RLS,
  ensureQualityPostingWorld,
  freshQualityBatch,
  freshQualityItem,
  freshQualitySupplier,
  seedSupplierDelivery,
  setupQualityFixture,
} from "./fixtures";
import { superuserClient } from "../test-db";
import { CoaService } from "../../modules/quality/application/coa-service";
import { NcrService } from "../../modules/quality/application/ncr-service";
import { SpecificationService } from "../../modules/quality/application/specification-service";
import { AuditService } from "../../modules/audit/api/audit";
import { DrizzleAuditStore } from "../../modules/audit/infrastructure/drizzle-audit.store";
import { NumberingService } from "../../modules/accounting/application/numbering-service";
import { PostingService } from "../../modules/accounting/application/posting-service";
import { PartnerSubledgerService } from "../../modules/partners/application/subledger-service";
import { insertInspection } from "../../modules/manufacturing/infrastructure/manufacturing.store";
import {
  CoaBatchItemMismatchError,
  CoaDeviationNcrInvalidError,
  CoaGateBlockedError,
  CoaInspectionItemMismatchError,
  CoaNoSpecificationsError,
} from "../../modules/quality/domain/quality-errors";

/**
 * PHASE-050 (W-27 — T-11, 2026-11-23) `quality-coa.db.spec` — THE COA
 * GENERATION SERVICE over real PG16 (the plan §4's own arm; acceptance
 * #4's service half): BR-104's three shapes (WITHIN/UNBANDED pass ·
 * OUTSIDE blocked naming the parameter and BOTH figures · OUTSIDE with
 * an accepted-deviation NCR passes with the provenance), the coverage
 * law (missing/foreign/duplicate), the provenance floors (the batch-item
 * coherence · the inspection chain incl. the GRN per-line resolution),
 * THE FROZEN SNAPSHOT (a later spec PATCH never moves a stored
 * certificate), the official COA-{YYYY}-{SEQ:6} numbering, and the RLS
 * boundary. The bilingual print is W-29's; the golden transcript is
 * W-31's.
 */

const audit = new AuditService(new DrizzleAuditStore());
const posting = new PostingService(audit, new PartnerSubledgerService());
const numbering = new NumberingService(audit);
const specifications = new SpecificationService(audit);
const ncr = new NcrService(audit, posting, numbering);
const coa = new CoaService(audit, numbering);

beforeAll(async () => {
  await setupQualityFixture();
});

/** A fresh item with the standard three-parameter register (viscosity
 * banded · pH banded · color unbanded) — the per-arm world. */
async function specWorld(code: string): Promise<{
  itemId: string;
  viscosityId: string;
  phId: string;
  colorId: string;
}> {
  const itemId = await freshQualityItem(`COA-${code}`);
  const viscosity = await withTenant(TENANT_QUALITY, () =>
    specifications.create({
      itemId,
      parameter: "Viscosity",
      parameterAr: "اللزوجة",
      unit: "cP",
      targetValue: "100.000000",
      ucl: "110.000000",
      lcl: "90.000000",
      actorId: QL_ACTOR,
    }),
  );
  const ph = await withTenant(TENANT_QUALITY, () =>
    specifications.create({
      itemId,
      parameter: "pH",
      parameterAr: "الحموضة",
      targetValue: "7.000000",
      ucl: "7.500000",
      lcl: "6.500000",
      actorId: QL_ACTOR,
    }),
  );
  const color = await withTenant(TENANT_QUALITY, () =>
    specifications.create({
      itemId,
      parameter: "Color (visual)",
      parameterAr: "اللون",
      targetValue: "0.000000",
      ucl: null,
      lcl: null,
      actorId: QL_ACTOR,
    }),
  );
  return { itemId, viscosityId: viscosity.id, phId: ph.id, colorId: color.id };
}

/** A raw production-order row for the OTHER item (the provenance arm's
 * target — the manufacturing table's own minimal shape, the fixture
 * substrate law: engines own the reads, the seed is raw). */
async function rawProductionOrder(itemId: string, code: string): Promise<string> {
  const postingWorld = await ensureQualityPostingWorld();
  const su: Client = await superuserClient();
  const order = await su.query<{ id: string }>(
    `INSERT INTO production_orders (id, tenant_id, branch_id, item_id, uom_id,
        planned_qty, materials_warehouse_id, fg_warehouse_id, order_no)
     VALUES (gen_random_uuid(), $1,
        (SELECT id FROM branches WHERE tenant_id = $1 AND code = 'BR-QL' LIMIT 1),
        $2, (SELECT uom_id FROM items WHERE id = $2), 10, $3, $4, $5)
     RETURNING id`,
    [TENANT_QUALITY, itemId, postingWorld.warehouseId, postingWorld.warehouseId, `QL-MO-${code}`],
  );
  await su.end();
  return order.rows[0]!.id;
}

describe("PHASE-050 W-27 — the COA generation gate (BR-104) over real PG16", () => {
  it("SHAPE 1 — all within (and the unbanded parameter recorded, never judged): the certificate generates with the frozen snapshot verbatim", async () => {
    const world = await specWorld("PASS");
    const row = await withTenant(TENANT_QUALITY, () =>
      coa.generate({
        docType: "COA",
        itemId: world.itemId,
        parameters: [
          { specId: world.viscosityId, value: "100.500000" },
          { specId: world.phId, value: "7.200000" },
          { specId: world.colorId, value: "0.000000" },
        ],
        actorId: QL_ACTOR,
      }),
    );
    const year = new Date().getUTCFullYear();
    expect(row.docNo).toMatch(new RegExp(`^COA-${year}-[0-9]{6}$`));
    expect(row.docType).toBe("COA");
    expect(row.issuedBy).toBe(QL_ACTOR);
    expect(row.parameters).toHaveLength(3);
    const [viscosity, ph, color] = row.parameters as unknown as ({
      parameter: string;
      value: string;
      toleranceVerdict: string;
      gate: string;
      ncrId: string | null;
      ucl: string | null;
      lcl: string | null;
      targetValue: string;
      parameterAr: string | null;
    } | undefined)[];
    expect(viscosity!).toMatchObject({
      parameter: "Viscosity",
      parameterAr: "اللزوجة",
      value: "100.500000",
      targetValue: "100.000000",
      ucl: "110.000000",
      lcl: "90.000000",
      toleranceVerdict: "WITHIN",
      gate: "PASS",
      ncrId: null,
    });
    expect(ph!.toleranceVerdict).toBe("WITHIN");
    // THE UNBANDED LAW: recorded, never judged (no fabricated limit).
    expect(color!.toleranceVerdict).toBe("UNBANDED");
    expect(color!.gate).toBe("PASS_UNBANDED");
    expect(color!.ucl).toBeNull();
    expect(color!.lcl).toBeNull();
  });

  it("SHAPE 2 — a parameter outside without a reference: BR-104's typed refusal names the parameter and BOTH figures", async () => {
    const world = await specWorld("OUTSIDE");
    await expect(
      withTenant(TENANT_QUALITY, () =>
        coa.generate({
          docType: "COA",
          itemId: world.itemId,
          parameters: [
            { specId: world.viscosityId, value: "118.000000" },
            { specId: world.phId, value: "7.100000" },
            { specId: world.colorId, value: "0.000000" },
          ],
          actorId: QL_ACTOR,
        }),
      ),
    ).rejects.toBeInstanceOf(CoaGateBlockedError);
    await expect(
      withTenant(TENANT_QUALITY, () =>
        coa.generate({
          docType: "COA",
          itemId: world.itemId,
          parameters: [
            { specId: world.viscosityId, value: "118.000000" },
            { specId: world.phId, value: "7.100000" },
            { specId: world.colorId, value: "0.000000" },
          ],
          actorId: QL_ACTOR,
        }),
      ),
    ).rejects.toMatchObject({
      code: "COA_GATE_BLOCKED",
      details: {
        firstFailure: {
          parameter: "Viscosity",
          value: "118.000000",
          breachedLimit: "110.000000",
        },
      },
    });
    // The zero-residue law: no certificate row (the refusal rolled the
    // whole act back — the number reserve included, the ambient UoW).
    const residue = await withTenant(TENANT_QUALITY, async () =>
      requireTenantContext().tx!.execute<{ n: number }>(sql`
        SELECT count(*)::int AS n FROM coa_documents WHERE item_id = ${world.itemId}`),
    );
    expect(residue.rows[0]!.n).toBe(0);
  });

  it("SHAPE 3 — a parameter outside WITH an accepted-deviation NCR: passes with the provenance on the frozen entry", async () => {
    const world = await specWorld("DEVIATION");
    // The NCR on this item, dispositioned ACCEPT (the accepted deviation).
    const created = await withTenant(TENANT_QUALITY, () =>
      ncr.create({
        source: "PRODUCTION",
        severity: "MEDIUM",
        itemId: world.itemId,
        problem: "Viscosity slightly above band — engineering accepted the deviation",
        affectedQty: "1",
        actorId: QL_ACTOR,
      }),
    );
    await withTenant(TENANT_QUALITY, () =>
      ncr.disposition(created.id, { disposition: "ACCEPT", actorId: QL_ACTOR }),
    );
    const row = await withTenant(TENANT_QUALITY, () =>
      coa.generate({
        docType: "COA",
        itemId: world.itemId,
        parameters: [
          { specId: world.viscosityId, value: "112.000000", ncrId: created.id },
          { specId: world.phId, value: "7.000000" },
          { specId: world.colorId, value: "0.000000" },
        ],
        actorId: QL_ACTOR,
      }),
    );
    const [viscosity] = row.parameters as unknown as ({
      gate: string;
      ncrId: string | null;
      toleranceVerdict: string;
    } | undefined)[];
    expect(viscosity!.gate).toBe("PASS_DEVIATION_ACCEPTED");
    expect(viscosity!.ncrId).toBe(created.id);
    // The tolerance verdict stays the fold's own truth — accepted, never
    // re-judged into "within".
    expect(viscosity!.toleranceVerdict).toBe("ABOVE_UCL");
  });

  it("the deviation reference's own floors: an OPEN NCR is not an acceptance; another item's NCR is not this item's acceptance", async () => {
    const world = await specWorld("DEV-FLOORS");
    const open = await withTenant(TENANT_QUALITY, () =>
      ncr.create({
        source: "PRODUCTION",
        severity: "LOW",
        itemId: world.itemId,
        problem: "Open deviation — not yet dispositioned",
        affectedQty: "1",
        actorId: QL_ACTOR,
      }),
    );
    await expect(
      withTenant(TENANT_QUALITY, () =>
        coa.generate({
          docType: "COA",
          itemId: world.itemId,
          parameters: [
            { specId: world.viscosityId, value: "112.000000", ncrId: open.id },
            { specId: world.phId, value: "7.000000" },
            { specId: world.colorId, value: "0.000000" },
          ],
          actorId: QL_ACTOR,
        }),
      ),
    ).rejects.toBeInstanceOf(CoaDeviationNcrInvalidError);
    // Another item's ACCEPT-dispositioned NCR.
    const other = await specWorld("DEV-OTHER-ITEM");
    const foreign = await withTenant(TENANT_QUALITY, () =>
      ncr.create({
        source: "PRODUCTION",
        severity: "LOW",
        itemId: other.itemId,
        problem: "A different item's accepted deviation",
        affectedQty: "1",
        actorId: QL_ACTOR,
      }),
    );
    await withTenant(TENANT_QUALITY, () =>
      ncr.disposition(foreign.id, { disposition: "ACCEPT", actorId: QL_ACTOR }),
    );
    await expect(
      withTenant(TENANT_QUALITY, () =>
        coa.generate({
          docType: "COA",
          itemId: world.itemId,
          parameters: [
            { specId: world.viscosityId, value: "112.000000", ncrId: foreign.id },
            { specId: world.phId, value: "7.000000" },
            { specId: world.colorId, value: "0.000000" },
          ],
          actorId: QL_ACTOR,
        }),
      ),
    ).rejects.toMatchObject({ code: "COA_DEVIATION_NCR_INVALID" });
  });

  it("THE COVERAGE LAW: a missing parameter, a foreign spec, and a duplicate measurement each block, named", async () => {
    const world = await specWorld("COVERAGE");
    await expect(
      withTenant(TENANT_QUALITY, () =>
        coa.generate({
          docType: "COA",
          itemId: world.itemId,
          parameters: [
            { specId: world.viscosityId, value: "100.000000" },
            { specId: world.colorId, value: "0.000000" },
          ],
          actorId: QL_ACTOR,
        }),
      ),
    ).rejects.toMatchObject({
      code: "COA_GATE_BLOCKED",
      details: { missing: ["pH"] },
    });
    await expect(
      withTenant(TENANT_QUALITY, () =>
        coa.generate({
          docType: "COA",
          itemId: world.itemId,
          parameters: [
            { specId: world.viscosityId, value: "100.000000" },
            { specId: world.phId, value: "7.000000" },
            { specId: world.colorId, value: "0.000000" },
            { specId: "11111111-1111-4111-8111-111111111111", value: "1.000000" },
          ],
          actorId: QL_ACTOR,
        }),
      ),
    ).rejects.toMatchObject({
      code: "COA_GATE_BLOCKED",
      details: { foreign: ["11111111-1111-4111-8111-111111111111"] },
    });
    await expect(
      withTenant(TENANT_QUALITY, () =>
        coa.generate({
          docType: "COA",
          itemId: world.itemId,
          parameters: [
            { specId: world.viscosityId, value: "100.000000" },
            { specId: world.viscosityId, value: "101.000000" },
            { specId: world.phId, value: "7.000000" },
            { specId: world.colorId, value: "0.000000" },
          ],
          actorId: QL_ACTOR,
        }),
      ),
    ).rejects.toMatchObject({
      code: "COA_GATE_BLOCKED",
      details: { duplicates: [world.viscosityId] },
    });
  });

  it("the empty register is the honest refusal (nothing to certify, never an empty certificate)", async () => {
    const itemId = await freshQualityItem("COA-NOSPECS");
    await expect(
      withTenant(TENANT_QUALITY, () =>
        coa.generate({
          docType: "COA",
          itemId,
          parameters: [{ specId: "11111111-1111-4111-8111-111111111111", value: "1.000000" }],
          actorId: QL_ACTOR,
        }),
      ),
    ).rejects.toBeInstanceOf(CoaNoSpecificationsError);
  });

  it("the provenance floors: a foreign batch and a foreign inspection are the typed refusals; the GRN per-line resolution passes", async () => {
    const world = await specWorld("PROV");
    // A batch of ANOTHER item.
    const foreign = await freshQualityBatch("COA-FOREIGN-BATCH");
    await expect(
      withTenant(TENANT_QUALITY, () =>
        coa.generate({
          docType: "COA",
          itemId: world.itemId,
          batchId: foreign.batchId,
          parameters: [
            { specId: world.viscosityId, value: "100.000000" },
            { specId: world.phId, value: "7.000000" },
            { specId: world.colorId, value: "0.000000" },
          ],
          actorId: QL_ACTOR,
        }),
      ),
    ).rejects.toBeInstanceOf(CoaBatchItemMismatchError);
    // An FG-batch-target inspection resolving to ANOTHER item (a raw
    // production order of the other world carries the foreign batch's
    // item — the mapping chain walks the FG batch first).
    const other = await specWorld("PROV-OTHER");
    const foreignOrder = await rawProductionOrder(other.itemId, "COA-FGN");
    const foreignBatchInspection = await withTenant(TENANT_QUALITY, () =>
      insertInspection({
        targetType: "production_order",
        orderId: foreignOrder,
        grnId: null,
        fgBatchId: foreign.batchId,
        result: "PASS",
        sampled: false,
        sampleSize: null,
        disposition: null,
        inspectedAt: "2026-06-01T09:00:00.000Z",
        note: null,
        noteAr: null,
        actorId: QL_ACTOR,
      }),
    );
    await expect(
      withTenant(TENANT_QUALITY, () =>
        coa.generate({
          docType: "COA",
          itemId: world.itemId,
          inspectionId: foreignBatchInspection.id,
          parameters: [
            { specId: world.viscosityId, value: "100.000000" },
            { specId: world.phId, value: "7.000000" },
            { specId: world.colorId, value: "0.000000" },
          ],
          actorId: QL_ACTOR,
        }),
      ),
    ).rejects.toBeInstanceOf(CoaInspectionItemMismatchError);
    // THE GRN PER-LINE RESOLUTION: a goods-receipt-target inspection
    // whose receipt carries THIS item passes (the W-25 declared shape).
    const supplier = await freshQualitySupplier("COA-GRN");
    const monthStart = `${new Date().getUTCFullYear()}-${String(new Date().getUTCMonth() + 1).padStart(2, "0")}-01`;
    const delivery = await seedSupplierDelivery({
      world: { ...supplier, itemId: world.itemId },
      code: "COA-GRN-1",
      orderDate: monthStart,
      expectedDate: monthStart,
      receiptDate: monthStart,
    });
    const grnInspection = await withTenant(TENANT_QUALITY, () =>
      insertInspection({
        targetType: "goods_receipt",
        orderId: null,
        grnId: delivery.grnId,
        fgBatchId: null,
        result: "PASS",
        sampled: true,
        sampleSize: 3,
        disposition: null,
        inspectedAt: `${monthStart}T10:00:00.000Z`,
        note: null,
        noteAr: null,
        actorId: QL_ACTOR,
      }),
    );
    const row = await withTenant(TENANT_QUALITY, () =>
      coa.generate({
        docType: "COC",
        itemId: world.itemId,
        inspectionId: grnInspection.id,
        parameters: [
          { specId: world.viscosityId, value: "100.000000" },
          { specId: world.phId, value: "7.000000" },
          { specId: world.colorId, value: "0.000000" },
        ],
        actorId: QL_ACTOR,
      }),
    );
    expect(row.docType).toBe("COC");
    expect(row.inspectionId).toBe(grnInspection.id);
  });

  it("THE FROZEN SNAPSHOT: a later spec PATCH never moves a stored certificate", async () => {
    const world = await specWorld("FREEZE");
    const row = await withTenant(TENANT_QUALITY, () =>
      coa.generate({
        docType: "COA",
        itemId: world.itemId,
        parameters: [
          { specId: world.viscosityId, value: "100.000000" },
          { specId: world.phId, value: "7.000000" },
          { specId: world.colorId, value: "0.000000" },
        ],
        actorId: QL_ACTOR,
      }),
    );
    const snapshot = JSON.stringify(row.parameters);
    // The register moves on (a new target + a wider band)…
    await withTenant(TENANT_QUALITY, () =>
      specifications.update(
        world.viscosityId,
        { targetValue: "95.000000", ucl: "120.000000" },
        QL_ACTOR,
      ),
    );
    // …the STORED certificate never does (the print law's frozen input).
    const reRead = await withTenant(TENANT_QUALITY, () => coa.find(row.id));
    expect(JSON.stringify(reRead.parameters)).toBe(snapshot);
    const [viscosity] = reRead.parameters as unknown as ({ targetValue: string; ucl: string } | undefined)[];
    expect(viscosity!.targetValue).toBe("100.000000");
    expect(viscosity!.ucl).toBe("110.000000");
  });

  it("the reads: the list by item and the 404 shape; THE RLS BOUNDARY keeps the isolated tenant empty", async () => {
    const world = await specWorld("READS");
    const row = await withTenant(TENANT_QUALITY, () =>
      coa.generate({
        docType: "COA",
        itemId: world.itemId,
        parameters: [
          { specId: world.viscosityId, value: "100.000000" },
          { specId: world.phId, value: "7.000000" },
          { specId: world.colorId, value: "0.000000" },
        ],
        actorId: QL_ACTOR,
      }),
    );
    const listed = await withTenant(TENANT_QUALITY, () =>
      coa.list({ itemId: world.itemId }),
    );
    expect(listed.map((item) => item.id)).toContain(row.id);
    await expect(
      withTenant(TENANT_QUALITY, () => coa.find("11111111-1111-4111-8111-111111111111")),
    ).rejects.toMatchObject({ code: "COA_DOCUMENT_NOT_FOUND" });
    // THE RLS BOUNDARY: the isolated tenant sees nothing (A7 parity —
    // the find is the 404 shape, the list is empty).
    await expect(
      withTenant(TENANT_QUALITY_RLS, () => coa.find(row.id)),
    ).rejects.toMatchObject({ code: "COA_DOCUMENT_NOT_FOUND" });
    const rlsList = await withTenant(TENANT_QUALITY_RLS, () => coa.list({}));
    expect(rlsList).toEqual([]);
  });
});
