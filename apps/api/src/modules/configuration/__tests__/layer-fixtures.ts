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
  WHOLESALE_TEMPLATE_MANIFEST,
  hashManifestJson,
  type IndustryTemplateManifest,
} from "@erp/contracts";

import type {
  L1TemplateLayer,
  L2JurisdictionLayer,
  L3PlanLayer,
  L4EntitlementLayer,
  L5SettingsLayer,
  L7BranchLayer,
  L8InstalledLayer,
  L10PolicyLayer,
  LayerInputs,
} from "../domain/layer-model";

/**
 * Unit-test layer-input fixtures (PHASE-015 §6): the thirteen shipped
 * manifests (the seven base + the PHASE-030 wholesale/electronics pair +
 * the PHASE-031 healthcare shell + the PHASE-032 education template + the
 * PHASE-033 agriculture template + the delivery-completion rental &
 * logistics shell — the two lineages' template sets united by the
 * restoration merge, then completed) × the three plan seeds (migration
 * 0008/0021/0024/0025/0026/0027 + the PHASE-027 0038 grants — the
 * installments/notes set the education + wholesale templates' REQUIRED/
 * OPTIONAL chains resolve through — key and limits lists, transcribed) ×
 * the SA jurisdiction seed (migration 0013). Shared by config-resolution
 * spec (property/precedence tests) and golden-effective-configs.spec
 * (pinned hashes).
 *
 */

export const SHIPPED_TEMPLATES: readonly IndustryTemplateManifest[] = [
  RETAIL_MANIFEST,
  GROCERY_MANIFEST,
  RESTAURANT_MANIFEST,
  AUTOMOTIVE_TEMPLATE_MANIFEST,
  DISTRIBUTION_TEMPLATE_MANIFEST,
  FOOD_MANUFACTURING_TEMPLATE_MANIFEST,
  PROFESSIONAL_SERVICES_TEMPLATE_MANIFEST,
  AGRICULTURE_TEMPLATE_MANIFEST,
  EDUCATION_TEMPLATE_MANIFEST,
  ELECTRONICS_TEMPLATE_MANIFEST,
  HEALTHCARE_TEMPLATE_MANIFEST,
  WHOLESALE_TEMPLATE_MANIFEST,
  RENTAL_LOGISTICS_TEMPLATE_MANIFEST,
];

/** L1 from a shipped manifest (applied state, no tenant overrides). */
export function l1Of(
  manifest: IndustryTemplateManifest,
  tenantTerminology: Record<string, { en: string; ar: string }> = {},
): L1TemplateLayer {
  return {
    key: manifest.id,
    version: manifest.version,
    manifestHash: hashManifestJson(manifest),
    manifest,
    appliedAt: "2026-11-01T00:00:00.000Z",
    status: "ACTIVE",
    tenantTerminology,
  };
}

/**
 * The SA jurisdiction seed (migration 0013): pack 1.0.0-baseline,
 * VAT in force, and a registered tenant (§5 example posture).
 */
export const SA_JURISDICTION: L2JurisdictionLayer = {
  countryCode: "SA",
  packVersion: "1.0.0-baseline",
  vatStatus: "VAT_IN_FORCE",
  tenantRegistration: "REGISTERED",
};

// ---------------------------------------------------------------------------
// Plan seeds (migration 0008 `plans.feature_keys` + `limits`, verbatim)
// ---------------------------------------------------------------------------

const STARTER_KEYS: readonly string[] = [
  "platform.registration",
  "platform.onboarding",
  "platform.branches",
  "platform.users_roles",
  "platform.audit_trail",
  "platform.data_export",
  "platform.tenant_lifecycle",
  "platform.files",
  "accounting.chart_of_accounts",
  "accounting.fiscal_calendar",
  "accounting.journal_entries",
  "accounting.approvals",
  "accounting.general_ledger",
  "accounting.opening_balances",
  "accounting.period_close",
  "accounting.year_end_close",
  "accounting.reconciliation",
  "partners.directory",
  "partners.credit_terms",
  "partners.statements",
  "items.item_master",
  "items.categories",
  "items.units_of_measure",
  "items.barcodes",
  "items.price_lists",
  "inventory.stock_ledger",
  "inventory.valuation",
  "inventory.multi_warehouse",
  "sales.quotations",
  "sales.orders",
  "sales.deliveries",
  "sales.invoices",
  "sales.credit_notes",
  "sales.receipts",
  "sales.allocations",
  "sales.receivables_aging",
  "purchasing.requests",
  "purchasing.orders",
  "purchasing.goods_receipts",
  "purchasing.supplier_invoices",
  "purchasing.debit_notes",
  "purchasing.payments",
  "purchasing.three_way_matching",
  "treasury.accounts",
  "treasury.receipts_disbursements",
  "treasury.expenses",
  "treasury.expense_categories",
  "tax.engine",
  "tax.codes",
  "tax.registrations",
  "tax.jurisdiction_packs",
  "tax.vat_return",
  "reporting.engine",
  "reporting.financial_statements",
  "reporting.operational_reports",
  "reporting.print_templates",
  "reporting.exports",
];

const BUSINESS_KEYS: readonly string[] = [
  ...STARTER_KEYS,
  "platform.notifications",
  "accounting.multi_currency",
  "accounting.cost_centers",
  "partners.credit_management",
  "inventory.batch_tracking",
  "inventory.serial_tracking",
  "inventory.stock_counts",
  "inventory.stock_transfers",
  "sales.credit_limits",
  "sales.reps",
  "sales.discount_management",
  "purchasing.landed_costs",
  "treasury.petty_cash",
  "treasury.cash_transfers",
  "treasury.bank_reconciliation",
  "treasury.cashier_shifts",
  "treasury.cheques",
  "reporting.dashboards",
  "pos.terminals",
  "pos.sales",
  "pos.shifts",
  "pos.receipts",
  "pos.barcode_scanning",
  "pos.offline_queue",
  // PHASE-016 T1 intake (0024 plan grants): the table-service set + the
  // composite-products substrate the restaurant combos consume.
  "pos.table_service",
  "pos.kitchen_display",
  "items.composite_products",
  "industry.template_engine",
  "industry.terminology",
  // PHASE-017 (0025 plan grants): the job-card/distribution set — business
  // + enterprise gain sales.job_cards, the commission/distribution keys,
  // and inventory.reservations (automotive's REQUIRED capability chain).
  "sales.job_cards",
  "sales.commissions",
  "distribution.routes",
  "distribution.van_stock",
  "distribution.settlements",
  "distribution.customer_tiers",
  "distribution.free_goods",
  "inventory.reservations",
  // PHASE-018 (0026 plan grants): the manufacturing set — business gains
  // the seven keys (enterprise already carries them from the 0008 base
  // seed, so the array_cat was a no-op there); starter does NOT.
  "manufacturing.bom",
  "manufacturing.production_orders",
  "manufacturing.wip",
  "manufacturing.costing",
  "manufacturing.scrap",
  "manufacturing.batch_genealogy",
  "manufacturing.qc",
  // PHASE-019 (0027 plan grants): the CRM + projects set — business gains
  // the six keys (enterprise already carries them from the 0008 base seed,
  // so the array_cat was a no-op there); starter does NOT.
  "crm.leads",
  "crm.tasks_activities",
  "crm.service_contracts",
  "crm.recurring_billing",
  "crm.service_orders",
  "accounting.projects",
  // PHASE-020 (0029 plan grants): the offline sync foundation — business
  // gains the sync protocol + device management keys (enterprise already
  // carries them from the 0008 base seed); the 021/022 app keys
  // (desktop/android/mobile_accounts) stay enterprise-only until they ship.
  "offline.sync_protocol", "offline.device_management",
  // PHASE-032 transcription of the PHASE-027 0038 plan grants (the twelve
  // notes/installments feature keys → business + enterprise, the tier-4
  // precedent; starter does NOT get them): the education commercial shell's
  // REQUIRED chain (installments.plans/collections/late_fees) and OPTIONAL
  // pdc_notes entry (notes.received) resolve through exactly these grants,
  // so the fixtures transcribe the 0038 block the way they transcribed the
  // 0025/0026/0027 blocks before it. The 0035/0037 grant blocks stay
  // untranscribed (no shipped template consumes their keys yet — the
  // fixture's documented role is the template-relevant grant subset).
  "notes.received", "notes.issued", "notes.pdc_calendar", "notes.endorsement",
  "notes.dishonor", "notes.discounting", "notes.reports",
  "installments.plans", "installments.schedules", "installments.collections",
  "installments.late_fees", "installments.reports",
];

const ENTERPRISE_KEYS: readonly string[] = [
  ...BUSINESS_KEYS,
  "partners.personal_accounts",
  "inventory.reorder_levels",
  "tax.einvoicing_framework",
  "reporting.scheduled_reports",
  "industry.addons",
  // The manufacturing set rides in via BUSINESS_KEYS (the 0008 base seed
  // granted it to enterprise; 0026 granted it to business too — listed once,
  // in the business block above, so the spread stays duplicate-free).
  // Likewise the CRM + projects set (0027 granted it to business; the
  // explicit enterprise rows for accounting.projects / crm.* are removed
  // — they now ride the business block above).
  // Likewise the offline sync foundation (0029 granted sync_protocol +
  // device_management to business; only the 021/022 app keys stay here).
  "offline.desktop_app",
  "offline.android_app",
  "offline.mobile_accounts",
];

export const PLAN_KEYS: Readonly<Record<"starter" | "business" | "enterprise", readonly string[]>> =
  Object.freeze({
    starter: STARTER_KEYS,
    business: BUSINESS_KEYS,
    enterprise: ENTERPRISE_KEYS,
  });

export const PLAN_LIMITS: Readonly<
  Record<"starter" | "business" | "enterprise", Record<string, unknown>>
> = Object.freeze({
  starter: Object.freeze({
    users: 3,
    branches: 1,
    warehouses: 2,
    documents_per_month: 500,
    pos_terminals: 0,
    offline_devices: 0,
    industry_addons: 0,
    support_level: "standard",
    _placeholder: true,
  }),
  business: Object.freeze({
    users: 10,
    branches: 3,
    warehouses: 6,
    documents_per_month: 5000,
    pos_terminals: 3,
    offline_devices: 5,
    industry_addons: 1,
    support_level: "standard",
    _placeholder: true,
  }),
  enterprise: Object.freeze({
    users: 50,
    branches: "unlimited",
    warehouses: "unlimited",
    documents_per_month: 250000,
    pos_terminals: "unlimited",
    offline_devices: 100,
    industry_addons: 3,
    support_level: "priority",
    _placeholder: true,
  }),
});

export type PlanKey = keyof typeof PLAN_KEYS;

export function l3Of(plan: PlanKey): L3PlanLayer {
  return { planKey: plan, limits: PLAN_LIMITS[plan] };
}

export function l4Of(plan: PlanKey): L4EntitlementLayer {
  const active = [...PLAN_KEYS[plan]].sort();
  const sources: Record<string, string> = {};
  for (const key of active) {
    sources[key] = "PLAN";
  }
  return { active, sources };
}

// ---------------------------------------------------------------------------
// Layer-input fixture builder
// ---------------------------------------------------------------------------

export interface FixtureOptions {
  readonly template?: IndustryTemplateManifest | null;
  readonly plan?: PlanKey | null;
  readonly jurisdiction?: L2JurisdictionLayer | null;
  readonly settings?: Record<string, unknown>;
  readonly branches?: Record<
    string,
    { id: string; isActive: boolean; seriesFormats: Record<string, string> }
  >;
  readonly flags?: Record<string, boolean>;
  readonly approvals?: L10PolicyLayer["approvals"];
  readonly tenantTerminology?: Record<string, { en: string; ar: string }>;
}

export const TENANT_ID = "01920000-0000-7000-8000-000000000001";

/** A complete LayerInputs fixture (defaults: retail × business × SA). */
export function layerInputsFixture(options: FixtureOptions = {}): LayerInputs {
  const template = options.template === undefined ? RETAIL_MANIFEST : options.template;
  return {
    tenantId: TENANT_ID,
    baseCurrency: "SAR",
    countryCode: options.jurisdiction === null ? "SA" : (options.jurisdiction?.countryCode ?? "SA"),
    industryTemplatePreference: template === null ? null : template.id,
    l1: template === null ? null : l1Of(template, options.tenantTerminology ?? {}),
    l2: options.jurisdiction === undefined ? SA_JURISDICTION : options.jurisdiction,
    l3:
      options.plan === undefined
        ? l3Of("business")
        : options.plan === null
          ? null
          : l3Of(options.plan),
    l4: l4Of(options.plan ?? "business"),
    l5: { entries: options.settings ?? {} } satisfies L5SettingsLayer,
    l7: {
      branches: options.branches ?? {
        BR1: { id: "b1000000-0000-7000-8000-000000000001", isActive: true, seriesFormats: {} },
      },
    } satisfies L7BranchLayer,
    l8: { modules: options.flags ?? {} } satisfies L8InstalledLayer,
    l10: { approvals: options.approvals ?? [] } satisfies L10PolicyLayer,
  };
}

/** Rebuild the same inputs with every record's key order shuffled — the
 * canonical-JSON hash must not care (determinism, §1 principle 2). */
export function shuffleRecordKeyOrder(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(shuffleRecordKeyOrder);
  }
  if (typeof value === "object" && value !== null) {
    const entries = Object.entries(value as Record<string, unknown>);
    // Deterministic non-identity permutation (reverse) — enough to prove
    // order-independence; the property test layers randomness on top.
    const reordered = entries.reverse();
    const out: Record<string, unknown> = {};
    for (const [key, child] of reordered) {
      out[key] = shuffleRecordKeyOrder(child);
    }
    return out;
  }
  return value;
}
