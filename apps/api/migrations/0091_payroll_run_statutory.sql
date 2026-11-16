-- PHASE-046 (Blueprint v3.0 · CR-16) · migration 0091 · HR Payroll
-- Compliance (part 3: the run/line statutory extension — ADDITIVE ONLY).
--
-- The doc's law (D-05): no new document type, no new tables in the run
-- family — the runs and lines gain EXTENSION COLUMNS that carry the
-- statutory/variable BREAKDOWNS of the totals the 029 family already
-- holds. The INV-025 fold extends by construction:
--   deductions  += statutory employee share + PIT + the gated variable
--                  deductions (net = gross − deductions);
--   employer-side += the statutory employer share + variable overtime
--                  (the employer_contributions column).
-- ck_payroll_runs_totals and ck_payroll_run_lines_totals keep holding
-- (the new columns are breakdowns, never parallel totals — the fold law
-- is documented in the catalog row). The append-only line guard
-- (erp.payroll_run_lines_guard) is untouched: the DRAFT reset stays the
-- only writer path, now inside the run gate (D-09).

--> statement-breakpoint
SET ROLE erp_migrate;

--> statement-breakpoint
-- ---------------------------------------------------------------------------
-- 1. payroll_run_lines — the statutory + variable breakdown columns.
--> statement-breakpoint
ALTER TABLE "payroll_run_lines" ADD COLUMN IF NOT EXISTS "statutory_employee_share" numeric(19, 4) NOT NULL DEFAULT 0;
--> statement-breakpoint
ALTER TABLE "payroll_run_lines" ADD COLUMN IF NOT EXISTS "statutory_employer_share" numeric(19, 4) NOT NULL DEFAULT 0;
--> statement-breakpoint
ALTER TABLE "payroll_run_lines" ADD COLUMN IF NOT EXISTS "pit_withheld" numeric(19, 4) NOT NULL DEFAULT 0;
--> statement-breakpoint
ALTER TABLE "payroll_run_lines" ADD COLUMN IF NOT EXISTS "variable_overtime_amount" numeric(19, 4) NOT NULL DEFAULT 0;
--> statement-breakpoint
ALTER TABLE "payroll_run_lines" ADD COLUMN IF NOT EXISTS "variable_absence_amount" numeric(19, 4) NOT NULL DEFAULT 0;
--> statement-breakpoint
ALTER TABLE "payroll_run_lines" ADD COLUMN IF NOT EXISTS "variable_late_amount" numeric(19, 4) NOT NULL DEFAULT 0;
--> statement-breakpoint
ALTER TABLE "payroll_run_lines" ADD COLUMN IF NOT EXISTS "statutory_breakdown" jsonb;
--> statement-breakpoint
ALTER TABLE "payroll_run_lines" ADD COLUMN IF NOT EXISTS "variable_breakdown" jsonb;
--> statement-breakpoint
COMMENT ON COLUMN "payroll_run_lines"."statutory_breakdown" IS
  'PHASE-046 D-05: per profile row — {code, kind, appliesTo, base, rate, amount, cappedAt} — the INV-032(a) evidence (rate × clamped base == the line''s share, exact 4dp).';
--> statement-breakpoint
COMMENT ON COLUMN "payroll_run_lines"."variable_breakdown" IS
  'PHASE-046 D-08: the feed''s period facts — {multipliedHours, absenceDays, missingPunchDays (informational only — never deducted), lateMinutes, the applied rates} — the as-of snapshot the run froze.';

--> statement-breakpoint
-- ---------------------------------------------------------------------------
-- 2. payroll_runs — the statutory/variable totals + the liability summary.
--> statement-breakpoint
ALTER TABLE "payroll_runs" ADD COLUMN IF NOT EXISTS "statutory_employee_total" numeric(19, 4) NOT NULL DEFAULT 0;
--> statement-breakpoint
ALTER TABLE "payroll_runs" ADD COLUMN IF NOT EXISTS "statutory_employer_total" numeric(19, 4) NOT NULL DEFAULT 0;
--> statement-breakpoint
ALTER TABLE "payroll_runs" ADD COLUMN IF NOT EXISTS "pit_total" numeric(19, 4) NOT NULL DEFAULT 0;
--> statement-breakpoint
ALTER TABLE "payroll_runs" ADD COLUMN IF NOT EXISTS "variable_overtime_total" numeric(19, 4) NOT NULL DEFAULT 0;
--> statement-breakpoint
ALTER TABLE "payroll_runs" ADD COLUMN IF NOT EXISTS "variable_absence_total" numeric(19, 4) NOT NULL DEFAULT 0;
--> statement-breakpoint
ALTER TABLE "payroll_runs" ADD COLUMN IF NOT EXISTS "variable_late_total" numeric(19, 4) NOT NULL DEFAULT 0;
--> statement-breakpoint
ALTER TABLE "payroll_runs" ADD COLUMN IF NOT EXISTS "statutory_summary" jsonb;
--> statement-breakpoint
ALTER TABLE "payroll_runs" ADD COLUMN IF NOT EXISTS "eosb_trueup_total" numeric(19, 4) NOT NULL DEFAULT 0;
--> statement-breakpoint
COMMENT ON COLUMN "payroll_runs"."statutory_summary" IS
  'PHASE-046 D-05: per profile row — {code, accrued, remitted} — the remittance liability tracking the G-52 settlement consumes.';

--> statement-breakpoint
RESET ROLE;

--> statement-breakpoint
-- Schema-state marker for /health/ready (mirrors the migration manifest).
INSERT INTO erp._schema_state (key, value) VALUES ('schema_version', 91)
ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, at = now();
