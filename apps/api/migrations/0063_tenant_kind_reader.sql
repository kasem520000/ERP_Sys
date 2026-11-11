-- PHASE-040 (Blueprint v3.0 · OA-05) · migration 0063 · tenant_kind reader
--
-- Purpose (the T-10/T-11 sandbox-isolation spec catch): the consolidation
-- group service's SANDBOX-member refusal (§2.6) reads the MEMBER tenant's
-- kind from the PARENT tenant's request scope — a cross-tenant read the
-- tenants RLS policy correctly hides (id = current_tenant_id() OR
-- platform_scope_active()). The first cut rode withPlatformScope, which
-- both failed in the tenant-scope UoW (platformTx requires the platform
-- envelope) and would have opened a second connection inside an open
-- request transaction.
--
-- The house pattern for exactly this shape is the SECURITY DEFINER reader
-- (erp.consolidation_read_member_gl, erp.user_membership_options): a
-- pinned, STABLE, SELECT-only function that surfaces the minimum column
-- (kind) to erp_app without any RLS bypass beyond that single value.
--
-- Additive only (a new function; zero tables, zero row reshapes).

--> statement-breakpoint
SET ROLE erp_definer;

--> statement-breakpoint
-- The minimal cross-tenant kind probe (OA-05): one column, no joins, no
-- side effects. STABLE + pinned search_path (the definer hygiene rules).
CREATE OR REPLACE FUNCTION erp.tenant_kind(p_tenant_id uuid)
RETURNS text
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public, erp
AS $$
  SELECT t.kind FROM tenants t WHERE t.id = p_tenant_id
$$;

--> statement-breakpoint
REVOKE EXECUTE ON FUNCTION erp.tenant_kind(uuid) FROM PUBLIC;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION erp.tenant_kind(uuid) TO erp_app;

--> statement-breakpoint
RESET ROLE;

--> statement-breakpoint
-- Schema-state marker for /health/ready (mirrors the migration manifest).
INSERT INTO erp._schema_state (key, value) VALUES ('schema_version', 63)
ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, at = now();
