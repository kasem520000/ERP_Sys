-- PHASE-021 · migration 0032 · one-time enrollment proof (DR-P21-01)
--
-- Purpose (PHASE-021 MASTER-PLAN §1 item 2; SECURITY_AND_DEVICE_MANAGEMENT
-- §2/§3): the enrollment bootstrap endpoint `POST /api/v1/devices/:id/enroll`
-- verifies the registration-time enrollment secret against
-- `devices.device_key_hash` (sha256 at rest, the 003/016 shape) and CLEARS
-- the hash on success — the secret is strictly one-time (a cleared hash can
-- never mint credentials again; no existence leak, the second presentation
-- fails with the same typed DEVICE_REFRESH_INVALID as a wrong secret).
--
-- 0003 declared the column NOT NULL because the 003/016 device rows always
-- carried a key hash; the 021 one-time-clear semantics need NULL as the
-- "consumed" state. Relaxing to nullable is backward compatible: every
-- existing writer (terminal-service, the registry register(), the __db__
-- fixtures) still provides a hash, the unique index uq_devices_key_hash
-- keeps enforcing hash uniqueness among NON-NULL values (PostgreSQL treats
-- NULLs as distinct), and NULL now means "the enrollment proof was
-- consumed". No data change, no RLS change, no new tables.
--> statement-breakpoint
SET ROLE erp_migrate;

--> statement-breakpoint
-- The one-time enrollment proof: NULL = consumed (DR-P21-01).
ALTER TABLE "devices" ALTER COLUMN "device_key_hash" DROP NOT NULL;
--> statement-breakpoint
RESET ROLE;

--> statement-breakpoint
-- Schema-state marker for /health/ready (mirrors the migration manifest).
INSERT INTO erp._schema_state (key, value) VALUES ('schema_version', 32)
ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, at = now();
