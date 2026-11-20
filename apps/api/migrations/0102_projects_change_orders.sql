-- PHASE-048 (Blueprint v3.0 · CR-18) · migration 0102 · Projects &
-- Contracting (part 3: change orders, T-03 — PR-05/BR-094/G-58).
--
--   change_orders (D-07/T-09 — PR-05) — the contract's scope/price/
--     schedule deltas: INERT UNTIL APPROVED (BR-094's structural floor —
--     the CHECK pins effect_applied_at to the APPROVED state; the
--     approval gate precedes any budget, billing or contract-value
--     effect), the approval link (approved_by/at — the 045
--     simple-approval shape; the multi-step chains bind when 052's
--     workflow engine lands, the phase doc's own deferral), and G-58's
--     exactly-once stamp (effect_applied_at — the engine's INV-013
--     idempotency marker, W-11: the delta posts exactly once, the
--     ceiling recomputes to include approved change orders, BR-092/093).
--     price_delta is SIGNED (a credit-side change order is legal — no
--     fabricated positivity); schedule_delta_days likewise.
--
--     Evidence discipline: NO delete (the contract history is audited
--     evidence — REJECTED stays readable, the 028 budgets precedent);
--     RESTRICT against the project (the commercial record outlives
--     planning cleanup).
--
-- Ledger-free by design at W-8 (G-58's posting lands W-11 through the
-- engine; the canon row is W-15's).

--> statement-breakpoint
SET ROLE erp_migrate;

--> statement-breakpoint
-- ---------------------------------------------------------------------------
-- 1. change_orders (the gated deltas).
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "change_orders" (
  "id" uuid NOT NULL,
  "tenant_id" uuid NOT NULL REFERENCES "tenants" ("id") ON DELETE RESTRICT,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "updated_at" timestamptz NOT NULL DEFAULT now(),
  "version" integer NOT NULL DEFAULT 1,
  "created_by" uuid,
  "updated_by" uuid,
  "project_id" uuid NOT NULL,
  "co_no" text,
  "title" text NOT NULL,
  "title_ar" text,
  "scope_delta" text,
  "scope_delta_ar" text,
  "price_delta" numeric(19, 4) NOT NULL,
  "schedule_delta_days" integer,
  "status" text NOT NULL DEFAULT 'DRAFT',
  "submitted_at" timestamptz,
  "submitted_by" uuid,
  "approved_at" timestamptz,
  "approved_by" uuid,
  "rejected_at" timestamptz,
  "rejected_by" uuid,
  "rejection_reason" text,
  "effect_applied_at" timestamptz,
  "note" text,
  "note_ar" text,
  CONSTRAINT pk_change_orders PRIMARY KEY ("id"),
  CONSTRAINT uq_change_orders_id_tenant UNIQUE ("id", "tenant_id"),
  CONSTRAINT uq_change_orders_tenant_project_no
    UNIQUE ("tenant_id", "project_id", "co_no"),
  CONSTRAINT fk_change_orders_project
    FOREIGN KEY ("project_id", "tenant_id")
    REFERENCES "projects" ("id", "tenant_id") ON DELETE RESTRICT,
  CONSTRAINT ck_change_orders_status
    CHECK ("status" IN ('DRAFT', 'SUBMITTED', 'APPROVED', 'REJECTED')),
  CONSTRAINT ck_change_orders_schedule_delta
    CHECK ("schedule_delta_days" IS NULL OR "schedule_delta_days" <> 0),
  -- BR-094's structural floor, part 1: no effect before approval.
  CONSTRAINT ck_change_orders_effect_gated
    CHECK ("effect_applied_at" IS NULL OR "status" = 'APPROVED'),
  -- BR-094's structural floor, part 2: the approval link carries its
  -- stamps (the 045 simple-approval shape — exactly one terminal
  -- verdict, the rejection reason mandatory on REJECTED).
  CONSTRAINT ck_change_orders_approval_link
    CHECK (
      ("status" IN ('APPROVED') AND "approved_at" IS NOT NULL AND "approved_by" IS NOT NULL
         AND "rejected_at" IS NULL AND "rejected_by" IS NULL)
      OR ("status" = 'REJECTED' AND "rejected_at" IS NOT NULL AND "rejected_by" IS NOT NULL
           AND "rejection_reason" IS NOT NULL
           AND "approved_at" IS NULL AND "approved_by" IS NULL)
      OR ("status" IN ('DRAFT', 'SUBMITTED') AND "approved_at" IS NULL
           AND "approved_by" IS NULL AND "rejected_at" IS NULL AND "rejected_by" IS NULL)
    ),
  CONSTRAINT ck_change_orders_submission
    CHECK ("status" = 'DRAFT' OR "submitted_at" IS NOT NULL)
);

--> statement-breakpoint
CREATE INDEX IF NOT EXISTS ix_change_orders_tenant_project_status
  ON "change_orders" ("tenant_id", "project_id", "status");
--> statement-breakpoint
-- The ceiling recompute's read path (W-11: the approved price deltas).
CREATE INDEX IF NOT EXISTS ix_change_orders_tenant_effect
  ON "change_orders" ("tenant_id", "project_id")
  WHERE "status" = 'APPROVED';

--> statement-breakpoint
ALTER TABLE "change_orders" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "change_orders" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
SELECT erp.apply_tenant_policy('"change_orders"');
--> statement-breakpoint
DO $$
DECLARE
  t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['change_orders'] LOOP
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
-- 2. Grants — the evidence discipline (SELECT/INSERT/UPDATE, no DELETE:
--    the contract history is audited evidence).
--> statement-breakpoint
REVOKE ALL ON "change_orders" FROM erp_app;
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE ON "change_orders" TO erp_app;
--> statement-breakpoint
GRANT SELECT ON "change_orders" TO erp_readonly;
--> statement-breakpoint
GRANT SELECT ON "change_orders" TO erp_definer;

--> statement-breakpoint
RESET ROLE;

--> statement-breakpoint
-- Schema-state marker for /health/ready (mirrors the migration manifest).
INSERT INTO erp._schema_state (key, value) VALUES ('schema_version', 102)
ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, at = now();
