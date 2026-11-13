/**
 * Feature catalog machine mirror (PHASE-004 T7; FEATURE_CATALOG.md §3,
 * BR-040): the module.feature keys with their `depends on` edges — the
 * input of the dependency-closure validation performed at entitlement
 * apply time (activating a feature requires its closure to be satisfiable;
 * violations list the specific missing keys).
 *
 * Sync rule (FEATURE_CATALOG §1): keys are immutable once shipped; the
 * docs table is the source of truth and the migration 0008 plan seeds
 * must satisfy this map (asserted by `dependency-closure.spec` +
 * `plan-seeds.spec`). Adding a key or edge = feature phase + doc update
 * in the same PR.
 */

/** feature key → dependency feature keys (empty = standalone). */
export const FEATURE_DEPS: Readonly<Record<string, readonly string[]>> = Object.freeze({
  // platform
  "platform.registration": [],
  "platform.onboarding": ["platform.registration"],
  "platform.tenant_lifecycle": ["platform.registration"],
  "platform.branches": ["platform.tenant_lifecycle"],
  "platform.users_roles": ["platform.tenant_lifecycle"],
  "platform.audit_trail": [],
  "platform.entitlements": ["platform.tenant_lifecycle"],
  "platform.subscriptions": ["platform.entitlements"],
  // PHASE-023 intake (migration 0035): the operator's refund + payout
  // reconciliation console — the platform.subscriptions pattern, never
  // plan-gated.
  "platform.payouts": ["platform.subscriptions"],
  "platform.admin_console": ["platform.entitlements"],
  "platform.support_access": ["platform.admin_console"],
  // PHASE-024 (T8/T12 + T4): the security-tooling cluster — registered per
  // FEATURE_CATALOG §25, platform-provided (permission-gated, never
  // plan-metered — the platform.support_access precedent).
  "platform.support_review": ["platform.support_access"],
  "identity.mfa_policy": ["platform.users_roles"],
  "audit.review_console": ["platform.audit_trail"],
  "platform.notifications": [],
  "platform.files": [],
  "platform.data_export": ["platform.tenant_lifecycle"],
  // PHASE-036 (Blueprint v3.0 · CR-06): the extensibility core — typed
  // custom fields + form layouts + picklists (FD-18/FD-19/FD-20); the
  // DF-39 plugin substrate WITHOUT the marketplace (DF-38 non-goal).
  "platform.custom_fields": ["platform.onboarding"],
  // accounting
  "accounting.chart_of_accounts": ["platform.onboarding"],
  "accounting.fiscal_calendar": [],
  "accounting.journal_entries": ["accounting.chart_of_accounts"],
  "accounting.recurring_journals": ["accounting.journal_entries"],
  "accounting.approvals": ["accounting.journal_entries"],
  "accounting.general_ledger": ["accounting.journal_entries"],
  "accounting.opening_balances": ["accounting.fiscal_calendar"],
  "accounting.multi_currency": ["accounting.journal_entries"],
  "accounting.cost_centers": ["accounting.journal_entries"],
  "accounting.projects": ["accounting.cost_centers"],
  "accounting.period_close": ["accounting.fiscal_calendar"],
  "accounting.year_end_close": ["accounting.period_close"],
  "accounting.reconciliation": ["accounting.general_ledger"],
  "accounting.fixed_assets": ["accounting.chart_of_accounts"],
  // partners
  "partners.directory": ["platform.onboarding"],
  "partners.credit_terms": ["partners.directory"],
  "partners.credit_management": ["partners.credit_terms"],
  "partners.statements": ["partners.directory"],
  "partners.personal_accounts": ["partners.statements"],
  "partners.customer_portal": ["partners.personal_accounts"],
  // items
  "items.item_master": ["platform.onboarding"],
  "items.categories": ["items.item_master"],
  "items.units_of_measure": ["items.item_master"],
  "items.barcodes": ["items.item_master"],
  "items.price_lists": ["items.item_master"],
  "items.import_export": ["items.item_master", "partners.directory"],
  "items.composite_products": ["items.item_master", "inventory.stock_ledger"],
  // inventory
  "inventory.multi_warehouse": ["platform.branches"],
  "inventory.stock_ledger": ["items.item_master", "inventory.multi_warehouse"],
  "inventory.valuation": ["inventory.stock_ledger"],
  "inventory.batch_tracking": ["inventory.stock_ledger"],
  "inventory.serial_tracking": ["inventory.stock_ledger"],
  "inventory.stock_counts": ["inventory.stock_ledger"],
  "inventory.stock_transfers": ["inventory.stock_ledger"],
  "inventory.reservations": ["inventory.stock_ledger", "sales.orders"],
  "inventory.reorder_levels": ["inventory.stock_ledger", "platform.notifications"],
  // PHASE-044 (Blueprint v3.0 · CR-14): the WMS cluster — the location tree
  // rides multi-warehouse; directed ops + the quarantine/consignment boards
  // ride the location tree; cycle counts compose the 010 counting surface;
  // the serial ledger rides serial tracking.
  "inventory.wms": ["inventory.multi_warehouse"],
  "inventory.putaway": ["inventory.wms"],
  "inventory.picking": ["inventory.wms"],
  "inventory.cycle_counts": ["inventory.wms", "inventory.stock_counts"],
  "inventory.abc": ["inventory.wms"],
  "inventory.serial_ledger": ["inventory.serial_tracking"],
  "inventory.quarantine": ["inventory.wms"],
  "inventory.consignment": ["inventory.wms"],
  // sales
  "sales.quotations": ["items.price_lists", "partners.directory"],
  "sales.orders": ["sales.quotations", "inventory.stock_ledger"],
  "sales.deliveries": ["sales.orders", "inventory.stock_ledger"],
  "sales.invoices": ["sales.orders", "tax.engine"],
  "sales.credit_notes": ["sales.invoices"],
  "sales.receipts": ["treasury.accounts"],
  "sales.allocations": ["sales.receipts", "sales.invoices"],
  "sales.credit_limits": ["partners.credit_management"],
  "sales.receivables_aging": ["sales.invoices", "sales.allocations"],
  "sales.reps": ["partners.directory"],
  "sales.commissions": ["sales.reps"],
  "sales.discount_management": ["sales.invoices"],
  // PHASE-017 intake (FEATURE_CATALOG §25 protocol; migration 0025 registered
  // the key + plan grants): the workshop work order. PHASE-019 generalizes it
  // into crm.service_orders.
  "sales.job_cards": ["sales.quotations", "inventory.reservations"],
  // PHASE-023 intake (migration 0035 registered the key + plan grants): the
  // commerce channel staging import (server-decision conflicts, ADR-0012).
  "sales.commerce_channels": ["partners.directory"],
  // purchasing
  "purchasing.requests": ["items.item_master"],
  "purchasing.orders": ["purchasing.requests", "partners.directory"],
  "purchasing.goods_receipts": ["purchasing.orders", "inventory.stock_ledger"],
  "purchasing.supplier_invoices": ["purchasing.goods_receipts"],
  "purchasing.debit_notes": ["purchasing.supplier_invoices"],
  "purchasing.payments": ["treasury.accounts"],
  "purchasing.three_way_matching": ["purchasing.supplier_invoices"],
  "purchasing.landed_costs": ["purchasing.goods_receipts"],
  // PHASE-038 sourcing keys (migration 0051 §10 — business + enterprise,
  // the tier-4 precedent): the negotiation loop rides the purchasing
  // chain; scorecards read the receiving/invoicing truth; the portal
  // shares the RFQ substrate (P-05 → 060).
  "purchasing.rfqs": ["purchasing.orders"],
  "purchasing.blanket_orders": ["purchasing.orders"],
  "purchasing.supplier_scorecards": ["purchasing.goods_receipts"],
  "purchasing.capex_requests": ["purchasing.requests"],
  "purchasing.supplier_portal": ["purchasing.rfqs"],
  // PHASE-039 returns & collections keys (migration 0056 §10 — business
  // + enterprise, the tier-4 precedent): the RMA workflow rides the
  // sales-invoice chain; warranties ride the returns substrate; the
  // dunning engine rides receivables aging; the supplier mirror (R-03,
  // v3.2/CR-50) rides the purchasing chain.
  "sales.rma": ["sales.invoices"],
  "sales.warranties": ["sales.rma"],
  "sales.dunning": ["sales.receivables_aging"],
  "purchasing.rma": ["purchasing.goods_receipts"],
  // PHASE-040 data onboarding & migration toolkit keys (migration 0060 §8):
  // platform.data_migration — the seven-kind import engine + mapping
  // wizard + adapters (business + enterprise, the 0051 tier-4 precedent);
  // platform.demo_data — the one-click demo loader + sandbox tenants (ALL
  // plans, the recorded trial-enablement decision). Both are leaf keys
  // (no dependency edges — they ride the modules they write into).
  "platform.data_migration": [],
  "platform.demo_data": [],
  // PHASE-041 communications hub keys (migration 0064 §10):
  // communication.templates + communication.outbound → ALL plans (base
  // messaging over the SANDBOX default provider — BR-067); the provider
  // tiers (whatsapp/sms/email_providers) and calendar_integration →
  // business + enterprise (the 0051 tier-4 precedent). The outbound
  // pipeline renders from the template substrate; every real provider
  // rides the outbound ledger.
  "communication.templates": [],
  "communication.outbound": ["communication.templates"],
  "communication.whatsapp": ["communication.outbound"],
  "communication.sms": ["communication.outbound"],
  "communication.email_providers": ["communication.outbound"],
  "communication.calendar_integration": [],
  // treasury
  "treasury.accounts": ["accounting.chart_of_accounts"],
  "treasury.receipts_disbursements": ["treasury.accounts"],
  "treasury.petty_cash": ["treasury.accounts"],
  "treasury.cash_transfers": ["treasury.accounts"],
  "treasury.expenses": ["treasury.accounts", "platform.files"],
  "treasury.expense_categories": ["treasury.expenses"],
  "treasury.cashier_shifts": ["treasury.accounts"],
  "treasury.bank_reconciliation": ["treasury.accounts"],
  // PHASE-023 intake (migration 0035): the parked-lines manual-mapping aid —
  // raw cells verbatim, amounts never guessed.
  "treasury.bank_statement_parking": ["treasury.bank_reconciliation"],
  "treasury.cheques": ["treasury.receipts_disbursements"],
  // tax
  "tax.engine": ["accounting.journal_entries"],
  "tax.codes": ["tax.engine"],
  "tax.registrations": ["tax.engine"],
  "tax.jurisdiction_packs": [],
  "tax.vat_return": ["tax.engine", "accounting.general_ledger"],
  "tax.einvoicing_framework": ["tax.engine", "sales.invoices"],
  "tax.einvoicing_zatca": ["tax.einvoicing_framework"],
  "tax.einvoicing_eta": ["tax.einvoicing_framework"],
  // reporting
  "reporting.engine": ["accounting.general_ledger"],
  "reporting.financial_statements": ["reporting.engine"],
  "reporting.operational_reports": ["reporting.engine"],
  "reporting.print_templates": ["reporting.engine"],
  "reporting.exports": ["reporting.engine"],
  "reporting.dashboards": ["reporting.engine"],
  "reporting.scheduled_reports": ["reporting.exports", "platform.notifications"],
  // crm
  "crm.leads": ["partners.directory"],
  "crm.tasks_activities": ["crm.leads"],
  "crm.service_contracts": ["partners.directory"],
  "crm.recurring_billing": ["crm.service_contracts", "sales.invoices"],
  "crm.service_orders": ["crm.service_contracts", "inventory.stock_ledger"],
  // manufacturing
  "manufacturing.bom": ["items.item_master"],
  "manufacturing.production_orders": ["manufacturing.bom", "inventory.stock_ledger"],
  "manufacturing.wip": ["manufacturing.production_orders"],
  "manufacturing.costing": ["manufacturing.wip"],
  "manufacturing.scrap": ["manufacturing.production_orders"],
  "manufacturing.batch_genealogy": ["manufacturing.production_orders", "inventory.batch_tracking"],
  "manufacturing.qc": ["manufacturing.production_orders"],
  // PHASE-042 (0066 plan grants + the food_manufacturing manifest intake —
  // FEATURE_CATALOG §25 protocol): the manufacturing-execution set. Work
  // centers are pure master data (leaf); routings are per item and their
  // operations reference work centers; the shop floor executes routing
  // operations at work centers; rework references parent production
  // orders; downtime is per work center; the standard-cost layer's roll-up
  // consumes BOMs + routings.
  "manufacturing.work_centers": [],
  "manufacturing.routing": ["items.item_master", "manufacturing.work_centers"],
  "manufacturing.shopfloor": ["manufacturing.routing", "manufacturing.work_centers"],
  "manufacturing.rework": ["manufacturing.production_orders"],
  "manufacturing.downtime": ["manufacturing.work_centers"],
  "manufacturing.standard_costs": ["manufacturing.bom", "manufacturing.routing"],
  // PHASE-043 (0078 plan grants — FEATURE_CATALOG §25 protocol, the 042
  // intake precedent): the planning set. The MRP engine explodes BOMs,
  // reads bin-level availability through the WMS surfaces, and its BOR
  // rough-cut check reads work-center capacities; MPS is demand input to
  // the engine; the planning policies feed the engine's lot-sizing +
  // fences. Without these rows the CLOSED catalog reports every granted
  // planning key as missing itself in every BR-040 closure check (the
  // T-19 gate catch — the 0078 §2 grants ran ahead of this intake).
  "manufacturing.mrp": ["manufacturing.work_centers", "manufacturing.bom", "inventory.wms"],
  "manufacturing.mps": ["manufacturing.mrp"],
  "manufacturing.planning": ["manufacturing.mrp"],
  // distribution
  "distribution.routes": ["partners.directory", "sales.reps"],
  "distribution.van_stock": ["inventory.multi_warehouse", "inventory.stock_transfers"],
  "distribution.settlements": ["distribution.van_stock", "sales.invoices", "sales.receipts"],
  "distribution.customer_tiers": ["partners.directory"],
  "distribution.free_goods": ["sales.discount_management"],
  // pos
  "pos.terminals": ["platform.branches"],
  "pos.sales": ["sales.invoices", "items.barcodes"],
  "pos.shifts": ["treasury.cashier_shifts"],
  "pos.receipts": ["pos.sales", "reporting.print_templates"],
  "pos.barcode_scanning": ["items.barcodes"],
  "pos.offline_queue": ["pos.sales", "pos.shifts"],
  // PHASE-016 T1 intake (FEATURE_CATALOG §25 protocol — the §3 pending set
  // registered with full rows + plan grants + permission seeds at 0024):
  "pos.table_service": ["pos.sales"],
  "pos.kitchen_display": ["pos.table_service"],
  // offline
  "offline.sync_protocol": ["platform.users_roles"],
  "offline.device_management": ["offline.sync_protocol"],
  "offline.desktop_app": ["offline.sync_protocol"],
  "offline.android_app": ["offline.sync_protocol", "distribution.van_stock"],
  "offline.mobile_accounts": ["partners.personal_accounts", "offline.android_app"],
  // industry
  "industry.template_engine": ["platform.onboarding"],
  "industry.template_switching": ["industry.template_engine"],
  "industry.terminology": ["industry.template_engine"],
  "industry.addons": ["industry.template_engine"],
  // fixed assets
  "fixed_assets.register": ["accounting.chart_of_accounts"],
  "fixed_assets.categories": ["fixed_assets.register"],
  "fixed_assets.acquisition": ["fixed_assets.categories"],
  "fixed_assets.depreciation": ["fixed_assets.acquisition", "accounting.fiscal_calendar"],
  "fixed_assets.revaluation": ["fixed_assets.acquisition"],
  "fixed_assets.disposal": ["fixed_assets.depreciation"],
  "fixed_assets.reports": ["fixed_assets.depreciation"],
  // notes
  "notes.received": ["treasury.receipts_disbursements", "sales.invoices"],
  "notes.issued": ["treasury.receipts_disbursements", "purchasing.supplier_invoices"],
  "notes.pdc_calendar": ["notes.received", "notes.issued"],
  "notes.endorsement": ["notes.received"],
  "notes.dishonor": ["notes.received"],
  "notes.discounting": ["notes.received"],
  "notes.reports": ["notes.pdc_calendar"],
  // installments
  "installments.plans": ["sales.invoices", "partners.credit_terms"],
  "installments.schedules": ["installments.plans"],
  "installments.collections": ["installments.schedules", "sales.receipts"],
  "installments.late_fees": ["installments.schedules"],
  "installments.reports": ["installments.schedules"],
  // budgeting
  "budgeting.budgets": ["accounting.fiscal_calendar", "accounting.chart_of_accounts"],
  "budgeting.cost_center_budgets": ["budgeting.budgets", "accounting.cost_centers"],
  "budgeting.project_budgets": ["budgeting.budgets", "accounting.projects"],
  "budgeting.approvals": ["budgeting.budgets"],
  "budgeting.controls": ["budgeting.approvals"],
  "budgeting.reports": ["budgeting.budgets", "reporting.engine"],
  // payroll
  "payroll.employees": ["platform.branches"],
  "payroll.salary_structures": ["payroll.employees"],
  "payroll.runs": ["payroll.salary_structures", "accounting.fiscal_calendar"],
  "payroll.approvals": ["payroll.runs"],
  "payroll.loans": ["payroll.employees", "payroll.runs"],
  "payroll.eos_provision": ["payroll.employees", "payroll.runs"],
  "payroll.cost_allocation": ["payroll.runs", "accounting.cost_centers"],
  "payroll.reports": ["payroll.runs"],
  // consolidation
  "consolidation.groups": ["accounting.multi_currency", "accounting.fiscal_calendar"],
  "consolidation.eliminations": ["consolidation.groups"],
  "consolidation.runs": ["consolidation.groups", "consolidation.eliminations"],
  "consolidation.fx_translation": ["consolidation.runs", "accounting.multi_currency"],
  "consolidation.reports": ["consolidation.runs", "reporting.financial_statements"],
});

export const FEATURE_KEYS: readonly string[] = Object.keys(FEATURE_DEPS);

/**
 * Feature keys pending FEATURE_CATALOG intake (CAPABILITY_MATRIX §3 — the
 * declared intake set). The industry templates require them and PHASE-016
 * registers them through the §5 maintenance protocol; until then no
 * entitlement is grantable and the owning template capability is
 * PHASE-GATED: resolution keeps the navigation item visible but marked
 * `phase_gated: "PHASE-016"` (CONFIGURATION_ENGINE L9; PHASE-015 §2 item 8)
 * instead of hiding it — the tenant sees "coming with PHASE-016" and trades
 * in back-office mode.
 */
/**
 * PHASE-016 shipped the §3 pending intake set — `pos.table_service` and
 * `pos.kitchen_display` are full catalog keys now (registered through the
 * §25 protocol at migration 0024 + the docs table). The set stays empty
 * until the next intake (the mechanism is the PHASE-015 contribution).
 */
export const PHASE_GATED_INTAKE_KEYS: readonly string[] = Object.freeze([]);

/** The roadmap phase the intake keys unlock (CAPABILITY_MATRIX §3 target). */
export const INTAKE_TARGET_PHASE = "PHASE-016";

/** Is `key` one of the pending intake keys (phase-gated until PHASE-016)? */
export function isPhaseGatedIntakeKey(key: string): boolean {
  return PHASE_GATED_INTAKE_KEYS.includes(key);
}

/** Is `key` a known catalog feature key? */
export function isKnownFeatureKey(key: string): boolean {
  return Object.prototype.hasOwnProperty.call(FEATURE_DEPS, key);
}

/**
 * BR-040 dependency-closure validation: activating `key` requires every
 * transitive dependency to be present in the candidate active set. Returns
 * the specific missing keys (empty = the activation is satisfiable).
 * Unknown keys are reported as missing themselves — the catalog is closed.
 */
export function missingClosure(
  key: string,
  activeKeys: ReadonlySet<string>,
): readonly string[] {
  const missing = new Set<string>();
  const visited = new Set<string>();
  const queue = [key];
  if (!isKnownFeatureKey(key)) {
    return [key];
  }
  while (queue.length > 0) {
    const current = queue.shift()!;
    if (visited.has(current)) {
      continue;
    }
    visited.add(current);
    const deps = FEATURE_DEPS[current] ?? [];
    for (const dep of deps) {
      if (!isKnownFeatureKey(dep)) {
        missing.add(dep); // catalog drift: edge references an unknown key
        continue;
      }
      if (!activeKeys.has(dep) && dep !== key) {
        missing.add(dep);
      }
      queue.push(dep);
    }
  }
  return [...missing].sort();
}

/**
 * Whole-set closure check (plan materialization shape): every key's
 * dependencies must be inside the set itself. Returns the keys that
 * fail with their missing dependencies.
 */
export function closureViolations(
  keys: readonly string[],
): ReadonlyArray<{ featureKey: string; missing: readonly string[] }> {
  const set = new Set(keys);
  const violations: { featureKey: string; missing: readonly string[] }[] = [];
  for (const key of keys) {
    const missing = missingClosure(key, set);
    if (missing.length > 0) {
      violations.push({ featureKey: key, missing });
    }
  }
  return violations;
}
