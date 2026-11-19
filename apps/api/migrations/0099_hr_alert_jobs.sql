-- PHASE-047 (Blueprint v3.0 · CR-17) · migration 0099 · HR Growth —
-- the hr-expiry-sweep's config surface + the notifications category
-- widening (T-09, D-06 — delivered with W-3).
--
--   hr_alert_jobs — the sweep's per-tenant registration, the 044
--     inventory pattern EXACTLY (D-06: "fail-closed documented
--     defaults when a tenant registers no config row (the 044
--     pattern); run stats stamped; audited"): one row per tenant per
--     job kind; NO row = the sweep still runs on the documented
--     default thresholds 30/7/0 (amendment A-2 + red line 5 — the
--     thresholds are tenant-configurable DATA with documented
--     fail-closed defaults, never hard-coded law); an EXPLICIT
--     is_active = false row is the tenant's off switch (absent ≠
--     inactive — the inventory law); last_run_at/last_flagged are the
--     stamped run stats (the stampAlertRun precedent).
--
--     THE SLOT NOTE (the honest record): the plan §2's migration
--     inventory table listed 0095–0098 — the talent TABLES. D-06's
--     own text ("the 044 pattern" config row + "run stats stamped")
--     requires this config surface, which the §2 table did not
--     itemize; the journal's next honest slot is 0099 (D-03's
--     slots-pinned-honestly law — the dated note rides the plan's §2
--     and the W-3 gate doc, never a silent rewrite).
--
--     The thresholds column: a jsonb ARRAY of non-negative integer
--     day-values (the documented default [30,7,0] — the CHECK pins
--     the array shape; the integer/dedup/sort validation is the pure
--     normalizeSweepWindows's, unit-tested FIRST). One list governs
--     all four probes (documents, certifications, probation end,
--     review-due — the phase doc's "fired at 30/7/0 days before the
--     date").
--
--   The notifications category widening — 'hr' joins BOTH CHECK
--     domains (notifications.category + notification_prefs.category),
--     the 0023/0056 pattern: the four talent alerts (document-expiry,
--     certification-expiry, probation-end, review-due) ride the
--     inbox's own category vocabulary; the web inbox renders an
--     unknown category as its raw string (the label surface is W-5's
--     alert screens — no break).
--
-- Grants: the inventory pattern — SELECT/INSERT/UPDATE for erp_app
-- (the upsert surface; no DELETE — the config row is the register),
-- SELECT for erp_readonly/erp_definer.

--> statement-breakpoint
SET ROLE erp_migrate;

--> statement-breakpoint
-- ---------------------------------------------------------------------------
-- 1. hr_alert_jobs (the sweep's registration + run stats).
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "hr_alert_jobs" (
  "id" uuid NOT NULL,
  "tenant_id" uuid NOT NULL REFERENCES "tenants" ("id") ON DELETE RESTRICT,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "updated_at" timestamptz NOT NULL DEFAULT now(),
  "version" integer NOT NULL DEFAULT 1,
  "created_by" uuid,
  "updated_by" uuid,
  "job_kind" text NOT NULL,
  -- The tenant's configured threshold ladder (days before the date);
  -- the documented default is [30,7,0] (the service's constant is the
  -- SAME law — no row = the defaults fire).
  "thresholds" jsonb NOT NULL DEFAULT '[30,7,0]'::jsonb,
  "is_active" boolean NOT NULL DEFAULT true,
  "last_run_at" timestamptz,
  "last_flagged" integer NOT NULL DEFAULT 0,
  "note" text,
  CONSTRAINT "pk_hr_alert_jobs" PRIMARY KEY ("id"),
  CONSTRAINT "uq_hr_alert_jobs_id_tenant" UNIQUE ("id", "tenant_id"),
  CONSTRAINT "uq_hr_alert_jobs_tenant_kind" UNIQUE ("tenant_id", "job_kind"),
  CONSTRAINT "ck_hr_alert_jobs_kind" CHECK ("job_kind" IN ('EXPIRY_SWEEP')),
  -- The array shape floor: the integer/non-negative/dedup/sort law is
  -- the pure normalizeSweepWindows's (unit-tested FIRST); the CHECK
  -- pins that the column is an array at all (never a scalar/object).
  CONSTRAINT "ck_hr_alert_jobs_thresholds"
    CHECK (jsonb_typeof("thresholds") = 'array')
);

--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "ix_hr_alert_jobs_tenant_active"
  ON "hr_alert_jobs" ("tenant_id", "is_active");

--> statement-breakpoint
-- ---------------------------------------------------------------------------
-- 2. The notifications category widening — 'hr' (the 0023/0056 pattern).
--> statement-breakpoint
ALTER TABLE "notifications" DROP CONSTRAINT IF EXISTS ck_notifications_category_values;
--> statement-breakpoint
ALTER TABLE "notifications" ADD CONSTRAINT ck_notifications_category_values
  CHECK ("category" IN (
    'limits', 'subscription', 'reconciliation', 'invoice_overdue', 'stock', 'templates', 'crm',
    'einvoicing', 'notes', 'installments', 'budgeting', 'purchasing', 'collections', 'warranties',
    'hr'
  ));
--> statement-breakpoint
ALTER TABLE "notification_prefs" DROP CONSTRAINT IF EXISTS ck_notification_prefs_category_values;
--> statement-breakpoint
ALTER TABLE "notification_prefs" ADD CONSTRAINT ck_notification_prefs_category_values
  CHECK ("category" IN (
    'limits', 'subscription', 'reconciliation', 'invoice_overdue', 'stock', 'templates', 'crm',
    'einvoicing', 'notes', 'installments', 'budgeting', 'purchasing', 'collections', 'warranties',
    'hr'
  ));

--> statement-breakpoint
-- ---------------------------------------------------------------------------
-- 3. RLS — the house triple.
--> statement-breakpoint
ALTER TABLE "hr_alert_jobs" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "hr_alert_jobs" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
SELECT erp.apply_tenant_policy('"hr_alert_jobs"');
--> statement-breakpoint
DO $$
BEGIN
  EXECUTE format('DROP POLICY IF EXISTS purge_path_delete ON public.%I', 'hr_alert_jobs');
  EXECUTE format('DROP POLICY IF EXISTS purge_path_update ON public.%I', 'hr_alert_jobs');
  EXECUTE format(
    'CREATE POLICY purge_path_delete ON public.%I FOR DELETE TO erp_migrate '
      || 'USING (tenant_id = erp.current_tenant_id())', 'hr_alert_jobs');
  EXECUTE format(
    'CREATE POLICY purge_path_update ON public.%I FOR UPDATE TO erp_migrate '
      || 'USING (tenant_id = erp.current_tenant_id()) WITH CHECK (true)', 'hr_alert_jobs');
END $$;

--> statement-breakpoint
-- ---------------------------------------------------------------------------
-- 4. Grants — the inventory pattern (no DELETE).
--> statement-breakpoint
REVOKE ALL ON "hr_alert_jobs" FROM erp_app;
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE ON "hr_alert_jobs" TO erp_app;
--> statement-breakpoint
GRANT SELECT ON "hr_alert_jobs" TO erp_readonly;
--> statement-breakpoint
GRANT SELECT ON "hr_alert_jobs" TO erp_definer;

--> statement-breakpoint
RESET ROLE;

--> statement-breakpoint
-- Schema-state marker for /health/ready (mirrors the migration manifest).
INSERT INTO erp._schema_state (key, value) VALUES ('schema_version', 99)
ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, at = now();
