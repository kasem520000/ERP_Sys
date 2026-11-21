-- PHASE-049 (W-19 — T-11/T-12, dated 2026-11-21, the owner's launch order
-- over the head cf0248c) · migration 0111 · THE SWEEP SETTINGS PAGE + the
-- notifications category widening.
--
--   §1 THE NOTIFICATIONS CATEGORY WIDENING: 'assets' joins BOTH CHECK
--     domains (notifications.category + notification_prefs.category) —
--     the 0023/0056/0099 pattern; the asset-expiry sweep's four classes
--     (warranty/insurance/license/inspection) ride the inbox's own
--     category vocabulary. THE SHARED-SCOPE UNION LAW (the owner's W-17
--     acceptance, standing from W-18): the widened list is the UNION of
--     every member every migration has EVER defined — 0023's base nine +
--     0042's 'budgeting' + 0051's 'purchasing' + 0056's 'collections'/
--     'warranties' + 0099's 'hr' + 'assets' here — never a single
--     migration's list (the G-48 lesson); the schema spec's
--     notifications-category arm (W-19) enumerates the members and
--     asserts the LIVE constraint equals that union.
--   §2 THE DATA PAGE (the 0098 pattern — the owner's W-19 order: «صفحة
--     بيانات بنمط 0098»): THE SWEEP THRESHOLD KEY — assets.expiry.manage
--     (matrix §3.27; the drift 336 → 337, the dated delta) — the sweep's
--     threshold settings surface. The thresholds themselves are THE
--     FIRST 049 SETTINGS KEYS: the typed registry key
--     assets.expiry_sweep_thresholds (SETTINGS_REGISTRY — the
--     projects.fieldservice_sla_targets precedent), the documented
--     fail-closed default [30,7,0] (red line 5: tenant-configurable DATA,
--     never hard-coded law — a tenant who registers garbage never
--     silently disables the sweep; the pure normalize fold is the
--     W-19 domain's, unit-tested FIRST). Role grants (the 0098/0103
--     precedent): the owner template holds the key; NO other system
--     role — the sweep's configuration is an operational act (the
--     accountant keeps the read-only assets.expiry.view — the renewal
--     registers).
--
--   THE D-02 DISCLOSURE (the owner's law — THIS provision's final
--     expected fingerprint, announced in the wave's own envelope — the
--     new law's FIRST APPLICATION): **the chain 111 · ENTITY_CATALOG 328
--     (ZERO table delta — this migration adds no tables, no views) ·
--     the drift 337 (= 336 + assets.expiry.manage) · ROUTE_PERMISSIONS
--     1,093 + 9 = 1,102 (the W-19 dated delta: the tags family's five ·
--     the scan · the fleet-light register · the sweep config's two)**.
--     The fingerprint is final through W-23 unless a dated provision
--     lands.
--
--   Ledger-free by design (D-05): zero journal rules, zero invariants,
--   zero account purposes, zero plan grants (the sweep rides the
--   EXISTING assets.maintenance feature flag — 0108 §2), zero manifest
--   updates (the CMMS-carrying templates already compose the flag).

--> statement-breakpoint
SET ROLE erp_migrate;

--> statement-breakpoint
-- ---------------------------------------------------------------------------
-- 1. The notifications category widening — 'assets' (the 0099 §2 pattern).
--> statement-breakpoint
ALTER TABLE "notifications" DROP CONSTRAINT IF EXISTS ck_notifications_category_values;
--> statement-breakpoint
ALTER TABLE "notifications" ADD CONSTRAINT ck_notifications_category_values
  CHECK ("category" IN (
    'limits', 'subscription', 'reconciliation', 'invoice_overdue', 'stock', 'templates', 'crm',
    'einvoicing', 'notes', 'installments', 'budgeting', 'purchasing', 'collections', 'warranties',
    'hr', 'assets'
  ));
--> statement-breakpoint
ALTER TABLE "notification_prefs" DROP CONSTRAINT IF EXISTS ck_notification_prefs_category_values;
--> statement-breakpoint
ALTER TABLE "notification_prefs" ADD CONSTRAINT ck_notification_prefs_category_values
  CHECK ("category" IN (
    'limits', 'subscription', 'reconciliation', 'invoice_overdue', 'stock', 'templates', 'crm',
    'einvoicing', 'notes', 'installments', 'budgeting', 'purchasing', 'collections', 'warranties',
    'hr', 'assets'
  ));

--> statement-breakpoint
-- ---------------------------------------------------------------------------
-- 2. THE DATA PAGE (the 0098 pattern): the sweep threshold key + grants.
--> statement-breakpoint
INSERT INTO "permissions" ("key", "module", "description") VALUES
('assets.expiry.manage', 'assets', 'Manage the asset-expiry sweep''s threshold ladder and its settings (the first 049 settings keys) / إدارة سلالم عتبات كنس انتهاء الصلاحية وإعداداته')
ON CONFLICT ("key") DO UPDATE
  SET "module" = EXCLUDED."module", "description" = EXCLUDED."description";
--> statement-breakpoint
-- Role grants: the owner template holds the key; no other system role —
-- the sweep's configuration is an operational act (the accountant's
-- finance-read plane stays at assets.expiry.view).
INSERT INTO "role_permissions" ("role_id", "tenant_id", "permission_id")
SELECT r."id", NULL, p."key"
FROM "roles" r JOIN "permissions" p ON p."key" IN (
  'assets.expiry.manage'
)
WHERE r."key" = 'owner' AND r."tenant_id" IS NULL
ON CONFLICT ("role_id", "permission_id") DO NOTHING;

--> statement-breakpoint
RESET ROLE;

--> statement-breakpoint
-- Schema-state marker for /health/ready (mirrors the migration manifest).
INSERT INTO erp._schema_state (key, value) VALUES ('schema_version', 111)
ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, at = now();
