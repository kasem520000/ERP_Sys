-- PHASE-039 (Blueprint v3.0 · CR-09; scope extended by v3.1/CR-46) ·
-- migration 0058 · Returns & Collections IV — the collection-agency
-- layer (L1-11)
--
-- Purpose (PHASE-039 §4): the ladder's terminal action — referral to a
-- collection agency:
--
--   collection_agencies — the partner-linked agency register: contact,
--     commission terms (PCT_OF_COLLECTED | FLAT_FEE) and the
--     hashed portal token (the 038 supplier-portal pattern verbatim: a
--     256-bit random value, sha256-hashed at rest, unenumerable +
--     revocable). The agency-status callback port authenticates
--     against this hash pre-GUC (a SECURITY DEFINER projection), is
--     audited and rate-limited.
--   collection_referrals — the referral records: the referred balance,
--     the commission terms snapshot, the status ladder
--     REFERRED → ACKNOWLEDGED → PARTIAL → SETTLED → COMMISSION_POSTED
--     → CLOSED (CANCELLED off the way). The commission posts through
--     the engine at settlement (G-39: DR the tenant-mapped
--     collection-commission expense · CR AP_CONTROL on the agency
--     partner — the number bound at implementation as the next free
--     after G-38, per the register's "continue per phase doc" rule).
--
-- INV-022 ledger: +2 tables (of the phase's +10), +1 journal (G-39 —
-- implementation-bound), +0 permissions (rides the 0056 keys:
-- sales.collection-agencies.manage), +0 feature keys (rides
-- sales.dunning).
--
-- Grants: both SELECT/INSERT/UPDATE — NO DELETE (the referral history
-- is compliance evidence; agencies suspend, never delete).

--> statement-breakpoint
SET ROLE erp_migrate;

--> statement-breakpoint
-- ---------------------------------------------------------------------------
-- 1. collection_agencies (T-10): the partner-linked register.
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "collection_agencies" (
  "id" uuid NOT NULL,
  "tenant_id" uuid NOT NULL REFERENCES "tenants" ("id") ON DELETE RESTRICT,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "updated_at" timestamptz NOT NULL DEFAULT now(),
  "version" integer NOT NULL DEFAULT 1,
  "created_by" uuid,
  "partner_id" uuid NOT NULL,
  "contact_name" text,
  "email" text,
  "phone" text,
  "commission_mode" text NOT NULL,
  "commission_pct" numeric(5,2),
  "flat_fee" numeric(19,4),
  "status" text NOT NULL DEFAULT 'ACTIVE',
  -- The 038 portal-token discipline: sha256(token) at rest; the raw
  -- token is shown once at issuance, never stored.
  "portal_token_hash" text,
  "token_issued_at" timestamptz,
  "note" text,
  "note_ar" text,
  CONSTRAINT "pk_collection_agencies" PRIMARY KEY ("id"),
  CONSTRAINT "uq_collection_agencies_id_tenant" UNIQUE ("id", "tenant_id"),
  CONSTRAINT "uq_collection_agencies_tenant_partner" UNIQUE ("tenant_id", "partner_id"),
  CONSTRAINT "ck_collection_agencies_status" CHECK ("status" IN ('ACTIVE','SUSPENDED')),
  CONSTRAINT "ck_collection_agencies_commission" CHECK (
    ("commission_mode" = 'PCT_OF_COLLECTED'
      AND "commission_pct" IS NOT NULL AND "commission_pct" > 0 AND "commission_pct" <= 100)
    OR ("commission_mode" = 'FLAT_FEE' AND "flat_fee" IS NOT NULL AND "flat_fee" > 0)
  ),
  CONSTRAINT "ck_collection_agencies_token_shape" CHECK (
    "portal_token_hash" IS NULL OR ("portal_token_hash" ~ '^[a-f0-9]{64}$' AND "token_issued_at" IS NOT NULL)
  )
);

--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "ix_collection_agencies_tenant_status"
  ON "collection_agencies" ("tenant_id", "status");

--> statement-breakpoint
-- ---------------------------------------------------------------------------
-- 2. collection_referrals (T-10): the referral records.
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "collection_referrals" (
  "id" uuid NOT NULL,
  "tenant_id" uuid NOT NULL REFERENCES "tenants" ("id") ON DELETE RESTRICT,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "updated_at" timestamptz NOT NULL DEFAULT now(),
  "version" integer NOT NULL DEFAULT 1,
  "created_by" uuid,
  "agency_id" uuid NOT NULL,
  "partner_id" uuid NOT NULL,
  "invoice_id" uuid,
  "action_id" uuid,
  "currency_code" varchar(3) NOT NULL,
  "referral_date" date NOT NULL,
  "referred_amount" numeric(19,4) NOT NULL,
  -- Commission terms snapshot at referral (the register may change
  -- later; the referral keeps its own terms — evidence).
  "commission_mode" text NOT NULL,
  "commission_pct" numeric(5,2),
  "flat_fee" numeric(19,4),
  "status" text NOT NULL DEFAULT 'REFERRED',
  "settled_amount" numeric(19,4) NOT NULL DEFAULT 0,
  "settled_at" timestamptz,
  "commission_amount" numeric(19,4),
  "commission_journal_id" uuid,
  "commission_entry_no" text,
  "closed_at" timestamptz,
  "note" text,
  "note_ar" text,
  CONSTRAINT "pk_collection_referrals" PRIMARY KEY ("id"),
  CONSTRAINT "uq_collection_referrals_id_tenant" UNIQUE ("id", "tenant_id"),
  CONSTRAINT "ck_collection_referrals_status" CHECK (
    "status" IN ('REFERRED','ACKNOWLEDGED','PARTIAL','SETTLED',
                 'COMMISSION_POSTED','CLOSED','CANCELLED')
  ),
  CONSTRAINT "ck_collection_referrals_commission" CHECK (
    ("commission_mode" = 'PCT_OF_COLLECTED'
      AND "commission_pct" IS NOT NULL AND "commission_pct" > 0 AND "commission_pct" <= 100)
    OR ("commission_mode" = 'FLAT_FEE' AND "flat_fee" IS NOT NULL AND "flat_fee" > 0)
  ),
  CONSTRAINT "ck_collection_referrals_amounts" CHECK (
    "referred_amount" > 0 AND "settled_amount" >= 0
  ),
  -- Lifecycle stamps: settlement precedes commission; commission
  -- implies its journal (exactly-once, the BR-064 discipline).
  CONSTRAINT "ck_collection_referrals_lifecycle_stamps" CHECK (
    ("status" IN ('REFERRED','ACKNOWLEDGED'))
    OR ("status" IN ('PARTIAL','SETTLED') AND "settled_amount" > 0)
    OR ("status" = 'COMMISSION_POSTED' AND "settled_amount" > 0
        AND "commission_amount" IS NOT NULL AND "commission_journal_id" IS NOT NULL)
    OR ("status" = 'CLOSED' AND "closed_at" IS NOT NULL)
    OR ("status" = 'CANCELLED')
  )
);

--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "ix_collection_referrals_tenant_agency"
  ON "collection_referrals" ("tenant_id", "agency_id", "status");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "ix_collection_referrals_tenant_partner"
  ON "collection_referrals" ("tenant_id", "partner_id", "status");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "ix_collection_referrals_tenant_invoice"
  ON "collection_referrals" ("tenant_id", "invoice_id");

--> statement-breakpoint
-- ---------------------------------------------------------------------------
-- 3. Composite tenant FKs.
--> statement-breakpoint
ALTER TABLE "collection_agencies" DROP CONSTRAINT IF EXISTS fk_collection_agencies_partner;
--> statement-breakpoint
ALTER TABLE "collection_agencies"
  ADD CONSTRAINT fk_collection_agencies_partner FOREIGN KEY ("partner_id", "tenant_id")
    REFERENCES "partners" ("id", "tenant_id") ON DELETE RESTRICT;
--> statement-breakpoint
ALTER TABLE "collection_referrals" DROP CONSTRAINT IF EXISTS fk_collection_referrals_agency;
--> statement-breakpoint
ALTER TABLE "collection_referrals"
  ADD CONSTRAINT fk_collection_referrals_agency FOREIGN KEY ("agency_id", "tenant_id")
    REFERENCES "collection_agencies" ("id", "tenant_id") ON DELETE RESTRICT;
--> statement-breakpoint
ALTER TABLE "collection_referrals" DROP CONSTRAINT IF EXISTS fk_collection_referrals_partner;
--> statement-breakpoint
ALTER TABLE "collection_referrals"
  ADD CONSTRAINT fk_collection_referrals_partner FOREIGN KEY ("partner_id", "tenant_id")
    REFERENCES "partners" ("id", "tenant_id") ON DELETE RESTRICT;
--> statement-breakpoint
ALTER TABLE "collection_referrals" DROP CONSTRAINT IF EXISTS fk_collection_referrals_invoice;
--> statement-breakpoint
ALTER TABLE "collection_referrals"
  ADD CONSTRAINT fk_collection_referrals_invoice FOREIGN KEY ("invoice_id", "tenant_id")
    REFERENCES "sales_invoices" ("id", "tenant_id") ON DELETE RESTRICT;
--> statement-breakpoint
ALTER TABLE "collection_referrals" DROP CONSTRAINT IF EXISTS fk_collection_referrals_action;
--> statement-breakpoint
ALTER TABLE "collection_referrals"
  ADD CONSTRAINT fk_collection_referrals_action FOREIGN KEY ("action_id", "tenant_id")
    REFERENCES "collection_actions" ("id", "tenant_id") ON DELETE SET NULL;

--> statement-breakpoint
-- ---------------------------------------------------------------------------
-- 4. RLS.
--> statement-breakpoint
ALTER TABLE "collection_agencies" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "collection_agencies" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
SELECT erp.apply_tenant_policy('"collection_agencies"');
--> statement-breakpoint
ALTER TABLE "collection_referrals" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "collection_referrals" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
SELECT erp.apply_tenant_policy('"collection_referrals"');

--> statement-breakpoint
-- ---------------------------------------------------------------------------
-- 5. Purge path (the house discipline).
--> statement-breakpoint
DO $$
DECLARE
  t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['collection_agencies', 'collection_referrals'] LOOP
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
-- 6. Grants: both SELECT/INSERT/UPDATE — NO DELETE.
--> statement-breakpoint
REVOKE ALL ON "collection_agencies", "collection_referrals" FROM erp_app;
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE ON "collection_agencies", "collection_referrals" TO erp_app;
--> statement-breakpoint
GRANT SELECT ON "collection_agencies", "collection_referrals" TO erp_readonly;
--> statement-breakpoint
GRANT SELECT ON "collection_agencies", "collection_referrals" TO erp_definer;

--> statement-breakpoint
-- ---------------------------------------------------------------------------
-- 7. Pre-GUC agency-callback resolution (the 038 portal-token pattern):
-- a read-only SECURITY DEFINER projection resolves (token-hash) →
-- (tenant, agency, status) BEFORE any tenant GUC can exist; the
-- callback service then re-validates under RLS in the tenant scope.
--> statement-breakpoint
CREATE OR REPLACE FUNCTION erp.portal_resolve_agency_token(p_token_hash text)
RETURNS TABLE (tenant_id uuid, agency_id uuid, agency_status text)
LANGUAGE sql SECURITY DEFINER SET search_path = public, erp AS $$
  SELECT a."tenant_id", a."id", a."status"
  FROM "collection_agencies" a
  WHERE a."portal_token_hash" = p_token_hash
    AND a."status" = 'ACTIVE'
  LIMIT 1;
$$;
--> statement-breakpoint
ALTER FUNCTION erp.portal_resolve_agency_token(text) OWNER TO erp_definer;
--> statement-breakpoint
REVOKE ALL ON FUNCTION erp.portal_resolve_agency_token(text) FROM PUBLIC;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION erp.portal_resolve_agency_token(text) TO erp_app;

--> statement-breakpoint
-- ---------------------------------------------------------------------------
-- 8. Bilingual table comments.
--> statement-breakpoint
COMMENT ON TABLE "collection_agencies" IS 'PHASE-039 (L1-11): the partner-linked collection-agency register with hashed callback tokens / سجل وكالات التحصيل برموز اتصال مُجزّأة';
--> statement-breakpoint
COMMENT ON TABLE "collection_referrals" IS 'PHASE-039 (L1-11): referral records — referred balance, commission snapshot, settlement + G-39 commission posting / سجلات الإحالة للتحصيل مع تسوية العمولة';

--> statement-breakpoint
RESET ROLE;

--> statement-breakpoint
-- Schema-state marker for /health/ready (mirrors the migration manifest).
INSERT INTO erp._schema_state (key, value) VALUES ('schema_version', 58)
ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, at = now();
