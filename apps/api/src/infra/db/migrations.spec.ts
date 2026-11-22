import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { MIGRATIONS, MIGRATIONS_DIR, readMigrationFiles } from "./migrations";

describe("migration manifest (MIGRATION_STRATEGY §1)", () => {
  it("manifest matches the SQL files on disk", () => {
    const files = readMigrationFiles();
    expect(files.map((file) => file.tag)).toEqual([...MIGRATIONS]);
    expect(files[0]?.tag).toBe("0001_core_infra");
    // PHASE-019 T48: 0028_crm_service_order_holder (the holder-type widening —
    // the deviation recorded in agent-ctx/T48-7-service-orders.md).
    // PHASE-020 W1: 0029_sync_foundation (tombstones + inbox_commands +
    // device_refresh_tokens + the devices/sales_invoices widenings).
    // PHASE-020 T5: 0030_sync_change_log_sequence_grant (the 0024 INSERT
    // grant's missing sequence half — agent-ctx/T-P20-2a-pull.md).
    // PHASE-020 T9: 0031_sync_draft_line_replace (the update_draft
    // aggregate-replacement DELETE grant — SYNC_PROTOCOL §6.2).
    // PHASE-021 DR-P21-01: 0032_device_enrollment_one_time (the one-time
    // enrollment proof — devices.device_key_hash relaxed to nullable).
    // PHASE-022 DR-P22-05a: 0033_mobile_feeds (devices.linked_partner_id —
    // the personal pull feeds' partner scope, the only schema object the
    // 022 feed activation needs).
    // PHASE-022 DR-P22-07a: 0034_device_push_tokens (the FCM skeleton's
    // device-token opt-in store — the dedicated service-mediated table; the
    // devices table has no natural JSON column for push tokens).
    // PHASE-023: 0035_external_integrations (e-invoicing submissions/certs/
    // suppression + commerce channels + payouts/refunds/settlements + the
    // parked-lines/pending-formats treasury registry — T1/T3/T5/T6/T8).
    // PHASE-024: 0036_security_hardening (MFA policy substrate — plan role
    // keys + the bootstrap session gate; the offboarding purge substrate —
    // legal_hold + tenant_offboarding + purged_tenants + the per-table
    // purge_path RLS policies + the audit-guard purge exception; the
    // audit-review indexes — T4/T8/T11).
    // PHASE-026: 0037_fixed_assets (the fixed_assets module per DR-002
    // option A — six tenant tables + append-only 🔒 depreciation_lines +
    // the six v2.0 CoA purposes + 13 permission seeds + the RC-10 kind).
    // PHASE-027: 0038_notes_installments (the notes & installments modules
    // per DR-003/ED-03 — notes/note_events 🔒/installment_plans/
    // installment_lines + the treasury_allocations.note_id settle/restore
    // substrate + the cash_movements 'note' source kind + the four v2.0
    // CoA purposes + the RC-11 'NOTES' kind + the notification categories).
    // PHASE-032: 0039_education_template (the education commercial shell
    // per ED-08 — configuration only: the industry_templates registry seed
    // for industry.education v1.0.0, no schema objects; shipped on the
    // PHASE-027 lineage while the pre-reset interim 028–031 states were
    // still lost — now RESTORED below as 0042–0046).
    // PHASE-033: 0040_agriculture_template (the agriculture commercial
    // shell per ED-09 — configuration only: the industry_templates registry
    // seed for industry.agriculture v1.0.0, no schema objects; the §J
    // inventory.valuation report-key reconciliation; every required key
    // already granted by 0008/0026/0027 — zero new plan grants; executes
    // on the same PHASE-027 lineage).
    // PHASE-034: 0041_consolidation (the consolidation module per ADR-0018 /
    // DR-006 option A — four tenant tables + the §9 run-status enum + the
    // platform-plane reader role + the SECURITY DEFINER reader function +
    // the CONSOLIDATION_ADJUSTMENT CoA template account + the 5 §3.15
    // permission seeds + the 5 feature-key plan grants; the FINAL roadmap
    // phase — stage 11, the Enterprise Depth gate).
    // ── RESTORED LINEAGE (phases 028–031 recovered from the pre-reset
    // ERP_PLATFORM_PHASE031.zip and merged post-034; migrations renumbered
    // 0039→0042, 0040→0043, 0041→0044, 0042→0045, 0043→0046 — content
    // byte-faithful, application order after the live 0039–0041 set). ──
    // PHASE-028: 0042_budgeting (the budgeting module per DR-004/ED-04 —
    // budgets + budget_lines with the BR-050 partial unique + the
    // notifications 'budgeting' category + the six feature-key plan grants;
    // NOT ledger documents — zero journal rules by construction).
    // PHASE-029: 0043_payroll (the payroll module per DR-005/ED-05 —
    // employees/salary_structures/salary_components/payroll_runs/run_lines 🔒/
    // employee_loans/loan_lines with the INV-025 row-level totals law + the
    // six CoA purposes (2170/2180/2190/5270/5280/5295) + the cash_movements
    // source widening (additive) + the notifications 'payroll' category +
    // the eight feature-key plan grants; §3.14 permissions pre-seeded in
    // 0004/0005).
    // PHASE-030: 0044_industry_wholesale_electronics (the first two Blueprint
    // v2.0 stage-10 industry templates per ED-06 — DATA-ONLY registry seeds:
    // industry.wholesale + industry.electronics at v1.0.0 with the report
    // pins reconciled to the live ar.aging / inventory.valuation keys; zero
    // new schema objects, permissions, or grants — INV-022).
    // PHASE-031: 0045_healthcare_claim_ref (the Healthcare Commercial Shell's
    // single schema change per ED-07 — the additive nullable claim_ref
    // varchar(64) + the partial (tenant_id, claim_ref) grouping index;
    // external reference semantics only, never a document number) +
    // 0046_industry_healthcare (the industry.healthcare v1.0.0 DATA-ONLY
    // registry seed with the partners.ar_aging → ar.aging pin reconciliation;
    // the six typed workflow-policy keys register in the code-owned
    // POLICY_REGISTRY — zero new schema objects, permissions, or grants).
    // DELIVERY COMPLETION (post-034 audit): 0047_industry_rental_logistics
    // (the thirteenth — final — industry template: the industry.rental_
    // logistics v1.0.0 DATA-ONLY registry seed, the 0008 phase-019 stub
    // converging to the full manifest; the report pins reconciled to the
    // live inventory.serial-tracking / distribution.route_visit_compliance /
    // services.contract_revenue_schedule / ar.aging keys; the capability set
    // ≡ the CAPABILITY_MATRIX §1 RNT column strict both directions; the seven
    // typed workflow-policy keys register in the code-owned POLICY_REGISTRY —
    // zero new schema objects, permissions, or grants).
    // PHASE-035 T-01: 0048_items_import_export_grant (the activation repair
    // for EVAL-F-5 / H-18: the built PHASE-006 import/export surface joins
    // business + enterprise — DATA-ONLY, the 0042/0043 grant-block precedent,
    // drift stays 245=245).
    // PHASE-036 (Blueprint v3.0 · CR-06): 0049_custom_fields (the
    // extensibility core per ADR-0019 — five RLS'd tenant tables: the
    // definitions registry + the typed value store + the picklist pair +
    // form layouts; the three §3.8 permission seeds move the drift count
    // 245 → 248; the platform.custom_fields plan grant rides the tail).
    // PHASE-037 (Blueprint v3.0 · CR-07): 0050_zatca_phase1 — the ZATCA
    // Phase-1 GENERATION substrate: the additive NULLABLE invoice chain
    // columns + the RLS'd zatca_devices registry (one permission seed,
    // drift 248 → 249; NOT ledger documents — zero journal rules).
    // PHASE-038 (Blueprint v3.0 · CR-08): 0051_rfq_quotes … 0054_capex_tenders
    // — the procurement sourcing & supplier-collaboration cluster (13 RLS'd
    // tables across the four-migration split: the RFQ/quotes/comparison
    // loop, blanket orders/releases + the additive contract_id, the
    // collaboration cluster (ratings/approved items/advances/discount
    // terms), and capex/tender intake). Seven permission seeds move the
    // drift count 249 → 256 (matrix §3.16); the five sourcing feature keys
    // grant to business + enterprise. NOT ledger documents — awards/
    // releases generate purchase orders whose own lifecycles post; G-33/
    // G-34 post through the purchasing advances service (0053 tables).
    // PHASE-039 (Blueprint v3.0 · CR-09; extended by v3.1/CR-46 and
    // v3.2/CR-50): 0055_rma_warranty … 0059_supplier_rma — the returns
    // & collections cluster (10 RLS'd tables: the customer RMA workflow
    // + lines + managed warranties, the dunning ladder + letters +
    // actions, the agency register + referrals, the additive partner
    // credit-risk columns, and the supplier-RMA mirror — R-03). Nine
    // permission seeds move the drift count 256 → 265 (matrix §3.17);
    // the four feature keys (sales.rma, sales.warranties, sales.dunning,
    // purchasing.rma) grant to business + enterprise. G-35…G-38 post
    // through the returns services; G-39 (agency commission) through
    // the dunning service.
    // PHASE-040 (Blueprint v3.0 · CR-10; extended by v3.1/CR-46 — the
    // L1-21 export-templates half): 0060_import_toolkit — the data-
    // onboarding substrate (import_mappings both directions + the
    // import-jobs kind widening + the tenants SANDBOX/demo markers).
    // The two configuration.* permission seeds move the drift count
    // 265 → 267 (matrix §3.18); the two feature keys grant per §8
    // (data_migration business+enterprise, demo_data all plans). Zero
    // new journal rules — the toolkit posts through existing engines.
    // PHASE-040 (OA-05): 0061 — the SANDBOX enforcement widening (zero
    // tables; the projection consumers: login + the interceptor), then
    // 0062 (BR-066) — the import_jobs mapping snapshot column (the T-10
    // spec catch: the worker re-validates against the preview's map).
    // PHASE-041 (CR-11): 0064_communications_hub — the four RLS'd tables
    // (message_templates, outbound_messages, notification_preferences,
    // communication_log) + the tenant-default preference seed (the
    // erp_definer BYPASSRLS one-shot window) + the five communication.*
    // permission keys (267 → 272, matrix §3.19) + the six feature plan
    // grants (templates/outbound all plans; the provider tiers
    // business+enterprise).
    //
    // PHASE-042 (CR-12, extended by v3.1/CR-45 L2-12): 0065_routing_work_
    // centers — the six manufacturing-execution tables (work_centers,
    // routings, routing_operations, production_order_operations,
    // rework_orders, downtime_records) + the production_orders extension
    // columns + the two security_invoker OEE views + CoA markers 5125/5430
    // + the SIX manufacturing keys (272 → 278, matrix §3.20);
    // 0066_standard_costing — item_standard_costs (L2-12) + the order
    // std_unit_cost/yield_variance columns + CoA markers 5990/5995 + the
    // standard_costs key (278 → 279) + the six feature plan grants + the
    // food_manufacturing manifest enablement.
    // PHASE-044 (0067…0071) — the WMS & Inventory Intelligence cluster:
    // 0067 the location substrate (zones/aisles/racks/bins + lpns +
    // bin_contents + stock_moves bin refs + returnable packaging ×2 + the
    // 4895 marker), 0068 the directed-ops family (putaway_rules +
    // pick_strategies/waves/tasks), 0069 counts/tracking (cycle counts ×3 +
    // abc_classifications + serial_movements), 0070 policies/jobs
    // (transfer pricing + transit exceptions + the alert jobs + kitting
    // ×2 + markers 1290/2135/4990), 0071 the DATA-ONLY seed (EIGHT keys —
    // 279 → 287, matrix §3.21; plan grants; the distribution/wholesale
    // manifest enablement; the default location tree per warehouse),
    // 0072 the pick-wave CANCEL evidence repair (the 0068 CHECK fix — a
    // wave cancelled before release carries no release stamps),
    // 0073 the stock_moves source-shape extension for the WMS document
    // family (cycle_count / quarantine_disposition /
    // consignment_settlement / warehouse_kit / cross_dock — T-07…T-10).
    //
    // PHASE-043 (CR-13 — MRP & Planning; the doc's "≈ 0067…0072" was
    // written before 044 took those slots): 0074_item_planning_policies
    // (the items planning fields + the lot_sizing_rules global catalog +
    // mps_entries), 0075_bom_planning (phantom_flag + bom_substitutions +
    // bom_outputs/main_allocation_pct + bill_of_resources),
    // 0076_mrp_engine (the run family + the MTO/conversion/ATP document
    // links + the PRODUCTION_ORDER reservation holder),
    // 0077_contract_manufacturing (the tolling pair + 'contract_mfg'
    // stock_moves source + the CoA markers 1420/2136/5126),
    // 0078_mrp_seeds (the DATA-ONLY seed: FOUR manufacturing keys —
    // 287 → 291, matrix §3.20; the three feature plan grants; the
    // lot-sizing definitions; the food_manufacturing enablement),
    // 0079_transfer_mrp_link (stock_transfers.mrp_suggestion_id — the
    // TRANSFER leg of the bidirectional conversion link, acceptance
    // criterion 3).
    //
    // PHASE-045 (CR-15 — HR Core; started 2026-11-14 in parallel with the
    // 043-completion review per the owner's directive; the plan's
    // "≈ 0082…0088" predates the journal's actual 0079 end — the honest
    // next slots): 0080_hr_shifts (shifts + the shift_rotations employee ×
    // date roster grid), 0081_hr_attendance (attendance_records — punch
    // sessions + the derived daily status + the import-dedupe floor),
    // 0082_hr_overtime (overtime_rules + overtime_entries — the
    // pre-approval lifecycle), 0083_hr_leave (leave_types +
    // leave_balances + leave_requests — INV-031's per-year cells + the
    // simple-approval chain), 0084_hr_holidays (the per-jurisdiction
    // calendars), 0085_hr_identity_bridge (employees.user_id + the
    // partial-UNIQUE guard — HR-13), 0086_hr_seeds (the DATA-ONLY seed:
    // the SIX hr.* permission keys, the plan grants; the leave-types
    // default is per-tenant first-use — the kickoff decision, no global
    // row exists to seed), 0087_hr_attendance_import (T-05, added
    // 2026-11-15: attendance_import_batches — the file-fingerprint import
    // log — + attendance_import_anomalies — the anomaly quarantine),
    // 0088_hr_workforce_enablement (T-15, added 2026-11-16: the
    // workforce-industry MANIFEST ENABLEMENT — the deferred kickoff
    // decision's coherent change: the four workforce templates'
    // required_feature_keys gain the hr block; canonical + stored +
    // docs mirrors + pins moved together, the 0066 §9 precedent).
    // PHASE-046 (CR-16 — HR Payroll Compliance, W-1 added 2026-11-16;
    // the plan's "≈ 0089…0093" narrowed to the honest 0089…0092 + 0093
    // reserved): 0089_payroll_statutory (statutory_contribution_profiles
    // + payroll_tax_brackets + the employees nationality/pit_exemptions
    // extension — D-01/D-02/D-03), 0090_payroll_eosb (eosb_rules +
    // eosb_calculations — D-04), 0091_payroll_run_statutory (the run/line
    // statutory breakdown extension columns — D-05, additive only),
    // 0092_payroll_statutory_seeds (the DATA-ONLY seed: the THREE
    // compliance permission keys 297 → 300, the two plan grants, and the
    // CANONICAL STATUTORY MATERIALIZATION for every existing tenant —
    // the owner's corrected GOSI schedule VERIFIED + the AE/EG/JO
    // REQUIRES_VERIFICATION placeholders, D-11).
    // PHASE-046 (the audit-reconciliation round, 2026-11-16): 0093_-
    // statutory_gosi_citation — the RESERVED SLOT consumed by its exact
    // purpose: the DATA-ONLY GOSI citation reclassification (CITATION = the
    // PwC "Saudi Arabia: Individual — Other taxes" source fetched 2026-11-16
    // 21:34 UTC by the owner's verifier, corroborating the corrected
    // schedule + the 45,000 ceiling; DECISION RECORD = the owner's dispatch,
    // no longer presented as the citation; the register's open items narrow
    // to exactly two — the SANED 15,000 ceiling + the EOSB official text;
    // 0089–0092 byte-stable).
    // PHASE-046 (the W-7 closure wave, 2026-11-17): 0094_rls_tenant_sweep_
    // repair — THE RLS LATENT NO-OP CLASS REPAIR (the owner's §1a.6 ruling):
    // the exhaustive FROM-"tenants" sweep inventory 0001…0093 + the
    // idempotent ON CONFLICT DO NOTHING re-materialization against the
    // canonical current shapes (0009's master-data basics + 0092's five
    // remaining families; GOSI stays 0093's repair) through the temporary
    // migration-plane policy gate (created + self-dropped in the one file —
    // the final policy set is exactly the pre-0094 set); 0071's FROM-
    // "warehouses" sibling EXCLUDED and flagged, never guessed;
    // 0089–0093 byte-stable.
    // PHASE-047 (W-1, the foundation wave, 2026-11-18): 0095–0098 — the
    // talent cluster per the plan §2 (0095 performance ×5 · 0096
    // recruitment ×3 · 0097 training/org/documents ×6 + the employees
    // position_id/probation_end extensions · 0098 DATA-ONLY grants: the 12
    // permission keys + plan grants + the four manifest enablements + the
    // competency 1–5 scale seed through the 0093-gated existing-tenant
    // sweep, the onboarding hook the new-tenant path).
    // PHASE-047 (W-3, 2026-11-19): 0099_hr_alert_jobs — the hr-expiry-
    // sweep's config surface (D-06's 044-pattern registration row + run
    // stats: thresholds jsonb with the documented default [30,7,0]) + the
    // notifications 'hr' category widening (both CHECK domains).
    // PHASE-048 (CR-18 — Projects & Contracting, the owner-approved plan
    // §2's honest slots; delivered 2026-11-20 at W-8, the foundation
    // wave): 0100 the WBS tree (project_wbs_tasks + the crm_time_entries
    // WBS dimension — D-03/D-02), 0101 the budgets cluster (budgets +
    // lines by cost type + resource allocations — D-04, the 028 grant
    // discipline), 0102 change_orders (BR-094's inert-until-approved
    // structural floor + G-58's exactly-once stamp — D-07), 0103 the
    // contracting core (subcontractor agreements + certificates, the ONE
    // retention ledger both sides, progress certificates with the invoice
    // stamp, service visits on the existing service orders, ias23_
    // capitalizations riding the budget lines) + THE DATA-ONLY grants
    // block (the fourteen projects.* permission keys — matrix §3.26,
    // 312 → 326; the three feature flags' plan grants; the three manifest
    // enablements — the 0098 pattern). Eleven tenant tables; the IAS-23
    // rate register is the settings-plane config registration (D-02's
    // "config row", the gosi_establishment_no no-default precedent — NOT
    // a table, the +11 catalog count stands).
    // PHASE-048 (W-11, dated 2026-11-20 — the owner's clause-4 DECLARED
    // additive wave): 0104 the contracting core's three stamp columns
    // (the register's contract CUSTOMER · the AP linkage's journal · the
    // advance amortization state — the 0100 additive-column precedent;
    // no new tables, the catalog stays 318).
    // PHASE-049 (CR-19, extended by v3.2/CR-50 — CMMS Asset Maintenance,
    // the W-16 foundation wave, 2026-11-21): 0105–0108 the honest slots
    // (the plan §2 — the phase doc's "0083…0086" are stale blueprint
    // slots, its own note defers to the journal): the plans/checklist/
    // work-orders substrate with BR-097's single-open partial unique, the
    // meters/readings/spares/tags cluster with the R-10 odometer partial
    // unique + the additive plans→meters FK, the transfers ladder with
    // the G-61 journal gate, and THE ALTER on assets (the four expiry
    // registers + cost_center_id + parent_asset_id) + the DATA-ONLY
    // grants (ten keys 326 → 336, matrix §3.27; the two flags with
    // starter at the DECLARED NEUTRAL ZERO; the four manifest
    // enablements; the three CoA markers 5310/2138/2137). Eight tenant
    // tables; the catalog 318 → 326.
    // PHASE-049 (W-17, the work-order engine + plans, 2026-11-21): 0109
    // the D-02-dated honest +9/+10 provision (0105's own recorded note —
    // nothing silent): maintenance_cost_lines (the three cost
    // collectors, the per-leg XOR shape law + the snapshot pricing
    // pairs) + maintenance_work_order_steps (the carried checklist with
    // the per-step results — BR-098's gate; NO DELETE ever, the gate's
    // integrity floor) + the stock_moves source widening
    // ('maintenance_work_order', the 0073 DROP+ADD pattern). The
    // catalog 326 → 328.
    // PHASE-049 (W-17, dated 2026-11-21 — THE HONEST CATCH): 0110 the
    // stock-moves source-shape REPAIR — 0109's DROP+ADD rebuilt the
    // domain from 0073's list and MISSED 'contract_mfg' (0077 §3's
    // tolling source); the G-48 tolling golden caught it in the load
    // envelope's first chunk-b-rest run (two RED arms, the log kept:
    // audit-evidence/phase049-w17/db-chunk-b-rest-first-red.log); 0109
    // is published (pushed at the step-2 checkpoint — the constants
    // law), so the repair is this additive slot with the COMPLETE
    // domain. No tables; the catalog stays 328.
    // PHASE-049 (W-19 — the tags + expiry-sweep wave, 2026-11-21): 0111
    // the sweep settings provision (the 0099 §2 pattern + the 0098 data
    // page): the notifications category widening — 'assets' joins BOTH
    // CHECK domains — + THE DATA PAGE seeding the ONE sweep threshold
    // key assets.expiry.manage (matrix §3.27, 336 → 337) over the first
    // 049 settings keys (assets.expiry_sweep_thresholds with the
    // documented fail-closed default [30,7,0]). No tables; the catalog
    // stays 328.
    // PHASE-049 (W-19, dated 2026-11-21 — THE UNION REPAIR, the wave's
    // own schema-arm catch, the 0110 precedent's exact shape): 0043 §12
    // widened BOTH category domains with 'payroll' and 0051's DROP+ADD
    // silently rebuilt both lists WITHOUT it (the G-48 class, latent —
    // no writer ever used the category); 0112 restores the complete
    // SEVENTEEN-member union (the schema spec's 32nd arm asserts BOTH
    // live constraints equal the all-migrations union — a future
    // partial DROP+ADD goes RED naming the missing member). No tables;
    // the catalog stays 328.
    expect(files.at(-1)?.tag).toBe("0112_cmms_notifications_category_repair");
  });

  it("journal entries mirror the manifest order (drizzle-kit manifest)", () => {
    const journal = JSON.parse(
      readFileSync(join(MIGRATIONS_DIR, "meta", "_journal.json"), "utf8"),
    ) as { entries: { tag: string; idx: number }[] };
    expect(journal.entries.map((entry) => entry.tag)).toEqual([...MIGRATIONS]);
  });

  it("every migration upserts its own schema-state number (readiness mirror)", () => {
    readMigrationFiles().forEach((file, index) => {
      const number = String(index + 1);
      expect(file.content, `${file.tag} must upsert ('schema_version', ${number})`).toMatch(
        new RegExp(
          `INSERT INTO erp\\._schema_state \\(key, value\\) VALUES \\('schema_version', ${number}\\)`,
        ),
      );
    });
  });

  it("fail-closed drift signal: an unexpected file breaks readMigrationFiles", () => {
    const baseline = readMigrationFiles().length;
    expect(baseline).toBe(MIGRATIONS.length);
  });
});
