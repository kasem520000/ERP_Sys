-- PHASE-039 (Blueprint v3.0 · CR-09; scope extended by v3.1/CR-46) ·
-- migration 0057 · Returns & Collections III — partner credit risk
-- (L1-10: the periodic credit-review residual)
--
-- Purpose (PHASE-039 §4): ADDITIVE partner columns only — zero reshape
-- of the catalogued partners table. The credit-risk block:
--
--   credit_score_class — A|B|C|D (tenant-entered or rule-computed
--     locally; never an external scoring claim). A tenant-mapped
--     blocked class (setting sales.credit_block_class, default 'D')
--     behaves exactly like an over-limit block in the BR-001 credit
--     check — the documented interplay.
--   credit_review_frequency_days + next_credit_review_at — the
--     periodic review clock (NULL frequency = no periodic review).
--     The daily review-due sweep assigns reviewers via notifications
--     (category 'collections') and the outcome updates the class +
--     stamps last_credit_review_at/by; the outcome HISTORY rides the
--     existing audit_events machinery (the house record-timeline
--     pattern — no new history table; the 038 audit-event discipline).
--
-- INV-022 ledger: +0 tables (additive columns on a catalogued table),
-- +0 journals, +0 permissions (rides the 0056 keys), +0 feature keys.
--> statement-breakpoint
SET ROLE erp_migrate;

--> statement-breakpoint
-- ---------------------------------------------------------------------------
-- 1. Partner credit-risk columns (additive — zero reshape).
--> statement-breakpoint
ALTER TABLE "partners" ADD COLUMN IF NOT EXISTS "credit_score_class" text;
--> statement-breakpoint
ALTER TABLE "partners" ADD COLUMN IF NOT EXISTS "credit_review_frequency_days" integer;
--> statement-breakpoint
ALTER TABLE "partners" ADD COLUMN IF NOT EXISTS "next_credit_review_at" date;
--> statement-breakpoint
ALTER TABLE "partners" ADD COLUMN IF NOT EXISTS "last_credit_review_at" date;
--> statement-breakpoint
ALTER TABLE "partners" ADD COLUMN IF NOT EXISTS "last_credit_review_by" uuid;
--> statement-breakpoint
ALTER TABLE "partners" ADD COLUMN IF NOT EXISTS "credit_review_note" text;
--> statement-breakpoint
ALTER TABLE "partners" DROP CONSTRAINT IF EXISTS ck_partners_credit_score_class;
--> statement-breakpoint
ALTER TABLE "partners"
  ADD CONSTRAINT ck_partners_credit_score_class CHECK (
    "credit_score_class" IS NULL OR "credit_score_class" IN ('A','B','C','D')
  );
--> statement-breakpoint
ALTER TABLE "partners" DROP CONSTRAINT IF EXISTS ck_partners_credit_review_shape;
--> statement-breakpoint
ALTER TABLE "partners"
  ADD CONSTRAINT ck_partners_credit_review_shape CHECK (
    ("credit_review_frequency_days" IS NULL AND "next_credit_review_at" IS NULL)
    OR ("credit_review_frequency_days" IS NOT NULL AND "credit_review_frequency_days" >= 7
        AND "next_credit_review_at" IS NOT NULL)
  );
--> statement-breakpoint
ALTER TABLE "partners" DROP CONSTRAINT IF EXISTS fk_partners_last_credit_review_by;
--> statement-breakpoint
ALTER TABLE "partners"
  ADD CONSTRAINT fk_partners_last_credit_review_by FOREIGN KEY ("last_credit_review_by")
    REFERENCES "users" ("id") ON DELETE SET NULL;

--> statement-breakpoint
-- 2. The review-due sweep's hot path (tenant, due date).
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "ix_partners_tenant_credit_review"
  ON "partners" ("tenant_id", "next_credit_review_at")
  WHERE "next_credit_review_at" IS NOT NULL;

--> statement-breakpoint
-- 3. Bilingual column comments (evidence).
--> statement-breakpoint
COMMENT ON COLUMN "partners"."credit_score_class" IS 'PHASE-039 (L1-10): credit score class A|B|C|D — tenant-entered/rule-computed; the blocked class behaves like an over-limit block / فئة المخاطر الائتمانية';
--> statement-breakpoint
COMMENT ON COLUMN "partners"."next_credit_review_at" IS 'PHASE-039 (L1-10): the periodic credit-review clock / موعد المراجعة الائتمانية الدورية القادم';

--> statement-breakpoint
RESET ROLE;

--> statement-breakpoint
-- Schema-state marker for /health/ready (mirrors the migration manifest).
INSERT INTO erp._schema_state (key, value) VALUES ('schema_version', 57)
ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, at = now();
