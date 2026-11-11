-- PHASE-039 (Blueprint v3.0 · CR-09; scope extended by v3.1/CR-46) ·
-- migration 0056 · Returns & Collections II — the dunning engine, late
-- fees and collection actions (H-13/S-16 · L1-12)
--
-- Purpose (PHASE-039 §4 Design Impact): collections become an
-- escalating, logged, template-driven process tied to the aging report:
--
--   dunning_policies — the step ladder: steps jsonb [{stepNo,
--     daysOverdue, channel: EMAIL|WHATSAPP|SMS, templateKey,
--     escalate, referToAgency?}] — ascending, monotonic (BR-065:
--     steps advance, never skip or regress — the service guard +
--     the UNIQUE letters shape). Late-fee rules live ON the policy
--     (L1-12): mode CONTRACT_RATE (tenant's contractual rate) |
--     STATUTORY_CAP (only from verified jurisdiction sources —
--     REQUIRES_VERIFICATION, the rate carries its source evidence or
--     the fee run refuses to post: worksheet mode) | DISABLED.
--   dunning_letters — one row per (invoice, step): QUEUED → SENT |
--     FAILED; the UNIQUE (tenant, invoice, step_no) IS the BR-065
--     monotonic evidence (a step never re-fires; the sweep only
--     advances). The fee register rides the letter that invoked the
--     charge: fee_amount / fee_invoice_id / fee_waived_* columns.
--   collection_actions — the logged human/agency actions (calls,
--     promises-to-pay, disputes, agency referrals) with outcome codes
--     — the ladder's working memory, never a posting.
--
-- Widened CHECKs (the §11b 0051 discipline): notifications +
-- notification_prefs categories += 'collections','warranties';
-- cash_movements source_type += 'return_authorization' (the G-37
-- refund leg).
--
-- INV-022 ledger: +3 tables (of the phase's +10), +1 journal family
-- (the late-fee invoice posts through the SALES engine with VAT
-- treatment — G-04 lineage; the waiver path never posts, it marks).
-- Permissions: ALL NINE phase keys seeded here (§9) — 256 → 265.
-- Feature keys: ALL FOUR (§10) — sales.rma, sales.warranties,
-- sales.dunning, purchasing.rma → business + enterprise.
--
-- Grants: all three SELECT/INSERT/UPDATE — NO DELETE (the ladder and
-- its letters are compliance history).

--> statement-breakpoint
SET ROLE erp_migrate;

--> statement-breakpoint
-- ---------------------------------------------------------------------------
-- 1. dunning_policies (T-06): the step ladder + late-fee rules (L1-12).
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "dunning_policies" (
  "id" uuid NOT NULL,
  "tenant_id" uuid NOT NULL REFERENCES "tenants" ("id") ON DELETE RESTRICT,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "updated_at" timestamptz NOT NULL DEFAULT now(),
  "version" integer NOT NULL DEFAULT 1,
  "created_by" uuid,
  "name" text NOT NULL,
  "name_ar" text,
  "status" text NOT NULL DEFAULT 'DRAFT',
  -- Attachment scope: the partner-tier ids this policy applies to
  -- (empty = the tenant default when is_default).
  "partner_tier_ids" jsonb NOT NULL DEFAULT '[]'::jsonb,
  "is_default" boolean NOT NULL DEFAULT false,
  -- The ladder (BR-065 monotonic): [{stepNo:1..N, daysOverdue:asc>0,
  -- channel, templateKey, escalate, referToAgency}] — service-validated
  -- ascending order; the CHECK pins the array shape.
  "steps" jsonb NOT NULL,
  -- Late-fee rules (L1-12) ON the policy.
  "late_fee_mode" text NOT NULL DEFAULT 'DISABLED',
  "late_fee_rate_pct" numeric(5,2),
  "late_fee_grace_days" integer NOT NULL DEFAULT 0,
  "late_fee_max_amount" numeric(19,4),
  -- REQUIRES_VERIFICATION evidence for STATUTORY_CAP rates (the
  -- jurisdiction source citation; NULL on CONTRACT_RATE/DISABLED).
  "late_fee_source" text,
  "note" text,
  "note_ar" text,
  CONSTRAINT "pk_dunning_policies" PRIMARY KEY ("id"),
  CONSTRAINT "uq_dunning_policies_id_tenant" UNIQUE ("id", "tenant_id"),
  CONSTRAINT "ck_dunning_policies_status" CHECK ("status" IN ('DRAFT','ACTIVE','ARCHIVED')),
  CONSTRAINT "ck_dunning_policies_steps_shape" CHECK (
    jsonb_typeof("steps") = 'array' AND jsonb_array_length("steps") > 0
  ),
  CONSTRAINT "ck_dunning_policies_late_fee_mode" CHECK (
    "late_fee_mode" IN ('DISABLED','CONTRACT_RATE','STATUTORY_CAP')
  ),
  CONSTRAINT "ck_dunning_policies_late_fee_shape" CHECK (
    ("late_fee_mode" = 'DISABLED')
    OR ("late_fee_mode" = 'CONTRACT_RATE'
        AND "late_fee_rate_pct" IS NOT NULL AND "late_fee_rate_pct" > 0)
    OR ("late_fee_mode" = 'STATUTORY_CAP'
        AND "late_fee_rate_pct" IS NOT NULL AND "late_fee_rate_pct" > 0
        AND "late_fee_source" IS NOT NULL AND char_length("late_fee_source") BETWEEN 3 AND 500)
  ),
  CONSTRAINT "ck_dunning_policies_tiers_shape" CHECK (jsonb_typeof("partner_tier_ids") = 'array')
);

--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "ix_dunning_policies_tenant_status"
  ON "dunning_policies" ("tenant_id", "status");

--> statement-breakpoint
-- ---------------------------------------------------------------------------
-- 2. dunning_letters (T-07): one row per (invoice, step) — the BR-065
-- monotonic evidence + the late-fee register (L1-12).
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "dunning_letters" (
  "id" uuid NOT NULL,
  "tenant_id" uuid NOT NULL REFERENCES "tenants" ("id") ON DELETE RESTRICT,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "updated_at" timestamptz NOT NULL DEFAULT now(),
  "version" integer NOT NULL DEFAULT 1,
  "policy_id" uuid NOT NULL,
  "partner_id" uuid NOT NULL,
  "invoice_id" uuid NOT NULL,
  "step_no" integer NOT NULL,
  "days_overdue" integer NOT NULL,
  "letter_date" date NOT NULL,
  -- EMAIL live now; WHATSAPP/SMS stored, delivered post-041 through the
  -- channel-port (the phase doc's explicit deferral).
  "channel" text NOT NULL,
  "template_key" text NOT NULL,
  "status" text NOT NULL DEFAULT 'QUEUED',
  "sent_at" timestamptz,
  "email_to" text,
  "subject" text,
  "body_snapshot" text,
  "error" text,
  -- The late-fee register (L1-12): stamped by the step that charged it.
  "fee_amount" numeric(19,4),
  "fee_invoice_id" uuid,
  "fee_waived_at" timestamptz,
  "fee_waived_by" uuid,
  "fee_waiver_reason" text,
  CONSTRAINT "pk_dunning_letters" PRIMARY KEY ("id"),
  CONSTRAINT "uq_dunning_letters_id_tenant" UNIQUE ("id", "tenant_id"),
  -- BR-065's monotonic evidence: a step fires at most once per invoice.
  CONSTRAINT "uq_dunning_letters_invoice_step" UNIQUE ("tenant_id", "invoice_id", "step_no"),
  CONSTRAINT "ck_dunning_letters_status" CHECK ("status" IN ('QUEUED','SENT','FAILED')),
  CONSTRAINT "ck_dunning_letters_channel" CHECK ("channel" IN ('EMAIL','WHATSAPP','SMS')),
  CONSTRAINT "ck_dunning_letters_step" CHECK ("step_no" >= 1 AND "days_overdue" > 0),
  CONSTRAINT "ck_dunning_letters_fee_shape" CHECK (
    ("fee_amount" IS NULL AND "fee_invoice_id" IS NULL)
    OR ("fee_amount" IS NOT NULL AND "fee_amount" > 0)
  ),
  -- A waiver needs its reason + approver (the L1-12 waiver path).
  CONSTRAINT "ck_dunning_letters_fee_waiver" CHECK (
    ("fee_waived_at" IS NULL AND "fee_waived_by" IS NULL AND "fee_waiver_reason" IS NULL)
    OR ("fee_waived_at" IS NOT NULL AND "fee_waived_by" IS NOT NULL
        AND "fee_waiver_reason" IS NOT NULL AND char_length("fee_waiver_reason") BETWEEN 3 AND 500)
  )
);

--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "ix_dunning_letters_tenant_invoice"
  ON "dunning_letters" ("tenant_id", "invoice_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "ix_dunning_letters_tenant_partner"
  ON "dunning_letters" ("tenant_id", "partner_id", "letter_date");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "ix_dunning_letters_tenant_status"
  ON "dunning_letters" ("tenant_id", "status");

--> statement-breakpoint
-- ---------------------------------------------------------------------------
-- 3. collection_actions (T-08): the logged actions with outcome codes.
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "collection_actions" (
  "id" uuid NOT NULL,
  "tenant_id" uuid NOT NULL REFERENCES "tenants" ("id") ON DELETE RESTRICT,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "updated_at" timestamptz NOT NULL DEFAULT now(),
  "version" integer NOT NULL DEFAULT 1,
  "created_by" uuid,
  "partner_id" uuid NOT NULL,
  "invoice_id" uuid,
  "policy_id" uuid,
  "action_type" text NOT NULL,
  "action_date" date NOT NULL,
  "outcome" text NOT NULL DEFAULT 'PENDING',
  "promised_date" date,
  "follow_up_date" date,
  "amount" numeric(19,4),
  "note" text,
  "note_ar" text,
  CONSTRAINT "pk_collection_actions" PRIMARY KEY ("id"),
  CONSTRAINT "uq_collection_actions_id_tenant" UNIQUE ("id", "tenant_id"),
  CONSTRAINT "ck_collection_actions_type" CHECK (
    "action_type" IN ('CALL','EMAIL','PROMISE_TO_PAY','DISPUTE','FIELD_VISIT',
                      'PAYMENT_PLAN','WRITE_OFF_REQUEST','AGENCY_REFERRAL','OTHER')
  ),
  CONSTRAINT "ck_collection_actions_outcome" CHECK (
    "outcome" IN ('PENDING','PROMISED','BROKEN','PAID','ESCALATED','NO_ANSWER','OTHER')
  ),
  -- A promise carries its date (the promise-to-pay discipline).
  CONSTRAINT "ck_collection_actions_promise" CHECK (
    "action_type" <> 'PROMISE_TO_PAY' OR "promised_date" IS NOT NULL
  )
);

--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "ix_collection_actions_tenant_partner"
  ON "collection_actions" ("tenant_id", "partner_id", "action_date");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "ix_collection_actions_tenant_invoice"
  ON "collection_actions" ("tenant_id", "invoice_id");

--> statement-breakpoint
-- ---------------------------------------------------------------------------
-- 4. Composite tenant FKs.
--> statement-breakpoint
ALTER TABLE "dunning_policies" DROP CONSTRAINT IF EXISTS fk_dunning_policies_creator;
--> statement-breakpoint
ALTER TABLE "dunning_policies"
  ADD CONSTRAINT fk_dunning_policies_creator FOREIGN KEY ("created_by")
    REFERENCES "users" ("id") ON DELETE SET NULL;
--> statement-breakpoint
ALTER TABLE "dunning_letters" DROP CONSTRAINT IF EXISTS fk_dunning_letters_policy;
--> statement-breakpoint
ALTER TABLE "dunning_letters"
  ADD CONSTRAINT fk_dunning_letters_policy FOREIGN KEY ("policy_id", "tenant_id")
    REFERENCES "dunning_policies" ("id", "tenant_id") ON DELETE RESTRICT;
--> statement-breakpoint
ALTER TABLE "dunning_letters" DROP CONSTRAINT IF EXISTS fk_dunning_letters_partner;
--> statement-breakpoint
ALTER TABLE "dunning_letters"
  ADD CONSTRAINT fk_dunning_letters_partner FOREIGN KEY ("partner_id", "tenant_id")
    REFERENCES "partners" ("id", "tenant_id") ON DELETE RESTRICT;
--> statement-breakpoint
ALTER TABLE "dunning_letters" DROP CONSTRAINT IF EXISTS fk_dunning_letters_invoice;
--> statement-breakpoint
ALTER TABLE "dunning_letters"
  ADD CONSTRAINT fk_dunning_letters_invoice FOREIGN KEY ("invoice_id", "tenant_id")
    REFERENCES "sales_invoices" ("id", "tenant_id") ON DELETE RESTRICT;
--> statement-breakpoint
ALTER TABLE "dunning_letters" DROP CONSTRAINT IF EXISTS fk_dunning_letters_fee_invoice;
--> statement-breakpoint
ALTER TABLE "dunning_letters"
  ADD CONSTRAINT fk_dunning_letters_fee_invoice FOREIGN KEY ("fee_invoice_id", "tenant_id")
    REFERENCES "sales_invoices" ("id", "tenant_id") ON DELETE RESTRICT;
--> statement-breakpoint
ALTER TABLE "dunning_letters" DROP CONSTRAINT IF EXISTS fk_dunning_letters_waived_by;
--> statement-breakpoint
ALTER TABLE "dunning_letters"
  ADD CONSTRAINT fk_dunning_letters_waived_by FOREIGN KEY ("fee_waived_by")
    REFERENCES "users" ("id") ON DELETE SET NULL;
--> statement-breakpoint
ALTER TABLE "collection_actions" DROP CONSTRAINT IF EXISTS fk_collection_actions_partner;
--> statement-breakpoint
ALTER TABLE "collection_actions"
  ADD CONSTRAINT fk_collection_actions_partner FOREIGN KEY ("partner_id", "tenant_id")
    REFERENCES "partners" ("id", "tenant_id") ON DELETE RESTRICT;
--> statement-breakpoint
ALTER TABLE "collection_actions" DROP CONSTRAINT IF EXISTS fk_collection_actions_invoice;
--> statement-breakpoint
ALTER TABLE "collection_actions"
  ADD CONSTRAINT fk_collection_actions_invoice FOREIGN KEY ("invoice_id", "tenant_id")
    REFERENCES "sales_invoices" ("id", "tenant_id") ON DELETE RESTRICT;
--> statement-breakpoint
ALTER TABLE "collection_actions" DROP CONSTRAINT IF EXISTS fk_collection_actions_policy;
--> statement-breakpoint
ALTER TABLE "collection_actions"
  ADD CONSTRAINT fk_collection_actions_policy FOREIGN KEY ("policy_id", "tenant_id")
    REFERENCES "dunning_policies" ("id", "tenant_id") ON DELETE SET NULL;

--> statement-breakpoint
-- ---------------------------------------------------------------------------
-- 5. RLS.
--> statement-breakpoint
ALTER TABLE "dunning_policies" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "dunning_policies" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
SELECT erp.apply_tenant_policy('"dunning_policies"');
--> statement-breakpoint
ALTER TABLE "dunning_letters" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "dunning_letters" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
SELECT erp.apply_tenant_policy('"dunning_letters"');
--> statement-breakpoint
ALTER TABLE "collection_actions" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "collection_actions" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
SELECT erp.apply_tenant_policy('"collection_actions"');

--> statement-breakpoint
-- ---------------------------------------------------------------------------
-- 6. Purge path (the house discipline).
--> statement-breakpoint
DO $$
DECLARE
  t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['dunning_policies', 'dunning_letters', 'collection_actions'] LOOP
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
-- 7. Grants: all three SELECT/INSERT/UPDATE — NO DELETE (compliance
-- history).
--> statement-breakpoint
REVOKE ALL ON "dunning_policies", "dunning_letters", "collection_actions" FROM erp_app;
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE ON "dunning_policies", "dunning_letters", "collection_actions" TO erp_app;
--> statement-breakpoint
GRANT SELECT ON "dunning_policies", "dunning_letters", "collection_actions" TO erp_readonly;
--> statement-breakpoint
GRANT SELECT ON "dunning_policies", "dunning_letters", "collection_actions" TO erp_definer;

--> statement-breakpoint
-- ---------------------------------------------------------------------------
-- 8. CHECK widenings (the §11b 0051 discipline): the notifications
-- categories gain 'collections' (dunning letters + credit reviews) and
-- 'warranties' (the expiry sweep); cash_movements gains the G-37 refund
-- source.
--> statement-breakpoint
ALTER TABLE "notifications" DROP CONSTRAINT IF EXISTS ck_notifications_category_values;
--> statement-breakpoint
ALTER TABLE "notifications" ADD CONSTRAINT ck_notifications_category_values
  CHECK ("category" IN (
    'limits', 'subscription', 'reconciliation', 'invoice_overdue', 'stock', 'templates', 'crm',
    'einvoicing', 'notes', 'installments', 'budgeting', 'purchasing', 'collections', 'warranties'
  ));
--> statement-breakpoint
ALTER TABLE "notification_prefs" DROP CONSTRAINT IF EXISTS ck_notification_prefs_category_values;
--> statement-breakpoint
ALTER TABLE "notification_prefs" ADD CONSTRAINT ck_notification_prefs_category_values
  CHECK ("category" IN (
    'limits', 'subscription', 'reconciliation', 'invoice_overdue', 'stock', 'templates', 'crm',
    'einvoicing', 'notes', 'installments', 'budgeting', 'purchasing', 'collections', 'warranties'
  ));
--> statement-breakpoint
ALTER TABLE "cash_movements" DROP CONSTRAINT IF EXISTS ck_cash_movements_source_shape;
--> statement-breakpoint
ALTER TABLE "cash_movements" ADD CONSTRAINT ck_cash_movements_source_shape CHECK (
  "source_type" IN ('receipt', 'payment', 'cash_transfer', 'expense', 'shift_variance',
                    'sales_invoice', 'rep_settlement', 'note',
                    'payroll_payout', 'employee_loan', 'supplier_advance',
                    'return_authorization')
);

--> statement-breakpoint
-- ---------------------------------------------------------------------------
-- 9. Permission seed (PHASE-039 §4): the NINE keys (matrix §3.9/§3.16) —
-- zero-drift extends 256 → 265 (seed = mirror; the drift CLI joins this
-- file). Owner template cross-join re-runs idempotently; accountant
-- gains the read + dunning keys; the sales template gains the RMA/
-- dunning/warranty keys; the purchasing template gains the supplier-RMA
-- pair.
--> statement-breakpoint
INSERT INTO "permissions" ("key", "module", "description") VALUES
('sales.rma.read', 'sales', 'View RMAs and the returns workspace (customer + supplier families) / عرض المرتجعات ومساحة عملها (العملاء والموردون)'),
('sales.rma.manage', 'sales', 'Create and progress customer RMAs through the lifecycle / إنشاء وتسيير مرتجعات العملاء عبر دورة الحياة'),
('sales.rma.approve', 'sales', 'Approve customer RMAs (SoD: creator ≠ approver) / اعتماد مرتجعات العملاء (الفصل: المنشئ ≠ المعتمد)'),
('sales.dunning.manage', 'sales', 'Manage dunning policies, letters, collection actions and referrals / إدارة سياسات التحصيل والرسائل وإجراءات التحصيل والإحالات'),
('sales.warranties.manage', 'sales', 'Manage warranty registrations and structured terms / إدارة تسجيلات الضمان وشروطها المهيكلة'),
('sales.late-fees.manage', 'sales', 'Charge and waive late-payment fees (L1-12) / احتساب وإعفاء غرامات التأخير'),
('sales.collection-agencies.manage', 'sales', 'Manage collection agencies, referrals and commission postings (L1-11) / إدارة وكالات التحصيل والإحالات وقيود العمولة'),
('purchasing.rma.read', 'purchasing', 'View supplier return authorizations / عرض طلبات إرجاع الموردين'),
('purchasing.rma.manage', 'purchasing', 'Create and progress supplier RMAs to the debit note / إنشاء وتسيير مرتجعات الموردين حتى إشعار المدين')
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
  AND p."key" IN ('sales.rma.read', 'purchasing.rma.read', 'sales.dunning.manage',
                  'sales.late-fees.manage', 'sales.collection-agencies.manage')
ON CONFLICT ("role_id", "permission_id") DO NOTHING;
--> statement-breakpoint
INSERT INTO "role_permissions" ("role_id", "tenant_id", "permission_id")
SELECT r."id", NULL, p."key"
FROM "roles" r CROSS JOIN "permissions" p
WHERE r."key" = 'sales' AND r."tenant_id" IS NULL
  AND p."key" IN ('sales.rma.read', 'sales.rma.manage', 'sales.rma.approve',
                  'sales.dunning.manage', 'sales.warranties.manage')
ON CONFLICT ("role_id", "permission_id") DO NOTHING;
--> statement-breakpoint
INSERT INTO "role_permissions" ("role_id", "tenant_id", "permission_id")
SELECT r."id", NULL, p."key"
FROM "roles" r CROSS JOIN "permissions" p
WHERE r."key" = 'purchasing' AND r."tenant_id" IS NULL
  AND p."key" IN ('purchasing.rma.read', 'purchasing.rma.manage', 'sales.rma.read')
ON CONFLICT ("role_id", "permission_id") DO NOTHING;

--> statement-breakpoint
-- ---------------------------------------------------------------------------
-- 10. Feature plan grants (the 0051 tier-4 precedent): the FOUR keys →
-- business + enterprise (starter excluded). Template-composable grants
-- unchanged (CR-36 f); FEATURE_CATALOG.md carries the catalog rows.
--> statement-breakpoint
UPDATE "plans" SET "feature_keys" = array_cat("feature_keys",
  ARRAY['sales.rma', 'sales.warranties', 'sales.dunning', 'purchasing.rma'])
WHERE "key" IN ('business', 'enterprise')
  AND NOT ('sales.rma' = ANY("feature_keys"));

--> statement-breakpoint
-- ---------------------------------------------------------------------------
-- 11. Bilingual table comments.
--> statement-breakpoint
COMMENT ON TABLE "dunning_policies" IS 'PHASE-039: the dunning step ladder (days×channel×template, BR-065 monotonic) + late-fee rules (L1-12) / سلّم خطوات التحصيل مع قواعد غرامات التأخير';
--> statement-breakpoint
COMMENT ON TABLE "dunning_letters" IS 'PHASE-039: one letter per (invoice, step) — the BR-065 evidence + the late-fee register / رسالة تحصيل واحدة لكل (فاتورة، خطوة) مع سجل الغرامات';
--> statement-breakpoint
COMMENT ON TABLE "collection_actions" IS 'PHASE-039: logged collection actions with outcome codes / إجراءات التحصيل المسجلة برموز النتائج';

--> statement-breakpoint
RESET ROLE;

--> statement-breakpoint
-- Schema-state marker for /health/ready (mirrors the migration manifest).
INSERT INTO erp._schema_state (key, value) VALUES ('schema_version', 56)
ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, at = now();
