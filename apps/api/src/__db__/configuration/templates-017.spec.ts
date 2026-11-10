import { beforeAll, describe, expect, it } from "vitest";

import {
  AUTOMOTIVE_TEMPLATE_MANIFEST,
  DISTRIBUTION_TEMPLATE_MANIFEST,
  GROCERY_MANIFEST,
  RETAIL_MANIFEST,
  hashManifestJson,
} from "@erp/contracts";

import { superuserClient } from "../test-db";
import { withTenant } from "../../infra/db/tenant-context";
import { resetConfigurationCache } from "../../modules/configuration/application/config-events";
import {
  findAppliedStateRow,
  parseAppliedOverrides,
} from "../../modules/configuration/application/apply/applied-state.store";
import {
  applyService,
  auditActions,
  postServiceInvoice,
  provisionBusinessTenant,
  resolver,
  revokeEntitlement,
  seedPostingSubstrate,
  switchService,
  tenantLevelSeries,
  type PostingSubstrate,
} from "./template-fixtures";

/**
 * PHASE-017 T2-a db spec — the two new industry templates through the
 * UNMODIFIED PHASE-015 engine (industries/README §8 #3/#5/#7):
 *
 * - `industry.automotive` / `industry.distribution` v1.0.0 apply cleanly to
 *   fresh business-plan tenants (the 0025 plan grants cover every
 *   required_feature_keys incl. the `sales.job_cards` intake): the applied
 *   row pins the KNOWN migration-0025 content hash, the append-only series
 *   registry lands (JC- job cards, STL- settlements…), report pins +
 *   bilingual onboarding checklist + enabled modules materialize, the apply
 *   is audited, and the derived navigation/terminology resolve live (the
 *   workshop/parts + field/settle groups, بطاقة عمل / خط السير /
 *   التحميل الصباحي…).
 * - Switch safety (BR-038): retail → automotive is additive-only — zero
 *   data loss, archived_* snapshots present, series append-only — and
 *   switching BACK to retail always succeeds.
 * - Degraded entitlement (§8 #7): a tenant without `sales.job_cards`
 *   applying automotive gets the typed prerequisite error with the exact
 *   missing chain — never a silent back-office apply.
 * - Grocery tier liveness: at CURRENT_SHIPPED_PHASE 17 + the 0025 grant,
 *   grocery's customer_price_tiers capability is no longer phase-gated
 *   ("coming with PHASE-017" resolved available).
 */

/** KNOWN hashes — `pnpm validate:manifests` on the five-template set (the
 *  constants are byte-identical to the migration 0025 registry seeds). */
const KNOWN_HASHES: Readonly<Record<string, string>> = Object.freeze({
  "industry.automotive": "sha256:047d5671387ae1872ca8dd2bb6f7235758caa392b7c4441429fc0aadef734172",
  "industry.distribution": "sha256:d31597032af69990560e4041cc6fb566b8c2159ee36d47f6b95b2cdf94be995d",
});

// -- tenant A: automotive apply -------------------------------------------
let autoTenant = "";
let autoOwner = "";

// -- tenant B: distribution apply -----------------------------------------
let distTenant = "";
let distOwner = "";

// -- tenant C: switch safety (retail → automotive → retail) ----------------
let switchTenant = "";
let switchOwner = "";
let switchSubstrate!: PostingSubstrate;
let switchInvoice!: { invoiceId: string; invoiceNo: string; journalEntryId: string };
let switchItemId = "";

// -- tenant D: degraded entitlement (no sales.job_cards) -------------------
let degradedTenant = "";
let degradedOwner = "";

// -- tenant E: grocery tier liveness ---------------------------------------
let groceryTenant = "";
let groceryOwner = "";

beforeAll(async () => {
  const automotive = await provisionBusinessTenant("auto-017", "industry.automotive");
  autoTenant = automotive.tenantId;
  autoOwner = automotive.ownerId;

  const distribution = await provisionBusinessTenant("dist-017", "industry.distribution");
  distTenant = distribution.tenantId;
  distOwner = distribution.ownerId;

  // The switch-safety tenant: retail applied over real business data.
  const switched = await provisionBusinessTenant("switch-auto", "industry.retail");
  switchTenant = switched.tenantId;
  switchOwner = switched.ownerId;
  switchSubstrate = await seedPostingSubstrate(switchTenant, switchOwner, "SW017");
  const itemsStore = await import("../../modules/items/infrastructure/items.store");
  switchItemId = await withTenant(switchTenant, async () => {
    const uoms = await itemsStore.listUoms();
    const pcs = uoms.find((uom) => uom.code === "PCS")!;
    const created = await itemsStore.insertItem({
      sku: "SWITCH-AUTO-ITEM-1",
      name: "Switch safety part",
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
      basePrice: "60.000000",
    });
    return created.id;
  });
  switchInvoice = await postServiceInvoice(switchSubstrate, "pre-switch invoice (automotive)");
  const appliedRetail = await withTenant(switchTenant, () =>
    applyService.apply(switchOwner, { templateKey: "industry.retail", mode: "initial" }),
  );
  expect(appliedRetail.applied).toBe(true);

  const degraded = await provisionBusinessTenant("auto-degraded", "industry.automotive");
  degradedTenant = degraded.tenantId;
  degradedOwner = degraded.ownerId;
  // The workshop capability's key off the entitlement set (0025 granted it
  // to business; the revoke simulates the pre-grant / downgraded plan).
  await revokeEntitlement(degradedTenant, "sales.job_cards");

  const grocery = await provisionBusinessTenant("grocery-live", "industry.grocery");
  groceryTenant = grocery.tenantId;
  groceryOwner = grocery.ownerId;
});

describe("templates-017 — automotive & distribution through the PHASE-015 engine", () => {
  it("industry.automotive v1.0.0 applies cleanly to a fresh business tenant", async () => {
    const result = await withTenant(autoTenant, () =>
      applyService.apply(autoOwner, { templateKey: "industry.automotive", mode: "initial" }),
    );
    expect(result.applied).toBe(true);
    expect(result.templateKey).toBe("industry.automotive");
    expect(result.version).toBe("1.0.0");
    expect(result.manifestHash).toBe(KNOWN_HASHES["industry.automotive"]);
    // The PHASE-017 intake resolves LIVE: job_cards included, nothing gated.
    const jobCards = result.prerequisiteCheck.capabilities.find(
      (capability) => capability.capabilityId === "job_cards",
    );
    expect(jobCards).toMatchObject({ status: "included", featureKeys: ["sales.job_cards"] });
    expect(result.prerequisiteCheck.status).toBe("ok");
    expect(result.prerequisiteCheck.requiresAcknowledgement).toBe(false);

    // -- the applied row: key / version / KNOWN 0025 seed hash ------------
    const row = await withTenant(autoTenant, () => findAppliedStateRow());
    expect(row).toBeDefined();
    expect(row!.templateKey).toBe("industry.automotive");
    expect(row!.appliedVersion).toBe("1.0.0");
    expect(row!.status).toBe("ACTIVE");
    expect(row!.appliedBy).toBe(autoOwner);
    expect(row!.appliedManifestHash).toBe(hashManifestJson(AUTOMOTIVE_TEMPLATE_MANIFEST));
    expect(row!.appliedManifestHash).toBe(KNOWN_HASHES["industry.automotive"]);

    // -- series registry: every automotive doc type (JC- job cards) -------
    const series = await tenantLevelSeries(autoTenant);
    expect(series.map((entry) => entry.docType)).toEqual(
      Object.keys(AUTOMOTIVE_TEMPLATE_MANIFEST.document_numbering_defaults).sort(),
    );
    const jobCard = series.find((entry) => entry.docType === "job_card")!;
    expect(jobCard.format).toBe("JC-{yyyy}-{seq:5}");
    expect(jobCard.nextValue).toBe("1"); // acquisition-inert registry row
    expect(series.find((entry) => entry.docType === "quotation")?.format).toBe("QT-{yyyy}-{seq:5}");
    expect(series.find((entry) => entry.docType === "purchase_order")?.format).toBe(
      "PO-{yyyy}-{seq:5}",
    );

    // -- overrides: report pins + checklist + modules ----------------------
    const overrides = parseAppliedOverrides(row!.overrides);
    expect(overrides.report_pins.map((pin) => pin.report_key)).toEqual([
      "automotive.job_card_profitability",
      "automotive.vehicle_service_history",
      "inventory.valuation",
      "ar.aging",
    ]);
    expect(overrides.report_pins[0]).toMatchObject({
      pinned: true,
      dashboard: true,
      default_period: "this_month",
    });
    expect(overrides.onboarding_checklist.map((step) => step.id)).toEqual(
      AUTOMOTIVE_TEMPLATE_MANIFEST.onboarding_steps.map((step) => step.id),
    );
    // No automotive step carries a feature key — everything visible (LIVE).
    expect(
      overrides.onboarding_checklist.every((step) => step.status === "visible"),
    ).toBe(true);
    expect(overrides.enabled_modules).toEqual(
      AUTOMOTIVE_TEMPLATE_MANIFEST.default_modules_enabled,
    );

    // -- audited ------------------------------------------------------------
    expect(await auditActions(autoTenant, "industry.template.applied")).toBe(1);

    // -- the derived config: workshop/parts live, terminology AR + EN ------
    resetConfigurationCache();
    const config = await withTenant(autoTenant, () => resolver.resolveTenantStatic(autoTenant));
    expect(config.layers.l1_template?.key).toBe("industry.automotive");
    expect(config.layers.l4_entitlements.missing).toEqual([]);
    expect(config.ui.navigation).toEqual(["workshop", "parts"]);
    const workshop = config.ui.navigation_tree.find((group) => group.id === "workshop")!;
    expect(workshop.items.map((item) => item.id)).toEqual(["job_cards", "vehicles", "quotes"]);
    expect(workshop.items.every((item) => item.phase_gated === undefined)).toBe(true);
    expect(config.ui.terminology["svc.job_card"]).toEqual({ en: "Job card", ar: "بطاقة عمل" });
    // Automotive does NOT carry the van-sales labels (that is distribution).
    expect(config.ui.terminology["van.load_out"]).toBeUndefined();
    expect(config.policies["job_card_parts_issue_mode"]).toBe("reserve");
    expect(config.policies["quotation_validity_days"]).toBe(7);
  });

  it("industry.distribution v1.0.0 applies cleanly to a fresh business tenant", async () => {
    const result = await withTenant(distTenant, () =>
      applyService.apply(distOwner, { templateKey: "industry.distribution", mode: "initial" }),
    );
    expect(result.applied).toBe(true);
    expect(result.manifestHash).toBe(KNOWN_HASHES["industry.distribution"]);
    // The full van-sales set is LIVE on the 0025 grants.
    for (const capabilityId of ["van_stock", "route_planning", "customer_price_tiers", "commissions"]) {
      const capability = result.prerequisiteCheck.capabilities.find(
        (candidate) => candidate.capabilityId === capabilityId,
      );
      expect(capability, capabilityId).toMatchObject({ status: "included" });
    }
    expect(result.prerequisiteCheck.requiresAcknowledgement).toBe(false);

    const row = await withTenant(distTenant, () => findAppliedStateRow());
    expect(row!.templateKey).toBe("industry.distribution");
    expect(row!.appliedVersion).toBe("1.0.0");
    expect(row!.appliedManifestHash).toBe(KNOWN_HASHES["industry.distribution"]);

    // -- series registry: LOD/INV/CN/RCP/STL (the settlement series) -------
    const series = await tenantLevelSeries(distTenant);
    expect(series.map((entry) => entry.docType)).toEqual(
      Object.keys(DISTRIBUTION_TEMPLATE_MANIFEST.document_numbering_defaults).sort(),
    );
    expect(series.find((entry) => entry.docType === "settlement")?.format).toBe("STL-{yyyy}-{seq:5}");
    expect(series.find((entry) => entry.docType === "stock_transfer")?.format).toBe(
      "LOD-{yyyy}-{seq:5}",
    );
    expect(series.find((entry) => entry.docType === "receipt")?.format).toBe("RCP-{yyyy}-{seq:6}");

    // -- overrides: pins + checklist + the distribution module enabled -----
    const overrides = parseAppliedOverrides(row!.overrides);
    expect(overrides.report_pins.map((pin) => pin.report_key)).toEqual([
      "distribution.rep_settlement",
      "distribution.van_stock_balances",
      "distribution.route_visit_compliance",
      "sales.discount_management_effectiveness",
      "sales.commissions_due",
    ]);
    expect(overrides.onboarding_checklist.map((step) => step.id)).toEqual(
      DISTRIBUTION_TEMPLATE_MANIFEST.onboarding_steps.map((step) => step.id),
    );
    expect(overrides.enabled_modules).toContain("distribution");

    expect(await auditActions(distTenant, "industry.template.applied")).toBe(1);

    // -- the derived config: field/settle groups + van-sales terminology --
    resetConfigurationCache();
    const config = await withTenant(distTenant, () => resolver.resolveTenantStatic(distTenant));
    expect(config.ui.navigation).toEqual(["field", "settle"]);
    expect(config.ui.terminology["route.route"]).toEqual({ en: "Route", ar: "خط السير" });
    expect(config.ui.terminology["van.load_out"]).toEqual({
      en: "Load-out",
      ar: "التحميل الصباحي",
    });
    expect(config.ui.terminology["settlement.rep_settlement"]).toEqual({
      en: "Rep settlement",
      ar: "تسوية المندوب",
    });
    expect(config.policies["van_loadout_requires_transfer"]).toBe(true);
    expect(config.policies["settlement_required_daily"]).toBe(true);
    expect(config.policies["tier_price_automatic_by_partner"]).toBe(true);
    expect(config.layers.l8_installed.distribution).toBe(true);
  });

  it("re-apply of either new template is idempotent (zero writes)", async () => {
    const before = await withTenant(autoTenant, () => findAppliedStateRow());
    const seriesBefore = await tenantLevelSeries(autoTenant);

    const second = await withTenant(autoTenant, () =>
      applyService.apply(autoOwner, { templateKey: "industry.automotive", mode: "reapply" }),
    );
    expect(second.applied).toBe(false);
    expect(second.reason).toBe("already-applied");

    const after = await withTenant(autoTenant, () => findAppliedStateRow());
    expect(after!.appliedAt).toBe(before!.appliedAt);
    expect(await tenantLevelSeries(autoTenant)).toHaveLength(seriesBefore.length);
    expect(await auditActions(autoTenant, "industry.template.applied")).toBe(1);
  });

  it("switch safety (BR-038): retail → automotive is additive-only, zero data loss, and back again", async () => {
    const seriesBefore = await tenantLevelSeries(switchTenant);
    expect(seriesBefore.map((entry) => entry.docType)).toEqual([
      "credit_note",
      "pos_sale",
      "stock_transfer",
    ]);

    // The 0025 grants cover automotive's REQUIRED chain on business — the
    // switch needs no acknowledgement (nothing REQUIRED is phase-gated).
    const switched = await withTenant(switchTenant, () =>
      switchService.switch(switchOwner, { targetTemplateKey: "industry.automotive" }),
    );
    expect(switched.applied).toBe(true);

    const row = await withTenant(switchTenant, () => findAppliedStateRow());
    expect(row!.templateKey).toBe("industry.automotive");
    expect(row!.appliedManifestHash).toBe(KNOWN_HASHES["industry.automotive"]);

    // -- ZERO data loss: the item + the posted document are intact --------
    const su = await superuserClient();
    const invoice = await su.query<{ invoice_no: string; status: string }>(
      `SELECT invoice_no, status FROM sales_invoices WHERE id = $1`,
      [switchInvoice.invoiceId],
    );
    const item = await su.query<{ sku: string; track_batch: boolean }>(
      `SELECT sku, track_batch FROM items WHERE id = $1`,
      [switchItemId],
    );
    await su.end();
    expect(invoice.rows[0]).toEqual({ invoice_no: switchInvoice.invoiceNo, status: "POSTED" });
    expect(item.rows[0]).toEqual({ sku: "SWITCH-AUTO-ITEM-1", track_batch: false });

    // -- BR-038 archives: the retail snapshot is present, read-only -------
    expect(row!.archivedTerminology).toHaveLength(1);
    expect(row!.archivedTerminology[0]).toMatchObject({
      templateKey: "industry.retail",
      version: "1.0.0",
    });
    expect(row!.archivedTerminology[0]!.terminology["pos.terminal"]).toEqual({
      en: "Terminal",
      ar: "الطرفية",
    });
    expect(row!.archivedNavigation[0]).toMatchObject({
      templateKey: "industry.retail",
      version: "1.0.0",
    });
    expect(row!.archivedNavigation[0]!.groups).toHaveLength(2); // selling + stock
    expect(row!.archivedCapabilities[0]).toMatchObject({ templateKey: "industry.retail" });
    expect(
      row!.archivedCapabilities[0]!.capabilities.map((cap) => cap.capabilityId).sort(),
    ).toEqual(["cashier_shifts", "composite_kits", "free_goods_promo", "imei_tracking"]);

    // -- additive-only numbering: retail rows untouched, JC/QT/PO added ---
    const seriesAfter = await tenantLevelSeries(switchTenant);
    expect(seriesAfter.map((entry) => entry.docType)).toEqual([
      "credit_note",
      "job_card",
      "pos_sale",
      "purchase_order",
      "quotation",
      "stock_transfer",
    ]);
    expect(seriesAfter.find((entry) => entry.docType === "job_card")?.format).toBe(
      "JC-{yyyy}-{seq:5}",
    );
    expect(seriesAfter.find((entry) => entry.docType === "pos_sale")?.format).toBe(
      "POS-{branch}-{yy}{MM}-{seq:5}",
    ); // the retail row, byte-for-byte

    // -- the audited switch + the effective config ------------------------
    expect(await auditActions(switchTenant, "industry.template.switched")).toBe(1);
    resetConfigurationCache();
    const config = await withTenant(switchTenant, () =>
      resolver.resolveTenantStatic(switchTenant),
    );
    expect(config.layers.l1_template?.key).toBe("industry.automotive");
    expect(config.ui.navigation).toEqual(["workshop", "parts"]);
    expect(config.ui.terminology["svc.job_card"]).toEqual({ en: "Job card", ar: "بطاقة عمل" });

    // -- switching BACK always succeeds (nothing was destroyed) -----------
    const back = await withTenant(switchTenant, () =>
      switchService.switch(switchOwner, { targetTemplateKey: "industry.retail" }),
    );
    expect(back.applied).toBe(true);
    const restored = await withTenant(switchTenant, () => findAppliedStateRow());
    expect(restored!.templateKey).toBe("industry.retail");
    expect(restored!.appliedManifestHash).toBe(hashManifestJson(RETAIL_MANIFEST));
    // The archives hold BOTH template sets (append-only history, R2/R6).
    expect(restored!.archivedTerminology.map((entry) => entry.templateKey)).toEqual([
      "industry.retail",
      "industry.automotive",
    ]);
    // The automotive series REMAIN (append-only — R5).
    const seriesBack = await tenantLevelSeries(switchTenant);
    expect(seriesBack.map((entry) => entry.docType)).toContain("job_card");
    expect(seriesBack.map((entry) => entry.docType)).toContain("quotation");
    expect(seriesBack.map((entry) => entry.docType)).toContain("purchase_order");
    // The posted document is STILL untouched.
    const suBack = await superuserClient();
    const invoiceBack = await suBack.query<{ invoice_no: string; status: string }>(
      `SELECT invoice_no, status FROM sales_invoices WHERE id = $1`,
      [switchInvoice.invoiceId],
    );
    await suBack.end();
    expect(invoiceBack.rows[0]).toEqual({ invoice_no: switchInvoice.invoiceNo, status: "POSTED" });
    expect(await auditActions(switchTenant, "industry.template.switched")).toBe(2);
  });

  it("degraded entitlement: automotive without sales.job_cards blocks with the typed missing chain", async () => {
    await expect(
      withTenant(degradedTenant, () =>
        applyService.apply(degradedOwner, { templateKey: "industry.automotive", mode: "initial" }),
      ),
    ).rejects.toMatchObject({
      code: "configuration/template-prerequisites-blocked",
      templateKey: "industry.automotive",
      missingChain: ["sales.job_cards"],
      guidance: {
        ar: expect.stringContaining("sales.job_cards"),
        en: expect.stringContaining("sales.job_cards"),
      },
    });
    // Never silent AND never partial: zero rows were written.
    expect(await withTenant(degradedTenant, () => findAppliedStateRow())).toBeUndefined();
    const su = await superuserClient();
    const series = await su.query<{ n: string }>(
      `SELECT count(*)::text AS n FROM numbering_sequences WHERE tenant_id = $1`,
      [degradedTenant],
    );
    await su.end();
    expect(series.rows[0]!.n).toBe("0");
    expect(await auditActions(degradedTenant, "industry.template.applied")).toBe(0);
  });

  it("grocery tier liveness: customer_price_tiers is no longer phase-gated at PHASE-017", async () => {
    const result = await withTenant(groceryTenant, () =>
      applyService.apply(groceryOwner, { templateKey: "industry.grocery", mode: "initial" }),
    );
    expect(result.applied).toBe(true);
    // The "coming with PHASE-017" entry resolved AVAILABLE: the phase
    // shipped (CURRENT_SHIPPED_PHASE 17) + migration 0025 granted
    // distribution.customer_tiers to business — INCLUDED, not phase_gated.
    const tiers = result.prerequisiteCheck.capabilities.find(
      (capability) => capability.capabilityId === "customer_price_tiers",
    );
    expect(tiers).toMatchObject({
      status: "included",
      featureKeys: ["distribution.customer_tiers"],
    });
    expect(tiers!.phase).toBeUndefined();
    expect(result.prerequisiteCheck.requiresAcknowledgement).toBe(false);
    expect(result.prerequisiteCheck.missingChain).toEqual([]);

    // The checklist step renders visible (no coming-soon label), and the
    // tiers navigation item resolves live in the derived config.
    const row = await withTenant(groceryTenant, () => findAppliedStateRow());
    const overrides = parseAppliedOverrides(row!.overrides);
    expect(overrides.onboarding_checklist.find((step) => step.id === "tiers")).toMatchObject({
      status: "visible",
    });
    resetConfigurationCache();
    const config = await withTenant(groceryTenant, () =>
      resolver.resolveTenantStatic(groceryTenant),
    );
    expect(config.layers.l1_template?.key).toBe("industry.grocery");
    expect(config.layers.l4_entitlements.missing).toEqual([]);
    const selling = config.ui.navigation_tree.find((group) => group.id === "selling")!;
    expect(selling.items.map((item) => item.id)).toEqual(["pos", "tiers"]);
    expect(selling.items.find((item) => item.id === "tiers")!.phase_gated).toBeUndefined();
    // The tier capability's key is in the ACTIVE entitlement set (L4).
    expect(config.layers.l4_entitlements.active).toContain("distribution.customer_tiers");
    expect(hashManifestJson(GROCERY_MANIFEST)).toBe(
      "sha256:c6ef7c8a82bdc3817e46e9068892e550ea2bbacb1583d0954f5c86704e29525e",
    );
  });
});
