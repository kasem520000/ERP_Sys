import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

/**
 * Migration manifest (MIGRATION_STRATEGY §1): the ordered `NNNN_description`
 * tags mirror `apps/api/migrations/meta/_journal.json` and the SQL files on
 * disk. `/health/ready` compares `erp.schema_version()` (upserted by every
 * migration) against this list; a stale build against a newer schema fails
 * readiness. The unit test `migrations.spec.ts` asserts manifest ↔ journal ↔
 * files never drift.
 *
 * Convention: every `NNNN_*.sql` must upsert
 * `INSERT INTO erp._schema_state (key, value) VALUES ('schema_version', N)`
 * with its own number — enforced by the same unit test.
 */
export const MIGRATIONS: readonly string[] = [
  "0001_core_infra",
  "0002_rls_macro",
  "0003_identity_core",
  "0004_permissions_seed",
  "0005_system_role_templates_seed",
  "0006_tenancy_provisioning",
  "0007_accounts_schema",
  "0008_platform_seeds",
  "0009_partners_items",
  "0010_accounting_core",
  "0011_journal_tables",
  "0012_treasury",
  "0013_tax",
  "0014_inventory_core",
  "0015_inventory_tracking",
  "0016_purchasing_core",
  "0017_purchasing_ap",
  "0018_sales_core",
  "0019_sales_ar",
  "0020_reporting_core",
  "0021_subscriptions_billing",
  "0022_industry_configuration",
  "0023_notifications_categories",
  "0024_pos_core",
  "0025_automotive_distribution",
  "0026_manufacturing",
  "0027_crm_projects",
  // PHASE-019 T48 (the recorded deviation — agent-ctx/T48-7-service-orders.md):
  // 0027 missed the stock_reservations.holder_type widening for
  // SERVICE_ORDER holders (0025 gave JOB_CARD its counterpart in the same
  // migration that created job_cards); this re-issues the CHECK with
  // 'SERVICE_ORDER' added. Additive only — see 0028_crm_service_order_holder.sql.
  "0028_crm_service_order_holder",
  // PHASE-020 (MASTER-PLAN §3): the offline synchronization foundation —
  // tombstones + inbox_commands (tenant-owned, RLS), device_refresh_tokens
  // (the sessions pattern), the devices registry widening, the
  // sales_invoices owner-device stamp, the sync permission re-assertions
  // and the offline.* plan grants. See 0029_sync_foundation.sql.
  "0029_sync_foundation",
  // PHASE-020 T5 (the substrate fix, agent-ctx/T-P20-2a-pull.md): 0024
  // granted erp_app INSERT on change_log but missed USAGE on its bigserial
  // sequence change_log_seq_seq — the feed writers could never append as
  // erp_app. Additive grant only. See 0030_sync_change_log_sequence_grant.sql.
  "0030_sync_change_log_sequence_grant",
  // PHASE-020 T9 (SYNC_PROTOCOL §6.2 aggregate snapshots): the sync
  // update_draft handler replaces DRAFT invoice lines wholesale
  // (DELETE + re-INSERT); 0018 never granted DELETE (online drafts are
  // append-only). DRAFT-only by handler discipline + OWNER_DEVICE_WINS
  // single-writer. See 0031_sync_draft_line_replace.sql.
  "0031_sync_draft_line_replace",
  // PHASE-021 DR-P21-01 (MASTER-PLAN §1 item 2): devices.device_key_hash
  // relaxed to nullable — the one-time enrollment proof's "consumed" state
  // is NULL (POST /api/v1/devices/:id/enroll clears it on success).
  // Backward compatible: every existing writer still provides a hash.
  // See 0032_device_enrollment_one_time.sql.
  "0032_device_enrollment_one_time",
  // PHASE-022 DR-P22-05a (MASTER-PLAN §1 item 5): devices.linked_partner_id —
  // the personal-account device's linked partner, the server-side partner
  // scope for the personal pull feeds (LOCAL_DATABASE §1.1 rule 2). Nullable
  // plain uuid (devices stays service-mediated — no cross-plane FK); NULL =
  // no linkage → the personal pull serves an empty partner scope (fail
  // closed). No business-schema change. See 0033_mobile_feeds.sql.
  "0033_mobile_feeds",
  // PHASE-022 DR-P22-07a (MASTER-PLAN §1 item 7): the FCM skeleton's
  // device-token opt-in store — the dedicated service-mediated table (the
  // 0029 device_refresh_tokens pattern; devices has no natural JSON column
  // for push tokens). opted_in defaults FALSE (explicit opt-in, default OFF);
  // one active row per device (uq device_id), a token never belongs to two
  // devices (uq token); revocation clears the rows. No business-schema change
  // (the DR-P22-05a reading). See 0034_device_push_tokens.sql.
  "0034_device_push_tokens",
  // PHASE-023 (external integrations): the operational e-invoicing registry
  // expansion (submissions × adapter 1:N, attempts/backoff, sealed
  // payload/response artifacts, retry sweep), the S-10 certificate store +
  // append-only usage audit (secret-store PATH only — key material lives in
  // the files module), per-tenant adapter rollout flags (default OFF), the
  // bank-statement parked lines + seeded format registry, the commerce
  // channel staging tables (natural-key upsert, server-decision conflicts),
  // and the billing payout batches (T6 reconciliation substrate). See
  // 0035_external_integrations.sql.
  "0035_external_integrations",
  // PHASE-024: 0036_security_hardening.sql (MFA policy substrate + the
  // offboarding purge path + audit-review indexes — T4/T8/T11).
  "0036_security_hardening",
  // PHASE-026: 0037_fixed_assets.sql (the fixed_assets module per DR-002
  // option A: asset_categories/assets/depreciation_runs/depreciation_lines 🔒/
  // asset_disposals/asset_revaluations + the six v2.0 CoA purposes + 13
  // permission seeds + plan/role grants + the RC-10 reconciliation kind).
  "0037_fixed_assets",
  // PHASE-027: 0038_notes_installments.sql (the notes & installments modules
  // per DR-003/ED-03 option A: notes/note_events 🔒/installment_plans/
  // installment_lines + the treasury_allocations note_id widening (the
  // settle/restore substrate) + the four v2.0 CoA purposes (1160/2150/4920/
  // 5260) + the notes.notes.return seed (0004/0005 in-phase edits) + the 12
  // feature-key plan grants + the RC-11 'NOTES' kind + the notification
  // category widening).
  "0038_notes_installments",
  // PHASE-032: 0039_education_template.sql (the education commercial shell
  // per ED-08 — configuration only: the industry_templates registry seed
  // converging the 0008 index row to the full v1.0.0 industry.education
  // manifest, the §J ar.aging report-key reconciliation; NO new tables,
  // modules, feature keys, or permission keys — the installments/notes plan
  // grants landed with 0038 already).
  "0039_education_template",
  // PHASE-033: 0040_agriculture_template.sql (the agriculture commercial
  // shell per ED-09 — configuration only: the industry_templates registry
  // seed converging the 0008 index row to the full v1.0.0
  // industry.agriculture manifest, the §J inventory.valuation report-key
  // reconciliation; NO new tables, modules, feature keys, or permission
  // keys — every required key was already granted by 0008/0026/0027, the
  // first shipped template whose REQUIRED chain needs no plan grants).
  "0040_agriculture_template",
  // PHASE-034: 0041_consolidation.sql (the consolidation module per ADR-0018
  // / DR-006 option A: consolidation_groups/group_entities/elimination_
  // entries/consolidation_runs + the consolidation_run_status §9 enum +
  // the CONSOLIDATION_ADJUSTMENT CoA template account 3220 + the 5 §3.15
  // permission seeds + the 5 feature-key plan grants + THE platform-plane
  // reader — role erp_consolidation_reader NOLOGIN BYPASSRLS, SELECT-only
  // grants on the member GL read models, and the one SECURITY DEFINER
  // reader function erp.consolidation_read_member_gl (BR-056 re-verified
  // in-function; zero cross-tenant writes at the grant level)).
  "0041_consolidation",
  // ── RESTORED LINEAGE (the pre-reset phases 028–031, recovered from
  // ERP_PLATFORM_PHASE031.zip and merged post-034): their migrations keep
  // their CONTENT byte-faithful but are renumbered to APPEND after the
  // live 0039–0041 set (application order, not phase order — every
  // migration is additive and cross-independent; on a fresh database the
  // 0001→0046 chain converges to the same end state either way). The
  // original lineage numbering was 0039_budgeting/0040_payroll/
  // 0041_industry_wholesale_electronics/0042_healthcare_claim_ref/
  // 0043_industry_healthcare → restored as 0042–0046; schema_version
  // numbers inside each file shifted accordingly (39→42, 40→43, 41→44,
  // 42→45, 43→46). ──
  // PHASE-028: 0042_budgeting.sql (the budgeting module per DR-004/ED-04
  // option A: budgets + budget_lines — versioned budgets by fiscal year &
  // scope with the BR-050 partial unique (one ACTIVE per tenant/year/scope)
  // + period-level amounts over account/cost-center/project/branch
  // dimensions; NOT ledger documents — zero journal rules, zero goldens,
  // zero CoA purposes) + the notifications category widening ('budgeting')
  // + the six §22 feature-key plan grants. §3.13 permissions pre-seeded in
  // 0004/0005 (docs-as-contract — nothing to add, drift stays 245=245).
  "0042_budgeting",
  // PHASE-029: 0043_payroll.sql (the payroll module per DR-005/ED-05,
  // financial scope only: employees (PII-restricted) + salary_structures
  // + salary_components (BR-052 versioning) + payroll_runs/run_lines 🔒
  // (INV-025 row-level totals law, one G-29 journal per run, BR-053
  // engine-only payroll accounts) + employee_loans/lines (BR-054 cap) +
  // the six CoA template purposes (2170/2180/2190/5270/5280/5295 — the
  // loan control account deliberately NOT a purpose) + the cash_movements
  // source widening ('payroll_payout', 'employee_loan' — additive) + the
  // notifications category widening ('payroll') + the eight §22
  // feature-key plan grants. §3.14 permissions pre-seeded in 0004/0005
  // with the payroll_officer role template (drift stays 245=245).
  "0043_payroll",
  // PHASE-030: 0044_industry_wholesale_electronics.sql (the first two
  // Blueprint v2.0 stage-10 industry templates per ED-06 — DATA-ONLY:
  // industry.wholesale + industry.electronics registry rows at v1.0.0,
  // the report pins reconciled to the live keys ar.aging /
  // inventory.valuation; zero new tables/columns/enums/journals/
  // permissions/plan-grants — INV-022: templates are configuration,
  // never a fork; every REQUIRED key was granted by earlier migrations
  // (notes by 0038, POS by 0024, crm.service_orders by 0027), and the
  // typed workflow-policy keys register in the code-owned POLICY_REGISTRY).
  "0044_industry_wholesale_electronics",
  // PHASE-031: 0045_healthcare_claim_ref.sql (the Healthcare Commercial
  // Shell's SINGLE schema change per ED-07 — the additive nullable
  // sales_invoices.claim_ref varchar(64), the external insurer claim
  // reference: non-null = a claim (insured) invoice billed to the
  // insurance-company partner, NULL = self-pay; plus the optional partial
  // (tenant_id, claim_ref) grouping index. No backfill, no default, RLS
  // untouched — ADR-0006 (never an official document number) + INV-022
  // (metadata that never enters a journal line)).
  "0045_healthcare_claim_ref",
  // PHASE-031: 0046_industry_healthcare.sql (the industry.healthcare
  // v1.0.0 registry seed — DATA-ONLY per the 0044 convention: the manifest
  // transcribed VERBATIM with the partners.ar_aging pin reconciled to the
  // live ar.aging key (inventory.expiry_list / notes.aging /
  // notes.maturity-calendar resolve verbatim); every REQUIRED key granted by
  // earlier migrations so the engine classifies everything LIVE, including
  // the shell's own insurance_claim_billing capability at
  // available_from_phase PHASE-031; the six typed workflow-policy keys
  // register in the code-owned POLICY_REGISTRY — zero new tables/columns/
  // enums/journals/permissions/plan-grants, INV-022).
  "0046_industry_healthcare",
  // DELIVERY COMPLETION (post-034 audit): 0047_industry_rental_logistics.sql
  // (the thirteenth — final — industry template, closing the 13-activity
  // INDUSTRY_CATALOG the blueprint documents): DATA-ONLY per the 0044/0046
  // convention — industry.rental_logistics registry row at v1.0.0, the
  // 0008 phase-019 stub converging to the full manifest; the report pins
  // reconciled to the LIVE keys inventory.serial-tracking /
  // distribution.route_visit_compliance / services.contract_revenue_schedule
  // / ar.aging; the capability set ≡ the CAPABILITY_MATRIX §1 RNT column
  // (strict both directions); zero new tables/columns/enums/journals/
  // permissions/plan-grants (INV-022; drift stays 245=245) — the deferred
  // crm.contract_deposits / crm.late_fees intake pair (RISK-019) stays
  // deferred, and the seven typed workflow-policy keys register in the
  // code-owned POLICY_REGISTRY.
  "0047_industry_rental_logistics",
  // PHASE-035 T-01 (Blueprint v3.0 · CR-05): 0048_items_import_export_grant
  // — the activation repair for audit EVAL-F-5 / H-18: the fully-built
  // PHASE-006 import/export surface (screen, controller, dry-run validation)
  // was granted to NO plan, so the sidebar never showed it. DATA-ONLY per the
  // 0042/0043 plan-grant block precedent: items.import_export joins business +
  // enterprise (starter keeps manual entry; BR-040 closure deps already in
  // place); zero new tables/columns/enums/journals/permission keys (INV-022;
  // drift stays 245=245); idempotent array_cat guard.
  "0048_items_import_export_grant",
  // PHASE-036 (Blueprint v3.0 · CR-06): 0049_custom_fields — the
  // extensibility core per ADR-0019 / FD-18/FD-19/FD-20 + DF-39: five
  // RLS'd tenant tables (custom_field_definitions + the TYPED value store
  // custom_field_values with the num_nonnulls one-typed-column law +
  // custom_picklists/custom_picklist_options with archive-preserving
  // history + form_layouts with the two partial uniques for default/role
  // layouts), the three §3.8 permission seeds (drift 245 → 248) + the
  // accountant read grant, and the platform.custom_fields plan grant
  // (business + enterprise — the tier-4 precedent; starter excluded).
  // NOT ledger documents — zero journal rules by construction.
  "0049_custom_fields",
  // PHASE-037 (Blueprint v3.0 · CR-07): 0050_zatca_phase1 — the ZATCA
  // Phase-1 GENERATION substrate (H-01 Phase-1 / H-02): additive NULLABLE
  // sales_invoices columns (zatca_device_id / icv / previous_invoice_hash /
  // invoice_hash / invoice_hash_version / qr_payload / classification +
  // the partial unique (tenant, device, icv) INV-027 floor + the
  // EXPLAIN-verified chain-walk index), and the RLS'd zatca_devices
  // registry (NOT_REGISTERED-only in Phase-1 — BR-061; icv_counter is the
  // chain anchor). One permission seed (tax.einvoicing.devices.manage —
  // drift 248 → 249). NOT ledger documents — the stamp rides the
  // invoice's own post transaction; zero journal rules.
  "0050_zatca_phase1",
  // PHASE-038 (Blueprint v3.0 · CR-08): 0051_rfq_quotes — the sourcing
  // negotiation loop (H-11/P-01/P-02/P-08): rfqs (open/invited, lifecycle
  // DRAFT→ISSUED→QUOTED→AWARDED→CLOSED with stamp-shape CHECKs, portal
  // invite token hashes), rfq_lines, supplier_quotes (+lines, one per
  // supplier per RFQ), and quote_comparisons (the frozen snapshot + the
  // award; ONE live per RFQ). Seven permission seeds (drift 249 → 256 —
  // matrix §3.16) + the FIVE feature-key plan grants (business +
  // enterprise — the tier-4 precedent). NOT ledger documents — awards
  // generate purchase orders, never journals.
  "0051_rfq_quotes",
  // PHASE-038: 0052_blanket_orders — the commitment instruments (P-03):
  // blanket_orders (validity window, min/max commitment, price lock, the
  // transactional released_amount accumulator) + the append-only
  // blanket_releases ledger (each release carries its generated purchase
  // order) + the additive purchase_orders.contract_id (P-06 contract
  // linkage → crm.service_contracts). Zero new permission/feature keys
  // (rides 0051's).
  "0052_blanket_orders",
  // PHASE-038: 0053_supplier_collaboration — the collaboration cluster
  // (P-04/P-12/P-13): supplier_ratings (the rolling-window scorecard),
  // approved_supplier_items (the approved-vendor-per-item gate),
  // supplier_advances (G-33 disbursement/apply tracking with the
  // tenant-mapped control account), and early_payment_discount_terms
  // (G-34 capture rides the approved terms). Zero new permission keys;
  // the G-33/G-34 journal rules register in JOURNAL_RULES §7.
  "0053_supplier_collaboration",
  // PHASE-038: 0054_capex_tenders — capex_requests (P-10/P-15: the
  // workflow with SoD + the PHASE-028 budget guard at submit —
  // ADVISORY default / ENFORCE_DRAFT per policy, the evaluation snapshot
  // persists) and tender_intakes (P-14/DF-52/DF-53: intake records ONLY
  // — no bidding-platform claims). Zero new permission/feature keys.
  "0054_capex_tenders",
  // PHASE-039: 0055_rma_warranty — the customer RMA workflow (H-12/S-14:
  // return_authorizations + lines, REQUESTED→APPROVED(SoD)→RECEIVED→
  // INSPECTED→RESTOCKED/SCRAPPED/REFUNDED, completion auto-generates the
  // credit note — G-35/G-36/G-37, BR-064) + warranty_registrations with
  // structured terms (S-15). 3 of the phase's 10 tables.
  "0055_rma_warranty",
  // PHASE-039: 0056_dunning_collections — the dunning engine (H-13/S-16:
  // dunning_policies step ladder + dunning_letters — the BR-065 monotonic
  // evidence — + collection_actions) with the late-fee rules ON the policy
  // (L1-12). CHECK widenings: notifications += 'collections','warranties';
  // cash_movements += 'return_authorization'. ALL NINE permission keys
  // (256 → 265) + ALL FOUR feature keys (sales.rma, sales.warranties,
  // sales.dunning, purchasing.rma).
  "0056_dunning_collections",
  // PHASE-039: 0057_partner_credit_risk — the L1-10 additive partner
  // columns (credit_score_class A|B|C|D + the periodic review clock) —
  // zero reshape; the review-due sweep assigns via notifications and the
  // outcome history rides audit_events.
  "0057_partner_credit_risk",
  // PHASE-039: 0058_collection_agencies — the L1-11 layer: the
  // partner-linked agency register (hashed callback tokens — the 038
  // portal pattern, erp.portal_resolve_agency_token) + collection_referrals
  // (settlement ladder; the G-39 commission posts through the engine).
  "0058_collection_agencies",
  // PHASE-039 (v3.2/R-03, decided before any 039 code): 0059_supplier_rma
  // — the supplier RMA mirror: supplier_return_authorizations + lines
  // (REQUESTED→APPROVED(SoD)→SHIPPED→CREDITED; completion auto-generates
  // the AP debit note — G-38). Completes the phase's 10 tables.
  "0059_supplier_rma",
  // PHASE-040 (Blueprint v3.0 · CR-10; scope extended by v3.1/CR-46 —
  // L1-21 export templates): 0060_import_toolkit — the data-onboarding
  // substrate: import_mappings (saved column maps, both directions),
  // the import_jobs kind widening (+7 kinds: COA,
  // ACCOUNT_OPENING_BALANCES, FIXED_ASSETS, EMPLOYEES, PRICE_LISTS,
  // CONTRACTS, BUDGETS) + mapping_id/options, the tenants SANDBOX plane
  // (kind/expires/quota/owner-email — OA-05) + demo-seed markers
  // (TB-19/20), the two configuration.* permission keys (265 → 267) and
  // the two feature plan grants (platform.data_migration business+
  // enterprise; platform.demo_data all plans). Numbering note: the phase
  // doc planned 0058 "next after 0057" — written before the v3.2/R-03
  // extension consumed 0055–0059; 0060 is the honest next slot.
  "0060_import_toolkit",
  // PHASE-040 (OA-05): 0061_sandbox_enforcement — the SANDBOX time-box
  // substrate: user_membership_options gains tenantKind + sandboxExpired
  // (computed) so login and the per-request interceptor enforce the
  // sandbox expiry from the projection they already read (the SUSPENDED
  // precedent). Zero tables; one definer function widened additively.
  "0061_sandbox_enforcement",
  // PHASE-040 (BR-066, the T-10 spec catch): 0062_import_jobs_mapping —
  // the import_jobs mapping snapshot column. The worker's re-validation
  // uses EXACTLY the mapping the preview promised (an explicit wizard map
  // without a saved row was lost; an edited saved mapping silently
  // diverged from the preview). Additive column only.
  "0062_import_jobs_mapping",
  // PHASE-040 (OA-05, the T-10/T-11 spec catch): 0063_tenant_kind_reader —
  // the erp.tenant_kind SECURITY DEFINER probe (one column, no joins):
  // the consolidation group service reads the MEMBER tenant's kind from
  // the PARENT's tenant scope (the definer-reader precedent — the tenants
  // RLS policy correctly hides cross-tenant rows otherwise).
  "0063_tenant_kind_reader",
  // PHASE-041 (Blueprint v3.0 · CR-11): 0064_communications_hub — the four
  // RLS'd tables: message_templates (FD-30 tenant template substrate),
  // outbound_messages (the send ledger — status/provider ref/cost/retry
  // policy; every send is a row), notification_preferences (TB-23 user ×
  // module × channel matrix + tenant-default seeds), communication_log
  // (UX-14/IN-16 unified interaction log + call logging). +5 permissions
  // (267 → 272, matrix §3.19) +6 feature keys (templates/outbound all
  // plans; whatsapp/sms/email_providers/calendar_integration business+
  // enterprise). Numbering note: the phase doc planned 0059 — written
  // before CR-50's 0055–0059 and PHASE-040's 0060–0063; 0064 is the
  // honest next slot.
  "0064_communications_hub",
  // PHASE-042 (Blueprint v3.0 · CR-12, extended by v3.1/CR-45 L2-12):
  // 0065_routing_work_centers — the manufacturing execution substrate: six
  // RLS'd tables (work_centers, routings, routing_operations,
  // production_order_operations, rework_orders, downtime_records) + the
  // production_orders extension (routing_id/current_operation, additive)
  // + the two security_invoker OEE views + CoA markers 5125/5430.
  // 0066_standard_costing — the L2-12 layer: item_standard_costs (versioned
  // frozen standards, one ACTIVE per item — the BOM discipline) + the
  // std_unit_cost/yield_variance order columns + CoA markers 5990/5995 +
  // the standard_costs permission. +7 permissions total (272 → 279, matrix
  // §3.20 — the doc's planned "manufacturing.costing" is already live as
  // manufacturing.costing.read since 0026) +6 feature keys (business+
  // enterprise, the 0026 precedent) + the food_manufacturing manifest
  // enablement. Numbering note: the phase doc planned ≈0060…0066 — written
  // before 039/040/041; 0065/0066 are the honest next slots (the 0064 D-1
  // precedent).
  "0065_routing_work_centers",
  "0066_standard_costing",
  // PHASE-044 (Blueprint v3.0 · CR-14, scope extended by v3.1/CR-46 —
  // L1-20 returnable packaging): 0067_wms_locations — the WMS location
  // substrate: warehouse_zones/aisles/racks/bins (the location tree with
  // barcodes + pick sequence + one DEFAULT bin per warehouse), lpns,
  // bin_contents (the per-bin position — INV-029's subject; consignment
  // owner rows excluded from item_stock), the stock_moves bin/LPN
  // references, and returnable_packaging(+movements) with the 4895
  // DEPOSIT_FORFEITURE marker (the deposit liability reuses the EXISTING
  // DEPOSITS_RECEIVED purpose — D-2). 0068_wms_directed_ops — putaway_rules
  // + pick_strategies + pick_waves + pick_tasks (the unified PICK/PUTAWAY
  // task board — the single sync surface, D-3). 0069_wms_counts_tracking —
  // cycle_count_schedules/documents/lines (the G-13/G-14 reuse with
  // CYCLE_COUNT reasons), abc_classifications, serial_movements (the
  // append-only per-serial ledger). 0070_wms_policies_jobs —
  // transfer_pricing_policies (G-46), transit_exceptions (I-22),
  // inventory_alert_jobs (the shelf-life/slow-movement registration),
  // warehouse_kit_orders(+lines) (G-45), CoA markers 1290/2135/4990.
  // 0071_wms_seeds — DATA-ONLY: the EIGHT permission keys (matrix §3.21;
  // 279 → 287), role grants, the eight feature plan grants (business+
  // enterprise), the distribution/wholesale manifest enablement (the
  // jsonb append — contracts + docs mirrors move together), and the
  // default location tree + FIFO strategy per existing warehouse (BR-073's
  // backfill anchor). Numbering note: the phase doc planned ≈0073…0081 —
  // written before implementation; PHASE-043 has NOT run (it requires THIS
  // phase), so 0067…0071 are the honest next slots (the 0064/0065 D-1
  // precedent).
  "0067_wms_locations",
  "0068_wms_directed_ops",
  "0069_wms_counts_tracking",
  "0070_wms_policies_jobs",
  "0071_wms_seeds",
  // 0072_wms_wave_cancel_evidence — the 0068 evidence CHECK repair: a
  // wave cancelled BEFORE release carries no release stamps (the 0068
  // law made DRAFT→CANCELLED impossible — caught by the T-05 wave
  // lifecycle spec). Constraint replaced in place; zero data change.
  "0072_wms_wave_cancel_evidence",
  // 0073_stock_moves_wms_sources — the T-07…T-10 document-source
  // extension of the closed source list (cycle_count,
  // quarantine_disposition, consignment_settlement, warehouse_kit,
  // cross_dock — the 0027 replacement pattern, additive-only).
  "0073_stock_moves_wms_sources",
  // PHASE-043 (CR-13) — the MRP & Planning cluster (the doc's "≈ 0067…0072"
  // was written before PHASE-044 took 0067…0073; 0074…0078 are the honest
  // slots — the 0065 numbering-note precedent):
  // 0074_item_planning_policies — the items planning-policy fields (lead
  // time, safety-stock manual/AUTO, lot sizing, time fences — the
  // ck_items_planning_shape operand discipline) + the lot_sizing_rules
  // global catalog (the permissions pattern) + mps_entries (M-05, the
  // frozen-fence reason riding the row — BR-078);
  // 0075_bom_planning — the BOM planning extension: bom_lines.phantom_flag
  // (M-08), bom_substitutions (M-09), bom_outputs + the header's
  // main_allocation_pct (M-11 — activation requires main + Σ outputs = 100,
  // G-47), bill_of_resources (M-25 — the critical-resource overlay for
  // rough-cut checks, NOT finite scheduling);
  // 0076_mrp_engine — the run family (mrp_runs + mrp_demand_lines +
  // mrp_supply_lines + mrp_suggestions with the per-suggestion netting
  // drill-down and the one-to-one converted-document link — INV-030/BR-079)
  // + the document links (production_orders.sales_order_line_id the MTO
  // link M-22 + mrp_suggestion_id, purchase_orders.mrp_suggestion_id,
  // sales_order_lines promised_date/atp stamps) + stock_reservations
  // holder gains PRODUCTION_ORDER (the 0025/0028 widening pattern);
  // 0077_contract_manufacturing — the tolling pair (contract_mfg_orders +
  // contract_mfg_moves — the stock-at-processor ledger, G-48) + the
  // stock_moves source gains 'contract_mfg' + the CoA markers
  // 1420/2136/5126 (the 0026 additive pattern);
  // 0078_mrp_seeds — the DATA-ONLY seed (the 0071 pattern): the FOUR
  // permission keys (287 → 291, matrix §3.20), the THREE feature plan
  // grants (business + enterprise — the tier-4 precedent), the lot-sizing
  // rule definitions, the food_manufacturing manifest enablement;
  // 0079_transfer_mrp_link — stock_transfers.mrp_suggestion_id: the
  // TRANSFER leg of the bidirectional conversion link (acceptance
  // criterion 3 — the 0076 pair completed for all three document types).
  // PHASE-045 (CR-15) — the HR Core substrate (the honest next slots:
  // the phase plan's ≈0082…0088 predates the journal's actual 0079 end
  // — the numbering note):
  // 0080_hr_shifts — shifts + shift_rotations (the employee × date
  // roster grid);
  // 0081_hr_attendance — attendance_records (punch sessions, the
  // derived daily status, the import-dedupe floor);
  // 0082_hr_overtime — overtime_rules + overtime_entries (the
  // pre-approval lifecycle, BR-084's exception surfacing);
  // 0083_hr_leave — leave_types + leave_balances + leave_requests
  // (INV-031's per-year balance cells + the simple-approval chain);
  // 0084_hr_holidays — holiday_calendars + holidays (per-jurisdiction);
  // 0085_hr_identity_bridge — employees.user_id + the partial-UNIQUE
  // guard (HR-13, the SoD-scoped link);
  // 0086_hr_seeds — the DATA-ONLY seed (the six hr.* permission keys +
  // the plan grants; the workforce-manifest enablement is DEFERRED to the
  // phase's T-15 web step — one coherent change with the canonical
  // manifests + the hash pins; the leave-types default is per-tenant
  // first-use, not a global row — the kickoff decisions).
  "0074_item_planning_policies",
  "0075_bom_planning",
  "0076_mrp_engine",
  "0077_contract_manufacturing",
  "0078_mrp_seeds",
  "0079_transfer_mrp_link",
  "0080_hr_shifts",
  "0081_hr_attendance",
  "0082_hr_overtime",
  "0083_hr_leave",
  "0084_hr_holidays",
  "0085_hr_identity_bridge",
  "0086_hr_seeds",
];

/**
 * Module-system independent resolution (tsc CJS __dirname vs vitest ESM):
 * prefer the package-local `migrations/` of the invoking workspace, then the
 * monorepo-root-relative path for callers at other cwds.
 */
function resolveMigrationsDir(): string {
  const candidates = [
    join(process.cwd(), "migrations"),
    join(process.cwd(), "apps", "api", "migrations"),
  ];
  for (const candidate of candidates) {
    if (existsSync(join(candidate, "meta", "_journal.json"))) {
      return candidate;
    }
  }
  return candidates[0]!;
}

export const MIGRATIONS_DIR: string = resolveMigrationsDir();

export interface MigrationFile {
  tag: string;
  content: string;
}

/** Reads and returns every migration SQL file in manifest order. */
export function readMigrationFiles(): MigrationFile[] {
  const files = readdirSync(MIGRATIONS_DIR)
    .filter((name) => /^\d{4}_.+\.sql$/.test(name))
    .sort();
  const tags = files.map((name) => name.replace(/\.sql$/, ""));
  if (tags.join(",") !== MIGRATIONS.join(",")) {
    throw new Error(
      `Migration drift: manifest [${MIGRATIONS.join(", ")}] vs files [${tags.join(", ")}]`,
    );
  }
  return files.map((name, index) => ({
    tag: tags[index]!,
    content: readFileSync(join(MIGRATIONS_DIR, name), "utf8"),
  }));
}
