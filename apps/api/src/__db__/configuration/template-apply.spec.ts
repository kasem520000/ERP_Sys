import { beforeAll, describe, expect, it } from "vitest";

import {
  GROCERY_MANIFEST,
  RETAIL_MANIFEST,
  RESTAURANT_MANIFEST,
  hashManifestJson,
} from "@erp/contracts";

import { superuserClient } from "../test-db";
import { withTenant } from "../../infra/db/tenant-context";
import { resetConfigurationCache } from "../../modules/configuration/application/config-events";
import { parseAppliedOverrides } from "../../modules/configuration/application/apply/applied-state.store";
import { findAppliedStateRow } from "../../modules/configuration/application/apply/applied-state.store";
import {
  applyService,
  auditActions,
  driftService,
  postServiceInvoice,
  provisionBusinessTenant,
  resolver,
  seedPostingSubstrate,
  tenantLevelSeries,
} from "./template-fixtures";

/**
 * PHASE-015 §6 `template-apply.spec` — golden onboarding fixtures per
 * shipped template (industries/README §8 #3): apply each manifest to a
 * FRESH business-plan tenant through the real registration + apply flow
 * and assert the applied state (key/version/manifest hash — the hash equals
 * the KNOWN `pnpm validate:manifests` output), the append-only numbering
 * series registry, the overrides (report pins + the bilingual onboarding
 * checklist with POS entries labeled PHASE-016), the derived navigation
 * (groups ordered; POS items phase-gated-not-hidden), terminology
 * (template > glossary), the inventory defaults flowing via the engine for
 * NEW items, idempotent re-apply, apply on a tenant with existing data
 * changing NOTHING existing, and the drift service's upgrade OFFER
 * (recorded, never auto-applied).
 */

/** KNOWN hashes — `pnpm validate:manifests` on the shipped v1.0.0 set. */
const KNOWN_HASHES: Readonly<Record<string, string>> = Object.freeze({
  "industry.retail": "sha256:ac0a93342ae85cd9b870c96b2bf63cb13e5e815477ebd9d9679f08700080cbba",
  "industry.grocery": "sha256:c6ef7c8a82bdc3817e46e9068892e550ea2bbacb1583d0954f5c86704e29525e",
  "industry.restaurant": "sha256:e187c90342250bf0a99497c27e7cb97ec7ce0b7420f76e1b3d1aab1b6954b127",
});

interface GoldenTenant {
  readonly slug: string;
  readonly key: string;
  readonly manifest: typeof RETAIL_MANIFEST;
  readonly tenantId: string;
  readonly ownerId: string;
}

let retail: GoldenTenant;
let grocery: GoldenTenant;
let restaurant: GoldenTenant;

beforeAll(async () => {
  const retailProvisioned = await provisionBusinessTenant("retail-golden", "industry.retail");
  const groceryProvisioned = await provisionBusinessTenant("grocery-golden", "industry.grocery");
  const restaurantProvisioned = await provisionBusinessTenant(
    "restaurant-golden",
    "industry.restaurant",
  );
  retail = {
    slug: "retail-golden",
    key: "industry.retail",
    manifest: RETAIL_MANIFEST,
    ...retailProvisioned,
  };
  grocery = {
    slug: "grocery-golden",
    key: "industry.grocery",
    manifest: GROCERY_MANIFEST,
    ...groceryProvisioned,
  };
  restaurant = {
    slug: "restaurant-golden",
    key: "industry.restaurant",
    manifest: RESTAURANT_MANIFEST,
    ...restaurantProvisioned,
  };
});

/** Shared golden assertions, parameterized per template. */
async function assertGoldenFixture(tenant: GoldenTenant): Promise<void> {
  const result = await withTenant(tenant.tenantId, () =>
    applyService.apply(tenant.ownerId, { templateKey: tenant.key, mode: "initial" }),
  );
  expect(result.applied).toBe(true);
  expect(result.templateKey).toBe(tenant.key);
  expect(result.version).toBe("1.0.0");

  // -- tenant_industry_config row (key / version / KNOWN hash) ------------
  const row = await withTenant(tenant.tenantId, () => findAppliedStateRow());
  expect(row).toBeDefined();
  expect(row!.templateKey).toBe(tenant.key);
  expect(row!.appliedVersion).toBe("1.0.0");
  expect(row!.status).toBe("ACTIVE");
  expect(row!.appliedBy).toBe(tenant.ownerId);
  expect(row!.appliedManifestHash).toBe(hashManifestJson(tenant.manifest));
  expect(row!.appliedManifestHash).toBe(KNOWN_HASHES[tenant.key]);

  // -- numbering series registry (append-only; none pre-existed) ----------
  const series = await tenantLevelSeries(tenant.tenantId);
  expect(series.map((entry) => entry.docType)).toEqual(
    Object.keys(tenant.manifest.document_numbering_defaults).sort(),
  );
  for (const [docType, rule] of Object.entries(tenant.manifest.document_numbering_defaults)) {
    const entry = series.find((candidate) => candidate.docType === docType)!;
    expect(entry.format).toBe(rule.format);
    // Seeded at the CHECK minimum (≥ 1) — an acquisition-INERT registry row
    // (consumers scope by branch/period, so this counter never moves).
    expect(entry.nextValue).toBe("1");
  }

  // -- overrides: report pins + checklist + modules ------------------------
  const overrides = parseAppliedOverrides(row!.overrides);
  expect(overrides.report_pins.map((pin) => pin.report_key)).toEqual(
    tenant.manifest.report_defaults.map((pin) => pin.report_key),
  );
  const firstPin = tenant.manifest.report_defaults[0]!;
  expect(overrides.report_pins[0]).toMatchObject({
    report_key: firstPin.report_key,
    pinned: firstPin.pinned,
    dashboard: firstPin.dashboard ?? false,
    ...(firstPin.default_period === undefined
      ? {}
      : { default_period: firstPin.default_period }),
  });
  expect(overrides.onboarding_checklist.map((step) => step.id)).toEqual(
    tenant.manifest.onboarding_steps.map((step) => step.id),
  );
  expect(overrides.enabled_modules).toEqual(tenant.manifest.default_modules_enabled);

  // Every mutation audited (before/after diff via the same UoW).
  expect(await auditActions(tenant.tenantId, "industry.template.applied")).toBe(1);
}

describe("template-apply — golden onboarding fixtures (README §8 #3)", () => {
  it("industry.retail v1.0.0 applies cleanly to a fresh business tenant", async () => {
    await assertGoldenFixture(retail);

    // Navigation derives from the manifest: groups ordered; the POS item is
    // VISIBLE (pos.sales entitled on business — not hidden); IMEI visible.
    resetConfigurationCache();
    const config = await withTenant(retail.tenantId, () =>
      resolver.resolveTenantStatic(retail.tenantId),
    );
    expect(config.ui.navigation).toEqual(["selling", "stock"]);
    const selling = config.ui.navigation_tree.find((group) => group.id === "selling")!;
    expect(selling.items.map((item) => item.id)).toEqual(["pos", "returns", "receipts"]);
    expect(selling.items[0]).toMatchObject({ feature_key: "pos.sales" });
    expect(selling.items[0]!.phase_gated).toBeUndefined();
    // Terminology: template > glossary (doc.sales_invoice_pos relabeled).
    expect(config.ui.terminology["doc.sales_invoice_pos"]).toEqual({
      en: "POS sale",
      ar: "بيع نقطة البيع",
    });
    // L1 defaults land through the engine merge (L5 unset ⇒ template wins).
    expect(config.policies["sales.cash_autopost"]).toBe(true);
    expect(config.policies["inventory.fefo_for_expiry_items"]).toBe(false);
    // Inventory defaults live in the manifest + flow via the engine for
    // NEWLY created items (R3) — the fefo policy key is the engine leg.
    expect(retail.manifest.inventory_policy_defaults).toMatchObject({
      costing_method: "WAC",
      default_track_batch: false,
      fefo_picking: false,
      allow_negative_stock: false,
    });

    // Overrides: the POS onboarding entries are labeled PHASE-016 (the
    // checklist flags — the PHASE-016 POS set shipped: steps LIVE).
    const overrides = parseAppliedOverrides(
      (await withTenant(retail.tenantId, () => findAppliedStateRow()))!.overrides,
    );
    expect(overrides.onboarding_checklist.find((step) => step.id === "terminals")).toMatchObject({
      featureKey: "pos.terminals",
      status: "visible",
      }); // PHASE-016 shipped: LIVE
    expect(overrides.onboarding_checklist.find((step) => step.id === "first_shift")).toMatchObject({
      status: "visible",
      }); // PHASE-016 shipped: LIVE
    expect(overrides.onboarding_checklist.find((step) => step.id === "coa_confirm")).toMatchObject({
      status: "visible",
    });
  });

  it("industry.grocery v1.0.0 applies cleanly to a fresh business tenant", async () => {
    await assertGoldenFixture(grocery);

    resetConfigurationCache();
    const config = await withTenant(grocery.tenantId, () =>
      resolver.resolveTenantStatic(grocery.tenantId),
    );
    expect(config.ui.navigation).toEqual(["selling", "expiry"]);
    // Terminology: grocery relabels write-off (glossary says Shrinkage).
    expect(config.ui.terminology["inventory.writeoff"]).toEqual({
      en: "Write-off",
      ar: "الإعدام",
    });
    // Grocery defaults: batch + expiry + FEFO ON for new items.
    expect(config.policies["inventory.fefo_for_expiry_items"]).toBe(true);
    expect(config.policies["batch_expiry_capture_required_on_grn"]).toBe(true);
    expect(grocery.manifest.inventory_policy_defaults).toMatchObject({
      default_track_batch: true,
      default_track_expiry: true,
      fefo_picking: true,
    });

    const overrides = parseAppliedOverrides(
      (await withTenant(grocery.tenantId, () => findAppliedStateRow()))!.overrides,
    );
    // POS checklist entries LIVE since PHASE-016 (terminals via
    // barcode_pos, scale items via scale_barcodes — keys granted).
    expect(overrides.onboarding_checklist.find((step) => step.id === "terminals")).toMatchObject({
      status: "visible",
      }); // PHASE-016 shipped: LIVE
    expect(overrides.onboarding_checklist.find((step) => step.id === "scale_items")).toMatchObject({
      featureKey: "pos.barcode_scanning",
      status: "visible",
      }); // PHASE-016 shipped: LIVE
    expect(overrides.onboarding_checklist.find((step) => step.id === "first_count")).toMatchObject({
      status: "visible",
    });
  });

  it("industry.restaurant v1.0.0 applies cleanly to a fresh business tenant", async () => {
    await assertGoldenFixture(restaurant);

    resetConfigurationCache();
    const config = await withTenant(restaurant.tenantId, () =>
      resolver.resolveTenantStatic(restaurant.tenantId),
    );
    expect(config.ui.navigation).toEqual(["floor", "day"]);
    // The POS nav items are LIVE since PHASE-016 (the §3 intake keys
    // registered + granted by the plan; no gates remain on the floor).
    const floor = config.ui.navigation_tree.find((group) => group.id === "floor")!;
    expect(floor.items.map((item) => item.id)).toEqual(["tables", "quick_sale", "kitchen"]);
    expect(floor.items.find((item) => item.id === "tables")).toMatchObject({
      feature_key: "pos.table_service",
    });
    expect(floor.items.find((item) => item.id === "tables")!.phase_gated).toBeUndefined();
    expect(floor.items.find((item) => item.id === "kitchen")).toMatchObject({
      feature_key: "pos.kitchen_display",
    });
    expect(floor.items.find((item) => item.id === "kitchen")!.phase_gated).toBeUndefined();
    expect(floor.items.find((item) => item.id === "quick_sale")!.phase_gated).toBeUndefined();
    const day = config.ui.navigation_tree.find((group) => group.id === "day")!;
    expect(day.items.map((item) => item.id)).toEqual(["shifts", "z_close"]);
    // Terminology + restaurant policies.
    expect(config.ui.terminology["pos.table"]).toEqual({ en: "Table", ar: "طاولة" });
    expect(config.policies["combo_explosion_at_posting"]).toBe(true);
    expect(config.policies["unpaid_table_holds_no_ledger"]).toBe(true);
    expect(config.policies["service_charge_default_rate"]).toBe(0);

    const overrides = parseAppliedOverrides(
      (await withTenant(restaurant.tenantId, () => findAppliedStateRow()))!.overrides,
    );
    expect(overrides.onboarding_checklist.find((step) => step.id === "terminals")).toMatchObject({
      featureKey: "pos.table_service",
      status: "visible",
      }); // PHASE-016 shipped: LIVE
    expect(overrides.onboarding_checklist.find((step) => step.id === "menu")).toMatchObject({
      status: "visible",
    });
  });

  it("re-apply is idempotent: applied:false, no duplicate series, no second audit", async () => {
    const before = await withTenant(retail.tenantId, () => findAppliedStateRow());
    const seriesBefore = await tenantLevelSeries(retail.tenantId);

    const second = await withTenant(retail.tenantId, () =>
      applyService.apply(retail.ownerId, {
        templateKey: "industry.retail",
        mode: "reapply",
      }),
    );
    expect(second.applied).toBe(false);
    expect(second.reason).toBe("already-applied");

    const after = await withTenant(retail.tenantId, () => findAppliedStateRow());
    expect(after!.appliedAt).toBe(before!.appliedAt); // zero writes on the no-op
    expect(after!.appliedManifestHash).toBe(before!.appliedManifestHash);
    expect(await tenantLevelSeries(retail.tenantId)).toHaveLength(seriesBefore.length);
    expect(await auditActions(retail.tenantId, "industry.template.applied")).toBe(1);
  });

  it("apply on a tenant WITH existing data changes NOTHING existing (R3/INV-022)", async () => {
    const { tenantId, ownerId } = await provisionBusinessTenant(
      "existing-data",
      "industry.grocery",
    );
    const substrate = await seedPostingSubstrate(tenantId, ownerId, "EXIST");

    // An item (batch-tracking OFF — R3's protected existing state) + a
    // POSTED back-office invoice through the real sales flow.
    const itemId = await withTenant(tenantId, async () => {
      const itemsStore = await import("../../modules/items/infrastructure/items.store");
      const uoms = await itemsStore.listUoms();
      const pcs = uoms.find((uom) => uom.code === "PCS")!;
      const created = await itemsStore.insertItem({
        sku: "TPL-EXISTING-1",
        name: "Existing item",
        nameAr: null,
        kind: "STOCK",
        uomId: pcs.id,
        categoryId: null,
        taxCodeId: null,
        costingMethod: "WAC",
        trackBatch: false,
        trackSerial: false,
        trackImei: false,
        hasExpiry: false,
        reorderLevel: null,
        reorderQty: null,
        basePrice: "50.000000",
      });
      return created.id;
    });
    const invoice = await postServiceInvoice(substrate, "pre-apply invoice");

    const snapshot = await existingDataSnapshot(tenantId, invoice.invoiceId, itemId);
    expect(snapshot.invoice).toMatchObject({ status: "POSTED", invoiceNo: invoice.invoiceNo });

    // Apply GROCERY (batch+expiry+FEFO defaults ON for NEW items) — the
    // existing item and the posted document must be untouched.
    const result = await withTenant(tenantId, () =>
      applyService.apply(ownerId, { templateKey: "industry.grocery", mode: "initial" }),
    );
    expect(result.applied).toBe(true);

    expect(await existingDataSnapshot(tenantId, invoice.invoiceId, itemId)).toEqual(snapshot);
    // R3 proven: the item keeps its tracking flags; only NEW items pick
    // up the template defaults.
    expect(snapshot.item).toMatchObject({ trackBatch: false, hasExpiry: false });
  });

  it("registry drift records an upgrade OFFER — never auto-applies (§2 item 11)", async () => {
    const su = await superuserClient();
    const original = await su.query<{ manifest: string }>(
      `SELECT manifest::text AS manifest FROM industry_templates WHERE key = 'industry.grocery'`,
    );
    // PATCH bump of the grocery registry row (version column + the
    // manifest's own version field, §8 governance shape).
    await su.query(
      `UPDATE industry_templates
         SET version = '1.0.1',
             manifest = jsonb_set(manifest, '{version}', '"1.0.1"'::jsonb)
       WHERE key = 'industry.grocery'`,
    );
    await su.end();
    resetConfigurationCache();

    try {
      const drift = await withTenant(grocery.tenantId, () =>
        driftService.checkDrift(grocery.tenantId),
      );
      expect(drift.status).toBe("upgrade-available");
      expect(drift.drift).toBe("patch");
      expect(drift.appliedVersion).toBe("1.0.0");
      expect(drift.registryVersion).toBe("1.0.1");
      expect(drift.notification).toEqual({
        recorded: true,
        dedupeKey: "template.upgrade:industry.grocery:1.0.1",
      });

      // The offer row: bilingual, templates category, the admin action URL.
      const suOffer = await superuserClient();
      const offer = await suOffer.query<{
        category: string;
        severity: string;
        title: { ar: string; en: string };
        body: { ar: string; en: string };
        actionUrl: string;
      }>(
        `SELECT category, severity, title, body, action_url AS "actionUrl"
           FROM notifications
          WHERE tenant_id = $1 AND dedupe_key = 'template.upgrade:industry.grocery:1.0.1'`,
        [grocery.tenantId],
      );
      await suOffer.end();
      expect(offer.rows[0]).toMatchObject({
        category: "templates",
        severity: "info",
        actionUrl: "/settings/templates",
      });
      expect(offer.rows[0]!.body.ar).toContain("1.0.1");
      expect(offer.rows[0]!.body.en).toContain("1.0.1");

      // Dedupe: a second check records nothing further.
      const again = await withTenant(grocery.tenantId, () =>
        driftService.checkDrift(grocery.tenantId),
      );
      expect(again.notification).toEqual({
        recorded: false,
        dedupeKey: "template.upgrade:industry.grocery:1.0.1",
      });

      // NEVER auto-applied: the applied row still pins 1.0.0.
      const row = await withTenant(grocery.tenantId, () => findAppliedStateRow());
      expect(row!.appliedVersion).toBe("1.0.0");
      expect(row!.appliedManifestHash).toBe(KNOWN_HASHES["industry.grocery"]);
    } finally {
      // Restore the registry row verbatim (later specs see v1.0.0).
      const restore = await superuserClient();
      await restore.query(
        `UPDATE industry_templates SET version = '1.0.0', manifest = $1::jsonb
          WHERE key = 'industry.grocery'`,
        [original.rows[0]!.manifest],
      );
      await restore.end();
      resetConfigurationCache();
    }
  });
});

/** Snapshot the existing-data proofs: the posted invoice, the item, the journal. */
async function existingDataSnapshot(
  tenantId: string,
  invoiceId: string,
  itemId: string,
): Promise<{
  invoice: { invoiceNo: string; status: string; postedJournalId: string };
  item: { sku: string; trackBatch: boolean; hasExpiry: boolean; costingMethod: string };
  journal: { direction: string; amount: string }[];
}> {
  return withTenant(tenantId, async () => {
    const journal = await import("../../modules/accounting/infrastructure/journal.store");
    const su = await superuserClient();
    const invoice = await su.query<{
      invoice_no: string;
      status: string;
      posted_journal_id: string;
    }>(
      `SELECT invoice_no, status, posted_journal_id::text FROM sales_invoices WHERE id = $1`,
      [invoiceId],
    );
    const item = await su.query<{
      sku: string;
      track_batch: boolean;
      has_expiry: boolean;
      costing_method: string;
    }>(`SELECT sku, track_batch, has_expiry, costing_method FROM items WHERE id = $1`, [
      itemId,
    ]);
    await su.end();
    const lines = await journal.listLines(invoice.rows[0]!.posted_journal_id);
    return {
      invoice: {
        invoiceNo: invoice.rows[0]!.invoice_no,
        status: invoice.rows[0]!.status,
        postedJournalId: invoice.rows[0]!.posted_journal_id,
      },
      item: {
        sku: item.rows[0]!.sku,
        trackBatch: item.rows[0]!.track_batch,
        hasExpiry: item.rows[0]!.has_expiry,
        costingMethod: item.rows[0]!.costing_method,
      },
      journal: lines.map((line) => ({ direction: line.direction, amount: line.amount })),
    };
  });
}
