-- PHASE-040 (Blueprint v3.0 · CR-10; OA-05) · migration 0061 · SANDBOX
-- tenant enforcement
--
-- Purpose (PHASE-040 §2.6): the time-box/quota enforcement substrate for
-- platform-provisioned SANDBOX tenants. The `user_membership_options`
-- projection (the definer view login + the tenant-context interceptor
-- already consume) gains two computed columns:
--
--   "tenantKind"     — STANDARD | SANDBOX
--   "sandboxExpired" — kind = 'SANDBOX' AND sandbox_expires_at < now()
--
-- Consumers: login refuses an expired sandbox (typed 403 identity/
-- sandbox-expired — the account survives, the demo does not); the
-- per-request interceptor enforces the same check so existing sessions
-- die at the first request after expiry (the SUSPENDED precedent). The
-- membership quota (sandbox_max_users) is enforced in the invitation
-- service; consolidation groups refuse SANDBOX members (group-service).
--
-- Numbering note (completion report §4): the phase doc planned a single
-- migration; 0060 (the toolkit substrate) + 0061 (this enforcement
-- widening) is the honest split — zero tables here, one function widened
-- additively (new columns are append-only in the RETURNS TABLE; existing
-- callers select by name).
--
-- DDL note: Postgres refuses to change a function's OUT-parameter row type
-- via CREATE OR REPLACE ("cannot change return type of existing function"),
-- so the widening is a DROP + CREATE pair. Both statements share the
-- migration's transaction — readers keep the 0003 shape until commit, so
-- the swap is atomic and there is no window where the projection is absent.

--> statement-breakpoint
SET ROLE erp_definer;

--> statement-breakpoint
DROP FUNCTION IF EXISTS erp.user_membership_options(uuid);

--> statement-breakpoint
CREATE FUNCTION erp.user_membership_options(p_user_id uuid)
RETURNS TABLE (
  "tenantId" uuid, "tenantName" text, "tenantNameAr" text, "tenantStatus" text,
  "membershipId" uuid, "roleId" uuid, "roleKey" text, "roleName" text, "roleNameAr" text,
  "branchScope" uuid[], "membershipStatus" text,
  -- PHASE-040 (0061): the SANDBOX plane surfaced on the projection every
  -- consumer already reads (login + the per-request interceptor).
  "tenantKind" text, "sandboxExpired" boolean
)
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public, erp
AS $$
  SELECT t.id AS "tenantId", t.name AS "tenantName", t.name_ar AS "tenantNameAr",
         t.status AS "tenantStatus", m.id AS "membershipId", r.id AS "roleId",
         r.key AS "roleKey", r.name AS "roleName", r.name_ar AS "roleNameAr",
         m.branch_scope AS "branchScope", m.status AS "membershipStatus",
         t.kind AS "tenantKind",
         (t.kind = 'SANDBOX' AND t.sandbox_expires_at < now()) AS "sandboxExpired"
  FROM memberships m
  JOIN tenants t ON t.id = m.tenant_id
  JOIN roles r ON r.id = m.role_id
  WHERE m.user_id = p_user_id
$$;

--> statement-breakpoint
REVOKE EXECUTE ON FUNCTION erp.user_membership_options(uuid) FROM PUBLIC;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION erp.user_membership_options(uuid) TO erp_app;

--> statement-breakpoint
RESET ROLE;

--> statement-breakpoint
-- Schema-state marker for /health/ready (mirrors the migration manifest).
INSERT INTO erp._schema_state (key, value) VALUES ('schema_version', 61)
ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, at = now();
