import { beforeAll, describe, expect, it } from "vitest";

import { GROCERY_MANIFEST, RETAIL_MANIFEST, hashManifestJson } from "@erp/contracts";

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
  seedPostingSubstrate,
  switchService,
  tenantLevelSeries,
  type PostingSubstrate,
} from "./template-fixtures";

/**
 * PHASE-015 §6 `template-switch.spec` — switch safety (industries/README
 * §8 #5; BR-038 additive-only): apply retail → create items + post
 * documents → switch to grocery → assert ZERO data loss (items/documents
 * intact), explicit tenant settings untouched, numbering append-only
 * (posted numbers unchanged; NEW series for grocery doc types), previous
 * terminology + navigation + capabilities archived read-only, conflicts
 * recorded, and switching BACK always succeeds (nothing was destroyed).
 */

/** The switch-safety tenant (private to this spec). */
let T = "";
let owner = "";
let substrate: PostingSubstrate;
let postedInvoice: { invoiceId: string; invoiceNo: string; journalEntryId: string };
let itemId = "";

beforeAll(async () => {
  const provisioned = await provisionBusinessTenant("switch-safety", "industry.retail");
  T = provisioned.tenantId;
  owner = provisioned.ownerId;

  // The pre-switch business data: a posted invoice + an item + an explicit
  // tenant setting the switch must never touch.
  substrate = await seedPostingSubstrate(T, owner, "SWITCH");
  const itemsStore = await import("../../modules/items/infrastructure/items.store");
  itemId = await withTenant(T, async () => {
    const uoms = await itemsStore.listUoms();
    const pcs = uoms.find((uom) => uom.code === "PCS")!;
    const created = await itemsStore.insertItem({
      sku: "SWITCH-ITEM-1",
      name: "Switch safety item",
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
      basePrice: "25.000000",
    });
    return created.id;
  });
  postedInvoice = await postServiceInvoice(substrate, "pre-switch invoice");

  const su = await superuserClient();
  await su.query(
    `INSERT INTO tenant_settings (id, tenant_id, key, value, updated_at)
     VALUES (gen_random_uuid(), $1, 'sales.cash_autopost', 'false'::jsonb, now())
     ON CONFLICT (tenant_id, key) DO NOTHING`,
    [T],
  );
  await su.end();

  // Apply retail (the switch's "from" template).
  const applied = await withTenant(T, () =>
    applyService.apply(owner, { templateKey: "industry.retail", mode: "initial" }),
  );
  expect(applied.applied).toBe(true);
});

describe("template-switch — additive-only safety (README §8 #5)", () => {
  it("the pre-switch state: retail applied, explicit L5 setting, posted document", async () => {
    resetConfigurationCache();
    const config = await withTenant(T, () => resolver.resolveTenantStatic(T));
    expect(config.layers.l1_template?.key).toBe("industry.retail");
    // The explicit L5 row beats the retail default (BR-038 R8 baseline).
    expect(config.policies["sales.cash_autopost"]).toBe(false);
    expect(config.ui.navigation).toEqual(["selling", "stock"]);
  });

  it("preview computes the what-will-change diff with NO writes (R9)", async () => {
    const before = await withTenant(T, () => findAppliedStateRow());
    const seriesBefore = await tenantLevelSeries(T);

    const diff = await withTenant(T, () =>
      switchService.preview(owner, { targetTemplateKey: "industry.grocery", mode: "switch" }),
    );

    // Added capabilities split per §4: at PHASE-019 the whole grocery set
    // is LIVE on the business plan (the 0025 grants cover the tier + promo
    // keys; the 0026 grants put manufacturing.qc on business; the 0027
    // grants put the crm set on business too) — even the OPTIONAL
    // qc_inspections entry resolves INCLUDED; nothing labels coming-soon
    // any more. Re-checked at the 019 bump: ZERO R9 pins moved (grocery's
    // set was already fully live at 018; the 0027 crm keys touch no grocery
    // capability).
    expect(diff.fromTemplate).toEqual({ key: "industry.retail", version: "1.0.0" });
    expect(diff.toTemplate).toEqual({
      key: "industry.grocery",
      version: "1.0.0",
      manifestHash: hashManifestJson(GROCERY_MANIFEST),
    });
    expect(
      diff.addedCapabilities.included.find((cap) => cap.capabilityId === "expiry_tracking_fefo"),
    ).toBeDefined();
    expect(
      diff.addedCapabilities.included.find((cap) => cap.capabilityId === "customer_price_tiers"),
    ).toBeDefined();
    // The grocery qc_inspections entry (OPTIONAL, manufacturing.qc) moved
    // phaseGated → included with the 0026 plan grants: missing = [] ⇒ the
    // §4 decision tree classifies it included (and CURRENT_SHIPPED_PHASE 18
    // lifted the gate regardless).
    expect(
      diff.addedCapabilities.included.find((cap) => cap.capabilityId === "qc_inspections"),
    ).toMatchObject({ featureKeys: ["manufacturing.qc"] });
    expect(diff.addedCapabilities.phaseGated).toEqual([]);
    expect(diff.addedCapabilities.optionalMissing).toEqual([]);
    // Archived: retail-only capabilities (IMEI tracking, landed costs).
    expect(diff.archivedCapabilities.map((cap) => cap.capabilityId).sort()).toEqual([
      "imei_tracking",
      "landed_costs",
    ]);
    // Renamed labels: retail's POS-sale label falls back to the glossary.
    expect(diff.renamedLabels).toContainEqual({
      termKey: "doc.sales_invoice_pos",
      from: { en: "POS sale", ar: "بيع نقطة البيع" },
      to: { en: "Sales invoice", ar: "فاتورة البيع" },
    });
    // New series: ONLY goods_receipt — every other grocery doc type already
    // carries a series row (sales_invoice's is the POSTED invoice's
    // branch-scoped acquisition row; the apply correctly skipped it, R5).
    expect(diff.newNumberingSeries.map((entry) => entry.docType)).toEqual(["goods_receipt"]);
    expect(diff.keptNumberingSeries.map((entry) => entry.docType).sort()).toEqual([
      "credit_note",
      "pos_sale",
      "sales_invoice",
    ]);
    // Inventory defaults change old → new, marked new-items-only (R3).
    expect(diff.inventoryDefaultChanges).toContainEqual({
      key: "fefo_picking",
      from: false,
      to: true,
      note: "new-items-only",
    });
    expect(diff.inventoryDefaultChanges).toContainEqual({
      key: "default_track_batch",
      from: false,
      to: true,
      note: "new-items-only",
    });
    // Report pins: grocery adds expiry reports; retail's POS/IMEI pins archive.
    expect(diff.reportPinChanges).toEqual({
      added: ["inventory.expiry_list", "grocery.expiry_writeoff"],
      removed: ["pos.sales_by_terminal", "retail.imei_register"],
    });
    // The acknowledgement contract: NO REQUIRED-phase-gated differences
    // remain at PHASE-019 — customer_price_tiers went live at 017 (the
    // 0025 grant + the phase bump), qc_inspections at 018 (the 0026 grant
    // + that bump), and the 019 bump moves nothing here (no grocery
    // capability carries a crm.* key), so this switch needs no
    // acknowledgement.
    expect(diff.acknowledgementRequired).toBe(false);
    expect(diff.acknowledgementPhases).toEqual([]);
    expect(diff.blocked).toBe(false);

    // NO WRITES: the applied row and the series registry are untouched.
    const after = await withTenant(T, () => findAppliedStateRow());
    expect(after).toEqual(before);
    expect(await tenantLevelSeries(T)).toHaveLength(seriesBefore.length);
  });

  it("switches additively to grocery with NO acknowledgement (PHASE-017: the tier capability went live) — zero data loss", async () => {
    // At CURRENT_SHIPPED_PHASE 17 + the 0025 grants, no REQUIRED capability
    // of the grocery target is phase-gated any more — the acknowledgement
    // leg disappeared with the phase bump, and the switch proceeds plainly.
    const result = await withTenant(T, () =>
      switchService.switch(owner, { targetTemplateKey: "industry.grocery" }),
    );
    expect(result.applied).toBe(true);

    const row = await withTenant(T, () => findAppliedStateRow());
    expect(row!.templateKey).toBe("industry.grocery");
    expect(row!.appliedVersion).toBe("1.0.0");
    expect(row!.appliedManifestHash).toBe(hashManifestJson(GROCERY_MANIFEST));
    expect(row!.status).toBe("ACTIVE");

    // -- ZERO data loss: the item + the posted document are intact --------
    const su = await superuserClient();
    const invoice = await su.query<{ invoice_no: string; status: string }>(
      `SELECT invoice_no, status FROM sales_invoices WHERE id = $1`,
      [postedInvoice.invoiceId],
    );
    const item = await su.query<{ sku: string; track_batch: boolean }>(
      `SELECT sku, track_batch FROM items WHERE id = $1`,
      [itemId],
    );
    await su.end();
    expect(invoice.rows[0]).toEqual({ invoice_no: postedInvoice.invoiceNo, status: "POSTED" });
    expect(item.rows[0]).toEqual({ sku: "SWITCH-ITEM-1", track_batch: false });

    // -- the journal is still balanced (the cheap invariant tie) ----------
    const lines = await withTenant(T, async () => {
      const journal = await import("../../modules/accounting/infrastructure/journal.store");
      return journal.listLines(postedInvoice.journalEntryId);
    });
    const debits = lines
      .filter((line) => line.direction === "DEBIT")
      .reduce((sum, line) => sum + Number(line.amount), 0);
    const credits = lines
      .filter((line) => line.direction === "CREDIT")
      .reduce((sum, line) => sum + Number(line.amount), 0);
    expect(debits).toBe(100);
    expect(credits).toBe(100);

    // -- explicit tenant settings untouched (R8: L5 wins) -----------------
    const settings = await withTenant(T, async () => {
      const suSettings = await superuserClient();
      const rows = await suSettings.query<{ key: string; value: unknown }>(
        `SELECT key, value FROM tenant_settings WHERE tenant_id = $1 ORDER BY key`,
        [T],
      );
      await suSettings.end();
      return rows.rows;
    });
    expect(settings.find((setting) => setting.key === "sales.cash_autopost")?.value).toBe(false);
    resetConfigurationCache();
    const config = await withTenant(T, () => resolver.resolveTenantStatic(T));
    expect(config.layers.l1_template?.key).toBe("industry.grocery");
    expect(config.policies["sales.cash_autopost"]).toBe(false); // L5 survives the switch
    expect(config.ui.navigation).toEqual(["selling", "expiry"]);
    expect(config.policies["inventory.fefo_for_expiry_items"]).toBe(true); // grocery default (unset key)

    // -- numbering append-only: posted numbers unchanged, NEW series added
    expect(invoice.rows[0]!.invoice_no).toBe(postedInvoice.invoiceNo);
    const series = await tenantLevelSeries(T);
    expect(series.map((entry) => entry.docType).sort()).toEqual([
      "credit_note",
      "goods_receipt", // the NEW grocery series (R5 append-only)
      "pos_sale",
      "stock_transfer",
    ]);
    // sales_invoice stays branch-scoped ONLY (the posted invoice's own row
    // — the retail apply skipped the doc type; the switch never mutates it).
    expect(series.find((entry) => entry.docType === "sales_invoice")).toBeUndefined();
    // The pre-existing registry rows keep their formats + counters (never
    // mutated — the tenant-level pos_sale row is exactly what apply seeded).
    expect(series.find((entry) => entry.docType === "pos_sale")?.format).toBe(
      "POS-{branch}-{yy}{MM}-{seq:5}",
    );

    // -- archives: the retail set, read-only (R2/R6) ----------------------
    expect(row!.archivedTerminology).toHaveLength(1);
    expect(row!.archivedTerminology[0]).toMatchObject({
      templateKey: "industry.retail",
      version: "1.0.0",
    });
    expect(row!.archivedTerminology[0]!.terminology["doc.sales_invoice_pos"]).toEqual({
      en: "POS sale",
      ar: "بيع نقطة البيع",
    });
    expect(row!.archivedNavigation[0]).toMatchObject({
      templateKey: "industry.retail",
      version: "1.0.0",
    });
    expect(row!.archivedNavigation[0]!.groups).toHaveLength(2); // selling + stock
    expect(row!.archivedCapabilities[0]).toMatchObject({ templateKey: "industry.retail" });
    expect(
      row!.archivedCapabilities[0]!.capabilities.map((cap) => cap.capabilityId).sort(),
    ).toEqual(["imei_tracking", "landed_costs"]);

    // -- conflicts recorded (§7: most-recently-applied wins, unset only) --
    const fefoConflict = row!.conflictNotes.find((note) => note.key === "fefo_picking");
    expect(fefoConflict).toMatchObject({
      kind: "inventory_default",
      previousTemplate: "industry.retail",
      newTemplate: "industry.grocery",
      from: false,
      to: true,
      resolution: "most-recently-applied-wins-unset-only",
    });

    // -- the audited switch carries the FULL diff as the after-state -----
    expect(await auditActions(T, "industry.template.switched")).toBe(1);

    // Tenant terminology additions survived (none were added here — the
    // map stays empty, ready for them).
    expect(parseAppliedOverrides(row!.overrides).terminology).toEqual({});
  });

  it("switching BACK to retail always succeeds (nothing was destroyed)", async () => {
    const result = await withTenant(T, () =>
      switchService.switch(owner, { targetTemplateKey: "industry.retail", acknowledged: true }),
    );
    expect(result.applied).toBe(true);

    const row = await withTenant(T, () => findAppliedStateRow());
    expect(row!.templateKey).toBe("industry.retail");
    expect(row!.appliedManifestHash).toBe(hashManifestJson(RETAIL_MANIFEST));
    // The archives now hold BOTH template sets (append-only history).
    expect(row!.archivedTerminology.map((entry) => entry.templateKey)).toEqual([
      "industry.retail",
      "industry.grocery",
    ]);
    // The grocery goods_receipt series REMAINS (append-only — R5).
    const series = await tenantLevelSeries(T);
    expect(series.map((entry) => entry.docType)).toContain("goods_receipt");
    // The posted document is STILL untouched.
    const su = await superuserClient();
    const invoice = await su.query<{ invoice_no: string; status: string }>(
      `SELECT invoice_no, status FROM sales_invoices WHERE id = $1`,
      [postedInvoice.invoiceId],
    );
    await su.end();
    expect(invoice.rows[0]).toEqual({ invoice_no: postedInvoice.invoiceNo, status: "POSTED" });
    // And the effective config is retail again, settings intact.
    resetConfigurationCache();
    const config = await withTenant(T, () => resolver.resolveTenantStatic(T));
    expect(config.layers.l1_template?.key).toBe("industry.retail");
    expect(config.policies["sales.cash_autopost"]).toBe(false);
  });

  it("extend applies a second template additively (primary stays)", async () => {
    // Retail is primary; extend with grocery (already archived once — the
    // extension is a fresh additive record, distinct from the switch).
    const result = await withTenant(T, () =>
      switchService.extend(owner, { templateKey: "industry.grocery", acknowledged: true }),
    );
    expect(result.applied).toBe(true);

    const row = await withTenant(T, () => findAppliedStateRow());
    // The PRIMARY stays retail; the extension records on overrides.
    expect(row!.templateKey).toBe("industry.retail");
    const overrides = parseAppliedOverrides(row!.overrides);
    expect(overrides.applied_extensions).toHaveLength(1);
    expect(overrides.applied_extensions[0]).toMatchObject({
      templateKey: "industry.grocery",
      version: "1.0.0",
      manifestHash: hashManifestJson(GROCERY_MANIFEST),
    });
    // Additive merges: the grocery report pins joined retail's (union).
    expect(overrides.report_pins.map((pin) => pin.report_key).sort()).toEqual([
      "grocery.expiry_writeoff",
      "inventory.expiry_list",
      "inventory.stock_valuation",
      "pos.sales_by_hour",
      "pos.sales_by_terminal",
      "retail.imei_register",
    ]);
    // The effective config still resolves the PRIMARY manifest (L1 = one
    // template); the extension's labels ride the tenant-additions map for
    // keys retail does not set (additive only — no relabel of retail's).
    resetConfigurationCache();
    const config = await withTenant(T, () => resolver.resolveTenantStatic(T));
    expect(config.layers.l1_template?.key).toBe("industry.retail");
    expect(config.ui.terminology["inventory.writeoff"]).toEqual({
      en: "Write-off",
      ar: "الإعدام",
    }); // grocery's label, additive
    expect(config.ui.terminology["doc.sales_invoice_pos"]).toEqual({
      en: "POS sale",
      ar: "بيع نقطة البيع",
    }); // retail's label, unchanged
    expect(await auditActions(T, "industry.template.extended")).toBe(1);

    // Idempotent extend: a second extend with the same template is a no-op.
    const again = await withTenant(T, () =>
      switchService.extend(owner, { templateKey: "industry.grocery", acknowledged: true }),
    );
    expect(again.applied).toBe(false);
    expect(again.reason).toBe("already-applied");
  });

  it("apply() on an applied tenant with a DIFFERENT template is the typed redirect to switch", async () => {
    const { TemplateAlreadyAppliedError } = await import(
      "../../modules/configuration/application/apply/apply-service"
    );
    await expect(
      withTenant(T, () =>
        applyService.apply(owner, { templateKey: "industry.restaurant", mode: "initial" }),
      ),
    ).rejects.toBeInstanceOf(TemplateAlreadyAppliedError);
  });

  it("blocked prerequisites on switch fail with the typed chain (R10)", async () => {
    const su = await superuserClient();
    await su.query(`DELETE FROM entitlements WHERE tenant_id = $1 AND feature_key = $2`, [
      T,
      "inventory.batch_tracking",
    ]);
    await su.end();
    resetConfigurationCache();

    await expect(
      withTenant(T, () =>
        switchService.switch(owner, {
          targetTemplateKey: "industry.grocery",
          acknowledged: true,
        }),
      ),
    ).rejects.toMatchObject({
      code: "configuration/template-prerequisites-blocked",
      missingChain: ["inventory.batch_tracking"],
    });
    // The applied template is UNCHANGED (retail primary + grocery extension).
    const row = await withTenant(T, () => findAppliedStateRow());
    expect(row!.templateKey).toBe("industry.retail");

    // Repair and confirm the switch would pass again (a satisfiable set).
    const suGrant = await superuserClient();
    await suGrant.query(
      `INSERT INTO entitlements (id, tenant_id, feature_key, source, expires_at)
       VALUES (gen_random_uuid(), $1, 'inventory.batch_tracking', 'MANUAL', NULL)
       ON CONFLICT (tenant_id, feature_key) DO NOTHING`,
      [T],
    );
    await suGrant.end();
    resetConfigurationCache();
    const check = await withTenant(T, () =>
      switchService.preview(owner, { targetTemplateKey: "industry.grocery", mode: "switch" }),
    );
    expect(check.blocked).toBe(false);
    expect(check.missingChain).toEqual([]);
  });
});
