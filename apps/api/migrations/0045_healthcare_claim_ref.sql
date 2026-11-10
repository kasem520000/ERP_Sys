-- PHASE-031 · migration 0045 · healthcare claim reference (the single schema change)
--
-- Purpose (PHASE-031 §5 T1; EXPANSION_REGISTER §B stage 10, ED-07): the
-- Healthcare Commercial Shell's ONE additive column — `sales_invoices.claim_ref`,
-- varchar(64), NULL by default, no backfill, no default value. An external
-- insurer claim reference (مطالبة تأمينية), NEVER an official document
-- number (ADR-0006 — series immutability INV-021 is untouched; the claim is
-- "a reference stamped on invoices/notes/allocations, not a claim document
-- entity", CAPABILITY_MATRIX §2.9). Semantics (the manifest's bold boundary):
-- a claim_ref-carrying invoice is a CLAIM (insured) invoice billed to the
-- insurance-company partner; a NULL one is SELF-PAY (دفع مباشر) billed to
-- the patient partner. No partner classification enum is added — insurers
-- are ordinary customer-kind partners identified by use (the billed-to
-- partners of claim invoices; per-insurer statements group by partner).
--
-- Additive-only per MIGRATION_STRATEGY (expand-compatible; a shrink is never
-- required in production): existing tenants' rows stay NULL and every
-- existing behavior is unchanged until a template policy activates claim
-- capture (the v1.1 sales suites run unchanged over this column — the
-- fresh + regression proof). RLS untouched: the column inherits the
-- existing sales_invoices row policy (ADR-0005 — tenant-scoped strings
-- that never leak cross-tenant; the A-series attack rows re-run on it).
-- No new tables, no new enums, no purpose rows, no permission keys, no
-- plan grants (INV-022 — claim_ref is metadata that never enters a journal
-- line; the negative ledger proof asserts this).
--
-- The optional grouping index (tenant_id, claim_ref): the claim read
-- model's bounded `(partner, claim_ref)` open-item slices + the
-- group-by-claim report parameter ride it (p95 ≤ 500 ms at the PHASE-012
-- list budgets); partial (NULL keys never index — self-pay invoices stay
-- out of the claim index entirely).
--> statement-breakpoint
SET ROLE erp_migrate;

--> statement-breakpoint
-- The insurer claim reference: NULL = self-pay (the financial-file boundary).
ALTER TABLE "sales_invoices" ADD COLUMN "claim_ref" varchar(64);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "ix_sales_invoices_tenant_claim"
  ON "sales_invoices" ("tenant_id", "claim_ref")
  WHERE "claim_ref" IS NOT NULL;
--> statement-breakpoint
RESET ROLE;

--> statement-breakpoint
-- Schema-state marker for /health/ready (mirrors the migration manifest).
INSERT INTO erp._schema_state (key, value) VALUES ('schema_version', 45)
ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, at = now();
