-- PHASE-040 (Blueprint v3.0 · BR-066) · migration 0062 · import_jobs
-- mapping snapshot
--
-- Purpose (the T-10 spec catch): 0060's import_jobs carried `mapping_id`
-- (+ `options`) but never the RESOLVED column map, so the BR-066 worker's
-- re-validation re-derived the mapping from the saved row (or auto-detect)
-- — an EXPLICIT wizard mapping without a saved mapping row was LOST, and a
-- mapping EDITED between preview and commit made the re-validation silently
-- diverge from the preview it promised to honor.
--
-- This adds the snapshot column: createJob stamps the effective mapping
-- (explicit map, the saved mapping's current shape, or the auto-detect
-- result) at preview time; the worker re-validates against EXACTLY what
-- the preview promised (BR-066's stale-preview guard stays honest).
--
-- Additive only (expand rule; zero rows reshape — existing jobs predate
-- the column and re-resolve the way they always did).

--> statement-breakpoint
ALTER TABLE "import_jobs" ADD COLUMN IF NOT EXISTS "mapping" jsonb;

--> statement-breakpoint
-- Schema-state marker for /health/ready (mirrors the migration manifest).
INSERT INTO erp._schema_state (key, value) VALUES ('schema_version', 62)
ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, at = now();
