-- PHASE-045 (Blueprint v3.0 · CR-15) · migration 0085 · HR Core —
-- Attendance, Leaves & Shifts (part 6: the employee ↔ user identity
-- bridge — HR-13).
--
--   employees.user_id (nullable) — the one-to-one link between the HR
--     employee file and the platform user. Employees WITHOUT a user
--     remain valid (the field workforce); the link is audited at the
--     service boundary (the bridge service writes the audit event) and
--     guarded by a partial UNIQUE — one user maps to at most ONE
--     employee per tenant (the uniqueness guard, acceptance
--     criterion 8).
--
--   SEGREGATION OF DUTIES (the authorization-matrix note): HR data
--     visibility is governed by HR permissions (`hr.*`), NEVER by user
--     administration — linking an employee to a user does not grant the
--     user any HR read surface; the dedicated attack test pins it.
--     ON DELETE SET NULL: deactivating a user unlinks (never destroys
--     the HR record).

--> statement-breakpoint
SET ROLE erp_migrate;

--> statement-breakpoint
-- ---------------------------------------------------------------------------
-- 1. The bridge column + the uniqueness guard (§2.8).
--> statement-breakpoint
ALTER TABLE "employees" ADD COLUMN IF NOT EXISTS "user_id" uuid
  REFERENCES "users" ("id") ON DELETE SET NULL;
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS uq_employees_tenant_user
  ON "employees" ("tenant_id", "user_id") WHERE "user_id" IS NOT NULL;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS ix_employees_tenant_user
  ON "employees" ("tenant_id", "user_id") WHERE "user_id" IS NOT NULL;

--> statement-breakpoint
-- ---------------------------------------------------------------------------
-- 2. Grants (the column rides the employees grants — nothing new).

--> statement-breakpoint
RESET ROLE;

--> statement-breakpoint
-- Schema-state marker for /health/ready (mirrors the migration manifest).
INSERT INTO erp._schema_state (key, value) VALUES ('schema_version', 85)
ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, at = now();
