-- PHASE-044 (T-05) · migration 0072 · the pick-wave CANCEL evidence repair.
--
-- The 0068 state-evidence CHECK for pick_waves required every non-DRAFT
-- status to carry release evidence (released_at + wave_no) — which makes
-- cancelling a NEVER-RELEASED (DRAFT) wave impossible: CANCELLED is not
-- DRAFT, so the constraint demands a number the wave never earned. The
-- honest semantics: a wave cancelled before release carries NO release
-- evidence (cancelled_draft); a wave cancelled after release KEEPS its
-- stamps; COMPLETED always carries both release and completion evidence.
--
-- This is the additive-repair pattern (no data change — every existing
-- row satisfies the widened constraint; the constraint is replaced in
-- place with the corrected evidence law).

--> statement-breakpoint
SET ROLE erp_migrate;

--> statement-breakpoint
ALTER TABLE "pick_waves" DROP CONSTRAINT "ck_pick_waves_state_evidence";

--> statement-breakpoint
ALTER TABLE "pick_waves"
  ADD CONSTRAINT "ck_pick_waves_state_evidence" CHECK (
    ("status" = 'DRAFT' AND "released_at" IS NULL AND "wave_no" IS NULL AND "completed_at" IS NULL) OR
    ("status" IN ('RELEASED', 'COMPLETED') AND "released_at" IS NOT NULL AND "wave_no" IS NOT NULL) OR
    ("status" = 'COMPLETED' AND "completed_at" IS NOT NULL) OR
    ("status" = 'CANCELLED' AND "completed_at" IS NULL)
  );

--> statement-breakpoint
RESET ROLE;

--> statement-breakpoint
-- Schema-state marker for /health/ready (mirrors the migration manifest).
INSERT INTO erp._schema_state (key, value) VALUES ('schema_version', 72)
ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, at = now();
