import { beforeAll, describe, expect, it } from "vitest";
import type { Client } from "pg";

import { Decimal } from "@erp/domain-core";

import { withTenant } from "../../infra/db/tenant-context";
import { AuditService } from "../../modules/audit/api/audit";
import { DrizzleAuditStore } from "../../modules/audit/infrastructure/drizzle-audit.store";
import { AssetTagsService } from "../../modules/fixed_assets/application/asset-tags-service";
import * as store from "../../modules/fixed_assets/infrastructure/cmms.store";
import {
  CmmsAssetNotOperableError,
  CmmsTagAlreadyPrintedError,
  CmmsTagCodeInvalidError,
  CmmsTagNotFoundError,
} from "../../modules/fixed_assets/domain/cmms-errors";
import { superuserClient } from "../test-db";
import { CM_ACTOR, TENANT_CMMS, TENANT_CMMS_RLS, freshAsset } from "./fixtures";

/**
 * PHASE-049 (W-19 — T-11) — the signed tags pinned over real PostgreSQL 16
 * (the plan §4's `cmms-tags.db.spec` — acceptance #7's API arms): the
 * codes are unguessable signed tokens, unique per tenant; the scan
 * resolves to the asset card; the printed stamp is the single-consumption
 * CAS seal; ZERO PARALLEL ACCOUNTING (the sheet and the printed state
 * derive from the rows).
 *
 * THE DEDICATED BOUNDARY TENANT (TENANT_CMMS_RLS — empty by construction):
 * the cross-tenant scan arm reads the shared tenant's validly-signed code
 * under the boundary tenant's scope — RLS hides the row, the typed 404 is
 * the answer, never a cross-tenant oracle.
 */

const audit = new AuditService(new DrizzleAuditStore());
const tags = new AssetTagsService(audit);

const spec: { assetId?: string; code?: string } = {};

beforeAll(async () => {
  spec.assetId = await freshAsset("TAG-CARD");
});

/** The maintenance context substrate: an open work order (the card's
 * live head) + the odometer binding (R-10). */
async function seedCardContext(assetId: string): Promise<void> {
  const su: Client = await superuserClient();
  await su.query(
    `INSERT INTO maintenance_work_orders (id, tenant_id, created_by, asset_id, order_no,
        problem, priority, status)
     VALUES (gen_random_uuid(), $1, $2, $3, 'WO-TAG-1', 'Tag arm order', 'MEDIUM', 'REQUESTED')
     ON CONFLICT (tenant_id, order_no) DO NOTHING`,
    [TENANT_CMMS, CM_ACTOR, assetId],
  );
  await su.end();
  await withTenant(TENANT_CMMS, async () => {
    await store.insertMeter({
      assetId,
      name: "Odometer",
      nameAr: "عداد المسافة",
      type: "KM",
      unit: "km",
      isOdometer: true,
      lastValue: "125000.5",
      note: null,
      noteAr: null,
      createdBy: CM_ACTOR,
    });
  });
}

describe("PHASE-049 W-19 — the signed tags (D-09 — unguessable, unique, scan-resolvable)", () => {
  it("the batch create: 1…50 signed codes per act, all unique, inside the DB floor; the audit row lands", async () => {
    await withTenant(TENANT_CMMS, async () => {
      const created = await tags.createTags({
        assetId: spec.assetId!,
        quantity: 3,
        note: "Batch A",
        actorId: CM_ACTOR,
      });
      expect(created).toHaveLength(3);
      const codes = new Set(created.map((tag) => tag.code));
      expect(codes.size).toBe(3);
      for (const tag of created) {
        expect(tag.code).toMatch(/^[A-Za-z0-9_-]{43}\.[A-Za-z0-9_-]{43}$/);
        expect(tag.printedAt).toBeNull();
      }
      spec.code = created[0]!.code;
    });
    // The audit row's read rides SUPERUSER — AFTER the ambient transaction
    // committed (an uncommitted withTenant row is invisible to another
    // connection; the assertion inside the block would always read 0).
    const su = await superuserClient();
    const counted = await su.query<{ n: string }>(
      `SELECT count(*)::text AS n FROM audit_events
        WHERE tenant_id = $1 AND action = 'assets.asset_tags_created' AND entity_id = $2`,
      [TENANT_CMMS, spec.assetId!],
    );
    await su.end();
    expect(Number(counted.rows[0]!.n)).toBe(1);
  });

  it("a disposed asset takes no new labels (D-01's authoring guard — the typed refusal)", async () => {
    await withTenant(TENANT_CMMS, async () => {
      const assetId = await freshAsset("TAG-DISPOSED");
      const su = await superuserClient();
      await su.query(`UPDATE assets SET status = 'DISPOSED', disposed_at = now()
        WHERE tenant_id = $1 AND id = $2`, [TENANT_CMMS, assetId]);
      await su.end();
      const refused = await tags
        .createTags({ assetId, quantity: 1, actorId: CM_ACTOR })
        .catch((error: unknown) => error);
      expect(refused).toBeInstanceOf(CmmsAssetNotOperableError);
    });
  });

  it("THE SCAN resolves the card: the register brief + the four expiry chips + the maintenance context + the odometer binding (R-10)", async () => {
    await seedCardContext(spec.assetId!);
    await withTenant(TENANT_CMMS, async () => {
      const resolved = await tags.scanCode({ code: spec.code! });
      expect(resolved.tag.code).toBe(spec.code);
      expect(resolved.asset.id).toBe(spec.assetId);
      expect(resolved.asset.code).toBe("TAG-CARD");
      expect(resolved.asset.warrantyExpiry).toBe("2027-01-15"); // freshAsset's seed
      expect(resolved.openWorkOrders).toBe(1);
      expect(resolved.activePlans).toBe(0);
      expect(resolved.odometer).toMatchObject({ unit: "km" });
      // The numeric column's text form carries its scale (125000.500000)
      // — the decimal-aware comparison (the spares spec's expectDec shape).
      expect(new Decimal(resolved.odometer?.lastValue ?? "0").toString()).toBe("125000.5");
    });
  });

  it("THE SIGNATURE GATE: a forged/malformed code refuses at the signature (TAG_CODE_INVALID) — never at a lookup", async () => {
    await withTenant(TENANT_CMMS, async () => {
      for (const forged of ["not-a-tag-code", "abc.def", `${spec.code!.slice(0, 43)}X.${spec.code!.slice(44)}`]) {
        const refused = await tags.scanCode({ code: forged }).catch((error: unknown) => error);
        expect(refused).toBeInstanceOf(CmmsTagCodeInvalidError);
      }
    });
  });

  it("THE TYPED 404: a foreign tenant's scan of this tenant's validly-signed code finds nothing (RLS — never a cross-tenant oracle)", async () => {
    await withTenant(TENANT_CMMS_RLS, async () => {
      const refused = await tags.scanCode({ code: spec.code! }).catch((error: unknown) => error);
      expect(refused).toBeInstanceOf(CmmsTagNotFoundError);
    });
  });

  it("THE PRINTED STAMP — the single-consumption CAS seal: print once → stamped; the re-print refuses BY NAME carrying the standing stamp", async () => {
    await withTenant(TENANT_CMMS, async () => {
      const listed = await tags.listTags({ assetId: spec.assetId! });
      const first = listed[0]!;
      const stamped = await tags.printTag({ tagId: first.id, actorId: CM_ACTOR });
      expect(stamped.printedAt).not.toBeNull();

      const reprinted = await tags
        .printTag({ tagId: first.id, actorId: CM_ACTOR })
        .catch((error: unknown) => error);
      expect(reprinted).toBeInstanceOf(CmmsTagAlreadyPrintedError);
      expect((reprinted as CmmsTagAlreadyPrintedError).details).toMatchObject({
        tagId: first.id,
      });

      // ZERO PARALLEL ACCOUNTING: the print sheet DERIVES the pending
      // batch — the printed tag left it, the unprinted ones stay.
      const sheet = await tags.printSheet({ assetId: spec.assetId! });
      expect(sheet.asset.code).toBe("TAG-CARD");
      expect(sheet.tags.map((tag) => tag.id)).not.toContain(first.id);
      expect(sheet.tags.length).toBe(listed.length - 1);
    });
  });

  it("the register hygiene delete: the code stops resolving the moment the row dies (the typed 404 thereafter)", async () => {
    await withTenant(TENANT_CMMS, async () => {
      const listed = await tags.listTags({ assetId: spec.assetId! });
      const victim = listed[0]!;
      await tags.deleteTag({ tagId: victim.id, actorId: CM_ACTOR });
      const scan = await tags.scanCode({ code: victim.code }).catch((error: unknown) => error);
      expect(scan).toBeInstanceOf(CmmsTagNotFoundError);
      const reprint = await tags
        .printTag({ tagId: victim.id, actorId: CM_ACTOR })
        .catch((error: unknown) => error);
      expect(reprint).toBeInstanceOf(CmmsTagNotFoundError);
    });
  });
});
