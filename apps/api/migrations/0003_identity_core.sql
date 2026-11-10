-- PHASE-003 · migration 0003 · identity core
--
-- Purpose: the full identity cluster per TABLES/tenancy-identity.md —
-- users (global), permissions (global reference), roles (tenant rows +
-- system templates with tenant_id IS NULL), role_permissions, memberships
-- (tenant-owned, UNIQUE (user_id, tenant_id)), sessions (hashed rotating
-- tokens), devices (schema only — sync is PHASE-020), mfa_factors (encrypted
-- TOTP secret + hashed recovery codes), invitations (hashed one-time tokens).
-- `tenants` stays at its PHASE-002 minimal shape (profile = PHASE-004).
--
-- RLS shape (TENANT_ISOLATION §2 + ADR-0005):
-- - memberships, invitations: the standard macro policy
--   (`tenant_id = erp.current_tenant_id()`, USING + WITH CHECK).
-- - roles, role_permissions: variant policy — tenant rows scoped by the GUC,
--   system-template rows (tenant_id IS NULL) readable by every tenant for
--   cloning, writable ONLY by erp_migrate through the dedicated
--   `template_seed` policy (the app role can never forge or mutate a
--   template); a DELETE-specific guard keeps template rows undeletable.
-- - users, permissions, sessions, devices, mfa_factors: global/user-owned,
--   no tenant_id, no tenant RLS — access is service-mediated and
--   permission-checked (PHASE-003 §4 "Design Impact").
--
-- Expand-phase FK (documented in 0001 delivery notes): audit_events.actor_id
-- gains its users(id) foreign key now that `users` exists; device_id waits
-- for PHASE-020 rows.

--> statement-breakpoint
-- Dedicated function-owner role for the RLS definer projections (see the
-- "Pre-GUC identity resolution" section below): NOLOGIN + BYPASSRLS, the
-- standard PostgreSQL pattern for controlled RLS escape hatches. Created
-- here while still the bootstrap superuser (CREATE ROLE needs CREATEROLE).
-- Provisioned environments that run migrations as erp_migrate directly must
-- create the role in the ops bootstrap (same envelope as role passwords)
-- AND `GRANT erp_definer TO erp_migrate` so the SET ROLE below stays
-- permitted — the migration fails closed otherwise, never silently degrades.
DO $definer_role$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'erp_definer') THEN
    CREATE ROLE erp_definer NOLOGIN BYPASSRLS;
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_auth_members m
      JOIN pg_roles g ON g.oid = m.roleid
      JOIN pg_roles u ON u.oid = m.member
     WHERE g.rolname = 'erp_definer' AND u.rolname = 'erp_migrate'
  ) THEN
    GRANT erp_definer TO erp_migrate;
  END IF;
END
$definer_role$;

--> statement-breakpoint
SET ROLE erp_migrate;

--> statement-breakpoint
-- Global identity (TABLES §users): login identity + lockout counters. Never
-- hard-deleted (status DEACTIVATED preserves audit linkage) → no DELETE grant.
CREATE TABLE IF NOT EXISTS "users" (
  "id" uuid NOT NULL,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "updated_at" timestamptz NOT NULL DEFAULT now(),
  "version" integer NOT NULL DEFAULT 1,
  "email" text NOT NULL,
  "phone" text,
  "full_name" text NOT NULL,
  "password_hash" text NOT NULL,
  "status" text NOT NULL DEFAULT 'PENDING',
  "locale" text NOT NULL DEFAULT 'ar',
  "failed_login_count" integer NOT NULL DEFAULT 0,
  "locked_until" timestamptz,
  "last_login_at" timestamptz,
  CONSTRAINT pk_users PRIMARY KEY ("id"),
  CONSTRAINT ck_users_status_values CHECK ("status" IN ('PENDING', 'ACTIVE', 'LOCKED', 'DEACTIVATED')),
  CONSTRAINT ck_users_locale_values CHECK ("locale" IN ('ar', 'en')),
  CONSTRAINT ck_users_email_shape CHECK ("email" = lower("email") AND position('@' in "email") > 1),
  CONSTRAINT ck_users_failed_login_count CHECK ("failed_login_count" >= 0)
);
--> statement-breakpoint
-- Case-insensitive uniqueness (uq_users_email per TABLES §users): the app
-- always stores lower(email); the expression index is the belt to that brace.
CREATE UNIQUE INDEX IF NOT EXISTS uq_users_email ON "users" (lower("email"));
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS uq_users_phone ON "users" (lower("phone")) WHERE "phone" IS NOT NULL;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS ix_users_status ON "users" ("status");

--> statement-breakpoint
-- Atomic action catalog (TABLES §permissions): global reference table,
-- natural key PK, seeded verbatim from AUTHORIZATION_MATRIX.md §3
-- (migration 0004). Read-only to the app role.
-- PHASE-013 fix (T-TESTS): the shape originally allowed only 2–3 segments
-- without hyphens — the §3.8/§12 granular report keys
-- (`reports.financial.tb.read`, `reports.sales.by-item.read`, …) are 4
-- segments with hyphens, so migration 0004's seed VIOLATED this constraint
-- and every fresh `drizzle-kit migrate` chain died at 0004. Widened to
-- 2–4 dot-separated segments, hyphens allowed inside segments (the whole
-- seed corpus — 0004 + every later dotted token — validates against it).
CREATE TABLE IF NOT EXISTS "permissions" (
  "key" text NOT NULL,
  "module" text NOT NULL,
  "description" text NOT NULL,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT pk_permissions PRIMARY KEY ("key"),
  CONSTRAINT ck_permissions_key_shape CHECK ("key" ~ '^[a-z][a-z0-9_-]*(\.[a-z][a-z0-9_-]*){1,3}$')
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS ix_permissions_module ON "permissions" ("module");

--> statement-breakpoint
-- Roles (TABLES §roles): tenant rows + system templates (tenant_id IS NULL,
-- is_system = true). Template uniqueness is a partial index because plain
-- UNIQUE treats NULLs as distinct.
CREATE TABLE IF NOT EXISTS "roles" (
  "id" uuid NOT NULL,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "updated_at" timestamptz NOT NULL DEFAULT now(),
  "version" integer NOT NULL DEFAULT 1,
  "tenant_id" uuid REFERENCES "tenants" ("id") ON DELETE RESTRICT,
  "key" text NOT NULL,
  "name" text NOT NULL,
  "name_ar" text,
  "is_system" boolean NOT NULL DEFAULT false,
  CONSTRAINT pk_roles PRIMARY KEY ("id"),
  -- composite-FK anchor for memberships.role_id / invitations.role_id
  CONSTRAINT uq_roles_id_tenant UNIQUE ("id", "tenant_id"),
  CONSTRAINT ck_roles_key_shape CHECK ("key" ~ '^[a-z][a-z0-9_]*$'),
  CONSTRAINT ck_roles_template_shape CHECK (("is_system" AND "tenant_id" IS NULL) OR (NOT "is_system" AND "tenant_id" IS NOT NULL))
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS uq_roles_tenant_key ON "roles" ("tenant_id", "key") WHERE "tenant_id" IS NOT NULL;
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS uq_roles_system_key ON "roles" ("key") WHERE "tenant_id" IS NULL;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS ix_roles_tenant ON "roles" ("tenant_id");

--> statement-breakpoint
-- Grants (TABLES §role_permissions): association table — no id, the pair is
-- the PK; template grants carry tenant_id IS NULL via the template_seed path.
CREATE TABLE IF NOT EXISTS "role_permissions" (
  "role_id" uuid NOT NULL,
  "tenant_id" uuid REFERENCES "tenants" ("id") ON DELETE RESTRICT,
  "permission_id" text NOT NULL,
  "granted_at" timestamptz NOT NULL DEFAULT now(),
  "granted_by" uuid,
  CONSTRAINT pk_role_permissions PRIMARY KEY ("role_id", "permission_id"),
  CONSTRAINT fk_role_permissions_role FOREIGN KEY ("role_id", "tenant_id")
    REFERENCES "roles" ("id", "tenant_id") ON DELETE CASCADE,
  CONSTRAINT fk_role_permissions_permission FOREIGN KEY ("permission_id")
    REFERENCES "permissions" ("key") ON DELETE RESTRICT
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS ix_role_permissions_tenant ON "role_permissions" ("tenant_id");

--> statement-breakpoint
-- Memberships (TABLES §memberships): user ↔ tenant with role. Revocation is
-- an UPDATE to status REVOKED (audit linkage preserved) → no DELETE grant.
CREATE TABLE IF NOT EXISTS "memberships" (
  "id" uuid NOT NULL,
  "tenant_id" uuid NOT NULL REFERENCES "tenants" ("id") ON DELETE RESTRICT,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "updated_at" timestamptz NOT NULL DEFAULT now(),
  "version" integer NOT NULL DEFAULT 1,
  "created_by" uuid,
  "user_id" uuid NOT NULL REFERENCES "users" ("id") ON DELETE RESTRICT,
  "role_id" uuid NOT NULL,
  "branch_scope" uuid[],
  "status" text NOT NULL DEFAULT 'ACTIVE',
  CONSTRAINT pk_memberships PRIMARY KEY ("id"),
  CONSTRAINT uq_memberships_user_tenant UNIQUE ("user_id", "tenant_id"),
  CONSTRAINT fk_memberships_role FOREIGN KEY ("role_id", "tenant_id")
    REFERENCES "roles" ("id", "tenant_id") ON DELETE RESTRICT,
  CONSTRAINT ck_memberships_status_values CHECK ("status" IN ('ACTIVE', 'REVOKED')),
  CONSTRAINT ck_memberships_branch_scope CHECK ("branch_scope" IS NULL OR array_length("branch_scope", 1) >= 1)
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS ix_memberships_tenant_user ON "memberships" ("tenant_id", "user_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS ix_memberships_user ON "memberships" ("user_id");

--> statement-breakpoint
-- Registered offline-capable clients (TABLES §devices): schema only in
-- PHASE-003 — nothing reads it before PHASE-020 (phase §2 out-of-scope).
CREATE TABLE IF NOT EXISTS "devices" (
  "id" uuid NOT NULL,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "updated_at" timestamptz NOT NULL DEFAULT now(),
  "version" integer NOT NULL DEFAULT 1,
  "user_id" uuid NOT NULL REFERENCES "users" ("id") ON DELETE RESTRICT,
  "platform" text NOT NULL,
  "name" text,
  "device_key_hash" text NOT NULL,
  "last_seen_at" timestamptz,
  "revoked_at" timestamptz,
  CONSTRAINT pk_devices PRIMARY KEY ("id"),
  CONSTRAINT ck_devices_platform_values CHECK ("platform" IN ('DESKTOP', 'ANDROID'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS uq_devices_key_hash ON "devices" ("device_key_hash");

--> statement-breakpoint
-- Web sessions (TABLES §sessions, ADR-0015 §2): opaque server-side records —
-- the DB stores the hash only; absolute timeout derives from created_at + 12h
-- at validation time; idle timeout from last_seen_at + 30min. active_tenant_id
-- is a convenience cache — authorization always derives from memberships.
CREATE TABLE IF NOT EXISTS "sessions" (
  "id" uuid NOT NULL,
  "user_id" uuid NOT NULL REFERENCES "users" ("id") ON DELETE RESTRICT,
  "token_hash" text NOT NULL,
  "active_tenant_id" uuid REFERENCES "tenants" ("id") ON DELETE RESTRICT,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "expires_at" timestamptz NOT NULL,
  "revoked_at" timestamptz,
  "ip" inet,
  "device_id" uuid REFERENCES "devices" ("id") ON DELETE RESTRICT,
  "last_seen_at" timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT pk_sessions PRIMARY KEY ("id"),
  CONSTRAINT uq_sessions_token_hash UNIQUE ("token_hash"),
  CONSTRAINT ck_sessions_window CHECK ("expires_at" > "created_at")
);
--> statement-breakpoint
-- Reaping + per-user revocation lookups (ADR-0015; PHASE-003 §6 performance).
CREATE INDEX IF NOT EXISTS ix_sessions_user_expires ON "sessions" ("user_id", "expires_at");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS ix_sessions_active_tenant ON "sessions" ("active_tenant_id") WHERE "active_tenant_id" IS NOT NULL;

--> statement-breakpoint
-- TOTP enrollment (TABLES §mfa_factors, ADR-0015 §4): one CONFIRMED factor
-- per user (partial unique); secret stored encrypted per SECRETS_MANAGEMENT
-- envelope rules; recovery codes stored hashed only.
CREATE TABLE IF NOT EXISTS "mfa_factors" (
  "id" uuid NOT NULL,
  "user_id" uuid NOT NULL REFERENCES "users" ("id") ON DELETE RESTRICT,
  "kind" text NOT NULL DEFAULT 'TOTP',
  "secret_enc" text NOT NULL,
  "confirmed_at" timestamptz,
  "enrolled_at" timestamptz NOT NULL DEFAULT now(),
  "last_used_at" timestamptz,
  "recovery_codes_hash" text[],
  CONSTRAINT pk_mfa_factors PRIMARY KEY ("id"),
  CONSTRAINT ck_mfa_factors_kind_values CHECK ("kind" IN ('TOTP'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS uq_mfa_factors_user_confirmed
  ON "mfa_factors" ("user_id") WHERE "confirmed_at" IS NOT NULL;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS ix_mfa_factors_user ON "mfa_factors" ("user_id");

--> statement-breakpoint
-- Membership invitations (TABLES §invitations): hashed one-time tokens,
-- default 72h expiry; acceptance creates the membership (service flow).
CREATE TABLE IF NOT EXISTS "invitations" (
  "id" uuid NOT NULL,
  "tenant_id" uuid NOT NULL REFERENCES "tenants" ("id") ON DELETE RESTRICT,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "updated_at" timestamptz NOT NULL DEFAULT now(),
  "version" integer NOT NULL DEFAULT 1,
  "created_by" uuid,
  "email" text NOT NULL,
  "role_id" uuid NOT NULL,
  "token_hash" text NOT NULL,
  "expires_at" timestamptz NOT NULL,
  "accepted_at" timestamptz,
  "status" text NOT NULL DEFAULT 'PENDING',
  "invited_by" uuid NOT NULL,
  CONSTRAINT pk_invitations PRIMARY KEY ("id"),
  CONSTRAINT uq_invitations_token_hash UNIQUE ("token_hash"),
  CONSTRAINT fk_invitations_role FOREIGN KEY ("role_id", "tenant_id")
    REFERENCES "roles" ("id", "tenant_id") ON DELETE RESTRICT,
  CONSTRAINT ck_invitations_status_values CHECK ("status" IN ('PENDING', 'ACCEPTED', 'EXPIRED', 'REVOKED')),
  CONSTRAINT ck_invitations_email_shape CHECK ("email" = lower("email")),
  CONSTRAINT ck_invitations_window CHECK ("expires_at" > "created_at")
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS ix_invitations_tenant_status ON "invitations" ("tenant_id", "status");

--> statement-breakpoint
-- Expand-phase FK (documented in 0001 delivery notes): actor_id now points at
-- a real user row; device_id gains its FK when devices hold rows (PHASE-020).
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'fk_audit_events_actor'
  ) THEN
    ALTER TABLE "audit_events"
      ADD CONSTRAINT fk_audit_events_actor FOREIGN KEY ("actor_id")
        REFERENCES "users" ("id") ON DELETE RESTRICT;
  END IF;
END
$$;

--> statement-breakpoint
-- RLS: tenant-owned tables via the PHASE-002 macro (memberships, invitations).
SELECT erp.apply_tenant_policy('"memberships"');
--> statement-breakpoint
SELECT erp.apply_tenant_policy('"invitations"');

--> statement-breakpoint
-- RLS: roles — command-specific variant policies. PostgreSQL ORs an ALL
-- policy's USING into DELETE visibility (proven by the attack suite), so
-- the template-protection shape must be expressed per command:
-- - SELECT: own rows + the system templates (tenant_id IS NULL — the
--   cloning source every tenant reads).
-- - UPDATE: templates stay visible for uniform error shapes, but the strict
--   WITH CHECK makes every mutation of them fail closed.
-- - INSERT: own-tenant rows only (no template forging).
-- - DELETE: own-tenant rows only (templates are structurally invisible to
--   the command — 0 rows, never silently deletable by any tenant).
ALTER TABLE "roles" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "roles" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
DROP POLICY IF EXISTS tenant_isolation ON "roles";
--> statement-breakpoint
CREATE POLICY tenant_isolation ON "roles" FOR UPDATE TO erp_app, erp_readonly
  USING ("tenant_id" = erp.current_tenant_id() OR "tenant_id" IS NULL)
  WITH CHECK ("tenant_id" = erp.current_tenant_id());
--> statement-breakpoint
DROP POLICY IF EXISTS tenant_isolation_select ON "roles";
--> statement-breakpoint
CREATE POLICY tenant_isolation_select ON "roles" FOR SELECT TO erp_app, erp_readonly
  USING ("tenant_id" = erp.current_tenant_id() OR "tenant_id" IS NULL);
--> statement-breakpoint
DROP POLICY IF EXISTS tenant_isolation_insert ON "roles";
--> statement-breakpoint
CREATE POLICY tenant_isolation_insert ON "roles" FOR INSERT TO erp_app
  WITH CHECK ("tenant_id" = erp.current_tenant_id());
--> statement-breakpoint
DROP POLICY IF EXISTS tenant_isolation_delete ON "roles";
--> statement-breakpoint
CREATE POLICY tenant_isolation_delete ON "roles" FOR DELETE TO erp_app
  USING ("tenant_id" = erp.current_tenant_id());
--> statement-breakpoint
-- Migration-role seeding path: erp_migrate may only ever touch template rows
-- (tenant_id IS NULL) — tenant role data is exclusively app-plane business.
DROP POLICY IF EXISTS template_seed ON "roles";
--> statement-breakpoint
CREATE POLICY template_seed ON "roles" TO erp_migrate
  USING ("tenant_id" IS NULL)
  WITH CHECK ("tenant_id" IS NULL);

--> statement-breakpoint
-- RLS: role_permissions — same command-specific variant shape as roles
-- (template grants readable for cloning; writes confined to tenant rows).
ALTER TABLE "role_permissions" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "role_permissions" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
DROP POLICY IF EXISTS tenant_isolation ON "role_permissions";
--> statement-breakpoint
CREATE POLICY tenant_isolation ON "role_permissions" FOR UPDATE TO erp_app, erp_readonly
  USING ("tenant_id" = erp.current_tenant_id() OR "tenant_id" IS NULL)
  WITH CHECK ("tenant_id" = erp.current_tenant_id());
--> statement-breakpoint
DROP POLICY IF EXISTS tenant_isolation_select ON "role_permissions";
--> statement-breakpoint
CREATE POLICY tenant_isolation_select ON "role_permissions" FOR SELECT TO erp_app, erp_readonly
  USING ("tenant_id" = erp.current_tenant_id() OR "tenant_id" IS NULL);
--> statement-breakpoint
DROP POLICY IF EXISTS tenant_isolation_insert ON "role_permissions";
--> statement-breakpoint
CREATE POLICY tenant_isolation_insert ON "role_permissions" FOR INSERT TO erp_app
  WITH CHECK ("tenant_id" = erp.current_tenant_id());
--> statement-breakpoint
DROP POLICY IF EXISTS tenant_isolation_delete ON "role_permissions";
--> statement-breakpoint
CREATE POLICY tenant_isolation_delete ON "role_permissions" FOR DELETE TO erp_app
  USING ("tenant_id" = erp.current_tenant_id());
--> statement-breakpoint
DROP POLICY IF EXISTS template_seed ON "role_permissions";
--> statement-breakpoint
CREATE POLICY template_seed ON "role_permissions" TO erp_migrate
  USING ("tenant_id" IS NULL)
  WITH CHECK ("tenant_id" IS NULL);

--> statement-breakpoint
-- Pre-GUC identity resolution (PHASE-003 §2.10/§2.11, MULTI_TENANCY §2):
-- the tenant context derives from the authenticated session — but resolving
-- the session's membership options and effective permissions happens BEFORE
-- any tenant GUC can exist (chicken-and-egg under RLS). Three read-only
-- SECURITY DEFINER projections expose the minimal controlled surface: the
-- caller must already have proven the user identity (valid session token
-- hash) — they take a user_id or an exact token hash, never a forgeable
-- tenant_id. All writes and every other read stay behind RLS; audit events
-- still require a real tenant scope.
--
-- Ownership: FORCE RLS applies even to the table owner (PHASE-002 §2), so the
-- projections are owned by a dedicated NOLOGIN BYPASSRLS role — the standard
-- PostgreSQL pattern for controlled RLS escape hatches. The role exists
-- only as a function owner: no password, no login, no table grants beyond
-- the SELECTs below. FORCE RLS binds even the table owner (PHASE-002 §2),
-- so erp_migrate-owned functions would read zero rows — ownership MUST be
-- the bypass role. Grants happen at the bootstrap level (table owner lacks
-- nothing either way); fresh stacks create everything as superuser here.
RESET ROLE;
--> statement-breakpoint
GRANT USAGE ON SCHEMA public TO erp_definer;
--> statement-breakpoint
GRANT USAGE, CREATE ON SCHEMA erp TO erp_definer;
--> statement-breakpoint
GRANT SELECT ON "tenants", "roles", "role_permissions", "memberships", "invitations" TO erp_definer;
--> statement-breakpoint
SET ROLE erp_definer;

--> statement-breakpoint
CREATE OR REPLACE FUNCTION erp.user_membership_options(p_user_id uuid)
RETURNS TABLE (
  "tenantId" uuid, "tenantName" text, "tenantNameAr" text, "tenantStatus" text,
  "membershipId" uuid, "roleId" uuid, "roleKey" text, "roleName" text, "roleNameAr" text,
  "branchScope" uuid[], "membershipStatus" text
)
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public, erp
AS $$
  SELECT t.id AS "tenantId", t.name AS "tenantName", t.name_ar AS "tenantNameAr",
         t.status AS "tenantStatus", m.id AS "membershipId", r.id AS "roleId",
         r.key AS "roleKey", r.name AS "roleName", r.name_ar AS "roleNameAr",
         m.branch_scope AS "branchScope", m.status AS "membershipStatus"
  FROM memberships m
  JOIN tenants t ON t.id = m.tenant_id
  JOIN roles r ON r.id = m.role_id
  WHERE m.user_id = p_user_id
$$;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION erp.user_effective_permissions(p_user_id uuid, p_tenant_id uuid)
RETURNS TABLE (permission_key text)
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public, erp
AS $$
  SELECT rp.permission_id
  FROM memberships m
  JOIN role_permissions rp ON rp.role_id = m.role_id AND rp.tenant_id = m.tenant_id
  WHERE m.user_id = p_user_id
    AND m.tenant_id = p_tenant_id
    AND m.status = 'ACTIVE'
$$;
--> statement-breakpoint
REVOKE EXECUTE ON FUNCTION erp.user_membership_options(uuid) FROM PUBLIC;
--> statement-breakpoint
REVOKE EXECUTE ON FUNCTION erp.user_effective_permissions(uuid, uuid) FROM PUBLIC;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION erp.user_membership_options(uuid) TO erp_app;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION erp.user_effective_permissions(uuid, uuid) TO erp_app;

--> statement-breakpoint
-- Invitation lookup by exact token hash (pre-auth accept flow): the emailed
-- token IS the capability — a 256-bit random value, hashed at rest; exposing
-- only the exact-hash match keeps the lookup unenumerable and revocable
-- (status/expiry checked by the service, PHASE-003 §2.7).
CREATE OR REPLACE FUNCTION erp.invitation_by_token(p_token_hash text)
RETURNS TABLE (
  "invitationId" uuid, "tenantId" uuid, "tenantName" text, "tenantNameAr" text,
  "tenantStatus" text, "email" text, "roleId" uuid, "roleKey" text, "roleName" text,
  "roleNameAr" text, "status" text, "expiresAt" timestamptz
)
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public, erp
AS $$
  SELECT i.id AS "invitationId", i.tenant_id AS "tenantId", t.name AS "tenantName",
         t.name_ar AS "tenantNameAr", t.status AS "tenantStatus", i.email, i.role_id AS "roleId",
         r.key AS "roleKey", r.name AS "roleName", r.name_ar AS "roleNameAr", i.status,
         i.expires_at AS "expiresAt"
  FROM invitations i
  JOIN tenants t ON t.id = i.tenant_id
  JOIN roles r ON r.id = i.role_id
  WHERE i.token_hash = p_token_hash
$$;
--> statement-breakpoint
REVOKE EXECUTE ON FUNCTION erp.invitation_by_token(text) FROM PUBLIC;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION erp.invitation_by_token(text) TO erp_app;

--> statement-breakpoint
RESET ROLE;

--> statement-breakpoint
SET ROLE erp_migrate;

--> statement-breakpoint
-- Grants (DATABASE_CONVENTIONS §9): least privilege per table. The app role
-- never receives DELETE on users/memberships/invitations/sessions (status
-- transitions + revocation columns are the lifecycle), and permissions stays
-- read-only. Sessions need UPDATE (rotation, revocation, last_seen).
REVOKE ALL ON "users", "permissions", "roles", "role_permissions", "memberships", "devices", "sessions", "mfa_factors", "invitations" FROM erp_app;
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE ON "users" TO erp_app;
--> statement-breakpoint
GRANT SELECT ON "permissions" TO erp_app;
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON "roles" TO erp_app;
--> statement-breakpoint
GRANT SELECT, INSERT, DELETE ON "role_permissions" TO erp_app;
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE ON "memberships" TO erp_app;
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE ON "devices" TO erp_app;
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE ON "sessions" TO erp_app;
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON "mfa_factors" TO erp_app;
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE ON "invitations" TO erp_app;
--> statement-breakpoint
GRANT SELECT ON "users", "roles", "role_permissions", "memberships", "devices", "sessions", "mfa_factors", "invitations", "permissions" TO erp_readonly;

--> statement-breakpoint
-- Schema-state marker for /health/ready (mirrors the migration manifest).
INSERT INTO erp._schema_state (key, value) VALUES ('schema_version', 3)
ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, at = now();

--> statement-breakpoint
RESET ROLE;
