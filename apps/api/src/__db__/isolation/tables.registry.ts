/**
 * Tenant-owned table registry (PHASE-003 T13; SECURITY_TEST_PLAN §2
 * "per-phase expansion rule"; extended by PHASE-004): every `tenant_id`-
 * bearing table in `public` must be registered here — the generated
 * A1–A10 suite iterates this list, and a registry CI check fails when a
 * new tenant-owned table ships without registering (the negative proof
 * the phase demands).
 *
 * Variant-policy tables (roles, role_permissions: system templates
 * readable with tenant_id IS NULL) are registered with their variant
 * flag so the generated suite applies their documented expectations
 * (A2 reads see template rows; writes still never cross tenants).
 *
 * PHASE-004 additions (migration 0006/0007): branches, tenant_settings,
 * subscriptions, entitlements, support_sessions, accounts,
 * account_purposes. `entitlements` additionally carries the DELETE grant
 * (the materialization upsert's symmetric half) — its A5 expectation is
 * "policy-confined delete touches 0 foreign rows" instead of the
 * grant-denial shape.
 */

export interface RegisteredTenantTable {
  readonly table: string;
  /** True for roles/role_permissions (template rows visible across tenants). */
  readonly variantTemplateRows?: boolean;
  /** True when the app role legitimately holds DELETE (entitlements). */
  readonly deleteGranted?: boolean;
}

export const TENANT_TABLES_REGISTRY: readonly RegisteredTenantTable[] = [
  { table: "audit_events" },
  { table: "memberships" },
  { table: "invitations" },
  { table: "roles", variantTemplateRows: true },
  { table: "role_permissions", variantTemplateRows: true },
  { table: "branches" },
  { table: "tenant_settings" },
  { table: "subscriptions" },
  { table: "entitlements", deleteGranted: true },
  { table: "support_sessions" },
  { table: "accounts" },
  { table: "account_purposes" },
  // PHASE-006 master-data cluster (migration 0009).
  { table: "credit_terms" },
  { table: "price_lists" },
  { table: "partners" },
  { table: "partner_contacts" },
  { table: "partner_addresses" },
  { table: "item_categories" },
  { table: "uoms" },
  { table: "uom_conversions" },
  { table: "items" },
  { table: "barcodes" },
  { table: "price_list_items" },
  { table: "partner_balances" },
  { table: "opening_balance_docs" },
  { table: "file_objects" },
  { table: "import_jobs" },
  // PHASE-007 accounting cluster (migrations 0010/0011).
  { table: "fiscal_years" },
  { table: "fiscal_periods" },
  { table: "exchange_rates" },
  { table: "cost_centers" },
  { table: "recurring_journals" },
  { table: "approval_policies" },
  { table: "numbering_sequences" },
  { table: "number_assignments" },
  { table: "manual_journals", deleteGranted: true },
  { table: "manual_journal_lines", deleteGranted: true },
  { table: "journal_templates" },
  { table: "journal_entries" },
  { table: "journal_lines" },
  { table: "partner_subledger_entries" },
  { table: "reconciliation_runs" },
  // PHASE-008 treasury cluster (migration 0012). cash_movements is
  // append-only by grants (no UPDATE/DELETE for erp_app — A4 denial) per
  // INV-019; treasury_allocations carries the sanctioned pre-POST edit
  // DELETE (draft allocation replacement — the manual-journal-drafts
  // pattern).
  { table: "cash_accounts" },
  { table: "cash_movements" },
  { table: "receipts" },
  { table: "payments" },
  { table: "treasury_allocations", deleteGranted: true },
  { table: "expense_categories" },
  { table: "expenses" },
  { table: "cash_transfers" },
  { table: "cashier_shifts" },
  { table: "bank_statements" },
  { table: "bank_statement_lines" },
  // PHASE-009 tax cluster (migration 0013) — the tenant-owned tables. The
  // global reference tables (tax_treatments, jurisdictions,
  // jurisdiction_tax_rates) are deliberately NOT here: they carry no
  // tenant_id (ADR-0005/TENANT_ISOLATION §3 pack data) and their write
  // denial for erp_app is asserted by the grants test instead.
  // tax_document_summaries is append-only by grants + guard (INV-012's
  // substrate — the RC-07 drift fixture mutates via superuser tooling only).
  { table: "tax_codes" },
  { table: "tax_registrations" },
  { table: "tax_pack_bindings" },
  { table: "tax_document_summaries" },
  { table: "vat_returns" },
  { table: "e_invoicing_submissions" },
  // PHASE-010 inventory cluster (migrations 0014/0015). stock_moves is
  // append-only by grants (no UPDATE/DELETE for erp_app — A4 denial) per
  // INV-010/INV-017, mirroring cash_movements; the guard trigger is the
  // defense-in-depth layer.
  { table: "warehouses" },
  { table: "item_warehouse_settings" },
  { table: "stock_moves" },
  { table: "stock_layers" },
  { table: "item_stock" },
  { table: "stock_transfers" },
  { table: "stock_transfer_lines" },
  { table: "stock_adjustments" },
  { table: "stock_reservations" },
  { table: "item_batches" },
  { table: "item_serials" },
  { table: "stock_counts" },
  { table: "stock_count_lines" },
  // PHASE-011 purchasing cluster (migrations 0016/0017). Draft-lifecycle
  // tables (SELECT/INSERT/UPDATE); posted rows immutable by service
  // discipline + shape CHECKs (the treasury pattern). purchase_reallocations
  // + lines are INSERT-only documents (the audited audit trail).
  { table: "purchase_requests" },
  { table: "purchase_request_lines" },
  { table: "purchase_orders" },
  { table: "purchase_order_lines" },
  { table: "goods_receipts" },
  { table: "goods_receipt_lines" },
  { table: "supplier_invoices" },
  { table: "supplier_invoice_lines" },
  { table: "debit_notes" },
  { table: "debit_note_lines" },
  { table: "landed_costs" },
  { table: "landed_cost_allocations" },
  { table: "purchase_reallocations" },
  { table: "purchase_reallocation_lines" },
  // PHASE-012 sales cluster (migrations 0018/0019). Draft-lifecycle tables
  // (SELECT/INSERT/UPDATE); posted rows immutable by service discipline +
  // shape CHECKs (the treasury/purchasing pattern). sales_reallocations +
  // lines are INSERT-only documents (the audited audit trail).
  { table: "sales_reps" },
  { table: "quotations" },
  { table: "quotation_lines" },
  { table: "sales_orders" },
  { table: "sales_order_lines" },
  { table: "delivery_notes" },
  { table: "delivery_note_lines" },
  { table: "sales_invoices" },
  // PHASE-020 (migration 0031): the sync update_draft handler replaces
  // DRAFT lines wholesale (aggregate snapshots — SYNC_PROTOCOL §6.2), so
  // the lines carry the sanctioned DELETE grant (DRAFT-only, single
  // writer by OWNER_DEVICE_WINS — posted lines unreachable by design).
  { table: "sales_invoice_lines", deleteGranted: true },
  { table: "credit_notes" },
  { table: "credit_note_lines" },
  { table: "sales_reallocations" },
  { table: "sales_reallocation_lines" },

  // PHASE-013 reporting cluster (migration 0020_reporting_core.sql):
  // orchestration state (SELECT/INSERT/UPDATE — no DELETE) + the template
  // registry rows (synced from the code-defined catalog).
  { table: "report_runs" },
  { table: "print_templates" },

  // PHASE-014 billing cluster (migration 0021_subscriptions_billing.sql):
  // billing history (SELECT/INSERT/UPDATE — status transitions in place),
  // the append-only billing trail (SELECT/INSERT by grants + guard — the
  // audit_events pattern), the usage read model, and the notifications
  // inbox + per-user preferences. subscriptions/entitlements were already
  // registered (PHASE-004).
  { table: "subscription_invoices" },
  { table: "billing_events" },
  { table: "usage_counters" },
  { table: "notifications" },
  { table: "notification_prefs" },

  // PHASE-015 industry configuration cluster (migration
  // 0022_industry_configuration.sql): the applied-template state
  // (SELECT/INSERT/UPDATE — no DELETE: the row is re-applied/switched in
  // place, never removed) and the composite-product definitions (full
  // definition CRUD incl. DELETE — the entitlements pattern).
  { table: "tenant_industry_config" },
  { table: "item_components", deleteGranted: true },

  // PHASE-016 POS cluster (migration 0024_pos_core.sql): the terminal
  // registry + the ledger-free floor plan (full CRUD incl. DELETE on
  // tables — the floor plan is editable), and the NARROW sync slice
  // (change_log append + read, sync_cursors SELECT/INSERT/UPDATE).
  { table: "pos_terminals" },
  { table: "pos_tables", deleteGranted: true },
  { table: "pos_checks" },
  { table: "pos_kitchen_tickets" },
  { table: "change_log" },
  { table: "sync_cursors" },

  // PHASE-017 automotive & distribution cluster (migration
  // 0025_automotive_distribution.sql): the partners-owned vehicle registry,
  // the sales-owned job cards + commission runs, and the distribution
  // module's tiers / free-goods rules / routes / visits / van-stock mirror /
  // rep settlements. Composition edits (route_customers) and the van_stocks
  // mirror rewrite carry DELETE; everything else is status-lifecycled.
  { table: "vehicles" },
  { table: "job_cards" },
  { table: "job_card_lines" },
  { table: "customer_tiers" },
  { table: "free_goods_rules" },
  { table: "routes" },
  { table: "route_customers", deleteGranted: true },
  { table: "route_visits" },
  { table: "van_stocks", deleteGranted: true },
  { table: "rep_settlements" },
  { table: "rep_settlement_lines" },
  { table: "commission_runs" },
  { table: "commission_run_lines" },

  // PHASE-018 manufacturing cluster (migration 0026_manufacturing.sql):
  // the BOM registry + lines, production orders + the frozen explosion
  // snapshot lines, consumptions, scraps, and QC inspections. bom_lines
  // carries DELETE (the DRAFT full-replace — the only delete grant); the
  // rest are status-lifecycled.
  { table: "bills_of_materials" },
  { table: "bom_lines", deleteGranted: true },
  { table: "production_orders" },
  { table: "production_order_lines" },
  { table: "production_consumptions" },
  { table: "production_scraps" },
  { table: "inspections" },

  // PHASE-019 CRM/service-billing cluster (migration 0027_crm_projects.sql):
  // the projects dimension (accounting-owned), the crm intake (leads, tasks,
  // activities), the service-contract family (contracts + billing schedule +
  // the invoices idempotency guard + advances), service orders + lines (the
  // job-card generalization, tombstone-based), and time entries. All
  // status-lifecycled — no delete grants anywhere in the cluster.
  { table: "projects" },
  { table: "leads" },
  { table: "crm_tasks" },
  { table: "crm_activities" },
  { table: "service_contracts" },
  { table: "contract_billing_schedule" },
  { table: "contract_invoices" },
  { table: "contract_advances" },
  { table: "service_orders" },
  { table: "service_order_lines" },
  { table: "crm_time_entries" },

  // PHASE-020 sync cluster (migration 0029_sync_foundation.sql): the
  // soft-delete GC ledger and the push dedupe ledger. Both carry the
  // sanctioned DELETE grant (the retention/GC maintenance jobs — the
  // entitlements/manual-journal-drafts pattern: a job-owned delete, never
  // a user-plane one).
  { table: "tombstones", deleteGranted: true },
  { table: "inbox_commands", deleteGranted: true },

  // PHASE-023 external-integrations cluster (migration
  // 0035_external_integrations.sql): the certificate S-10 registry + its
  // usage audit (DELETE = the offboarding purge only — the tombstones
  // job-owned pattern), the per-tenant adapter rollout flags, the parked
  // bank-statement lines, the commerce staging tables, and the billing
  // payout batches. e_invoicing_submissions itself is registered with the
  // PHASE-009 cluster above.
  { table: "e_invoicing_certificates", deleteGranted: true },
  { table: "e_invoicing_certificate_usage", deleteGranted: true },
  { table: "e_invoicing_adapter_settings" },
  { table: "bank_statement_parked_lines" },
  { table: "commerce_channel_orders" },
  { table: "commerce_channel_imports", deleteGranted: true },
  { table: "billing_payouts" },
  // PHASE-024 security hardening (migration 0036): the offboarding flow
  // state machine (tenant-owned during the flow — the row dies with the
  // tenant in the purge it tracks; purged_tenants is platform-owned and
  // not in this registry).
  { table: "tenant_offboarding" },

  // PHASE-026 fixed-assets cluster (migration 0037): the asset categories
  // (BR-041 purpose links), the asset register, the monthly depreciation
  // runs + their append-only 🔒 lines (UPDATE grant-denied; DELETE is
  // grant-capable but POLICY-OWNED by the erp.depreciation_lines_guard
  // trigger — posted-run lines never leave; DELETE passes only for
  // purge_mode or DRAFT-run assembly resets), the disposal documents, and
  // the audited revaluations. Everything else is status-lifecycled — no
  // delete grants on the rest of the cluster (deactivation is the category
  // delete; disposals are documents).
  { table: "asset_categories" },
  { table: "assets" },
  { table: "depreciation_runs" },
  { table: "depreciation_lines", deleteGranted: true },
  { table: "asset_disposals" },
  { table: "asset_revaluations" },
  // PHASE-027 notes & installments cluster (migration 0038): the notes
  // register + the append-only 🔒 custody log (DELETE granted for the purge
  // trigger policy — UPDATE is grant-denied outright, the
  // erp.note_events_guard trigger owns the DELETE policy) + installment
  // plans/lines. Four tables — the auto-generated A-suite extends by +24.
  { table: "notes" },
  { table: "note_events", deleteGranted: true },
  { table: "installment_plans" },
  { table: "installment_lines", deleteGranted: true },
  // PHASE-028 budgeting cluster (migration 0039): the versioned budget
  // register + the period grid lines. budgets has NO delete grant (the
  // version chain is audited history — REVISED/CLOSED stay readable for
  // variance truth); budget_lines carries deleteGranted for the DRAFT
  // bulk-replace path (the service never deletes a non-DRAFT parent's
  // lines). Two tables — the auto-generated A-suite extends by +12.
  { table: "budgets" },
  { table: "budget_lines", deleteGranted: true },
  // PHASE-029 payroll cluster (migration 0040): the PII-restricted
  // employee file + the versioned salary structures with their components +
  // the monthly runs with their append-only 🔒 run lines (UPDATE
  // grant-denied outright; DELETE grant-capable but POLICY-OWNED by the
  // erp.payroll_run_lines_guard trigger — DRAFT recalc resets + purge
  // only) + the employee loans with their schedule lines (no deletes:
  // lines transition, never leave). Seven tables — the auto-generated
  // A-suite extends by +42.
  { table: "employees" },
  { table: "salary_structures" },
  { table: "salary_components", deleteGranted: true },
  { table: "payroll_runs" },
  { table: "payroll_run_lines", deleteGranted: true },
  { table: "employee_loans" },
  { table: "employee_loan_lines" },
];

export const TENANT_TABLE_NAMES: readonly string[] = TENANT_TABLES_REGISTRY.map(
  (row) => row.table,
);
