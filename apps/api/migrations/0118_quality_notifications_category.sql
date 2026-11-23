-- PHASE-050 (W-26 — T-08, dated 2026-11-23) · migration 0118 · THE
-- NOTIFICATIONS-CATEGORY WIDENING — 'quality' joins BOTH CHECK domains
-- (the 0023/0056/0099/0111/0112 pattern, D-08's own dependency).
--
--   THE CATCH IS STRUCTURAL, NOT LATENT THIS TIME: the quality
--     calibration sweep's inbox writer ships in THIS wave (the
--     `quality-calibration-due` pg-boss job — the 0111 pattern's W-26
--     extension), and its records carry category 'quality' — a member
--     the closed notifications/notification_prefs CHECK domains do not
--     carry (the seventeen-member union of 0112). The widening is
--     ordered WITH the writer, never after it (the 0099/0111
--     same-increment law: the constraint and its writer land together).
--
--   THE SHARED-SCOPE UNION LAW (the owner's W-17 acceptance, standing
--     from W-18/W-19): the widened list is the UNION of every member
--     every migration has EVER defined — the seventeen of 0112 +
--     'quality' here = EIGHTEEN — never a single migration's list (the
--     G-48 lesson); the cmms-schema spec's notifications-category arm
--     (the standing proof) enumerates the members and asserts the LIVE
--     constraint equals that union — its dated enumeration updates in
--     THIS same increment (the arm's own design: a new member goes RED
--     there first, named, then the enumeration carries it).
--
--   THE D-02 DISCLOSURE (the standing law — the wave's own final
--     expected fingerprint): the chain 117 → 118 · ENTITY_CATALOG 340
--     (ZERO table delta — this migration adds no tables, no views) ·
--     the permissions drift 347 unchanged (the sweep-config surface
--     binds the EXISTING 0116-seeded quality.calibration.manage key —
--     its own description names the due-date sweep's configuration;
--     no new key) · ROUTE_PERMISSIONS 1,113 + 12 = 1,125 (the W-26
--     dated delta at the block — the CAPA seven + the calibration
--     five, the keys-seed-first SECOND binding wave) · the first 050
--     settings registry key quality.calibration_sweep_thresholds (the
--     CODE registry — tenant_settings carries the value; no migration
--     row needed, the 0111 precedent's registry-in-code shape).
--
--   Ledger-free by design: zero journal rules, zero invariants, zero
--   account purposes, zero plan grants (the sweep rides the EXISTING
--   `quality` feature flag — 0116 §5b), zero manifest updates (the
--   quality-carrying templates already compose the flag).

--> statement-breakpoint
SET ROLE erp_migrate;

--> statement-breakpoint
ALTER TABLE "notifications" DROP CONSTRAINT IF EXISTS ck_notifications_category_values;
--> statement-breakpoint
ALTER TABLE "notifications" ADD CONSTRAINT ck_notifications_category_values
  CHECK ("category" IN (
    'limits', 'subscription', 'reconciliation', 'invoice_overdue', 'stock', 'templates', 'crm',
    'einvoicing', 'notes', 'installments', 'budgeting', 'payroll', 'purchasing', 'collections',
    'warranties', 'hr', 'assets', 'quality'
  ));
--> statement-breakpoint
ALTER TABLE "notification_prefs" DROP CONSTRAINT IF EXISTS ck_notification_prefs_category_values;
--> statement-breakpoint
ALTER TABLE "notification_prefs" ADD CONSTRAINT ck_notification_prefs_category_values
  CHECK ("category" IN (
    'limits', 'subscription', 'reconciliation', 'invoice_overdue', 'stock', 'templates', 'crm',
    'einvoicing', 'notes', 'installments', 'budgeting', 'payroll', 'purchasing', 'collections',
    'warranties', 'hr', 'assets', 'quality'
  ));

--> statement-breakpoint
RESET ROLE;

--> statement-breakpoint
-- Schema-state marker for /health/ready (mirrors the migration manifest).
INSERT INTO erp._schema_state (key, value) VALUES ('schema_version', 118)
ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, at = now();
