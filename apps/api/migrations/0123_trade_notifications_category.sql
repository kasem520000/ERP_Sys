-- PHASE-051 (W-34 — T-06, dated 2026-11-25) · migration 0123 · THE
-- NOTIFICATIONS-CATEGORY WIDENING — 'trade' joins BOTH CHECK domains
-- (the 0023/0056/0099/0111/0118 pattern, D-09's own dependency).
--
--   THE CATCH IS STRUCTURAL, NOT LATENT: the trade-expiry-sweep's inbox
--     writer ships in THIS wave (the `trade-expiry-sweep` pg-boss job —
--     the 0111/calibration pattern's W-34 extension, BR-105's own
--     ladder), and its records carry category 'trade' — a member the
--     closed notifications/notification_prefs CHECK domains do not
--     carry (the eighteen-member union of 0118). The widening is
--     ordered WITH the writer, never after it (the 0099/0111/0118
--     same-increment law: the constraint and its writer land together).
--
--   THE ADDITIVE-SLOT LAW (the 0117/0118 precedent's own class — the
--     master plan's four declared slots 0119–0122 are consumed at W-33
--     and PUBLISHED (the constants law: no touching any published
--     migration); a closed-domain widening demanded by a service wave
--     lands as its own dated additive slot, exactly as 050's 0117
--     (ck_stock_moves_source_shape for G-62's write-off) and 0118 (the
--     'quality' member for the calibration sweep) landed inside their
--     service waves. The chain 122 → 123; the phase's final fingerprint
--     carries the dated disclosure at every claim site).
--
--   THE SHARED-SCOPE UNION LAW (the owner's W-17 acceptance, standing
--     from W-18/W-19): the widened list is the UNION of every member
--     every migration has EVER defined — the eighteen of 0118 + 'trade'
--     here = NINETEEN — never a single migration's list (the G-48
--     lesson); the cmms-schema spec's notifications-category arm (the
--     standing proof) enumerates the members and asserts the LIVE
--     constraint equals that union — its dated enumeration updates in
--     THIS same increment (the arm's own design: a new member goes RED
--     there first, named, then the enumeration carries it).
--
--   THE D-02 DISCLOSURE (the standing law — the wave's own final
--     expected fingerprint): the chain 122 → 123 · ENTITY_CATALOG 354
--     (ZERO table delta — this migration adds no tables, no views) ·
--     the permissions drift 357 unchanged (the sweep-config surface
--     binds the EXISTING 0122-seeded trade.lc.manage key — its own
--     description names the LC lifecycle's management; no new key) ·
--     ROUTE_PERMISSIONS 1,159 + 12 = 1,171 (the W-34 dated delta at the
--     block — the LC plane's twelve routes, the keys-seed-first FIRST
--     trade binding wave) · the first 051 trade settings registry key
--     trade.lc_expiry_sweep_thresholds (the CODE registry —
--     tenant_settings carries the value; no migration row needed, the
--     0111 precedent's registry-in-code shape).
--
--   Ledger-free by design: zero journal rules, zero invariants, zero
--   account purposes, zero plan grants (the sweep rides the EXISTING
--   `trade` feature flag — 0122 §5c), zero manifest updates (the three
--   trade-carrying templates already compose the flags).

--> statement-breakpoint
SET ROLE erp_migrate;

--> statement-breakpoint
ALTER TABLE "notifications" DROP CONSTRAINT IF EXISTS ck_notifications_category_values;
--> statement-breakpoint
ALTER TABLE "notifications" ADD CONSTRAINT ck_notifications_category_values
  CHECK ("category" IN (
    'limits', 'subscription', 'reconciliation', 'invoice_overdue', 'stock', 'templates', 'crm',
    'einvoicing', 'notes', 'installments', 'budgeting', 'payroll', 'purchasing', 'collections',
    'warranties', 'hr', 'assets', 'quality', 'trade'
  ));
--> statement-breakpoint
ALTER TABLE "notification_prefs" DROP CONSTRAINT IF EXISTS ck_notification_prefs_category_values;
--> statement-breakpoint
ALTER TABLE "notification_prefs" ADD CONSTRAINT ck_notification_prefs_category_values
  CHECK ("category" IN (
    'limits', 'subscription', 'reconciliation', 'invoice_overdue', 'stock', 'templates', 'crm',
    'einvoicing', 'notes', 'installments', 'budgeting', 'payroll', 'purchasing', 'collections',
    'warranties', 'hr', 'assets', 'quality', 'trade'
  ));

--> statement-breakpoint
RESET ROLE;

--> statement-breakpoint
-- Schema-state marker for /health/ready (mirrors the migration manifest).
INSERT INTO erp._schema_state (key, value) VALUES ('schema_version', 123)
ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, at = now();
