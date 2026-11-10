-- PHASE-015 · migration 0023 · notifications categories generalization
--
-- Purpose (PHASE-015 §2 item 9/10 — T10; FEATURE_CATALOG
-- `platform.notifications`): the in-app inbox generalizes beyond the
-- PHASE-014 billing-critical subset. Two categories join the CHECK
-- domains of `notifications.category` and `notification_prefs.category`:
--
--   'stock'     — the BR-019 reorder scan's in-app leg (stock.below_reorder
--                 digests; alert only, never a purchase order).
--   'templates' — industry template upgrade offers (the configuration
--                 module's drift job records offers; never auto-applies).
--
-- Purely additive: the four PHASE-014 billing values stay; no column,
-- index, or RLS change — the constraints simply widen their domains.
--> statement-breakpoint
SET ROLE erp_migrate;

--> statement-breakpoint
-- ---------------------------------------------------------------------------
-- notifications: widen the category CHECK domain (PHASE-015 T10).
--> statement-breakpoint
ALTER TABLE "notifications" DROP CONSTRAINT IF EXISTS ck_notifications_category_values;
--> statement-breakpoint
ALTER TABLE "notifications" ADD CONSTRAINT ck_notifications_category_values
  CHECK ("category" IN (
    'limits', 'subscription', 'reconciliation', 'invoice_overdue', 'stock', 'templates'
  ));
--> statement-breakpoint
-- ---------------------------------------------------------------------------
-- notification_prefs: the same category domain (prefs suppress per channel;
-- absent rows keep meaning both channels on — unchanged).
--> statement-breakpoint
ALTER TABLE "notification_prefs" DROP CONSTRAINT IF EXISTS ck_notification_prefs_category_values;
--> statement-breakpoint
ALTER TABLE "notification_prefs" ADD CONSTRAINT ck_notification_prefs_category_values
  CHECK ("category" IN (
    'limits', 'subscription', 'reconciliation', 'invoice_overdue', 'stock', 'templates'
  ));
--> statement-breakpoint
-- Schema-state marker for /health/ready (mirrors the migration manifest).
INSERT INTO erp._schema_state (key, value) VALUES ('schema_version', 23)
ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, at = now();

--> statement-breakpoint
RESET ROLE;
