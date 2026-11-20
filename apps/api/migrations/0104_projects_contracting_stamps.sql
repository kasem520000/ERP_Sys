-- PHASE-048 (Blueprint v3.0 · CR-18) · migration 0104 · Projects &
-- Contracting (part 5: the W-11 contracting-core stamp columns — the
-- 0100 crm_time_entries additive-column precedent; 0100–0103 stay
-- byte-stable).
--
-- THE OWNER'S W-11 CLAUSE 4 DECLARATION (2026-11-20 dispatch): the
-- wave's default is journal 0103 + zero migrations «unless the wave
-- declares otherwise» — THIS is the declaration. Three additive
-- columns, no new tables (ENTITY_CATALOG stays 318 · check:rls stays
-- 318), each anticipated by 0103's own recorded note («The AP purchase
-- linkage … its stamp columns land additively with that wave … never
-- guessed here»):
--
--   retention_accounts.customer_id (T-11/D-09): the CUSTOMER row is
--     the customer contract's commercial spine (the 0103 side law) —
--     the contract's CUSTOMER lands here: the single source of truth
--     for the G-57 invoice's customer and the AR partner stamp
--     (INV-009). Nullable for the pre-W-11 rows; the ENGINE requires
--     it at the register's authoring and refuses billing when absent
--     (the fail-closed honest absence, never a guessed customer).
--   subcontractor_certificates.ap_journal_entry_id (T-10/D-08): the
--     AP linkage's own stamp — the journal that drove the
--     certificate's subcontractor purchase obligation into the
--     purchasing chain's AP leg (DR the mapped subcontract cost · CR
--     AP_CONTROL partner-stamped). Written in-transaction at approval
--     (single-consumption: the guarded UPDATE refuses a second stamp).
--   progress_certificates.advance_applied_amount (T-12/D-10): the
--     customer-advance amortization state (the G-33 mirror) — Σ what
--     later certificates' apply legs have absorbed from THIS advance.
--     NOT NULL DEFAULT 0 (the pre-W-11 rows are non-advance or
--     unapplied); the CHECK keeps it within the advance's own gross
--     and pins it to the ADVANCE kind (the honest shape: a non-advance
--     certificate carries exactly 0).

-- 1. retention_accounts.customer_id — the contract's customer.
--> statement-breakpoint
ALTER TABLE "retention_accounts" ADD COLUMN IF NOT EXISTS "customer_id" uuid;
--> statement-breakpoint
ALTER TABLE "retention_accounts"
  ADD CONSTRAINT fk_retention_accounts_customer
  FOREIGN KEY ("customer_id", "tenant_id")
  REFERENCES "partners" ("id", "tenant_id") ON DELETE RESTRICT;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS ix_retention_accounts_tenant_customer
  ON "retention_accounts" ("tenant_id", "customer_id")
  WHERE "customer_id" IS NOT NULL;

--> statement-breakpoint
-- 2. subcontractor_certificates.ap_journal_entry_id — the AP linkage
--    stamp (nullable until the approval writes it; the engine's
--    guarded UPDATE is the single-consumption floor).
ALTER TABLE "subcontractor_certificates" ADD COLUMN IF NOT EXISTS "ap_journal_entry_id" uuid;
--> statement-breakpoint
ALTER TABLE "subcontractor_certificates"
  ADD CONSTRAINT fk_subcontractor_certificates_ap_journal
  FOREIGN KEY ("ap_journal_entry_id", "tenant_id")
  REFERENCES "journal_entries" ("id", "tenant_id") ON DELETE RESTRICT;

--> statement-breakpoint
-- 3. progress_certificates.advance_applied_amount — the amortization
--    state (the G-33 customer-side mirror: 0053's applied_amount law).
ALTER TABLE "progress_certificates"
  ADD COLUMN IF NOT EXISTS "advance_applied_amount" numeric(19, 4) NOT NULL DEFAULT 0;
--> statement-breakpoint
ALTER TABLE "progress_certificates"
  ADD CONSTRAINT ck_progress_certificates_advance_applied
  CHECK (
    "advance_applied_amount" >= 0
    AND "advance_applied_amount" <= "gross_value"
    AND ("kind" = 'ADVANCE' OR "advance_applied_amount" = 0)
  );

--> statement-breakpoint
RESET ROLE;

--> statement-breakpoint
-- Schema-state marker for /health/ready (mirrors the migration manifest).
INSERT INTO erp._schema_state (key, value) VALUES ('schema_version', 104)
ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, at = now();
