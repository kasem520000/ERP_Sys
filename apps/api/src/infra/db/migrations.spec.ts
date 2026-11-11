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
    // tables; the projection consumers: login + the interceptor).
    expect(files.at(-1)?.tag).toBe("0061_sandbox_enforcement");
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
