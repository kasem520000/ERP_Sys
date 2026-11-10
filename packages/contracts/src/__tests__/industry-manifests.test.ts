import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import {
  AGRICULTURE_TEMPLATE_MANIFEST,
  AUTOMOTIVE_TEMPLATE_MANIFEST,
  DISTRIBUTION_TEMPLATE_MANIFEST,
  EDUCATION_TEMPLATE_MANIFEST,
  ELECTRONICS_TEMPLATE_MANIFEST,
  FOOD_MANUFACTURING_TEMPLATE_MANIFEST,
  GROCERY_MANIFEST,
  HEALTHCARE_TEMPLATE_MANIFEST,
  PROFESSIONAL_SERVICES_TEMPLATE_MANIFEST,
  RENTAL_LOGISTICS_TEMPLATE_MANIFEST,
  RESTAURANT_MANIFEST,
  RETAIL_MANIFEST,
  SHIPPED_TEMPLATE_MANIFESTS,
  WHOLESALE_TEMPLATE_MANIFEST,
  IndustryManifestValidationError,
  IndustryTemplateManifestSchema,
  canonicalManifestJson,
  getContractSchema,
  hashManifestJson,
  parseIndustryTemplateManifest,
  type IndustryTemplateManifest,
} from "../index";

/**
 * PHASE-015 T3 test hook (extended by PHASE-017 T2, PHASE-018 T2,
 * PHASE-019 T2, PHASE-030 T2, PHASE-032 T1, and PHASE-033 T1 — then the
 * delivery-completion rental shell): all thirteen
 * v1.0.0 manifests validate against the §3 schema;
 * negative fixtures are rejected with the precise issue; the content hash is
 * canonical and deterministic (applied_manifest_hash). The automotive/
 * distribution pair is transcribed verbatim from the migration 0025 registry
 * seeds (the canonical source; the automotive pins carry the reconciled live
 * report keys `inventory.valuation` + `ar.aging`). The food_manufacturing
 * template is transcribed verbatim from the migration 0026 registry seed
 * (docs mirror: docs/industries/templates/manifests/
 * manifest.food_manufacturing.json) and pins the live manufacturing report
 * keys. The professional_services template is transcribed verbatim from the
 * migration 0027 registry seed (docs mirror:
 * docs/industries/templates/manifests/manifest.professional_services.json —
 * the §12 doc reconciliation applied: bom_production N/A entry dropped,
 * ar_aging pinned to the live `ar.aging` registry key). The education
 * template is transcribed verbatim from the migration 0039 registry seed
 * (docs mirror: docs/industries/templates/manifests/manifest.education.json —
 * the §J doc reconciliation applied: partners.ar_aging pinned to the live
 * `ar.aging` registry key, exactly the §12 precedent) and pins the live
 * installments/notes-era report keys. The agriculture template is
 * transcribed verbatim from the migration 0040 registry seed (docs mirror:
 * docs/industries/templates/manifests/manifest.agriculture.json — the §J
 * doc reconciliation applied: inventory.stock_valuation pinned to the live
 * `inventory.valuation` registry key, the 0025/0039 precedent) and pins
 * the live manufacturing/inventory-era report keys. The wholesale +
 * electronics pair is transcribed verbatim from the migration 0044 registry
 * seeds (docs mirrors: manifest.wholesale.json / manifest.electronics.json —
 * the same reconciliation applied: partners.ar_aging → ar.aging,
 * inventory.stock_valuation → inventory.valuation). The healthcare
 * commercial shell is transcribed verbatim from the migration 0046 registry
 * seed (docs mirror: manifest.healthcare.json — the same ar.aging
 * reconciliation applied; inventory.expiry_list / notes.aging /
 * notes.maturity-calendar resolve verbatim).
 */

function cloneManifest(manifest: IndustryTemplateManifest): IndustryTemplateManifest {
  return JSON.parse(JSON.stringify(manifest)) as IndustryTemplateManifest;
}

/** Recursively reverse the key order of every object — a key-order permutation. */
function reversedKeyOrder(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(reversedKeyOrder);
  }
  if (typeof value === "object" && value !== null) {
    const out: Record<string, unknown> = {};
    for (const key of Object.keys(value).reverse()) {
      out[key] = reversedKeyOrder((value as Record<string, unknown>)[key]);
    }
    return out;
  }
  return value;
}

interface ExpectedIssue {
  path: string;
  code: string;
  messagePattern?: RegExp;
}

/**
 * Mutate a fresh copy of the retail manifest and assert the §3 schema rejects
 * it with EXACTLY ONE issue at the expected path/code (surgical violations —
 * one rule broken per fixture).
 */
function expectSingleIssue(
  mutate: (draft: IndustryTemplateManifest) => void,
  expected: ExpectedIssue,
): void {
  const draft = cloneManifest(RETAIL_MANIFEST);
  mutate(draft);
  const result = IndustryTemplateManifestSchema.safeParse(draft);
  expect(result.success).toBe(false);
  if (result.success) {
    throw new Error("unreachable: expected the mutated manifest to be rejected");
  }
  expect(result.error.issues).toHaveLength(1);
  const issue = result.error.issues[0]!;
  expect(issue.path.length === 0 ? "(root)" : issue.path.map(String).join(".")).toBe(expected.path);
  expect(issue.code).toBe(expected.code);
  if (expected.messagePattern) {
    expect(issue.message).toMatch(expected.messagePattern);
  }
}

describe("shipped industry template manifests (v1.0.0 — retail / grocery / restaurant / automotive / distribution / food_manufacturing / professional_services / education / agriculture / wholesale / electronics / healthcare / rental_logistics)", () => {
  it("all thirteen parse against the §3 schema and round-trip identically", () => {
    for (const manifest of SHIPPED_TEMPLATE_MANIFESTS) {
      expect(parseIndustryTemplateManifest(manifest)).toStrictEqual(manifest);
    }
  });

  it("the registry ships exactly the thirteen ids at 1.0.0", () => {
    expect(SHIPPED_TEMPLATE_MANIFESTS.map((manifest) => manifest.id)).toEqual([
      "industry.retail",
      "industry.grocery",
      "industry.restaurant",
      "industry.automotive",
      "industry.distribution",
      "industry.food_manufacturing",
      "industry.professional_services",
      "industry.education",
      "industry.agriculture",
      "industry.wholesale",
      "industry.electronics",
      "industry.healthcare",
      "industry.rental_logistics",
    ]);
    expect(SHIPPED_TEMPLATE_MANIFESTS.every((manifest) => manifest.version === "1.0.0")).toBe(true);
  });

  it("manifest constants are deep-frozen (registry data is platform-owned, §8)", () => {
    for (const manifest of SHIPPED_TEMPLATE_MANIFESTS) {
      expect(Object.isFrozen(manifest)).toBe(true);
      expect(Object.isFrozen(manifest.inventory_policy_defaults)).toBe(true);
      expect(Object.isFrozen(manifest.terminology_overrides)).toBe(true);
      expect(Object.isFrozen(manifest.navigation_manifest.groups)).toBe(true);
      expect(Object.isFrozen(manifest.onboarding_steps)).toBe(true);
    }
    expect(Object.isFrozen(SHIPPED_TEMPLATE_MANIFESTS)).toBe(true);
  });

  it("the §3 schema is registered under its stable contract key (ADR-0002)", () => {
    expect(getContractSchema("industry.template-manifest.v1")).toBe(IndustryTemplateManifestSchema);
  });

  it("the PHASE-017 pair pins the live report keys (0025 reconciliation)", () => {
    // inventory.valuation / ar.aging are the live report-registry keys — the
    // pre-0025 doc drafts said inventory.stock_valuation / partners.ar_aging.
    expect(AUTOMOTIVE_TEMPLATE_MANIFEST.report_defaults.map((pin) => pin.report_key)).toEqual([
      "automotive.job_card_profitability",
      "automotive.vehicle_service_history",
      "inventory.valuation",
      "ar.aging",
    ]);
    expect(
      DISTRIBUTION_TEMPLATE_MANIFEST.report_defaults.map((pin) => pin.report_key),
    ).toEqual([
      "distribution.rep_settlement",
      "distribution.van_stock_balances",
      "distribution.route_visit_compliance",
      "sales.discount_management_effectiveness",
      "sales.commissions_due",
    ]);
    // The workshop + parts / field + settle navigation groups ship as-is.
    expect(AUTOMOTIVE_TEMPLATE_MANIFEST.navigation_manifest.groups.map((group) => group.id)).toEqual([
      "workshop",
      "parts",
    ]);
    expect(
      DISTRIBUTION_TEMPLATE_MANIFEST.navigation_manifest.groups.map((group) => group.id),
    ).toEqual(["field", "settle"]);
    // The PHASE-017 intake key rides in automotive's required set.
    expect(AUTOMOTIVE_TEMPLATE_MANIFEST.required_feature_keys).toContain("sales.job_cards");
  });

  it("the PHASE-018 template pins the live manufacturing report keys (0026)", () => {
    // The food_manufacturing report defaults pin the PHASE-018 registry keys
    // (manufacturing.production_cost / batch_genealogy /
    // qc_inspection_log) plus the two expiry reports the template composes
    // from the already-shipped grocery/inventory catalogs.
    expect(
      FOOD_MANUFACTURING_TEMPLATE_MANIFEST.report_defaults.map((pin) => pin.report_key),
    ).toEqual([
      "manufacturing.production_cost",
      "manufacturing.batch_genealogy",
      "manufacturing.qc_inspection_log",
      "inventory.expiry_list",
      "grocery.expiry_writeoff",
    ]);
    // The production/traceability navigation groups ship as-is.
    expect(
      FOOD_MANUFACTURING_TEMPLATE_MANIFEST.navigation_manifest.groups.map((group) => group.id),
    ).toEqual(["production", "trace"]);
    // The manufacturing capability set rides in the required keys (the
    // 0026 plan grants cover it on business/enterprise).
    for (const key of [
      "manufacturing.bom",
      "manufacturing.production_orders",
      "manufacturing.qc",
      "manufacturing.batch_genealogy",
    ]) {
      expect(FOOD_MANUFACTURING_TEMPLATE_MANIFEST.required_feature_keys).toContain(key);
    }
    // The four PHASE-018 workflow policies land as L1 defaults
    // (production_qc_gate → manufacturing.qc_gate via POLICY_REGISTRY).
    expect(FOOD_MANUFACTURING_TEMPLATE_MANIFEST.workflow_policies).toMatchObject({
      production_qc_gate: "required",
      scrap_reason_required: true,
      fg_batch_expiry_from_shelf_life: true,
      consumption_variance_threshold_pct: 5,
    });
    // The PRD- numbering rule: per-branch, reserved at approval.
    expect(FOOD_MANUFACTURING_TEMPLATE_MANIFEST.document_numbering_defaults.production_order)
      .toEqual({
        prefix: "PRD",
        format: "PRD-{yyyy}-{seq:5}",
        per_branch: true,
        reserve_on_approval: true,
      });
  });

  it("the PHASE-019 template pins the practice/billing navigation and the crm policy set (0027)", () => {
    // The report pins: the two PHASE-019 services.* registry keys plus the
    // composed already-live `ar.aging` (the §12 doc reconciliation — the
    // pre-0027 doc draft said partners.ar_aging) and sales.commissions_due.
    expect(
      PROFESSIONAL_SERVICES_TEMPLATE_MANIFEST.report_defaults.map((pin) => pin.report_key),
    ).toEqual([
      "services.contract_revenue_schedule",
      "services.time_billing_summary",
      "ar.aging",
      "sales.commissions_due",
    ]);
    expect(
      PROFESSIONAL_SERVICES_TEMPLATE_MANIFEST.report_defaults.find(
        (pin) => pin.report_key === "ar.aging",
      ),
    ).toMatchObject({ pinned: true, dashboard: false, default_period: "this_month" });
    // The practice/billing navigation groups ship as-is with the §14 target
    // keys (crm.time / crm.contracts / crm.recurring_billing /
    // accounting.projects).
    expect(
      PROFESSIONAL_SERVICES_TEMPLATE_MANIFEST.navigation_manifest.groups.map(
        (group) => group.id,
      ),
    ).toEqual(["practice", "billing"]);
    const practice = PROFESSIONAL_SERVICES_TEMPLATE_MANIFEST.navigation_manifest.groups.find(
      (group) => group.id === "practice",
    )!;
    expect(practice.items.map((item) => item.target)).toEqual([
      "accounting.projects",
      "crm.time",
      "crm.contracts",
    ]);
    const billing = PROFESSIONAL_SERVICES_TEMPLATE_MANIFEST.navigation_manifest.groups.find(
      (group) => group.id === "billing",
    )!;
    expect(billing.items.map((item) => item.target)).toEqual([
      "crm.recurring_billing",
      "sales.invoices",
      "partners.statements",
    ]);
    // The PHASE-019 intake set rides in the required keys (the 0027 plan
    // grants cover it on business/enterprise; starter excluded).
    for (const key of [
      "crm.service_contracts",
      "crm.recurring_billing",
      "accounting.projects",
    ]) {
      expect(PROFESSIONAL_SERVICES_TEMPLATE_MANIFEST.required_feature_keys).toContain(key);
    }
    // The six §9 workflow policies land as L1 defaults (module "crm"; the
    // crm.* names map onto the SETTINGS_REGISTRY keys via POLICY_REGISTRY
    // settingsKey — e.g. contract_billing_mode → crm.contract_billing_mode).
    expect(PROFESSIONAL_SERVICES_TEMPLATE_MANIFEST.workflow_policies).toEqual({
      contract_billing_mode: "retainer_or_milestones",
      time_entries_require_case: true,
      unbilled_time_review_before_invoice: true,
      invoice_approval_required: true,
      invoice_numbering_per_series: false,
      narrative_required_on_time_billing: true,
    });
    // The INV-/RCP-/CN- numbering rules (contract_invoice is a series-bearing
    // §3 document type; all four series are tenant-level, assigned at
    // posting).
    expect(PROFESSIONAL_SERVICES_TEMPLATE_MANIFEST.document_numbering_defaults.contract_invoice)
      .toEqual({
        prefix: "INV",
        format: "INV-{yyyy}-{seq:6}",
        per_branch: false,
        reserve_on_approval: false,
      });
    expect(PROFESSIONAL_SERVICES_TEMPLATE_MANIFEST.document_numbering_defaults.receipt).toEqual({
      prefix: "RCP",
      format: "RCP-{yyyy}-{seq:6}",
      per_branch: false,
      reserve_on_approval: false,
    });
    expect(PROFESSIONAL_SERVICES_TEMPLATE_MANIFEST.document_numbering_defaults.credit_note).toEqual({
      prefix: "CN",
      format: "CN-{yyyy}-{seq:5}",
      per_branch: false,
      reserve_on_approval: false,
    });
    // The terminology carries the practice-management Arabic (svc.case).
    expect(PROFESSIONAL_SERVICES_TEMPLATE_MANIFEST.terminology_overrides["svc.case"]).toEqual({
      en: "Case / Matter",
      ar: "القضية / الملف",
    });
  });

  it("the PHASE-032 template pins the enrollment/billing navigation and the tuition policy set (0039)", () => {
    // The report pins: the two PHASE-027 installments registry keys plus the
    // composed already-live `services.contract_revenue_schedule` (PHASE-019)
    // and `ar.aging` (the §J doc reconciliation — the pre-0039 doc draft
    // said partners.ar_aging, exactly the §12 precedent on the 0027
    // professional_services transcription).
    expect(EDUCATION_TEMPLATE_MANIFEST.report_defaults.map((pin) => pin.report_key)).toEqual([
      "installments.schedule",
      "installments.aging",
      "services.contract_revenue_schedule",
      "ar.aging",
    ]);
    expect(
      EDUCATION_TEMPLATE_MANIFEST.report_defaults.find((pin) => pin.report_key === "ar.aging"),
    ).toMatchObject({ pinned: true, dashboard: false, default_period: "this_month" });
    expect(
      EDUCATION_TEMPLATE_MANIFEST.report_defaults.find(
        (pin) => pin.report_key === "installments.schedule",
      ),
    ).toMatchObject({ pinned: true, dashboard: true, default_period: "this_month" });
    // The enrollment/billing navigation groups ship as-is with the §J
    // targets (crm.contracts / partners.directory / items.price_lists /
    // installments.plans / sales.invoices / installments.collections /
    // treasury.receipts — ordinary surfaces, zero education-specific ones).
    expect(
      EDUCATION_TEMPLATE_MANIFEST.navigation_manifest.groups.map((group) => group.id),
    ).toEqual(["enrollment", "billing"]);
    const enrollment = EDUCATION_TEMPLATE_MANIFEST.navigation_manifest.groups.find(
      (group) => group.id === "enrollment",
    )!;
    expect(enrollment.items.map((item) => item.target)).toEqual([
      "crm.contracts",
      "partners.directory",
      "items.price_lists",
    ]);
    const tuitionBilling = EDUCATION_TEMPLATE_MANIFEST.navigation_manifest.groups.find(
      (group) => group.id === "billing",
    )!;
    expect(tuitionBilling.items.map((item) => item.target)).toEqual([
      "installments.plans",
      "sales.invoices",
      "installments.collections",
      "treasury.receipts",
    ]);
    // The tuition backbone rides in the required keys: the PHASE-027
    // installments chain (granted to business/enterprise by migration 0038)
    // + the crm enrollment-contract source (0027) + the engine itself.
    for (const key of [
      "industry.template_engine",
      "crm.service_contracts",
      "installments.plans",
      "installments.collections",
      "installments.late_fees",
    ]) {
      expect(EDUCATION_TEMPLATE_MANIFEST.required_feature_keys).toContain(key);
    }
    // The seven §2 workflow policies land as L1 defaults: six education-owned
    // POLICY_REGISTRY keys (no settingsKey mapping — the deliberate 0039
    // choice) + invoice_approval_required REUSING the PHASE-019 crm key
    // (templates never fork policy keys).
    expect(EDUCATION_TEMPLATE_MANIFEST.workflow_policies).toEqual({
      guardian_is_paying_partner: true,
      tuition_invoice_from_contract: true,
      installment_schedule_immutable_after_activation: true,
      late_fee_policy_per_plan: true,
      sibling_discount_line_level: true,
      dunning_cycle_before_late_fee: true,
      invoice_approval_required: true,
    });
    // The INV-/RCP-/CN- numbering rules (contract_invoice is a series-bearing
    // §3 document type; all four series are tenant-level, assigned at
    // posting — identical to the professional_services posture).
    expect(EDUCATION_TEMPLATE_MANIFEST.document_numbering_defaults.contract_invoice).toEqual({
      prefix: "INV",
      format: "INV-{yyyy}-{seq:6}",
      per_branch: false,
      reserve_on_approval: false,
    });
    expect(EDUCATION_TEMPLATE_MANIFEST.document_numbering_defaults.receipt).toEqual({
      prefix: "RCP",
      format: "RCP-{yyyy}-{seq:6}",
      per_branch: false,
      reserve_on_approval: false,
    });
    expect(EDUCATION_TEMPLATE_MANIFEST.document_numbering_defaults.credit_note).toEqual({
      prefix: "CN",
      format: "CN-{yyyy}-{seq:5}",
      per_branch: false,
      reserve_on_approval: false,
    });
    // The terminology carries the tuition Arabic (partner.student /
    // partner.guardian — the ED-11 financial-file posture, never academic).
    expect(EDUCATION_TEMPLATE_MANIFEST.terminology_overrides["partner.student"]).toEqual({
      en: "Student (financial file)",
      ar: "الطالب (الملف المالي)",
    });
    expect(EDUCATION_TEMPLATE_MANIFEST.terminology_overrides["partner.guardian"]).toEqual({
      en: "Guardian (payer)",
      ar: "ولي الأمر (الدافع)",
    });
    // The capability posture: installment_terms REQUIRED at PHASE-027 (the
    // highest education gate — shipped, so never phase-gated) and pdc_notes
    // OPTIONAL riding the 0038 notes.received grant (governance #7).
    expect(EDUCATION_TEMPLATE_MANIFEST.capability_prerequisites.installment_terms).toEqual({
      level: "REQUIRED",
      feature_keys: ["installments.plans", "installments.collections", "installments.late_fees"],
      available_from_phase: "PHASE-027",
    });
    expect(EDUCATION_TEMPLATE_MANIFEST.capability_prerequisites.pdc_notes).toEqual({
      level: "OPTIONAL",
      feature_keys: ["notes.received"],
      available_from_phase: "PHASE-027",
    });
  });

  it("the PHASE-033 template pins the season/harvest navigation and the agriculture policy set (0040)", () => {
    // The report pins: the two live manufacturing registry keys plus the
    // two live inventory keys — inventory.valuation being the §J
    // reconciliation (the pre-0040 doc draft said inventory.stock_valuation,
    // exactly the §12 precedent on the 0025 automotive transcription and
    // the §J precedent on the 0039 education transcription).
    expect(AGRICULTURE_TEMPLATE_MANIFEST.report_defaults.map((pin) => pin.report_key)).toEqual([
      "manufacturing.production_cost",
      "inventory.valuation",
      "inventory.expiry_list",
      "manufacturing.batch_genealogy",
    ]);
    expect(
      AGRICULTURE_TEMPLATE_MANIFEST.report_defaults.find(
        (pin) => pin.report_key === "manufacturing.production_cost",
      ),
    ).toMatchObject({ pinned: true, dashboard: true, default_period: "this_year" });
    expect(
      AGRICULTURE_TEMPLATE_MANIFEST.report_defaults.find(
        (pin) => pin.report_key === "inventory.valuation",
      ),
    ).toMatchObject({ pinned: true, dashboard: false, default_period: "custom" });
    // The season/harvest navigation groups ship as-is with the §2 targets
    // (accounting.projects / manufacturing.bom / manufacturing.orders /
    // inventory.batches / sales.invoices / inventory.serials — ordinary
    // surfaces, zero agriculture-specific ones).
    expect(
      AGRICULTURE_TEMPLATE_MANIFEST.navigation_manifest.groups.map((group) => group.id),
    ).toEqual(["season", "harvest"]);
    const season = AGRICULTURE_TEMPLATE_MANIFEST.navigation_manifest.groups.find(
      (group) => group.id === "season",
    )!;
    expect(season.items.map((item) => item.target)).toEqual([
      "accounting.projects",
      "manufacturing.bom",
      "manufacturing.orders",
    ]);
    const harvestTrade = AGRICULTURE_TEMPLATE_MANIFEST.navigation_manifest.groups.find(
      (group) => group.id === "harvest",
    )!;
    expect(harvestTrade.items.map((item) => item.target)).toEqual([
      "inventory.batches",
      "sales.invoices",
      "inventory.serials",
    ]);
    // The season backbone rides in the required keys: the PHASE-018
    // manufacturing chain (granted to business/enterprise by migration 0026)
    // + the PHASE-019 projects dimension (0027) + the PHASE-010 batch
    // tracking + the starter-base purchasing/sales + the engine itself —
    // ZERO new grants needed (the first template whose REQUIRED chain
    // resolves entirely through already-transcribed grants).
    for (const key of [
      "industry.template_engine",
      "manufacturing.bom",
      "manufacturing.production_orders",
      "inventory.batch_tracking",
      "purchasing.orders",
      "purchasing.goods_receipts",
      "sales.invoices",
      "accounting.projects",
      "accounting.cost_centers",
    ]) {
      expect(AGRICULTURE_TEMPLATE_MANIFEST.required_feature_keys).toContain(key);
    }
    // The six §2 workflow policies land as L1 defaults: four agriculture-owned
    // POLICY_REGISTRY keys (no settingsKey mapping — the deliberate 0040
    // choice, the 0039 precedent) + scrap_reason_required and
    // consumption_variance_threshold_pct REUSING the PHASE-018 manufacturing
    // keys (templates never fork policy keys).
    expect(AGRICULTURE_TEMPLATE_MANIFEST.workflow_policies).toEqual({
      cycle_order_per_field_project: true,
      harvest_batch_genealogy_enabled: true,
      field_cost_center_mandatory_on_cycle: true,
      scrap_reason_required: true,
      consumption_variance_threshold_pct: 5,
      livestock_serial_per_head: true,
    });
    // The CYC/GRN/INV/DLV/TRF numbering rules (production_order is the one
    // series-bearing document with per_branch + reserve_on_approval — CYC
    // reserved at release per the §2 policy; the rest tenant-level).
    expect(AGRICULTURE_TEMPLATE_MANIFEST.document_numbering_defaults.production_order).toEqual({
      prefix: "CYC",
      format: "CYC-{yyyy}-{seq:5}",
      per_branch: true,
      reserve_on_approval: true,
    });
    expect(AGRICULTURE_TEMPLATE_MANIFEST.document_numbering_defaults.goods_receipt).toEqual({
      prefix: "GRN",
      format: "GRN-{yyyy}-{seq:6}",
      per_branch: false,
      reserve_on_approval: false,
    });
    expect(AGRICULTURE_TEMPLATE_MANIFEST.document_numbering_defaults.stock_transfer).toEqual({
      prefix: "TRF",
      format: "TRF-{yyyy}-{seq:5}",
      per_branch: false,
      reserve_on_approval: false,
    });
    // The terminology carries the season Arabic (crop.cycle the الدورة
    // الزراعية, harvest.batch the دفعة الحصاد, livestock.head the رأس).
    expect(AGRICULTURE_TEMPLATE_MANIFEST.terminology_overrides["crop.cycle"]).toEqual({
      en: "Crop cycle",
      ar: "الدورة الزراعية",
    });
    expect(AGRICULTURE_TEMPLATE_MANIFEST.terminology_overrides["harvest.batch"]).toEqual({
      en: "Harvest batch",
      ar: "دفعة الحصاد",
    });
    expect(AGRICULTURE_TEMPLATE_MANIFEST.terminology_overrides["livestock.head"]).toEqual({
      en: "Livestock head",
      ar: "رأس",
    });
    expect(AGRICULTURE_TEMPLATE_MANIFEST.terminology_overrides["mfg.scrap"]).toEqual({
      en: "Crop loss",
      ar: "الفاقد",
    });
    // The capability posture: crop_cycle_costing REQUIRED at PHASE-033 (the
    // template's own availability marker — its keys resolve through grants
    // shipped ≤ 019, so it classifies INCLUDED on plans that grant them;
    // the phase gate only labels MISSING keys) and pdc_notes OPTIONAL
    // riding the 0038 notes.received grant (governance #7), with
    // shipment_tracking OPTIONAL on the ungranted §17 pending-intake key
    // (degrades HIDDEN — the upgrade-path posture).
    expect(AGRICULTURE_TEMPLATE_MANIFEST.capability_prerequisites.crop_cycle_costing).toEqual({
      level: "REQUIRED",
      feature_keys: ["manufacturing.bom", "manufacturing.production_orders", "accounting.projects"],
      available_from_phase: "PHASE-033",
    });
    expect(AGRICULTURE_TEMPLATE_MANIFEST.capability_prerequisites.harvest_batches).toEqual({
      level: "REQUIRED",
      feature_keys: ["inventory.batch_tracking", "manufacturing.batch_genealogy"],
      available_from_phase: "PHASE-018",
    });
    expect(AGRICULTURE_TEMPLATE_MANIFEST.capability_prerequisites.pdc_notes).toEqual({
      level: "OPTIONAL",
      feature_keys: ["notes.received"],
      available_from_phase: "PHASE-027",
    });
    expect(AGRICULTURE_TEMPLATE_MANIFEST.capability_prerequisites.shipment_tracking).toEqual({
      level: "OPTIONAL",
      feature_keys: ["distribution.shipment_tracking"],
      available_from_phase: "PHASE-019",
    });
    // The inventory defaults pin the produce posture: WAC costing, batch +
    // expiry on (perishability windows), FEFO picking on, serial per
    // category (livestock opt-in), negative stock forbidden.
    expect(AGRICULTURE_TEMPLATE_MANIFEST.inventory_policy_defaults).toEqual({
      costing_method: "WAC",
      default_track_batch: true,
      default_track_expiry: true,
      default_track_serial: false,
      default_imei_tracking: false,
      fefo_picking: true,
      allow_negative_stock: false,
    });
  });

  it("the PHASE-030 wholesale template pins the live report keys and the trading/credit groups (0044)", () => {
    // The report pins: the two PHASE-027 notes.* registry keys plus the
    // composed already-live `ar.aging` + `inventory.valuation` (the 0044
    // reconciliation — the pre-0044 doc drafts said partners.ar_aging /
    // inventory.stock_valuation, the 0025/0027 convention).
    expect(WHOLESALE_TEMPLATE_MANIFEST.report_defaults.map((pin) => pin.report_key)).toEqual([
      "notes.maturity-calendar",
      "notes.aging",
      "ar.aging",
      "inventory.valuation",
    ]);
    expect(
      WHOLESALE_TEMPLATE_MANIFEST.report_defaults.find((pin) => pin.report_key === "ar.aging"),
    ).toMatchObject({ pinned: true, dashboard: true, default_period: "this_month" });
    // The trading + credit & collections navigation groups ship as-is.
    expect(WHOLESALE_TEMPLATE_MANIFEST.navigation_manifest.groups.map((group) => group.id)).toEqual(
      ["trading", "credit"],
    );
    const trading = WHOLESALE_TEMPLATE_MANIFEST.navigation_manifest.groups.find(
      (group) => group.id === "trading",
    )!;
    expect(trading.items.map((item) => item.target)).toEqual([
      "sales.quick_order",
      "sales.quotations",
      "sales.orders",
      "sales.deliveries",
    ]);
    const credit = WHOLESALE_TEMPLATE_MANIFEST.navigation_manifest.groups.find(
      (group) => group.id === "credit",
    )!;
    expect(credit.items.map((item) => item.target)).toEqual([
      "sales.invoices",
      "partners.statements",
      "notes.received",
      "notes.pdc_calendar",
    ]);
    // The PDC entries carry their feature_key gates (notes.received /
    // notes.pdc_calendar — the §3.13 keys the 0038 grants put on
    // business+enterprise).
    expect(credit.items.find((item) => item.target === "notes.received")?.feature_key).toBe(
      "notes.received",
    );
    // The notes chain rides in the required keys + the pdc_notes capability
    // (REQUIRED, PHASE-027 — live platform-wide since stage 9).
    expect(WHOLESALE_TEMPLATE_MANIFEST.required_feature_keys).toContain("notes.received");
    expect(WHOLESALE_TEMPLATE_MANIFEST.capability_prerequisites.pdc_notes).toEqual({
      level: "REQUIRED",
      feature_keys: ["notes.received", "notes.pdc_calendar"],
      available_from_phase: "PHASE-027",
    });
    // The seven §2 wholesale workflow policies land as L1 defaults
    // (qty_break_pricing_automatic / tier_price_automatic_by_partner /
    // bulk_order_from_quote_one_click / delivery_before_credit_invoice /
    // statement_monthly_by_default / pdc_note_requires_maturity_date are
    // POLICY_REGISTRY keys the 0044 wave registers; credit_sale_credit_limit_
    // enforced rides the PHASE-017 registration verbatim).
    expect(WHOLESALE_TEMPLATE_MANIFEST.workflow_policies).toEqual({
      credit_sale_credit_limit_enforced: true,
      qty_break_pricing_automatic: true,
      tier_price_automatic_by_partner: true,
      bulk_order_from_quote_one_click: true,
      delivery_before_credit_invoice: true,
      statement_monthly_by_default: true,
      pdc_note_requires_maturity_date: true,
    });
    // The QT/ORD/DLV/INV/CN/RCP/GRN/TRF numbering rules — the ORD- bulk
    // order series is reserved at approval (§3 reserve_on_approval).
    expect(WHOLESALE_TEMPLATE_MANIFEST.document_numbering_defaults.sales_order).toEqual({
      prefix: "ORD",
      format: "ORD-{yyyy}-{seq:6}",
      per_branch: false,
      reserve_on_approval: true,
    });
    expect(WHOLESALE_TEMPLATE_MANIFEST.document_numbering_defaults.quotation).toEqual({
      prefix: "QT",
      format: "QT-{yyyy}-{seq:5}",
      per_branch: false,
      reserve_on_approval: false,
    });
    // The trading Arabic (أمر التوريد / شريحة الكمية).
    expect(WHOLESALE_TEMPLATE_MANIFEST.terminology_overrides["doc.sales_order"]).toEqual({
      en: "Bulk order",
      ar: "أمر التوريد",
    });
    expect(WHOLESALE_TEMPLATE_MANIFEST.terminology_overrides["price.qty_break"]).toEqual({
      en: "Quantity break",
      ar: "شريحة الكمية",
    });
  });

  it("the PHASE-030 electronics template pins the counter/repair groups and the serial-on defaults (0044)", () => {
    // The report pins: retail.imei_register (dashboard) + the two pos.*
    // live keys + inventory.valuation (the 0044 reconciliation — the doc
    // draft said inventory.stock_valuation).
    expect(ELECTRONICS_TEMPLATE_MANIFEST.report_defaults.map((pin) => pin.report_key)).toEqual([
      "retail.imei_register",
      "pos.sales_by_terminal",
      "pos.sales_by_hour",
      "inventory.valuation",
    ]);
    expect(
      ELECTRONICS_TEMPLATE_MANIFEST.report_defaults.find(
        (pin) => pin.report_key === "retail.imei_register",
      ),
    ).toMatchObject({ pinned: true, dashboard: true, default_period: "this_month" });
    // The counter + repair navigation groups ship as-is.
    expect(
      ELECTRONICS_TEMPLATE_MANIFEST.navigation_manifest.groups.map((group) => group.id),
    ).toEqual(["counter", "service"]);
    const counter = ELECTRONICS_TEMPLATE_MANIFEST.navigation_manifest.groups.find(
      (group) => group.id === "counter",
    )!;
    expect(counter.items.map((item) => item.target)).toEqual([
      "pos.counter",
      "inventory.imei",
      "purchasing.tradein",
    ]);
    const service = ELECTRONICS_TEMPLATE_MANIFEST.navigation_manifest.groups.find(
      (group) => group.id === "service",
    )!;
    expect(service.items.map((item) => item.target)).toEqual([
      "crm.service_orders",
      "sales.credit_notes",
      "treasury.receipts",
    ]);
    // The REQUIRED chain: the pos.* set + crm.service_orders + serials.
    for (const key of [
      "inventory.serial_tracking",
      "pos.terminals",
      "pos.sales",
      "pos.offline_queue",
      "pos.receipts",
      "crm.service_orders",
      "treasury.cashier_shifts",
    ]) {
      expect(ELECTRONICS_TEMPLATE_MANIFEST.required_feature_keys).toContain(key);
    }
    expect(ELECTRONICS_TEMPLATE_MANIFEST.capability_prerequisites.job_cards).toEqual({
      level: "REQUIRED",
      feature_keys: ["crm.service_orders"],
      available_from_phase: "PHASE-019",
    });
    expect(ELECTRONICS_TEMPLATE_MANIFEST.capability_prerequisites.imei_tracking).toEqual({
      level: "REQUIRED",
      feature_keys: ["inventory.serial_tracking"],
      available_from_phase: "PHASE-010",
    });
    // R3: serial + IMEI tracking ON by default for NEWLY created items.
    expect(ELECTRONICS_TEMPLATE_MANIFEST.inventory_policy_defaults).toMatchObject({
      costing_method: "WAC",
      default_track_serial: true,
      default_imei_tracking: true,
      allow_negative_stock: false,
    });
    // The seven §2 electronics workflow policies (cash_sales_autopost /
    // shift_variance_approval_required / warranty_credit_note_requires_
    // original_invoice ride the earlier registrations verbatim; the four
    // repair/trade-in keys are the 0044 POLICY_REGISTRY wave).
    expect(ELECTRONICS_TEMPLATE_MANIFEST.workflow_policies).toEqual({
      cash_sales_autopost: true,
      imei_capture_required_flagged_items: true,
      repair_parts_issue_mode: "reserve",
      repair_card_labor_rate_source: "price_list",
      tradein_purchase_at_branch: true,
      warranty_credit_note_requires_original_invoice: true,
      shift_variance_approval_required: true,
    });
    // The INV/POS/RC/CN/GRN numbering rules — RC- repair cards are
    // per-branch (§3).
    expect(ELECTRONICS_TEMPLATE_MANIFEST.document_numbering_defaults.job_card).toEqual({
      prefix: "RC",
      format: "RC-{yyyy}-{seq:5}",
      per_branch: true,
      reserve_on_approval: false,
    });
    // The repair-bench Arabic (بطاقة صيانة / الرقم التسلسلي (IMEI)).
    expect(ELECTRONICS_TEMPLATE_MANIFEST.terminology_overrides["svc.repair_card"]).toEqual({
      en: "Repair card",
      ar: "بطاقة صيانة",
    });
    expect(ELECTRONICS_TEMPLATE_MANIFEST.terminology_overrides["item.imei"]).toEqual({
      en: "IMEI",
      ar: "الرقم التسلسلي (IMEI)",
    });
  });

  it("the PHASE-031 healthcare template pins the live report keys and the billing/pharmacy groups (0046)", () => {
    // The report pins: the two PHASE-027 notes.* registry keys (both
    // dashboard — the billing desk's claim aging + PDC calendar) plus the
    // composed already-live `ar.aging` (the 0046 reconciliation — the doc
    // draft said partners.ar_aging, the 0025/0027/0044 convention) and
    // inventory.expiry_list (the PHASE-015 industry contract, verbatim —
    // الرقابة على الصلاحية).
    expect(HEALTHCARE_TEMPLATE_MANIFEST.report_defaults.map((pin) => pin.report_key)).toEqual([
      "notes.aging",
      "notes.maturity-calendar",
      "ar.aging",
      "inventory.expiry_list",
    ]);
    expect(
      HEALTHCARE_TEMPLATE_MANIFEST.report_defaults.find((pin) => pin.report_key === "notes.aging"),
    ).toMatchObject({ pinned: true, dashboard: true, default_period: "this_month" });
    expect(
      HEALTHCARE_TEMPLATE_MANIFEST.report_defaults.find(
        (pin) => pin.report_key === "notes.maturity-calendar",
      ),
    ).toMatchObject({ pinned: true, dashboard: true, default_period: "this_month" });
    expect(
      HEALTHCARE_TEMPLATE_MANIFEST.report_defaults.find((pin) => pin.report_key === "ar.aging"),
    ).toMatchObject({ pinned: true, dashboard: false, default_period: "this_month" });
    expect(
      HEALTHCARE_TEMPLATE_MANIFEST.report_defaults.find(
        (pin) => pin.report_key === "inventory.expiry_list",
      ),
    ).toMatchObject({ pinned: true, dashboard: false, default_period: "this_week" });
    // The billing + pharmacy navigation groups ship as-is.
    expect(HEALTHCARE_TEMPLATE_MANIFEST.navigation_manifest.groups.map((group) => group.id)).toEqual(
      ["billing", "pharmacy"],
    );
    const billing = HEALTHCARE_TEMPLATE_MANIFEST.navigation_manifest.groups.find(
      (group) => group.id === "billing",
    )!;
    expect(billing.items.map((item) => item.target)).toEqual([
      "crm.service_orders",
      "sales.invoices",
      "partners.statements",
    ]);
    const pharmacy = HEALTHCARE_TEMPLATE_MANIFEST.navigation_manifest.groups.find(
      (group) => group.id === "pharmacy",
    )!;
    expect(pharmacy.items.map((item) => item.target)).toEqual([
      "inventory.expiry_list",
      "pos.counter",
      "notes.received",
    ]);
    // The gated entries carry their feature_key gates (the visits entry on
    // crm.service_orders; the expiry entry on inventory.batch_tracking; the
    // claims-cheques entry on notes.received — the §3.13/0027/0038 keys).
    expect(billing.items.find((item) => item.target === "crm.service_orders")?.feature_key).toBe(
      "crm.service_orders",
    );
    expect(pharmacy.items.find((item) => item.target === "inventory.expiry_list")?.feature_key).toBe(
      "inventory.batch_tracking",
    );
    expect(pharmacy.items.find((item) => item.target === "notes.received")?.feature_key).toBe(
      "notes.received",
    );
    // The claim chain rides in the required keys + the shell's OWN
    // insurance_claim_billing capability (REQUIRED, PHASE-031 — live at its
    // release) + the REQUIRED pdc_notes (claims settle by cheque/PDC, so
    // 027 is a prerequisite of this template).
    expect(HEALTHCARE_TEMPLATE_MANIFEST.required_feature_keys).toContain("notes.received");
    expect(HEALTHCARE_TEMPLATE_MANIFEST.required_feature_keys).toContain("crm.service_orders");
    expect(HEALTHCARE_TEMPLATE_MANIFEST.capability_prerequisites.insurance_claim_billing).toEqual({
      level: "REQUIRED",
      feature_keys: ["sales.invoices", "notes.received", "partners.statements"],
      available_from_phase: "PHASE-031",
    });
    expect(HEALTHCARE_TEMPLATE_MANIFEST.capability_prerequisites.pdc_notes).toEqual({
      level: "REQUIRED",
      feature_keys: ["notes.received", "notes.pdc_calendar"],
      available_from_phase: "PHASE-027",
    });
    // The six §2 healthcare workflow policies land as L1 defaults
    // (claim_ref_required_for_insured_invoices maps onto the
    // sales.claim_ref_required_for_insured settings key — the L5 override
    // surface; the other five are registry-only).
    expect(HEALTHCARE_TEMPLATE_MANIFEST.workflow_policies).toEqual({
      patient_file_financial_only: true,
      claim_ref_required_for_insured_invoices: true,
      insurance_invoice_billed_to_company_partner: true,
      pharmacy_fefo_enforced: true,
      dunning_by_claim_enabled: true,
      insurance_credit_limit_per_company: true,
    });
    // The INV/CN/RCP/GRN numbering rules — all posting-assigned (the §3
    // healthcare defaults; no per-branch series).
    expect(HEALTHCARE_TEMPLATE_MANIFEST.document_numbering_defaults.sales_invoice).toEqual({
      prefix: "INV",
      format: "INV-{yyyy}-{seq:6}",
      per_branch: false,
      reserve_on_approval: false,
    });
    expect(HEALTHCARE_TEMPLATE_MANIFEST.document_numbering_defaults.receipt).toEqual({
      prefix: "RCP",
      format: "RCP-{yyyy}-{seq:6}",
      per_branch: false,
      reserve_on_approval: false,
    });
    // The pharmacy defaults: batch + expiry ON, serial OFF, FEFO ON — the
    // FEFO store reusing inventory.batch_tracking unchanged (new items only,
    // §5 R3).
    expect(HEALTHCARE_TEMPLATE_MANIFEST.inventory_policy_defaults).toMatchObject({
      costing_method: "WAC",
      default_track_batch: true,
      default_track_expiry: true,
      default_track_serial: false,
      default_imei_tracking: false,
      fefo_picking: true,
      allow_negative_stock: false,
    });
    // The billing-desk Arabic (المريض (الملف المالي) / مطالبة تأمينية /
    // دفع مباشر) — the commercial-shell vocabulary, financial file first.
    expect(HEALTHCARE_TEMPLATE_MANIFEST.terminology_overrides["partner.patient"]).toEqual({
      en: "Patient (financial file)",
      ar: "المريض (الملف المالي)",
    });
    expect(HEALTHCARE_TEMPLATE_MANIFEST.terminology_overrides["claim.ref"]).toEqual({
      en: "Insurance claim",
      ar: "مطالبة تأمينية",
    });
    expect(HEALTHCARE_TEMPLATE_MANIFEST.terminology_overrides["billing.self_pay"]).toEqual({
      en: "Self-pay",
      ar: "دفع مباشر",
    });
    // The onboarding checklist carries the honest "no clinical data"
    // framing (ED-07/ED-11 — the boundary stated in the doc, enforced by
    // the zero-clinical-surface gate).
    expect(
      HEALTHCARE_TEMPLATE_MANIFEST.onboarding_steps.find((step) => step.id === "patients")!.title,
    ).toEqual({
      en: "Patient financial files (no clinical data)",
      ar: "الملفات المالية للمرضى (بيانات مالية فقط)",
    });
    expect(
      HEALTHCARE_TEMPLATE_MANIFEST.onboarding_steps.find((step) => step.id === "first_claim"),
    ).toMatchObject({
      required: false,
      feature_key: "notes.received",
    });
  });

  it("the rental_logistics template pins the live report keys and the rental/logistics groups (0047)", () => {
    // The report pins — ALL live registry keys (the 0047 reconciliation,
    // the 0025/0027/0044/0046 convention): the doc draft said
    // rental.fleet_utilization / rental.late_fee_register /
    // logistics.shipment_status_board / partners.ar_aging — §J stays
    // closed, so the shipped shell pins inventory.serial-tracking (the
    // fleet IS the serial register), distribution.route_visit_compliance
    // (the live route status board), services.contract_revenue_schedule
    // (verbatim), and ar.aging (late-fee receivables ARE AR open items;
    // the doc's two aging spellings deduplicate onto the one live key).
    expect(RENTAL_LOGISTICS_TEMPLATE_MANIFEST.report_defaults.map((pin) => pin.report_key)).toEqual([
      "inventory.serial-tracking",
      "distribution.route_visit_compliance",
      "services.contract_revenue_schedule",
      "ar.aging",
    ]);
    expect(
      RENTAL_LOGISTICS_TEMPLATE_MANIFEST.report_defaults.find(
        (pin) => pin.report_key === "inventory.serial-tracking",
      ),
    ).toMatchObject({ pinned: true, dashboard: true, default_period: "this_month" });
    expect(
      RENTAL_LOGISTICS_TEMPLATE_MANIFEST.report_defaults.find(
        (pin) => pin.report_key === "distribution.route_visit_compliance",
      ),
    ).toMatchObject({ pinned: true, dashboard: true, default_period: "today" });
    expect(
      RENTAL_LOGISTICS_TEMPLATE_MANIFEST.report_defaults.find(
        (pin) => pin.report_key === "ar.aging",
      ),
    ).toMatchObject({ pinned: true, dashboard: false, default_period: "this_month" });

    // The rental + logistics navigation groups ship as-is.
    expect(
      RENTAL_LOGISTICS_TEMPLATE_MANIFEST.navigation_manifest.groups.map((group) => group.id),
    ).toEqual(["rental", "logistics"]);
    const rental = RENTAL_LOGISTICS_TEMPLATE_MANIFEST.navigation_manifest.groups.find(
      (group) => group.id === "rental",
    )!;
    expect(rental.items.map((item) => item.target)).toEqual([
      "crm.pipeline",
      "crm.contracts",
      "items.item_master",
      "crm.service_orders",
    ]);
    const logistics = RENTAL_LOGISTICS_TEMPLATE_MANIFEST.navigation_manifest.groups.find(
      (group) => group.id === "logistics",
    )!;
    expect(logistics.items.map((item) => item.target)).toEqual([
      "distribution.routes",
      "distribution.settlements",
    ]);
    // The gated entries carry their LIVE feature_key gates (reservations on
    // crm.leads, fleet on inventory.serial_tracking, returns on
    // crm.service_orders, shipments on distribution.routes, the status
    // board on distribution.settlements — never the deferred intake keys).
    expect(rental.items.find((item) => item.target === "crm.pipeline")?.feature_key).toBe(
      "crm.leads",
    );
    expect(rental.items.find((item) => item.target === "items.item_master")?.feature_key).toBe(
      "inventory.serial_tracking",
    );
    expect(rental.items.find((item) => item.target === "crm.service_orders")?.feature_key).toBe(
      "crm.service_orders",
    );
    expect(logistics.items.find((item) => item.target === "distribution.routes")?.feature_key).toBe(
      "distribution.routes",
    );
    expect(
      logistics.items.find((item) => item.target === "distribution.settlements")?.feature_key,
    ).toBe("distribution.settlements");

    // The rental chain rides in the required keys — every one LIVE (the
    // deferred crm.rental_contracts / crm.contract_deposits / crm.late_fees
    // / distribution.shipment_tracking intake pair is NEVER granted; the
    // shell's own rental_contracts capability composes the live contracts
    // engine, the healthcare insurance_claim_billing precedent).
    expect(RENTAL_LOGISTICS_TEMPLATE_MANIFEST.required_feature_keys).toEqual([
      "industry.template_engine",
      "crm.service_contracts",
      "crm.recurring_billing",
      "inventory.serial_tracking",
      "items.item_master",
      "partners.statements",
      "treasury.accounts",
    ]);
    expect(RENTAL_LOGISTICS_TEMPLATE_MANIFEST.capability_prerequisites.rental_contracts).toEqual({
      level: "REQUIRED",
      feature_keys: ["crm.service_contracts"],
      available_from_phase: "PHASE-019",
    });
    expect(RENTAL_LOGISTICS_TEMPLATE_MANIFEST.capability_prerequisites.deposits_late_fees).toEqual({
      level: "REQUIRED",
      feature_keys: ["crm.recurring_billing", "treasury.receipts_disbursements"],
      available_from_phase: "PHASE-019",
    });
    expect(RENTAL_LOGISTICS_TEMPLATE_MANIFEST.capability_prerequisites.shipment_tracking).toEqual({
      level: "REQUIRED",
      feature_keys: ["distribution.routes", "distribution.settlements"],
      available_from_phase: "PHASE-017",
    });

    // The seven typed workflow policies — the deposit/grace/late-fee/
    // inspection/approval/overdue/milestone set (all registered in the
    // code-owned POLICY_REGISTRY).
    expect(RENTAL_LOGISTICS_TEMPLATE_MANIFEST.workflow_policies).toEqual({
      rental_deposit_required: true,
      late_fee_after_grace_hours: 3,
      late_fee_calculation: "daily_rate_based",
      damage_charge_requires_inspection: true,
      deposit_release_requires_manager_approval: true,
      overdue_rental_blocks_new_reservation: true,
      shipment_milestones_manual: true,
    });

    // The RNT/INV/RCP/PAY/SHP numbering rules — RNT is the per-branch
    // approval-reserved series (the doc default, verbatim), the rest post-
    // assigned.
    expect(RENTAL_LOGISTICS_TEMPLATE_MANIFEST.document_numbering_defaults.rental_contract).toEqual({
      prefix: "RNT",
      format: "RNT-{yyyy}-{seq:5}",
      per_branch: true,
      reserve_on_approval: true,
    });
    expect(RENTAL_LOGISTICS_TEMPLATE_MANIFEST.document_numbering_defaults.shipment).toEqual({
      prefix: "SHP",
      format: "SHP-{yyyy}-{seq:6}",
      per_branch: false,
      reserve_on_approval: false,
    });

    // The fleet-first inventory defaults: serial tracking ON (the fleet is
    // serial items), everything else off.
    expect(RENTAL_LOGISTICS_TEMPLATE_MANIFEST.inventory_policy_defaults).toEqual({
      costing_method: "WAC",
      default_track_batch: false,
      default_track_expiry: false,
      default_track_serial: true,
      default_imei_tracking: false,
      fefo_picking: false,
      allow_negative_stock: false,
    });

    // The bilingual rental terminology (عقد الإيجار / مبلغ التأمين / رسوم
    // التأخير / بوليصة الشحن…) ships verbatim from the doc manifest.
    expect(RENTAL_LOGISTICS_TEMPLATE_MANIFEST.terminology_overrides["rental.contract"]).toEqual({
      en: "Rental contract",
      ar: "عقد الإيجار",
    });
    expect(RENTAL_LOGISTICS_TEMPLATE_MANIFEST.terminology_overrides["rental.deposit"]).toEqual({
      en: "Security deposit",
      ar: "مبلغ التأمين",
    });
    expect(RENTAL_LOGISTICS_TEMPLATE_MANIFEST.terminology_overrides["logi.waybill"]).toEqual({
      en: "Waybill",
      ar: "بوليصة الشحن",
    });

    // The onboarding checklist: deposits-liability CoA + serial fleet +
    // rate cards + customers + deposit policy (required), first contract +
    // shipment milestones (optional, gated on the live distribution key).
    expect(
      RENTAL_LOGISTICS_TEMPLATE_MANIFEST.onboarding_steps.find((step) => step.id === "fleet"),
    ).toMatchObject({ required: true });
    expect(
      RENTAL_LOGISTICS_TEMPLATE_MANIFEST.onboarding_steps.find((step) => step.id === "shipments"),
    ).toMatchObject({
      required: false,
      feature_key: "distribution.routes",
    });
  });
});

describe("negative fixtures — each §3 violation is rejected with the right issue", () => {
  it("(a) costing method outside the WAC|FIFO enum", () => {
    expectSingleIssue(
      (draft) => {
        (draft.inventory_policy_defaults as { costing_method: string }).costing_method = "ABC";
      },
      { path: "inventory_policy_defaults.costing_method", code: "invalid_value" },
    );
  });

  it("(b) orphan module 'logistics' not in the 20-value module enum", () => {
    expectSingleIssue(
      (draft) => {
        (draft.default_modules_enabled as string[]).push("logistics");
      },
      {
        path: `default_modules_enabled.${RETAIL_MANIFEST.default_modules_enabled.length}`,
        code: "invalid_value",
      },
    );
  });

  it("(c) allow_negative_stock: true violates const false (templates may never enable it)", () => {
    expectSingleIssue(
      (draft) => {
        (
          draft.inventory_policy_defaults as { allow_negative_stock: boolean }
        ).allow_negative_stock = true;
      },
      {
        path: "inventory_policy_defaults.allow_negative_stock",
        code: "invalid_value",
        messagePattern: /negative stock/,
      },
    );
  });

  it("(d) id without the industry.<key> prefix", () => {
    expectSingleIssue(
      (draft) => {
        draft.id = "retail";
      },
      { path: "id", code: "invalid_format" },
    );
  });

  it("(e) version that is not MAJOR.MINOR.PATCH", () => {
    expectSingleIssue(
      (draft) => {
        draft.version = "1.0";
      },
      { path: "version", code: "invalid_format" },
    );
  });

  it("(f) unknown extra property (additionalProperties: false)", () => {
    expectSingleIssue(
      (draft) => {
        (draft as Record<string, unknown>).unknown_extra_field = true;
      },
      {
        path: "(root)",
        code: "unrecognized_keys",
        messagePattern: /unknown_extra_field/,
      },
    );
  });

  it("(g) numbering prefix in lowercase", () => {
    expectSingleIssue(
      (draft) => {
        draft.document_numbering_defaults.sales_invoice!.prefix = "inv";
      },
      {
        path: "document_numbering_defaults.sales_invoice.prefix",
        code: "invalid_format",
        messagePattern: /uppercase/,
      },
    );
  });

  it("(h) onboarding_steps with only 2 items (minItems 3)", () => {
    expectSingleIssue(
      (draft) => {
        draft.onboarding_steps = draft.onboarding_steps.slice(0, 2);
      },
      {
        path: "onboarding_steps",
        code: "too_small",
        messagePattern: /3/,
      },
    );
  });

  it("(i) capability level outside REQUIRED|OPTIONAL", () => {
    expectSingleIssue(
      (draft) => {
        const capability = draft.capability_prerequisites.barcode_pos!;
        (capability as { level: string }).level = "SUGGESTED";
      },
      { path: "capability_prerequisites.barcode_pos.level", code: "invalid_value" },
    );
  });

  it("(j) feature key with a non-cataloged module segment", () => {
    expectSingleIssue(
      (draft) => {
        draft.required_feature_keys[0] = "logistics.trucks";
      },
      { path: "required_feature_keys.0", code: "invalid_format" },
    );
  });

  it("(k) navigation group with an empty items array (minItems 1)", () => {
    expectSingleIssue(
      (draft) => {
        draft.navigation_manifest.groups[0]!.items = [];
      },
      { path: "navigation_manifest.groups.0.items", code: "too_small" },
    );
  });

  it("(l) terminology value missing the ar leg (localizedText requires en + ar)", () => {
    expectSingleIssue(
      (draft) => {
        const term = draft.terminology_overrides["pos.terminal"]!;
        delete (term as { ar?: string }).ar;
      },
      { path: "terminology_overrides.pos.terminal.ar", code: "invalid_type" },
    );
  });

  it("(m) duplicate entries violate uniqueItems (feature keys, modules, report defaults)", () => {
    const draft = cloneManifest(RETAIL_MANIFEST);
    draft.required_feature_keys.push(draft.required_feature_keys[0]!);
    draft.default_modules_enabled.push(draft.default_modules_enabled[0]!);
    draft.report_defaults.push(draft.report_defaults[0]!);
    const result = IndustryTemplateManifestSchema.safeParse(draft);
    expect(result.success).toBe(false);
    if (result.success) {
      throw new Error("unreachable: expected duplicate entries to be rejected");
    }
    const messages = result.error.issues.map((issue) => issue.message);
    expect(messages).toContain("required_feature_keys entries must be unique (uniqueItems)");
    expect(messages).toContain("default_modules_enabled entries must be unique (uniqueItems)");
    expect(messages).toContain("report_defaults entries must be unique (uniqueItems)");
  });

  // PHASE-018 negative fixtures on the food_manufacturing manifest — one
  // surgical §3 violation per case against the newest template's own shape.
  it("(n) food_manufacturing: phase gate outside the PHASE-0NN pattern", () => {
    const draft = cloneManifest(FOOD_MANUFACTURING_TEMPLATE_MANIFEST);
    draft.capability_prerequisites.qc_inspections!.available_from_phase = "PHASE-18";
    const result = IndustryTemplateManifestSchema.safeParse(draft);
    expect(result.success).toBe(false);
    if (result.success) {
      throw new Error("unreachable: expected the mutated manifest to be rejected");
    }
    expect(result.error.issues).toHaveLength(1);
    expect(result.error.issues[0]).toMatchObject({
      code: "invalid_format",
      path: ["capability_prerequisites", "qc_inspections", "available_from_phase"],
    });
  });

  it("(o) food_manufacturing: terminology entry missing the en leg", () => {
    const draft = cloneManifest(FOOD_MANUFACTURING_TEMPLATE_MANIFEST);
    delete (draft.terminology_overrides["mfg.recipe"] as { en?: string }).en;
    const result = IndustryTemplateManifestSchema.safeParse(draft);
    expect(result.success).toBe(false);
    if (result.success) {
      throw new Error("unreachable: expected the mutated manifest to be rejected");
    }
    expect(result.error.issues).toHaveLength(1);
    expect(result.error.issues[0]).toMatchObject({
      code: "invalid_type",
      path: ["terminology_overrides", "mfg.recipe", "en"],
    });
  });

  it("(p) food_manufacturing: report default with an unknown period preset", () => {
    const draft = cloneManifest(FOOD_MANUFACTURING_TEMPLATE_MANIFEST);
    (
      draft.report_defaults[0] as unknown as { default_period: string }
    ).default_period = "this_quarter";
    const result = IndustryTemplateManifestSchema.safeParse(draft);
    expect(result.success).toBe(false);
    if (result.success) {
      throw new Error("unreachable: expected the mutated manifest to be rejected");
    }
    expect(result.error.issues).toHaveLength(1);
    expect(result.error.issues[0]).toMatchObject({
      code: "invalid_value",
      path: ["report_defaults", 0, "default_period"],
    });
  });

  // PHASE-019 negative fixtures on the professional_services manifest —
  // one surgical §3 violation per case against the newest template's own
  // shape (three §3 surfaces never exercised by (a)–(p)).
  it("(q) professional_services: workflow policy key outside lower_snake_case", () => {
    const draft = cloneManifest(PROFESSIONAL_SERVICES_TEMPLATE_MANIFEST);
    (draft.workflow_policies as Record<string, unknown>)["Contract Billing Mode"] =
      "retainer_or_milestones";
    const result = IndustryTemplateManifestSchema.safeParse(draft);
    expect(result.success).toBe(false);
    if (result.success) {
      throw new Error("unreachable: expected the mutated manifest to be rejected");
    }
    expect(result.error.issues).toHaveLength(1);
    expect(result.error.issues[0]).toMatchObject({
      // zod 4 record-key violations report the generic `invalid_key` code
      // ("Invalid key in record") — the path pins the offending key.
      code: "invalid_key",
      path: ["workflow_policies", "Contract Billing Mode"],
    });
  });

  it("(r) professional_services: numbering default keyed by a non-series-bearing document type", () => {
    const draft = cloneManifest(PROFESSIONAL_SERVICES_TEMPLATE_MANIFEST);
    // `service_contract` (the document lifecycle table) is NOT one of the
    // §3 series-bearing DOCUMENT_TYPES (contract numbers are contract-side
    // state, never a tenant numbering series).
    (draft.document_numbering_defaults as Record<string, unknown>).service_contract = {
      prefix: "CT",
      format: "CT-{yyyy}-{seq:5}",
      per_branch: false,
      reserve_on_approval: true,
    };
    const result = IndustryTemplateManifestSchema.safeParse(draft);
    expect(result.success).toBe(false);
    if (result.success) {
      throw new Error("unreachable: expected the mutated manifest to be rejected");
    }
    expect(result.error.issues).toHaveLength(1);
    // zod's partialRecord key-violation shape moved across 4.x minors (the
    // repo pins 4.6.7: `unrecognized_keys` at the record path with the key
    // named in the message; older 4.x resolves report the generic
    // `invalid_key` at the child path — the (q) comment's record behavior).
    // Both name the offending `service_contract` key: assert the §3 rule,
    // not the zod internals, so the fixture stays green under either shape.
    const issue = result.error.issues[0]!;
    if (issue.code === "unrecognized_keys") {
      expect(issue.path).toEqual(["document_numbering_defaults"]);
      expect(issue.message).toMatch(/service_contract/);
    } else {
      expect(issue.code).toBe("invalid_key");
      expect(issue.path).toEqual(["document_numbering_defaults", "service_contract"]);
    }
  });

  it("(s) professional_services: capability with an empty feature_keys array (minItems 1)", () => {
    const draft = cloneManifest(PROFESSIONAL_SERVICES_TEMPLATE_MANIFEST);
    draft.capability_prerequisites.commissions!.feature_keys = [];
    const result = IndustryTemplateManifestSchema.safeParse(draft);
    expect(result.success).toBe(false);
    if (result.success) {
      throw new Error("unreachable: expected the mutated manifest to be rejected");
    }
    expect(result.error.issues).toHaveLength(1);
    expect(result.error.issues[0]).toMatchObject({
      code: "too_small",
      path: ["capability_prerequisites", "commissions", "feature_keys"],
    });
    expect(result.error.issues[0]!.message).toMatch(/at least one key/);
  });
});

describe("parseIndustryTemplateManifest (fail-closed)", () => {
  it("throws the typed error carrying the zod issues and the manifest id", () => {
    const draft = cloneManifest(RETAIL_MANIFEST);
    draft.version = "1.0";
    let thrown: unknown;
    try {
      parseIndustryTemplateManifest(draft);
    } catch (error) {
      thrown = error;
    }
    expect(thrown).toBeInstanceOf(IndustryManifestValidationError);
    expect(thrown).toBeInstanceOf(Error);
    const error = thrown as IndustryManifestValidationError;
    expect(error.name).toBe("IndustryManifestValidationError");
    expect(error.manifestId).toBe("industry.retail");
    expect(error.issues.length).toBeGreaterThan(0);
    expect(error.message).toContain("industry.retail");
    expect(error.message).toContain("version");
  });

  it("returns structurally identical data for a valid manifest", () => {
    expect(parseIndustryTemplateManifest(GROCERY_MANIFEST)).toStrictEqual(GROCERY_MANIFEST);
  });
});

describe("hashManifestJson — the applied_manifest_hash content hash", () => {
  it("produces sha256:<64 lowercase hex>", () => {
    for (const manifest of SHIPPED_TEMPLATE_MANIFESTS) {
      expect(hashManifestJson(manifest)).toMatch(/^sha256:[0-9a-f]{64}$/);
    }
  });

  it("is stable across key-order permutations of the same manifest", () => {
    for (const manifest of SHIPPED_TEMPLATE_MANIFESTS) {
      const permuted = reversedKeyOrder(manifest) as IndustryTemplateManifest;
      expect(hashManifestJson(permuted)).toBe(hashManifestJson(manifest));
    }
  });

  it("matches node:crypto sha256 over the canonical JSON (cross-implementation oracle, Arabic included)", () => {
    for (const manifest of SHIPPED_TEMPLATE_MANIFESTS) {
      const oracle = `sha256:${createHash("sha256").update(canonicalManifestJson(manifest), "utf8").digest("hex")}`;
      expect(hashManifestJson(manifest)).toBe(oracle);
    }
  });

  it("different manifests hash differently (drift detection is meaningful)", () => {
    const hashes = new Set(
      SHIPPED_TEMPLATE_MANIFESTS.map((manifest) => hashManifestJson(manifest)),
    );
    expect(hashes.size).toBe(SHIPPED_TEMPLATE_MANIFESTS.length);
  });

  it("canonical JSON is key-sorted and round-trips to an equal manifest", () => {
    const canonical = canonicalManifestJson(RESTAURANT_MANIFEST);
    expect(canonical.startsWith('{"capability_prerequisites":')).toBe(true);
    expect(JSON.parse(canonical)).toStrictEqual(RESTAURANT_MANIFEST);
  });
});

describe("registry invariants (industries/README §8)", () => {
  it("template ids are unique across the shipped registry", () => {
    const ids = SHIPPED_TEMPLATE_MANIFESTS.map((manifest) => manifest.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("versions are semver MAJOR.MINOR.PATCH", () => {
    for (const manifest of SHIPPED_TEMPLATE_MANIFESTS) {
      expect(manifest.version).toMatch(/^\d+\.\d+\.\d+$/);
    }
  });

  it("required_feature_keys are non-empty and unique", () => {
    for (const manifest of SHIPPED_TEMPLATE_MANIFESTS) {
      expect(manifest.required_feature_keys.length).toBeGreaterThan(0);
      expect(new Set(manifest.required_feature_keys).size).toBe(
        manifest.required_feature_keys.length,
      );
    }
  });

  it("default_modules_enabled entries are unique", () => {
    for (const manifest of SHIPPED_TEMPLATE_MANIFESTS) {
      expect(new Set(manifest.default_modules_enabled).size).toBe(
        manifest.default_modules_enabled.length,
      );
    }
  });

  it("report_defaults entries are unique by report_key", () => {
    for (const manifest of SHIPPED_TEMPLATE_MANIFESTS) {
      const keys = manifest.report_defaults.map((report) => report.report_key);
      expect(new Set(keys).size).toBe(keys.length);
    }
  });

  it("onboarding_steps ids are unique", () => {
    for (const manifest of SHIPPED_TEMPLATE_MANIFESTS) {
      const ids = manifest.onboarding_steps.map((step) => step.id);
      expect(new Set(ids).size).toBe(ids.length);
    }
  });
});
