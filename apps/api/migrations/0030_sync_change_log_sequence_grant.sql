-- PHASE-020 · migration 0030 · change_log sequence usage grant
--
-- Purpose (the T5 substrate fix, recorded in agent-ctx/T-P20-2a-pull.md):
-- migration 0024 granted erp_app INSERT on "change_log" but NOT USAGE on
-- its bigserial sequence change_log_seq_seq — nextval() is denied for
-- erp_app, so the 016 catch-up feed writer (and every PHASE-020 feed
-- writer: the generalized catch-up projections, publishFeedEntries, the
-- permissions snapshot) could never append a row through the app role.
-- The gap was invisible because no db spec exercised the INSERT path —
-- the isolation suite seeds change_log through the bootstrap role.
--
-- This grants sequence USAGE (nextval) + SELECT (currval diagnostics) to
-- erp_app, mirroring the 0028 precedent for a missed grant on an applied
-- migration. Additive only — no data, no RLS, no new tables.
--> statement-breakpoint
SET ROLE erp_migrate;

--> statement-breakpoint
-- ---------------------------------------------------------------------------
-- The change_log feed append path (the 0024 INSERT grant's missing half).
--> statement-breakpoint
GRANT USAGE, SELECT ON SEQUENCE "change_log_seq_seq" TO erp_app;
--> statement-breakpoint
RESET ROLE;

--> statement-breakpoint
-- Schema-state marker for /health/ready (mirrors the migration manifest).
INSERT INTO erp._schema_state (key, value) VALUES ('schema_version', 30)
ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, at = now();
