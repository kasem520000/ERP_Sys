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
  // PHASE-035 gate repair (recorded): the four 0041 consolidation tables
  // (groups, membership, eliminations, runs — all under the standard
  // erp.apply_tenant_policy macro, owner-plane rows). The restored lineage
  // shipped them unregistered — the A-suite's negative proof (every
  // tenant_id table registered) had never run on a fresh chain to catch it.
  // The auto-generated A-suite extends by +24.
  { table: "consolidation_groups" },
  { table: "group_entities" },
  { table: "elimination_entries" },
  { table: "consolidation_runs" },
  // PHASE-036 (Blueprint v3.0 · CR-06): the extensibility core's five
  // tenant tables (migration 0049 — the FD-18/FD-19/FD-20 substrate):
  // the definitions registry (archive-not-delete — NO delete grant), the
  // TYPED value store (deleteGranted: the replace-semantics path — a
  // PATCH omitting a key clears its value), the picklist pair
  // (archive-not-delete), and the form-layout store (deleteGranted: the
  // role-override removal path). Five tables — the auto-generated A-suite
  // extends by +30.
  { table: "custom_field_definitions" },
  { table: "custom_field_values", deleteGranted: true },
  { table: "custom_picklists" },
  { table: "custom_picklist_options" },
  { table: "form_layouts", deleteGranted: true },
  // PHASE-037 (Blueprint v3.0 · CR-07, migration 0050): the ZATCA EIAS
  // device registry — the chain anchor (icv_counter) is immutable
  // history, so NO delete grant (SELECT/INSERT/UPDATE only; the purge
  // path covers offboarding). One table — the auto-generated A-suite
  // extends by +6.
  { table: "zatca_devices" },
  // PHASE-038 (Blueprint v3.0 · CR-08, migrations 0051–0054): the
  // procurement sourcing & supplier-collaboration cluster. The two line
  // tables carry the DELETE grant (the replace-on-DRAFT-edit /
  // re-submission paths — the services never delete a non-DRAFT
  // parent's lines); everything else is archive-not-delete (sourcing
  // history, the append-only release ledger, the workflow states). The
  // award snapshot (quote_comparisons) is evidence — no deletes. Thirteen
  // tables — the auto-generated A-suite extends by +78.
  { table: "rfqs" },
  { table: "rfq_lines", deleteGranted: true },
  { table: "supplier_quotes" },
  { table: "supplier_quotes_lines", deleteGranted: true },
  { table: "quote_comparisons" },
  { table: "blanket_orders" },
  { table: "blanket_releases" },
  { table: "supplier_ratings" },
  { table: "approved_supplier_items" },
  { table: "supplier_advances" },
  { table: "early_payment_discount_terms" },
  { table: "capex_requests" },
  { table: "tender_intakes" },
  // PHASE-039 (Blueprint v3.0 · CR-09, migrations 0055 + 0059): the
  // returns cluster — the customer RMA pair, the managed-warranty register,
  // and the supplier RMA mirror. Workflow history is archive-not-delete on
  // the three headers (SELECT/INSERT/UPDATE only); the two line tables
  // carry the DELETE grant (replace-on-edit, DRAFT only — the rfq_lines
  // precedent). Five tables — the auto-generated A-suite extends by +30.
  { table: "return_authorizations" },
  { table: "return_authorization_lines", deleteGranted: true },
  { table: "warranty_registrations" },
  { table: "supplier_return_authorizations" },
  { table: "supplier_return_authorization_lines", deleteGranted: true },
  // PHASE-039 (Blueprint v3.0 · CR-09, migrations 0056 + 0058): the
  // dunning + collections cluster — the policy ladder, the BR-065 letter
  // register with its late-fee columns, the logged collection actions, and
  // the collection-agency pair. All archive-not-delete (compliance
  // history: agencies suspend, referrals close, letters and actions are
  // evidence — NO deleteGranted on any of the five). Five tables — the
  // auto-generated A-suite extends by +30.
  { table: "dunning_policies" },
  { table: "dunning_letters" },
  { table: "collection_actions" },
  { table: "collection_agencies" },
  { table: "collection_referrals" },
  // PHASE-040 (Blueprint v3.0 · CR-10, migration 0060): the data-onboarding
  // substrate — saved import column maps + export templates. Tenant user
  // data (no document/compliance semantics): the DELETE grant is legitimate
  // (mappings are re-editable and removable), the entitlements precedent.
  // One table — the auto-generated A-suite extends by +6.
  { table: "import_mappings", deleteGranted: true },
  // PHASE-041 (Blueprint v3.0 · CR-11, migration 0064): the communications
  // hub. message_templates + notification_preferences are tenant user data
  // (re-editable and removable — the import_mappings precedent); the other
  // two are LEDGER/log semantics (SELECT/INSERT/UPDATE only — no app-role
  // DELETE, the dunning_letters precedent). Four tables — the
  // auto-generated A-suite extends by +24.
  { table: "message_templates", deleteGranted: true },
  { table: "outbound_messages" },
  { table: "notification_preferences", deleteGranted: true },
  { table: "communication_log" },
  // PHASE-042 (Blueprint v3.0 · CR-12, migrations 0065/0066): the
  // manufacturing-execution cluster. work_centers/routings/routing_operations/
  // production_order_operations/rework_orders/downtime_records/item_standard_
  // costs are master-data/document rows (SELECT/INSERT/UPDATE — version
  // lifecycles, no app-role DELETE, the 0026 manufacturing precedent).
  // Seven tables — the auto-generated A-suite extends by +42.
  { table: "work_centers" },
  { table: "routings" },
  { table: "routing_operations" },
  { table: "production_order_operations" },
  { table: "rework_orders" },
  { table: "downtime_records" },
  { table: "item_standard_costs" },
  // PHASE-044 (Blueprint v3.0 · CR-14, migrations 0067…0071): the WMS
  // cluster. The location tree + LPN + the packaging register + strategies/
  // schedules/classifications/policies/jobs are master data
  // (SELECT/INSERT/UPDATE — lifecycles, no app-role DELETE, the 0026
  // precedent); bin_contents is a POSITION table (SELECT/INSERT/UPDATE);
  // waves/tasks/documents/lines/kit orders + exceptions are document rows;
  // serial_movements + returnable_packaging_movements are append-only
  // logs (SELECT/INSERT only — the stock_moves discipline, deleteGranted
  // false). Twenty-two tables — the auto-generated A-suite extends by +132.
  { table: "warehouse_zones" },
  { table: "warehouse_aisles" },
  { table: "warehouse_racks" },
  { table: "warehouse_bins" },
  { table: "lpns" },
  { table: "bin_contents" },
  { table: "returnable_packaging" },
  { table: "returnable_packaging_movements" },
  { table: "putaway_rules" },
  { table: "pick_strategies" },
  { table: "pick_waves" },
  { table: "pick_tasks" },
  { table: "cycle_count_schedules" },
  { table: "cycle_count_documents" },
  { table: "cycle_count_lines" },
  { table: "abc_classifications" },
  { table: "serial_movements" },
  { table: "transfer_pricing_policies" },
  { table: "transit_exceptions" },
  { table: "inventory_alert_jobs" },
  { table: "warehouse_kit_orders" },
  { table: "warehouse_kit_lines" },
  // PHASE-043 (CR-13 — MRP & Planning; migrations 0074…0078): the planning
  // cluster — mps_entries, the BOM planning satellites (substitutions/
  // outputs/bill_of_resources — DELETE granted for the DRAFT full-replace
  // discipline, the bom_lines 0026 precedent), the MRP run family (runs +
  // demand lines + supply lines + suggestions — status lifecycles, no
  // deletes: superseded rows stay as audit trail), and the tolling pair.
  // lot_sizing_rules carries NO tenant_id (the global permissions-pattern
  // catalog — deliberately not registered here).
  { table: "mps_entries" },
  { table: "bom_substitutions", deleteGranted: true },
  { table: "bom_outputs", deleteGranted: true },
  { table: "bill_of_resources", deleteGranted: true },
  { table: "mrp_runs" },
  { table: "mrp_demand_lines" },
  { table: "mrp_supply_lines" },
  { table: "mrp_suggestions" },
  { table: "contract_mfg_orders" },
  { table: "contract_mfg_moves" },
  // PHASE-045 (CR-15 — HR Core; migrations 0080…0086; started in parallel
  // with the 043-completion review per the owner's directive): the HR
  // operational cluster — the shift family (templates + the employee ×
  // date roster grid — DELETE granted: a grid cell is replaceable by
  // design), the punch sessions (no DELETE: the operational truth;
  // corrections arrive as new rows, BR-082), the overtime family (the
  // pre-approval lifecycle), the leave family (per-year balance cells +
  // the simple-approval requests), and the holiday calendars.
  { table: "shifts", deleteGranted: true },
  { table: "shift_rotations", deleteGranted: true },
  { table: "attendance_records" },
  { table: "overtime_rules" },
  { table: "overtime_entries" },
  { table: "leave_types" },
  { table: "leave_balances" },
  { table: "leave_requests" },
  { table: "holiday_calendars", deleteGranted: true },
  { table: "holidays", deleteGranted: true },
  // PHASE-045 T-05 (migration 0087, added 2026-11-15): the device-import
  // cluster — the import LOG (append-only: no UPDATE, no DELETE — the
  // fingerprint floor's evidence) and the anomaly QUARANTINE (no DELETE:
  // the quarantine is the evidence; the resolution is the UPDATE).
  { table: "attendance_import_batches" },
  { table: "attendance_import_anomalies" },
  // PHASE-046 (CR-16 — HR Payroll Compliance; migrations 0089/0090): the
  // statutory cluster — the contribution profiles + the PIT brackets (the
  // verification trail is evidence: NO delete grant — retirement is
  // status RETIRED, BR-085), the EOSB tiers (master data — DELETE
  // granted, the shifts precedent), and the EOSB calculations (the
  // computation evidence: SELECT/INSERT/UPDATE only). Four tables — the
  // auto-generated A-suite extends by +24.
  { table: "statutory_contribution_profiles" },
  { table: "payroll_tax_brackets" },
  { table: "eosb_rules", deleteGranted: true },
  { table: "eosb_calculations" },
  // PHASE-047 (CR-17 — HR Growth, Talent & Performance; migrations
  // 0095–0097; the W-1 foundation wave): the talent cluster — FOURTEEN
  // tables in three families. Master/operational data (DELETE granted:
  // the typed service guards own the lifecycles): performance_cycles,
  // competencies, competency_levels, vacancies, training_programs,
  // org_units, positions, employee_documents. The evidence discipline
  // (SELECT/INSERT/UPDATE only — the terminal soft states are status
  // flips, never erasures): performance_reviews (the 360 aggregate's
  // source rows), goals (CANCELLED), applicants (the hiring record),
  // interviews (the panel record), training_enrollments (WITHDRAWN),
  // certifications (renewal is the UPDATE). The auto-generated A-suite
  // extends by +84.
  { table: "performance_cycles", deleteGranted: true },
  { table: "performance_reviews" },
  { table: "competencies", deleteGranted: true },
  { table: "competency_levels", deleteGranted: true },
  { table: "goals" },
  { table: "vacancies", deleteGranted: true },
  { table: "applicants" },
  { table: "interviews" },
  { table: "training_programs", deleteGranted: true },
  { table: "training_enrollments" },
  { table: "certifications" },
  { table: "org_units", deleteGranted: true },
  { table: "positions", deleteGranted: true },
  { table: "employee_documents", deleteGranted: true },
  // PHASE-047 (W-3, T-09 — migration 0099, D-06): the hr-expiry-sweep's
  // registration + run-stats row (the 044 inventory pattern — SELECT/
  // INSERT/UPDATE only, the config row is the register; the upsert is
  // the update path). The auto-generated A-suite extends by +6.
  { table: "hr_alert_jobs" },
  // PHASE-048 (CR-18 — Projects & Contracting; migrations 0100–0103; the
  // W-8 foundation wave, 2026-11-20): the projects cluster — ELEVEN
  // tables. Planning data (DELETE granted — the typed service guards
  // own the lifecycles; the 028 budget_lines DRAFT-bulk-replace
  // precedent): project_wbs_tasks, project_budget_lines (budgets NO
  // delete — the approved curve is the variance truth, the 028
  // precedent), project_resource_allocations. The evidence discipline
  // (SELECT/INSERT/UPDATE only — the commercial record is audited
  // history): change_orders (REJECTED stays readable), retention_
  // accounts (the ledger), progress_certificates (the billing events),
  // service_visits (CLOSED is the terminal state), ias23_capitalizations
  // (the computation evidence). Master data (DELETE granted — the
  // certificates' RESTRICT edge protects the ones with history):
  // subcontractor_agreements. The auto-generated A-suite extends by +66.
  { table: "project_wbs_tasks", deleteGranted: true },
  { table: "project_budgets" },
  { table: "project_budget_lines", deleteGranted: true },
  { table: "project_resource_allocations", deleteGranted: true },
  { table: "change_orders" },
  { table: "subcontractor_agreements", deleteGranted: true },
  { table: "subcontractor_certificates" },
  { table: "retention_accounts" },
  { table: "progress_certificates" },
  { table: "service_visits" },
  { table: "ias23_capitalizations" },
  // PHASE-049 (CR-19, extended by v3.2/CR-50 — CMMS Asset Maintenance;
  // migrations 0105–0107; the W-16 foundation wave, 2026-11-21): the
  // CMMS cluster — EIGHT tables. Master data (DELETE granted — the typed
  // service guards own the lifecycles; generated history's FKs protect
  // the parents): maintenance_plans, maintenance_plan_tasks (the
  // checklist CASCADEs with its plan — the 0101 budget_lines precedent),
  // asset_meters, asset_spares (the BOM), asset_tags (the signed codes).
  // The evidence discipline (SELECT/INSERT/UPDATE only — the audited
  // history): maintenance_work_orders (the machine + the G-59 completion
  // stamp — the order history is the service timeline's spine),
  // asset_meter_readings (the readings log the usage views derive from),
  // asset_transfers (the approval ladder — REJECTED stays readable, the
  // change_orders precedent). The auto-generated A-suite extends by +48.
  { table: "maintenance_plans", deleteGranted: true },
  { table: "maintenance_plan_tasks", deleteGranted: true },
  { table: "maintenance_work_orders" },
  { table: "asset_meters", deleteGranted: true },
  { table: "asset_meter_readings" },
  { table: "asset_spares", deleteGranted: true },
  { table: "asset_tags", deleteGranted: true },
  { table: "asset_transfers" },
  // PHASE-049 (W-17, the work-order engine + plans; migration 0109; the
  // D-02-dated honest +9/+10 provision — 0105's own recorded note): the
  // engine's two line tables. maintenance_cost_lines (the three cost
  // collectors): master data WITH DELETE granted (0105's own class for
  // service-guarded lifecycles — the typed service refuses every touch
  // after COMPLETION by name, WORK_ORDER_COMPLETED; the open order's
  // lines are the working surface). maintenance_work_order_steps (the
  // carried checklist + per-step results): S/I/U only — NO DELETE ever
  // (BR-098's integrity floor: an open step cannot be deleted to force
  // completion). The auto-generated A-suite extends by +12.
  { table: "maintenance_cost_lines", deleteGranted: true },
  { table: "maintenance_work_order_steps" },
  // PHASE-050 (CR-20 — QMS, Quality Management System; migrations
  // 0113–0116; the W-24 foundation wave, 2026-11-22): the quality
  // cluster — TWELVE tables. Master data (DELETE granted — the typed
  // service guards own the lifecycles): quality_specifications (the
  // per-item parameter register), hazard_registers (the tenant-owned
  // HACCP structure, D-15). Rebuildable derived data (DELETE granted —
  // the fold recomputes): supplier_quality_scores (the 038 feed
  // contract's own rows, D-13). The evidence discipline (SELECT/INSERT/
  // UPDATE only — the audited history): spc_measurements (the chart's
  // own samples), ncr_records (BR-102's spine + the G-62 stamp),
  // capa_records (BR-103 + the G-63 stamp), complaints (the NCR link),
  // calibration_records (the instrument-asset history, D-08),
  // coa_documents (the frozen certificate snapshot),
  // batch_quality_holds (the INV-035 audit trail), recall_registry
  // (the drill's record), quality_management_reviews (the indicator
  // pack). The auto-generated A-suite extends by +72.
  { table: "quality_specifications", deleteGranted: true },
  { table: "spc_measurements" },
  { table: "ncr_records" },
  { table: "capa_records" },
  { table: "complaints" },
  { table: "calibration_records" },
  { table: "supplier_quality_scores", deleteGranted: true },
  { table: "coa_documents" },
  { table: "batch_quality_holds" },
  { table: "recall_registry" },
  { table: "quality_management_reviews" },
  { table: "hazard_registers", deleteGranted: true },
];

export const TENANT_TABLE_NAMES: readonly string[] = TENANT_TABLES_REGISTRY.map(
  (row) => row.table,
);
