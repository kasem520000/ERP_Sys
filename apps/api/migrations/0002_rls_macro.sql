-- PHASE-002 · migration 0002 · RLS policy macro + schema-state marker
--
-- Purpose: the standard tenant-isolation policy macro (PHASE-002 §5.2) that
-- every later phase applies to each new tenant-owned table, plus the
-- schema-state upsert for migration 0002.
--
-- Runs after 0001 under the same role topology (bootstrap superuser or
-- erp_migrate). `SET ROLE erp_migrate` is a no-op when already connected as
-- erp_migrate on a provisioned environment.

--> statement-breakpoint
SET ROLE erp_migrate;

--> statement-breakpoint
-- Standard RLS policy macro (TENANT_ISOLATION §2): ENABLE + FORCE + the
-- `tenant_isolation` policy with both USING (reads) and WITH CHECK (writes).
-- The CI checker `scripts/check-rls.ts` asserts every table bearing
-- `tenant_id` was passed through this macro (or carries the documented
-- platform variant used by `tenants`).
CREATE OR REPLACE FUNCTION erp.apply_tenant_policy(p_table regclass) RETURNS void AS $$
BEGIN
  EXECUTE format('ALTER TABLE %s ENABLE ROW LEVEL SECURITY', p_table);
  EXECUTE format('ALTER TABLE %s FORCE ROW LEVEL SECURITY', p_table);
  EXECUTE format('DROP POLICY IF EXISTS tenant_isolation ON %s', p_table);
  EXECUTE format(
    'CREATE POLICY tenant_isolation ON %I TO erp_app, erp_readonly USING (tenant_id = erp.current_tenant_id()) WITH CHECK (tenant_id = erp.current_tenant_id())',
    p_table);
END
$$ LANGUAGE plpgsql;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION erp.apply_tenant_policy(regclass) TO erp_migrate;

--> statement-breakpoint
-- Apply the macro to the PHASE-002 tenant-owned table (idempotent re-run):
SELECT erp.apply_tenant_policy('"audit_events"');

--> statement-breakpoint
-- Schema-state marker for /health/ready (mirrors the migration manifest).
INSERT INTO erp._schema_state (key, value) VALUES ('schema_version', 2)
ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, at = now();

--> statement-breakpoint
RESET ROLE;
