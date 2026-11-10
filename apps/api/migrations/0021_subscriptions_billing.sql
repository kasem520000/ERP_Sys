-- PHASE-014 · migration 0021 · subscriptions, billing, usage & notifications
--
-- Purpose (PHASE-014 §4; SUBSCRIPTION_AND_ENTITLEMENTS §7–§10; A-009):
-- the billing substrate goes live. `subscriptions` gains the full lifecycle
-- columns (trial/grace windows, dunning, provider refs, pending downgrade)
-- and the widened status domain (TRIAL/ACTIVE/PAST_DUE/GRACE_READ_ONLY/
-- SUSPENDED/CANCELLED — the PHASE-004 skeleton's ACTIVE/PAST_DUE/CANCELLED
-- stays a subset, so every existing row keeps validating). Four new
-- tenant-owned tables: `subscription_invoices` (the billing history both
-- payment paths write identically), `billing_events` (append-only event
-- log with webhook idempotency keys — replay protection), `usage_counters`
-- (the §6 read model), and `notifications` + `notification_prefs` (the
-- in-app inbox + per-user preferences). `plans` gains the marketing-surface
-- columns (bilingual positioning, annual price ⚠ PLACEHOLDER, highlight,
-- sort order) — the pricing page renders from these rows only, never from
-- hard-coded page numbers (OQ-002 discipline).
--
-- All prices and numeric limits remain PLACEHOLDER pending OQ-002; the
-- mechanism is normative, the numbers are configuration (RISK-003).
--> statement-breakpoint
SET ROLE erp_migrate;

--> statement-breakpoint
-- ---------------------------------------------------------------------------
-- subscriptions: lifecycle columns (additive) + widened status domain.
--> statement-breakpoint
ALTER TABLE "subscriptions" DROP CONSTRAINT ck_subscriptions_status_values;
--> statement-breakpoint
ALTER TABLE "subscriptions" ADD CONSTRAINT ck_subscriptions_status_values
  CHECK ("status" IN ('TRIAL', 'ACTIVE', 'PAST_DUE', 'GRACE_READ_ONLY', 'SUSPENDED', 'CANCELLED'));
--> statement-breakpoint
ALTER TABLE "subscriptions" ADD COLUMN "provider" text;
--> statement-breakpoint
ALTER TABLE "subscriptions" ADD COLUMN "provider_checkout_ref" text;
--> statement-breakpoint
ALTER TABLE "subscriptions" ADD COLUMN "provider_subscription_ref" text;
--> statement-breakpoint
ALTER TABLE "subscriptions" ADD COLUMN "provider_customer_ref" text;
--> statement-breakpoint
ALTER TABLE "subscriptions" ADD COLUMN "trial_ends_at" timestamptz;
--> statement-breakpoint
ALTER TABLE "subscriptions" ADD COLUMN "grace_ends_at" timestamptz;
--> statement-breakpoint
ALTER TABLE "subscriptions" ADD COLUMN "dunning_step" integer NOT NULL DEFAULT 0;
--> statement-breakpoint
ALTER TABLE "subscriptions" ADD COLUMN "cancel_at_period_end" boolean NOT NULL DEFAULT false;
--> statement-breakpoint
ALTER TABLE "subscriptions" ADD COLUMN "pending_plan_id" uuid
  REFERENCES "plans" ("id") ON DELETE RESTRICT;
--> statement-breakpoint
ALTER TABLE "subscriptions" ADD COLUMN "journey_completed_at" timestamptz;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS ix_subscriptions_tenant_status
  ON "subscriptions" ("tenant_id", "status", "created_at" DESC);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS ix_subscriptions_checkout
  ON "subscriptions" ("provider_checkout_ref");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS ix_subscriptions_trial_ends
  ON "subscriptions" ("trial_ends_at") WHERE "trial_ends_at" IS NOT NULL;

--> statement-breakpoint
-- ---------------------------------------------------------------------------
-- subscription_invoices: the billing history (SUBSCRIPTION §10; A-009).
-- Both payment paths (sandbox provider webhook + manual recording) write
-- the SAME table with the SAME entitlement outcome; `source` distinguishes
-- the origin, `paid_via` the settlement channel. Numbering BI-{yyyy}-{seq:4}.
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "subscription_invoices" (
  "id" uuid NOT NULL,
  "tenant_id" uuid NOT NULL REFERENCES "tenants" ("id") ON DELETE RESTRICT,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "updated_at" timestamptz NOT NULL DEFAULT now(),
  "version" integer NOT NULL DEFAULT 1,
  "subscription_id" uuid NOT NULL REFERENCES "subscriptions" ("id") ON DELETE RESTRICT,
  "number" text NOT NULL,
  "plan_key" text NOT NULL,
  "period_start" date NOT NULL,
  "period_end" date NOT NULL,
  "amount" numeric(19,4) NOT NULL,
  "currency_code" char(3) NOT NULL REFERENCES "currencies" ("code") ON DELETE RESTRICT,
  "status" text NOT NULL DEFAULT 'OPEN',
  "source" text NOT NULL,
  "provider_ref" text,
  "due_date" date NOT NULL,
  "paid_at" timestamptz,
  "paid_via" text,
  "paid_reference" text,
  "recorded_by" uuid REFERENCES "users" ("id") ON DELETE RESTRICT,
  "reason" text,
  "placeholder_price" boolean NOT NULL DEFAULT true,
  CONSTRAINT pk_subscription_invoices PRIMARY KEY ("id"),
  CONSTRAINT uq_subscription_invoices_number UNIQUE ("tenant_id", "number"),
  CONSTRAINT ck_subscription_invoices_status_values CHECK (
    "status" IN ('OPEN', 'PAID', 'VOID', 'UNCOLLECTIBLE')
  ),
  CONSTRAINT ck_subscription_invoices_source_values CHECK (
    "source" IN ('checkout', 'manual', 'trial_credit')
  ),
  CONSTRAINT ck_subscription_invoices_paid_via_values CHECK (
    "paid_via" IS NULL OR "paid_via" IN ('provider_webhook', 'manual_recorded')
  ),
  CONSTRAINT ck_subscription_invoices_amount_nonnegative CHECK ("amount" >= 0),
  CONSTRAINT ck_subscription_invoices_period_window CHECK ("period_start" <= "period_end"),
  CONSTRAINT ck_subscription_invoices_paid_shape CHECK (
    ("status" = 'PAID') = ("paid_at" IS NOT NULL)
  ),
  CONSTRAINT ck_subscription_invoices_reason_length CHECK (
    "reason" IS NULL OR length("reason") BETWEEN 3 AND 500
  )
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS ix_subscription_invoices_tenant
  ON "subscription_invoices" ("tenant_id", "created_at" DESC);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS ix_subscription_invoices_open
  ON "subscription_invoices" ("tenant_id", "status") WHERE "status" = 'OPEN';

--> statement-breakpoint
-- ---------------------------------------------------------------------------
-- billing_events: append-only event log (the auditable billing trail —
-- every lifecycle transition + webhook delivery lands here; the unique
-- idempotency_key is the replay/duplicate-delivery guard, INV-013
-- discipline applied to provider webhooks).
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "billing_events" (
  "id" uuid NOT NULL,
  "tenant_id" uuid NOT NULL REFERENCES "tenants" ("id") ON DELETE RESTRICT,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "type" text NOT NULL,
  "payload" jsonb NOT NULL DEFAULT '{}'::jsonb,
  "idempotency_key" text,
  "actor_id" uuid,
  "via_platform_admin" boolean NOT NULL DEFAULT false,
  "correlation_id" text,
  CONSTRAINT pk_billing_events PRIMARY KEY ("id"),
  CONSTRAINT uq_billing_events_idempotency UNIQUE ("idempotency_key"),
  CONSTRAINT ck_billing_events_type_values CHECK ("type" IN (
    'trial.started', 'trial.expired',
    'checkout.created', 'checkout.completed', 'checkout.expired',
    'payment.succeeded', 'payment.failed',
    'manual_payment.recorded',
    'dunning.warned',
    'grace.entered',
    'suspension.executed',
    'subscription.restored',
    'plan.change.requested', 'plan.changed', 'downgrade.blocked',
    'limit.warning'
  ))
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS ix_billing_events_tenant
  ON "billing_events" ("tenant_id", "created_at" DESC);

--> statement-breakpoint
-- Append-only guard (the audit_events pattern — INV-003 substrate class):
-- UPDATE/DELETE refuse for every role; erp_app holds SELECT/INSERT only.
CREATE OR REPLACE FUNCTION erp.billing_events_guard() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'billing_events are append-only (billing trail): % prohibited', TG_OP;
END
$$ LANGUAGE plpgsql;
--> statement-breakpoint
DROP TRIGGER IF EXISTS trg_billing_events_guard ON "billing_events";
--> statement-breakpoint
CREATE TRIGGER trg_billing_events_guard
  BEFORE UPDATE OR DELETE ON "billing_events"
  FOR EACH ROW EXECUTE FUNCTION erp.billing_events_guard();

--> statement-breakpoint
-- ---------------------------------------------------------------------------
-- usage_counters (SUBSCRIPTION §6 read model): one row per
-- (tenant, counter_key, period). documents_per_month uses 'YYYY-MM'
-- periods; structural counters (users/branches/warehouses/…) stamp 'CURRENT'
-- snapshots. The durable truth for structural counts stays the owning
-- tables; the counter service reconciles both directions.
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "usage_counters" (
  "id" uuid NOT NULL,
  "tenant_id" uuid NOT NULL REFERENCES "tenants" ("id") ON DELETE RESTRICT,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "updated_at" timestamptz NOT NULL DEFAULT now(),
  "version" integer NOT NULL DEFAULT 1,
  "counter_key" text NOT NULL,
  "period" text NOT NULL,
  "value" integer NOT NULL DEFAULT 0,
  CONSTRAINT pk_usage_counters PRIMARY KEY ("id"),
  CONSTRAINT uq_usage_counters_tenant_key_period UNIQUE ("tenant_id", "counter_key", "period"),
  CONSTRAINT ck_usage_counters_key_values CHECK ("counter_key" IN (
    'documents_per_month', 'users', 'branches', 'warehouses',
    'pos_terminals', 'offline_devices', 'industry_addons'
  )),
  CONSTRAINT ck_usage_counters_period_shape CHECK (
    "period" = 'CURRENT' OR "period" ~ '^\d{4}-(0[1-9]|1[0-2])$'
  ),
  CONSTRAINT ck_usage_counters_value_nonnegative CHECK ("value" >= 0)
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS ix_usage_counters_tenant
  ON "usage_counters" ("tenant_id", "counter_key");

--> statement-breakpoint
-- ---------------------------------------------------------------------------
-- notifications: the in-app inbox (PHASE-014 §2.8 — the billing-critical
-- subset: limits, subscription states, reconciliation/assertion failures,
-- invoice.overdue). Bilingual payloads as jsonb {ar,en} (the print_templates
-- locale_variants pattern); `dedupe_key` unique per tenant for
-- once-per-event discipline (e.g. a limit threshold fires once/period).
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "notifications" (
  "id" uuid NOT NULL,
  "tenant_id" uuid NOT NULL REFERENCES "tenants" ("id") ON DELETE RESTRICT,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "updated_at" timestamptz NOT NULL DEFAULT now(),
  "version" integer NOT NULL DEFAULT 1,
  "user_id" uuid REFERENCES "users" ("id") ON DELETE CASCADE,
  "category" text NOT NULL,
  "severity" text NOT NULL DEFAULT 'info',
  "title" jsonb NOT NULL,
  "body" jsonb NOT NULL DEFAULT '{}'::jsonb,
  "action_label" jsonb,
  "action_url" text,
  "dedupe_key" text,
  "read_at" timestamptz,
  CONSTRAINT pk_notifications PRIMARY KEY ("id"),
  CONSTRAINT uq_notifications_dedupe UNIQUE ("tenant_id", "dedupe_key"),
  CONSTRAINT ck_notifications_category_values CHECK ("category" IN (
    'limits', 'subscription', 'reconciliation', 'invoice_overdue'
  )),
  CONSTRAINT ck_notifications_severity_values CHECK ("severity" IN ('info', 'warning', 'critical'))
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS ix_notifications_tenant_created
  ON "notifications" ("tenant_id", "created_at" DESC);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS ix_notifications_unread
  ON "notifications" ("tenant_id", "read_at") WHERE "read_at" IS NULL;

--> statement-breakpoint
-- notification_prefs: per-user channel toggles (in-app / email) per
-- category. Default-on (absent rows = both channels) — preferences suppress,
-- they never fabricate.
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "notification_prefs" (
  "id" uuid NOT NULL,
  "tenant_id" uuid NOT NULL REFERENCES "tenants" ("id") ON DELETE RESTRICT,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "updated_at" timestamptz NOT NULL DEFAULT now(),
  "version" integer NOT NULL DEFAULT 1,
  "user_id" uuid NOT NULL REFERENCES "users" ("id") ON DELETE CASCADE,
  "category" text NOT NULL,
  "in_app" boolean NOT NULL DEFAULT true,
  "email" boolean NOT NULL DEFAULT true,
  CONSTRAINT pk_notification_prefs PRIMARY KEY ("id"),
  CONSTRAINT uq_notification_prefs_user_category UNIQUE ("user_id", "category"),
  CONSTRAINT ck_notification_prefs_category_values CHECK ("category" IN (
    'limits', 'subscription', 'reconciliation', 'invoice_overdue'
  ))
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS ix_notification_prefs_tenant
  ON "notification_prefs" ("tenant_id", "user_id");

--> statement-breakpoint
-- ---------------------------------------------------------------------------
-- plans: marketing-surface columns (pricing page renders from these rows
-- only — no hard-coded numbers in the page; PLACEHOLDER prices ⚠ OQ-002).
--> statement-breakpoint
ALTER TABLE "plans" ADD COLUMN "positioning" jsonb;
--> statement-breakpoint
ALTER TABLE "plans" ADD COLUMN "annual_price_amount" numeric(19,4) NOT NULL DEFAULT 0;
--> statement-breakpoint
ALTER TABLE "plans" ADD COLUMN "highlight" boolean NOT NULL DEFAULT false;
--> statement-breakpoint
ALTER TABLE "plans" ADD COLUMN "sort_order" integer NOT NULL DEFAULT 0;
--> statement-breakpoint
UPDATE "plans" SET
  "positioning" = CASE "key"
    WHEN 'starter' THEN '{"ar":"البداية — المتاجر الصغيرة، فريق من 1–3، الهاتف أولًا","en":"The start — micro shops, 1–3 people, phone-first"}'::jsonb
    WHEN 'business' THEN '{"ar":"الأعمال — الشركات الصغيرة والمتوسطة: تجارة + نقاط بيع + قوالب","en":"For business — SMBs needing trade + POS + templates"}'::jsonb
    WHEN 'enterprise' THEN '{"ar":"المؤسسات — تعدد الفروع، التصنيع والتوزيع، حجم API","en":"Enterprise — multi-branch, manufacturing/distribution, API volume"}'::jsonb
  END,
  "annual_price_amount" = 0,
  "highlight" = ("key" = 'business'),
  "sort_order" = CASE "key"
    WHEN 'starter' THEN 1
    WHEN 'business' THEN 2
    WHEN 'enterprise' THEN 3
  END,
  "updated_at" = now()
WHERE "key" IN ('starter', 'business', 'enterprise');

--> statement-breakpoint
-- RLS (TENANT_ISOLATION §2) — the macro on every new tenant-owned table.
SELECT erp.apply_tenant_policy('"subscription_invoices"');
--> statement-breakpoint
SELECT erp.apply_tenant_policy('"billing_events"');
--> statement-breakpoint
SELECT erp.apply_tenant_policy('"usage_counters"');
--> statement-breakpoint
SELECT erp.apply_tenant_policy('"notifications"');
--> statement-breakpoint
SELECT erp.apply_tenant_policy('"notification_prefs"');

--> statement-breakpoint
-- Grants (the per-table shape; billing_events is append-only by grant +
-- guard — SELECT/INSERT only, mirroring audit_events).
REVOKE ALL ON "subscription_invoices", "billing_events", "usage_counters", "notifications", "notification_prefs" FROM erp_app;
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE ON "subscription_invoices" TO erp_app;
--> statement-breakpoint
GRANT SELECT, INSERT ON "billing_events" TO erp_app;
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE ON "usage_counters" TO erp_app;
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE ON "notifications" TO erp_app;
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE ON "notification_prefs" TO erp_app;
--> statement-breakpoint
GRANT SELECT ON "subscription_invoices", "billing_events", "usage_counters", "notifications", "notification_prefs" TO erp_readonly;
--> statement-breakpoint
RESET ROLE;
--> statement-breakpoint
GRANT SELECT ON "subscription_invoices", "billing_events", "usage_counters", "notifications", "notification_prefs" TO erp_definer;
--> statement-breakpoint
SET ROLE erp_migrate;

--> statement-breakpoint
-- ---------------------------------------------------------------------------
-- Pre-GUC definer projections (the migration-0006 pattern): the read-only
-- interceptor and the usage-limit guard resolve the tenant's billing state
-- BEFORE any tenant UoW exists (guards run before the interceptor commits
-- a scope). NOLOGIN BYPASSRLS owner; EXECUTE granted to erp_app only.
--> statement-breakpoint
SET ROLE erp_definer;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION erp.tenant_subscription_state(p_tenant_id uuid)
RETURNS TABLE (
  id uuid, status text, plan_id uuid, period_start date, period_end date,
  trial_ends_at timestamptz, grace_ends_at timestamptz, dunning_step integer,
  cancel_at_period_end boolean, pending_plan_id uuid
)
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public, erp
AS $$
  SELECT s.id, s.status, s.plan_id, s.period_start, s.period_end,
         s.trial_ends_at, s.grace_ends_at, s.dunning_step,
         s.cancel_at_period_end, s.pending_plan_id
  FROM subscriptions s
  WHERE s.tenant_id = p_tenant_id AND s.status <> 'CANCELLED'
  ORDER BY s.created_at DESC
  LIMIT 1
$$;
--> statement-breakpoint
REVOKE EXECUTE ON FUNCTION erp.tenant_subscription_state(uuid) FROM PUBLIC;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION erp.tenant_subscription_state(uuid) TO erp_app;
--> statement-breakpoint
-- Billing snapshot for the usage-limit guard (pre-GUC): the latest
-- non-cancelled subscription + its plan (key + limits jsonb) + the live
-- structural usage the §6 matrix gates (active memberships, active
-- branches, active warehouses). One jsonb, one round trip per request.
CREATE OR REPLACE FUNCTION erp.tenant_billing_snapshot(p_tenant_id uuid)
RETURNS jsonb
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public, erp
AS $$
  SELECT jsonb_build_object(
    'subscription', (
      SELECT jsonb_build_object(
        'id', s.id, 'status', s.status, 'planId', s.plan_id,
        'periodStart', s.period_start, 'periodEnd', s.period_end,
        'trialEndsAt', s.trial_ends_at, 'graceEndsAt', s.grace_ends_at,
        'dunningStep', s.dunning_step,
        'cancelAtPeriodEnd', s.cancel_at_period_end,
        'pendingPlanId', s.pending_plan_id
      )
      FROM subscriptions s
      WHERE s.tenant_id = p_tenant_id AND s.status <> 'CANCELLED'
      ORDER BY s.created_at DESC LIMIT 1
    ),
    'plan', (
      SELECT jsonb_build_object('key', p.key, 'limits', p.limits)
      FROM plans p
      WHERE p.id = (
        SELECT s2.plan_id FROM subscriptions s2
        WHERE s2.tenant_id = p_tenant_id AND s2.status <> 'CANCELLED'
        ORDER BY s2.created_at DESC LIMIT 1
      )
    ),
    'usage', jsonb_build_object(
      'users', (SELECT count(*) FROM memberships m
                WHERE m.tenant_id = p_tenant_id AND m.status = 'ACTIVE'),
      'branches', (SELECT count(*) FROM branches b
                   WHERE b.tenant_id = p_tenant_id AND b.is_active),
      'warehouses', (SELECT count(*) FROM warehouses w
                     WHERE w.tenant_id = p_tenant_id AND w.is_active)
    )
  )
$$;
--> statement-breakpoint
REVOKE EXECUTE ON FUNCTION erp.tenant_billing_snapshot(uuid) FROM PUBLIC;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION erp.tenant_billing_snapshot(uuid) TO erp_app;
--> statement-breakpoint
-- Anonymous webhook resolution: the signed payload's session_ref → the
-- invoice row + its tenant (the external webhook route has no session;
-- signature verification is the authority, this lookup is the target).
CREATE OR REPLACE FUNCTION erp.subscription_invoice_by_ref(p_ref text)
RETURNS TABLE (
  tenant_id uuid, id uuid, number text, status text, amount numeric,
  currency_code text, plan_key text, period_start date, period_end date,
  source text, due_date date, paid_via text, provider_ref text
)
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public, erp
AS $$
  SELECT i.tenant_id, i.id, i.number, i.status, i.amount, i.currency_code,
         i.plan_key, i.period_start, i.period_end, i.source, i.due_date,
         i.paid_via, i.provider_ref
  FROM subscription_invoices i
  WHERE i.provider_ref = p_ref
  ORDER BY i.created_at DESC
  LIMIT 1
$$;
--> statement-breakpoint
REVOKE EXECUTE ON FUNCTION erp.subscription_invoice_by_ref(text) FROM PUBLIC;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION erp.subscription_invoice_by_ref(text) TO erp_app;
--> statement-breakpoint
-- The daily-pass worklist (platform scope; subscriptions are tenant-RLS'd
-- so the platform GUC cannot list them — this definer projection is the
-- sanctioned cross-tenant read for the billing scheduler).
CREATE OR REPLACE FUNCTION erp.subscriptions_needing_attention()
RETURNS TABLE (
  tenant_id uuid, subscription_id uuid, plan_id uuid, status text,
  trial_ends_at timestamptz, grace_ends_at timestamptz, dunning_step integer,
  period_end date, pending_plan_id uuid, cancel_at_period_end boolean
)
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public, erp
AS $$
  SELECT DISTINCT ON (s.tenant_id)
    s.tenant_id, s.id, s.plan_id, s.status,
    s.trial_ends_at, s.grace_ends_at, s.dunning_step,
    s.period_end, s.pending_plan_id, s.cancel_at_period_end
  FROM subscriptions s
  WHERE s.status IN ('TRIAL', 'PAST_DUE', 'GRACE_READ_ONLY', 'ACTIVE')
    AND s.tenant_id <> '20000000-0000-4000-8000-000000000001'
  ORDER BY s.tenant_id, s.created_at DESC
$$;
--> statement-breakpoint
REVOKE EXECUTE ON FUNCTION erp.subscriptions_needing_attention() FROM PUBLIC;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION erp.subscriptions_needing_attention() TO erp_app;
--> statement-breakpoint
SET ROLE erp_migrate;

--> statement-breakpoint
-- Schema-state marker for /health/ready (mirrors the migration manifest).
INSERT INTO erp._schema_state (key, value) VALUES ('schema_version', 21)
ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, at = now();

--> statement-breakpoint
RESET ROLE;
