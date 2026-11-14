import { beforeAll, describe, expect, it } from "vitest";

import { withTenant } from "../../infra/db/tenant-context";
import { PermissionDeniedError } from "../../modules/reporting/application/scope";
import { fullContext, newRunService } from "./fixtures";
import {
  M_ACTOR,
  TENANT_M,
  reservations,
  setupMfgFixture,
  stock,
  type MfgFixture,
} from "../manufacturing/fixtures";
import * as itemsStore from "../../modules/items/infrastructure/items.store";

/**
 * PHASE-043 T-16 — the two planning report contracts over the shared
 * manufacturing tenant M (the 042/044 reporting-spec pattern):
 *
 * - `manufacturing.mrp-exceptions` — the five documented exception classes;
 *   the spec seeds a policy defect (an item with NO lead time) and asserts
 *   the MISSING_LEAD_TIME class renders, the class assertion passes, and a
 *   foreign warehouse narrows clean.
 * - `manufacturing.atp-position` — the BR-080 exclusion evidence as
 *   columns: a quarantine hold + a reservation over one item must keep
 *   available = on-hand − quarantined − reserved EXACTLY, and the
 *   consignment-owned column stays visible-but-never-counted; the
 *   br080 + non-negative assertions PASS and a permission-less session is
 *   denied.
 *
 * The spec owns its rows (the planning-goldens discipline — never the §8
 * golden chain's shared rows); SKU prefix REP-P043 keeps the corpus safe.
 */

let fixture: MfgFixture;
let noPolicyItem = "";
void noPolicyItem;
let atpItem = "";
const quarantineBatchId: string | null = null;

async function runReport(reportKey: string, params: Record<string, unknown>, overrides?: { permissions?: ReadonlySet<string> }) {
  return withTenant(TENANT_M, () =>
    newRunService().run({
      reportKey,
      params,
      ctx: fullContext(TENANT_M, overrides),
    }),
  );
}

beforeAll(async () => {
  fixture = await setupMfgFixture();

  // 1. The policy-defect item: STOCK, ACTIVE, NO lead time (the 0074
  //    default shape) — the exceptions report's seeded MISSING_LEAD_TIME row.
  noPolicyItem = await ensureItem("REP-P043-NOPOLICY", "Report item — no lead time policy");

  // 2. The ATP item: stock received, one batch quarantined, one reservation
  //    ACTIVE — the exclusion columns carry real evidence.
  atpItem = await ensureItem("REP-P043-ATP", "Report item — ATP exclusions", true);
  await withTenant(TENANT_M, () =>
    stock.manualReceipt({
      itemId: atpItem,
      warehouseId: fixture.warehouseFg,
      qty: "100",
      unitCost: "5.00",
      batchNo: "REP-P043-B1",
      reason: "COUNT_GAIN",
      counterAccountId: fixture.gl.inventoryAppreciation ?? null,
      valueDate: new Date().toISOString().slice(0, 10),
      actorId: M_ACTOR,
    }),
  );
  // The BIN-level quarantine (the BR-080 evidence is bin_contents.status —
  // the G-43 board's row; the default posting policy keeps the ledger off).
  const contentId = await withTenant(TENANT_M, async () => {
    const { wmsQueries } = await import("../../modules/reporting/registry/services").then((m) => m.reportingServices());
    const rows = await wmsQueries.binContents({});
    return rows.find((row) => row.itemSku === "REP-P043-ATP" && row.status === "AVAILABLE")?.contentId ?? null;
  });
  if (contentId !== null) {
    const { WmsService } = await import("../../modules/inventory/application/wms.service");
    const { InboxService } = await import("../../modules/notifications/application/inbox-service");
    const { QuarantineService } = await import("../../modules/inventory/application/quarantine-service");
    const { AuditService } = await import("../../modules/audit/api/audit");
    const { DrizzleAuditStore } = await import("../../modules/audit/infrastructure/drizzle-audit.store");
    const { mPosting } = await import("../manufacturing/fixtures");
    const quarantineAudit = new AuditService(new DrizzleAuditStore());
    const quarantine = new QuarantineService(
      quarantineAudit,
      mPosting,
      new WmsService(quarantineAudit, new InboxService()),
    );
    await withTenant(TENANT_M, () => quarantine.transition(contentId, "QUARANTINE", { note: "REP-P043 spec hold", actorId: M_ACTOR }));
  }
  // A second, CLEAN batch of 20 — the reservation's backing under the
  // 043-audit item-5 over-reservation guard (creation fails closed
  // without promiseable stock; the whole first batch is quarantined).
  // The pinned arithmetic is PRESERVED EXACTLY: on-hand 120 −
  // quarantined 100 − reserved 20 = available 0.
  await withTenant(TENANT_M, () =>
    stock.manualReceipt({
      itemId: atpItem,
      warehouseId: fixture.warehouseFg,
      qty: "20",
      unitCost: "5.00",
      batchNo: "REP-P043-B2",
      reason: "COUNT_GAIN",
      counterAccountId: fixture.gl.inventoryAppreciation ?? null,
      valueDate: new Date().toISOString().slice(0, 10),
      actorId: M_ACTOR,
    }),
  );
  await withTenant(TENANT_M, () =>
    reservations.create({
      itemId: atpItem,
      warehouseId: fixture.warehouseFg,
      qty: "20",
      holderType: "MANUAL",
      holderId: null,
      expiresAt: null,
      note: "REP-P043 ATP spec reservation",
      actorId: M_ACTOR,
    }),
  );
});

async function ensureItem(sku: string, name: string, trackBatch = false): Promise<string> {
  const found = await withTenant(TENANT_M, () => itemsStore.findItemBySku(sku));
  if (found !== undefined) return found.id;
  const uoms = await withTenant(TENANT_M, () => itemsStore.listUoms());
  const pcs = uoms.find((u) => u.code === "PCS") ?? uoms[0]!;
  return withTenant(
    TENANT_M,
    () =>
      itemsStore.insertItem({
        sku,
        name,
        nameAr: null,
        kind: "STOCK",
        uomId: pcs.id,
        categoryId: null,
        taxCodeId: null,
        costingMethod: "WAC",
        trackBatch,
        trackSerial: false,
        trackImei: false,
        hasExpiry: false,
        shelfLifeDays: null,
        reorderLevel: null,
        reorderQty: null,
        basePrice: null,
      }).then((row) => row.id),
  );
}

describe("manufacturing.mrp-exceptions — the data-readiness view", () => {
  it("renders the seeded MISSING_LEAD_TIME class and passes the class assertion", async () => {
    const outcome = await runReport("manufacturing.mrp-exceptions", { locale: "en" });
    expect(outcome.status).toBe("SUCCEEDED");
    const result = outcome.result!;
    const row = result.rows.find(
      (candidate) => candidate.values.sku === "REP-P043-NOPOLICY" && candidate.values.exceptionKind === "MISSING_LEAD_TIME",
    );
    expect(row).toBeDefined();
    const classes = result.assertions.find((assertion) => assertion.id === "mrp-exception-classes");
    expect(classes?.status).toBe("PASS");
    // The exceptions total is the row count (the sum-kind totals render).
    const total = result.totals.find((candidate) => candidate.id === "exceptions");
    expect(total).toBeDefined();
    expect(Number(total!.amount)).toBeGreaterThanOrEqual(result.rows.length);
  });

  it("narrows a foreign warehouse to zero rows", async () => {
    const outcome = await runReport("manufacturing.mrp-exceptions", {
      locale: "en",
      warehouseId: "00000000-0000-4000-8000-000000000000",
    });
    expect(outcome.status).toBe("SUCCEEDED");
    // A foreign (never-existed) warehouse holds no stock → no scoped items →
    // no run-scoped exceptions; the policy defects span stockless items too
    // (the corpus read is warehouse-gated through item_stock existence).
    const mine = outcome.result!.rows.filter((row) => row.values.sku === "REP-P043-NOPOLICY");
    expect(mine).toHaveLength(0);
  });
});

describe("manufacturing.atp-position — the BR-080 exclusion evidence", () => {
  it("keeps available = on-hand − quarantined − reserved exactly, with the exclusion columns visible", async () => {
    const outcome = await runReport("manufacturing.atp-position", { locale: "en" });
    expect(outcome.status).toBe("SUCCEEDED");
    const result = outcome.result!;
    const row = result.rows.find((candidate) => candidate.values.sku === "REP-P043-ATP");
    expect(row).toBeDefined();
    const onHand = Number(row!.values.onHand);
    const quarantined = Number(row!.values.quarantined);
    const reserved = Number(row!.values.reserved);
    const available = Number(row!.values.available);
    expect(onHand).toBe(120); // 100 (the quarantined batch) + 20 (the reservation's clean backing)
    expect(quarantined).toBe(100); // the whole first batch held
    expect(reserved).toBe(20);
    expect(available).toBe(0); // max(120 − 100 − 20, 0) — floored honestly
    // The exclusion columns ride their own cells (BR-080's audit trail).
    expect(Number(row!.values.consignmentOwned)).toBeGreaterThanOrEqual(0);
    const exclusions = result.assertions.filter((assertion) =>
      ["atp-br080-exclusions", "atp-non-negative"].includes(assertion.id),
    );
    expect(exclusions).toHaveLength(2);
    for (const assertion of exclusions) {
      expect(assertion.status).toBe("PASS");
    }
    void quarantineBatchId;
  });

  it("narrows by item", async () => {
    const outcome = await runReport("manufacturing.atp-position", {
      locale: "en",
      itemId: atpItem,
    });
    expect(outcome.status).toBe("SUCCEEDED");
    const skus = outcome.result!.rows.map((row) => row.values.sku);
    expect(new Set(skus)).toEqual(new Set(["REP-P043-ATP"]));
  });

  it("denies a session without manufacturing.mrp", async () => {
    const outcome = runReport("manufacturing.atp-position", {
      locale: "en",
    }, { permissions: new Set(["reporting.reports.run"]) });
    await expect(outcome).rejects.toBeInstanceOf(PermissionDeniedError);
  });
});
