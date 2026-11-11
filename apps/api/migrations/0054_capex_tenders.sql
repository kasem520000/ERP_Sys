-- PHASE-038 (Blueprint v3.0 · CR-08) · migration 0054 · Procurement
-- sourcing IV — CAPEX requests + public-tender intake (P-10/P-15 ·
-- P-14/DF-52/DF-53)
--
-- Purpose (PHASE-038 §4 Design Impact):
--
--   capex_requests — budget-checked capital purchase requests: workflow
--     DRAFT → PENDING_APPROVAL → APPROVED → CONVERTED (REJECTED/
--     CANCELLED off the way), SoD creator ≠ approver, and the PHASE-028
--     budget control guard at submit — ADVISORY by default,
--     ENFORCE_DRAFT per tenant policy (the 028 discipline verbatim: the
--     guard's evaluation snapshot persists on the row as evidence).
--   tender_intakes — public-tender INTAKE records with the government
--     supplier-registration fields (DF-52/53): the announcing authority,
--     the deadline, our bid decision, and the registration
--     no/expiry/classification. Intake records ONLY — no bidding-platform
--     claims (the honesty discipline; PHASE-038 §2.9).
--
-- INV-022 ledger: +2 tables (ENTITY_CATALOG 215 → 217 — the phase's +13
-- lands in full), +0 journals (a CAPEX request never posts — its CONVERT
-- path generates a purchase order whose own lifecycle posts; tenders are
-- records), +0 permissions (rides the 0051 sourcing keys —
-- purchasing.capex.read/manage/approve seeded there), +0 feature keys
-- (purchasing.capex_requests granted in 0051 §10).
--
-- Grants: both SELECT/INSERT/UPDATE — NO DELETE (workflow history).

--> statement-breakpoint
SET ROLE erp_migrate;

--> statement-breakpoint
-- ---------------------------------------------------------------------------
-- 1. capex_requests (T-01/T-07): budget-checked capital requests.
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "capex_requests" (
  "id" uuid NOT NULL,
  "tenant_id" uuid NOT NULL REFERENCES "tenants" ("id") ON DELETE RESTRICT,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "updated_at" timestamptz NOT NULL DEFAULT now(),
  "version" integer NOT NULL DEFAULT 1,
  "created_by" uuid,
  "branch_id" uuid NOT NULL,
  -- Official number reserved at APPROVAL (the PR discipline — drafts are
  -- scratch; the number is the approved document's identity).
  "request_no" text,
  "title" text NOT NULL,
  "title_ar" text,
  "description" text,
  -- The budget-relevant GL account (the guard's dimension key) + the
  -- optional cost-center/project splits.
  "account_id" uuid NOT NULL,
  "cost_center_id" uuid,
  "project_id" uuid,
  "estimated_amount" numeric(19,4) NOT NULL,
  "currency_code" varchar(3) NOT NULL,
  "needed_by" date,
  "status" text NOT NULL DEFAULT 'DRAFT',
  "submitted_at" timestamptz,
  "submitted_by" uuid,
  "approved_by" uuid,
  "approved_at" timestamptz,
  "rejection_reason" text,
  "cancel_reason" text,
  -- When approved capital converts to a purchase order, the linkage lands
  -- here (the composite FK keeps both sides tenant-agreeing).
  "converted_order_id" uuid,
  -- The PHASE-028 guard's evaluation snapshot at submit (mode + warnings
  -- — the evidence the audit surfaces).
  "budget_evaluation" jsonb,
  CONSTRAINT pk_capex_requests PRIMARY KEY ("id"),
  CONSTRAINT uq_capex_requests_id_tenant UNIQUE ("id", "tenant_id"),
  CONSTRAINT uq_capex_requests_tenant_no UNIQUE ("tenant_id", "request_no"),
  CONSTRAINT ck_capex_requests_title_length CHECK (length("title") BETWEEN 1 AND 200),
  CONSTRAINT ck_capex_requests_currency_shape CHECK ("currency_code" ~ '^[A-Z]{3}$'),
  CONSTRAINT ck_capex_requests_amount_positive CHECK ("estimated_amount" > 0),
  CONSTRAINT ck_capex_requests_status CHECK (
    "status" IN ('DRAFT', 'PENDING_APPROVAL', 'APPROVED', 'CONVERTED', 'REJECTED', 'CANCELLED')),
  CONSTRAINT ck_capex_requests_lifecycle_stamps CHECK (
    ("status" = 'DRAFT' AND "submitted_at" IS NULL AND "approved_at" IS NULL)
    OR ("status" = 'PENDING_APPROVAL' AND "submitted_at" IS NOT NULL AND "approved_at" IS NULL)
    OR ("status" = 'APPROVED' AND "submitted_at" IS NOT NULL AND "approved_at" IS NOT NULL
        AND "request_no" IS NOT NULL)
    OR ("status" IN ('CONVERTED', 'REJECTED', 'CANCELLED')))
);

--> statement-breakpoint
-- The OA-06 hot path: the capex worklist.
CREATE INDEX IF NOT EXISTS ix_capex_requests_tenant_status
  ON "capex_requests" ("tenant_id", "status", "created_at");

--> statement-breakpoint
CREATE INDEX IF NOT EXISTS ix_capex_requests_tenant_account
  ON "capex_requests" ("tenant_id", "account_id");

--> statement-breakpoint
COMMENT ON TABLE "capex_requests" IS
  'PHASE-038 T-01/T-07: the capital purchase request (P-10/P-15) — workflow with SoD creator ≠ approver and the PHASE-028 budget control guard at submit (ADVISORY default / ENFORCE_DRAFT per policy; the evaluation snapshot persists as budget_evaluation).';

--> statement-breakpoint
-- ---------------------------------------------------------------------------
-- 2. tender_intakes (T-01/T-09): public-tender intake records (intake
-- ONLY — no bidding-platform claims, the honesty discipline).
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "tender_intakes" (
  "id" uuid NOT NULL,
  "tenant_id" uuid NOT NULL REFERENCES "tenants" ("id") ON DELETE RESTRICT,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "updated_at" timestamptz NOT NULL DEFAULT now(),
  "version" integer NOT NULL DEFAULT 1,
  "created_by" uuid,
  "intake_no" text NOT NULL,
  "title" text NOT NULL,
  "title_ar" text,
  "announcing_authority" text NOT NULL,
  "tender_ref_no" text,
  "published_at" date,
  "submission_deadline" timestamptz,
  "estimated_value" numeric(19,4),
  "currency_code" varchar(3),
  -- Our decision on the opportunity (recorded; nothing auto-bids).
  "our_decision" text NOT NULL DEFAULT 'PENDING',
  "decided_at" timestamptz,
  "decision_note" text,
  -- DF-52/53: the government supplier-registration fields (stored
  -- verbatim, never guessed).
  "gov_registration_no" text,
  "gov_registration_expiry" date,
  "classification_code" text,
  "source_url" text,
  "status" text NOT NULL DEFAULT 'OPEN',
  "note" text,
  "note_ar" text,
  CONSTRAINT pk_tender_intakes PRIMARY KEY ("id"),
  CONSTRAINT uq_tender_intakes_id_tenant UNIQUE ("id", "tenant_id"),
  CONSTRAINT uq_tender_intakes_tenant_no UNIQUE ("tenant_id", "intake_no"),
  CONSTRAINT ck_tender_intakes_title_length CHECK (length("title") BETWEEN 1 AND 200),
  CONSTRAINT ck_tender_intakes_authority_length CHECK (length("announcing_authority") BETWEEN 1 AND 200),
  CONSTRAINT ck_tender_intakes_currency_shape CHECK ("currency_code" IS NULL OR "currency_code" ~ '^[A-Z]{3}$'),
  CONSTRAINT ck_tender_intakes_decision CHECK ("our_decision" IN ('PENDING', 'WILL_BID', 'DECLINED', 'WON', 'LOST')),
  CONSTRAINT ck_tender_intakes_status CHECK ("status" IN ('OPEN', 'CLOSED')),
  CONSTRAINT ck_tender_intakes_value CHECK ("estimated_value" IS NULL OR "estimated_value" >= 0)
);

--> statement-breakpoint
CREATE INDEX IF NOT EXISTS ix_tender_intakes_tenant_status
  ON "tender_intakes" ("tenant_id", "status", "submission_deadline");

--> statement-breakpoint
COMMENT ON TABLE "tender_intakes" IS
  'PHASE-038 T-01/T-09: public-tender intake records (P-14/DF-52/53) — authority, deadline, our decision, and the government supplier-registration fields; intake records ONLY (no bidding-platform claims — the honesty discipline).';

--> statement-breakpoint
-- ---------------------------------------------------------------------------
-- 3. Composite tenant FKs.
--> statement-breakpoint
ALTER TABLE "capex_requests"
  DROP CONSTRAINT IF EXISTS fk_capex_requests_branch;
ALTER TABLE "capex_requests"
  ADD CONSTRAINT fk_capex_requests_branch FOREIGN KEY ("branch_id", "tenant_id")
    REFERENCES "branches" ("id", "tenant_id") ON DELETE RESTRICT;

--> statement-breakpoint
ALTER TABLE "capex_requests"
  DROP CONSTRAINT IF EXISTS fk_capex_requests_account;
ALTER TABLE "capex_requests"
  ADD CONSTRAINT fk_capex_requests_account FOREIGN KEY ("account_id", "tenant_id")
    REFERENCES "accounts" ("id", "tenant_id") ON DELETE RESTRICT;

--> statement-breakpoint
ALTER TABLE "capex_requests"
  DROP CONSTRAINT IF EXISTS fk_capex_requests_cost_center;
ALTER TABLE "capex_requests"
  ADD CONSTRAINT fk_capex_requests_cost_center FOREIGN KEY ("cost_center_id", "tenant_id")
    REFERENCES "cost_centers" ("id", "tenant_id") ON DELETE RESTRICT;

--> statement-breakpoint
ALTER TABLE "capex_requests"
  DROP CONSTRAINT IF EXISTS fk_capex_requests_project;
ALTER TABLE "capex_requests"
  ADD CONSTRAINT fk_capex_requests_project FOREIGN KEY ("project_id", "tenant_id")
    REFERENCES "projects" ("id", "tenant_id") ON DELETE RESTRICT;

--> statement-breakpoint
ALTER TABLE "capex_requests"
  DROP CONSTRAINT IF EXISTS fk_capex_requests_converted_order;
ALTER TABLE "capex_requests"
  ADD CONSTRAINT fk_capex_requests_converted_order FOREIGN KEY ("converted_order_id", "tenant_id")
    REFERENCES "purchase_orders" ("id", "tenant_id") ON DELETE RESTRICT;

--> statement-breakpoint
-- ---------------------------------------------------------------------------
-- 4. RLS (TENANT_ISOLATION §2): the house macro.
--> statement-breakpoint
SELECT erp.apply_tenant_policy('"capex_requests"');
--> statement-breakpoint
SELECT erp.apply_tenant_policy('"tender_intakes"');

--> statement-breakpoint
-- ---------------------------------------------------------------------------
-- 4b. Purge path (the house discipline).
--> statement-breakpoint
DO $$
DECLARE
  t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['capex_requests', 'tender_intakes'] LOOP
    EXECUTE format('DROP POLICY IF EXISTS purge_path_delete ON public.%I', t);
    EXECUTE format('DROP POLICY IF EXISTS purge_path_update ON public.%I', t);
    EXECUTE format(
      'CREATE POLICY purge_path_delete ON public.%I FOR DELETE TO erp_migrate '
        || 'USING (tenant_id = erp.current_tenant_id())', t);
    EXECUTE format(
      'CREATE POLICY purge_path_update ON public.%I FOR UPDATE TO erp_migrate '
        || 'USING (tenant_id = erp.current_tenant_id()) WITH CHECK (true)', t);
  END LOOP;
END $$;

--> statement-breakpoint
-- ---------------------------------------------------------------------------
-- 5. Grants: both SELECT/INSERT/UPDATE — NO DELETE.
--> statement-breakpoint
REVOKE ALL ON "capex_requests", "tender_intakes" FROM erp_app;
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE ON "capex_requests", "tender_intakes" TO erp_app;
--> statement-breakpoint
GRANT SELECT ON "capex_requests", "tender_intakes" TO erp_readonly;
--> statement-breakpoint
GRANT SELECT ON "capex_requests", "tender_intakes" TO erp_definer;

--> statement-breakpoint
-- ---------------------------------------------------------------------------
-- 6. Permission/feature plan grants: NONE — CAPEX rides the 0051 keys
-- (purchasing.capex.read/manage/approve) and the purchasing.capex_requests
-- feature grant (0051 §10); tender intake rides
-- purchasing.rfqs.read/manage. Zero new keys here.
-- ---------------------------------------------------------------------------

--> statement-breakpoint
RESET ROLE;

--> statement-breakpoint
-- Schema-state marker for /health/ready (mirrors the migration manifest).
INSERT INTO erp._schema_state (key, value) VALUES ('schema_version', 54)
ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, at = now();
