-- PHASE-038 (Blueprint v3.0 · CR-08) · migration 0051 · Procurement
-- sourcing I — the RFQ negotiation loop (H-11 · P-01/P-02/P-08)
--
-- Purpose (PHASE-038 §4 Design Impact): the missing negotiation loop in
-- front of the purchase order. Five tables:
--
--   rfqs — the sourcing round header (RLS'd): OPEN (any invited-supplier
--     registry entry may respond) or INVITED modes, the due timestamp,
--     the currency, and the state machine DRAFT → ISSUED → QUOTED →
--     AWARDED → CLOSED (CANCELLED off DRAFT/ISSUED) — DB CHECKs pin the
--     stamp shapes (issued_at/quoted_at/awarded_at/closed_at must cohere
--     with the status, the 0050 stamp-shape discipline).
--     invited_suppliers (jsonb uuid[]) carries the INVITED list;
--     portal_invites (jsonb) carries the scoped portal tokens (sha256
--     hashes only — the secret itself is shown ONCE at mint and never
--     stored).
--   rfq_lines — the requested items (replace-on-DRAFT-edit: DELETE grant).
--   supplier_quotes — one quote per supplier per RFQ (UNIQUE); re-submit
--     while the round is open REPLACES the lines (upsert semantics).
--   supplier_quotes_lines — the offered prices/lead times (DELETE grant
--     for the replace path).
--   quote_comparisons — the FROZEN comparison snapshot + the award
--     decision (evidence, never recomputed — the phase §7 risk note);
--     ONE live comparison per RFQ (partial unique on status <>
--     'CANCELLED'); awarding closes the round (BR-063).
--
-- INV-022 ledger: +5 tables (ENTITY_CATALOG 204 → 209 in this migration),
-- +0 journals (awards generate purchase orders — never journals), +7
-- permission keys (249 → 256 — §5 below, matrix §3.16), +5 feature keys
-- (§6 below — FEATURE_CATALOG rows).
--
-- Grants: rfqs/rfq_lines/supplier_quotes/supplier_quotes_lines/
-- quote_comparisons carry SELECT/INSERT/UPDATE for erp_app; the two line
-- tables add DELETE (the replace-on-edit / re-submit paths). rfqs has NO
-- DELETE (an issued RFQ is sourcing history).

--> statement-breakpoint
SET ROLE erp_migrate;

--> statement-breakpoint
-- ---------------------------------------------------------------------------
-- 1. rfqs (T-01/T-02): the sourcing round header.
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "rfqs" (
  "id" uuid NOT NULL,
  "tenant_id" uuid NOT NULL REFERENCES "tenants" ("id") ON DELETE RESTRICT,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "updated_at" timestamptz NOT NULL DEFAULT now(),
  "version" integer NOT NULL DEFAULT 1,
  "created_by" uuid,
  "branch_id" uuid NOT NULL,
  -- Official number reserved at ISSUE (the BR-029 boundary-transition
  -- numbering discipline — POs reserve at issue, PRs at approval).
  "rfq_no" text,
  "title" text NOT NULL,
  "title_ar" text,
  -- OPEN = any supplier registry entry may respond through the portal;
  -- INVITED = only the invited_suppliers list may respond.
  "mode" text NOT NULL DEFAULT 'INVITED',
  "status" text NOT NULL DEFAULT 'DRAFT',
  "currency_code" varchar(3) NOT NULL,
  "due_at" timestamptz,
  -- INVITED mode's allow-list (jsonb array of supplier uuid strings).
  "invited_suppliers" jsonb NOT NULL DEFAULT '[]'::jsonb,
  -- Scoped portal credentials (PHASE-038 §2.11 P-05): sha256 token hashes
  -- bound to (this RFQ, one supplier); the plaintext is shown ONCE.
  "portal_invites" jsonb NOT NULL DEFAULT '[]'::jsonb,
  "issued_at" timestamptz,
  "issued_by" uuid,
  "quoted_at" timestamptz,
  "awarded_at" timestamptz,
  "awarded_by" uuid,
  "closed_at" timestamptz,
  "closed_by" uuid,
  "cancel_reason" text,
  "note" text,
  "note_ar" text,
  CONSTRAINT pk_rfqs PRIMARY KEY ("id"),
  CONSTRAINT uq_rfqs_id_tenant UNIQUE ("id", "tenant_id"),
  CONSTRAINT uq_rfqs_tenant_no UNIQUE ("tenant_id", "rfq_no"),
  CONSTRAINT ck_rfqs_title_length CHECK (length("title") BETWEEN 1 AND 200),
  CONSTRAINT ck_rfqs_mode CHECK ("mode" IN ('OPEN', 'INVITED')),
  CONSTRAINT ck_rfqs_status CHECK (
    "status" IN ('DRAFT', 'ISSUED', 'QUOTED', 'AWARDED', 'CLOSED', 'CANCELLED')),
  CONSTRAINT ck_rfqs_currency_shape CHECK ("currency_code" ~ '^[A-Z]{3}$'),
  CONSTRAINT ck_rfqs_invited_list_shape CHECK (
    jsonb_typeof("invited_suppliers") = 'array'),
  CONSTRAINT ck_rfqs_portal_invites_shape CHECK (
    jsonb_typeof("portal_invites") = 'array'),
  -- State-machine stamp shapes (the 0050 discipline — the DB floor for
  -- the lifecycle; the service owns the transition legality).
  CONSTRAINT ck_rfqs_lifecycle_stamps CHECK (
    ("status" = 'DRAFT' AND "issued_at" IS NULL AND "awarded_at" IS NULL AND "closed_at" IS NULL)
    OR ("status" IN ('ISSUED', 'QUOTED') AND "issued_at" IS NOT NULL AND "awarded_at" IS NULL AND "closed_at" IS NULL)
    OR ("status" = 'AWARDED' AND "issued_at" IS NOT NULL AND "awarded_at" IS NOT NULL AND "closed_at" IS NULL)
    OR ("status" = 'CLOSED' AND "issued_at" IS NOT NULL AND "closed_at" IS NOT NULL)
    OR ("status" = 'CANCELLED'))
);

--> statement-breakpoint
-- The OA-06 hot path: the sourcing worklist is "my open RFQs" — list by
-- (tenant, status).
CREATE INDEX IF NOT EXISTS ix_rfqs_tenant_status
  ON "rfqs" ("tenant_id", "status", "due_at");

--> statement-breakpoint
CREATE INDEX IF NOT EXISTS ix_rfqs_tenant_branch
  ON "rfqs" ("tenant_id", "branch_id");

--> statement-breakpoint
COMMENT ON TABLE "rfqs" IS
  'PHASE-038 T-01/T-02: the RFQ sourcing round — open/invited supplier competition in front of the purchase order (H-11/P-01); lifecycle DRAFT→ISSUED→QUOTED→AWARDED→CLOSED with DB-level stamp shapes; portal_invites carries the sha256-hashed scoped supplier tokens (P-05).';

--> statement-breakpoint
-- ---------------------------------------------------------------------------
-- 2. rfq_lines (T-01): the requested items — replace-on-DRAFT-edit, so
-- erp_app carries DELETE.
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "rfq_lines" (
  "id" uuid NOT NULL,
  "tenant_id" uuid NOT NULL REFERENCES "tenants" ("id") ON DELETE RESTRICT,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "rfq_id" uuid NOT NULL,
  "line_no" integer NOT NULL,
  "item_id" uuid NOT NULL,
  "qty" numeric(19,6) NOT NULL,
  "target_price" numeric(19,4),
  "note" text,
  CONSTRAINT pk_rfq_lines PRIMARY KEY ("id"),
  CONSTRAINT uq_rfq_lines_id_tenant UNIQUE ("id", "tenant_id"),
  CONSTRAINT uq_rfq_lines_tenant_rfq_line UNIQUE ("tenant_id", "rfq_id", "line_no"),
  CONSTRAINT ck_rfq_lines_qty_positive CHECK ("qty" > 0),
  CONSTRAINT ck_rfq_lines_target_price CHECK ("target_price" IS NULL OR "target_price" >= 0)
);

--> statement-breakpoint
COMMENT ON TABLE "rfq_lines" IS
  'PHASE-038 T-01: the RFQ requested items (qty + optional buyer target price) — lines replace on DRAFT edits only.';

--> statement-breakpoint
-- ---------------------------------------------------------------------------
-- 3. supplier_quotes (T-01/T-03): one quote per supplier per RFQ.
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "supplier_quotes" (
  "id" uuid NOT NULL,
  "tenant_id" uuid NOT NULL REFERENCES "tenants" ("id") ON DELETE RESTRICT,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "updated_at" timestamptz NOT NULL DEFAULT now(),
  "rfq_id" uuid NOT NULL,
  "supplier_id" uuid NOT NULL,
  -- The supplier's own reference (verbatim; never guessed).
  "quote_ref" text,
  "status" text NOT NULL DEFAULT 'SUBMITTED',
  "submitted_via" text NOT NULL DEFAULT 'BACK_OFFICE',
  "currency_code" varchar(3) NOT NULL,
  "lead_time_days" integer,
  "valid_until" date,
  "payment_terms" text,
  "submitted_at" timestamptz NOT NULL DEFAULT now(),
  -- Back-office entry stamps the actor; portal submissions are stamped
  -- with the portal contact (the token itself is never recorded).
  "submitted_by" uuid,
  "portal_contact" text,
  "note" text,
  CONSTRAINT pk_supplier_quotes PRIMARY KEY ("id"),
  CONSTRAINT uq_supplier_quotes_id_tenant UNIQUE ("id", "tenant_id"),
  CONSTRAINT uq_supplier_quotes_tenant_rfq_supplier UNIQUE ("tenant_id", "rfq_id", "supplier_id"),
  CONSTRAINT ck_supplier_quotes_status CHECK ("status" IN ('SUBMITTED', 'WITHDRAWN')),
  CONSTRAINT ck_supplier_quotes_via CHECK ("submitted_via" IN ('PORTAL', 'BACK_OFFICE')),
  CONSTRAINT ck_supplier_quotes_currency_shape CHECK ("currency_code" ~ '^[A-Z]{3}$'),
  CONSTRAINT ck_supplier_quotes_lead_time CHECK ("lead_time_days" IS NULL OR "lead_time_days" >= 0)
);

--> statement-breakpoint
CREATE INDEX IF NOT EXISTS ix_supplier_quotes_tenant_rfq
  ON "supplier_quotes" ("tenant_id", "rfq_id", "status");

--> statement-breakpoint
CREATE INDEX IF NOT EXISTS ix_supplier_quotes_tenant_supplier
  ON "supplier_quotes" ("tenant_id", "supplier_id", "submitted_at");

--> statement-breakpoint
COMMENT ON TABLE "rfq_lines" IS
  'PHASE-038 T-01: the RFQ requested items (qty + optional buyer target price) — lines replace on DRAFT edits only.';
COMMENT ON TABLE "supplier_quotes" IS
  'PHASE-038 T-01/T-03: the supplier quote header — one per supplier per RFQ; portal or back-office entry (P-02); re-submission while the round is open replaces the lines.';

--> statement-breakpoint
-- ---------------------------------------------------------------------------
-- 4. supplier_quotes_lines (T-01/T-03): the offered prices (DELETE grant
-- for the re-submit replace path).
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "supplier_quotes_lines" (
  "id" uuid NOT NULL,
  "tenant_id" uuid NOT NULL REFERENCES "tenants" ("id") ON DELETE RESTRICT,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "quote_id" uuid NOT NULL,
  "rfq_line_id" uuid NOT NULL,
  "line_no" integer NOT NULL,
  "qty" numeric(19,6) NOT NULL,
  "unit_price" numeric(19,4) NOT NULL,
  "lead_time_days" integer,
  "note" text,
  CONSTRAINT pk_supplier_quotes_lines PRIMARY KEY ("id"),
  CONSTRAINT uq_supplier_quotes_lines_id_tenant UNIQUE ("id", "tenant_id"),
  CONSTRAINT uq_supplier_quotes_lines_tenant_quote_line UNIQUE ("tenant_id", "quote_id", "line_no"),
  CONSTRAINT ck_supplier_quotes_lines_qty_positive CHECK ("qty" > 0),
  CONSTRAINT ck_supplier_quotes_lines_price_nonneg CHECK ("unit_price" >= 0),
  CONSTRAINT ck_supplier_quotes_lines_lead_time CHECK ("lead_time_days" IS NULL OR "lead_time_days" >= 0)
);

--> statement-breakpoint
CREATE INDEX IF NOT EXISTS ix_supplier_quotes_lines_tenant_quote
  ON "supplier_quotes_lines" ("tenant_id", "quote_id", "line_no");

--> statement-breakpoint
COMMENT ON TABLE "supplier_quotes_lines" IS
  'PHASE-038 T-01/T-03: the offered line prices/lead times per quote — replaced wholesale on re-submission while the RFQ is open.';

--> statement-breakpoint
-- ---------------------------------------------------------------------------
-- 5. quote_comparisons (T-01/T-04): the frozen comparison snapshot + the
-- award decision. The snapshot is EVIDENCE — written once at prepare,
-- never recomputed (the phase §7 risk note); the award block records the
-- line-level decisions and the generated documents stay traceable through
-- generated_docs.
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "quote_comparisons" (
  "id" uuid NOT NULL,
  "tenant_id" uuid NOT NULL REFERENCES "tenants" ("id") ON DELETE RESTRICT,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "updated_at" timestamptz NOT NULL DEFAULT now(),
  "version" integer NOT NULL DEFAULT 1,
  "created_by" uuid,
  "rfq_id" uuid NOT NULL,
  -- The frozen matrix: per-line offers + scores + the supplier totals
  -- (written at prepare; the award never re-scores).
  "snapshot" jsonb NOT NULL,
  "status" text NOT NULL DEFAULT 'PREPARED',
  -- The award decision: { decisions: [{rfqLineId, quoteId, supplierId,
  -- qty, unitPrice}], note?, awardedAt } — written once by the award.
  "award" jsonb,
  "awarded_by" uuid,
  "awarded_at" timestamptz,
  "award_note" text,
  "award_note_ar" text,
  -- Traceability of the generated documents: [{ kind: 'PURCHASE_ORDER' |
  -- 'BLANKET_RELEASE', id, supplierId, documentNo?, lineRefs: [...] }].
  "generated_docs" jsonb,
  CONSTRAINT pk_quote_comparisons PRIMARY KEY ("id"),
  CONSTRAINT uq_quote_comparisons_id_tenant UNIQUE ("id", "tenant_id"),
  -- ONE live comparison per RFQ (BR-063's DB floor — a second award
  -- round cannot coexist; cancelled ones do not block re-preparation).
  CONSTRAINT uq_quote_comparisons_tenant_rfq_live UNIQUE ("tenant_id", "rfq_id"),
  CONSTRAINT ck_quote_comparisons_status CHECK ("status" IN ('PREPARED', 'AWARDED', 'CANCELLED')),
  CONSTRAINT ck_quote_comparisons_snapshot_shape CHECK (jsonb_typeof("snapshot") = 'object'),
  CONSTRAINT ck_quote_comparisons_award_shape CHECK ("award" IS NULL OR jsonb_typeof("award") = 'object'),
  CONSTRAINT ck_quote_comparisons_award_stamps CHECK (
    ("status" = 'PREPARED' AND "award" IS NULL AND "awarded_at" IS NULL)
    OR ("status" = 'AWARDED' AND "award" IS NOT NULL AND "awarded_at" IS NOT NULL)
    OR ("status" = 'CANCELLED'))
);

--> statement-breakpoint
CREATE INDEX IF NOT EXISTS ix_quote_comparisons_tenant_rfq
  ON "quote_comparisons" ("tenant_id", "rfq_id");

--> statement-breakpoint
COMMENT ON TABLE "quote_comparisons" IS
  'PHASE-038 T-01/T-04: the frozen comparison snapshot + the award decision (P-02/P-08) — evidence written once, never recomputed; generated_docs traces the award to its POs/releases.';

--> statement-breakpoint
-- ---------------------------------------------------------------------------
-- 6. Composite tenant FKs (the house convention — both sides tenant must
-- agree) + the business links.
--> statement-breakpoint
ALTER TABLE "rfqs"
  DROP CONSTRAINT IF EXISTS fk_rfqs_branch;
ALTER TABLE "rfqs"
  ADD CONSTRAINT fk_rfqs_branch FOREIGN KEY ("branch_id", "tenant_id")
    REFERENCES "branches" ("id", "tenant_id") ON DELETE RESTRICT;

--> statement-breakpoint
ALTER TABLE "rfq_lines"
  DROP CONSTRAINT IF EXISTS fk_rfq_lines_rfq;
ALTER TABLE "rfq_lines"
  ADD CONSTRAINT fk_rfq_lines_rfq FOREIGN KEY ("rfq_id", "tenant_id")
    REFERENCES "rfqs" ("id", "tenant_id") ON DELETE CASCADE;

--> statement-breakpoint
ALTER TABLE "rfq_lines"
  DROP CONSTRAINT IF EXISTS fk_rfq_lines_item;
ALTER TABLE "rfq_lines"
  ADD CONSTRAINT fk_rfq_lines_item FOREIGN KEY ("item_id", "tenant_id")
    REFERENCES "items" ("id", "tenant_id") ON DELETE RESTRICT;

--> statement-breakpoint
ALTER TABLE "supplier_quotes"
  DROP CONSTRAINT IF EXISTS fk_supplier_quotes_rfq;
ALTER TABLE "supplier_quotes"
  ADD CONSTRAINT fk_supplier_quotes_rfq FOREIGN KEY ("rfq_id", "tenant_id")
    REFERENCES "rfqs" ("id", "tenant_id") ON DELETE RESTRICT;

--> statement-breakpoint
ALTER TABLE "supplier_quotes"
  DROP CONSTRAINT IF EXISTS fk_supplier_quotes_supplier;
ALTER TABLE "supplier_quotes"
  ADD CONSTRAINT fk_supplier_quotes_supplier FOREIGN KEY ("supplier_id", "tenant_id")
    REFERENCES "partners" ("id", "tenant_id") ON DELETE RESTRICT;

--> statement-breakpoint
ALTER TABLE "supplier_quotes_lines"
  DROP CONSTRAINT IF EXISTS fk_supplier_quotes_lines_quote;
ALTER TABLE "supplier_quotes_lines"
  ADD CONSTRAINT fk_supplier_quotes_lines_quote FOREIGN KEY ("quote_id", "tenant_id")
    REFERENCES "supplier_quotes" ("id", "tenant_id") ON DELETE CASCADE;

--> statement-breakpoint
ALTER TABLE "supplier_quotes_lines"
  DROP CONSTRAINT IF EXISTS fk_supplier_quotes_lines_rfq_line;
ALTER TABLE "supplier_quotes_lines"
  ADD CONSTRAINT fk_supplier_quotes_lines_rfq_line FOREIGN KEY ("rfq_line_id", "tenant_id")
    REFERENCES "rfq_lines" ("id", "tenant_id") ON DELETE RESTRICT;

--> statement-breakpoint
ALTER TABLE "quote_comparisons"
  DROP CONSTRAINT IF EXISTS fk_quote_comparisons_rfq;
ALTER TABLE "quote_comparisons"
  ADD CONSTRAINT fk_quote_comparisons_rfq FOREIGN KEY ("rfq_id", "tenant_id")
    REFERENCES "rfqs" ("id", "tenant_id") ON DELETE RESTRICT;

--> statement-breakpoint
-- ---------------------------------------------------------------------------
-- 7. RLS (TENANT_ISOLATION §2): the house macro on the five tables.
--> statement-breakpoint
SELECT erp.apply_tenant_policy('"rfqs"');
--> statement-breakpoint
SELECT erp.apply_tenant_policy('"rfq_lines"');
--> statement-breakpoint
SELECT erp.apply_tenant_policy('"supplier_quotes"');
--> statement-breakpoint
SELECT erp.apply_tenant_policy('"supplier_quotes_lines"');
--> statement-breakpoint
SELECT erp.apply_tenant_policy('"quote_comparisons"');

--> statement-breakpoint
-- ---------------------------------------------------------------------------
-- 7b. Purge path (the 0036/0042/0043/0049/0050 discipline): the sourcing
-- rows join the tenant offboarding export→purge flow per DATA_PROTECTION §4.
--> statement-breakpoint
DO $$
DECLARE
  t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['rfqs', 'rfq_lines', 'supplier_quotes', 'supplier_quotes_lines', 'quote_comparisons'] LOOP
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
-- 8. Grants: SELECT/INSERT/UPDATE everywhere; the two line tables add
-- DELETE (replace-on-edit / re-submit); rfqs/quotes/comparisons have NO
-- DELETE (sourcing history is archive-not-delete; statuses carry the
-- reversals).
--> statement-breakpoint
REVOKE ALL ON "rfqs", "rfq_lines", "supplier_quotes", "supplier_quotes_lines", "quote_comparisons" FROM erp_app;
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE ON "rfqs", "supplier_quotes", "quote_comparisons" TO erp_app;
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON "rfq_lines", "supplier_quotes_lines" TO erp_app;
--> statement-breakpoint
GRANT SELECT ON "rfqs", "rfq_lines", "supplier_quotes", "supplier_quotes_lines", "quote_comparisons" TO erp_readonly;
--> statement-breakpoint
GRANT SELECT ON "rfqs", "rfq_lines", "supplier_quotes", "supplier_quotes_lines", "quote_comparisons" TO erp_definer;

--> statement-breakpoint
-- ---------------------------------------------------------------------------
-- 9. Permission seed (PHASE-038 §4): the SEVEN sourcing keys (matrix
-- §3.16) — zero-drift extends 249 → 256 (seed = mirror; the drift CLI
-- joins this file). The owner template cross-join re-runs idempotently
-- (every tenant-plane key); the accountant gains the read keys
-- (procurement visibility); the purchasing template gains
-- read+manage+award (the buyer role).
--> statement-breakpoint
INSERT INTO "permissions" ("key", "module", "description") VALUES
('purchasing.rfqs.read', 'purchasing', 'View RFQs, quotes, comparisons, blanket orders, supplier collaboration / عرض طلبات عروض الأسعار والمقارنات والاتفاقيات الإطارية وتعاون الموردين'),
('purchasing.rfqs.manage', 'purchasing', 'Manage RFQs, quotes, blanket agreements, advances and tenders / إدارة طلبات عروض الأسعار وعروض الموردين والاتفاقيات الإطارية والسلف والمناقصات'),
('purchasing.rfqs.award', 'purchasing', 'Award RFQ rounds and generate orders/releases / ترسية دورات المنافسة الشرائية وتوليد أوامر الشراء'),
('purchasing.suppliers.rate', 'purchasing', 'Compute and review supplier scorecards / احتساب ومراجعة بطاقات تقييم الموردين'),
('purchasing.capex.read', 'purchasing', 'View CAPEX requests / عرض طلبات الشراء الرأسمالي'),
('purchasing.capex.manage', 'purchasing', 'Create and submit CAPEX requests / إنشاء وإرسال طلبات الشراء الرأسمالي'),
('purchasing.capex.approve', 'purchasing', 'Approve or reject CAPEX requests (SoD: creator ≠ approver) / اعتماد أو رفض طلبات الشراء الرأسمالي (الفصل: المنشئ ≠ المعتمد)')
ON CONFLICT ("key") DO NOTHING;
--> statement-breakpoint
INSERT INTO "role_permissions" ("role_id", "tenant_id", "permission_id")
SELECT r."id", NULL, p."key"
FROM "roles" r CROSS JOIN "permissions" p
WHERE r."key" = 'owner' AND r."tenant_id" IS NULL
  AND p."key" NOT LIKE 'platform.%'
  AND p."key" <> 'identity.mfa.manage'
ON CONFLICT ("role_id", "permission_id") DO NOTHING;
--> statement-breakpoint
INSERT INTO "role_permissions" ("role_id", "tenant_id", "permission_id")
SELECT r."id", NULL, p."key"
FROM "roles" r CROSS JOIN "permissions" p
WHERE r."key" = 'accountant' AND r."tenant_id" IS NULL
  AND p."key" IN ('purchasing.rfqs.read', 'purchasing.capex.read')
ON CONFLICT ("role_id", "permission_id") DO NOTHING;
--> statement-breakpoint
INSERT INTO "role_permissions" ("role_id", "tenant_id", "permission_id")
SELECT r."id", NULL, p."key"
FROM "roles" r CROSS JOIN "permissions" p
WHERE r."key" = 'purchasing' AND r."tenant_id" IS NULL
  AND p."key" IN ('purchasing.rfqs.read', 'purchasing.rfqs.manage', 'purchasing.rfqs.award', 'purchasing.suppliers.rate', 'purchasing.capex.read', 'purchasing.capex.manage')
ON CONFLICT ("role_id", "permission_id") DO NOTHING;

--> statement-breakpoint
-- ---------------------------------------------------------------------------
-- 10. Feature plan grants (the 0042/0043/0048/0049 block): the FIVE
-- sourcing keys → business + enterprise (the tier-4 financial-depth
-- precedent — starter excluded). Template-composable grants unchanged
-- (CR-36 f); FEATURE_CATALOG.md carries the catalog rows.
--> statement-breakpoint
UPDATE "plans" SET "feature_keys" = array_cat("feature_keys",
  ARRAY['purchasing.rfqs', 'purchasing.blanket_orders', 'purchasing.supplier_scorecards', 'purchasing.capex_requests', 'purchasing.supplier_portal'])
WHERE "key" IN ('business', 'enterprise')
  AND NOT ('purchasing.rfqs' = ANY("feature_keys"));

--> statement-breakpoint
RESET ROLE;

--> statement-breakpoint
-- ---------------------------------------------------------------------------
-- 11b. CHECK-domain widenings (the 0023/0027/0035/0042/0043 pattern — both
-- domains re-declared verbatim with every existing value + the new one):
-- the BR-062 advisory inbox rides the notifications plane ('purchasing')
-- and the G-33 disbursement records the treasury movement
-- ('supplier_advance' — the payroll 'payroll_payout' widening shape).
--> statement-breakpoint
ALTER TABLE "notifications" DROP CONSTRAINT IF EXISTS ck_notifications_category_values;
--> statement-breakpoint
ALTER TABLE "notifications" ADD CONSTRAINT ck_notifications_category_values
  CHECK ("category" IN (
    'limits', 'subscription', 'reconciliation', 'invoice_overdue', 'stock', 'templates', 'crm',
    'einvoicing', 'notes', 'installments', 'budgeting', 'purchasing'
  ));
--> statement-breakpoint
ALTER TABLE "notification_prefs" DROP CONSTRAINT IF EXISTS ck_notification_prefs_category_values;
--> statement-breakpoint
ALTER TABLE "notification_prefs" ADD CONSTRAINT ck_notification_prefs_category_values
  CHECK ("category" IN (
    'limits', 'subscription', 'reconciliation', 'invoice_overdue', 'stock', 'templates', 'crm',
    'einvoicing', 'notes', 'installments', 'budgeting', 'purchasing'
  ));
--> statement-breakpoint
ALTER TABLE "cash_movements" DROP CONSTRAINT IF EXISTS ck_cash_movements_source_shape;
--> statement-breakpoint
ALTER TABLE "cash_movements" ADD CONSTRAINT ck_cash_movements_source_shape CHECK (
  "source_type" IN ('receipt', 'payment', 'cash_transfer', 'expense', 'shift_variance',
                    'sales_invoice', 'rep_settlement', 'note',
                    'payroll_payout', 'employee_loan', 'supplier_advance')
);

--> statement-breakpoint
-- ---------------------------------------------------------------------------
-- 12. Pre-GUC portal resolution (P-05; the 0003 definer-projection
-- discipline): the supplier-portal submission route is PUBLIC — the token
-- IS the credential (the invitation_by_token pattern verbatim: a 256-bit
-- random value, hashed at rest; only the exact-hash match is exposed, so
-- the lookup is unenumerable and revocable). One read-only SECURITY
-- DEFINER projection resolves (rfq, token-hash) → (tenant, supplier,
-- expiry) BEFORE any tenant GUC can exist; the service then re-opens the
-- tenant scope withTenant(...) and re-validates the SAME invite under RLS
-- (the projection is the bootstrapping lookup, never the authority).
-- Ownership: FORCE RLS binds even the table owner, so the projection is
-- owned by erp_definer (the dedicated NOLOGIN BYPASSRLS role).
--> statement-breakpoint
GRANT SELECT ON "rfqs" TO erp_definer;
--> statement-breakpoint
SET ROLE erp_definer;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION erp.portal_resolve_rfq_token(p_rfq_id uuid, p_token_hash text)
RETURNS TABLE (
  "tenantId" uuid, "supplierId" uuid, "expiresAt" timestamptz, "revokedAt" timestamptz
)
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public, erp
AS $$
  SELECT r.tenant_id AS "tenantId",
         (inv->>'supplierId')::uuid AS "supplierId",
         (inv->>'expiresAt')::timestamptz AS "expiresAt",
         (inv->>'revokedAt')::timestamptz AS "revokedAt"
  FROM rfqs r,
       LATERAL jsonb_array_elements(r.portal_invites) inv
  WHERE r.id = p_rfq_id
    AND inv->>'tokenHash' = p_token_hash
    AND jsonb_typeof(r.portal_invites) = 'array'
$$;
--> statement-breakpoint
REVOKE EXECUTE ON FUNCTION erp.portal_resolve_rfq_token(uuid, text) FROM PUBLIC;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION erp.portal_resolve_rfq_token(uuid, text) TO erp_app;
--> statement-breakpoint
RESET ROLE;

--> statement-breakpoint
-- Schema-state marker for /health/ready (mirrors the migration manifest).
INSERT INTO erp._schema_state (key, value) VALUES ('schema_version', 51)
ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, at = now();
