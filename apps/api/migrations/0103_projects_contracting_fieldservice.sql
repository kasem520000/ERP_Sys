-- PHASE-048 (Blueprint v3.0 · CR-18) · migration 0103 · Projects &
-- Contracting (part 4: the contracting core + field service + IAS 23 +
-- THE DATA-ONLY GRANTS, T-04 — the 0098 pattern; 0100–0102 stay
-- byte-stable).
--
--   subcontractor_agreements (D-08/T-10 — PR-06, the L2-20 home): value,
--     currency, retention % (BR-092 per contract — tenant DATA, never a
--     global constant), the period window, the DRAFT→ACTIVE→CLOSED/
--     CANCELLED lifecycle. Master data with DELETE granted (the typed
--     service guards own the lifecycle; the certificates' RESTRICT edge
--     protects the ones with history).
--   subcontractor_certificates (D-08 — the sub مستخلص): the cumulative
--     progress %, this period's gross / retention withheld / net payable
--     with the arithmetic floor (retention + net = gross), the DRAFT→
--     APPROVED/VOID lifecycle. Evidence discipline: NO delete. The AP
--     purchase linkage (the debit-note/PO chain) is W-11's engine — its
--     stamp columns land additively with that wave (the 0100 crm_time_
--     entries precedent), never guessed here.
--   retention_accounts (D-09/T-11 — PR-07/DF-08, G-55/G-56): ONE ledger
--     for BOTH sides — the CUSTOMER row per project (the customer
--     contract's commercial register: contract_value + currency + hold %
--     — the plan's eleven-table inventory ships no standalone contracts
--     table, so the customer-side retention account IS the contract's
--     financial spine; the subcontract side reads its terms from the
--     agreement, D-08's "the SAME retention ledger"), the release
--     schedule (taking-over + defect-liability dates — G-56's gates),
--     the accrued/released balances. Evidence discipline: NO delete.
--   progress_certificates (D-10/T-12 — PR-11/PR-08, G-57, the L2-15
--     home): PROGRESS/ADVANCE/FINAL, the cumulative completed %, this
--     certificate's gross/retention/net (the same arithmetic floor), the
--     currency snapshot (the contract currency — FX applies at posting
--     per the existing discipline), the DRAFT→SUBMITTED→APPROVED/VOID
--     approval link, and the generated-invoice stamp (sales_invoice_id —
--     the W-11 engine writes it in-transaction; BR-093's ceiling reads
--     the customer retention account's contract_value + the approved
--     change orders' deltas). Evidence discipline: NO delete.
--   service_visits (D-12/T-13 — PR-13/14/15, BR-096): ON THE EXISTING
--     service_orders (never a new order surface): the NEW→SCHEDULED→
--     DISPATCHED→IN_PROGRESS→COMPLETED→CLOSED machine, the technician,
--     the scheduled window, the transition stamps + the SLA response
--     event (the W-12 single-clock service's raw inputs — the pause
--     state rides the row, the pause history and the breach escalation
--     are the engine's), the completion notes (the parts-used record is
--     the service-order line issue path — no duplicate column, the
--     phase doc's own wording). Evidence discipline: NO delete (CLOSED
--     is the terminal state).
--   ias23_capitalizations (D-11 — R-04, the v3.2/CR-50 addition): the
--     scope tracking that RIDES the budget lines it capitalizes — the
--     qualifying window slice, the expenditures base, the capitalized/
--     expensed split (ADR-0009 money), the applied-rate snapshot (the
--     register's REQUIRES_VERIFICATION law enforced at the posting —
--     W-14's golden; NO rate ships here, red line 5). The rate register
--     itself is a TENANT SETTINGS registration (the plan D-02's "config
--     row" — the gosi_establishment_no no-default precedent; the code-
--     owned key lands in this same W-8 increment at settings-schema.ts —
--     NOT a table, the +11 count stands). Evidence discipline: NO
--     delete (the capitalization history is computation evidence).
--
--   §1 THE FOURTEEN PERMISSION KEYS (matrix §3.26; catalog 312 → 326):
--     projects.wbs.view / .manage · projects.budget.view / .manage ·
--     projects.allocation.manage · projects.change_order.view / .approve
--     · projects.contracting.view / .manage · projects.certificates.
--     approve · projects.retention.manage · projects.evm.view ·
--     projects.fieldservice.view / .dispatch — the phase doc's exact
--     list. Role grants (the 0098 precedent): the owner template holds
--     ALL FOURTEEN; the accountant holds the FIVE finance-read keys
--     (wbs/budget/change_order/contracting/evm VIEW — the finance side's
--     read plane over the projects substrate; the dispatch board's view
--     key stays owner-only — field-service operations are tenant-granted
--     beyond the baseline).
--   §2 THE PLAN GRANTS (the tier-4 precedent): business + enterprise
--     carry the THREE FEATURE FLAGS — projects.wbs · projects.contracting
--     · projects.fieldservice (the phase doc's composable units, the §3
--     schema's single-segment module.feature shape). The fourteen
--     permission keys are the AUTHORIZATION surface and ride ROLES (§1)
--     — never the plans (matrix §3.26's dated note records the
--     divergence, the 047 §3.25 precedent).
--   §3 THE MANIFEST ENABLEMENT (D-16 — CR-36f template-composable): the
--     three project-carrying templates — professional_services,
--     automotive, rental_logistics — compose the three flags by default
--     (the phase doc's instruction). THE COHERENT-CHANGE LAW: the
--     canonical templates.ts + THIS stored-registry update + the docs
--     mirrors move together in the same increment (W-8) — the guarded
--     one-field jsonb_set appends (the 0098 §3 procedure, zero
--     transcription risk).
--
-- Ledger-free by design at W-8 (G-55/G-56/G-57/G-58's postings land
-- W-11 through the engine with registered source keys; the canon rows
-- are W-15's).

--> statement-breakpoint
SET ROLE erp_migrate;

--> statement-breakpoint
-- ---------------------------------------------------------------------------
-- 1. subcontractor_agreements (the sub contract register).
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "subcontractor_agreements" (
  "id" uuid NOT NULL,
  "tenant_id" uuid NOT NULL REFERENCES "tenants" ("id") ON DELETE RESTRICT,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "updated_at" timestamptz NOT NULL DEFAULT now(),
  "version" integer NOT NULL DEFAULT 1,
  "created_by" uuid,
  "updated_by" uuid,
  "project_id" uuid NOT NULL,
  "partner_id" uuid NOT NULL,
  "agreement_no" text NOT NULL,
  "title" text NOT NULL,
  "title_ar" text,
  "scope" text,
  "agreement_value" numeric(19, 4) NOT NULL,
  "currency_code" text NOT NULL,
  "retention_percent" numeric(5, 2) NOT NULL,
  "start_date" date,
  "end_date" date,
  "status" text NOT NULL DEFAULT 'DRAFT',
  "activated_at" timestamptz,
  "closed_at" timestamptz,
  "cancel_reason" text,
  "note" text,
  "note_ar" text,
  CONSTRAINT pk_subcontractor_agreements PRIMARY KEY ("id"),
  CONSTRAINT uq_subcontractor_agreements_id_tenant UNIQUE ("id", "tenant_id"),
  CONSTRAINT uq_subcontractor_agreements_tenant_project_no
    UNIQUE ("tenant_id", "project_id", "agreement_no"),
  CONSTRAINT fk_subcontractor_agreements_project
    FOREIGN KEY ("project_id", "tenant_id")
    REFERENCES "projects" ("id", "tenant_id") ON DELETE RESTRICT,
  CONSTRAINT fk_subcontractor_agreements_partner
    FOREIGN KEY ("partner_id", "tenant_id")
    REFERENCES "partners" ("id", "tenant_id") ON DELETE RESTRICT,
  CONSTRAINT ck_subcontractor_agreements_status
    CHECK ("status" IN ('DRAFT', 'ACTIVE', 'CLOSED', 'CANCELLED')),
  CONSTRAINT ck_subcontractor_agreements_value
    CHECK ("agreement_value" > 0),
  CONSTRAINT ck_subcontractor_agreements_retention
    CHECK ("retention_percent" >= 0 AND "retention_percent" <= 100),
  CONSTRAINT ck_subcontractor_agreements_window
    CHECK ("end_date" IS NULL OR "start_date" IS NULL OR "end_date" >= "start_date"),
  CONSTRAINT ck_subcontractor_agreements_lifecycle
    CHECK (
      ("status" = 'ACTIVE' AND "activated_at" IS NOT NULL AND "closed_at" IS NULL
         AND "cancel_reason" IS NULL)
      OR ("status" = 'CLOSED' AND "activated_at" IS NOT NULL AND "closed_at" IS NOT NULL
           AND "cancel_reason" IS NULL)
      OR ("status" = 'CANCELLED' AND "cancel_reason" IS NOT NULL AND "closed_at" IS NULL)
      OR ("status" = 'DRAFT' AND "activated_at" IS NULL AND "closed_at" IS NULL
           AND "cancel_reason" IS NULL)
    )
);

--> statement-breakpoint
CREATE INDEX IF NOT EXISTS ix_subcontractor_agreements_tenant_project
  ON "subcontractor_agreements" ("tenant_id", "project_id", "status");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS ix_subcontractor_agreements_tenant_partner
  ON "subcontractor_agreements" ("tenant_id", "partner_id");

--> statement-breakpoint
-- ---------------------------------------------------------------------------
-- 2. subcontractor_certificates (the sub progress certificate).
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "subcontractor_certificates" (
  "id" uuid NOT NULL,
  "tenant_id" uuid NOT NULL REFERENCES "tenants" ("id") ON DELETE RESTRICT,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "updated_at" timestamptz NOT NULL DEFAULT now(),
  "version" integer NOT NULL DEFAULT 1,
  "created_by" uuid,
  "updated_by" uuid,
  "agreement_id" uuid NOT NULL,
  "certificate_no" text,
  "certificate_date" date NOT NULL,
  "progress_percent" numeric(5, 2) NOT NULL,
  "gross_value" numeric(19, 4) NOT NULL,
  "retention_withheld" numeric(19, 4) NOT NULL,
  "net_payable" numeric(19, 4) NOT NULL,
  "status" text NOT NULL DEFAULT 'DRAFT',
  "approved_at" timestamptz,
  "approved_by" uuid,
  "note" text,
  "note_ar" text,
  CONSTRAINT pk_subcontractor_certificates PRIMARY KEY ("id"),
  CONSTRAINT uq_subcontractor_certificates_id_tenant UNIQUE ("id", "tenant_id"),
  CONSTRAINT uq_subcontractor_certificates_tenant_no
    UNIQUE ("tenant_id", "agreement_id", "certificate_no"),
  CONSTRAINT fk_subcontractor_certificates_agreement
    FOREIGN KEY ("agreement_id", "tenant_id")
    REFERENCES "subcontractor_agreements" ("id", "tenant_id") ON DELETE RESTRICT,
  CONSTRAINT ck_subcontractor_certificates_status
    CHECK ("status" IN ('DRAFT', 'APPROVED', 'VOID')),
  CONSTRAINT ck_subcontractor_certificates_progress
    CHECK ("progress_percent" >= 0 AND "progress_percent" <= 100),
  CONSTRAINT ck_subcontractor_certificates_amounts
    CHECK ("gross_value" >= 0 AND "retention_withheld" >= 0 AND "net_payable" >= 0
           AND ("retention_withheld" + "net_payable" = "gross_value")),
  CONSTRAINT ck_subcontractor_certificates_approval
    CHECK (("status" = 'APPROVED') = ("approved_at" IS NOT NULL))
);

--> statement-breakpoint
CREATE INDEX IF NOT EXISTS ix_subcontractor_certificates_tenant_agreement
  ON "subcontractor_certificates" ("tenant_id", "agreement_id", "certificate_date");

--> statement-breakpoint
-- ---------------------------------------------------------------------------
-- 3. retention_accounts (the one ledger, both sides — G-55/G-56).
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "retention_accounts" (
  "id" uuid NOT NULL,
  "tenant_id" uuid NOT NULL REFERENCES "tenants" ("id") ON DELETE RESTRICT,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "updated_at" timestamptz NOT NULL DEFAULT now(),
  "version" integer NOT NULL DEFAULT 1,
  "created_by" uuid,
  "updated_by" uuid,
  "project_id" uuid NOT NULL,
  "kind" text NOT NULL,
  "subcontractor_agreement_id" uuid,
  "contract_value" numeric(19, 4),
  "currency_code" text,
  "hold_percent" numeric(5, 2),
  "accrued_balance" numeric(19, 4) NOT NULL DEFAULT 0,
  "released_amount" numeric(19, 4) NOT NULL DEFAULT 0,
  "taking_over_date" date,
  "defect_liability_date" date,
  "status" text NOT NULL DEFAULT 'ACTIVE',
  "released_at" timestamptz,
  "note" text,
  "note_ar" text,
  CONSTRAINT pk_retention_accounts PRIMARY KEY ("id"),
  CONSTRAINT uq_retention_accounts_id_tenant UNIQUE ("id", "tenant_id"),
  CONSTRAINT fk_retention_accounts_project
    FOREIGN KEY ("project_id", "tenant_id")
    REFERENCES "projects" ("id", "tenant_id") ON DELETE RESTRICT,
  CONSTRAINT fk_retention_accounts_agreement
    FOREIGN KEY ("subcontractor_agreement_id", "tenant_id")
    REFERENCES "subcontractor_agreements" ("id", "tenant_id") ON DELETE RESTRICT,
  CONSTRAINT ck_retention_accounts_kind
    CHECK ("kind" IN ('CUSTOMER', 'SUBCONTRACTOR')),
  -- The side law: the CUSTOMER row IS the customer contract's commercial
  -- register (value + currency + hold % — BR-092's tenant DATA per
  -- contract); the SUBCONTRACTOR row reads its terms from the agreement
  -- (D-08 — the commercial columns stay NULL there, one source of truth).
  CONSTRAINT ck_retention_accounts_side_shape
    CHECK (
      ("kind" = 'CUSTOMER' AND "subcontractor_agreement_id" IS NULL
         AND "contract_value" IS NOT NULL AND "contract_value" > 0
         AND "currency_code" IS NOT NULL AND "hold_percent" IS NOT NULL)
      OR ("kind" = 'SUBCONTRACTOR' AND "subcontractor_agreement_id" IS NOT NULL
           AND "contract_value" IS NULL AND "currency_code" IS NULL
           AND "hold_percent" IS NULL)
    ),
  CONSTRAINT ck_retention_accounts_hold
    CHECK ("hold_percent" IS NULL OR ("hold_percent" >= 0 AND "hold_percent" <= 100)),
  CONSTRAINT ck_retention_accounts_balances
    CHECK ("accrued_balance" >= 0 AND "released_amount" >= 0),
  CONSTRAINT ck_retention_accounts_status
    CHECK ("status" IN ('ACTIVE', 'RELEASED')),
  CONSTRAINT ck_retention_accounts_release
    CHECK (("status" = 'RELEASED') = ("released_at" IS NOT NULL))
);

--> statement-breakpoint
-- ONE customer account per project; ONE subcontract account per
-- agreement (the partial-unique law).
CREATE UNIQUE INDEX IF NOT EXISTS uq_retention_accounts_tenant_project_customer
  ON "retention_accounts" ("tenant_id", "project_id")
  WHERE "kind" = 'CUSTOMER';
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS uq_retention_accounts_tenant_agreement_sub
  ON "retention_accounts" ("tenant_id", "subcontractor_agreement_id")
  WHERE "kind" = 'SUBCONTRACTOR';
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS ix_retention_accounts_tenant_project
  ON "retention_accounts" ("tenant_id", "project_id", "kind");

--> statement-breakpoint
-- ---------------------------------------------------------------------------
-- 4. progress_certificates (the customer billing event — G-57).
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "progress_certificates" (
  "id" uuid NOT NULL,
  "tenant_id" uuid NOT NULL REFERENCES "tenants" ("id") ON DELETE RESTRICT,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "updated_at" timestamptz NOT NULL DEFAULT now(),
  "version" integer NOT NULL DEFAULT 1,
  "created_by" uuid,
  "updated_by" uuid,
  "project_id" uuid NOT NULL,
  "certificate_no" text,
  "certificate_date" date NOT NULL,
  "kind" text NOT NULL,
  "cumulative_percent" numeric(5, 2) NOT NULL,
  "gross_value" numeric(19, 4) NOT NULL,
  "retention_amount" numeric(19, 4) NOT NULL,
  "net_value" numeric(19, 4) NOT NULL,
  "currency_code" text NOT NULL,
  "status" text NOT NULL DEFAULT 'DRAFT',
  "submitted_at" timestamptz,
  "submitted_by" uuid,
  "approved_at" timestamptz,
  "approved_by" uuid,
  "voided_at" timestamptz,
  "void_reason" text,
  "sales_invoice_id" uuid,
  "note" text,
  "note_ar" text,
  CONSTRAINT pk_progress_certificates PRIMARY KEY ("id"),
  CONSTRAINT uq_progress_certificates_id_tenant UNIQUE ("id", "tenant_id"),
  CONSTRAINT uq_progress_certificates_tenant_no
    UNIQUE ("tenant_id", "project_id", "certificate_no"),
  CONSTRAINT fk_progress_certificates_project
    FOREIGN KEY ("project_id", "tenant_id")
    REFERENCES "projects" ("id", "tenant_id") ON DELETE RESTRICT,
  CONSTRAINT fk_progress_certificates_invoice
    FOREIGN KEY ("sales_invoice_id", "tenant_id")
    REFERENCES "sales_invoices" ("id", "tenant_id") ON DELETE RESTRICT,
  CONSTRAINT ck_progress_certificates_kind
    CHECK ("kind" IN ('PROGRESS', 'ADVANCE', 'FINAL')),
  CONSTRAINT ck_progress_certificates_percent
    CHECK ("cumulative_percent" >= 0 AND "cumulative_percent" <= 100),
  CONSTRAINT ck_progress_certificates_amounts
    CHECK ("gross_value" >= 0 AND "retention_amount" >= 0 AND "net_value" >= 0
           AND ("retention_amount" + "net_value" = "gross_value")),
  CONSTRAINT ck_progress_certificates_status
    CHECK ("status" IN ('DRAFT', 'SUBMITTED', 'APPROVED', 'VOID')),
  CONSTRAINT ck_progress_certificates_approval_link
    CHECK (
      ("status" = 'APPROVED' AND "approved_at" IS NOT NULL AND "approved_by" IS NOT NULL
         AND "voided_at" IS NULL AND "void_reason" IS NULL)
      OR ("status" = 'VOID' AND "voided_at" IS NOT NULL AND "void_reason" IS NOT NULL
           AND "approved_at" IS NULL AND "approved_by" IS NULL)
      OR ("status" IN ('DRAFT', 'SUBMITTED') AND "approved_at" IS NULL
           AND "approved_by" IS NULL AND "voided_at" IS NULL AND "void_reason" IS NULL)
    ),
  -- The invoice stamp exists only on the approved path (the W-11 engine
  -- writes it in-transaction at generation).
  CONSTRAINT ck_progress_certificates_invoice_gated
    CHECK ("sales_invoice_id" IS NULL OR "status" = 'APPROVED'),
  CONSTRAINT ck_progress_certificates_submission
    CHECK ("status" = 'DRAFT' OR "submitted_at" IS NOT NULL)
);

--> statement-breakpoint
CREATE INDEX IF NOT EXISTS ix_progress_certificates_tenant_project
  ON "progress_certificates" ("tenant_id", "project_id", "certificate_date");
--> statement-breakpoint
-- The ceiling check's read path (W-11: the cumulative approved gross).
CREATE INDEX IF NOT EXISTS ix_progress_certificates_tenant_ceiling
  ON "progress_certificates" ("tenant_id", "project_id")
  WHERE "status" = 'APPROVED';

--> statement-breakpoint
-- ---------------------------------------------------------------------------
-- 5. service_visits (the dispatch board's row — on service_orders).
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "service_visits" (
  "id" uuid NOT NULL,
  "tenant_id" uuid NOT NULL REFERENCES "tenants" ("id") ON DELETE RESTRICT,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "updated_at" timestamptz NOT NULL DEFAULT now(),
  "version" integer NOT NULL DEFAULT 1,
  "created_by" uuid,
  "updated_by" uuid,
  "service_order_id" uuid NOT NULL,
  "technician_employee_id" uuid,
  "scheduled_start" timestamptz NOT NULL,
  "scheduled_end" timestamptz NOT NULL,
  "status" text NOT NULL DEFAULT 'NEW',
  "dispatched_at" timestamptz,
  "first_responded_at" timestamptz,
  "started_at" timestamptz,
  "completed_at" timestamptz,
  "closed_at" timestamptz,
  "is_paused" boolean NOT NULL DEFAULT false,
  "completion_notes" text,
  "completion_notes_ar" text,
  "note" text,
  "note_ar" text,
  CONSTRAINT pk_service_visits PRIMARY KEY ("id"),
  CONSTRAINT uq_service_visits_id_tenant UNIQUE ("id", "tenant_id"),
  CONSTRAINT fk_service_visits_service_order
    FOREIGN KEY ("service_order_id", "tenant_id")
    REFERENCES "service_orders" ("id", "tenant_id") ON DELETE RESTRICT,
  CONSTRAINT fk_service_visits_technician
    FOREIGN KEY ("technician_employee_id", "tenant_id")
    REFERENCES "employees" ("id", "tenant_id") ON DELETE RESTRICT,
  CONSTRAINT ck_service_visits_status
    CHECK ("status" IN ('NEW', 'SCHEDULED', 'DISPATCHED', 'IN_PROGRESS', 'COMPLETED', 'CLOSED')),
  CONSTRAINT ck_service_visits_window
    CHECK ("scheduled_end" > "scheduled_start"),
  -- The machine's stamp law: exactly the stamps of the passed states
  -- (the D-12 status machine — one row per visit, the transitions are
  -- CAS writes with these floors).
  CONSTRAINT ck_service_visits_stamps
    CHECK (
      ("status" = 'NEW' AND "dispatched_at" IS NULL AND "started_at" IS NULL
         AND "completed_at" IS NULL AND "closed_at" IS NULL)
      OR ("status" = 'SCHEDULED' AND "dispatched_at" IS NULL AND "started_at" IS NULL
           AND "completed_at" IS NULL AND "closed_at" IS NULL)
      OR ("status" = 'DISPATCHED' AND "dispatched_at" IS NOT NULL AND "started_at" IS NULL
           AND "completed_at" IS NULL AND "closed_at" IS NULL)
      OR ("status" = 'IN_PROGRESS' AND "dispatched_at" IS NOT NULL AND "started_at" IS NOT NULL
           AND "completed_at" IS NULL AND "closed_at" IS NULL)
      OR ("status" = 'COMPLETED' AND "dispatched_at" IS NOT NULL AND "started_at" IS NOT NULL
           AND "completed_at" IS NOT NULL AND "closed_at" IS NULL)
      OR ("status" = 'CLOSED' AND "dispatched_at" IS NOT NULL AND "started_at" IS NOT NULL
           AND "completed_at" IS NOT NULL AND "closed_at" IS NOT NULL)
    ),
  -- A paused clock exists only on the in-progress plane (the W-12 single
  -- clock service's state — NEW/SCHEDULED/COMPLETED/CLOSED never pause).
  CONSTRAINT ck_service_visits_pause_gated
    CHECK ("is_paused" = false OR "status" = 'IN_PROGRESS'),
  -- The technician is required from DISPATCHED on (the board's law).
  CONSTRAINT ck_service_visits_technician_gated
    CHECK ("status" IN ('NEW', 'SCHEDULED') OR "technician_employee_id" IS NOT NULL)
);

--> statement-breakpoint
CREATE INDEX IF NOT EXISTS ix_service_visits_tenant_order
  ON "service_visits" ("tenant_id", "service_order_id", "status");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS ix_service_visits_tenant_technician
  ON "service_visits" ("tenant_id", "technician_employee_id", "scheduled_start")
  WHERE "technician_employee_id" IS NOT NULL;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS ix_service_visits_tenant_window
  ON "service_visits" ("tenant_id", "scheduled_start", "scheduled_end");

--> statement-breakpoint
-- ---------------------------------------------------------------------------
-- 6. ias23_capitalizations (the borrowing-costs scope tracking — R-04).
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "ias23_capitalizations" (
  "id" uuid NOT NULL,
  "tenant_id" uuid NOT NULL REFERENCES "tenants" ("id") ON DELETE RESTRICT,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "updated_at" timestamptz NOT NULL DEFAULT now(),
  "version" integer NOT NULL DEFAULT 1,
  "created_by" uuid,
  "updated_by" uuid,
  "project_id" uuid NOT NULL,
  "budget_line_id" uuid NOT NULL,
  "window_start" date NOT NULL,
  "window_end" date NOT NULL,
  "expenditures_amount" numeric(19, 4) NOT NULL,
  "capitalized_amount" numeric(19, 4) NOT NULL,
  "expensed_amount" numeric(19, 4) NOT NULL,
  "rate_snapshot" numeric(9, 6) NOT NULL,
  "status" text NOT NULL DEFAULT 'DRAFT',
  "posted_at" timestamptz,
  "note" text,
  "note_ar" text,
  CONSTRAINT pk_ias23_capitalizations PRIMARY KEY ("id"),
  CONSTRAINT uq_ias23_capitalizations_id_tenant UNIQUE ("id", "tenant_id"),
  CONSTRAINT uq_ias23_capitalizations_line_window
    UNIQUE ("tenant_id", "budget_line_id", "window_start"),
  CONSTRAINT fk_ias23_capitalizations_project
    FOREIGN KEY ("project_id", "tenant_id")
    REFERENCES "projects" ("id", "tenant_id") ON DELETE RESTRICT,
  CONSTRAINT fk_ias23_capitalizations_budget_line
    FOREIGN KEY ("budget_line_id", "tenant_id")
    REFERENCES "project_budget_lines" ("id", "tenant_id") ON DELETE RESTRICT,
  CONSTRAINT ck_ias23_capitalizations_window
    CHECK ("window_end" >= "window_start"),
  CONSTRAINT ck_ias23_capitalizations_amounts
    CHECK ("expenditures_amount" >= 0 AND "capitalized_amount" >= 0
           AND "expensed_amount" >= 0
           AND ("capitalized_amount" + "expensed_amount" <= "expenditures_amount")),
  CONSTRAINT ck_ias23_capitalizations_rate
    CHECK ("rate_snapshot" >= 0 AND "rate_snapshot" <= 1),
  CONSTRAINT ck_ias23_capitalizations_status
    CHECK ("status" IN ('DRAFT', 'POSTED')),
  CONSTRAINT ck_ias23_capitalizations_posting
    CHECK (("status" = 'POSTED') = ("posted_at" IS NOT NULL))
);

--> statement-breakpoint
CREATE INDEX IF NOT EXISTS ix_ias23_capitalizations_tenant_project
  ON "ias23_capitalizations" ("tenant_id", "project_id", "window_start");

--> statement-breakpoint
-- ---------------------------------------------------------------------------
-- 7. RLS (the A1–A10 law) + the purge path.
--> statement-breakpoint
ALTER TABLE "subcontractor_agreements" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "subcontractor_agreements" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
SELECT erp.apply_tenant_policy('"subcontractor_agreements"');
--> statement-breakpoint
ALTER TABLE "subcontractor_certificates" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "subcontractor_certificates" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
SELECT erp.apply_tenant_policy('"subcontractor_certificates"');
--> statement-breakpoint
ALTER TABLE "retention_accounts" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "retention_accounts" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
SELECT erp.apply_tenant_policy('"retention_accounts"');
--> statement-breakpoint
ALTER TABLE "progress_certificates" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "progress_certificates" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
SELECT erp.apply_tenant_policy('"progress_certificates"');
--> statement-breakpoint
ALTER TABLE "service_visits" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "service_visits" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
SELECT erp.apply_tenant_policy('"service_visits"');
--> statement-breakpoint
ALTER TABLE "ias23_capitalizations" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "ias23_capitalizations" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
SELECT erp.apply_tenant_policy('"ias23_capitalizations"');
--> statement-breakpoint
DO $$
DECLARE
  t text;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'subcontractor_agreements', 'subcontractor_certificates',
    'retention_accounts', 'progress_certificates',
    'service_visits', 'ias23_capitalizations'
  ] LOOP
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
-- 8. Grants — master data vs the evidence discipline.
--> statement-breakpoint
REVOKE ALL ON "subcontractor_agreements" FROM erp_app;
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON "subcontractor_agreements" TO erp_app;
--> statement-breakpoint
GRANT SELECT ON "subcontractor_agreements" TO erp_readonly;
--> statement-breakpoint
GRANT SELECT ON "subcontractor_agreements" TO erp_definer;
--> statement-breakpoint
REVOKE ALL ON "subcontractor_certificates" FROM erp_app;
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE ON "subcontractor_certificates" TO erp_app;
--> statement-breakpoint
GRANT SELECT ON "subcontractor_certificates" TO erp_readonly;
--> statement-breakpoint
GRANT SELECT ON "subcontractor_certificates" TO erp_definer;
--> statement-breakpoint
REVOKE ALL ON "retention_accounts" FROM erp_app;
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE ON "retention_accounts" TO erp_app;
--> statement-breakpoint
GRANT SELECT ON "retention_accounts" TO erp_readonly;
--> statement-breakpoint
GRANT SELECT ON "retention_accounts" TO erp_definer;
--> statement-breakpoint
REVOKE ALL ON "progress_certificates" FROM erp_app;
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE ON "progress_certificates" TO erp_app;
--> statement-breakpoint
GRANT SELECT ON "progress_certificates" TO erp_readonly;
--> statement-breakpoint
GRANT SELECT ON "progress_certificates" TO erp_definer;
--> statement-breakpoint
REVOKE ALL ON "service_visits" FROM erp_app;
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE ON "service_visits" TO erp_app;
--> statement-breakpoint
GRANT SELECT ON "service_visits" TO erp_readonly;
--> statement-breakpoint
GRANT SELECT ON "service_visits" TO erp_definer;
--> statement-breakpoint
REVOKE ALL ON "ias23_capitalizations" FROM erp_app;
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE ON "ias23_capitalizations" TO erp_app;
--> statement-breakpoint
GRANT SELECT ON "ias23_capitalizations" TO erp_readonly;
--> statement-breakpoint
GRANT SELECT ON "ias23_capitalizations" TO erp_definer;

--> statement-breakpoint
-- ---------------------------------------------------------------------------
-- 9. THE DATA-ONLY GRANTS BLOCK (the 0098 pattern) — §1 the fourteen
--    permission keys + the role grants.
--> statement-breakpoint
INSERT INTO "permissions" ("key", "module", "description") VALUES
('projects.wbs.view', 'projects', 'View WBS trees, milestones, dependencies and progress / عرض هيكل عمل المشروع والمعالم والتبعيات ونسب الإنجاز'),
('projects.wbs.manage', 'projects', 'Manage WBS tasks and dependencies (cycle-safe moves) / إدارة مهام هيكل العمل والتبعيات (نقل آمن من الحلقات)'),
('projects.budget.view', 'projects', 'View project budgets and the vs-actual rollups / عرض موازنات المشاريع والمقارنات بالفعلي'),
('projects.budget.manage', 'projects', 'Manage budgets and the cost curve / إدارة الموازنات ومنحنى التكلفة'),
('projects.allocation.manage', 'projects', 'Manage employee and asset allocations / إدارة تخصيص الموظفين والأصول'),
('projects.change_order.view', 'projects', 'View change orders / عرض أوامر التغيير'),
('projects.change_order.approve', 'projects', 'Approve change orders (the G-58 gate) / اعتماد أوامر التغيير (بوابة G-58)'),
('projects.contracting.view', 'projects', 'View subcontracts, certificates and retention / عرض عقود الباطن والمستخلصات والاحتجاز'),
('projects.contracting.manage', 'projects', 'Manage subcontracts and certificates / إدارة عقود الباطن والمستخلصات'),
('projects.certificates.approve', 'projects', 'Approve progress certificates / اعتماد مستخلصات الإنجاز'),
('projects.retention.manage', 'projects', 'Manage retention accounts and releases / إدارة حسابات الاحتجاز والصرف'),
('projects.evm.view', 'projects', 'View EVM analysis and forecasts / عرض تحليل القيمة المكتسبة والتوقعات'),
('projects.fieldservice.view', 'projects', 'View the field-service dispatch board / عرض لوحة الخدمة الميدانية'),
('projects.fieldservice.dispatch', 'projects', 'Dispatch technicians and manage visits / إرسال الفنيين وإدارة الزيارات')
ON CONFLICT ("key") DO UPDATE
  SET "module" = EXCLUDED."module", "description" = EXCLUDED."description";
--> statement-breakpoint
INSERT INTO "role_permissions" ("role_id", "tenant_id", "permission_id")
SELECT r."id", NULL, p."key"
FROM "roles" r JOIN "permissions" p ON p."key" IN (
  'projects.wbs.view', 'projects.wbs.manage',
  'projects.budget.view', 'projects.budget.manage',
  'projects.allocation.manage',
  'projects.change_order.view', 'projects.change_order.approve',
  'projects.contracting.view', 'projects.contracting.manage',
  'projects.certificates.approve',
  'projects.retention.manage',
  'projects.evm.view',
  'projects.fieldservice.view', 'projects.fieldservice.dispatch'
)
WHERE r."key" = 'owner' AND r."tenant_id" IS NULL
ON CONFLICT ("role_id", "permission_id") DO NOTHING;
--> statement-breakpoint
-- The accountant's finance-read plane (the five VIEW keys; the dispatch
-- board stays owner-only — field-service operations are tenant-granted).
INSERT INTO "role_permissions" ("role_id", "tenant_id", "permission_id")
SELECT r."id", NULL, p."key"
FROM "roles" r JOIN "permissions" p ON p."key" IN (
  'projects.wbs.view', 'projects.budget.view', 'projects.change_order.view',
  'projects.contracting.view', 'projects.evm.view'
)
WHERE r."key" = 'accountant' AND r."tenant_id" IS NULL
ON CONFLICT ("role_id", "permission_id") DO NOTHING;

--> statement-breakpoint
-- ---------------------------------------------------------------------------
-- 10. §2 THE PLAN GRANTS — the three feature flags on business +
--     enterprise (the tier-4 precedent; the permission keys ride roles).
--> statement-breakpoint
UPDATE "plans" SET "feature_keys" = array_cat("feature_keys", ARRAY[
  'projects.wbs', 'projects.contracting', 'projects.fieldservice'
])
WHERE "key" IN ('business', 'enterprise')
  AND NOT ('projects.wbs' = ANY("feature_keys"));

--> statement-breakpoint
-- ---------------------------------------------------------------------------
-- 11. §3 THE MANIFEST ENABLEMENT (D-16) — the three project-carrying
--     templates compose the three flags by default (guarded surgical
--     jsonb_set appends; the canonical templates.ts + the docs mirrors
--     move in the same W-8 increment — the coherent-change law).
--> statement-breakpoint
UPDATE "industry_templates"
SET "manifest" = jsonb_set(
  "manifest", '{required_feature_keys}',
  "manifest"->'required_feature_keys' || $projects$[
    "projects.wbs", "projects.contracting", "projects.fieldservice"
  ]$projects$::jsonb
)
WHERE "key" = 'industry.professional_services'
  AND NOT ("manifest"->'required_feature_keys' ? 'projects.wbs');
--> statement-breakpoint
UPDATE "industry_templates"
SET "manifest" = jsonb_set(
  "manifest", '{required_feature_keys}',
  "manifest"->'required_feature_keys' || $projects$[
    "projects.wbs", "projects.contracting", "projects.fieldservice"
  ]$projects$::jsonb
)
WHERE "key" = 'industry.automotive'
  AND NOT ("manifest"->'required_feature_keys' ? 'projects.wbs');
--> statement-breakpoint
UPDATE "industry_templates"
SET "manifest" = jsonb_set(
  "manifest", '{required_feature_keys}',
  "manifest"->'required_feature_keys' || $projects$[
    "projects.wbs", "projects.contracting", "projects.fieldservice"
  ]$projects$::jsonb
)
WHERE "key" = 'industry.rental_logistics'
  AND NOT ("manifest"->'required_feature_keys' ? 'projects.wbs');

--> statement-breakpoint
RESET ROLE;

--> statement-breakpoint
-- Schema-state marker for /health/ready (mirrors the migration manifest).
INSERT INTO erp._schema_state (key, value) VALUES ('schema_version', 103)
ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, at = now();
