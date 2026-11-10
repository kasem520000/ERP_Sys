-- PHASE-029 · migration 0043 · payroll (salaries, loans & end-of-service)
--
-- Purpose (PHASE-029 §4 Design Impact + DR-005/ED-05): the payroll module
-- lands in FINANCIAL SCOPE ONLY — seven tenant-owned tables (the PII
-- -restricted employee financial file, versioned salary structures with
-- per-component GL accounts, monthly runs with frozen per-employee
-- component snapshots 🔒 append-only lines, employee loans with schedule
-- lines), all RLS'd with composite tenant FKs.
--
-- Payroll IS a ledger-writing module (unlike 0042 budgeting): every run
-- posts exactly ONE G-29 journal through the PHASE-007 engine (source
-- payroll_run / operation post — INV-013 idempotency), payouts post G-30
-- (source payroll_run / operation payout) + a treasury cash_movements row
-- through the STORE API (INV-019 — treasury-owned), loan disbursement
-- posts the control-account journal (source employee_loan / operation
-- disburse) + its movement, EOS settlement posts G-31 (source employee /
-- operation eos_settle). The engine gains the BR-053 source-guard:
-- manual journals (docType journal_entry) touching the six payroll
-- purpose accounts die with PAYROLL_ACCOUNT_ENGINE_ONLY.
--
-- INV-025 (the phase's core DB invariant, self-proving at the row level):
--   ck_payroll_runs_totals       — net_total = gross_total − deductions_total
--                                  and all five money columns ≥ 0 (every
--                                  row, every state);
--   ck_payroll_run_lines_totals  — the same fold at the per-employee line
--                                  (Σ lines == run totals is the service-
--                                  side write contract; the row-level law
--                                  makes every line self-consistent).
--
-- State machines (DATA_DICTIONARY §9):
--   payroll_run_status  DRAFT → PENDING_APPROVAL → POSTED (shape CHECKs:
--     ck_payroll_runs_posted_shape  — POSTED ⇔ journal_entry_id NOT NULL;
--     ck_payroll_runs_posted_stamps — POSTED ⇔ posted_at NOT NULL;
--     ck_payroll_runs_draft_shape   — DRAFT ⇒ no journal + no approval +
--       no posting stamps; the approved stamp lands while STILL
--       PENDING_APPROVAL — the 0038/0042 one-directional lesson);
--   employee_status     ACTIVE / SUSPENDED / TERMINATED (termination_date
--     ⇔ TERMINATED — bidirectional: the machine only TERMINATEs with a
--     date, and a dated row never returns without clearing it);
--   loan_status         ACTIVE / CLOSED / WRITE_OFF (write-off requires a
--     reason — ck_employee_loans_writeoff_shape);
--   loan_line_status    PENDING / DEDUCTED / WAIVED (DEDUCTED ⇒ the
--     deducting run id stamped; WAIVED ⇒ a reason; no DELETE via erp_app
--     — lines transition, never leave).
--
-- payroll_run_lines 🔒 (INV-003 pattern — the 0037 depreciation_lines
-- discipline): UPDATE grant-denied outright; DELETE is grant-capable but
-- POLICY-OWNED by erp.payroll_run_lines_guard (posted-run lines are
-- immutable history; DELETE passes only for purge_mode or DRAFT-run
-- recalculation resets).
--
-- C-PII discipline (DATA_PROTECTION §1/§2 — national_id + bank fields):
-- at-rest protection for the C-PII class is DB-volume encryption (the
-- deployment/KMS layer — INFRA-GATED in this stack; the compose volume
-- maps document the boundary); the code-level disciplines are: masked API
-- responses (restricted payroll.employees.view + screen context),
-- audit-on-read, the pino allow-list (no PII keys exist in it — logs
-- serialize ids only), and exclusion from every non-payroll export by
-- construction. No payroll column ever enters a log line.
--
-- CoA template (the 0038 pattern): the six payroll purposes gain template
-- accounts — 2170/2180/2190 (current liabilities) + 5270/5280/5295 (the
-- 5200 Salaries & wages group). CODE-COLLISION DISCIPLINE (the 026/027
-- lesson): all six verified free across the whole chain 0001–0042 (2160
-- was taken by 0038 NOTES_PAYABLE; 5260 by 0038 NOTES_DISCOUNT_EXPENSE;
-- 5250 by 0025 COMMISSION_EXPENSE; 5290 by the base template
-- VAT_EXPENSED — hence 5295, the last round-ish slot inside the 52xx
-- children range). The employee-loan control account is INTENTIONALLY
-- NOT a purpose (phase item 5 — §E list stays closed): the tenant maps
-- their own account via the payroll.loans.control_account_id policy key
-- (typed LOAN_ACCOUNT_UNMAPPED until mapped).
--
-- cash_movements source widening (ADDITIVE — the P27-G lesson): the
-- payroll payout + loan disbursement movements widen the CHECK with
-- 'payroll_payout' and 'employee_loan'; every existing kind is
-- re-declared verbatim.
--
-- Notifications (§12): the category CHECK widens with 'payroll' (the
-- 0023/0027/0035/0042 pattern) — cap-clamp warnings (BR-054), the
-- missing-EOS-policy warning (BR-055), run-approval surfacing.
--
-- Plan grants (§13): the eight FEATURE_CATALOG §22 payroll keys join
-- business + enterprise (the tier-4 financial-depth precedent —
-- fixed_assets 0037, notes/installments 0038, budgeting 0042); starter
-- does NOT get them.
--
-- Permissions: NOTHING to seed — the §3.14 keys (payroll.employees.
-- view|manage, payroll.salary_structures.manage, payroll.runs.
-- view|create|approve|post, payroll.loans.manage, payroll.reports.view)
-- already live in 0004/0005 with the payroll_officer role template (the
-- docs-as-contract head start; drift stays 245=245).
--
-- Official numbers (INV-021/ADR-0006): payroll runs reserve PR-{YYYY}-
-- {SEQ:6} through the PHASE-007 numbering service at posting (the
-- treasury format-constants pattern); employee/structure/loan codes are
-- tenant-scoped natural keys (DATA_DICTIONARY §12).
--
-- Table order: salary_structures → salary_components → employees (the
-- composite FK target) → payroll_runs → payroll_run_lines →
-- employee_loans → employee_loan_lines.

--> statement-breakpoint
SET ROLE erp_migrate;

--> statement-breakpoint
-- ---------------------------------------------------------------------------
-- 1. salary_structures (T3): the BR-052 version register. status
-- ACTIVE/ARCHIVED; superseded_by_id links an ARCHIVED row to the version
-- that replaced it (mid-period changes create a NEW version — used
-- structures are never edited in place; the run's component_snapshot is
-- the frozen truth). currency pins the structure's money world (a
-- structure currency ≠ tenant base is rejected at the service, typed —
-- the run posts base-denominated anyway, the G-29 discipline).
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "salary_structures" (
  "id" uuid NOT NULL,
  "tenant_id" uuid NOT NULL REFERENCES "tenants" ("id") ON DELETE RESTRICT,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "updated_at" timestamptz NOT NULL DEFAULT now(),
  "version" integer NOT NULL DEFAULT 1,
  "created_by" uuid,
  "code" text NOT NULL,
  "name" text NOT NULL,
  "name_ar" text,
  "currency" text NOT NULL,
  "status" text NOT NULL DEFAULT 'ACTIVE',
  "superseded_by_id" uuid,
  "note" text,
  "note_ar" text,
  CONSTRAINT pk_salary_structures PRIMARY KEY ("id"),
  CONSTRAINT uq_salary_structures_id_tenant UNIQUE ("id", "tenant_id"),
  CONSTRAINT uq_salary_structures_tenant_code UNIQUE ("tenant_id", "code"),
  CONSTRAINT fk_salary_structures_superseded_by FOREIGN KEY ("superseded_by_id", "tenant_id")
    REFERENCES "salary_structures" ("id", "tenant_id") ON DELETE RESTRICT,
  CONSTRAINT ck_salary_structures_status_values CHECK ("status" IN ('ACTIVE', 'ARCHIVED')),
  CONSTRAINT ck_salary_structures_archived_shape CHECK (
    ("status" = 'ARCHIVED') = ("superseded_by_id" IS NOT NULL)),
  CONSTRAINT ck_salary_structures_code CHECK ("code" ~ '^[A-Za-z0-9._/-]{1,40}$')
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS ix_salary_structures_tenant_status
  ON "salary_structures" ("tenant_id", "status");
--> statement-breakpoint
COMMENT ON TABLE "salary_structures" IS
  'PHASE-029 T3: salary structure versions (BR-052) — ACTIVE/ARCHIVED with the superseded_by chain; mid-period changes create a NEW version (components copied + edited), used structures are never edited in place. Every component carries its own gl_account_id (expense-side CoA mapping) and the is_eos_base flag (BR-055 accrual basis).';

--> statement-breakpoint
-- ---------------------------------------------------------------------------
-- 2. salary_components (T3): the structure's component list. kind §9 =
-- ALLOWANCE / DEDUCTION / EMPLOYER_CONTRIBUTION; calc §9 = FIXED /
-- PERCENT_OF_BASIC / PERCENT_OF_GROSS (rate 7,4 — ADR-0009); the calc
-- shape CHECK pins exactly one driver: FIXED ⇒ amount NOT NULL + rate
-- NULL; PERCENT_* ⇒ rate NOT NULL + amount NULL. gl_account_id is the
-- component's expense-side account (validated postable at the service —
-- foreign ids die typed 404); is_eos_base flags EOS-eligible components
-- (the BR-055 accrual sums exactly these). seq orders the calculation
-- (basic → percent-of-basic → percent-of-gross → fixed is the SERVICE
-- order; seq breaks ties deterministically).
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "salary_components" (
  "id" uuid NOT NULL,
  "tenant_id" uuid NOT NULL REFERENCES "tenants" ("id") ON DELETE RESTRICT,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "updated_at" timestamptz NOT NULL DEFAULT now(),
  "version" integer NOT NULL DEFAULT 1,
  "created_by" uuid,
  "structure_id" uuid NOT NULL,
  "key" text NOT NULL,
  "name" text NOT NULL,
  "name_ar" text,
  "kind" text NOT NULL,
  "calc" text NOT NULL,
  "amount" numeric(19,4),
  "rate" numeric(7,4),
  "gl_account_id" uuid NOT NULL,
  "is_eos_base" boolean NOT NULL DEFAULT false,
  "seq" integer NOT NULL DEFAULT 1,
  CONSTRAINT pk_salary_components PRIMARY KEY ("id"),
  CONSTRAINT uq_salary_components_id_tenant UNIQUE ("id", "tenant_id"),
  CONSTRAINT uq_salary_components_structure_key UNIQUE ("tenant_id", "structure_id", "key"),
  CONSTRAINT fk_salary_components_structure FOREIGN KEY ("structure_id", "tenant_id")
    REFERENCES "salary_structures" ("id", "tenant_id") ON DELETE RESTRICT,
  CONSTRAINT fk_salary_components_account FOREIGN KEY ("gl_account_id", "tenant_id")
    REFERENCES "accounts" ("id", "tenant_id") ON DELETE RESTRICT,
  CONSTRAINT ck_salary_components_kind_values CHECK ("kind" IN ('ALLOWANCE', 'DEDUCTION', 'EMPLOYER_CONTRIBUTION')),
  CONSTRAINT ck_salary_components_calc_values CHECK ("calc" IN ('FIXED', 'PERCENT_OF_BASIC', 'PERCENT_OF_GROSS')),
  CONSTRAINT ck_salary_components_calc_shape CHECK (
    ("calc" = 'FIXED' AND "amount" IS NOT NULL AND "rate" IS NULL) OR
    ("calc" IN ('PERCENT_OF_BASIC', 'PERCENT_OF_GROSS') AND "rate" IS NOT NULL AND "amount" IS NULL)),
  CONSTRAINT ck_salary_components_amount CHECK ("amount" IS NULL OR "amount" >= 0),
  CONSTRAINT ck_salary_components_rate CHECK ("rate" IS NULL OR ("rate" >= 0 AND "rate" <= 100)),
  CONSTRAINT ck_salary_components_seq CHECK ("seq" >= 1)
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS ix_salary_components_tenant_structure
  ON "salary_components" ("tenant_id", "structure_id");
--> statement-breakpoint
COMMENT ON TABLE "salary_components" IS
  'PHASE-029 T3: the per-structure component list — kind ALLOWANCE/DEDUCTION/EMPLOYER_CONTRIBUTION, calc FIXED/PERCENT_OF_BASIC/PERCENT_OF_GROSS (one driver per the calc shape CHECK; rate 7,4), per-component gl_account_id (expense-side CoA mapping) + is_eos_base (BR-055 accrual basis). Editable only while the parent structure is unused (BR-052: used structures version, never edit).';

--> statement-breakpoint
-- ---------------------------------------------------------------------------
-- 3. employees (T2): the PII-restricted employee financial file. code is
-- the tenant-scoped natural key (user-entered, unique per tenant);
-- national_id + bank_name/bank_iban/bank_account are the C-PII columns
-- (masked in API responses, audit-on-read — see the module's employee
-- service); salary_structure_id/branch_id/cost_center_id/project_id are
-- the run-calculation dimensions (composite tenant FKs); basic_salary is
-- the PERCENT_OF_BASIC basis (19,4 — ADR-0009; ≥ 0). Status lifecycled —
-- NO DELETE grant (TERMINATED rows stay: the EOS + audit history).
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "employees" (
  "id" uuid NOT NULL,
  "tenant_id" uuid NOT NULL REFERENCES "tenants" ("id") ON DELETE RESTRICT,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "updated_at" timestamptz NOT NULL DEFAULT now(),
  "version" integer NOT NULL DEFAULT 1,
  "created_by" uuid,
  "code" text NOT NULL,
  "name" text NOT NULL,
  "name_ar" text,
  "national_id" text,
  "hire_date" date NOT NULL,
  "termination_date" date,
  "termination_reason" text,
  "contract_type" text NOT NULL,
  "basic_salary" numeric(19,4) NOT NULL,
  "salary_structure_id" uuid,
  "branch_id" uuid,
  "cost_center_id" uuid,
  "project_id" uuid,
  "bank_name" text,
  "bank_iban" text,
  "bank_account" text,
  "eos_settled_amount" numeric(19,4),
  "eos_settlement_journal_entry_id" uuid,
  "eos_settled_at" timestamptz,
  "status" text NOT NULL DEFAULT 'ACTIVE',
  "note" text,
  "note_ar" text,
  CONSTRAINT pk_employees PRIMARY KEY ("id"),
  CONSTRAINT uq_employees_id_tenant UNIQUE ("id", "tenant_id"),
  CONSTRAINT uq_employees_tenant_code UNIQUE ("tenant_id", "code"),
  CONSTRAINT fk_employees_structure FOREIGN KEY ("salary_structure_id", "tenant_id")
    REFERENCES "salary_structures" ("id", "tenant_id") ON DELETE RESTRICT,
  CONSTRAINT fk_employees_branch FOREIGN KEY ("branch_id", "tenant_id")
    REFERENCES "branches" ("id", "tenant_id") ON DELETE RESTRICT,
  CONSTRAINT fk_employees_cost_center FOREIGN KEY ("cost_center_id", "tenant_id")
    REFERENCES "cost_centers" ("id", "tenant_id") ON DELETE RESTRICT,
  CONSTRAINT fk_employees_project FOREIGN KEY ("project_id", "tenant_id")
    REFERENCES "projects" ("id", "tenant_id") ON DELETE RESTRICT,
  CONSTRAINT ck_employees_contract_values CHECK ("contract_type" IN ('FULL_TIME', 'PART_TIME', 'CONTRACTOR')),
  CONSTRAINT ck_employees_status_values CHECK ("status" IN ('ACTIVE', 'SUSPENDED', 'TERMINATED')),
  CONSTRAINT ck_employees_basic_salary CHECK ("basic_salary" >= 0),
  CONSTRAINT ck_employees_terminated_shape CHECK (
    ("status" = 'TERMINATED') = ("termination_date" IS NOT NULL)),
  CONSTRAINT ck_employees_eos_settled_shape CHECK (
    ("eos_settled_amount" IS NULL) = ("eos_settlement_journal_entry_id" IS NULL)),
  CONSTRAINT ck_employees_eos_settled_nonneg CHECK (
    "eos_settled_amount" IS NULL OR "eos_settled_amount" >= 0),
  CONSTRAINT ck_employees_code CHECK ("code" ~ '^[A-Za-z0-9._/-]{1,40}$')
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS ix_employees_tenant_status
  ON "employees" ("tenant_id", "status");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS ix_employees_tenant_structure
  ON "employees" ("tenant_id", "salary_structure_id");
--> statement-breakpoint
-- The §4 search index (tenant-first trigram over the name — the partners
-- 0009 pg_trgm precedent; the extension already exists).
CREATE INDEX IF NOT EXISTS ix_employees_tenant_name_trgm
  ON "employees" USING gin ("tenant_id", "name" gin_trgm_ops);
--> statement-breakpoint
COMMENT ON TABLE "employees" IS
  'PHASE-029 T2: the PII-restricted employee financial file (financial scope only — DR-005/ED-05). national_id + bank fields are C-PII (DATA_PROTECTION §1): masked in API responses (restricted payroll.employees.view + screen context), audit-on-read, never in logs (pino allow-list), never in non-payroll exports. employee_status §9: ACTIVE/SUSPENDED/TERMINATED (termination_date ⇔ TERMINATED). Status-lifecycled — no delete: TERMINATED rows are the EOS/audit history.';

--> statement-breakpoint
-- ---------------------------------------------------------------------------
-- 4. payroll_runs (T4): the monthly run register — one live run per
-- fiscal period (the partial unique admits DRAFT re-work but at most ONE
-- non-DRAFT run per period). Totals carry INV-025 as a row-level law
-- (net = gross − deductions, all money columns ≥ 0). The approved stamp
-- lands while STILL PENDING_APPROVAL (SoD — the one-directional lesson);
-- journal_entry_id ⇔ POSTED; reversal stamps record the engine-reversal
-- path (POSTED stays POSTED — reversal-only corrections, INV-003).
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "payroll_runs" (
  "id" uuid NOT NULL,
  "tenant_id" uuid NOT NULL REFERENCES "tenants" ("id") ON DELETE RESTRICT,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "updated_at" timestamptz NOT NULL DEFAULT now(),
  "version" integer NOT NULL DEFAULT 1,
  "created_by" uuid,
  "run_no" text,
  "fiscal_period_id" uuid NOT NULL,
  "status" text NOT NULL DEFAULT 'DRAFT',
  "gross_total" numeric(19,4) NOT NULL DEFAULT 0,
  "deductions_total" numeric(19,4) NOT NULL DEFAULT 0,
  "net_total" numeric(19,4) NOT NULL DEFAULT 0,
  "paid_net_total" numeric(19,4) NOT NULL DEFAULT 0,
  "employer_contributions_total" numeric(19,4) NOT NULL DEFAULT 0,
  "eos_accrual_total" numeric(19,4) NOT NULL DEFAULT 0,
  "journal_entry_id" uuid,
  "entry_no" text,
  "submitted_at" timestamptz,
  "submitted_by" uuid,
  "approved_at" timestamptz,
  "approved_by" uuid,
  "posted_at" timestamptz,
  "posted_by" uuid,
  "reversal_journal_entry_id" uuid,
  "reversed_at" timestamptz,
  "reversed_by" uuid,
  "note" text,
  "note_ar" text,
  CONSTRAINT pk_payroll_runs PRIMARY KEY ("id"),
  CONSTRAINT uq_payroll_runs_id_tenant UNIQUE ("id", "tenant_id"),
  CONSTRAINT fk_payroll_runs_period FOREIGN KEY ("fiscal_period_id", "tenant_id")
    REFERENCES "fiscal_periods" ("id", "tenant_id") ON DELETE RESTRICT,
  CONSTRAINT ck_payroll_runs_status_values CHECK ("status" IN ('DRAFT', 'PENDING_APPROVAL', 'POSTED')),
  CONSTRAINT ck_payroll_runs_totals CHECK (
    "net_total" = "gross_total" - "deductions_total"
      AND "gross_total" >= 0 AND "deductions_total" >= 0 AND "net_total" >= 0
      AND "employer_contributions_total" >= 0 AND "eos_accrual_total" >= 0),
  CONSTRAINT ck_payroll_runs_paid_shape CHECK (
    "paid_net_total" >= 0 AND "paid_net_total" <= "net_total"),
  CONSTRAINT ck_payroll_runs_posted_shape CHECK (
    ("status" = 'POSTED') = ("journal_entry_id" IS NOT NULL)),
  CONSTRAINT ck_payroll_runs_posted_stamps CHECK (
    ("status" = 'POSTED') = ("posted_at" IS NOT NULL)),
  CONSTRAINT ck_payroll_runs_draft_shape CHECK (
    NOT ("status" = 'DRAFT' AND ("journal_entry_id" IS NOT NULL OR "approved_at" IS NOT NULL OR "posted_at" IS NOT NULL))),
  CONSTRAINT ck_payroll_runs_run_no_shape CHECK ("run_no" IS NULL OR "run_no" ~ '^PR-[0-9]{4}-[0-9]{1,6}$')
);
--> statement-breakpoint
-- One live (non-DRAFT) run per (tenant, fiscal period) — the monthly-run
-- law; DRAFTs are free (the re-calculate path).
CREATE UNIQUE INDEX IF NOT EXISTS uq_payroll_runs_one_live
  ON "payroll_runs" ("tenant_id", "fiscal_period_id")
  WHERE "status" IN ('PENDING_APPROVAL', 'POSTED');
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS ix_payroll_runs_tenant_period_status
  ON "payroll_runs" ("tenant_id", "fiscal_period_id", "status");
--> statement-breakpoint
COMMENT ON TABLE "payroll_runs" IS
  'PHASE-029 T4: monthly payroll runs — DRAFT → PENDING_APPROVAL → POSTED (SoD approval: the creator never approves), exactly one G-29 journal per run through the posting engine (INV-013 source payroll_run/post; BR-053: payroll accounts post ONLY here). INV-025 is a row-level CHECK: net = gross − deductions exactly. run_no is the official PR-{YYYY}-{SEQ:6} number (INV-021, numbering service at posting). Reversal-only corrections (INV-003): POSTED stays POSTED, reversal_journal_entry_id records the engine reversal.';

--> statement-breakpoint
-- ---------------------------------------------------------------------------
-- 5. payroll_run_lines 🔒 (T4): per-employee frozen pay lines — written
-- once at calculation, NEVER updated (INV-003 append-only: the
-- component_snapshot jsonb freezes the structure basis so posted history
-- never depends on later edits — BR-052). DELETE is policy-owned by
-- erp.payroll_run_lines_guard: DRAFT-run recalculation resets + the purge
-- path ONLY (posted-run lines are immutable history). Line totals carry
-- the same INV-025 row-level law. Dimensions stamp the G-29 expense lines
-- (cost-center/project/branch allocation — phase item 7).
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "payroll_run_lines" (
  "id" uuid NOT NULL,
  "tenant_id" uuid NOT NULL REFERENCES "tenants" ("id") ON DELETE RESTRICT,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "updated_at" timestamptz NOT NULL DEFAULT now(),
  "version" integer NOT NULL DEFAULT 1,
  "created_by" uuid,
  "run_id" uuid NOT NULL,
  "employee_id" uuid NOT NULL,
  "component_snapshot" jsonb NOT NULL,
  "gross_amount" numeric(19,4) NOT NULL,
  "deductions_amount" numeric(19,4) NOT NULL,
  "net_amount" numeric(19,4) NOT NULL,
  "employer_contributions" numeric(19,4) NOT NULL DEFAULT 0,
  "eos_accrual" numeric(19,4) NOT NULL DEFAULT 0,
  "cost_center_id" uuid,
  "project_id" uuid,
  "branch_id" uuid,
  CONSTRAINT pk_payroll_run_lines PRIMARY KEY ("id"),
  CONSTRAINT uq_payroll_run_lines_id_tenant UNIQUE ("id", "tenant_id"),
  CONSTRAINT fk_payroll_run_lines_run FOREIGN KEY ("run_id", "tenant_id")
    REFERENCES "payroll_runs" ("id", "tenant_id") ON DELETE RESTRICT,
  CONSTRAINT fk_payroll_run_lines_employee FOREIGN KEY ("employee_id", "tenant_id")
    REFERENCES "employees" ("id", "tenant_id") ON DELETE RESTRICT,
  CONSTRAINT ck_payroll_run_lines_totals CHECK (
    "net_amount" = "gross_amount" - "deductions_amount"
      AND "gross_amount" >= 0 AND "deductions_amount" >= 0 AND "net_amount" >= 0
      AND "employer_contributions" >= 0 AND "eos_accrual" >= 0)
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS ix_payroll_run_lines_tenant_run
  ON "payroll_run_lines" ("tenant_id", "run_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS ix_payroll_run_lines_tenant_employee
  ON "payroll_run_lines" ("tenant_id", "employee_id");
--> statement-breakpoint
COMMENT ON TABLE "payroll_run_lines" IS
  'PHASE-029 T4: per-employee frozen pay lines 🔒 append-only (INV-003): component_snapshot jsonb freezes the calculation basis (BR-052 — posted history never depends on later structure edits); totals carry the INV-025 row-level law; dimensions (cost_center/project/branch) stamp the G-29 expense lines. UPDATE grant-denied outright; DELETE policy-owned by erp.payroll_run_lines_guard (DRAFT recalc resets + purge only).';

--> statement-breakpoint
-- ---------------------------------------------------------------------------
-- 6. employee_loans (T8): the loan register — disbursement posts the
-- control-account journal (source employee_loan/disburse; the
-- tenant-mapped account via payroll.loans.control_account_id — typed
-- LOAN_ACCOUNT_UNMAPPED until mapped; NOT a canonical purpose) + a
-- treasury cash movement (source employee_loan). Status ACTIVE/CLOSED/
-- WRITE_OFF; write-off requires a reason; CLOSED arrives via the
-- schedule completing (all lines DEDUCTED/WAIVED — the service flips it).
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "employee_loans" (
  "id" uuid NOT NULL,
  "tenant_id" uuid NOT NULL REFERENCES "tenants" ("id") ON DELETE RESTRICT,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "updated_at" timestamptz NOT NULL DEFAULT now(),
  "version" integer NOT NULL DEFAULT 1,
  "created_by" uuid,
  "code" text NOT NULL,
  "employee_id" uuid NOT NULL,
  "amount" numeric(19,4) NOT NULL,
  "installments_count" integer NOT NULL,
  "start_period_id" uuid NOT NULL,
  "status" text NOT NULL DEFAULT 'ACTIVE',
  "cash_account_id" uuid,
  "disbursement_journal_entry_id" uuid,
  "disbursed_at" timestamptz,
  "disbursed_by" uuid,
  "write_off_reason" text,
  "write_off_at" timestamptz,
  "write_off_by" uuid,
  "note" text,
  "note_ar" text,
  CONSTRAINT pk_employee_loans PRIMARY KEY ("id"),
  CONSTRAINT uq_employee_loans_id_tenant UNIQUE ("id", "tenant_id"),
  CONSTRAINT uq_employee_loans_tenant_code UNIQUE ("tenant_id", "code"),
  CONSTRAINT fk_employee_loans_employee FOREIGN KEY ("employee_id", "tenant_id")
    REFERENCES "employees" ("id", "tenant_id") ON DELETE RESTRICT,
  CONSTRAINT fk_employee_loans_start_period FOREIGN KEY ("start_period_id", "tenant_id")
    REFERENCES "fiscal_periods" ("id", "tenant_id") ON DELETE RESTRICT,
  CONSTRAINT fk_employee_loans_cash_account FOREIGN KEY ("cash_account_id", "tenant_id")
    REFERENCES "cash_accounts" ("id", "tenant_id") ON DELETE RESTRICT,
  CONSTRAINT ck_employee_loans_status_values CHECK ("status" IN ('ACTIVE', 'CLOSED', 'WRITE_OFF')),
  CONSTRAINT ck_employee_loans_amount CHECK ("amount" > 0),
  CONSTRAINT ck_employee_loans_installments CHECK ("installments_count" >= 1),
  CONSTRAINT ck_employee_loans_writeoff_shape CHECK (
    ("status" = 'WRITE_OFF') = ("write_off_reason" IS NOT NULL)),
  CONSTRAINT ck_employee_loans_code CHECK ("code" ~ '^[A-Za-z0-9._/-]{1,40}$')
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS ix_employee_loans_tenant_employee_status
  ON "employee_loans" ("tenant_id", "employee_id", "status");
--> statement-breakpoint
COMMENT ON TABLE "employee_loans" IS
  'PHASE-029 T8: employee loans — disbursement posts DR <tenant-mapped loan control account> · CR CASH (source employee_loan/disburse) + the treasury cash movement (INV-019); deductions recover through the control account inside the run (BR-054 cap: ≤ payroll.loans.max_deduction_percent of net — default 25% PLACEHOLDER). write-off requires reason + audit; WAIVED lines likewise. No canonical CoA purpose is introduced for the control account (§E list stays closed).';

--> statement-breakpoint
-- ---------------------------------------------------------------------------
-- 7. employee_loan_lines (T8): the per-period deduction schedule —
-- immutable after disbursement (no erp_app DELETE; the loan register is
-- born with its schedule like the installment plans). Status transitions
-- PENDING → DEDUCTED (stamps the deducting run) / WAIVED (reason
-- required, sticky). A missed period simply stays PENDING — deductions
-- land when the run actually runs, never retro-fabricated.
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "employee_loan_lines" (
  "id" uuid NOT NULL,
  "tenant_id" uuid NOT NULL REFERENCES "tenants" ("id") ON DELETE RESTRICT,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "updated_at" timestamptz NOT NULL DEFAULT now(),
  "version" integer NOT NULL DEFAULT 1,
  "created_by" uuid,
  "loan_id" uuid NOT NULL,
  "fiscal_period_id" uuid NOT NULL,
  "amount" numeric(19,4) NOT NULL,
  "status" text NOT NULL DEFAULT 'PENDING',
  "payroll_run_id" uuid,
  "waived_reason" text,
  "waived_at" timestamptz,
  "waived_by" uuid,
  CONSTRAINT pk_employee_loan_lines PRIMARY KEY ("id"),
  CONSTRAINT uq_employee_loan_lines_id_tenant UNIQUE ("id", "tenant_id"),
  CONSTRAINT fk_employee_loan_lines_loan FOREIGN KEY ("loan_id", "tenant_id")
    REFERENCES "employee_loans" ("id", "tenant_id") ON DELETE RESTRICT,
  CONSTRAINT fk_employee_loan_lines_period FOREIGN KEY ("fiscal_period_id", "tenant_id")
    REFERENCES "fiscal_periods" ("id", "tenant_id") ON DELETE RESTRICT,
  CONSTRAINT fk_employee_loan_lines_run FOREIGN KEY ("payroll_run_id", "tenant_id")
    REFERENCES "payroll_runs" ("id", "tenant_id") ON DELETE RESTRICT,
  CONSTRAINT ck_employee_loan_lines_status_values CHECK ("status" IN ('PENDING', 'DEDUCTED', 'WAIVED')),
  CONSTRAINT ck_employee_loan_lines_amount CHECK ("amount" > 0),
  CONSTRAINT ck_employee_loan_lines_deducted_shape CHECK (
    ("status" = 'DEDUCTED') = ("payroll_run_id" IS NOT NULL)),
  CONSTRAINT ck_employee_loan_lines_waived_shape CHECK (
    ("status" = 'WAIVED') = ("waived_reason" IS NOT NULL))
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS ix_employee_loan_lines_tenant_period_status
  ON "employee_loan_lines" ("tenant_id", "fiscal_period_id", "status");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS ix_employee_loan_lines_tenant_loan
  ON "employee_loan_lines" ("tenant_id", "loan_id");
--> statement-breakpoint
COMMENT ON TABLE "employee_loan_lines" IS
  'PHASE-029 T8: the per-period loan deduction schedule — immutable after disbursement; PENDING → DEDUCTED (stamps the run — one deduction per line) / WAIVED (reason required, sticky). The run clamps Σ deductions to the BR-054 cap percent of net with an explicit warning.';

--> statement-breakpoint
-- ---------------------------------------------------------------------------
-- 8. RLS (TENANT_ISOLATION §2): the house macro on every new tenant-owned
-- table.
--> statement-breakpoint
SELECT erp.apply_tenant_policy('"employees"');
--> statement-breakpoint
SELECT erp.apply_tenant_policy('"salary_structures"');
--> statement-breakpoint
SELECT erp.apply_tenant_policy('"salary_components"');
--> statement-breakpoint
SELECT erp.apply_tenant_policy('"payroll_runs"');
--> statement-breakpoint
SELECT erp.apply_tenant_policy('"payroll_run_lines"');
--> statement-breakpoint
SELECT erp.apply_tenant_policy('"employee_loans"');
--> statement-breakpoint
SELECT erp.apply_tenant_policy('"employee_loan_lines"');

--> statement-breakpoint
-- ---------------------------------------------------------------------------
-- 8b. Purge path (the 0036/0037/0038/0042 discipline): every new tenant
-- table gains the erp_migrate DELETE/UPDATE policies confined to the
-- GUC-named tenant (payroll rows join the tenant offboarding
-- export→purge flow per DATA_PROTECTION §4).
--> statement-breakpoint
DO $$
DECLARE
  t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['employees', 'salary_structures', 'salary_components',
                            'payroll_runs', 'payroll_run_lines', 'employee_loans', 'employee_loan_lines']
  LOOP
    EXECUTE format('DROP POLICY IF EXISTS purge_path_delete ON public.%I', t);
    EXECUTE format('DROP POLICY IF EXISTS purge_path_update ON public.%I', t);
    EXECUTE format(
      'CREATE POLICY purge_path_delete ON public.%I FOR DELETE TO erp_migrate '
        || 'USING (tenant_id = erp.current_tenant_id())', t);
    EXECUTE format(
      'CREATE POLICY purge_path_update ON public.%I FOR UPDATE TO erp_migrate '
        || 'USING (tenant_id = erp.current_tenant_id()) WITH CHECK (true)', t);
  END LOOP;
END $$;

--> statement-breakpoint
-- ---------------------------------------------------------------------------
-- 8c. The payroll_run_lines guard (INV-003 — the 0037 depreciation_lines
-- discipline): UPDATE prohibited for everyone; DELETE admitted EXACTLY
-- for (a) the offboarding purge path (erp.purge_mode — migration-scope
-- connection only) and (b) lines of a run still DRAFT (a DRAFT
-- recalculation is not history yet; posted-run lines never leave).
--> statement-breakpoint
CREATE OR REPLACE FUNCTION erp.payroll_run_lines_guard() RETURNS trigger AS $$
BEGIN
  IF TG_OP = 'UPDATE' THEN
    RAISE EXCEPTION 'payroll_run_lines are append-only (INV-003): % prohibited', TG_OP;
  END IF;
  IF TG_OP = 'DELETE' THEN
    IF current_setting('erp.purge_mode', true) = 'on' THEN
      RETURN OLD; -- the offboarding purge path (migration-scope tooling only)
    END IF;
    IF EXISTS (SELECT 1 FROM payroll_runs r
               WHERE r.id = OLD.run_id AND r.status = 'DRAFT') THEN
      RETURN OLD; -- DRAFT recalculation reset; POSTED-run lines never leave
    END IF;
    RAISE EXCEPTION 'payroll_run_lines are append-only (INV-003): DELETE on a posted run''s lines is prohibited';
  END IF;
  RETURN OLD;
END
$$ LANGUAGE plpgsql;
--> statement-breakpoint
DROP TRIGGER IF EXISTS trg_payroll_run_lines_guard ON "payroll_run_lines";
--> statement-breakpoint
CREATE TRIGGER trg_payroll_run_lines_guard
  BEFORE UPDATE OR DELETE ON "payroll_run_lines"
  FOR EACH ROW EXECUTE FUNCTION erp.payroll_run_lines_guard();

--> statement-breakpoint
-- ---------------------------------------------------------------------------
-- 8d. Grants (per-table shapes):
--  - employees: SELECT/INSERT/UPDATE (status-lifecycled; NO DELETE —
--    TERMINATED rows are the EOS/audit history);
--  - salary_structures: SELECT/INSERT/UPDATE (NO DELETE — the version
--    chain is audited history);
--  - salary_components: SELECT/INSERT/UPDATE/DELETE (DELETE for the
--    unused-structure edit path; the service never touches components of
--    a used structure — BR-052 versioning instead);
--  - payroll_runs: SELECT/INSERT/UPDATE (NO DELETE);
--  - payroll_run_lines: SELECT/INSERT/DELETE (UPDATE NEVER — append-only;
--    DELETE policy-owned by the guard trigger above);
--  - employee_loans: SELECT/INSERT/UPDATE (NO DELETE);
--  - employee_loan_lines: SELECT/INSERT/UPDATE (NO DELETE — the schedule
--    is immutable after disbursement; lines transition, never leave).
--> statement-breakpoint
REVOKE ALL ON "employees", "salary_structures", "salary_components", "payroll_runs",
  "payroll_run_lines", "employee_loans", "employee_loan_lines" FROM erp_app;
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE ON "employees" TO erp_app;
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE ON "salary_structures" TO erp_app;
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON "salary_components" TO erp_app;
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE ON "payroll_runs" TO erp_app;
--> statement-breakpoint
GRANT SELECT, INSERT, DELETE ON "payroll_run_lines" TO erp_app;
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE ON "employee_loans" TO erp_app;
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE ON "employee_loan_lines" TO erp_app;
--> statement-breakpoint
GRANT SELECT ON "employees", "salary_structures", "salary_components", "payroll_runs",
  "payroll_run_lines", "employee_loans", "employee_loan_lines" TO erp_readonly;
--> statement-breakpoint
GRANT SELECT ON "employees", "salary_structures", "salary_components", "payroll_runs",
  "payroll_run_lines", "employee_loans", "employee_loan_lines" TO erp_definer;

--> statement-breakpoint
-- ---------------------------------------------------------------------------
-- 8e. CoA template (the 0038 pattern): the six payroll purposes gain
-- template accounts. CODE-COLLISION DISCIPLINE: 2170/2180/2190 free under
-- 2100 (2160 taken by 0038); 5270/5280/5295 free under 5200 (5210–5260
-- taken by the base template/0025/0038; 5290 = base VAT_EXPENSED — 5295
-- is the last round-ish slot in the 52xx children range). The onboarding
-- instantiation copies template rows + purposes into every provisioned
-- tenant, so fresh tenants resolve all six payroll purposes from day one
-- (58→64 accounts / 35→41 purposes); existing tenants map their own
-- accounts via account_purposes (fail-closed, PURPOSE_NOT_MAPPED).
--> statement-breakpoint
INSERT INTO "chart_of_accounts_template" ("code", "name", "name_ar", "type", "is_group", "parent_code", "purpose_key") VALUES
  ('2170', 'Salaries payable', 'رواتب مستحقة الدفع', 'LIABILITY', false, '2100', 'SALARIES_PAYABLE'),
  ('2180', 'Payroll deductions payable', 'استقطاعات رواتب مستحقة', 'LIABILITY', false, '2100', 'DEDUCTIONS_PAYABLE'),
  ('2190', 'End-of-service provision', 'مخصص نهاية الخدمة', 'LIABILITY', false, '2100', 'EOS_PROVISION'),
  ('5270', 'Salaries & wages expense', 'مصروف الرواتب والأجور', 'EXPENSE', false, '5200', 'SALARIES_EXPENSE'),
  ('5280', 'Employer contributions expense', 'مصروف مساهمات صاحب العمل', 'EXPENSE', false, '5200', 'EMPLOYER_CONTRIBUTIONS'),
  ('5295', 'End-of-service provision expense', 'مصروف مخصص نهاية الخدمة', 'EXPENSE', false, '5200', 'EOS_PROVISION_EXPENSE')
ON CONFLICT ("code") DO UPDATE
  SET "name" = EXCLUDED."name", "name_ar" = EXCLUDED."name_ar",
      "type" = EXCLUDED."type", "is_group" = EXCLUDED."is_group",
      "parent_code" = EXCLUDED."parent_code", "purpose_key" = EXCLUDED."purpose_key";

--> statement-breakpoint
-- ---------------------------------------------------------------------------
-- 8f. cash_movements source widening (ADDITIVE — the P27-G lesson): the
-- salary payout (G-30) and the loan disbursement movements join the
-- polymorphic source list; every existing kind re-declared verbatim.
--> statement-breakpoint
ALTER TABLE "cash_movements" DROP CONSTRAINT IF EXISTS ck_cash_movements_source_shape;
--> statement-breakpoint
ALTER TABLE "cash_movements" ADD CONSTRAINT ck_cash_movements_source_shape CHECK (
  "source_type" IN ('receipt', 'payment', 'cash_transfer', 'expense', 'shift_variance',
                    'sales_invoice', 'rep_settlement', 'note',
                    'payroll_payout', 'employee_loan')
);

--> statement-breakpoint
-- ---------------------------------------------------------------------------
-- 8g. Notification categories (the 0023/0027/0035/0042 widening pattern):
-- 'payroll' — BR-054 cap-clamp warnings, the BR-055 missing-EOS-policy
-- warning, run-approval surfacing.
--> statement-breakpoint
ALTER TABLE "notifications" DROP CONSTRAINT IF EXISTS ck_notifications_category_values;
--> statement-breakpoint
ALTER TABLE "notifications" ADD CONSTRAINT ck_notifications_category_values
  CHECK ("category" IN (
    'limits', 'subscription', 'reconciliation', 'invoice_overdue', 'stock', 'templates', 'crm',
    'einvoicing', 'notes', 'installments', 'budgeting', 'payroll'
  ));
--> statement-breakpoint
ALTER TABLE "notification_prefs" DROP CONSTRAINT IF EXISTS ck_notification_prefs_category_values;
--> statement-breakpoint
ALTER TABLE "notification_prefs" ADD CONSTRAINT ck_notification_prefs_category_values
  CHECK ("category" IN (
    'limits', 'subscription', 'reconciliation', 'invoice_overdue', 'stock', 'templates', 'crm',
    'einvoicing', 'notes', 'installments', 'budgeting', 'payroll'
  ));

--> statement-breakpoint
-- ---------------------------------------------------------------------------
-- 9. Plan grants (FEATURE_CATALOG §22 protocol step 3): the eight
-- PHASE-029 feature keys join business + enterprise (the tier-4
-- financial-depth precedent — fixed_assets 0037, notes/installments 0038,
-- budgeting 0042); starter does NOT get them. Idempotent array_cat.
--> statement-breakpoint
UPDATE "plans" SET "feature_keys" = array_cat("feature_keys",
  ARRAY['payroll.employees', 'payroll.salary_structures', 'payroll.runs',
        'payroll.approvals', 'payroll.loans', 'payroll.eos_provision',
        'payroll.cost_allocation', 'payroll.reports'])
WHERE "key" IN ('business', 'enterprise')
  AND NOT ('payroll.employees' = ANY("feature_keys"));

--> statement-breakpoint
RESET ROLE;

--> statement-breakpoint
-- Schema-state marker for /health/ready (mirrors the migration manifest).
INSERT INTO erp._schema_state (key, value) VALUES ('schema_version', 43)
ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, at = now();
