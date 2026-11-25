-- PHASE-051 (Blueprint v3.0 · CR-21 — Foreign Trade & Logistics) ·
-- migration 0119 · THE LC/COLLECTIONS CLUSTER (T-01, the approved
-- master plan's D-02 slot 1: letters_of_credit — the G-64 margin/
-- retirement anchor + the status ladder · lc_amendments — the dated
-- typed value/validity/document changes · lc_documents — the
-- checklist: doc type, presented/verified, the discrepancy notes
-- (BR-105's own anchor) · documentary_collections — D/P + D/A terms,
-- the documents set, status, the settlement linkage).
--
--   §1 letters_of_credit (L-01, D-05): the LC register — currency and
--     amount, the issuing bank, the beneficiary/applicant pair, the PO
--     link (the acceptance #8 chain's own anchor), the validity pair
--     (issued_at + expiry_date — the BR-105 sweep's anchor), and THE
--     G-64 STAMPS: margin_amount with the margin_journal_entry_id
--     single-use stamp (the deposit at issuance) and the retirement
--     pair settled_at + retirement_journal_entry_id (the reversal at
--     settlement) — the postings themselves are W-34's service wave
--     through the REAL engine (INV-013 single-use on (lc, issue) /
--     (lc, retirement) / (lc_amendment, id), INV-018 ONE ambient
--     transaction, fail-closed PURPOSE_NOT_MAPPED until the tenant
--     maps LC_MARGIN_DEPOSIT — 0122 §5d's marker). Evidence
--     discipline: S/I/U, NO DELETE (the LC register is the trade-
--     finance audit trail).
--   §2 lc_amendments (L-01, D-05): the dated typed changes — each
--     amendment row carries EXACTLY ONE typed dimension (VALUE the
--     from/to pair · VALIDITY the expiry from/to pair · DOCUMENTS the
--     documents note · OTHER free), the typed-change law at the floor
--     (an amendment must change something); an amendment that changes
--     the margin adjusts through the same G-64 pair on its own
--     single-use key (W-34's act, the D-05 law). uq per (tenant, lc,
--     amendment_no). Evidence: S/I/U, NO DELETE.
--   §3 lc_documents (L-01, BR-105): the documents checklist — one row
--     per (tenant, lc, doc type): presented/verified with their own
--     stamps and the discrepancy notes (the 30/14/7/1 sweep's
--     discrepancy arm reads them — the W-34 `trade-expiry-sweep`, the
--     0111 pattern). The floor: a stamp exists only on its own
--     state (presented ⇒ presented_at; verified ⇒ presented AND
--     verified_at — an unpresented document is never verified).
--     Evidence: S/I/U, NO DELETE.
--   §4 documentary_collections (L-02, D-21): the D/P + D/A register —
--     the terms type, the documents set (jsonb array), the amount +
--     currency riding the EXISTING FX discipline, the PO link, the
--     status ladder with the stamp law, and the settlement linkage
--     (settled_at + settlement_ref on the settled paths). The D/A
--     usance floor: a documents-against-acceptance collection carries
--     its due date. Evidence: S/I/U, NO DELETE.
--
--   THE DECLARED INTERPRETATION (the plan's own open door, recorded at
--     the claim site): the LC FEES ride the EXISTING financial-charges
--     discipline (D-05/D-21 — zero new machinery, zero new identifier:
--     a letter-of-credit fee is a financial charge like any bank
--     charge; no journal surface is created here for fees).
--
--   THE D-02 DISCLOSURE (the standing law — this provision's final
--     expected fingerprint, announced in its own wave's envelope):
--     the chain 118 → 119 · ENTITY_CATALOG 340 → 344 (this
--     migration's +4) → 354 at 0122 (the four slots' +14 together) ·
--     the permissions drift 347 unchanged here (the +10 keys are
--     0122's data page) · ROUTE_PERMISSIONS 1,159 unchanged
--     (keys-seed-first, the 0116 §1 precedent — zero routes before
--     the W-34+ service waves).
--
--   Ledger-free by design (D-05 is W-34's service wave; G-64 posts
--     through the REAL engine with registered source keys — the canon
--     rows are W-42's; this migration creates the stamps, never a
--     posting surface).

--> statement-breakpoint
SET ROLE erp_migrate;

--> statement-breakpoint
-- ---------------------------------------------------------------------------
-- 1. letters_of_credit (L-01, D-05 — the G-64 anchor + the ladder).
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "letters_of_credit" (
  "id" uuid NOT NULL,
  "tenant_id" uuid NOT NULL REFERENCES "tenants" ("id") ON DELETE RESTRICT,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "updated_at" timestamptz NOT NULL DEFAULT now(),
  "version" integer NOT NULL DEFAULT 1,
  "created_by" uuid,
  "updated_by" uuid,
  "lc_no" text NOT NULL,
  "purchase_order_id" uuid,
  "currency" varchar(3) NOT NULL,
  "amount" numeric(19, 4) NOT NULL,
  "margin_amount" numeric(19, 4) NOT NULL DEFAULT 0,
  "issuing_bank" text NOT NULL,
  "beneficiary_name" text NOT NULL,
  "applicant_name" text NOT NULL,
  "issued_at" timestamptz NOT NULL DEFAULT now(),
  "expiry_date" date NOT NULL,
  "status" text NOT NULL DEFAULT 'DRAFT',
  "margin_journal_entry_id" uuid,
  "settled_at" timestamptz,
  "retirement_journal_entry_id" uuid,
  "note" text,
  "note_ar" text,
  CONSTRAINT pk_letters_of_credit PRIMARY KEY ("id"),
  CONSTRAINT uq_letters_of_credit_id_tenant UNIQUE ("id", "tenant_id"),
  CONSTRAINT uq_letters_of_credit_tenant_no UNIQUE ("tenant_id", "lc_no"),
  CONSTRAINT fk_letters_of_credit_po
    FOREIGN KEY ("purchase_order_id", "tenant_id")
    REFERENCES "purchase_orders" ("id", "tenant_id") ON DELETE RESTRICT,
  CONSTRAINT fk_letters_of_credit_margin_journal
    FOREIGN KEY ("margin_journal_entry_id", "tenant_id")
    REFERENCES "journal_entries" ("id", "tenant_id") ON DELETE RESTRICT,
  CONSTRAINT fk_letters_of_credit_retirement_journal
    FOREIGN KEY ("retirement_journal_entry_id", "tenant_id")
    REFERENCES "journal_entries" ("id", "tenant_id") ON DELETE RESTRICT,
  CONSTRAINT ck_letters_of_credit_status
    CHECK ("status" IN ('DRAFT', 'ISSUED', 'RETIRED', 'EXPIRED', 'CANCELLED')),
  CONSTRAINT ck_letters_of_credit_amounts
    CHECK ("amount" > 0 AND "margin_amount" >= 0),
  CONSTRAINT ck_letters_of_credit_validity
    CHECK ("expiry_date" >= "issued_at"::date),
  -- THE G-64 STAMP FLOORS: the margin deposit posts at issuance (the
  -- stamp exists only past DRAFT, and only on a real margin — zero
  -- margin, no entry); the retirement pair exists ONLY on the RETIRED
  -- path and TOGETHER (INV-013's (lc, issue)/(lc, retirement)
  -- single-use keys are W-34's engine arms; the floor keeps the
  -- stamps honest: never a settled row without its entry, never an
  -- entry on a live row).
  CONSTRAINT ck_letters_of_credit_margin_shape
    CHECK (
      ("margin_journal_entry_id" IS NULL)
      OR ("margin_amount" > 0 AND "status" NOT IN ('DRAFT', 'CANCELLED'))
    ),
  CONSTRAINT ck_letters_of_credit_retirement_shape
    CHECK (
      ("status" = 'RETIRED' AND "settled_at" IS NOT NULL
         AND "retirement_journal_entry_id" IS NOT NULL)
      OR ("status" <> 'RETIRED' AND "settled_at" IS NULL
           AND "retirement_journal_entry_id" IS NULL)
    )
);

--> statement-breakpoint
CREATE INDEX IF NOT EXISTS ix_letters_of_credit_tenant_status
  ON "letters_of_credit" ("tenant_id", "status", "expiry_date");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS ix_letters_of_credit_tenant_po
  ON "letters_of_credit" ("tenant_id", "purchase_order_id")
  WHERE "purchase_order_id" IS NOT NULL;

--> statement-breakpoint
-- ---------------------------------------------------------------------------
-- 2. lc_amendments (L-01 — the dated typed changes; each amendment one
--    typed dimension, the typed-change law at the floor).
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "lc_amendments" (
  "id" uuid NOT NULL,
  "tenant_id" uuid NOT NULL REFERENCES "tenants" ("id") ON DELETE RESTRICT,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "updated_at" timestamptz NOT NULL DEFAULT now(),
  "version" integer NOT NULL DEFAULT 1,
  "created_by" uuid,
  "updated_by" uuid,
  "lc_id" uuid NOT NULL,
  "amendment_no" integer NOT NULL,
  "change_type" text NOT NULL,
  "value_from" numeric(19, 4),
  "value_to" numeric(19, 4),
  "expiry_from" date,
  "expiry_to" date,
  "documents_note" text,
  "summary" text,
  "effective_at" timestamptz NOT NULL DEFAULT now(),
  "note" text,
  "note_ar" text,
  CONSTRAINT pk_lc_amendments PRIMARY KEY ("id"),
  CONSTRAINT uq_lc_amendments_id_tenant UNIQUE ("id", "tenant_id"),
  CONSTRAINT uq_lc_amendments_tenant_lc_no UNIQUE ("tenant_id", "lc_id", "amendment_no"),
  CONSTRAINT fk_lc_amendments_lc
    FOREIGN KEY ("lc_id", "tenant_id")
    REFERENCES "letters_of_credit" ("id", "tenant_id") ON DELETE RESTRICT,
  CONSTRAINT ck_lc_amendments_type
    CHECK ("change_type" IN ('VALUE', 'VALIDITY', 'DOCUMENTS', 'OTHER')),
  CONSTRAINT ck_lc_amendments_amendment_no
    CHECK ("amendment_no" > 0),
  -- THE TYPED-CHANGE LAW: a VALUE amendment carries its from/to pair,
  -- a VALIDITY amendment its expiry pair, a DOCUMENTS amendment its
  -- note — an amendment must change something (an OTHER amendment
  -- carries its summary; the typed floors below keep the register
  -- honest, the W-34 lifecycle service owns the transitions).
  CONSTRAINT ck_lc_amendments_typed_value
    CHECK (
      ("change_type" = 'VALUE')
        = ("value_from" IS NOT NULL AND "value_to" IS NOT NULL)
    ),
  CONSTRAINT ck_lc_amendments_typed_validity
    CHECK (
      ("change_type" = 'VALIDITY')
        = ("expiry_from" IS NOT NULL AND "expiry_to" IS NOT NULL)
    ),
  CONSTRAINT ck_lc_amendments_typed_documents
    CHECK (
      ("change_type" = 'DOCUMENTS') = ("documents_note" IS NOT NULL)
    ),
  CONSTRAINT ck_lc_amendments_other_summary
    CHECK ("change_type" <> 'OTHER' OR "summary" IS NOT NULL),
  CONSTRAINT ck_lc_amendments_amounts
    CHECK (
      ("value_from" IS NULL OR "value_from" > 0)
      AND ("value_to" IS NULL OR "value_to" > 0)
    )
);

--> statement-breakpoint
CREATE INDEX IF NOT EXISTS ix_lc_amendments_tenant_lc
  ON "lc_amendments" ("tenant_id", "lc_id", "amendment_no");

--> statement-breakpoint
-- ---------------------------------------------------------------------------
-- 3. lc_documents (L-01, BR-105 — the checklist with the discrepancy
--    notes; one row per doc type per LC).
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "lc_documents" (
  "id" uuid NOT NULL,
  "tenant_id" uuid NOT NULL REFERENCES "tenants" ("id") ON DELETE RESTRICT,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "updated_at" timestamptz NOT NULL DEFAULT now(),
  "version" integer NOT NULL DEFAULT 1,
  "created_by" uuid,
  "updated_by" uuid,
  "lc_id" uuid NOT NULL,
  "doc_type" text NOT NULL,
  "presented" boolean NOT NULL DEFAULT false,
  "presented_at" timestamptz,
  "verified" boolean NOT NULL DEFAULT false,
  "verified_at" timestamptz,
  "discrepancy_notes" text,
  "note" text,
  "note_ar" text,
  CONSTRAINT pk_lc_documents PRIMARY KEY ("id"),
  CONSTRAINT uq_lc_documents_id_tenant UNIQUE ("id", "tenant_id"),
  CONSTRAINT uq_lc_documents_tenant_lc_type UNIQUE ("tenant_id", "lc_id", "doc_type"),
  CONSTRAINT fk_lc_documents_lc
    FOREIGN KEY ("lc_id", "tenant_id")
    REFERENCES "letters_of_credit" ("id", "tenant_id") ON DELETE RESTRICT,
  CONSTRAINT ck_lc_documents_doc_type
    CHECK ("doc_type" ~ '^[A-Z0-9 _/-]{2,120}$'),
  -- THE CHECKLIST FLOOR: a stamp exists only on its own state, and a
  -- verification presupposes presentation (an unpresented document is
  -- never verified — the bank discipline's own shape).
  CONSTRAINT ck_lc_documents_presented_shape
    CHECK (
      ("presented" AND "presented_at" IS NOT NULL)
      OR ("presented" = false AND "presented_at" IS NULL)
    ),
  CONSTRAINT ck_lc_documents_verified_shape
    CHECK (
      ("verified" AND "presented" AND "verified_at" IS NOT NULL)
      OR ("verified" = false AND "verified_at" IS NULL)
    )
);

--> statement-breakpoint
CREATE INDEX IF NOT EXISTS ix_lc_documents_tenant_lc
  ON "lc_documents" ("tenant_id", "lc_id", "doc_type");

--> statement-breakpoint
-- ---------------------------------------------------------------------------
-- 4. documentary_collections (L-02, D-21 — the D/P + D/A register with
--    the settlement linkage).
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "documentary_collections" (
  "id" uuid NOT NULL,
  "tenant_id" uuid NOT NULL REFERENCES "tenants" ("id") ON DELETE RESTRICT,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "updated_at" timestamptz NOT NULL DEFAULT now(),
  "version" integer NOT NULL DEFAULT 1,
  "created_by" uuid,
  "updated_by" uuid,
  "collection_no" text NOT NULL,
  "purchase_order_id" uuid,
  "terms_type" text NOT NULL,
  "amount" numeric(19, 4) NOT NULL,
  "currency" varchar(3) NOT NULL,
  "due_date" date,
  "documents" jsonb NOT NULL DEFAULT '[]'::jsonb,
  "status" text NOT NULL DEFAULT 'OPEN',
  "presented_at" timestamptz,
  "accepted_at" timestamptz,
  "paid_at" timestamptz,
  "settled_at" timestamptz,
  "settlement_ref" text,
  "note" text,
  "note_ar" text,
  CONSTRAINT pk_documentary_collections PRIMARY KEY ("id"),
  CONSTRAINT uq_documentary_collections_id_tenant UNIQUE ("id", "tenant_id"),
  CONSTRAINT uq_documentary_collections_tenant_no UNIQUE ("tenant_id", "collection_no"),
  CONSTRAINT fk_documentary_collections_po
    FOREIGN KEY ("purchase_order_id", "tenant_id")
    REFERENCES "purchase_orders" ("id", "tenant_id") ON DELETE RESTRICT,
  CONSTRAINT ck_documentary_collections_terms
    CHECK ("terms_type" IN ('D/P', 'D/A')),
  CONSTRAINT ck_documentary_collections_status
    CHECK ("status" IN ('OPEN', 'PRESENTED', 'ACCEPTED', 'PAID', 'CANCELLED')),
  CONSTRAINT ck_documentary_collections_amount
    CHECK ("amount" > 0),
  CONSTRAINT ck_documentary_collections_documents_shape
    CHECK (jsonb_typeof("documents") = 'array'),
  -- THE USANCE FLOOR: a documents-against-acceptance collection is a
  -- time collection — it carries its maturity date (D/P is at sight;
  -- its due_date stays free).
  CONSTRAINT ck_documentary_collections_usance
    CHECK ("terms_type" = 'D/P' OR "due_date" IS NOT NULL),
  -- THE LADDER'S STAMP LAW (the 0105 XOR shape): a stamp exists only
  -- on its own rung and never below it — PRESENTED+ carries the
  -- presentation, ACCEPTED+ the acceptance, PAID its own stamp; the
  -- settlement linkage pair exists TOGETHER on the paid paths.
  CONSTRAINT ck_documentary_collections_presented_shape
    CHECK (
      ("status" IN ('PRESENTED', 'ACCEPTED', 'PAID') AND "presented_at" IS NOT NULL)
      OR ("status" NOT IN ('PRESENTED', 'ACCEPTED', 'PAID')
           AND "presented_at" IS NULL)
    ),
  CONSTRAINT ck_documentary_collections_accepted_shape
    CHECK (
      ("status" IN ('ACCEPTED', 'PAID') AND "accepted_at" IS NOT NULL)
      OR ("status" NOT IN ('ACCEPTED', 'PAID') AND "accepted_at" IS NULL)
    ),
  CONSTRAINT ck_documentary_collections_paid_shape
    CHECK (
      ("status" = 'PAID' AND "paid_at" IS NOT NULL)
      OR ("status" <> 'PAID' AND "paid_at" IS NULL)
    ),
  CONSTRAINT ck_documentary_collections_settlement_pair
    CHECK (
      ("settled_at" IS NULL) = ("settlement_ref" IS NULL)
    )
);

--> statement-breakpoint
CREATE INDEX IF NOT EXISTS ix_documentary_collections_tenant_status
  ON "documentary_collections" ("tenant_id", "status", "due_date");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS ix_documentary_collections_tenant_po
  ON "documentary_collections" ("tenant_id", "purchase_order_id")
  WHERE "purchase_order_id" IS NOT NULL;

--> statement-breakpoint
-- ---------------------------------------------------------------------------
-- 5. RLS — the A1–A10 family over the four tables (the cmms/quality
--    precedent verbatim: ENABLE + FORCE + erp.apply_tenant_policy, the
--    erp_migrate purge-path pair per the 0094 house law).
--> statement-breakpoint
ALTER TABLE "letters_of_credit" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "letters_of_credit" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
SELECT erp.apply_tenant_policy('"letters_of_credit"');
--> statement-breakpoint
ALTER TABLE "lc_amendments" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "lc_amendments" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
SELECT erp.apply_tenant_policy('"lc_amendments"');
--> statement-breakpoint
ALTER TABLE "lc_documents" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "lc_documents" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
SELECT erp.apply_tenant_policy('"lc_documents"');
--> statement-breakpoint
ALTER TABLE "documentary_collections" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "documentary_collections" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
SELECT erp.apply_tenant_policy('"documentary_collections"');
--> statement-breakpoint
DO $$
DECLARE
  t text;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'letters_of_credit', 'lc_amendments', 'lc_documents', 'documentary_collections'
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
-- 6. Grants — the evidence discipline (the trade-finance register is
--    audited history: S/I/U only, NO DELETE on all four).
--> statement-breakpoint
REVOKE ALL ON "letters_of_credit" FROM erp_app;
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE ON "letters_of_credit" TO erp_app;
--> statement-breakpoint
GRANT SELECT ON "letters_of_credit" TO erp_readonly;
--> statement-breakpoint
GRANT SELECT ON "letters_of_credit" TO erp_definer;
--> statement-breakpoint
REVOKE ALL ON "lc_amendments" FROM erp_app;
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE ON "lc_amendments" TO erp_app;
--> statement-breakpoint
GRANT SELECT ON "lc_amendments" TO erp_readonly;
--> statement-breakpoint
GRANT SELECT ON "lc_amendments" TO erp_definer;
--> statement-breakpoint
REVOKE ALL ON "lc_documents" FROM erp_app;
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE ON "lc_documents" TO erp_app;
--> statement-breakpoint
GRANT SELECT ON "lc_documents" TO erp_readonly;
--> statement-breakpoint
GRANT SELECT ON "lc_documents" TO erp_definer;
--> statement-breakpoint
REVOKE ALL ON "documentary_collections" FROM erp_app;
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE ON "documentary_collections" TO erp_app;
--> statement-breakpoint
GRANT SELECT ON "documentary_collections" TO erp_readonly;
--> statement-breakpoint
GRANT SELECT ON "documentary_collections" TO erp_definer;

--> statement-breakpoint
COMMENT ON TABLE "letters_of_credit" IS 'PHASE-051 (L-01, T-01, D-05): the letters of credit register — the G-64 margin/retirement anchor (the margin deposit at issuance, reversed at settlement, through the REAL engine at W-34) with the status ladder and the PO link; the expiry pair is BR-105''s sweep anchor / سجل الاعتمادات المستندية: مرتكز قيد هامش الاعتماد G-64 وتسويته وسلّم الحالة وربط أمر الشراء';
--> statement-breakpoint
COMMENT ON TABLE "lc_amendments" IS 'PHASE-051 (L-01, T-01, D-05): the dated typed LC amendments — each amendment exactly one typed dimension (value/validity/documents/other), the typed-change law at the floor / تعديلات الاعتماد المستندي: كل تعديل بُعد واحد مؤرّخ ومُصنّف';
--> statement-breakpoint
COMMENT ON TABLE "lc_documents" IS 'PHASE-051 (L-01, T-01, BR-105): the LC documents checklist — presented/verified with their own stamps and the discrepancy notes the expiry sweep reads / قائمة مستندات الاعتماد: التقديم والتحقق والملاحظات على أوجه الخلاف';
--> statement-breakpoint
COMMENT ON TABLE "documentary_collections" IS 'PHASE-051 (L-02, T-01, D-21): the documentary collections register — D/P and D/A terms, the documents set, the status ladder and the settlement linkage / سجل التحصيل المستندي: شروط الدفع أو القبول ومجموعة المستندات وربط التسوية';

--> statement-breakpoint
RESET ROLE;

--> statement-breakpoint
-- Schema-state marker for /health/ready (mirrors the migration manifest).
INSERT INTO erp._schema_state (key, value) VALUES ('schema_version', 119)
ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, at = now();
