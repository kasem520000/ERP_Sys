-- PHASE-024 · migration 0036 · security hardening & compliance review
--
-- Purpose (PHASE-024 §4 Design Impact + MASTER-PLAN §1): minimal-by-intent
-- schema for the security phase — (a) the MFA policy substrate (T4:
-- plan-level `mfa_required_role_keys` + the enrollment-bootstrap session
-- gate `sessions.mfa_gate_passed`), (b) the tenant-offboarding purge
-- substrate (T11: `tenants.legal_hold`, the `tenant_offboarding` flow
-- state machine, the `purged_tenants` deletion-certificate registry that
-- SURVIVES the purge, audit-review index support for T8), and (c) the
-- explicit purge path (per-table `purge_path` policies for erp_migrate +
-- the guard-trigger UPDATE exception under `erp.purge_mode`).
--
-- Purge-path authorization (DATA_PROTECTION §4 step 6 verbatim: "runs
-- with erp_migrate-scoped tooling outside normal app traffic"): the purge
-- job connects on the dedicated migration-scope credential — NEVER on the
-- erp_app request pool. Belt-and-braces in depth:
--   1. erp_app keeps its exact current grants (no DELETE anywhere new, no
--      UPDATE on audit_events — A3/A5/A10 expectations unchanged);
--   2. every tenant table gains `purge_path TO erp_migrate` — RLS stays
--      ENABLE+FORCE for the owner, so even erp_migrate reaches ONLY the
--      rows of the GUC-named tenant (check-rls asserts the policy on
--      every registered table — the path is explicit and drift-checked);
--   3. the audit guard trigger permits UPDATE only under
--      `erp.purge_mode = 'on'` (DELETE stays denied for everyone); a
--      session that merely sets the GUC gains nothing without the
--      migration-scope connection (erp_app has no UPDATE grant).
--> statement-breakpoint
SET ROLE erp_migrate;

--> statement-breakpoint
-- ---------------------------------------------------------------------------
-- 1. MFA policy substrate (T4; ADR-0015 §4 "mandatory-able per role/plan").
--    Plan-level defaults stay '{}' (expand-contract: current opt-in
--    behavior everywhere until a plan/tenant turns a policy on).
--> statement-breakpoint
ALTER TABLE "plans"
  ADD COLUMN IF NOT EXISTS "mfa_required_role_keys" text[] NOT NULL DEFAULT '{}';
--> statement-breakpoint
-- The enrollment-bootstrap gate: TRUE on every normal session; FALSE only
-- on the 15-minute enrollment session issued by POST /identity/mfa/bootstrap
-- when policy mandates MFA and the user has no confirmed factor (the
-- deadlock-breaker — enrollment needs a session, the session must not
-- grant anything else).
ALTER TABLE "sessions"
  ADD COLUMN IF NOT EXISTS "mfa_gate_passed" boolean NOT NULL DEFAULT true;
--> statement-breakpoint
-- ---------------------------------------------------------------------------
-- 2. Offboarding purge substrate (T11; DATA_PROTECTION §4, Journey H).
--> statement-breakpoint
-- Journey H guardrail: the platform-level legal-hold flag blocks the purge
-- of a suspended-for-investigation tenant (purge requires security
-- sign-off — INCIDENT_RESPONSE). Written through the platform GUC path
-- (the tenants RLS policy already widens for platform scope).
ALTER TABLE "tenants"
  ADD COLUMN IF NOT EXISTS "legal_hold" boolean NOT NULL DEFAULT false;
--> statement-breakpoint
-- The offboarding flow state (tenant-owned DURING the flow — the row dies
-- with the tenant in the purge; the permanent record is purged_tenants).
-- Status ladder: REQUESTED (owner asked; read-only grace begins) →
-- EXPORTED (manifest written + verified) → EXECUTED (platform admin ran
-- the two-person execution; tenant SUSPENDED + retention window running) →
-- PURGED (sweep verified + certificate written) — CANCELLED is the
-- owner-during-grace reversal (H4 edge).
CREATE TABLE IF NOT EXISTS "tenant_offboarding" (
  "id" uuid NOT NULL,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "updated_at" timestamptz NOT NULL DEFAULT now(),
  "version" integer NOT NULL DEFAULT 1,
  "tenant_id" uuid NOT NULL REFERENCES "tenants" ("id") ON DELETE RESTRICT,
  "status" text NOT NULL DEFAULT 'REQUESTED',
  "requested_by" uuid NOT NULL,
  "requested_at" timestamptz NOT NULL DEFAULT now(),
  "grace_until" timestamptz,
  "export_file_id" uuid,
  "manifest_checksum" text,
  "exported_at" timestamptz,
  "executed_by" uuid,
  "executed_at" timestamptz,
  "retention_until" timestamptz,
  "purged_at" timestamptz,
  "cancelled_at" timestamptz,
  CONSTRAINT pk_tenant_offboarding PRIMARY KEY ("id"),
  CONSTRAINT ck_tenant_offboarding_status CHECK (
    "status" IN ('REQUESTED', 'EXPORTED', 'EXECUTED', 'PURGED', 'CANCELLED')
  ),
  CONSTRAINT fk_tenant_offboarding_requested_by
    FOREIGN KEY ("requested_by") REFERENCES "users" ("id")
);
--> statement-breakpoint
-- One LIVE flow per tenant (history rows stay after CANCELLED/PURGED until
-- the tenant's own purge removes them — a retried offboarding appends, it
-- never reuses a dead row).
CREATE UNIQUE INDEX IF NOT EXISTS uq_tenant_offboarding_live
  ON "tenant_offboarding" ("tenant_id")
  WHERE "status" <> 'CANCELLED';
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS ix_tenant_offboarding_retention
  ON "tenant_offboarding" ("status", "retention_until");
--> statement-breakpoint
-- The deletion certificate (Journey H5: "what/when/by-whom retained in
-- platform audit"): platform-owned, NO tenant_id — it must survive the
-- purge it certifies. hashed_tenant_id = HMAC-SHA256(tenant uuid) under
-- the platform salt (the post-purge correlation handle — audit rows for
-- the tenant are anonymized to tenant_id NULL, the certificate is the
-- only join key, per DATA_PROTECTION §4 step 8 "hashed in the post-purge
-- archive").
CREATE TABLE IF NOT EXISTS "purged_tenants" (
  "id" uuid NOT NULL,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "tenant_id_at_purge" uuid NOT NULL,
  "hashed_tenant_id" text NOT NULL,
  "tenant_name_snapshot" text NOT NULL,
  "manifest_checksum" text,
  "export_file_id" uuid,
  "performed_by" uuid NOT NULL,
  "purged_at" timestamptz NOT NULL DEFAULT now(),
  "table_row_counts" jsonb NOT NULL DEFAULT '{}',
  "storage_objects_deleted" integer NOT NULL DEFAULT 0,
  "audit_rows_anonymized" integer NOT NULL DEFAULT 0,
  "verification" jsonb NOT NULL DEFAULT '{}',
  CONSTRAINT pk_purged_tenants PRIMARY KEY ("id"),
  CONSTRAINT uq_purged_tenants_tenant UNIQUE ("tenant_id_at_purge"),
  CONSTRAINT uq_purged_tenants_hash UNIQUE ("hashed_tenant_id")
);
--> statement-breakpoint
-- ---------------------------------------------------------------------------
-- 3. Audit-review index support (T8): the tenant-admin review tooling
--    filters by actor and correlation id — the platform console cursor
--    pagination reuses (tenant_id, at).
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS ix_audit_events_tenant_actor_at
  ON "audit_events" ("tenant_id", "actor_id", "at" DESC);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS ix_audit_events_tenant_correlation
  ON "audit_events" ("tenant_id", "correlation_id");
--> statement-breakpoint
-- ---------------------------------------------------------------------------
-- 4. The explicit purge path (DATA_PROTECTION §4 step 6): per-table RLS
--    policies for the migration-scope connection. GENERATED over the
--    tenant-owned registry (every public table with a tenant_id column)
--    so new tables inherit the path with their own RLS — and check-rls
--    asserts both policies. Command-scoped on purpose:
--      · purge_path_delete — DELETE confined to the GUC-named tenant;
--      · purge_path_update — UPDATE confined to the GUC-named tenant with
--        WITH CHECK (true) so the audit anonymization may rewrite the row
--        (tenant_id → NULL is the whole point; every other purge step is
--        delete-only);
--      · NO INSERT policy — erp_migrate never inserts tenant rows (the
--        template_seed/plan_seed precedent paths stay NULL-tenant/plans
--        only), so a forged tenant-row insert stays denied (the isolation
--        suite proves exactly that).
--> statement-breakpoint
DO $$
DECLARE
  target record;
BEGIN
  FOR target IN
    SELECT c.relname AS table_name
    FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
    JOIN pg_attribute a ON a.attrelid = c.oid AND a.attname = 'tenant_id'
    WHERE n.nspname = 'public'
      AND c.relkind = 'r'
  LOOP
    EXECUTE format(
      'DROP POLICY IF EXISTS purge_path_delete ON public.%I', target.table_name);
    EXECUTE format(
      'DROP POLICY IF EXISTS purge_path_update ON public.%I', target.table_name);
    EXECUTE format(
      'CREATE POLICY purge_path_delete ON public.%I FOR DELETE TO erp_migrate '
        || 'USING (tenant_id = erp.current_tenant_id())',
      target.table_name);
    EXECUTE format(
      'CREATE POLICY purge_path_update ON public.%I FOR UPDATE TO erp_migrate '
        || 'USING (tenant_id = erp.current_tenant_id()) WITH CHECK (true)',
      target.table_name);
  END LOOP;
END $$;
--> statement-breakpoint
-- The `tenants` platform table carries no tenant_id column (id-keyed), so
-- the generator skips it — the purge's OFFBOARDED marking needs its own
-- id-scoped UPDATE policy for the migration-scope connection (same
-- discipline: exactly the GUC-named tenant, update-only, never insert).
DROP POLICY IF EXISTS purge_path_update ON "tenants";
--> statement-breakpoint
CREATE POLICY purge_path_update ON "tenants" FOR UPDATE TO erp_migrate
  USING (id = erp.current_tenant_id()) WITH CHECK (true);
--> statement-breakpoint
-- ---------------------------------------------------------------------------
-- 5. Audit anonymization guard exception (§4 step 8): the guard trigger
--    now distinguishes UPDATE (allowed ONLY under the purge-mode GUC —
--    reachable solely from the migration-scope connection, since erp_app
--    holds no UPDATE grant on audit_events) from DELETE (denied for
--    everyone, always). The anonymization itself is one UPDATE:
--    tenant_id → NULL, actor_id → NULL, device_id → NULL (PII severed,
--    action/entity kept for platform forensics).
CREATE OR REPLACE FUNCTION erp.audit_events_guard() RETURNS trigger AS $$
BEGIN
  IF TG_OP = 'UPDATE' AND current_setting('erp.purge_mode', true) = 'on' THEN
    RETURN NEW; -- the purge-path anonymization (migration-scope tooling only)
  END IF;
  RAISE EXCEPTION 'audit_events are append-only (INV-003 substrate): % prohibited', TG_OP;
END
$$ LANGUAGE plpgsql;
--> statement-breakpoint
-- ---------------------------------------------------------------------------
-- 6. RLS + grants (house macro on the tenant-owned flow table; the
--    certificate registry is platform-owned like plans — platform-scope
--    write, no tenant policy).
--> statement-breakpoint
ALTER TABLE "tenant_offboarding" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "tenant_offboarding" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
DROP POLICY IF EXISTS tenant_isolation ON "tenant_offboarding";
--> statement-breakpoint
CREATE POLICY tenant_isolation ON "tenant_offboarding" TO erp_app, erp_readonly
  USING (tenant_id = erp.current_tenant_id() OR erp.platform_scope_active())
  WITH CHECK (tenant_id = erp.current_tenant_id() OR erp.platform_scope_active());
--> statement-breakpoint
ALTER TABLE "purged_tenants" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "purged_tenants" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
DROP POLICY IF EXISTS tenant_isolation_select ON "purged_tenants";
--> statement-breakpoint
-- Platform-plane table (the plans pattern): the certificate registry is
-- console-readable for any authenticated tenant context and writable only
-- through the platform scope (the purge sweep itself writes on the
-- migration-scope connection via the seed-style policy below).
CREATE POLICY tenant_isolation_select ON "purged_tenants" FOR SELECT TO erp_app, erp_readonly
  USING (erp.current_tenant_id() IS NOT NULL OR erp.platform_scope_active());
--> statement-breakpoint
DROP POLICY IF EXISTS platform_admin_insert ON "purged_tenants";
--> statement-breakpoint
CREATE POLICY platform_admin_insert ON "purged_tenants" FOR INSERT TO erp_app
  WITH CHECK (erp.platform_scope_active());
--> statement-breakpoint
-- Migration-scope write path (the plan_seed pattern): the purge tooling
-- connection inserts the certificate row inside the purge transaction.
DROP POLICY IF EXISTS purge_cert_write ON "purged_tenants";
--> statement-breakpoint
CREATE POLICY purge_cert_write ON "purged_tenants" TO erp_migrate
  USING (true)
  WITH CHECK (true);
--> statement-breakpoint
REVOKE ALL ON "tenant_offboarding" FROM erp_app;
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE ON "tenant_offboarding" TO erp_app;
--> statement-breakpoint
GRANT SELECT ON "tenant_offboarding" TO erp_readonly;
--> statement-breakpoint
GRANT SELECT ON "tenant_offboarding" TO erp_definer;
--> statement-breakpoint
REVOKE ALL ON "purged_tenants" FROM erp_app;
--> statement-breakpoint
GRANT SELECT ON "purged_tenants" TO erp_app;
--> statement-breakpoint
GRANT SELECT ON "purged_tenants" TO erp_readonly;
--> statement-breakpoint
GRANT SELECT ON "purged_tenants" TO erp_definer;
--> statement-breakpoint
RESET ROLE;

--> statement-breakpoint
-- Schema-state marker for /health/ready (mirrors the migration manifest).
INSERT INTO erp._schema_state (key, value) VALUES ('schema_version', 36)
ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, at = now();
