import { beforeAll, describe, expect, it } from "vitest";

import {
  FOOD_MANUFACTURING_TEMPLATE_MANIFEST,
  RESTAURANT_MANIFEST,
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
  provisionBusinessTenant,
  resolver,
  revokeEntitlement,
  seedPostingSubstrate,
  switchService,
  tenantLevelSeries,
  type PostingSubstrate,
} from "./template-fixtures";

/**
 * PHASE-018 T2 db spec — the food manufacturing template through the
 * UNMODIFIED PHASE-015 engine (industries/README §8 #3/#5/#7; the seven
 * per-template requirements):
 *
 * - `industry.food_manufacturing` v1.0.0 applies cleanly to a fresh
 *   business-plan tenant (the 0026 plan grants cover the manufacturing
 *   REQUIRED chain at CURRENT_SHIPPED_PHASE 18): the applied row pins the
 *   KNOWN migration-0026 content hash, the append-only series registry
 *   lands (PRD- production orders), report pins + bilingual onboarding
 *   checklist + enabled modules materialize (manufacturing module ON), the
 *   apply is audited, and the derived navigation/terminology/policies
 *   resolve live (production/trace, الوصفة (قائمة المواد), qc_gate
 *   required).
 * - Re-apply is idempotent (zero writes).
 * - Switch safety (BR-038): restaurant → food_manufacturing is
 *   additive-only — posted POS history survives byte-identical, series are
 *   the union (restaurant rows untouched, PRD-/DLV- appended), archived_*
 *   snapshots for the restaurant set, switching BACK always succeeds, the
 *   archives hold BOTH templates, and the switches are audited.
 * - Degraded entitlement (§8 #7): a tenant without `manufacturing.qc`
 *   applying food_manufacturing gets the typed prerequisite error with the
 *   exact missing chain — never a silent back-office apply; restaurant
 *   WITHOUT the manufacturing add-on keeps its OPTIONAL bom_production
 *   capability hidden cleanly (PHASE-018 shipped — hidden, not phase-gated);
 *   a starter-plan tenant blocks with the full chain.
 * - L5 beats L1 (BR-038 R8): an explicit `manufacturing.qc_gate` tenant
 *   setting overrides the manifest's "required" default.
 */

/** KNOWN hash — `pnpm validate:manifests` on the six-template set (the
 *  constant is byte-identical to the migration 0026 registry seed and the
 *  docs mirror docs/industries/templates/manifests/
 *  manifest.food_manufacturing.json). */
const KNOWN_HASH = "sha256:e62f1bf2d709e226f203702259f1e51a1829df3d8e9be7031f658c026659a5da";

/** The 0026 plan-grant manufacturing set (the "manufacturing add-on"). */
const MANUFACTURING_KEYS: readonly string[] = [
  "manufacturing.bom",
  "manufacturing.production_orders",
  "manufacturing.wip",
  "manufacturing.costing",
  "manufacturing.scrap",
  "manufacturing.batch_genealogy",
  "manufacturing.qc",
];

// -- tenant A: food_manufacturing apply ------------------------------------
let foodTenant = "";
let foodOwner = "";

// -- tenant B: switch safety (restaurant → food_manufacturing → restaurant) -
let switchTenant = "";
let switchOwner = "";
let switchPos!: {
  invoiceId: string;
  invoiceNo: string;
  journalEntryId: string;
  itemId: string;
  settlementLines: { direction: string; amount: string }[];
};

// -- tenant C: degraded entitlement (no manufacturing.qc) -------------------
let degradedTenant = "";
let degradedOwner = "";

// -- tenant D: restaurant without the manufacturing add-on ------------------
let restaurantTenant = "";
let restaurantOwner = "";

// -- tenant E: starter-plan degradation -------------------------------------
let starterTenant = "";
let starterOwner = "";

beforeAll(async () => {
  const food = await provisionBusinessTenant("food-018", "industry.food_manufacturing");
  foodTenant = food.tenantId;
  foodOwner = food.ownerId;

  // The switch-safety tenant: restaurant (POS-first) applied over REAL POS
  // history — a posted counter sale through the POS channel.
  const switched = await provisionBusinessTenant("switch-food", "industry.restaurant");
  switchTenant = switched.tenantId;
  switchOwner = switched.ownerId;
  switchPos = await seedPosHistory(switchTenant, switchOwner, "SW018");
  const appliedRestaurant = await withTenant(switchTenant, () =>
    applyService.apply(switchOwner, { templateKey: "industry.restaurant", mode: "initial" }),
  );
  expect(appliedRestaurant.applied).toBe(true);

  const degraded = await provisionBusinessTenant("food-degraded", "industry.food_manufacturing");
  degradedTenant = degraded.tenantId;
  degradedOwner = degraded.ownerId;
  // The QC capability's key off the entitlement set (0026 granted it to
  // business; the revoke simulates the pre-grant / downgraded plan).
  await revokeEntitlement(degradedTenant, "manufacturing.qc");

  const restaurant = await provisionBusinessTenant("restaurant-no-mfg", "industry.restaurant");
  restaurantTenant = restaurant.tenantId;
  restaurantOwner = restaurant.ownerId;
  // Restaurant WITHOUT the manufacturing add-on: the whole 7-key set off
  // (revoking only bom/production_orders would strand wip/costing/scrap on
  // a broken closure — the clean add-on removal keeps BR-040 valid).
  for (const key of MANUFACTURING_KEYS) {
    await revokeEntitlement(restaurantTenant, key);
  }

  const starter = await provisionBusinessTenant("food-starter", "industry.food_manufacturing");
  starterTenant = starter.tenantId;
  starterOwner = starter.ownerId;
  // Re-materialize the plan as starter (the real flow — no manufacturing
  // entitlements at all).
  const { EntitlementsService } = await import(
    "../../modules/tenancy/application/entitlements-service"
  );
  const { AuditService } = await import("../../modules/audit/api/audit");
  const { DrizzleAuditStore } = await import("../../modules/audit/infrastructure/drizzle-audit.store");
  const entitlements = new EntitlementsService(new AuditService(new DrizzleAuditStore()));
  await withTenant(starterTenant, () =>
    entitlements.assignPlan(starterOwner, { planKey: "starter", source: "PLAN", expiresAt: null }),
  );
  resetConfigurationCache();
});

/**
 * Seed REAL POS history on the switch tenant (the restaurant template's own
 * data essence): till + terminal + a stocked item, then one posted counter
 * sale through the POS channel (settlement + COGS journals, POS- number,
 * cash movement). Built on the template substrate; returns the byte-level
 * snapshot the switch must never disturb.
 *
 * Phased deliberately: every cross-connection reference (the superuser
 * opening-balance + terminal inserts) must see COMMITTED rows, so each
 * tenant-scoped transaction closes before the superuser leg runs.
 */
async function seedPosHistory(
  tenantId: string,
  ownerId: string,
  slug: string,
): Promise<{
  invoiceId: string;
  invoiceNo: string;
  journalEntryId: string;
  itemId: string;
  settlementLines: { direction: string; amount: string }[];
}> {
  const substrate: PostingSubstrate = await seedPostingSubstrate(tenantId, ownerId, slug);

  // Phase 1 (tenant tx): purposes + warehouse + the stocked-to-be item.
  const seeded = await withTenant(tenantId, async () => {
    const { findAccountByCode, findActivePurpose } = await import(
      "../../modules/accounting/infrastructure/accounting.store"
    );
    const tenancyStore = await import("../../modules/tenancy/infrastructure/tenancy.store");
    const itemsStore = await import("../../modules/items/infrastructure/items.store");
    const { WarehouseService } = await import("../../modules/inventory/application/warehouse-service");
    const { AuditService } = await import("../../modules/audit/api/audit");
    const { DrizzleAuditStore } = await import("../../modules/audit/infrastructure/drizzle-audit.store");

    const audit = new AuditService(new DrizzleAuditStore());
    const mapPurpose = async (purposeKey: string, code: string) => {
      const existing = await findActivePurpose(purposeKey);
      if (existing !== undefined) return existing.accountId;
      const account = await findAccountByCode(code);
      await tenancyStore.insertAccountPurpose({
        purposeKey,
        accountId: account!.id,
        activeFrom: "2025-12-01",
      });
      return account!.id;
    };
    await mapPurpose("INVENTORY", "1140");
    await mapPurpose("COGS", "5100");
    await mapPurpose("VAT_PAYABLE", "2120");
    await mapPurpose("OPENING_EQUITY", "3100");

    const warehouses = new WarehouseService(audit);
    const warehouse = await warehouses.create({
      branchId: substrate.branchId,
      code: `SW-WH-${slug}`,
      name: "Switch warehouse",
      nameAr: "مستودع التبديل",
      inventoryAccountId: null,
      note: null,
      actorId: ownerId,
    });
    const uoms = await itemsStore.listUoms();
    const pcs = uoms.find((uom) => uom.code === "PCS")!;
    const item = await itemsStore.insertItem({
      sku: `SWITCH-FOOD-ITEM-${slug}`,
      name: "Switch safety pastry",
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
    return { warehouseId: warehouse.id, itemId: item.id };
  });

  // Phase 2 (superuser, committed rows visible): the opening-balance draft.
  const su = await superuserClient();
  await su.query(
    `INSERT INTO opening_balance_docs (id, tenant_id, kind, item_id, qty, unit_cost, currency_code, status)
     VALUES (gen_random_uuid(), $1, 'STOCK', $2, 100, 30.000000, 'SAR', 'DRAFT')`,
    [tenantId, seeded.itemId],
  );

  // Phase 3 (tenant tx): post the opening stock (the W-1 shape).
  const cashAccountId = await withTenant(tenantId, async () => {
    const { OpeningStockService } = await import(
      "../../modules/inventory/application/opening-stock-service"
    );
    const { AccountService } = await import("../../modules/treasury/application/account-service");
    const { PostingService } = await import("../../modules/accounting/application/posting-service");
    const { PartnerSubledgerService } = await import(
      "../../modules/partners/application/subledger-service"
    );
    const { findAccountByCode } = await import(
      "../../modules/accounting/infrastructure/accounting.store"
    );
    const { AuditService } = await import("../../modules/audit/api/audit");
    const { DrizzleAuditStore } = await import("../../modules/audit/infrastructure/drizzle-audit.store");

    const audit = new AuditService(new DrizzleAuditStore());
    const openingStock = new OpeningStockService(
      audit,
      new PostingService(audit, new PartnerSubledgerService()),
    );
    await openingStock.post({ warehouseId: seeded.warehouseId, actorId: ownerId });

    // The till (the G-02 cash leg).
    const cashGl = await findAccountByCode("1111");
    const treasuryAccounts = new AccountService(audit);
    const cash = await treasuryAccounts.open({
      name: `Switch till ${slug}`,
      nameAr: null,
      type: "CASH",
      accountId: cashGl!.id,
      branchId: null,
      currencyCode: "SAR",
      actorId: ownerId,
    });
    return cash.id;
  });
  await su.end();

  // Phase 4 (superuser): the terminal bound to the branch/till/warehouse.
  const terminalId = await (async () => {
    const client = await superuserClient();
    const row = await client.query<{ id: string }>(
      `INSERT INTO pos_terminals (id, tenant_id, code, name, branch_id, cash_account_id,
                                  warehouse_id, receipt_size, status)
       VALUES (gen_random_uuid(), $1, 'T1', 'Switch terminal', $2, $3, $4, '80mm', 'ACTIVE')
       RETURNING id::text`,
      [tenantId, substrate.branchId, cashAccountId, seeded.warehouseId],
    );
    await client.end();
    return row.rows[0]!.id;
  })();

  // Phase 5 (tenant tx): the posted counter sale — 2 × 50, NOT_SUBJECT (no
  // VAT), CASH tender — + the settlement-journal snapshot.
  return withTenant(tenantId, async () => {
    const { SalesInvoiceService } = await import("../../modules/sales/application/invoices");
    const { CreditNoteService } = await import("../../modules/sales/application/credit-notes");
    const { PosSaleService } = await import(
      "../../modules/sales/application/pos-channel/pos-sale-service"
    );
    const { PostingService } = await import("../../modules/accounting/application/posting-service");
    const { NumberingService } = await import("../../modules/accounting/application/numbering-service");
    const { TaxResolverService } = await import("../../modules/tax/application/tax-resolver-service");
    const { PartnerSubledgerService } = await import(
      "../../modules/partners/application/subledger-service"
    );
    const { AuditService } = await import("../../modules/audit/api/audit");
    const { DrizzleAuditStore } = await import("../../modules/audit/infrastructure/drizzle-audit.store");
    const journal = await import("../../modules/accounting/infrastructure/journal.store");

    const audit = new AuditService(new DrizzleAuditStore());
    const posting = new PostingService(audit, new PartnerSubledgerService());
    const numbering = new NumberingService(audit);
    const taxResolver = new TaxResolverService();
    const posSales = new PosSaleService(
      audit,
      new SalesInvoiceService(audit, posting, numbering, taxResolver),
      new CreditNoteService(audit, posting, numbering, taxResolver),
    );
    const sale = await posSales.submit({
      terminalId,
      customerId: null,
      lines: [
        {
          itemId: seeded.itemId,
          qty: "2",
          unitPrice: "50.000000",
          taxCodeId: substrate.notSubjectTaxCodeId,
        },
      ],
      tenders: [{ method: "CASH", amount: "100.0000" }],
      orderType: "COUNTER",
      actorId: ownerId,
    });
    expect(sale.invoice.status).toBe("POSTED");
    expect(sale.invoice.invoiceNo).toMatch(/^POS-/);

    const lines = await journal.listLines(sale.invoice.postedJournalId!);
    return {
      invoiceId: sale.invoice.id,
      invoiceNo: sale.invoice.invoiceNo!,
      journalEntryId: sale.invoice.postedJournalId!,
      itemId: seeded.itemId,
      settlementLines: lines.map((line) => ({ direction: line.direction, amount: line.amount })),
    };
  });
}

describe("templates-018 — food_manufacturing through the PHASE-015 engine", () => {
  it("industry.food_manufacturing v1.0.0 applies cleanly to a fresh business tenant", async () => {
    const result = await withTenant(foodTenant, () =>
      applyService.apply(foodOwner, { templateKey: "industry.food_manufacturing", mode: "initial" }),
    );
    expect(result.applied).toBe(true);
    expect(result.templateKey).toBe("industry.food_manufacturing");
    expect(result.version).toBe("1.0.0");
    expect(result.manifestHash).toBe(hashManifestJson(FOOD_MANUFACTURING_TEMPLATE_MANIFEST));
    expect(result.manifestHash).toBe(KNOWN_HASH);

    // The PHASE-018 manufacturing set resolves LIVE (phase 18 shipped + the
    // 0026 grants) — the three manufacturing capabilities INCLUDED, nothing
    // gated, no acknowledgement.
    for (const capabilityId of ["bom_production", "qc_inspections", "batch_genealogy"]) {
      const capability = result.prerequisiteCheck.capabilities.find(
        (candidate) => candidate.capabilityId === capabilityId,
      );
      expect(capability, capabilityId).toMatchObject({ status: "included" });
    }
    expect(
      result.prerequisiteCheck.capabilities.find(
        (candidate) => candidate.capabilityId === "expiry_tracking_fefo",
      ),
    ).toMatchObject({ status: "included" });
    expect(result.prerequisiteCheck.status).toBe("ok");
    expect(result.prerequisiteCheck.requiresAcknowledgement).toBe(false);

    // -- the applied row: key / version / KNOWN 0026 seed hash ------------
    const row = await withTenant(foodTenant, () => findAppliedStateRow());
    expect(row).toBeDefined();
    expect(row!.templateKey).toBe("industry.food_manufacturing");
    expect(row!.appliedVersion).toBe("1.0.0");
    expect(row!.status).toBe("ACTIVE");
    expect(row!.appliedBy).toBe(foodOwner);
    expect(row!.appliedManifestHash).toBe(hashManifestJson(FOOD_MANUFACTURING_TEMPLATE_MANIFEST));
    expect(row!.appliedManifestHash).toBe(KNOWN_HASH);

    // -- series registry: every food doc type (PRD- production orders) ----
    const series = await tenantLevelSeries(foodTenant);
    expect(series.map((entry) => entry.docType)).toEqual(
      Object.keys(FOOD_MANUFACTURING_TEMPLATE_MANIFEST.document_numbering_defaults).sort(),
    );
    const productionOrder = series.find((entry) => entry.docType === "production_order")!;
    expect(productionOrder.format).toBe("PRD-{yyyy}-{seq:5}");
    expect(productionOrder.nextValue).toBe("1"); // acquisition-inert registry row (R5)
    expect(series.find((entry) => entry.docType === "goods_receipt")?.format).toBe("GRN-{yyyy}-{seq:6}");
    expect(series.find((entry) => entry.docType === "delivery_note")?.format).toBe("DLV-{yyyy}-{seq:5}");

    // -- overrides: report pins + checklist + modules ----------------------
    const overrides = parseAppliedOverrides(row!.overrides);
    expect(overrides.report_pins.map((pin) => pin.report_key)).toEqual(
      FOOD_MANUFACTURING_TEMPLATE_MANIFEST.report_defaults.map((pin) => pin.report_key),
    );
    expect(overrides.report_pins[0]).toMatchObject({
      report_key: "manufacturing.production_cost",
      pinned: true,
      dashboard: true,
      default_period: "this_month",
    });
    expect(overrides.onboarding_checklist.map((step) => step.id)).toEqual(
      FOOD_MANUFACTURING_TEMPLATE_MANIFEST.onboarding_steps.map((step) => step.id),
    );
    // The outlet step's pos.sales key is entitled on business — everything
    // visible (LIVE at PHASE-018).
    expect(overrides.onboarding_checklist.every((step) => step.status === "visible")).toBe(true);
    expect(overrides.enabled_modules).toEqual(
      FOOD_MANUFACTURING_TEMPLATE_MANIFEST.default_modules_enabled,
    );
    expect(overrides.enabled_modules).toContain("manufacturing");

    // -- audited ------------------------------------------------------------
    expect(await auditActions(foodTenant, "industry.template.applied")).toBe(1);

    // -- the derived config: production/trace live, terminology AR + EN ---
    resetConfigurationCache();
    const config = await withTenant(foodTenant, () => resolver.resolveTenantStatic(foodTenant));
    expect(config.layers.l1_template?.key).toBe("industry.food_manufacturing");
    expect(config.layers.l4_entitlements.missing).toEqual([]);
    expect(config.ui.navigation).toEqual(["production", "trace"]);
    const production = config.ui.navigation_tree.find((group) => group.id === "production")!;
    expect(production.items.map((item) => item.id)).toEqual(["recipes", "orders", "qc"]);
    expect(production.items.every((item) => item.phase_gated === undefined)).toBe(true);
    expect(config.ui.terminology["mfg.recipe"]).toEqual({
      en: "Recipe (BOM)",
      ar: "الوصفة (قائمة المواد)",
    });
    expect(config.ui.terminology["mfg.qc_gate"]).toEqual({
      en: "QC gate",
      ar: "بوابة فحص الجودة",
    });
    // The manufacturing module is INSTALLED (L8 from default_modules_enabled).
    expect(config.layers.l8_installed.manufacturing).toBe(true);
    // The four PHASE-018 workflow policies land as L1 defaults (the
    // manifest says required; L5 may override — see the last test).
    expect(config.policies["manufacturing.qc_gate"]).toBe("required");
    expect(config.policies["manufacturing.consumption_variance_threshold_pct"]).toBe(5);
    expect(config.policies["manufacturing.scrap_reason_required"]).toBe(true);
    expect(config.policies["manufacturing.fg_batch_expiry_from_shelf_life"]).toBe(true);
  });

  it("re-apply of the template is idempotent (zero writes)", async () => {
    const before = await withTenant(foodTenant, () => findAppliedStateRow());
    const seriesBefore = await tenantLevelSeries(foodTenant);

    const second = await withTenant(foodTenant, () =>
      applyService.apply(foodOwner, { templateKey: "industry.food_manufacturing", mode: "reapply" }),
    );
    expect(second.applied).toBe(false);
    expect(second.reason).toBe("already-applied");

    const after = await withTenant(foodTenant, () => findAppliedStateRow());
    expect(after!.appliedAt).toBe(before!.appliedAt);
    expect(after!.appliedManifestHash).toBe(KNOWN_HASH);
    expect(await tenantLevelSeries(foodTenant)).toHaveLength(seriesBefore.length);
    expect(await auditActions(foodTenant, "industry.template.applied")).toBe(1);
  });

  it("switch safety (BR-038): restaurant → food_manufacturing is additive-only, POS history untouched, and back again", async () => {
    // The pre-switch registry: restaurant's own series (the POS sale's
    // number row is branch-scoped — the tenant-level rows are the registry).
    const seriesBefore = await tenantLevelSeries(switchTenant);
    expect(seriesBefore.map((entry) => entry.docType)).toEqual([
      "goods_receipt",
      "pos_sale",
      "purchase_order",
      "stock_adjustment",
    ]);

    // The pre-switch POS history snapshot (byte-level).
    const posBefore = await posHistorySnapshot(switchTenant, switchPos);

    // The 0026 grants cover food_manufacturing's REQUIRED chain on business
    // — the switch needs no acknowledgement (nothing REQUIRED is gated).
    const switched = await withTenant(switchTenant, () =>
      switchService.switch(switchOwner, { targetTemplateKey: "industry.food_manufacturing" }),
    );
    expect(switched.applied).toBe(true);

    const row = await withTenant(switchTenant, () => findAppliedStateRow());
    expect(row!.templateKey).toBe("industry.food_manufacturing");
    expect(row!.appliedManifestHash).toBe(KNOWN_HASH);

    // -- ZERO data loss: the posted POS document is intact BYTE-IDENTICAL -
    expect(await posHistorySnapshot(switchTenant, switchPos)).toEqual(posBefore);
    const su = await superuserClient();
    const invoice = await su.query<{ invoice_no: string; status: string; channel: string }>(
      `SELECT invoice_no, status, channel FROM sales_invoices WHERE id = $1`,
      [switchPos.invoiceId],
    );
    await su.end();
    expect(invoice.rows[0]).toEqual({
      invoice_no: switchPos.invoiceNo,
      status: "POSTED",
      channel: "POS",
    });

    // -- BR-038 archives: the restaurant snapshot is present, read-only ----
    expect(row!.archivedTerminology).toHaveLength(1);
    expect(row!.archivedTerminology[0]).toMatchObject({
      templateKey: "industry.restaurant",
      version: "1.0.0",
    });
    expect(row!.archivedTerminology[0]!.terminology["pos.table"]).toEqual({
      en: "Table",
      ar: "طاولة",
    });
    expect(row!.archivedNavigation[0]).toMatchObject({
      templateKey: "industry.restaurant",
      version: "1.0.0",
    });
    expect(row!.archivedNavigation[0]!.groups).toHaveLength(2); // floor + day
    expect(row!.archivedCapabilities[0]).toMatchObject({ templateKey: "industry.restaurant" });
    expect(
      row!.archivedCapabilities[0]!.capabilities.map((cap) => cap.capabilityId).sort(),
    ).toEqual(["composite_kits", "free_goods_promo", "kitchen_display", "table_service"]);

    // -- additive-only numbering: restaurant rows untouched, PRD/DLV/INV added
    const seriesAfter = await tenantLevelSeries(switchTenant);
    expect(seriesAfter.map((entry) => entry.docType)).toEqual([
      "delivery_note",
      "goods_receipt",
      "pos_sale",
      "production_order",
      "purchase_order",
      "sales_invoice",
      "stock_adjustment",
    ]);
    expect(seriesAfter.find((entry) => entry.docType === "production_order")?.format).toBe(
      "PRD-{yyyy}-{seq:5}",
    );
    expect(seriesAfter.find((entry) => entry.docType === "sales_invoice")?.format).toBe(
      "INV-{yyyy}-{seq:6}",
    ); // the food default (the POS sale numbered from pos_sale, not sales_invoice)
    expect(seriesAfter.find((entry) => entry.docType === "pos_sale")?.format).toBe(
      "RC-{branch}-{yy}{MM}-{seq:5}",
    ); // the restaurant row, byte-for-byte

    // -- the audited switch + the effective config ------------------------
    expect(await auditActions(switchTenant, "industry.template.switched")).toBe(1);
    resetConfigurationCache();
    const config = await withTenant(switchTenant, () =>
      resolver.resolveTenantStatic(switchTenant),
    );
    expect(config.layers.l1_template?.key).toBe("industry.food_manufacturing");
    expect(config.ui.navigation).toEqual(["production", "trace"]);
    expect(config.ui.terminology["mfg.recipe"]).toEqual({
      en: "Recipe (BOM)",
      ar: "الوصفة (قائمة المواد)",
    });

    // -- switching BACK always succeeds (nothing was destroyed) -----------
    const back = await withTenant(switchTenant, () =>
      switchService.switch(switchOwner, { targetTemplateKey: "industry.restaurant" }),
    );
    expect(back.applied).toBe(true);
    const restored = await withTenant(switchTenant, () => findAppliedStateRow());
    expect(restored!.templateKey).toBe("industry.restaurant");
    expect(restored!.appliedManifestHash).toBe(hashManifestJson(RESTAURANT_MANIFEST));
    // The archives hold BOTH template sets (append-only history, R2/R6).
    expect(restored!.archivedTerminology.map((entry) => entry.templateKey)).toEqual([
      "industry.restaurant",
      "industry.food_manufacturing",
    ]);
    // The food series REMAIN (append-only — R5).
    const seriesBack = await tenantLevelSeries(switchTenant);
    expect(seriesBack.map((entry) => entry.docType)).toContain("production_order");
    expect(seriesBack.map((entry) => entry.docType)).toContain("delivery_note");
    // The posted POS document is STILL untouched.
    expect(await posHistorySnapshot(switchTenant, switchPos)).toEqual(posBefore);
    expect(await auditActions(switchTenant, "industry.template.switched")).toBe(2);
  });

  it("degraded entitlement: food_manufacturing without manufacturing.qc blocks with the typed missing chain", async () => {
    await expect(
      withTenant(degradedTenant, () =>
        applyService.apply(degradedOwner, {
          templateKey: "industry.food_manufacturing",
          mode: "initial",
        }),
      ),
    ).rejects.toMatchObject({
      code: "configuration/template-prerequisites-blocked",
      templateKey: "industry.food_manufacturing",
      missingChain: ["manufacturing.qc"],
      guidance: {
        ar: expect.stringContaining("manufacturing.qc"),
        en: expect.stringContaining("manufacturing.qc"),
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

  it("restaurant WITHOUT the manufacturing add-on: bom_production hides cleanly (no phase label at 18)", async () => {
    // The OPTIONAL PHASE-018 capability degrades HIDDEN (not phase_gated —
    // the phase shipped, so an unentitled key is an upgrade path, never a
    // coming-soon label); the apply proceeds; nothing crashes.
    const result = await withTenant(restaurantTenant, () =>
      applyService.apply(restaurantOwner, { templateKey: "industry.restaurant", mode: "initial" }),
    );
    expect(result.applied).toBe(true);
    const bom = result.prerequisiteCheck.capabilities.find(
      (capability) => capability.capabilityId === "bom_production",
    );
    expect(bom).toMatchObject({
      status: "hidden",
      missingKeys: ["manufacturing.bom", "manufacturing.production_orders"],
    });
    expect(bom!.phase).toBeUndefined(); // no coming-soon label at PHASE-018
    expect(result.prerequisiteCheck.requiresAcknowledgement).toBe(false);

    // The floor/day navigation resolves with NO production/prep items (the
    // restaurant manifest carries none — the manufacturing add-on would
    // compose food_manufacturing, §5 R10 hidden menus, no broken screen).
    resetConfigurationCache();
    const config = await withTenant(restaurantTenant, () =>
      resolver.resolveTenantStatic(restaurantTenant),
    );
    expect(config.layers.l1_template?.key).toBe("industry.restaurant");
    expect(config.ui.navigation).toEqual(["floor", "day"]);
    expect(
      config.ui.navigation_tree
        .flatMap((group) => group.items.map((item) => item.target))
        .filter((target) => target.startsWith("manufacturing.")),
    ).toEqual([]);
    // The manufacturing module is NOT installed for this tenant (the
    // restaurant manifest does not enable it and no manufacturing key is
    // active — L4 stays the single source of feature truth).
    expect(config.layers.l8_installed.manufacturing).toBeUndefined();
  });

  it("starter-plan degradation: the full missing chain blocks the apply (guided plan selection)", async () => {
    // Starter carries none of the manufacturing keys: the REQUIRED
    // capabilities block, the required_feature_keys backstop adds the
    // uncovered intake/inventory keys, and BR-040 closure contributes
    // nothing beyond them (the starter set is itself closure-valid).
    await expect(
      withTenant(starterTenant, () =>
        applyService.apply(starterOwner, {
          templateKey: "industry.food_manufacturing",
          mode: "initial",
        }),
      ),
    ).rejects.toMatchObject({
      code: "configuration/template-prerequisites-blocked",
      templateKey: "industry.food_manufacturing",
      missingChain: [
        "industry.template_engine",
        "inventory.batch_tracking",
        "inventory.stock_counts",
        "manufacturing.batch_genealogy",
        "manufacturing.bom",
        "manufacturing.production_orders",
        "manufacturing.qc",
        "purchasing.landed_costs",
      ],
      guidance: {
        ar: expect.stringContaining("manufacturing.qc"),
        en: expect.stringContaining("manufacturing.qc"),
      },
    });
    // Zero rows were written (fail closed — no partial state).
    expect(await withTenant(starterTenant, () => findAppliedStateRow())).toBeUndefined();
    const su = await superuserClient();
    const series = await su.query<{ n: string }>(
      `SELECT count(*)::text AS n FROM numbering_sequences WHERE tenant_id = $1`,
      [starterTenant],
    );
    await su.end();
    expect(series.rows[0]!.n).toBe("0");
    expect(await auditActions(starterTenant, "industry.template.applied")).toBe(0);
  });

  it("L5 tenant setting beats the L1 manifest default (BR-038 R8): qc_gate off", async () => {
    // The manifest ships production_qc_gate "required" (proven in the first
    // test); an explicit tenant_settings row wins per the §3 precedence
    // table (L10 > L5 > L1 > platform default).
    const su = await superuserClient();
    await su.query(
      `INSERT INTO tenant_settings (id, tenant_id, key, value, updated_at)
       VALUES (gen_random_uuid(), $1, 'manufacturing.qc_gate', '"off"'::jsonb, now())
       ON CONFLICT (tenant_id, key) DO NOTHING`,
      [foodTenant],
    );
    await su.end();
    resetConfigurationCache();
    const config = await withTenant(foodTenant, () => resolver.resolveTenantStatic(foodTenant));
    expect(config.layers.l1_template?.key).toBe("industry.food_manufacturing");
    expect(config.policies["manufacturing.qc_gate"]).toBe("off"); // L5 wins
    // The untouched manufacturing policies keep their L1 defaults.
    expect(config.policies["manufacturing.consumption_variance_threshold_pct"]).toBe(5);
    expect(config.policies["manufacturing.scrap_reason_required"]).toBe(true);
    expect(config.policies["manufacturing.fg_batch_expiry_from_shelf_life"]).toBe(true);
  });
});

/** Byte-level snapshot of the posted POS history (invoice + settlement
 * journal + item) — the proof object BR-038's zero-data-loss contract. */
async function posHistorySnapshot(
  tenantId: string,
  pos: {
    invoiceId: string;
    invoiceNo: string;
    journalEntryId: string;
    itemId: string;
    settlementLines: { direction: string; amount: string }[];
  },
): Promise<{
  invoice: { invoiceNo: string; status: string; channel: string; totalGross: string };
  journal: { direction: string; amount: string }[];
  item: { sku: string; trackBatch: boolean };
}> {
  const su = await superuserClient();
  const invoice = await su.query<{
    invoice_no: string;
    status: string;
    channel: string;
    total_gross: string;
  }>(
    `SELECT invoice_no, status, channel, total_gross::text FROM sales_invoices WHERE id = $1`,
    [pos.invoiceId],
  );
  const item = await su.query<{ sku: string; track_batch: boolean }>(
    `SELECT sku, track_batch FROM items WHERE id = $1`,
    [pos.itemId],
  );
  await su.end();
  const lines = await withTenant(tenantId, async () => {
    const journal = await import("../../modules/accounting/infrastructure/journal.store");
    return journal.listLines(pos.journalEntryId);
  });
  return {
    invoice: {
      invoiceNo: invoice.rows[0]!.invoice_no,
      status: invoice.rows[0]!.status,
      channel: invoice.rows[0]!.channel,
      totalGross: invoice.rows[0]!.total_gross,
    },
    journal: lines.map((line) => ({ direction: line.direction, amount: line.amount })),
    item: { sku: item.rows[0]!.sku, trackBatch: item.rows[0]!.track_batch },
  };
}
