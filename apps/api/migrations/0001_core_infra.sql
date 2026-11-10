-- PHASE-002 · migration 0001 · core infrastructure
--
-- Purpose: two-role security model (erp_migrate / erp_app / erp_readonly),
-- tenant-context GUC function (TENANT_ISOLATION §2), minimal `tenants` row
-- (PHASE-002 scope §2.5 — full profile arrives with PHASE-003), the
-- append-only `audit_events` trail with its guard trigger, the pg-boss
-- `boss` schema, and role-level statement/RLS defaults.
--
-- Runs as the migration bootstrap role: a fresh-stack superuser (compose
-- `postgres`, embedded/test containers) or `erp_migrate` on a provisioned
-- environment (ADR-0004 §4, TENANT_ISOLATION §1). Idempotent by construction
-- where PostgreSQL allows it (roles, schema, IF NOT EXISTS).
--
-- Passwords are deliberately NOT set here: dev/test stacks use trust auth
-- (docker-compose, embedded test PG); production assigns passwords out-of-band
-- (DEVELOPMENT_SETUP §Database; gitleaks guards the repo).

--> statement-breakpoint
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'erp_migrate') THEN
    CREATE ROLE erp_migrate LOGIN;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'erp_app') THEN
    CREATE ROLE erp_app LOGIN;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'erp_readonly') THEN
    CREATE ROLE erp_readonly LOGIN;
  END IF;
END
$$;

--> statement-breakpoint
-- RLS applies to the app role even if it ever becomes an owner, and statement
-- timeouts are defense-in-depth (DATABASE_CONVENTIONS §10.4: app 15s, report
-- role 120s). Superuser statements — executed before SET ROLE below.
ALTER ROLE erp_app SET row_security = on;
--> statement-breakpoint
ALTER ROLE erp_app SET statement_timeout = '15s';
--> statement-breakpoint
ALTER ROLE erp_readonly SET row_security = on;
--> statement-breakpoint
ALTER ROLE erp_readonly SET statement_timeout = '120s';

--> statement-breakpoint
-- erp_migrate owns objects (TENANT_ISOLATION §1). On a fresh stack the
-- bootstrap superuser grants it CREATE on the database and public schema;
-- on a provisioned environment these grants already exist (no-op re-grant).
-- The database is canonically named `erp` (compose/test stacks); a renamed
-- production database adjusts this grant in the ops bootstrap.
GRANT CREATE ON DATABASE erp TO erp_migrate;
--> statement-breakpoint
GRANT USAGE, CREATE ON SCHEMA public TO erp_migrate;
--> statement-breakpoint
-- pg-boss (as erp_app) owns and maintains its queue schema
-- (TENANT_ISOLATION §1: "Owned by app role"; ADR-0008): its bootstrap runs
-- CREATE SCHEMA IF NOT EXISTS boss, which requires CREATE on the database.
-- Scoped consequence: erp_app may create schemas but never alters existing
-- tenant tables — RLS/FORCE on them is untouched, and any new tenant_id
-- table without the policy fails the build (scripts/check-rls.ts).
-- Wrapped for provisioned environments where this migration runs as
-- erp_migrate without grant options: the ops bootstrap performs the grant.
DO $$
BEGIN
  GRANT CREATE ON DATABASE erp TO erp_app;
EXCEPTION WHEN insufficient_privilege THEN
  RAISE NOTICE 'bootstrap must grant CREATE on database to erp_app (DEVELOPMENT_SETUP §Database)';
END
$$;
--> statement-breakpoint
-- pg-boss queue schema owned by the app role (ADR-0008; queue tables carry no
-- tenant data → excluded from RLS, payload scoping enforced in handlers).
-- Created while still superuser: AUTHORIZATION to another role requires
-- membership in that role.
CREATE SCHEMA IF NOT EXISTS boss AUTHORIZATION erp_app;

--> statement-breakpoint
SET ROLE erp_migrate;

--> statement-breakpoint
CREATE SCHEMA IF NOT EXISTS erp AUTHORIZATION erp_migrate;
--> statement-breakpoint
GRANT USAGE ON SCHEMA erp TO erp_app, erp_readonly;

--> statement-breakpoint
CREATE OR REPLACE FUNCTION erp.current_tenant_id() RETURNS uuid
LANGUAGE sql STABLE AS
$$ SELECT nullif(current_setting('erp.tenant_id', true), '')::uuid $$;

--> statement-breakpoint
-- Platform-scope GUC path for admin-plane access to `tenants`
-- (TENANT_ISOLATION §3.2 — separate grant path from the tenant GUC).
CREATE OR REPLACE FUNCTION erp.platform_scope_active() RETURNS boolean
LANGUAGE sql STABLE AS
$$ SELECT COALESCE(current_setting('erp.platform_scope', true), '') IN ('on', 'true', '1') $$;

--> statement-breakpoint
-- In-database mirror of the migration manifest (MIGRATION_STRATEGY §1):
-- one row upserted by every migration; `erp.schema_version()` is what
-- /health/ready compares against the build's expected migration count.
CREATE TABLE IF NOT EXISTS erp._schema_state (
  key text NOT NULL,
  value bigint NOT NULL,
  at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT pk_erp_schema_state PRIMARY KEY (key),
  CONSTRAINT ck_erp_schema_state_key_nonempty CHECK (length(key) BETWEEN 1 AND 100)
);
--> statement-breakpoint
INSERT INTO erp._schema_state (key, value) VALUES ('schema_version', 1)
ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, at = now();
--> statement-breakpoint
CREATE OR REPLACE FUNCTION erp.schema_version() RETURNS bigint
LANGUAGE sql STABLE AS
$$ SELECT value FROM erp._schema_state WHERE key = 'schema_version' $$;
--> statement-breakpoint
GRANT SELECT ON erp._schema_state TO erp_app, erp_readonly;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION erp.schema_version() TO erp_app, erp_readonly;

--> statement-breakpoint
-- Minimal tenant row (PHASE-002 §2.5): id, bilingual name, status, standard
-- columns (DATABASE_CONVENTIONS §4–5). Statuses: text + CHECK policy §7 —
-- PHASE-003/004 extend the set via constraint swap, never in-place edits.
CREATE TABLE IF NOT EXISTS "tenants" (
  "id" uuid NOT NULL,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "updated_at" timestamptz NOT NULL DEFAULT now(),
  "version" integer NOT NULL DEFAULT 1,
  "name" text NOT NULL,
  "name_ar" text,
  "status" text NOT NULL DEFAULT 'ACTIVE',
  CONSTRAINT pk_tenants PRIMARY KEY ("id"),
  CONSTRAINT ck_tenants_name_length CHECK (length("name") BETWEEN 1 AND 200),
  CONSTRAINT ck_tenants_status_values CHECK ("status" IN ('PENDING', 'ACTIVE', 'SUSPENDED'))
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS ix_tenants_status ON "tenants" ("status");

--> statement-breakpoint
-- Append-only audit trail (INV-003 substrate; OBSERVABILITY §Audit vs telemetry).
-- `actor_id`/`device_id` gain FKs when users (PHASE-003) and devices
-- (PHASE-020) arrive — expand-phase pattern (MIGRATION_STRATEGY §3).
CREATE TABLE IF NOT EXISTS "audit_events" (
  "id" uuid NOT NULL,
  "tenant_id" uuid NOT NULL,
  "actor_id" uuid,
  "action" text NOT NULL,
  "entity_type" text NOT NULL,
  "entity_id" uuid NOT NULL,
  "before" jsonb,
  "after" jsonb,
  "correlation_id" uuid,
  "device_id" uuid,
  "at" timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT pk_audit_events PRIMARY KEY ("id"),
  CONSTRAINT fk_audit_events_tenant FOREIGN KEY ("tenant_id") REFERENCES "tenants" ("id") ON DELETE RESTRICT,
  CONSTRAINT ck_audit_events_action_length CHECK (length("action") BETWEEN 1 AND 100),
  CONSTRAINT ck_audit_events_entity_type_length CHECK (length("entity_type") BETWEEN 1 AND 100)
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS ix_audit_events_tenant_at ON "audit_events" ("tenant_id", "at");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS ix_audit_events_tenant_entity_at ON "audit_events" ("tenant_id", "entity_type", "entity_id", "at");

--> statement-breakpoint
-- Append-only guard (TENANT_ISOLATION §9, belt-and-braces with grants):
-- UPDATE/DELETE fail closed regardless of which role attempts them.
CREATE OR REPLACE FUNCTION erp.audit_events_guard() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'audit_events are append-only (INV-003 substrate): % prohibited', TG_OP;
END
$$ LANGUAGE plpgsql;
--> statement-breakpoint
DROP TRIGGER IF EXISTS trg_audit_events_guard ON "audit_events";
--> statement-breakpoint
CREATE TRIGGER trg_audit_events_guard
  BEFORE UPDATE OR DELETE ON "audit_events"
  FOR EACH ROW EXECUTE FUNCTION erp.audit_events_guard();

--> statement-breakpoint
-- RLS (TENANT_ISOLATION §2): ENABLE + FORCE so even the owner (post restore
-- drills) stays behind policies; both USING (reads) and WITH CHECK (writes).
ALTER TABLE "tenants" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "tenants" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
DROP POLICY IF EXISTS tenant_isolation ON "tenants";
--> statement-breakpoint
-- `tenants` is a platform table: visible via the tenant GUC for the row itself,
-- or via the separate platform-scope GUC for the admin plane (§3.2).
CREATE POLICY tenant_isolation ON "tenants" TO erp_app, erp_readonly
  USING ("id" = erp.current_tenant_id() OR erp.platform_scope_active())
  WITH CHECK ("id" = erp.current_tenant_id() OR erp.platform_scope_active());
--> statement-breakpoint
ALTER TABLE "audit_events" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "audit_events" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
DROP POLICY IF EXISTS tenant_isolation ON "audit_events";
--> statement-breakpoint
CREATE POLICY tenant_isolation ON "audit_events" TO erp_app, erp_readonly
  USING ("tenant_id" = erp.current_tenant_id())
  WITH CHECK ("tenant_id" = erp.current_tenant_id());

--> statement-breakpoint
-- Grants: the app role never receives UPDATE/DELETE on audit_events
-- (DATABASE_CONVENTIONS §9), and `tenants` rows are never deletable.
REVOKE ALL ON "tenants" FROM erp_app;
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE ON "tenants" TO erp_app;
--> statement-breakpoint
REVOKE ALL ON "audit_events" FROM erp_app;
--> statement-breakpoint
GRANT SELECT, INSERT ON "audit_events" TO erp_app;
--> statement-breakpoint
GRANT SELECT ON "tenants", "audit_events" TO erp_readonly;

--> statement-breakpoint
-- Composite tenant-scoped FK pattern (TENANT_ISOLATION §4): documented example
-- exercised by the PHASE-002 test suite via the `_infra_probe` fixture tables
-- (created/removed by tests, never by migrations).
-- Parent requires UNIQUE (id, tenant_id) so children can reference the pair.

--> statement-breakpoint
RESET ROLE;
