-- PHASE-007 · migration 0011 · journal tables (the ledger)
--
-- Purpose (PHASE-007 §2.4–§2.5, §2.13; TABLES/core-accounting.md):
-- - manual_journals + manual_journal_lines + journal_templates: the
--   user-facing draft documents (DRAFT → PENDING_APPROVAL → APPROVED →
--   POSTED / CANCELLED per DOCUMENT_LIFECYCLE §1). Posted rows are
--   immutable; the GL artifact itself is journal_entries (below).
-- - journal_entries + journal_lines: append-only 🔒 (INV-003). Grants give
--   erp_app SELECT/INSERT plus a COLUMN-LEVEL UPDATE limited to exactly
--   (status, reversed_by_id) — the only sanctioned mutation in the system
--   is the reversal link (INV-014) — and a BEFORE UPDATE/DELETE guard
--   trigger rejects every other shape including that pair's misuse.
--   Deferred constraint triggers double-check entry balance (INV-001/002)
--   and period openness (INV-011) at COMMIT.
-- - partner_subledger_entries: the partners-module-owned AR/AP subledger
--   rows (MODULE_BOUNDARIES write matrix) written in the posting
--   transaction (INV-009 from entry #1). Append-only grants + guard.
-- - reconciliation_runs: stored results of the reconciliation job
--   framework (RC-01..03, PC-04's lock gate reads them).
-- - opening_balance_docs: status CHECK widened DRAFT → DRAFT|POSTED (the
--   expand-migrate-contract step announced in migration 0009's header) +
--   posted journal linkage for BR-035's post-once rule.
--
-- Doc-reality reconciliation (completion report): the phase document's T2
-- names this file 0008_journal_tables.sql; 0007–0009 already exist.

--> statement-breakpoint
SET ROLE erp_migrate;

--> statement-breakpoint
-- Manual journal drafts (JOURNAL_RULES §1; DOCUMENT_LIFECYCLE §1): the
-- document a user composes; posting turns it into a journal_entries row via
-- the engine (source journal_entry) — never a direct GL write. Drafts are
-- editable/deletable before posting (audit-logged), hence the DELETE grant
-- here (the only lifecycle-DELETE in the accounting cluster, sanctioned by
-- JOURNAL_RULES §1.2 and confined to pre-POST states by the service).
CREATE TABLE IF NOT EXISTS "manual_journals" (
  "id" uuid NOT NULL,
  "tenant_id" uuid NOT NULL REFERENCES "tenants" ("id") ON DELETE RESTRICT,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "updated_at" timestamptz NOT NULL DEFAULT now(),
  "version" integer NOT NULL DEFAULT 1,
  "created_by" uuid,
  "status" text NOT NULL DEFAULT 'DRAFT',
  "entry_date" date NOT NULL,
  "currency_code" char(3) NOT NULL REFERENCES "currencies" ("code") ON DELETE RESTRICT,
  "exchange_rate" numeric(19,8),
  "rate_source" text NOT NULL DEFAULT 'TABLE',
  "description" text,
  "description_ar" text,
  "reference" text,
  "recurrence_id" uuid,
  "template_id" uuid,
  "posted_journal_id" uuid,
  "posted_at" timestamptz,
  "posted_by" uuid,
  "submitted_at" timestamptz,
  "submitted_by" uuid,
  "approved_at" timestamptz,
  "approved_by" uuid,
  "approval_step" integer NOT NULL DEFAULT 0,
  "cancelled_at" timestamptz,
  "cancelled_by" uuid,
  "cancel_reason" text,
  CONSTRAINT pk_manual_journals PRIMARY KEY ("id"),
  CONSTRAINT uq_manual_journals_id_tenant UNIQUE ("id", "tenant_id"),
  CONSTRAINT ck_manual_journals_status_values CHECK ("status" IN ('DRAFT', 'PENDING_APPROVAL', 'APPROVED', 'POSTED', 'CANCELLED')),
  CONSTRAINT ck_manual_journals_rate CHECK ("exchange_rate" IS NULL OR "exchange_rate" > 0),
  CONSTRAINT ck_manual_journals_rate_source CHECK ("rate_source" IN ('TABLE', 'MANUAL')),
  CONSTRAINT ck_manual_journals_posted_shape CHECK (
    ("status" = 'POSTED') = ("posted_journal_id" IS NOT NULL)
  ),
  CONSTRAINT ck_manual_journals_description_length CHECK ("description" IS NULL OR length("description") BETWEEN 1 AND 2000)
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS ix_manual_journals_tenant_status_date ON "manual_journals" ("tenant_id", "status", "entry_date");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS ix_manual_journals_tenant_recurrence ON "manual_journals" ("tenant_id", "recurrence_id");
--> statement-breakpoint
ALTER TABLE "manual_journals" DROP CONSTRAINT IF EXISTS fk_manual_journals_recurrence;
--> statement-breakpoint
ALTER TABLE "manual_journals" ADD CONSTRAINT fk_manual_journals_recurrence
  FOREIGN KEY ("recurrence_id", "tenant_id")
  REFERENCES "recurring_journals" ("id", "tenant_id") ON DELETE RESTRICT;

--> statement-breakpoint
-- Manual journal draft lines: account (leaf)/direction/positive amount +
-- optional dimensions + bilingual memo. Deleted with the draft (CASCADE —
-- draft cleanup only); once posted the GL lives in journal_lines.
CREATE TABLE IF NOT EXISTS "manual_journal_lines" (
  "id" uuid NOT NULL,
  "tenant_id" uuid NOT NULL REFERENCES "tenants" ("id") ON DELETE RESTRICT,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "updated_at" timestamptz NOT NULL DEFAULT now(),
  "version" integer NOT NULL DEFAULT 1,
  "manual_journal_id" uuid NOT NULL,
  "line_no" integer NOT NULL,
  "account_id" uuid NOT NULL,
  "direction" text NOT NULL,
  "amount" numeric(19,4) NOT NULL,
  "partner_id" uuid,
  "item_id" uuid,
  "cost_center_id" uuid,
  "tax_code_id" uuid,
  "memo" text,
  "memo_ar" text,
  CONSTRAINT pk_manual_journal_lines PRIMARY KEY ("id"),
  CONSTRAINT uq_manual_journal_lines_id_tenant UNIQUE ("id", "tenant_id"),
  CONSTRAINT uq_manual_journal_lines_entry_line UNIQUE ("manual_journal_id", "line_no"),
  CONSTRAINT fk_manual_journal_lines_entry FOREIGN KEY ("manual_journal_id", "tenant_id")
    REFERENCES "manual_journals" ("id", "tenant_id") ON DELETE CASCADE,
  CONSTRAINT fk_manual_journal_lines_account FOREIGN KEY ("account_id", "tenant_id")
    REFERENCES "accounts" ("id", "tenant_id") ON DELETE RESTRICT,
  CONSTRAINT fk_manual_journal_lines_partner FOREIGN KEY ("partner_id", "tenant_id")
    REFERENCES "partners" ("id", "tenant_id") ON DELETE RESTRICT,
  CONSTRAINT fk_manual_journal_lines_item FOREIGN KEY ("item_id", "tenant_id")
    REFERENCES "items" ("id", "tenant_id") ON DELETE RESTRICT,
  CONSTRAINT fk_manual_journal_lines_cost_center FOREIGN KEY ("cost_center_id", "tenant_id")
    REFERENCES "cost_centers" ("id", "tenant_id") ON DELETE RESTRICT,
  CONSTRAINT ck_manual_journal_lines_direction CHECK ("direction" IN ('DEBIT', 'CREDIT')),
  CONSTRAINT ck_manual_journal_lines_amount CHECK ("amount" > 0)
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS ix_manual_journal_lines_tenant_entry ON "manual_journal_lines" ("tenant_id", "manual_journal_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS ix_manual_journal_lines_tenant_account ON "manual_journal_lines" ("tenant_id", "account_id");

--> statement-breakpoint
-- Journal templates (JOURNAL_RULES §1.3): line structure without amounts;
-- documents, not postings.
CREATE TABLE IF NOT EXISTS "journal_templates" (
  "id" uuid NOT NULL,
  "tenant_id" uuid NOT NULL REFERENCES "tenants" ("id") ON DELETE RESTRICT,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "updated_at" timestamptz NOT NULL DEFAULT now(),
  "version" integer NOT NULL DEFAULT 1,
  "created_by" uuid,
  "name" text NOT NULL,
  "name_ar" text,
  "lines" jsonb NOT NULL,
  CONSTRAINT pk_journal_templates PRIMARY KEY ("id"),
  CONSTRAINT uq_journal_templates_id_tenant UNIQUE ("id", "tenant_id"),
  CONSTRAINT ck_journal_templates_name_length CHECK (length("name") BETWEEN 1 AND 200)
);

--> statement-breakpoint
-- journal_entries (TABLES §journal_entries; append-only 🔒): POSTED rows
-- only — the status vocabulary is POSTED|REVERSED (reversal flips the
-- ORIGINAL's status via the sanctioned column-level UPDATE; the counter
-- entry inserts as POSTED). uq_journal_entries_tenant_source_op is the
-- INV-013 idempotency key (partial: source_id set — manual entries always
-- carry their draft id so the key always binds for engine posts).
CREATE TABLE IF NOT EXISTS "journal_entries" (
  "id" uuid NOT NULL,
  "tenant_id" uuid NOT NULL REFERENCES "tenants" ("id") ON DELETE RESTRICT,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "updated_at" timestamptz NOT NULL DEFAULT now(),
  "version" integer NOT NULL DEFAULT 1,
  "entry_no" text,
  "entry_date" date NOT NULL,
  "fiscal_period_id" uuid NOT NULL,
  "currency_code" char(3) NOT NULL REFERENCES "currencies" ("code") ON DELETE RESTRICT,
  "exchange_rate" numeric(19,8) NOT NULL DEFAULT 1,
  "status" text NOT NULL DEFAULT 'POSTED',
  "source_type" text NOT NULL,
  "source_id" uuid,
  "operation" text NOT NULL,
  "reversal_of_id" uuid,
  "reversed_by_id" uuid,
  "description" text,
  "description_ar" text,
  "post_reason" text,
  "posted_at" timestamptz NOT NULL DEFAULT now(),
  "posted_by" uuid,
  CONSTRAINT pk_journal_entries PRIMARY KEY ("id"),
  CONSTRAINT uq_journal_entries_id_tenant UNIQUE ("id", "tenant_id"),
  CONSTRAINT ck_journal_entries_status_values CHECK ("status" IN ('POSTED', 'REVERSED')),
  CONSTRAINT ck_journal_entries_rate CHECK ("exchange_rate" > 0),
  CONSTRAINT ck_journal_entries_operation_shape CHECK ("operation" ~ '^[a-z_][a-z0-9_]{1,29}$'),
  CONSTRAINT ck_journal_entries_source_shape CHECK ("source_type" ~ '^[a-z_]{2,40}$'),
  CONSTRAINT ck_journal_entries_reversal_pair CHECK (
    NOT ("reversal_of_id" IS NOT NULL AND "reversed_by_id" IS NOT NULL)
  ),
  CONSTRAINT fk_journal_entries_period FOREIGN KEY ("fiscal_period_id", "tenant_id")
    REFERENCES "fiscal_periods" ("id", "tenant_id") ON DELETE RESTRICT
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS uq_journal_entries_tenant_source_op
  ON "journal_entries" ("tenant_id", "source_type", "source_id", "operation")
  WHERE "source_id" IS NOT NULL;
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS uq_journal_entries_tenant_entry_no
  ON "journal_entries" ("tenant_id", "entry_no") WHERE "entry_no" IS NOT NULL;
--> statement-breakpoint
ALTER TABLE "journal_entries" DROP CONSTRAINT IF EXISTS fk_journal_entries_reversal_of;
--> statement-breakpoint
ALTER TABLE "journal_entries" ADD CONSTRAINT fk_journal_entries_reversal_of
  FOREIGN KEY ("reversal_of_id", "tenant_id")
  REFERENCES "journal_entries" ("id", "tenant_id") ON DELETE RESTRICT;
--> statement-breakpoint
ALTER TABLE "journal_entries" DROP CONSTRAINT IF EXISTS fk_journal_entries_reversed_by;
--> statement-breakpoint
ALTER TABLE "journal_entries" ADD CONSTRAINT fk_journal_entries_reversed_by
  FOREIGN KEY ("reversed_by_id", "tenant_id")
  REFERENCES "journal_entries" ("id", "tenant_id") ON DELETE RESTRICT;
--> statement-breakpoint
-- Hot indexes (POSTING_ENGINE §6; CONSTRAINTS_AND_INDEXES §4).
CREATE INDEX IF NOT EXISTS ix_journal_entries_tenant_date ON "journal_entries" ("tenant_id", "entry_date");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS ix_journal_entries_tenant_period ON "journal_entries" ("tenant_id", "fiscal_period_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS ix_journal_entries_tenant_source ON "journal_entries" ("tenant_id", "source_type", "source_id");

--> statement-breakpoint
-- journal_lines (TABLES §journal_lines; append-only 🔒): positive magnitudes
-- with explicit direction; base_amount = amount × entry rate AS STORED
-- (INV-008 — never recomputed). tax_code_id is deliberately FK-less until
-- tax_codes (PHASE-009) — expand-migrate-contract, as items.tax_code_id.
CREATE TABLE IF NOT EXISTS "journal_lines" (
  "id" uuid NOT NULL,
  "tenant_id" uuid NOT NULL REFERENCES "tenants" ("id") ON DELETE RESTRICT,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "updated_at" timestamptz NOT NULL DEFAULT now(),
  "version" integer NOT NULL DEFAULT 1,
  "journal_entry_id" uuid NOT NULL,
  "line_no" integer NOT NULL,
  "account_id" uuid NOT NULL,
  "direction" text NOT NULL,
  "amount" numeric(19,4) NOT NULL,
  "base_amount" numeric(19,4) NOT NULL,
  "partner_id" uuid,
  "item_id" uuid,
  "cost_center_id" uuid,
  "tax_code_id" uuid,
  "memo" text,
  "memo_ar" text,
  CONSTRAINT pk_journal_lines PRIMARY KEY ("id"),
  CONSTRAINT uq_journal_lines_id_tenant UNIQUE ("id", "tenant_id"),
  CONSTRAINT uq_journal_lines_entry_line UNIQUE ("journal_entry_id", "line_no"),
  CONSTRAINT fk_journal_lines_entry FOREIGN KEY ("journal_entry_id", "tenant_id")
    REFERENCES "journal_entries" ("id", "tenant_id") ON DELETE CASCADE,
  CONSTRAINT fk_journal_lines_account FOREIGN KEY ("account_id", "tenant_id")
    REFERENCES "accounts" ("id", "tenant_id") ON DELETE RESTRICT,
  CONSTRAINT fk_journal_lines_partner FOREIGN KEY ("partner_id", "tenant_id")
    REFERENCES "partners" ("id", "tenant_id") ON DELETE RESTRICT,
  CONSTRAINT fk_journal_lines_item FOREIGN KEY ("item_id", "tenant_id")
    REFERENCES "items" ("id", "tenant_id") ON DELETE RESTRICT,
  CONSTRAINT fk_journal_lines_cost_center FOREIGN KEY ("cost_center_id", "tenant_id")
    REFERENCES "cost_centers" ("id", "tenant_id") ON DELETE RESTRICT,
  CONSTRAINT ck_journal_lines_direction CHECK ("direction" IN ('DEBIT', 'CREDIT')),
  CONSTRAINT ck_journal_lines_amount CHECK ("amount" > 0),
  CONSTRAINT ck_journal_lines_base_amount CHECK ("base_amount" > 0)
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS ix_journal_lines_tenant_entry ON "journal_lines" ("tenant_id", "journal_entry_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS ix_journal_lines_tenant_account ON "journal_lines" ("tenant_id", "account_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS ix_journal_lines_tenant_partner ON "journal_lines" ("tenant_id", "partner_id");

--> statement-breakpoint
-- manual_journals → posted entry linkage (added after journal_entries).
ALTER TABLE "manual_journals" DROP CONSTRAINT IF EXISTS fk_manual_journals_posted;
--> statement-breakpoint
ALTER TABLE "manual_journals" ADD CONSTRAINT fk_manual_journals_posted
  FOREIGN KEY ("posted_journal_id", "tenant_id")
  REFERENCES "journal_entries" ("id", "tenant_id") ON DELETE RESTRICT;
--> statement-breakpoint
ALTER TABLE "manual_journals" DROP CONSTRAINT IF EXISTS fk_manual_journals_template;
--> statement-breakpoint
ALTER TABLE "manual_journals" ADD CONSTRAINT fk_manual_journals_template
  FOREIGN KEY ("template_id", "tenant_id")
  REFERENCES "journal_templates" ("id", "tenant_id") ON DELETE SET NULL;

--> statement-breakpoint
-- Partner subledger entries (partners-module-owned; INV-009): one row per
-- journal line that hits a partner-carrying AR/AP control line, written in
-- the SAME transaction as the entry (module-owned subledger rows per the
-- MODULE_BOUNDARIES write matrix). Append-only.
CREATE TABLE IF NOT EXISTS "partner_subledger_entries" (
  "id" uuid NOT NULL,
  "tenant_id" uuid NOT NULL REFERENCES "tenants" ("id") ON DELETE RESTRICT,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "updated_at" timestamptz NOT NULL DEFAULT now(),
  "version" integer NOT NULL DEFAULT 1,
  "partner_id" uuid NOT NULL,
  "journal_entry_id" uuid NOT NULL,
  "journal_line_id" uuid NOT NULL,
  "entry_date" date NOT NULL,
  "direction" text NOT NULL,
  "amount" numeric(19,4) NOT NULL,
  "base_amount" numeric(19,4) NOT NULL,
  "currency_code" char(3) NOT NULL REFERENCES "currencies" ("code") ON DELETE RESTRICT,
  "source_type" text NOT NULL,
  "source_id" uuid,
  "memo" text,
  CONSTRAINT pk_partner_subledger_entries PRIMARY KEY ("id"),
  CONSTRAINT uq_partner_subledger_entries_id_tenant UNIQUE ("id", "tenant_id"),
  CONSTRAINT uq_partner_subledger_entries_line UNIQUE ("journal_line_id"),
  CONSTRAINT fk_partner_subledger_entries_partner FOREIGN KEY ("partner_id", "tenant_id")
    REFERENCES "partners" ("id", "tenant_id") ON DELETE RESTRICT,
  CONSTRAINT fk_partner_subledger_entries_entry FOREIGN KEY ("journal_entry_id", "tenant_id")
    REFERENCES "journal_entries" ("id", "tenant_id") ON DELETE RESTRICT,
  CONSTRAINT fk_partner_subledger_entries_line FOREIGN KEY ("journal_line_id", "tenant_id")
    REFERENCES "journal_lines" ("id", "tenant_id") ON DELETE RESTRICT,
  CONSTRAINT ck_partner_subledger_direction CHECK ("direction" IN ('DEBIT', 'CREDIT')),
  CONSTRAINT ck_partner_subledger_amounts CHECK ("amount" > 0 AND "base_amount" > 0)
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS ix_partner_subledger_tenant_partner ON "partner_subledger_entries" ("tenant_id", "partner_id", "entry_date");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS ix_partner_subledger_tenant_entry ON "partner_subledger_entries" ("tenant_id", "journal_entry_id");

--> statement-breakpoint
-- Reconciliation runs (RECONCILIATION §2–§3; RC-01..03; PC-04): stored
-- results per (kind, as-of) with the diff payload naming the offending
-- rows. A period LOCK is refused while a core check is BROKEN.
CREATE TABLE IF NOT EXISTS "reconciliation_runs" (
  "id" uuid NOT NULL,
  "tenant_id" uuid NOT NULL REFERENCES "tenants" ("id") ON DELETE RESTRICT,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "updated_at" timestamptz NOT NULL DEFAULT now(),
  "version" integer NOT NULL DEFAULT 1,
  "kind" text NOT NULL,
  "as_of" date NOT NULL,
  "fiscal_period_id" uuid,
  "status" text NOT NULL,
  "control_balance" numeric(19,4) NOT NULL,
  "subledger_balance" numeric(19,4) NOT NULL,
  "diff_count" integer NOT NULL DEFAULT 0,
  "diff" jsonb,
  "run_mode" text NOT NULL DEFAULT 'ON_DEMAND',
  "checked_by" uuid,
  CONSTRAINT pk_reconciliation_runs PRIMARY KEY ("id"),
  CONSTRAINT uq_reconciliation_runs_id_tenant UNIQUE ("id", "tenant_id"),
  CONSTRAINT fk_reconciliation_runs_period FOREIGN KEY ("fiscal_period_id", "tenant_id")
    REFERENCES "fiscal_periods" ("id", "tenant_id") ON DELETE RESTRICT,
  CONSTRAINT ck_reconciliation_runs_kind_values CHECK ("kind" IN ('AR', 'AP', 'CASH', 'VAT', 'INVENTORY', 'GRNI', 'WIP')),
  CONSTRAINT ck_reconciliation_runs_status_values CHECK ("status" IN ('OK', 'BROKEN')),
  CONSTRAINT ck_reconciliation_runs_mode_values CHECK ("run_mode" IN ('NIGHTLY', 'ON_DEMAND')),
  CONSTRAINT ck_reconciliation_runs_diff CHECK ("diff_count" >= 0)
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS ix_reconciliation_runs_tenant_kind_date ON "reconciliation_runs" ("tenant_id", "kind", "as_of" DESC);

--> statement-breakpoint
-- opening_balance_docs: widen the DRAFT-only CHECK (announced in 0009) and
-- add the posted linkage (BR-035 post-once). STOCK rows stay DRAFT until
-- PHASE-010 — enforced by the posting service, not the CHECK.
ALTER TABLE "opening_balance_docs" DROP CONSTRAINT IF EXISTS ck_obd_status_draft_only;
--> statement-breakpoint
ALTER TABLE "opening_balance_docs" ADD CONSTRAINT ck_opening_balance_docs_status_values
  CHECK ("status" IN ('DRAFT', 'POSTED'));
--> statement-breakpoint
ALTER TABLE "opening_balance_docs" ADD COLUMN IF NOT EXISTS "posted_journal_id" uuid;
--> statement-breakpoint
ALTER TABLE "opening_balance_docs" ADD COLUMN IF NOT EXISTS "posted_at" timestamptz;
--> statement-breakpoint
ALTER TABLE "opening_balance_docs" DROP CONSTRAINT IF EXISTS fk_opening_balance_docs_posted;
--> statement-breakpoint
ALTER TABLE "opening_balance_docs" ADD CONSTRAINT fk_opening_balance_docs_posted
  FOREIGN KEY ("posted_journal_id", "tenant_id")
  REFERENCES "journal_entries" ("id", "tenant_id") ON DELETE RESTRICT;

--> statement-breakpoint
-- Guard: journal_entries are immutable except the reversal link (INV-003 +
-- INV-014). UPDATE survives ONLY when old.status='POSTED', new.status=
-- 'REVERSED', reversed_by_id goes NULL→value and every other data column
-- is unchanged; DELETE never does. (updated_at/version are exempt from the
-- identity comparison — bookkeeping only.)
CREATE OR REPLACE FUNCTION erp.journal_entries_guard() RETURNS trigger AS $$
DECLARE
  data_equal boolean;
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'journal_entries are append-only (INV-003): DELETE prohibited';
  END IF;
  data_equal :=
    OLD."entry_no" IS NOT DISTINCT FROM NEW."entry_no" AND
    OLD."entry_date" IS NOT DISTINCT FROM NEW."entry_date" AND
    OLD."fiscal_period_id" IS NOT DISTINCT FROM NEW."fiscal_period_id" AND
    OLD."currency_code" IS NOT DISTINCT FROM NEW."currency_code" AND
    OLD."exchange_rate" IS NOT DISTINCT FROM NEW."exchange_rate" AND
    OLD."source_type" IS NOT DISTINCT FROM NEW."source_type" AND
    OLD."source_id" IS NOT DISTINCT FROM NEW."source_id" AND
    OLD."operation" IS NOT DISTINCT FROM NEW."operation" AND
    OLD."reversal_of_id" IS NOT DISTINCT FROM NEW."reversal_of_id" AND
    OLD."description" IS NOT DISTINCT FROM NEW."description" AND
    OLD."description_ar" IS NOT DISTINCT FROM NEW."description_ar" AND
    OLD."post_reason" IS NOT DISTINCT FROM NEW."post_reason" AND
    OLD."posted_at" IS NOT DISTINCT FROM NEW."posted_at" AND
    OLD."posted_by" IS NOT DISTINCT FROM NEW."posted_by";
  IF NOT (
    OLD."status" = 'POSTED' AND NEW."status" = 'REVERSED' AND
    OLD."reversed_by_id" IS NULL AND NEW."reversed_by_id" IS NOT NULL AND
    data_equal
  ) THEN
    RAISE EXCEPTION 'journal_entries are append-only (INV-003): only the reversal link (status→REVERSED, reversed_by_id) may change';
  END IF;
  RETURN NEW;
END
$$ LANGUAGE plpgsql;
--> statement-breakpoint
DROP TRIGGER IF EXISTS trg_journal_entries_guard ON "journal_entries";
--> statement-breakpoint
CREATE TRIGGER trg_journal_entries_guard
  BEFORE UPDATE OR DELETE ON "journal_entries"
  FOR EACH ROW EXECUTE FUNCTION erp.journal_entries_guard();

--> statement-breakpoint
-- Guard: journal_lines are strictly append-only (INV-003).
CREATE OR REPLACE FUNCTION erp.journal_lines_guard() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'journal_lines are append-only (INV-003): % prohibited', TG_OP;
END
$$ LANGUAGE plpgsql;
--> statement-breakpoint
DROP TRIGGER IF EXISTS trg_journal_lines_guard ON "journal_lines";
--> statement-breakpoint
CREATE TRIGGER trg_journal_lines_guard
  BEFORE UPDATE OR DELETE ON "journal_lines"
  FOR EACH ROW EXECUTE FUNCTION erp.journal_lines_guard();

--> statement-breakpoint
-- Guard: partner subledger rows are append-only (INV-009 integrity — the
-- reconciliation job detects drift; nothing may rewrite history).
CREATE OR REPLACE FUNCTION erp.partner_subledger_guard() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'partner_subledger_entries are append-only (INV-009): % prohibited', TG_OP;
END
$$ LANGUAGE plpgsql;
--> statement-breakpoint
DROP TRIGGER IF EXISTS trg_partner_subledger_guard ON "partner_subledger_entries";
--> statement-breakpoint
CREATE TRIGGER trg_partner_subledger_guard
  BEFORE UPDATE OR DELETE ON "partner_subledger_entries"
  FOR EACH ROW EXECUTE FUNCTION erp.partner_subledger_guard();

--> statement-breakpoint
-- Balance double-check (INV-001/002): at COMMIT every entry's lines must
-- have Σdebit = Σcredit in document AND base currency with 0 tolerance, ≥2
-- lines, ≥1 debit and ≥1 credit. Deferred so the engine's entry+lines
-- inserts inside one transaction are validated as a set.
CREATE OR REPLACE FUNCTION erp.journal_entry_balance_check() RETURNS trigger AS $$
DECLARE
  debit_sum numeric(19,4);
  credit_sum numeric(19,4);
  base_debit_sum numeric(19,4);
  base_credit_sum numeric(19,4);
  line_count integer;
  debit_count integer;
  credit_count integer;
BEGIN
  SELECT
    COALESCE(SUM(CASE WHEN "direction" = 'DEBIT' THEN "amount" ELSE 0 END), 0),
    COALESCE(SUM(CASE WHEN "direction" = 'CREDIT' THEN "amount" ELSE 0 END), 0),
    COALESCE(SUM(CASE WHEN "direction" = 'DEBIT' THEN "base_amount" ELSE 0 END), 0),
    COALESCE(SUM(CASE WHEN "direction" = 'CREDIT' THEN "base_amount" ELSE 0 END), 0),
    COUNT(*),
    COUNT(*) FILTER (WHERE "direction" = 'DEBIT'),
    COUNT(*) FILTER (WHERE "direction" = 'CREDIT')
  INTO debit_sum, credit_sum, base_debit_sum, base_credit_sum, line_count, debit_count, credit_count
  FROM "journal_lines"
  WHERE "journal_entry_id" = NEW."journal_entry_id" AND "tenant_id" = NEW."tenant_id";
  IF line_count < 2 OR debit_count < 1 OR credit_count < 1 THEN
    RAISE EXCEPTION 'ENTRY_NOT_BALANCED: entry needs >= 2 lines with >= 1 debit and >= 1 credit';
  END IF;
  IF debit_sum <> credit_sum OR base_debit_sum <> base_credit_sum THEN
    RAISE EXCEPTION 'ENTRY_NOT_BALANCED: debits % / credits % (base % / %)', debit_sum, credit_sum, base_debit_sum, base_credit_sum;
  END IF;
  RETURN NULL;
END
$$ LANGUAGE plpgsql;
--> statement-breakpoint
DROP TRIGGER IF EXISTS trg_journal_lines_balance_check ON "journal_lines";
--> statement-breakpoint
CREATE CONSTRAINT TRIGGER trg_journal_lines_balance_check
  AFTER INSERT ON "journal_lines"
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION erp.journal_entry_balance_check();

--> statement-breakpoint
-- Period-lock double-check (INV-011): at COMMIT the entry's fiscal period
-- must not be LOCKED (the engine validated earlier; this closes the direct
-- INSERT path).
CREATE OR REPLACE FUNCTION erp.journal_entry_period_check() RETURNS trigger AS $$
DECLARE
  period_status text;
BEGIN
  SELECT "status" INTO period_status
  FROM "fiscal_periods"
  WHERE "id" = NEW."fiscal_period_id" AND "tenant_id" = NEW."tenant_id";
  IF period_status IS DISTINCT FROM 'OPEN' AND period_status IS DISTINCT FROM 'SOFT_CLOSED' THEN
    RAISE EXCEPTION 'PERIOD_LOCKED: entry date falls in a % fiscal period', COALESCE(period_status, 'missing');
  END IF;
  RETURN NULL;
END
$$ LANGUAGE plpgsql;
--> statement-breakpoint
DROP TRIGGER IF EXISTS trg_journal_entries_period_check ON "journal_entries";
--> statement-breakpoint
CREATE CONSTRAINT TRIGGER trg_journal_entries_period_check
  AFTER INSERT ON "journal_entries"
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION erp.journal_entry_period_check();

--> statement-breakpoint
-- RLS (TENANT_ISOLATION §2): standard macro on the new tenant-owned tables.
SELECT erp.apply_tenant_policy('"manual_journals"');
--> statement-breakpoint
SELECT erp.apply_tenant_policy('"manual_journal_lines"');
--> statement-breakpoint
SELECT erp.apply_tenant_policy('"journal_templates"');
--> statement-breakpoint
SELECT erp.apply_tenant_policy('"journal_entries"');
--> statement-breakpoint
SELECT erp.apply_tenant_policy('"journal_lines"');
--> statement-breakpoint
SELECT erp.apply_tenant_policy('"partner_subledger_entries"');
--> statement-breakpoint
SELECT erp.apply_tenant_policy('"reconciliation_runs"');

--> statement-breakpoint
-- Grants. journal_entries: SELECT/INSERT + the column-scoped reversal
-- UPDATE (INV-014's sanctioned mutation — the guard trigger polices shape).
-- journal_lines + partner_subledger_entries: SELECT/INSERT only. Drafts
-- carry the JOURNAL_RULES §1.2 sanctioned DELETE (pre-POST cleanup).
REVOKE ALL ON "manual_journals", "manual_journal_lines", "journal_templates",
  "journal_entries", "journal_lines", "partner_subledger_entries",
  "reconciliation_runs" FROM erp_app;
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON "manual_journals" TO erp_app;
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON "manual_journal_lines" TO erp_app;
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE ON "journal_templates" TO erp_app;
--> statement-breakpoint
GRANT SELECT, INSERT ON "journal_entries" TO erp_app;
--> statement-breakpoint
GRANT UPDATE ("status", "reversed_by_id", "updated_at", "version") ON "journal_entries" TO erp_app;
--> statement-breakpoint
GRANT SELECT, INSERT ON "journal_lines" TO erp_app;
--> statement-breakpoint
GRANT SELECT, INSERT ON "partner_subledger_entries" TO erp_app;
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE ON "reconciliation_runs" TO erp_app;
--> statement-breakpoint
GRANT SELECT ON "manual_journals", "manual_journal_lines", "journal_templates",
  "journal_entries", "journal_lines", "partner_subledger_entries",
  "reconciliation_runs" TO erp_readonly;

--> statement-breakpoint
-- Definer read surface (support-access read-all proxy composition, as prior phases).
RESET ROLE;
--> statement-breakpoint
GRANT SELECT ON "manual_journals", "manual_journal_lines", "journal_templates",
  "journal_entries", "journal_lines", "partner_subledger_entries",
  "reconciliation_runs" TO erp_definer;
--> statement-breakpoint
SET ROLE erp_migrate;

--> statement-breakpoint
-- Schema-state marker for /health/ready (mirrors the migration manifest).
INSERT INTO erp._schema_state (key, value) VALUES ('schema_version', 11)
ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, at = now();

--> statement-breakpoint
RESET ROLE;
