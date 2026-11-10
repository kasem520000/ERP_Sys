-- PHASE-022 · migration 0034 · device push tokens (DR-P22-07 / DR-P22-07a)
--
-- Purpose (PHASE-022 MASTER-PLAN §1 item 7 + §6): the FCM skeleton's
-- device-token opt-in storage (default OFF — DR-P22-07). The devices table
-- carries no natural JSON column for push tokens (capabilities jsonb is the
-- 016/020 feed-scoping slice; trust_flags jsonb is the audited admin plane),
-- so the honest shape is a dedicated service-mediated table — the
-- device_refresh_tokens pattern from 0029 (identity-owned, no tenant_id, no
-- RLS by PHASE-003 §4; the endpoint surface and the revocation clear ride
-- the same withTenant unit of work as every other devices statement).
--
-- One active row per device (uq device_id — the PUT upsert key); a token
-- never belongs to two devices (uq token — the cross-device collision is a
-- typed error at the surface, the constraint is the belt). opted_in defaults
-- FALSE: tokens are per-device, opt-in explicit (§3.5 of the integrations
-- registry: "FCM device tokens come from the device registry (opt-in per
-- device)"); locale is the device's notification locale, resolved BEFORE
-- the channel call. Token shape is deliberately NOT constrained beyond
-- length — no guessed FCM format (NO-FABRICATION §4 rule 2).
--
-- No business-schema change: the phase doc's "Database changes: none
-- server-side" is read as *no business-schema changes* (the DR-P22-05a
-- precedent, 0033_mobile_feeds) — no tenant-owned table, no RLS change, no
-- data change; this is platform plumbing for the notification channel.
--> statement-breakpoint
SET ROLE erp_migrate;

--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "device_push_tokens" (
  "id" uuid NOT NULL,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "updated_at" timestamptz NOT NULL DEFAULT now(),
  "version" integer NOT NULL DEFAULT 1,
  "device_id" uuid NOT NULL REFERENCES "devices" ("id") ON DELETE CASCADE,
  "token" text NOT NULL,
  "platform" text,
  "opted_in" boolean NOT NULL DEFAULT false,
  "locale" text NOT NULL DEFAULT 'ar',
  CONSTRAINT pk_device_push_tokens PRIMARY KEY ("id"),
  CONSTRAINT uq_device_push_tokens_device UNIQUE ("device_id"),
  CONSTRAINT uq_device_push_tokens_token UNIQUE ("token"),
  CONSTRAINT ck_device_push_tokens_locale CHECK ("locale" IN ('ar', 'en')),
  CONSTRAINT ck_device_push_tokens_token_length
    CHECK (char_length("token") >= 20 AND char_length("token") <= 512)
);

--> statement-breakpoint
-- Grants (the device_refresh_tokens pattern): the opt-in surface upserts and
-- toggles, revocation DELETEs (a cleared token is gone — the soft kill
-- switch clears the rows; the FK CASCADE only covers device-row deletes,
-- which never happen). erp_readonly/erp_definer read only.
GRANT SELECT, INSERT, UPDATE, DELETE ON "device_push_tokens" TO erp_app;
--> statement-breakpoint
GRANT SELECT ON "device_push_tokens" TO erp_readonly;
--> statement-breakpoint
GRANT SELECT ON "device_push_tokens" TO erp_definer;
--> statement-breakpoint
RESET ROLE;

--> statement-breakpoint
-- Schema-state marker for /health/ready (mirrors the migration manifest).
INSERT INTO erp._schema_state (key, value) VALUES ('schema_version', 34)
ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, at = now();
