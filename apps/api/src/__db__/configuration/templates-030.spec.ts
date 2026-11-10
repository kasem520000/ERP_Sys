import { beforeAll, describe, expect, it } from "vitest";

import {
  ELECTRONICS_TEMPLATE_MANIFEST,
  RETAIL_MANIFEST,
  WHOLESALE_TEMPLATE_MANIFEST,
  hashManifestJson,
} from "@erp/contracts";

import { superuserClient } from "../test-db";
import { withTenant } from "../../infra/db/tenant-context";
import { resetConfigurationCache } from "../../modules/configuration/application/config-events";
import {
  findAppliedStateRow,
  parseAppliedOverrides,
} from "../../modules/configuration/application/apply/applied-state.store";
import { TemplatePrerequisitesBlockedError } from "../../modules/configuration/application/apply/prerequisites";
import {
  applyService,
  auditActions,
  grantEntitlement,
  postServiceInvoice,
  provisionBusinessTenant,
  resolver,
  revokeEntitlement,
  seedPostingSubstrate,
  switchService,
  tenantLevelSeries,
} from "./template-fixtures";

/**
 * PHASE-030 T4/T5/T6 db spec — the two new Blueprint v2.0 industry templates
 * through the UNMODIFIED PHASE-015 engine (industries/README §8 #3/#5/#7; the
 * seven per-template governance requirements; BR-038 additive-only; INV-022 —
 * the phase's defining negative-ledger gate):
 *
 * - `industry.wholesale` v1.0.0 applies cleanly to a fresh business-plan
 *   tenant (the 0038 notes grants + the 0008/0025 base grants cover its
 *   REQUIRED chain at CURRENT_SHIPPED_PHASE 30): the applied row pins the
 *   KNOWN migration-0041 content hash, the append-only series registry lands
 *   (quotation QT-, sales_order ORD-, delivery_note DLV-, INV-, CN-, receipt
 *   RCP-, goods_receipt GRN-, stock_transfer TRF-), report pins
 *   (notes.maturity-calendar / notes.aging / ar.aging /
 *   inventory.valuation) + the bilingual onboarding checklist (first_pdc
 *   VISIBLE on notes.received) + enabled modules (notes ON) materialize, the
 *   apply is audited, and the derived trading/credit navigation + terminology
 *   (أمر التوريد / شريحة الكمية / شيك مؤجل) + the seven bare workflow
 *   policies resolve live — credit-first: sales.cash_autopost keeps the
 *   platform FALSE default (the manifest never sets it); shipment_tracking
 *   degrades HIDDEN (the ungrantable distribution.shipment_tracking key).
 * - `industry.electronics` v1.0.0 applies cleanly (the 0024 POS set + the
 *   0027 crm.service_orders grant cover its REQUIRED chain): the KNOWN 0041
 *   hash, five series (INV- / POS-{branch} / RC- job cards / CN- / GRN-),
 *   the counter report pins (retail.imei_register / pos.sales_by_terminal /
 *   pos.sales_by_hour / inventory.valuation) + the all-visible checklist
 *   (first_repair on crm.service_orders, first_shift on pos.sales), pos +
 *   crm modules ON, the counter/service navigation + terminology
 *   (بطاقة صيانة / الرقم التسلسلي (IMEI) / استلام الجهاز), the six bare
 *   workflow policies, and POS-first sales.cash_autopost TRUE.
 * - Re-apply of either template is idempotent (zero writes).
 * - Switch safety (BR-038): retail → wholesale and retail → electronics are
 *   additive-only — the posted back-office invoice survives byte-identical,
 *   the series registry is the union (retail rows untouched, the new doc
 *   types appended; sales_invoice / credit_note / stock_transfer collide on
 *   IDENTICAL formats so no row mutates), archived_* snapshots hold the
 *   retail set (read-only), switching BACK always succeeds, the archives
 *   hold BOTH templates, and every switch is audited.
 * - Degraded entitlement (§8 #7, fail-closed): wholesale without
 *   `notes.received` and electronics without `crm.service_orders` block with
 *   the typed TemplatePrerequisitesBlockedError and the exact missing chain —
 *   never a silent back-office apply, zero rows written — and granting the
 *   key BACK recovers the apply with the SAME manifest (PHASE-030 §2 item 5:
 *   activation is entitlement state, never a manifest edit).
 * - L5 beats L1 (BR-038 R8): an explicit `sales.cash_autopost` tenant setting
 *   overrides the electronics manifest's true default.
 * - THE NEGATIVE LEDGER PROOF (INV-022): applying, switching, and re-applying
 *   either template produces ZERO journal rows — templates are
 *   configuration, never a fork. Every apply / re-apply / switch /
 *   back-switch / revoke-regrant operation in this spec snapshots the
 *   `journal_entries` + `journal_lines` counters before and after and asserts
 *   a byte-identical delta of ZERO, and the consolidated final gate re-proves
 *   the whole file (the four template tenants carry no journal rows at all;
 *   the two switch tenants carry exactly their posted pre-switch invoice and
 *   nothing else).
 */

/** KNOWN hashes — `pnpm validate:manifests` on the nine-template set (the
 *  constants are byte-identical to the migration 0041 registry seeds and the
 *  docs mirrors docs/industries/templates/manifests/
 *  manifest.wholesale.json / manifest.electronics.json). */
const KNOWN_HASHES: Readonly<Record<string, string>> = Object.freeze({
  "industry.wholesale": "sha256:0fe7aa4c8e0892a1451dd3cc623b886a5dd51ab6c3a78066a26e259fd85a7522",
  "industry.electronics": "sha256:216f1e981ae4c457173c18ead7c1263780f8082c6d18807fb9308a507e6f51a9",
});

// -- tenant A: wholesale apply ------------------------------------------------
let whlTenant = "";
let whlOwner = "";

// -- tenant B: electronics apply ----------------------------------------------
let elcTenant = "";
let elcOwner = "";

// -- tenant C: switch safety (retail → wholesale → retail) --------------------
let switchWhlTenant = "";
let switchWhlOwner = "";
let switchWhlInvoice!: {
  invoiceId: string;
  invoiceNo: string;
  journalEntryId: string;
};

// -- tenant D: switch safety (retail → electronics → retail) ------------------
let switchElcTenant = "";
let switchElcOwner = "";
let switchElcInvoice!: {
  invoiceId: string;
  invoiceNo: string;
  journalEntryId: string;
};

// -- tenants E/F: degraded entitlement (fail-closed + grant-back recovery) ----
let whlDegradedTenant = "";
let whlDegradedOwner = "";
let elcDegradedTenant = "";
let elcDegradedOwner = "";

/** The post-posting ledger baselines captured in beforeAll — the posted
 *  invoice's OWN journal rows and nothing more; every apply/switch this spec
 *  performs must leave them byte-identical (INV-022). */
let switchWhlLedger!: JournalCounters;
let switchElcLedger!: JournalCounters;

beforeAll(async () => {
  const wholesale = await provisionBusinessTenant("whl-030", "industry.wholesale");
  whlTenant = wholesale.tenantId;
  whlOwner = wholesale.ownerId;

  const electronics = await provisionBusinessTenant("elc-030", "industry.electronics");
  elcTenant = electronics.tenantId;
  elcOwner = electronics.ownerId;

  // The wholesale switch-safety tenant: retail (back-office counter) applied
  // over a REAL posted invoice — the same shape as templates-019's switch
  // tenant (a posted CREDIT service invoice through the real sales flow:
  // submit → approve (SoD) → post + AR subledger row).
  const switchedWhl = await provisionBusinessTenant("switch-whl", "industry.retail");
  switchWhlTenant = switchedWhl.tenantId;
  switchWhlOwner = switchedWhl.ownerId;
  const whlSubstrate = await seedPostingSubstrate(switchWhlTenant, switchWhlOwner, "SW030W");
  switchWhlInvoice = await postServiceInvoice(whlSubstrate, "pre-switch wholesale invoice");
  const whlLedgerAfterPosting = await journalCounters(switchWhlTenant);
  expect(whlLedgerAfterPosting.entries).toBeGreaterThan(0); // the proof object exists
  const appliedRetailWhl = await withTenant(switchWhlTenant, () =>
    applyService.apply(switchWhlOwner, { templateKey: "industry.retail", mode: "initial" }),
  );
  expect(appliedRetailWhl.applied).toBe(true);
  // INV-022: the retail apply over posted history wrote ZERO journal rows —
  // this baseline is what every later switch must match byte-for-byte.
  switchWhlLedger = await journalCounters(switchWhlTenant);
  expect(switchWhlLedger).toEqual(whlLedgerAfterPosting);

  // The electronics switch-safety tenant (same shape).
  const switchedElc = await provisionBusinessTenant("switch-elc", "industry.retail");
  switchElcTenant = switchedElc.tenantId;
  switchElcOwner = switchedElc.ownerId;
  const elcSubstrate = await seedPostingSubstrate(switchElcTenant, switchElcOwner, "SW030E");
  switchElcInvoice = await postServiceInvoice(elcSubstrate, "pre-switch electronics invoice");
  const elcLedgerAfterPosting = await journalCounters(switchElcTenant);
  expect(elcLedgerAfterPosting.entries).toBeGreaterThan(0);
  const appliedRetailElc = await withTenant(switchElcTenant, () =>
    applyService.apply(switchElcOwner, { templateKey: "industry.retail", mode: "initial" }),
  );
  expect(appliedRetailElc.applied).toBe(true);
  switchElcLedger = await journalCounters(switchElcTenant);
  expect(switchElcLedger).toEqual(elcLedgerAfterPosting);

  // The degraded tenants: the pdc_notes / job_cards capability key revoked
  // (0038/0027 granted them to business; the revoke simulates the pre-grant
  // / downgraded plan — the fail-closed §8 #7 leg).
  const whlDegraded = await provisionBusinessTenant("whl-degraded", "industry.wholesale");
  whlDegradedTenant = whlDegraded.tenantId;
  whlDegradedOwner = whlDegraded.ownerId;
  await revokeEntitlement(whlDegradedTenant, "notes.received");

  const elcDegraded = await provisionBusinessTenant("elc-degraded", "industry.electronics");
  elcDegradedTenant = elcDegraded.tenantId;
  elcDegradedOwner = elcDegraded.ownerId;
  await revokeEntitlement(elcDegradedTenant, "crm.service_orders");
});

describe("templates-030 — wholesale & electronics through the PHASE-015 engine", () => {
  it("industry.wholesale v1.0.0 applies cleanly to a fresh business tenant", async () => {
    // INV-022: the ledger snapshot the whole apply must not move.
    const ledgerBefore = await journalCounters(whlTenant);

    const result = await withTenant(whlTenant, () =>
      applyService.apply(whlOwner, { templateKey: "industry.wholesale", mode: "initial" }),
    );
    expect(result.applied).toBe(true);
    expect(result.templateKey).toBe("industry.wholesale");
    expect(result.version).toBe("1.0.0");
    expect(result.manifestHash).toBe(hashManifestJson(WHOLESALE_TEMPLATE_MANIFEST));
    expect(result.manifestHash).toBe(KNOWN_HASHES["industry.wholesale"]);

    // The REQUIRED pair resolves LIVE (the 0038 notes grants + the 0025
    // tiers grant at CURRENT_SHIPPED_PHASE 30 — nothing gated, no
    // acknowledgement); the OPTIONAL shipment_tracking degrades HIDDEN —
    // distribution.shipment_tracking is ungrantable, an upgrade path,
    // never a broken screen (§5 R10).
    for (const capabilityId of ["customer_price_tiers", "pdc_notes"]) {
      const capability = result.prerequisiteCheck.capabilities.find(
        (candidate) => candidate.capabilityId === capabilityId,
      );
      expect(capability, capabilityId).toMatchObject({ status: "included" });
    }
    expect(
      result.prerequisiteCheck.capabilities.find(
        (candidate) => candidate.capabilityId === "shipment_tracking",
      ),
    ).toMatchObject({
      status: "hidden",
      missingKeys: ["distribution.shipment_tracking"],
    });
    expect(result.prerequisiteCheck.status).toBe("ok");
    expect(result.prerequisiteCheck.requiresAcknowledgement).toBe(false);

    // -- the applied row: key / version / KNOWN 0041 seed hash --------------
    const row = await withTenant(whlTenant, () => findAppliedStateRow());
    expect(row).toBeDefined();
    expect(row!.templateKey).toBe("industry.wholesale");
    expect(row!.appliedVersion).toBe("1.0.0");
    expect(row!.status).toBe("ACTIVE");
    expect(row!.appliedBy).toBe(whlOwner);
    expect(row!.appliedManifestHash).toBe(hashManifestJson(WHOLESALE_TEMPLATE_MANIFEST));
    expect(row!.appliedManifestHash).toBe(KNOWN_HASHES["industry.wholesale"]);

    // -- series registry: all eight trading doc types (tenant-level rows) --
    const series = await tenantLevelSeries(whlTenant);
    expect(series.map((entry) => entry.docType)).toEqual(
      Object.keys(WHOLESALE_TEMPLATE_MANIFEST.document_numbering_defaults).sort(),
    );
    expect(series.every((entry) => entry.nextValue === "1")).toBe(true); // acquisition-inert registry rows (R5)
    expect(series.find((entry) => entry.docType === "quotation")?.format).toBe("QT-{yyyy}-{seq:5}");
    expect(series.find((entry) => entry.docType === "sales_order")?.format).toBe(
      "ORD-{yyyy}-{seq:6}",
    );
    expect(series.find((entry) => entry.docType === "delivery_note")?.format).toBe(
      "DLV-{yyyy}-{seq:5}",
    );
    expect(series.find((entry) => entry.docType === "sales_invoice")?.format).toBe(
      "INV-{yyyy}-{seq:6}",
    );
    expect(series.find((entry) => entry.docType === "credit_note")?.format).toBe(
      "CN-{yyyy}-{seq:5}",
    );
    expect(series.find((entry) => entry.docType === "receipt")?.format).toBe("RCP-{yyyy}-{seq:6}");
    expect(series.find((entry) => entry.docType === "goods_receipt")?.format).toBe(
      "GRN-{yyyy}-{seq:6}",
    );
    expect(series.find((entry) => entry.docType === "stock_transfer")?.format).toBe(
      "TRF-{yyyy}-{seq:5}",
    );

    // -- overrides: report pins + checklist + modules ------------------------
    const overrides = parseAppliedOverrides(row!.overrides);
    expect(overrides.report_pins.map((pin) => pin.report_key)).toEqual([
      "notes.maturity-calendar",
      "notes.aging",
      "ar.aging", // the §J reconciliation (partners.ar_aging → live registry key)
      "inventory.valuation",
    ]);
    expect(overrides.report_pins[0]).toMatchObject({
      report_key: "notes.maturity-calendar",
      pinned: true,
      dashboard: true,
      default_period: "this_month",
    });
    expect(overrides.report_pins[1]).toMatchObject({
      report_key: "notes.aging",
      pinned: true,
      dashboard: false,
      default_period: "this_month",
    });
    expect(overrides.report_pins[2]).toMatchObject({
      report_key: "ar.aging",
      pinned: true,
      dashboard: true,
      default_period: "this_month",
    });
    expect(overrides.report_pins[3]).toMatchObject({
      report_key: "inventory.valuation",
      pinned: true,
      dashboard: false,
      default_period: "custom",
    });
    expect(overrides.onboarding_checklist.map((step) => step.id)).toEqual(
      WHOLESALE_TEMPLATE_MANIFEST.onboarding_steps.map((step) => step.id),
    );
    // first_pdc carries feature_key notes.received → VISIBLE (entitled at
    // 030 and its owning phase 027 already shipped); every step resolves
    // visible — no coming-soon label anywhere.
    expect(overrides.onboarding_checklist.find((step) => step.id === "first_pdc")).toMatchObject({
      featureKey: "notes.received",
      status: "visible",
    });
    expect(overrides.onboarding_checklist.every((step) => step.status === "visible")).toBe(true);
    expect(overrides.enabled_modules).toEqual(WHOLESALE_TEMPLATE_MANIFEST.default_modules_enabled);
    expect(overrides.enabled_modules).toContain("notes");

    // -- audited --------------------------------------------------------------
    expect(await auditActions(whlTenant, "industry.template.applied")).toBe(1);

    // -- INV-022: the apply wrote ZERO journal rows --------------------------
    await expectZeroJournalDelta(whlTenant, ledgerBefore);

    // -- the derived config: trading/credit live, terminology AR + EN --------
    resetConfigurationCache();
    const config = await withTenant(whlTenant, () => resolver.resolveTenantStatic(whlTenant));
    expect(config.layers.l1_template?.key).toBe("industry.wholesale");
    expect(config.layers.l4_entitlements.missing).toEqual([]);
    expect(config.ui.navigation).toEqual(["trading", "credit"]);
    const trading = config.ui.navigation_tree.find((group) => group.id === "trading")!;
    expect(trading.items.map((item) => item.id)).toEqual([
      "quick_order",
      "quotes",
      "orders",
      "deliveries",
    ]);
    expect(trading.items.every((item) => item.phase_gated === undefined)).toBe(true);
    expect(
      config.ui.navigation_tree
        .find((group) => group.id === "credit")!
        .items.map((item) => item.id),
    ).toEqual(["invoices", "statements", "pdc", "maturity"]);
    expect(config.ui.terminology["doc.sales_order"]).toEqual({
      en: "Bulk order",
      ar: "أمر التوريد",
    });
    expect(config.ui.terminology["price.qty_break"]).toEqual({
      en: "Quantity break",
      ar: "شريحة الكمية",
    });
    expect(config.ui.terminology["notes.pdc"]).toEqual({
      en: "Post-dated note",
      ar: "شيك مؤجل",
    });
    // The notes module is INSTALLED (L8 from default_modules_enabled).
    expect(config.layers.l8_installed.notes).toBe(true);
    // The seven PHASE-030 wholesale workflow policies land as bare L1
    // defaults (registry-only keys with no SETTINGS_REGISTRY mapping); L5
    // may override — see the cash_autopost leg at the end.
    expect(config.policies["qty_break_pricing_automatic"]).toBe(true);
    expect(config.policies["tier_price_automatic_by_partner"]).toBe(true);
    expect(config.policies["bulk_order_from_quote_one_click"]).toBe(true);
    expect(config.policies["delivery_before_credit_invoice"]).toBe(true);
    expect(config.policies["statement_monthly_by_default"]).toBe(true);
    expect(config.policies["pdc_note_requires_maturity_date"]).toBe(true);
    expect(config.policies["credit_sale_credit_limit_enforced"]).toBe(true);
    // Credit-first: the wholesale manifest never sets cash_sales_autopost,
    // so the mapped settings key keeps the platform FALSE default.
    expect(config.policies["sales.cash_autopost"]).toBe(false);
  });

  it("industry.electronics v1.0.0 applies cleanly to a fresh business tenant", async () => {
    // INV-022: the ledger snapshot the whole apply must not move.
    const ledgerBefore = await journalCounters(elcTenant);

    const result = await withTenant(elcTenant, () =>
      applyService.apply(elcOwner, { templateKey: "industry.electronics", mode: "initial" }),
    );
    expect(result.applied).toBe(true);
    expect(result.templateKey).toBe("industry.electronics");
    expect(result.version).toBe("1.0.0");
    expect(result.manifestHash).toBe(hashManifestJson(ELECTRONICS_TEMPLATE_MANIFEST));
    expect(result.manifestHash).toBe(KNOWN_HASHES["industry.electronics"]);

    // The four REQUIRED capabilities resolve LIVE (the 0024 POS set + the
    // 0027 crm.service_orders grant + PHASE-010 serial tracking at
    // CURRENT_SHIPPED_PHASE 30) — nothing gated, no acknowledgement.
    for (const capabilityId of ["imei_tracking", "job_cards", "barcode_pos", "cashier_shifts"]) {
      const capability = result.prerequisiteCheck.capabilities.find(
        (candidate) => candidate.capabilityId === capabilityId,
      );
      expect(capability, capabilityId).toMatchObject({ status: "included" });
    }
    expect(result.prerequisiteCheck.status).toBe("ok");
    expect(result.prerequisiteCheck.requiresAcknowledgement).toBe(false);

    // -- the applied row: key / version / KNOWN 0041 seed hash --------------
    const row = await withTenant(elcTenant, () => findAppliedStateRow());
    expect(row).toBeDefined();
    expect(row!.templateKey).toBe("industry.electronics");
    expect(row!.appliedVersion).toBe("1.0.0");
    expect(row!.status).toBe("ACTIVE");
    expect(row!.appliedBy).toBe(elcOwner);
    expect(row!.appliedManifestHash).toBe(hashManifestJson(ELECTRONICS_TEMPLATE_MANIFEST));
    expect(row!.appliedManifestHash).toBe(KNOWN_HASHES["industry.electronics"]);

    // -- series registry: the five counter doc types (the per_branch POS and
    //    RC rules still register their tenant-level registry rows — R5) ----
    const series = await tenantLevelSeries(elcTenant);
    expect(series.map((entry) => entry.docType)).toEqual(
      Object.keys(ELECTRONICS_TEMPLATE_MANIFEST.document_numbering_defaults).sort(),
    );
    expect(series.every((entry) => entry.nextValue === "1")).toBe(true); // acquisition-inert registry rows (R5)
    expect(series.find((entry) => entry.docType === "sales_invoice")?.format).toBe(
      "INV-{yyyy}-{seq:6}",
    );
    expect(series.find((entry) => entry.docType === "pos_sale")?.format).toBe(
      "POS-{branch}-{yy}{MM}-{seq:5}",
    );
    expect(series.find((entry) => entry.docType === "job_card")?.format).toBe("RC-{yyyy}-{seq:5}");
    expect(series.find((entry) => entry.docType === "credit_note")?.format).toBe(
      "CN-{yyyy}-{seq:5}",
    );
    expect(series.find((entry) => entry.docType === "goods_receipt")?.format).toBe(
      "GRN-{yyyy}-{seq:5}",
    );

    // -- overrides: report pins + checklist + modules ------------------------
    const overrides = parseAppliedOverrides(row!.overrides);
    expect(overrides.report_pins.map((pin) => pin.report_key)).toEqual([
      "retail.imei_register",
      "pos.sales_by_terminal",
      "pos.sales_by_hour",
      "inventory.valuation",
    ]);
    expect(overrides.report_pins[0]).toMatchObject({
      report_key: "retail.imei_register",
      pinned: true,
      dashboard: true,
      default_period: "this_month",
    });
    expect(overrides.report_pins[1]).toMatchObject({
      report_key: "pos.sales_by_terminal",
      pinned: true,
      dashboard: true,
      default_period: "today",
    });
    expect(overrides.report_pins[2]).toMatchObject({
      report_key: "pos.sales_by_hour",
      pinned: true,
      dashboard: false,
      default_period: "this_week",
    });
    expect(overrides.report_pins[3]).toMatchObject({
      report_key: "inventory.valuation",
      pinned: true,
      dashboard: false,
      default_period: "custom",
    });
    expect(overrides.onboarding_checklist.map((step) => step.id)).toEqual(
      ELECTRONICS_TEMPLATE_MANIFEST.onboarding_steps.map((step) => step.id),
    );
    // first_repair (crm.service_orders) and first_shift (pos.sales) both
    // carry feature keys that are granted AND shipped — VISIBLE, never a
    // coming-soon label.
    expect(overrides.onboarding_checklist.find((step) => step.id === "first_repair")).toMatchObject(
      {
        featureKey: "crm.service_orders",
        status: "visible",
      },
    );
    expect(overrides.onboarding_checklist.find((step) => step.id === "first_shift")).toMatchObject({
      featureKey: "pos.sales",
      status: "visible",
    });
    expect(overrides.onboarding_checklist.every((step) => step.status === "visible")).toBe(true);
    expect(overrides.enabled_modules).toEqual(
      ELECTRONICS_TEMPLATE_MANIFEST.default_modules_enabled,
    );
    expect(overrides.enabled_modules).toContain("pos");
    expect(overrides.enabled_modules).toContain("crm");

    // -- audited --------------------------------------------------------------
    expect(await auditActions(elcTenant, "industry.template.applied")).toBe(1);

    // -- INV-022: the apply wrote ZERO journal rows --------------------------
    await expectZeroJournalDelta(elcTenant, ledgerBefore);

    // -- the derived config: counter/service live, terminology AR + EN ------
    resetConfigurationCache();
    const config = await withTenant(elcTenant, () => resolver.resolveTenantStatic(elcTenant));
    expect(config.layers.l1_template?.key).toBe("industry.electronics");
    expect(config.layers.l4_entitlements.missing).toEqual([]);
    expect(config.ui.navigation).toEqual(["counter", "service"]);
    const counter = config.ui.navigation_tree.find((group) => group.id === "counter")!;
    expect(counter.items.map((item) => item.id)).toEqual(["pos", "imei", "tradein"]);
    expect(counter.items.every((item) => item.phase_gated === undefined)).toBe(true);
    expect(
      config.ui.navigation_tree
        .find((group) => group.id === "service")!
        .items.map((item) => item.id),
    ).toEqual(["repair_cards", "returns", "receipts"]);
    expect(config.ui.terminology["svc.repair_card"]).toEqual({
      en: "Repair card",
      ar: "بطاقة صيانة",
    });
    expect(config.ui.terminology["item.imei"]).toEqual({
      en: "IMEI",
      ar: "الرقم التسلسلي (IMEI)",
    });
    expect(config.ui.terminology["device.checkin"]).toEqual({
      en: "Device check-in",
      ar: "استلام الجهاز",
    });
    // The pos + crm modules are INSTALLED (L8 from default_modules_enabled).
    expect(config.layers.l8_installed.pos).toBe(true);
    expect(config.layers.l8_installed.crm).toBe(true);
    // The six PHASE-030 electronics bare policies + the POS-first posture:
    // cash_sales_autopost maps onto the sales.cash_autopost settings key,
    // so the manifest's true lands as its L1 default.
    expect(config.policies["imei_capture_required_flagged_items"]).toBe(true);
    expect(config.policies["repair_parts_issue_mode"]).toBe("reserve");
    expect(config.policies["repair_card_labor_rate_source"]).toBe("price_list");
    expect(config.policies["tradein_purchase_at_branch"]).toBe(true);
    expect(config.policies["warranty_credit_note_requires_original_invoice"]).toBe(true);
    expect(config.policies["shift_variance_approval_required"]).toBe(true);
    expect(config.policies["sales.cash_autopost"]).toBe(true);
  });

  it("re-apply of either new template is idempotent (zero writes)", async () => {
    // -- wholesale ------------------------------------------------------------
    const whlBefore = await withTenant(whlTenant, () => findAppliedStateRow());
    const whlSeriesBefore = await tenantLevelSeries(whlTenant);
    const whlLedgerBefore = await journalCounters(whlTenant);

    const whlSecond = await withTenant(whlTenant, () =>
      applyService.apply(whlOwner, { templateKey: "industry.wholesale", mode: "reapply" }),
    );
    expect(whlSecond.applied).toBe(false);
    expect(whlSecond.reason).toBe("already-applied");

    const whlAfter = await withTenant(whlTenant, () => findAppliedStateRow());
    expect(whlAfter!.appliedAt).toBe(whlBefore!.appliedAt);
    expect(whlAfter!.appliedManifestHash).toBe(KNOWN_HASHES["industry.wholesale"]);
    expect(await tenantLevelSeries(whlTenant)).toHaveLength(whlSeriesBefore.length);
    expect(await auditActions(whlTenant, "industry.template.applied")).toBe(1);
    await expectZeroJournalDelta(whlTenant, whlLedgerBefore);

    // -- electronics ----------------------------------------------------------
    const elcBefore = await withTenant(elcTenant, () => findAppliedStateRow());
    const elcSeriesBefore = await tenantLevelSeries(elcTenant);
    const elcLedgerBefore = await journalCounters(elcTenant);

    const elcSecond = await withTenant(elcTenant, () =>
      applyService.apply(elcOwner, { templateKey: "industry.electronics", mode: "reapply" }),
    );
    expect(elcSecond.applied).toBe(false);
    expect(elcSecond.reason).toBe("already-applied");

    const elcAfter = await withTenant(elcTenant, () => findAppliedStateRow());
    expect(elcAfter!.appliedAt).toBe(elcBefore!.appliedAt);
    expect(elcAfter!.appliedManifestHash).toBe(KNOWN_HASHES["industry.electronics"]);
    expect(await tenantLevelSeries(elcTenant)).toHaveLength(elcSeriesBefore.length);
    expect(await auditActions(elcTenant, "industry.template.applied")).toBe(1);
    await expectZeroJournalDelta(elcTenant, elcLedgerBefore);
  });

  it("switch safety (BR-038): retail → wholesale is additive-only, posted history untouched, and back again", async () => {
    // The pre-switch registry: retail's own series (the posted invoice's
    // number row is branch-scoped — the tenant-level rows are the registry;
    // sales_invoice carries only the acquisition row, so the retail apply
    // skipped it exactly like templates-019's switch tenant).
    const seriesBefore = await tenantLevelSeries(switchWhlTenant);
    expect(seriesBefore.map((entry) => entry.docType)).toEqual([
      "credit_note",
      "pos_sale",
      "stock_transfer",
    ]);

    // The pre-switch posted-history snapshot (byte-level) + the ledger
    // baseline both switches must not move.
    const historyBefore = await invoiceHistorySnapshot(switchWhlTenant, switchWhlInvoice);
    const ledgerBefore = await journalCounters(switchWhlTenant);

    // The grants cover wholesale's REQUIRED chain on business — the switch
    // needs no acknowledgement (nothing REQUIRED is unshipped at 030).
    const switched = await withTenant(switchWhlTenant, () =>
      switchService.switch(switchWhlOwner, { targetTemplateKey: "industry.wholesale" }),
    );
    expect(switched.applied).toBe(true);
    await expectZeroJournalDelta(switchWhlTenant, ledgerBefore); // INV-022

    const row = await withTenant(switchWhlTenant, () => findAppliedStateRow());
    expect(row!.templateKey).toBe("industry.wholesale");
    expect(row!.appliedManifestHash).toBe(KNOWN_HASHES["industry.wholesale"]);

    // -- ZERO data loss: the posted invoice is intact BYTE-IDENTICAL --------
    expect(await invoiceHistorySnapshot(switchWhlTenant, switchWhlInvoice)).toEqual(historyBefore);
    const su = await superuserClient();
    const invoice = await su.query<{ invoice_no: string; status: string; channel: string }>(
      `SELECT invoice_no, status, channel FROM sales_invoices WHERE id = $1`,
      [switchWhlInvoice.invoiceId],
    );
    await su.end();
    expect(invoice.rows[0]).toEqual({
      invoice_no: switchWhlInvoice.invoiceNo,
      status: "POSTED",
      channel: "STANDARD",
    });

    // -- BR-038 archives: the retail snapshot is present, read-only ---------
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
    // Only composite_kits retires — retail's other five capability ids all
    // survive inside the wholesale manifest (read-only history, R6).
    expect(row!.archivedCapabilities[0]!.capabilities.map((cap) => cap.capabilityId)).toEqual([
      "composite_kits",
    ]);

    // -- additive-only numbering: the retail rows untouched, the five new
    //    wholesale doc types appended; sales_invoice / credit_note /
    //    stock_transfer collide on IDENTICAL formats (retail and wholesale
    //    define them byte-for-byte the same), so no row mutates -----------
    const seriesAfter = await tenantLevelSeries(switchWhlTenant);
    expect(seriesAfter.map((entry) => entry.docType)).toEqual([
      "credit_note",
      "delivery_note",
      "goods_receipt",
      "pos_sale",
      "quotation",
      "receipt",
      "sales_order",
      "stock_transfer",
    ]);
    expect(seriesAfter.find((entry) => entry.docType === "quotation")?.format).toBe(
      "QT-{yyyy}-{seq:5}",
    );
    expect(seriesAfter.find((entry) => entry.docType === "sales_order")?.format).toBe(
      "ORD-{yyyy}-{seq:6}",
    );
    expect(seriesAfter.find((entry) => entry.docType === "delivery_note")?.format).toBe(
      "DLV-{yyyy}-{seq:5}",
    );
    expect(seriesAfter.find((entry) => entry.docType === "receipt")?.format).toBe(
      "RCP-{yyyy}-{seq:6}",
    );
    expect(seriesAfter.find((entry) => entry.docType === "goods_receipt")?.format).toBe(
      "GRN-{yyyy}-{seq:6}",
    );
    expect(seriesAfter.find((entry) => entry.docType === "credit_note")?.format).toBe(
      "CN-{yyyy}-{seq:5}",
    ); // the retail row, byte-for-byte
    expect(seriesAfter.find((entry) => entry.docType === "pos_sale")?.format).toBe(
      "POS-{branch}-{yy}{MM}-{seq:5}",
    ); // the retail row, byte-for-byte
    expect(seriesAfter.find((entry) => entry.docType === "stock_transfer")?.format).toBe(
      "TRF-{yyyy}-{seq:5}",
    ); // the retail row, byte-for-byte

    // -- the audited switch + the effective config ---------------------------
    expect(await auditActions(switchWhlTenant, "industry.template.switched")).toBe(1);
    resetConfigurationCache();
    const config = await withTenant(switchWhlTenant, () =>
      resolver.resolveTenantStatic(switchWhlTenant),
    );
    expect(config.layers.l1_template?.key).toBe("industry.wholesale");
    expect(config.ui.navigation).toEqual(["trading", "credit"]); // derived from wholesale now
    expect(config.ui.terminology["doc.sales_order"]).toEqual({
      en: "Bulk order",
      ar: "أمر التوريد",
    });

    // -- switching BACK always succeeds (nothing was destroyed) -------------
    const back = await withTenant(switchWhlTenant, () =>
      switchService.switch(switchWhlOwner, { targetTemplateKey: "industry.retail" }),
    );
    expect(back.applied).toBe(true);
    await expectZeroJournalDelta(switchWhlTenant, ledgerBefore); // INV-022 — both switches
    const restored = await withTenant(switchWhlTenant, () => findAppliedStateRow());
    expect(restored!.templateKey).toBe("industry.retail");
    expect(restored!.appliedManifestHash).toBe(hashManifestJson(RETAIL_MANIFEST));
    // The archives hold BOTH template sets (append-only history, R2/R6).
    expect(restored!.archivedTerminology.map((entry) => entry.templateKey)).toEqual([
      "industry.retail",
      "industry.wholesale",
    ]);
    // The wholesale series REMAIN (append-only — R5).
    const seriesBack = await tenantLevelSeries(switchWhlTenant);
    expect(seriesBack.map((entry) => entry.docType)).toContain("quotation");
    expect(seriesBack.map((entry) => entry.docType)).toContain("delivery_note");
    expect(seriesBack.map((entry) => entry.docType)).toContain("receipt");
    expect(seriesBack.map((entry) => entry.docType)).toContain("goods_receipt");
    // The posted invoice is STILL untouched.
    expect(await invoiceHistorySnapshot(switchWhlTenant, switchWhlInvoice)).toEqual(historyBefore);
    expect(await auditActions(switchWhlTenant, "industry.template.switched")).toBe(2);
  });

  it("switch safety (BR-038): retail → electronics is additive-only, posted history untouched, and back again", async () => {
    // Same shape as the wholesale leg: retail's tenant-level registry minus
    // the branch-scoped sales_invoice acquisition row.
    const seriesBefore = await tenantLevelSeries(switchElcTenant);
    expect(seriesBefore.map((entry) => entry.docType)).toEqual([
      "credit_note",
      "pos_sale",
      "stock_transfer",
    ]);

    const historyBefore = await invoiceHistorySnapshot(switchElcTenant, switchElcInvoice);
    const ledgerBefore = await journalCounters(switchElcTenant);

    // The 0024 POS set + crm.service_orders cover electronics's REQUIRED
    // chain on business — no acknowledgement (nothing unshipped at 030).
    const switched = await withTenant(switchElcTenant, () =>
      switchService.switch(switchElcOwner, { targetTemplateKey: "industry.electronics" }),
    );
    expect(switched.applied).toBe(true);
    await expectZeroJournalDelta(switchElcTenant, ledgerBefore); // INV-022

    const row = await withTenant(switchElcTenant, () => findAppliedStateRow());
    expect(row!.templateKey).toBe("industry.electronics");
    expect(row!.appliedManifestHash).toBe(KNOWN_HASHES["industry.electronics"]);

    // -- ZERO data loss: the posted invoice is intact BYTE-IDENTICAL --------
    expect(await invoiceHistorySnapshot(switchElcTenant, switchElcInvoice)).toEqual(historyBefore);
    const su = await superuserClient();
    const invoice = await su.query<{ invoice_no: string; status: string; channel: string }>(
      `SELECT invoice_no, status, channel FROM sales_invoices WHERE id = $1`,
      [switchElcInvoice.invoiceId],
    );
    await su.end();
    expect(invoice.rows[0]).toEqual({
      invoice_no: switchElcInvoice.invoiceNo,
      status: "POSTED",
      channel: "STANDARD",
    });

    // -- BR-038 archives: the retail snapshot is present, read-only ---------
    expect(row!.archivedTerminology).toHaveLength(1);
    expect(row!.archivedTerminology[0]).toMatchObject({
      templateKey: "industry.retail",
      version: "1.0.0",
    });
    expect(row!.archivedNavigation[0]).toMatchObject({
      templateKey: "industry.retail",
      version: "1.0.0",
    });
    expect(row!.archivedNavigation[0]!.groups).toHaveLength(2); // selling + stock
    // ZERO capabilities retire — retail's six capability ids all survive
    // inside the electronics manifest (the snapshot is the empty set, still
    // recorded: history, never deletion).
    expect(row!.archivedCapabilities[0]).toMatchObject({ templateKey: "industry.retail" });
    expect(row!.archivedCapabilities[0]!.capabilities).toEqual([]);

    // -- additive-only numbering: the retail rows untouched, RC- job cards
    //    + GRN- goods receipts appended; sales_invoice / pos_sale /
    //    credit_note collide on IDENTICAL formats so no row mutates --------
    const seriesAfter = await tenantLevelSeries(switchElcTenant);
    expect(seriesAfter.map((entry) => entry.docType)).toEqual([
      "credit_note",
      "goods_receipt",
      "job_card",
      "pos_sale",
      "stock_transfer",
    ]);
    expect(seriesAfter.find((entry) => entry.docType === "job_card")?.format).toBe(
      "RC-{yyyy}-{seq:5}",
    );
    expect(seriesAfter.find((entry) => entry.docType === "goods_receipt")?.format).toBe(
      "GRN-{yyyy}-{seq:5}",
    );
    expect(seriesAfter.find((entry) => entry.docType === "credit_note")?.format).toBe(
      "CN-{yyyy}-{seq:5}",
    ); // the retail row, byte-for-byte
    expect(seriesAfter.find((entry) => entry.docType === "pos_sale")?.format).toBe(
      "POS-{branch}-{yy}{MM}-{seq:5}",
    ); // the retail row, byte-for-byte

    // -- the audited switch + the effective config ---------------------------
    expect(await auditActions(switchElcTenant, "industry.template.switched")).toBe(1);
    resetConfigurationCache();
    const config = await withTenant(switchElcTenant, () =>
      resolver.resolveTenantStatic(switchElcTenant),
    );
    expect(config.layers.l1_template?.key).toBe("industry.electronics");
    expect(config.ui.navigation).toEqual(["counter", "service"]); // derived from electronics now
    expect(config.ui.terminology["svc.repair_card"]).toEqual({
      en: "Repair card",
      ar: "بطاقة صيانة",
    });

    // -- switching BACK always succeeds (nothing was destroyed) -------------
    const back = await withTenant(switchElcTenant, () =>
      switchService.switch(switchElcOwner, { targetTemplateKey: "industry.retail" }),
    );
    expect(back.applied).toBe(true);
    await expectZeroJournalDelta(switchElcTenant, ledgerBefore); // INV-022 — both switches
    const restored = await withTenant(switchElcTenant, () => findAppliedStateRow());
    expect(restored!.templateKey).toBe("industry.retail");
    expect(restored!.appliedManifestHash).toBe(hashManifestJson(RETAIL_MANIFEST));
    // The archives hold BOTH template sets (append-only history, R2/R6).
    expect(restored!.archivedTerminology.map((entry) => entry.templateKey)).toEqual([
      "industry.retail",
      "industry.electronics",
    ]);
    // The electronics series REMAIN (append-only — R5).
    const seriesBack = await tenantLevelSeries(switchElcTenant);
    expect(seriesBack.map((entry) => entry.docType)).toContain("job_card");
    expect(seriesBack.map((entry) => entry.docType)).toContain("goods_receipt");
    // The posted invoice is STILL untouched.
    expect(await invoiceHistorySnapshot(switchElcTenant, switchElcInvoice)).toEqual(historyBefore);
    expect(await auditActions(switchElcTenant, "industry.template.switched")).toBe(2);
  });

  it("degraded entitlement (fail-closed): the typed missing chain blocks, and a grant-back recovers activation", async () => {
    // -- wholesale without notes.received -------------------------------------
    const whlLedgerBefore = await journalCounters(whlDegradedTenant);
    let whlBlocked: unknown;
    try {
      await withTenant(whlDegradedTenant, () =>
        applyService.apply(whlDegradedOwner, {
          templateKey: "industry.wholesale",
          mode: "initial",
        }),
      );
    } catch (error) {
      whlBlocked = error;
    }
    expect(whlBlocked).toBeInstanceOf(TemplatePrerequisitesBlockedError);
    const whlTyped = whlBlocked as TemplatePrerequisitesBlockedError;
    expect(whlTyped.code).toBe("configuration/template-prerequisites-blocked");
    expect(whlTyped.templateKey).toBe("industry.wholesale");
    // The exact missing chain: the pdc_notes capability's key (REQUIRED and
    // phase 027 already shipped — an unentitled key BLOCKS, never
    // phase-gates) + the BR-040 closure gap the revoke opened.
    expect(whlTyped.missingChain).toEqual(["notes.received"]);
    expect(whlTyped.guidance.ar).toContain("notes.received");
    expect(whlTyped.guidance.en).toContain("notes.received");
    // Never silent AND never partial: zero rows were written.
    expect(await withTenant(whlDegradedTenant, () => findAppliedStateRow())).toBeUndefined();
    const suW = await superuserClient();
    const whlSeries = await suW.query<{ n: string }>(
      `SELECT count(*)::text AS n FROM numbering_sequences WHERE tenant_id = $1`,
      [whlDegradedTenant],
    );
    await suW.end();
    expect(whlSeries.rows[0]!.n).toBe("0");
    expect(await auditActions(whlDegradedTenant, "industry.template.applied")).toBe(0);
    await expectZeroJournalDelta(whlDegradedTenant, whlLedgerBefore); // INV-022 — even a blocked apply

    // -- electronics without crm.service_orders -------------------------------
    const elcLedgerBefore = await journalCounters(elcDegradedTenant);
    let elcBlocked: unknown;
    try {
      await withTenant(elcDegradedTenant, () =>
        applyService.apply(elcDegradedOwner, {
          templateKey: "industry.electronics",
          mode: "initial",
        }),
      );
    } catch (error) {
      elcBlocked = error;
    }
    expect(elcBlocked).toBeInstanceOf(TemplatePrerequisitesBlockedError);
    const elcTyped = elcBlocked as TemplatePrerequisitesBlockedError;
    expect(elcTyped.code).toBe("configuration/template-prerequisites-blocked");
    expect(elcTyped.templateKey).toBe("industry.electronics");
    expect(elcTyped.missingChain).toEqual(["crm.service_orders"]);
    expect(elcTyped.guidance.ar).toContain("crm.service_orders");
    expect(elcTyped.guidance.en).toContain("crm.service_orders");
    expect(await withTenant(elcDegradedTenant, () => findAppliedStateRow())).toBeUndefined();
    const suE = await superuserClient();
    const elcSeries = await suE.query<{ n: string }>(
      `SELECT count(*)::text AS n FROM numbering_sequences WHERE tenant_id = $1`,
      [elcDegradedTenant],
    );
    await suE.end();
    expect(elcSeries.rows[0]!.n).toBe("0");
    expect(await auditActions(elcDegradedTenant, "industry.template.applied")).toBe(0);
    await expectZeroJournalDelta(elcDegradedTenant, elcLedgerBefore);

    // -- the upgrade path recovers: grant the key back and re-apply ----------
    // (PHASE-030 §2 item 5: activation is entitlement state, never a
    // manifest edit — the SAME registry row applies once the key is live.)
    await grantEntitlement(whlDegradedTenant, "notes.received");
    const whlRecovered = await withTenant(whlDegradedTenant, () =>
      applyService.apply(whlDegradedOwner, { templateKey: "industry.wholesale", mode: "initial" }),
    );
    expect(whlRecovered.applied).toBe(true);
    expect(whlRecovered.manifestHash).toBe(KNOWN_HASHES["industry.wholesale"]);
    expect(
      whlRecovered.prerequisiteCheck.capabilities.find(
        (candidate) => candidate.capabilityId === "pdc_notes",
      ),
    ).toMatchObject({ status: "included" });
    expect(await auditActions(whlDegradedTenant, "industry.template.applied")).toBe(1);
    await expectZeroJournalDelta(whlDegradedTenant, whlLedgerBefore); // INV-022 — recovery too

    await grantEntitlement(elcDegradedTenant, "crm.service_orders");
    const elcRecovered = await withTenant(elcDegradedTenant, () =>
      applyService.apply(elcDegradedOwner, {
        templateKey: "industry.electronics",
        mode: "initial",
      }),
    );
    expect(elcRecovered.applied).toBe(true);
    expect(elcRecovered.manifestHash).toBe(KNOWN_HASHES["industry.electronics"]);
    expect(
      elcRecovered.prerequisiteCheck.capabilities.find(
        (candidate) => candidate.capabilityId === "job_cards",
      ),
    ).toMatchObject({ status: "included" });
    expect(await auditActions(elcDegradedTenant, "industry.template.applied")).toBe(1);
    await expectZeroJournalDelta(elcDegradedTenant, elcLedgerBefore);
  });

  it("L5 tenant setting beats the L1 manifest default (BR-038 R8): sales.cash_autopost off", async () => {
    // The electronics manifest ships cash_sales_autopost true (proven in the
    // second test — the POS-first posture); an explicit tenant_settings row
    // wins per the §3 precedence table (L10 > L5 > L1 > platform default).
    // The write mirrors the templates-018/019 precedent (the configuration
    // db specs seed L5 rows through the superuser surface).
    const ledgerBefore = await journalCounters(elcTenant);
    const su = await superuserClient();
    await su.query(
      `INSERT INTO tenant_settings (id, tenant_id, key, value, updated_at)
       VALUES (gen_random_uuid(), $1, 'sales.cash_autopost', 'false'::jsonb, now())
       ON CONFLICT (tenant_id, key) DO NOTHING`,
      [elcTenant],
    );
    await su.end();
    resetConfigurationCache();
    const config = await withTenant(elcTenant, () => resolver.resolveTenantStatic(elcTenant));
    expect(config.layers.l1_template?.key).toBe("industry.electronics");
    expect(config.policies["sales.cash_autopost"]).toBe(false); // L5 wins
    // The untouched electronics policies keep their L1 defaults.
    expect(config.policies["repair_parts_issue_mode"]).toBe("reserve");
    expect(config.policies["imei_capture_required_flagged_items"]).toBe(true);
    expect(config.policies["warranty_credit_note_requires_original_invoice"]).toBe(true);
    await expectZeroJournalDelta(elcTenant, ledgerBefore); // a settings write is never a journal write
  });

  it("the negative ledger proof (INV-022): every apply/switch/re-apply/grant-back wrote zero journal rows", async () => {
    // Each operation above already asserted its own ZERO delta; this is the
    // consolidated gate. The four template tenants (wholesale, electronics,
    // and both degraded-then-recovered ones) carry NO journal rows at all —
    // provisioning, applying, re-applying, blocking, granting, and
    // re-applying again are configuration, never posting. The two switch
    // tenants carry exactly their posted pre-switch invoice rows (the
    // beforeAll baseline) — unchanged through two switches each.
    expect(await journalCounters(whlTenant)).toEqual({ entries: 0, lines: 0 });
    expect(await journalCounters(elcTenant)).toEqual({ entries: 0, lines: 0 });
    expect(await journalCounters(whlDegradedTenant)).toEqual({ entries: 0, lines: 0 });
    expect(await journalCounters(elcDegradedTenant)).toEqual({ entries: 0, lines: 0 });
    expect(await journalCounters(switchWhlTenant)).toEqual(switchWhlLedger);
    expect(await journalCounters(switchElcTenant)).toEqual(switchElcLedger);
    // Templates are configuration, never a fork (INV-022).
  });
});

/** The INV-022 proof object: per-tenant journal row counters. */
interface JournalCounters {
  readonly entries: number;
  readonly lines: number;
}

/** Count the tenant's journal rows (superuser read — the ledger oracle). */
async function journalCounters(tenantId: string): Promise<JournalCounters> {
  const su = await superuserClient();
  const rows = await su.query<{ entries: string; lines: string }>(
    `SELECT (SELECT count(*) FROM journal_entries WHERE tenant_id = $1)::text AS entries,
            (SELECT count(*) FROM journal_lines WHERE tenant_id = $1)::text AS lines`,
    [tenantId],
  );
  await su.end();
  return { entries: Number(rows.rows[0]!.entries), lines: Number(rows.rows[0]!.lines) };
}

/** INV-022: the operation between `before` and now wrote ZERO journal rows. */
async function expectZeroJournalDelta(tenantId: string, before: JournalCounters): Promise<void> {
  expect(await journalCounters(tenantId)).toEqual(before);
}

/** Byte-level snapshot of the posted back-office invoice history (invoice
 * row + journal lines with the partner/project stamps) — the proof object
 * BR-038's zero-data-loss contract. */
async function invoiceHistorySnapshot(
  tenantId: string,
  posted: { invoiceId: string; journalEntryId: string },
): Promise<{
  invoice: { invoiceNo: string; status: string; channel: string; totalGross: string };
  journal: {
    direction: string;
    amount: string;
    accountId: string;
    partnerId: string | null;
    projectId: string | null;
  }[];
}> {
  const su = await superuserClient();
  const invoice = await su.query<{
    invoice_no: string;
    status: string;
    channel: string;
    total_gross: string;
  }>(`SELECT invoice_no, status, channel, total_gross::text FROM sales_invoices WHERE id = $1`, [
    posted.invoiceId,
  ]);
  await su.end();
  const lines = await withTenant(tenantId, async () => {
    const journal = await import("../../modules/accounting/infrastructure/journal.store");
    return journal.listLines(posted.journalEntryId);
  });
  return {
    invoice: {
      invoiceNo: invoice.rows[0]!.invoice_no,
      status: invoice.rows[0]!.status,
      channel: invoice.rows[0]!.channel,
      totalGross: invoice.rows[0]!.total_gross,
    },
    journal: lines.map((line) => ({
      direction: line.direction,
      amount: line.amount,
      accountId: line.accountId,
      partnerId: line.partnerId,
      projectId: line.projectId,
    })),
  };
}
