-- PHASE-041 (Blueprint v3.0 · CR-11) · migration 0064 · Communications Hub
--
-- Purpose (PHASE-041 §2): fulfil the channel-port promise the audit found
-- hollow (H-22: "SMS providers TBD per market" — in the Arab market
-- WhatsApp IS the business channel). This migration lays the four RLS'd
-- tables; the adapters/pipeline are application code:
--
--   message_templates (FD-30) — the tenant email/print template substrate
--     the audit found missing ("no email_templates — strings in code"):
--     channel × locale × module templates with typed variable
--     declarations, tenant-editable; the builtin catalog in code is the
--     fallback so tenants start from working AR/EN defaults.
--   outbound_messages — the send ledger: every outbound send is a row
--     with status QUEUED/SENT/DELIVERED/FAILED, provider id + provider
--     reference, cost (numeric 19,4 — the house money convention), the
--     retry policy columns (attempts/max_attempts/next_attempt_at), the
--     deterministic rendered snapshot, and the source linkage
--     (source_type/source_id) the dunning letters (039/036 handoff),
--     digest and nudges ride.
--   notification_preferences (TB-23) — the user × module × channel
--     matrix (IN_APP/EMAIL/SMS/WHATSAPP). user_id NULL = the TENANT
--     DEFAULT row (seeded below for existing tenants; materialized
--     lazily for new ones). The dispatch resolver honors it end-to-end.
--   communication_log (UX-14/IN-16) — the unified interaction log:
--     outbound/inbound messages + manually logged calls (outcome +
--     duration, partner + user links) feeding the unified inbox surface
--     with per-partner filters.
--
-- Numbering note (the 0060 pattern): the phase doc planned
-- `0059_communications_hub.sql` "journal 58 → 59" — written before the
-- v3.2/CR-50 R-03 extension (0055–0059) and PHASE-040's 0060–0063; this
-- migration is therefore 0064 (journal idx 63, schema_version 64).
-- Likewise the doc's counters predate 039/040: permissions extend
-- 267 → 272 (not 263 → 268), ENTITY_CATALOG moves 228 → 232 (not
-- 224 → 228), and the report registry moves 90 → 91.
--
-- Preference-default seeding decision (documented): the module
-- vocabulary is the EXISTING in-app notification category list
-- (notifications module, PHASE-014→039) + `digest` — one vocabulary, so
-- the matrix UI groups exactly like the in-app feed; the completion
-- report records the category≡module mapping. Tenant-default rows
-- (user_id NULL) seed for EXISTING tenants with the paid-channels-off
-- discipline: IN_APP on, EMAIL on, SMS off, WHATSAPP off.
--
-- INV-022 ledger: +4 tables (the phase's +4; ENTITY_CATALOG 228 → 232),
-- +0 journal rules (the hub posts through EXISTING engines only), +5
-- permissions (267 → 272, matrix §3.19), +6 feature keys
-- (communication.templates + communication.outbound → ALL plans;
-- communication.whatsapp/sms/email_providers/calendar_integration →
-- business + enterprise, the 0051 tier-4 precedent).
--
-- Grants: message_templates + notification_preferences are tenant user
-- data (full CRUD — editable and removable); outbound_messages is a
-- LEDGER (SELECT/INSERT/UPDATE — no app-role DELETE, the dunning_letters
-- precedent); communication_log is a log with editable call entries
-- (SELECT/INSERT/UPDATE; DELETE rides the purge path only).

--> statement-breakpoint
SET ROLE erp_migrate;

--> statement-breakpoint
-- ---------------------------------------------------------------------------
-- 1. message_templates (§2.2, FD-30): channel × locale × module, typed
--    variables, tenant-editable.
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "message_templates" (
  "id" uuid NOT NULL,
  "tenant_id" uuid NOT NULL REFERENCES "tenants" ("id") ON DELETE RESTRICT,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "updated_at" timestamptz NOT NULL DEFAULT now(),
  "version" integer NOT NULL DEFAULT 1,
  "key" text NOT NULL,
  "channel" text NOT NULL,
  "locale" text NOT NULL,
  "module" text NOT NULL,
  "subject" text,
  "body" text NOT NULL,
  "variables" jsonb NOT NULL DEFAULT '[]'::jsonb,
  "is_active" boolean NOT NULL DEFAULT true,
  "created_by" uuid,
  CONSTRAINT "pk_message_templates" PRIMARY KEY ("id"),
  CONSTRAINT "uq_message_templates_id_tenant" UNIQUE ("id", "tenant_id"),
  -- One row per (tenant, key, channel, locale): the effective-template
  -- resolution key (tenant row || builtin fallback).
  CONSTRAINT "uq_message_templates_key" UNIQUE ("tenant_id", "key", "channel", "locale"),
  CONSTRAINT "ck_message_templates_channel" CHECK ("channel" IN ('EMAIL', 'WHATSAPP', 'SMS')),
  CONSTRAINT "ck_message_templates_locale" CHECK ("locale" IN ('ar', 'en')),
  -- EMAIL carries a subject; WHATSAPP/SMS are body-only.
  CONSTRAINT "ck_message_templates_subject_shape" CHECK (
    ("channel" = 'EMAIL' AND "subject" IS NOT NULL AND length("subject") BETWEEN 1 AND 300)
    OR ("channel" <> 'EMAIL' AND "subject" IS NULL)
  ),
  CONSTRAINT "ck_message_templates_key_shape" CHECK ("key" ~ '^[a-z][a-z0-9_.]{2,80}$'),
  -- The module rides the notification-category vocabulary (shape-checked;
  -- the code resolver pins the closed list).
  CONSTRAINT "ck_message_templates_module_shape" CHECK ("module" ~ '^[a-z][a-z0-9_]{1,40}$'),
  CONSTRAINT "ck_message_templates_body_length" CHECK (length("body") BETWEEN 1 AND 20000),
  -- Typed variable declarations: [{name, required, description}] — the
  -- array-ness is pinned here; the full per-element shape (name string
  -- matching ^[a-z][a-z0-9_]{0,40}$, required boolean) is validated by the
  -- template service at write time (PostgreSQL forbids subqueries inside
  -- CHECK constraints — the shape contract lives in the service layer,
  -- the documented decision).
  CONSTRAINT "ck_message_templates_variables_shape" CHECK (
    jsonb_typeof("variables") = 'array'
  )
);

--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "ix_message_templates_tenant_module_channel"
  ON "message_templates" ("tenant_id", "module", "channel");

--> statement-breakpoint
-- ---------------------------------------------------------------------------
-- 2. outbound_messages (§2.3): the send ledger — every send is a row.
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "outbound_messages" (
  "id" uuid NOT NULL,
  "tenant_id" uuid NOT NULL REFERENCES "tenants" ("id") ON DELETE RESTRICT,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "updated_at" timestamptz NOT NULL DEFAULT now(),
  "version" integer NOT NULL DEFAULT 1,
  "channel" text NOT NULL,
  "status" text NOT NULL DEFAULT 'QUEUED',
  "recipient" text NOT NULL,
  "recipient_user_id" uuid,
  "partner_id" uuid,
  "module" text NOT NULL,
  "template_key" text NOT NULL,
  "locale" text NOT NULL,
  "subject" text,
  "body_snapshot" text NOT NULL,
  "provider" text,
  "provider_ref" text,
  "cost_amount" numeric(19, 4),
  "cost_currency" text,
  "attempts" integer NOT NULL DEFAULT 0,
  "max_attempts" integer NOT NULL DEFAULT 3,
  "next_attempt_at" timestamptz,
  "last_error" text,
  "sent_at" timestamptz,
  "delivered_at" timestamptz,
  "source_type" text,
  "source_id" uuid,
  "correlation_id" text,
  "payload" jsonb,
  CONSTRAINT "pk_outbound_messages" PRIMARY KEY ("id"),
  CONSTRAINT "uq_outbound_messages_id_tenant" UNIQUE ("id", "tenant_id"),
  CONSTRAINT "ck_outbound_messages_channel" CHECK ("channel" IN ('EMAIL', 'WHATSAPP', 'SMS')),
  CONSTRAINT "ck_outbound_messages_status" CHECK ("status" IN ('QUEUED', 'SENT', 'DELIVERED', 'FAILED')),
  CONSTRAINT "ck_outbound_messages_locale" CHECK ("locale" IN ('ar', 'en')),
  CONSTRAINT "ck_outbound_messages_source_type" CHECK (
    "source_type" IS NULL
    OR "source_type" IN ('DUNNING_LETTER', 'DIGEST', 'NUDGE', 'MANUAL', 'CALENDAR', 'NOTIFICATION')
  ),
  CONSTRAINT "ck_outbound_messages_module_shape" CHECK ("module" ~ '^[a-z][a-z0-9_]{1,40}$'),
  CONSTRAINT "ck_outbound_messages_template_key_shape" CHECK ("template_key" ~ '^[a-z][a-z0-9_.]{2,80}$'),
  -- Retry policy bounds: a runaway retry ladder is a config error.
  CONSTRAINT "ck_outbound_messages_attempts" CHECK (
    "attempts" >= 0 AND "max_attempts" BETWEEN 1 AND 10
  ),
  -- Cost shape: amount and currency travel together (or not at all).
  CONSTRAINT "ck_outbound_messages_cost_shape" CHECK (
    ("cost_amount" IS NULL AND "cost_currency" IS NULL)
    OR ("cost_amount" IS NOT NULL AND "cost_amount" >= 0
        AND "cost_currency" IS NOT NULL AND "cost_currency" ~ '^[A-Z]{3}$')
  ),
  -- Terminal-state coherence: SENT/DELIVERED carry the provider evidence;
  -- FAILED carries the error; QUEUED is pre-evidence.
  CONSTRAINT "ck_outbound_messages_status_evidence" CHECK (
    ("status" = 'QUEUED' AND "sent_at" IS NULL AND "delivered_at" IS NULL)
    OR ("status" = 'SENT' AND "sent_at" IS NOT NULL AND "delivered_at" IS NULL)
    OR ("status" = 'DELIVERED' AND "sent_at" IS NOT NULL AND "delivered_at" IS NOT NULL)
    OR ("status" = 'FAILED' AND "last_error" IS NOT NULL)
  )
);

--> statement-breakpoint
-- The queue scan (OA-06 hot path): due QUEUED rows.
CREATE INDEX IF NOT EXISTS "ix_outbound_messages_queue"
  ON "outbound_messages" ("tenant_id", "status", "next_attempt_at");
--> statement-breakpoint
-- The inbox-by-partner path (OA-06).
CREATE INDEX IF NOT EXISTS "ix_outbound_messages_partner"
  ON "outbound_messages" ("tenant_id", "partner_id", "created_at" DESC);
--> statement-breakpoint
-- The delivery-log report path (status/provider/channel mix + cost rollup).
CREATE INDEX IF NOT EXISTS "ix_outbound_messages_report"
  ON "outbound_messages" ("tenant_id", "created_at", "channel", "status");
--> statement-breakpoint
-- The nudge exactly-once probe (source linkage).
CREATE INDEX IF NOT EXISTS "ix_outbound_messages_source"
  ON "outbound_messages" ("tenant_id", "source_type", "source_id");

--> statement-breakpoint
-- ---------------------------------------------------------------------------
-- 3. notification_preferences (§2.4, TB-23): the user × module × channel
--    matrix. user_id NULL = the tenant default row (NULLS NOT DISTINCT so
--    exactly one default per module×channel).
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "notification_preferences" (
  "id" uuid NOT NULL,
  "tenant_id" uuid NOT NULL REFERENCES "tenants" ("id") ON DELETE RESTRICT,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "updated_at" timestamptz NOT NULL DEFAULT now(),
  "version" integer NOT NULL DEFAULT 1,
  "user_id" uuid,
  "module" text NOT NULL,
  "channel" text NOT NULL,
  "enabled" boolean NOT NULL,
  "updated_by" uuid,
  CONSTRAINT "pk_notification_preferences" PRIMARY KEY ("id"),
  CONSTRAINT "uq_notification_preferences_id_tenant" UNIQUE ("id", "tenant_id"),
  CONSTRAINT "uq_notification_preferences_matrix" UNIQUE NULLS NOT DISTINCT
    ("tenant_id", "user_id", "module", "channel"),
  CONSTRAINT "ck_notification_preferences_channel" CHECK
    ("channel" IN ('IN_APP', 'EMAIL', 'SMS', 'WHATSAPP')),
  CONSTRAINT "ck_notification_preferences_module_shape" CHECK
    ("module" ~ '^[a-z][a-z0-9_]{1,40}$')
);

--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "ix_notification_preferences_user"
  ON "notification_preferences" ("tenant_id", "user_id", "module");

--> statement-breakpoint
-- ---------------------------------------------------------------------------
-- 4. communication_log (§2.5, UX-14/IN-16): the unified interaction log —
--    messages + manually logged calls per partner.
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "communication_log" (
  "id" uuid NOT NULL,
  "tenant_id" uuid NOT NULL REFERENCES "tenants" ("id") ON DELETE RESTRICT,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "updated_at" timestamptz NOT NULL DEFAULT now(),
  "version" integer NOT NULL DEFAULT 1,
  "kind" text NOT NULL,
  "direction" text NOT NULL,
  "channel" text NOT NULL,
  "at" timestamptz NOT NULL DEFAULT now(),
  "partner_id" uuid,
  "user_id" uuid,
  "counterparty" text,
  "summary" text,
  "body" text,
  "outcome" text,
  "duration_minutes" integer,
  "outbound_message_id" uuid,
  "related_type" text,
  "related_id" uuid,
  "created_by" uuid,
  CONSTRAINT "pk_communication_log" PRIMARY KEY ("id"),
  CONSTRAINT "uq_communication_log_id_tenant" UNIQUE ("id", "tenant_id"),
  CONSTRAINT "ck_communication_log_kind" CHECK ("kind" IN ('MESSAGE', 'CALL')),
  CONSTRAINT "ck_communication_log_direction" CHECK ("direction" IN ('INBOUND', 'OUTBOUND')),
  CONSTRAINT "ck_communication_log_channel" CHECK
    ("channel" IN ('EMAIL', 'WHATSAPP', 'SMS', 'CALL')),
  CONSTRAINT "ck_communication_log_kind_channel" CHECK (
    ("kind" = 'CALL' AND "channel" = 'CALL')
    OR ("kind" = 'MESSAGE' AND "channel" IN ('EMAIL', 'WHATSAPP', 'SMS'))
  ),
  CONSTRAINT "ck_communication_log_outcome" CHECK (
    "outcome" IS NULL OR "outcome" IN
      ('COMPLETED', 'NO_ANSWER', 'BUSY', 'VOICEMAIL', 'FAILED', 'SCHEDULED')
  ),
  CONSTRAINT "ck_communication_log_duration" CHECK (
    "duration_minutes" IS NULL OR ("duration_minutes" >= 0 AND "duration_minutes" <= 1440)
  ),
  -- A logged call records its outcome; duration may be unknown.
  CONSTRAINT "ck_communication_log_call_shape" CHECK (
    "kind" <> 'CALL' OR ("outcome" IS NOT NULL AND "summary" IS NOT NULL)
  ),
  CONSTRAINT "ck_communication_log_related_shape" CHECK (
    ("related_type" IS NULL AND "related_id" IS NULL)
    OR ("related_type" IS NOT NULL AND "related_type" ~ '^[A-Z][A-Z0-9_]{1,40}$'
        AND "related_id" IS NOT NULL)
  )
);

--> statement-breakpoint
-- The unified inbox hot path (OA-06): per-partner timeline.
CREATE INDEX IF NOT EXISTS "ix_communication_log_partner"
  ON "communication_log" ("tenant_id", "partner_id", "at" DESC);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "ix_communication_log_tenant_at"
  ON "communication_log" ("tenant_id", "at" DESC);

--> statement-breakpoint
-- ---------------------------------------------------------------------------
-- 5. RLS — the house triple (apply_tenant_policy + the purge path) for all
--    four tables.
--> statement-breakpoint
ALTER TABLE "message_templates" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "message_templates" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
SELECT erp.apply_tenant_policy('"message_templates"');
--> statement-breakpoint
ALTER TABLE "outbound_messages" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "outbound_messages" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
SELECT erp.apply_tenant_policy('"outbound_messages"');
--> statement-breakpoint
ALTER TABLE "notification_preferences" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "notification_preferences" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
SELECT erp.apply_tenant_policy('"notification_preferences"');
--> statement-breakpoint
ALTER TABLE "communication_log" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "communication_log" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
SELECT erp.apply_tenant_policy('"communication_log"');
--> statement-breakpoint
DO $$
DECLARE
  t text;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'message_templates', 'outbound_messages', 'notification_preferences', 'communication_log'
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
-- 6. Grants.
--> statement-breakpoint
REVOKE ALL ON "message_templates" FROM erp_app;
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON "message_templates" TO erp_app;
--> statement-breakpoint
GRANT SELECT ON "message_templates" TO erp_readonly;
--> statement-breakpoint
GRANT SELECT ON "message_templates" TO erp_definer;
--> statement-breakpoint
REVOKE ALL ON "outbound_messages" FROM erp_app;
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE ON "outbound_messages" TO erp_app;
--> statement-breakpoint
GRANT SELECT ON "outbound_messages" TO erp_readonly;
--> statement-breakpoint
GRANT SELECT ON "outbound_messages" TO erp_definer;
--> statement-breakpoint
REVOKE ALL ON "notification_preferences" FROM erp_app;
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON "notification_preferences" TO erp_app;
--> statement-breakpoint
GRANT SELECT ON "notification_preferences" TO erp_readonly;
--> statement-breakpoint
GRANT SELECT ON "notification_preferences" TO erp_definer;
--> statement-breakpoint
REVOKE ALL ON "communication_log" FROM erp_app;
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE ON "communication_log" TO erp_app;
--> statement-breakpoint
GRANT SELECT ON "communication_log" TO erp_readonly;
--> statement-breakpoint
GRANT SELECT ON "communication_log" TO erp_definer;

--> statement-breakpoint
-- ---------------------------------------------------------------------------
-- 7. Bilingual table comments.
--> statement-breakpoint
COMMENT ON TABLE "message_templates" IS 'PHASE-041 (FD-30): tenant message templates — channel × locale × module with typed variables / قوالب رسائل المستأجر: قناة × لغة × وحدة بمتغيرات مطبَّعة';
--> statement-breakpoint
COMMENT ON TABLE "outbound_messages" IS 'PHASE-041: the outbound send ledger — status/provider ref/cost/retry policy; every send is a row (BR-067 port discipline) / سجل الإرسال الخارجي: الحالة ومرجع المزوّد والتكلفة وسياسة الإعادة';
--> statement-breakpoint
COMMENT ON TABLE "notification_preferences" IS 'PHASE-041 (TB-23): the user × module × channel notification matrix; user_id NULL = tenant default / مصفوفة تفضيلات الإشعار للمستخدم × الوحدة × القناة؛ user_id فارغ يعني الافتراضي للمستأجر';
--> statement-breakpoint
COMMENT ON TABLE "communication_log" IS 'PHASE-041 (UX-14/IN-16): the unified interaction log — messages + logged calls per partner feeding the unified inbox / سجل التفاعلات الموحّد: الرسائل والمكالمات المسجَّلة لكل شريك';
--> statement-breakpoint
COMMENT ON COLUMN "outbound_messages"."source_type" IS 'PHASE-041: why this was sent — DUNNING_LETTER (the 039/036 handoff), DIGEST (PP-13), NUDGE (PP-15), MANUAL, CALENDAR, NOTIFICATION';
--> statement-breakpoint
COMMENT ON COLUMN "notification_preferences"."user_id" IS 'PHASE-041 (TB-23): NULL = the tenant default row (one per module×channel — NULLS NOT DISTINCT)';

--> statement-breakpoint
-- ---------------------------------------------------------------------------
-- 8. Preference default seed rows (§2.4): tenant-default rows for
--    EXISTING tenants — the module vocabulary = the in-app notification
--    categories (PHASE-014→039) + digest; the paid-channels-off
--    discipline (IN_APP on, EMAIL on, SMS off, WHATSAPP off). New tenants
--    materialize lazily via the preferences service ensureDefaults (same
--    values, under the tenant GUC as erp_app).
--
--    Seeding role decision (the 0063 definer-reader precedent): the seed
--    must read tenants CROSS the whole table and write tenant-owned rows
--    BEFORE any tenant GUC exists — erp_migrate sees ZERO tenants rows
--    under FORCE RLS (no policy for it; the purge-path policies are
--    DELETE/UPDATE only). The house pattern for exactly this shape is
--    SET ROLE erp_definer (NOLOGIN BYPASSRLS; erp_migrate is a member —
--    0003's grant): the one-shot seed runs there with a scoped INSERT
--    grant, revoked immediately after; the definer role NEVER holds a
--    standing INSERT on tenant user data.
--> statement-breakpoint
GRANT INSERT ON "notification_preferences" TO erp_definer;
--> statement-breakpoint
SET ROLE erp_definer;
--> statement-breakpoint
INSERT INTO "notification_preferences"
  ("id", "tenant_id", "user_id", "module", "channel", "enabled")
SELECT gen_random_uuid(), t."id", NULL, m."module", c."channel", c."enabled"
FROM "tenants" t
CROSS JOIN (VALUES
  ('limits'), ('subscription'), ('reconciliation'), ('invoice_overdue'),
  ('stock'), ('templates'), ('crm'), ('einvoicing'), ('notes'),
  ('installments'), ('budgeting'), ('purchasing'), ('collections'),
  ('warranties'), ('digest')
) AS m("module")
CROSS JOIN (VALUES
  ('IN_APP', true), ('EMAIL', true), ('SMS', false), ('WHATSAPP', false)
) AS c("channel", "enabled")
ON CONFLICT ("tenant_id", "user_id", "module", "channel") DO NOTHING;
--> statement-breakpoint
SET ROLE erp_migrate;
--> statement-breakpoint
REVOKE INSERT ON "notification_preferences" FROM erp_definer;

--> statement-breakpoint
-- ---------------------------------------------------------------------------
-- 9. Permission seed (matrix §3.19; zero-drift 267 → 272): the FIVE keys.
--    communication.templates.manage → owner + accountant (the back-office
--    template hub — the configuration.imports.manage precedent);
--    communication.outbox.read → owner + accountant (the delivery ledger);
--    communication.inbox.read → owner + accountant + sales (the unified
--    inbox is the sales/support surface, UX-14);
--    communication.preferences.manage → owner (tenant defaults; users
--    manage their OWN rows on the self plane);
--    communication.calendar.connect → owner (OAuth connect + contacts
--    sync opt-in).
--> statement-breakpoint
INSERT INTO "permissions" ("key", "module", "description") VALUES
('communication.templates.manage', 'communication', 'Manage tenant message templates (channel × locale × module, typed variables) / إدارة قوالب رسائل المستأجر (قناة × لغة × وحدة بمتغيرات مطبَّعة)'),
('communication.outbox.read', 'communication', 'Read the outbound send ledger (status, provider, cost, retries) / قراءة سجل الإرسال الخارجي (الحالة والمزوّد والتكلفة والإعادات)'),
('communication.preferences.manage', 'communication', 'Manage tenant notification-preference defaults (module × channel matrix) / إدارة الافتراضات لتفضيلات الإشعار (مصفوفة الوحدة × القناة)'),
('communication.inbox.read', 'communication', 'Read the unified inbox + log calls (partner interaction timeline) / قراءة الصندوق الموحّد وتسجيل المكالمات (خط تفاعلات الشريك)'),
('communication.calendar.connect', 'communication', 'Connect Google/Outlook calendars (OAuth) and opt into contacts sync / ربط تقويمات Google/Outlook وتفعيل مزامنة جهات الاتصال')
ON CONFLICT ("key") DO NOTHING;
--> statement-breakpoint
INSERT INTO "role_permissions" ("role_id", "tenant_id", "permission_id")
SELECT r."id", NULL, p."key"
FROM "roles" r CROSS JOIN "permissions" p
WHERE r."key" = 'owner' AND r."tenant_id" IS NULL
  AND p."key" IN ('communication.templates.manage', 'communication.outbox.read',
                  'communication.preferences.manage', 'communication.inbox.read',
                  'communication.calendar.connect')
ON CONFLICT ("role_id", "permission_id") DO NOTHING;
--> statement-breakpoint
INSERT INTO "role_permissions" ("role_id", "tenant_id", "permission_id")
SELECT r."id", NULL, p."key"
FROM "roles" r CROSS JOIN "permissions" p
WHERE r."key" = 'accountant' AND r."tenant_id" IS NULL
  AND p."key" IN ('communication.templates.manage', 'communication.outbox.read',
                  'communication.inbox.read')
ON CONFLICT ("role_id", "permission_id") DO NOTHING;
--> statement-breakpoint
INSERT INTO "role_permissions" ("role_id", "tenant_id", "permission_id")
SELECT r."id", NULL, p."key"
FROM "roles" r CROSS JOIN "permissions" p
WHERE r."key" = 'sales' AND r."tenant_id" IS NULL
  AND p."key" IN ('communication.inbox.read')
ON CONFLICT ("role_id", "permission_id") DO NOTHING;

--> statement-breakpoint
-- ---------------------------------------------------------------------------
-- 10. Feature plan grants (FEATURE_CATALOG §protocol step 3): templates +
--     outbound → ALL plans (base messaging over the SANDBOX default
--     provider — BR-067); whatsapp/sms/email_providers/
--     calendar_integration → business + enterprise (the 0051 tier-4
--     precedent — starter excluded).
--> statement-breakpoint
UPDATE "plans" SET "feature_keys" = array_cat("feature_keys",
  ARRAY['communication.templates', 'communication.outbound'])
WHERE "key" IN ('starter', 'business', 'enterprise')
  AND NOT ('communication.templates' = ANY("feature_keys"));
--> statement-breakpoint
UPDATE "plans" SET "feature_keys" = array_cat("feature_keys",
  ARRAY['communication.whatsapp', 'communication.sms',
        'communication.email_providers', 'communication.calendar_integration'])
WHERE "key" IN ('business', 'enterprise')
  AND NOT ('communication.whatsapp' = ANY("feature_keys"));

--> statement-breakpoint
RESET ROLE;

--> statement-breakpoint
-- Schema-state marker for /health/ready (mirrors the migration manifest).
INSERT INTO erp._schema_state (key, value) VALUES ('schema_version', 64)
ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, at = now();
