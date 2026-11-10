-- PHASE-027 · migration 0038 · notes (cheques & promissory notes) + installments
--
-- Purpose (PHASE-027 §4 Design Impact + DR-003/ED-03): the notes and
-- installments modules land per the option-A decision — four tenant-owned
-- tables (the notes register with custody states, the append-only 🔒
-- note_events custody log, installment plans + lines), all RLS'd with
-- composite tenant FKs; note_events is append-only by grants + guard
-- trigger (INV-003 pattern — custody history cannot be rewritten; the
-- offboarding purge path admits DELETE only under erp.purge_mode, mirroring
-- the 0036/0037 discipline).
--
-- The v1.1 treasury.cheques deferral chain (008→012) TERMINATES here
-- (ED-03): cheques are delivered by the notes module; the feature key is
-- re-pointed in FEATURE_CATALOG (register §D). The receipts `method` value
-- stays a payment-method flag with no custody semantics (phase §7).
--
-- Open-item settle/restore (the critical mechanic, JOURNAL_RULES §7 G-26):
-- treasury_allocations gains a note_id owner (exactly-one-of-three CHECK).
-- A note's allocations are effective by presence; dishonor/return restores
-- the AR/AP open item EXACTLY by repointing (DELETE the note's rows, INSERT
-- one consolidated row anchored at the G-26/RETURN journal's control debit
-- entry — that entry is required on the line by INV-009(a) and is anchored
-- to outstanding 0, so the aging never double-counts: the ORIGINAL item
-- comes back with its original refs while partner_balances keeps tying.
--
-- CoA template (§10): the four v2.0 purpose keys (CHART_OF_ACCOUNTS §2)
-- gain template accounts — 1170 NOTES_RECEIVABLE, 2160 NOTES_PAYABLE,
-- 4920 LATE_FEE_INCOME, 5260 NOTES_DISCOUNT_EXPENSE — so provisioned
-- tenants resolve every notes/installments purpose from day one.
--
-- Permission seeds: the §3.12 set is already seeded (0004 carries
-- notes.notes.view|create|endorse|deposit|record_dishonor|discount +
-- installments.plans.view|manage + installments.lines.waive, with role
-- grants in 0005). This phase's doc sync completes the action key
-- notes.notes.return — seeded in 0004 (edited in-phase, the canonical
-- permission seed the drift checker reads) with the accountant grant in
-- 0005; matrix↔seed parity moves 244 → 245.
--
-- Plan grants (FEATURE_CATALOG §19/§25): the twelve PHASE-027 feature keys
-- (notes 7 + installments 5) join business + enterprise (the tier-4
-- financial-depth precedent); starter does NOT get them.
--
-- Seven §9 enums as CHECK constraints (DATA_DICTIONARY enum registry):
-- note_kind, note_direction, note_status, note_event_kind,
-- installment_frequency, installment_line_status, installment_plan_status
-- (§I register text verbatim; the plan status CHECK admits NULL — draft is
-- the absence of activation, the register lists the activated lifecycle
-- states only).
--
-- Widening (expand-compatible per MIGRATION_STRATEGY — the 0012 BANK_REC
-- pattern): reconciliation_runs.kind += 'NOTES' (RC-11); notifications +
-- notification_prefs category CHECKs += 'notes','installments' (the 0023
-- pattern). No destructive changes; no existing table loses a column.

--> statement-breakpoint
SET ROLE erp_migrate;

--> statement-breakpoint
-- ---------------------------------------------------------------------------
-- 1. notes (T2): the register. kind CHEQUE/PROMISSORY_NOTE × direction
-- RECEIVED/ISSUED; partner + maturity_date REQUIRED (BR-045 — a note
-- without partner and maturity can neither settle nor appear on the
-- calendar); the instrument's own number as data (ADR-0006 — no official
-- sequence fabricated); amount + currency + exchange_rate stored INV-008
-- (never recomputed); status note_status (IN_CUSTODY → … custody states);
-- source_type/source_id (origin invoice / supplier invoice, polymorphic —
-- service-validated own-tenant, never a fabricated FK); cash_account_id is
-- the treasury cash account for the money legs (stored at DEPOSIT, used by
-- G-25/G-27/discount/dishonor-fee); journal_entry_id is the G-24/G-27 entry.
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "notes" (
  "id" uuid NOT NULL,
  "tenant_id" uuid NOT NULL REFERENCES "tenants" ("id") ON DELETE RESTRICT,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "updated_at" timestamptz NOT NULL DEFAULT now(),
  "version" integer NOT NULL DEFAULT 1,
  "created_by" uuid,
  "kind" text NOT NULL,
  "direction" text NOT NULL,
  "partner_id" uuid NOT NULL,
  "number" text,
  "issuing_bank" text,
  "amount" numeric(19,4) NOT NULL,
  "currency" text NOT NULL,
  "exchange_rate" numeric(19,6) NOT NULL DEFAULT 1,
  "issue_date" date,
  "maturity_date" date NOT NULL,
  "status" text NOT NULL DEFAULT 'IN_CUSTODY',
  "source_type" text,
  "source_id" uuid,
  "cash_account_id" uuid,
  "journal_entry_id" uuid,
  "note" text,
  "note_ar" text,
  CONSTRAINT pk_notes PRIMARY KEY ("id"),
  CONSTRAINT uq_notes_id_tenant UNIQUE ("id", "tenant_id"),
  CONSTRAINT fk_notes_partner FOREIGN KEY ("partner_id", "tenant_id")
    REFERENCES "partners" ("id", "tenant_id") ON DELETE RESTRICT,
  CONSTRAINT fk_notes_cash_account FOREIGN KEY ("cash_account_id", "tenant_id")
    REFERENCES "cash_accounts" ("id", "tenant_id") ON DELETE RESTRICT,
  CONSTRAINT ck_notes_kind_values CHECK ("kind" IN ('CHEQUE', 'PROMISSORY_NOTE')),
  CONSTRAINT ck_notes_direction_values CHECK ("direction" IN ('RECEIVED', 'ISSUED')),
  CONSTRAINT ck_notes_status_values CHECK ("status" IN
    ('IN_CUSTODY', 'ENDORSED_OUT', 'DEPOSITED', 'COLLECTED', 'DISHONORED', 'DISCOUNTED', 'RETURNED')),
  CONSTRAINT ck_notes_source_shape CHECK (
    ("source_type" IS NULL) = ("source_id" IS NULL)
    AND ("source_type" IS NULL OR "source_type" IN ('sales_invoice', 'supplier_invoice'))),
  CONSTRAINT ck_notes_amount CHECK ("amount" > 0),
  CONSTRAINT ck_notes_rate CHECK ("exchange_rate" > 0),
  CONSTRAINT ck_notes_currency CHECK ("currency" ~ '^[A-Z]{3}$')
);
--> statement-breakpoint
-- Calendar/aging index (phase §6: (tenant, status, maturity_date)); listings
-- by direction+status; partner drill; source drill.
CREATE INDEX IF NOT EXISTS ix_notes_tenant_status_maturity
  ON "notes" ("tenant_id", "status", "maturity_date");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS ix_notes_tenant_direction_status
  ON "notes" ("tenant_id", "direction", "status");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS ix_notes_tenant_partner
  ON "notes" ("tenant_id", "partner_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS ix_notes_tenant_source
  ON "notes" ("tenant_id", "source_type", "source_id");
--> statement-breakpoint
COMMENT ON TABLE "notes" IS
  'PHASE-027 T2: the notes register — CHEQUE/PROMISSORY_NOTE × RECEIVED/ISSUED with partner + maturity_date required (BR-045), the instrument own number as data (ADR-0006), stored rate (INV-008), custody states (note_status §9), and the origin invoice reference. Money legs run through the treasury cash account (cash_account_id, stored at DEPOSIT); journal_entry_id is the G-24/G-27 entry. Cheques delivered here per ED-03 (the treasury.cheques chain terminates).';

--> statement-breakpoint
-- ---------------------------------------------------------------------------
-- 2. note_events 🔒 (T2): the append-only custody log — the audit substrate
-- of INV-024. event_kind note_event_kind §9; journal_entry_id is NULL for
-- the no-journal events (ENDORSE/DEPOSIT/RECLASSIFY — BR-047); refs jsonb
-- carries the event's references (e.g. the repointed allocation list on
-- dishonor/return); event_date is the ECONOMIC date (statements render by
-- it; the recording date is audited separately).
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "note_events" (
  "id" uuid NOT NULL,
  "tenant_id" uuid NOT NULL REFERENCES "tenants" ("id") ON DELETE RESTRICT,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "updated_at" timestamptz NOT NULL DEFAULT now(),
  "version" integer NOT NULL DEFAULT 1,
  "created_by" uuid,
  "note_id" uuid NOT NULL,
  "event_kind" text NOT NULL,
  "event_date" date NOT NULL,
  "refs" jsonb,
  "journal_entry_id" uuid,
  "memo" text,
  "memo_ar" text,
  CONSTRAINT pk_note_events PRIMARY KEY ("id"),
  CONSTRAINT uq_note_events_id_tenant UNIQUE ("id", "tenant_id"),
  CONSTRAINT fk_note_events_note FOREIGN KEY ("note_id", "tenant_id")
    REFERENCES "notes" ("id", "tenant_id") ON DELETE RESTRICT,
  CONSTRAINT ck_note_events_kind_values CHECK ("event_kind" IN
    ('ENDORSE', 'DEPOSIT', 'COLLECT', 'DISHONOR', 'DISCOUNT', 'RETURN', 'RECLASSIFY')),
  CONSTRAINT ck_note_events_journal_shape CHECK (
    ("event_kind" IN ('ENDORSE', 'DEPOSIT', 'RECLASSIFY')) = ("journal_entry_id" IS NULL))
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS ix_note_events_tenant_note
  ON "note_events" ("tenant_id", "note_id", "event_date");
--> statement-breakpoint
COMMENT ON TABLE "note_events" IS
  'PHASE-027 T2: append-only 🔒 custody log (INV-003 pattern). ENDORSE/DEPOSIT/RECLASSIFY carry no journal (BR-047 — ck_note_events_journal_shape enforces the shape); money events (COLLECT/DISHONOR/DISCOUNT/RETURN) carry their journal entry. UPDATE never; DELETE only under erp.purge_mode (guard trigger owns the policy). RECLASSIFY records audited metadata corrections with no journal and no custody change.';

--> statement-breakpoint
-- The guard (the depreciation_lines precedent — grants carry DELETE but the
-- TRIGGER owns the policy; erp_app can never rewrite custody history):
--> statement-breakpoint
CREATE OR REPLACE FUNCTION erp.note_events_guard() RETURNS trigger AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    IF COALESCE(current_setting('erp.purge_mode', true), '') = 'on' THEN
      RETURN OLD;
    END IF;
    RAISE EXCEPTION 'note_events is append-only (INV-003/INV-024) — DELETE is confined to the offboarding purge path'
      USING ERRCODE = '42501';
  END IF;
  RAISE EXCEPTION 'note_events rows are immutable (INV-003) — UPDATE is never allowed'
    USING ERRCODE = '42501';
END
$$ LANGUAGE plpgsql;
--> statement-breakpoint
DROP TRIGGER IF EXISTS trg_note_events_guard ON "note_events";
--> statement-breakpoint
CREATE TRIGGER trg_note_events_guard
  BEFORE UPDATE OR DELETE ON "note_events"
  FOR EACH ROW EXECUTE FUNCTION erp.note_events_guard();

--> statement-breakpoint
-- ---------------------------------------------------------------------------
-- 3. installment_plans (T8): a collection overlay over a credit sales
-- invoice (PHASE-012) or a service contract (PHASE-019 crm.service_contracts)
-- — the AR open item remains the invoice; no new AR open items are created.
-- status: NULL = draft (awaiting activation — the §9 enum lists the
-- activated lifecycle states only; activation is the BR-048 gate: plan
-- total must equal the source document total, else PLAN_TOTAL_MISMATCH);
-- after activation the schedule is immutable (409 SCHEDULE_IMMUTABLE).
-- late_fee_policy jsonb (BR-049): {rate, cap, grace_days, auto_charge,
-- defaulted_after_lines} — PLACEHOLDER defaults (OQ-002 family), never
-- silent; flat fees only (DR-003 riba stance — no interest computation, no
-- compounding anywhere).
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "installment_plans" (
  "id" uuid NOT NULL,
  "tenant_id" uuid NOT NULL REFERENCES "tenants" ("id") ON DELETE RESTRICT,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "updated_at" timestamptz NOT NULL DEFAULT now(),
  "version" integer NOT NULL DEFAULT 1,
  "created_by" uuid,
  "partner_id" uuid NOT NULL,
  "source_type" text NOT NULL,
  "source_id" uuid NOT NULL,
  "source_no" text,
  "total_amount" numeric(19,4) NOT NULL,
  "down_payment" numeric(19,4) NOT NULL DEFAULT 0,
  "line_count" integer NOT NULL,
  "start_date" date NOT NULL,
  "frequency" text NOT NULL,
  "late_fee_policy" jsonb NOT NULL,
  "status" text,
  "activated_at" timestamptz,
  "activated_by" uuid,
  "closed_at" timestamptz,
  "defaulted_at" timestamptz,
  "note" text,
  "note_ar" text,
  CONSTRAINT pk_installment_plans PRIMARY KEY ("id"),
  CONSTRAINT uq_installment_plans_id_tenant UNIQUE ("id", "tenant_id"),
  CONSTRAINT uq_installment_plans_tenant_source UNIQUE ("tenant_id", "source_type", "source_id"),
  CONSTRAINT fk_installment_plans_partner FOREIGN KEY ("partner_id", "tenant_id")
    REFERENCES "partners" ("id", "tenant_id") ON DELETE RESTRICT,
  CONSTRAINT ck_installment_plans_status_values CHECK ("status" IS NULL OR "status" IN
    ('ACTIVE', 'CLOSED', 'DEFAULTED')),
  CONSTRAINT ck_installment_plans_frequency_values CHECK ("frequency" IN
    ('WEEKLY', 'BIWEEKLY', 'MONTHLY', 'QUARTERLY')),
  CONSTRAINT ck_installment_plans_source_values CHECK ("source_type" IN
    ('sales_invoice', 'service_contract')),
  CONSTRAINT ck_installment_plans_amounts CHECK ("total_amount" > 0 AND "down_payment" >= 0
    AND "down_payment" < "total_amount"),
  CONSTRAINT ck_installment_plans_count CHECK ("line_count" >= 1),
  CONSTRAINT ck_installment_plans_activated_shape CHECK (
    ("status" IS NULL) = ("activated_at" IS NULL))
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS ix_installment_plans_tenant_partner
  ON "installment_plans" ("tenant_id", "partner_id", "status");
--> statement-breakpoint
COMMENT ON TABLE "installment_plans" IS
  'PHASE-027 T8: installment plans — a collection overlay over a credit invoice/service contract (BR-048: plan total = source total at activation; schedule immutable after). status NULL = draft (the activated states per §9: ACTIVE/CLOSED/DEFAULTD). late_fee_policy jsonb is per plan (rate/cap/grace_days/auto_charge/defaulted_after_lines — PLACEHOLDER defaults, OQ-002 family). Flat fees only (DR-003: no interest, no compounding).';

--> statement-breakpoint
-- ---------------------------------------------------------------------------
-- 4. installment_lines (T9/T10): one line per (plan, seq). status is
-- job-derived only (the daily sweep: PENDING → DUE at due_date, → OVERDUE
-- after grace, → PAID when covered by attributed collections; no manual
-- status writes exist) except WAIVED — the sole manual transition
-- (permission installments.lines.waive + reason + audit, sticky under the
-- sweep). receipt_refs jsonb accumulates the attributed receipt slices
-- {receiptId, receiptNo, amount, valueDate}; late_fee_* record the G-28
-- charge (INV-013: installment_line/late_fee once per line).
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "installment_lines" (
  "id" uuid NOT NULL,
  "tenant_id" uuid NOT NULL REFERENCES "tenants" ("id") ON DELETE RESTRICT,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "updated_at" timestamptz NOT NULL DEFAULT now(),
  "version" integer NOT NULL DEFAULT 1,
  "created_by" uuid,
  "plan_id" uuid NOT NULL,
  "seq" integer NOT NULL,
  "due_date" date NOT NULL,
  "amount" numeric(19,4) NOT NULL,
  "status" text NOT NULL DEFAULT 'PENDING',
  "receipt_refs" jsonb NOT NULL DEFAULT '[]'::jsonb,
  "collected_amount" numeric(19,4) NOT NULL DEFAULT 0,
  "waived_at" timestamptz,
  "waived_by" uuid,
  "waive_reason" text,
  "late_fee_amount" numeric(19,4),
  "late_fee_entry_id" uuid,
  "late_fee_charged_at" timestamptz,
  CONSTRAINT pk_installment_lines PRIMARY KEY ("id"),
  CONSTRAINT uq_installment_lines_id_tenant UNIQUE ("id", "tenant_id"),
  CONSTRAINT uq_installment_lines_plan_seq UNIQUE ("plan_id", "seq"),
  CONSTRAINT fk_installment_lines_plan FOREIGN KEY ("plan_id", "tenant_id")
    REFERENCES "installment_plans" ("id", "tenant_id") ON DELETE RESTRICT,
  CONSTRAINT ck_installment_lines_status_values CHECK ("status" IN
    ('PENDING', 'DUE', 'PAID', 'OVERDUE', 'WAIVED')),
  CONSTRAINT ck_installment_lines_amount CHECK ("amount" > 0),
  CONSTRAINT ck_installment_lines_seq CHECK ("seq" >= 1),
  CONSTRAINT ck_installment_lines_collected CHECK ("collected_amount" >= 0
    AND "collected_amount" <= "amount"),
  CONSTRAINT ck_installment_lines_waived_shape CHECK (
    ("status" = 'WAIVED') = ("waived_at" IS NOT NULL)),
  CONSTRAINT ck_installment_lines_late_fee_shape CHECK (
    ("late_fee_amount" IS NULL) = ("late_fee_entry_id" IS NULL))
);
--> statement-breakpoint
-- Aging/sweep index (phase §6: (tenant, plan, due_date)); the sweep scans
-- active plans by due date; reports read per plan.
CREATE INDEX IF NOT EXISTS ix_installment_lines_tenant_plan_due
  ON "installment_lines" ("tenant_id", "plan_id", "due_date");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS ix_installment_lines_tenant_status_due
  ON "installment_lines" ("tenant_id", "status", "due_date");
--> statement-breakpoint
COMMENT ON TABLE "installment_lines" IS
  'PHASE-027 T9/T10: plan lines — seq/due_date/amount immutable after activation (DELETE exists only for the DRAFT-plan edit path; the service never deletes an activated plan lines). status job-derived only (the daily sweep; no manual path exists) except WAIVED (sole manual transition: permission + reason + audit, sticky). receipt_refs jsonb = attributed receipt slices; late_fee_* = the G-28 charge (once per line, INV-013).';

--> statement-breakpoint
-- ---------------------------------------------------------------------------
-- 5. treasury_allocations widening (the settle/restore substrate — T3/T5):
-- ADD note_id (NULL before 0038; exactly-one-of-three after). A note's
-- allocations are effective by PRESENCE (the settled-sum read models add
-- the note branch with no status filter: rows only exist while the note
-- create posted atomically with its G-24/G-27 entry, and dishonor/return
-- repoints them — see §1 of the header). FK RESTRICT (notes are never
-- deleted; the offboarding purge deletes allocations first — FK order).
--> statement-breakpoint
ALTER TABLE "treasury_allocations" ADD COLUMN IF NOT EXISTS "note_id" uuid;
--> statement-breakpoint
ALTER TABLE "treasury_allocations" DROP CONSTRAINT IF EXISTS ck_treasury_allocations_exactly_one_doc;
--> statement-breakpoint
ALTER TABLE "treasury_allocations" ADD CONSTRAINT ck_treasury_allocations_exactly_one_doc CHECK (
  (("receipt_id" IS NOT NULL)::int + ("payment_id" IS NOT NULL)::int + ("note_id" IS NOT NULL)::int) = 1
);
--> statement-breakpoint
ALTER TABLE "treasury_allocations" DROP CONSTRAINT IF EXISTS fk_treasury_allocations_note;
--> statement-breakpoint
ALTER TABLE "treasury_allocations" ADD CONSTRAINT fk_treasury_allocations_note
  FOREIGN KEY ("note_id", "tenant_id")
  REFERENCES "notes" ("id", "tenant_id") ON DELETE RESTRICT;
--> statement-breakpoint
-- Per-document uniqueness via a partial index (NULLs are distinct in a plain
-- UNIQUE — the exactly-one-of-three CHECK needs one partial unique per doc
-- kind; the note partial mirrors the receipt/payment pair).
CREATE UNIQUE INDEX IF NOT EXISTS uq_treasury_allocations_note_item
  ON "treasury_allocations" ("tenant_id", "note_id", "open_item_id") WHERE "note_id" IS NOT NULL;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS ix_treasury_allocations_tenant_note
  ON "treasury_allocations" ("tenant_id", "note_id") WHERE "note_id" IS NOT NULL;

--> statement-breakpoint
-- 5b. cash_movements source widening (the money legs' provenance — P27-G
-- fix): the collection/discount/dishonor-fee movements carry source_type
-- 'note' through the treasury store API (cash_movements stays
-- treasury-owned). 0012's CHECK listed the PHASE-008 document kinds only;
-- without this widening every G-25/G-27/discount/fee movement violates
-- ck_cash_movements_source_shape and the whole note operation rolls back.
-- P27-G follow-up fix: the widening is ADDITIVE — the 0025 kinds
-- ('sales_invoice' the cash-invoice money leg, 'rep_settlement' the van
-- settlement float) must survive the re-declared CHECK. The first draft
-- redeclared 0012's list + 'note' only, so every cash invoice post (the
-- sales golden G-02) violated the constraint — found by re-running the
-- sales suite after the notes suites landed.
ALTER TABLE "cash_movements" DROP CONSTRAINT IF EXISTS ck_cash_movements_source_shape;
--> statement-breakpoint
ALTER TABLE "cash_movements" ADD CONSTRAINT ck_cash_movements_source_shape CHECK (
  "source_type" IN ('receipt', 'payment', 'cash_transfer', 'expense', 'shift_variance',
                    'sales_invoice', 'rep_settlement', 'note')
);

--> statement-breakpoint
-- ---------------------------------------------------------------------------
-- 6. RLS (TENANT_ISOLATION §2): the house macro on every new tenant-owned
-- table.
--> statement-breakpoint
SELECT erp.apply_tenant_policy('"notes"');
--> statement-breakpoint
SELECT erp.apply_tenant_policy('"note_events"');
--> statement-breakpoint
SELECT erp.apply_tenant_policy('"installment_plans"');
--> statement-breakpoint
SELECT erp.apply_tenant_policy('"installment_lines"');

--> statement-breakpoint
-- ---------------------------------------------------------------------------
-- 6b. Purge path (the 0036/0037 discipline): every new tenant table gains
-- the erp_migrate DELETE/UPDATE policies confined to the GUC-named tenant.
--> statement-breakpoint
DO $$
DECLARE
  t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['notes', 'note_events', 'installment_plans', 'installment_lines']
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
-- 7. Grants (per-table shapes):
--  - notes: INSERT/UPDATE/SELECT (create + status transitions + reclassify;
--    no DELETE — custody history is the events log);
--  - note_events: SELECT/INSERT/DELETE — append-only 🔒 with the guard
--    trigger owning the DELETE policy (UPDATE is grant-denied outright;
--    DELETE passes only under erp.purge_mode);
--  - installment_plans: INSERT/UPDATE/SELECT (draft edits + activation +
--    lifecycle flips; no DELETE);
--  - installment_lines: INSERT/UPDATE/SELECT/DELETE — DELETE exists for
--    the DRAFT-plan edit path (the wizard restructures a draft schedule;
--    the service confines deletes to draft plans and never deletes after
--    activation — the immutable-schedule discipline is service-level,
--    documented in the TABLES spec);
--> statement-breakpoint
REVOKE ALL ON "notes", "note_events", "installment_plans", "installment_lines" FROM erp_app;
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE ON "notes" TO erp_app;
--> statement-breakpoint
GRANT SELECT, INSERT, DELETE ON "note_events" TO erp_app;
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE ON "installment_plans" TO erp_app;
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON "installment_lines" TO erp_app;
--> statement-breakpoint
GRANT SELECT ON "notes", "note_events", "installment_plans", "installment_lines" TO erp_readonly;
--> statement-breakpoint
GRANT SELECT ON "notes", "note_events", "installment_plans", "installment_lines" TO erp_definer;

--> statement-breakpoint
-- ---------------------------------------------------------------------------
-- 8. CoA template (§10): the four v2.0 purpose keys gain template
-- accounts — 1170/2160/4920/5260 (CHART_OF_ACCOUNTS §2 v2.0 markers).
-- CODE-COLLISION DISCIPLINE (the 026 numeric-codes lesson, caught in-phase
-- by the tenancy-provisioning counters): the first draft used 1160/2150 —
-- ALREADY TAKEN by 0026 (1160 = WIP) and 0025 (2150 = COMMISSION_ACCRUAL);
-- the upsert would have HIJACKED the manufacturing WIP + automotive
-- commission-accrual template accounts. 1170/2160 verified free across the
-- whole chain. The onboarding instantiation copies template rows +
-- purposes into every provisioned tenant, so new tenants resolve every
-- notes/installments purpose from day one; existing tenants map their own
-- accounts via account_purposes (fail-closed, PURPOSE_NOT_MAPPED).
--> statement-breakpoint
INSERT INTO "chart_of_accounts_template" ("code", "name", "name_ar", "type", "is_group", "parent_code", "purpose_key") VALUES
  ('1170', 'Notes receivable', 'أوراق قبض', 'ASSET', false, '1100', 'NOTES_RECEIVABLE'),
  ('2160', 'Notes payable', 'أوراق دفع', 'LIABILITY', false, '2100', 'NOTES_PAYABLE'),
  ('4920', 'Late fee income', 'إيرادات رسوم التأخير', 'REVENUE', false, '4900', 'LATE_FEE_INCOME'),
  ('5260', 'Notes discount expense', 'مصاريف خصم الأوراق التجارية', 'EXPENSE', false, '5200', 'NOTES_DISCOUNT_EXPENSE')
ON CONFLICT ("code") DO UPDATE
  SET "name" = EXCLUDED."name", "name_ar" = EXCLUDED."name_ar",
      "type" = EXCLUDED."type", "is_group" = EXCLUDED."is_group",
      "parent_code" = EXCLUDED."parent_code", "purpose_key" = EXCLUDED."purpose_key";

--> statement-breakpoint
-- ---------------------------------------------------------------------------
-- 8b. RC-11 reconciliation kind (T12): the notes subledger check registers
-- into the PHASE-007 framework — widen the reconciliation_runs kind CHECK
-- with 'NOTES' (the 0012 BANK_REC / 0037 FIXED_ASSETS widening pattern; the
-- framework + PC-04 close block are consumed, never edited).
--> statement-breakpoint
ALTER TABLE "reconciliation_runs" DROP CONSTRAINT IF EXISTS ck_reconciliation_runs_kind_values;
--> statement-breakpoint
ALTER TABLE "reconciliation_runs" ADD CONSTRAINT ck_reconciliation_runs_kind_values
  CHECK ("kind" IN ('AR', 'AP', 'CASH', 'BANK_REC', 'VAT', 'INVENTORY', 'GRNI', 'WIP', 'FIXED_ASSETS', 'NOTES'));

--> statement-breakpoint
-- ---------------------------------------------------------------------------
-- 8c. Notification categories (the 0023/0027/0035 widening pattern): 'notes'
-- (dishonor surfacing — audited + partner notification, BR-046) and
-- 'installments' (DEFAULTED dunning + overdue surfacing, BR-049 family).
--> statement-breakpoint
ALTER TABLE "notifications" DROP CONSTRAINT IF EXISTS ck_notifications_category_values;
--> statement-breakpoint
ALTER TABLE "notifications" ADD CONSTRAINT ck_notifications_category_values
  CHECK ("category" IN (
    'limits', 'subscription', 'reconciliation', 'invoice_overdue', 'stock', 'templates', 'crm',
    'einvoicing', 'notes', 'installments'
  ));
--> statement-breakpoint
ALTER TABLE "notification_prefs" DROP CONSTRAINT IF EXISTS ck_notification_prefs_category_values;
--> statement-breakpoint
ALTER TABLE "notification_prefs" ADD CONSTRAINT ck_notification_prefs_category_values
  CHECK ("category" IN (
    'limits', 'subscription', 'reconciliation', 'invoice_overdue', 'stock', 'templates', 'crm',
    'einvoicing', 'notes', 'installments'
  ));

--> statement-breakpoint
-- ---------------------------------------------------------------------------
-- 9. Plan grants (FEATURE_CATALOG §19/§25 protocol step 3): the twelve
-- PHASE-027 feature keys join business + enterprise (the tier-4
-- financial-depth precedent — fixed_assets 0037); starter does NOT get
-- them. Idempotent array_cat. The v1.1 treasury.cheques key is re-pointed
-- by the doc sync (FEATURE_CATALOG §D note — delivered by the notes module).
--> statement-breakpoint
UPDATE "plans" SET "feature_keys" = array_cat("feature_keys",
  ARRAY['notes.received', 'notes.issued', 'notes.pdc_calendar', 'notes.endorsement',
        'notes.dishonor', 'notes.discounting', 'notes.reports',
        'installments.plans', 'installments.schedules', 'installments.collections',
        'installments.late_fees', 'installments.reports'])
WHERE "key" IN ('business', 'enterprise')
  AND NOT ('notes.received' = ANY("feature_keys"));

--> statement-breakpoint
RESET ROLE;

--> statement-breakpoint
-- Schema-state marker for /health/ready (mirrors the migration manifest).
INSERT INTO erp._schema_state (key, value) VALUES ('schema_version', 38)
ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, at = now();
