-- PHASE-049 (W-19, dated 2026-11-21) · migration 0112 · THE
-- NOTIFICATIONS-CATEGORY UNION REPAIR — the honest catch of the wave's
-- own schema arm (the shared-scope union law's SECOND application, the
-- 0110 precedent's exact shape).
--
--   THE CATCH: the new notifications-category union arm (the W-19 schema
--     spec, the stock_moves arm's sibling) parses EVERY migration for the
--     two category constraints and unions every member EVER defined —
--     and the union has SEVENTEEN members while the live constraint
--     carries SIXTEEN: **0043 §12 widened BOTH CHECK domains with
--     'payroll' (its header's own note: "the category CHECK widens with
--     'payroll' ... cap-clamp warnings (BR-054), the missing-EOS-policy
--     warning (BR-055), run-approval surfacing") and 0051's DROP+ADD
--     REBUILT both lists WITHOUT it — a silent drop, never a noted
--     removal, the exact G-48 class (a shared-domain rebuild from a
--     partial list).** 0056/0099/0111 then inherited the drop. No code
--     ever wrote category 'payroll' (the payroll module ships no inbox
--     writer — the §12 promise landed only as the constraint member), so
--     nothing ever failed at runtime: a LATENT constraint-domain drift,
--     caught now by the law's own proof arm.
--
--   THE REPAIR (0111 is PUBLISHED — pushed at the wave's step-1
--     checkpoint; the constants law: no touching any published
--     migration): THIS additive slot re-adds both constraints with the
--     COMPLETE union — the seventeen members every migration has ever
--     defined, 'payroll' restored. The journal 111 → 112; the catalog
--     stays 328 (no tables).
--
--   THE TS TYPE stays the writers' actual vocabulary (the 0111-widened
--     set incl. 'assets'): the DB domain is the FLOOR (the union law's
--     domain), the NotificationCategory type is what the platform's
--     writers use — a future payroll inbox writer widens the type with
--     its wave (nothing speculative ships here).
--
--   THE FINGERPRINT AMENDMENT (the F1 dated correction at the original
--     claim sites — the plan §2 / the phase doc §4 / the matrix §3.27
--     note, all amended in this same increment): the W-19 final expected
--     fingerprint moves **the chain 111 → 112** (this repair); the
--     catalog 328 · the drift 337 · ROUTE_PERMISSIONS 1,102 unchanged.

--> statement-breakpoint
SET ROLE erp_migrate;

--> statement-breakpoint
ALTER TABLE "notifications" DROP CONSTRAINT IF EXISTS ck_notifications_category_values;
--> statement-breakpoint
ALTER TABLE "notifications" ADD CONSTRAINT ck_notifications_category_values
  CHECK ("category" IN (
    'limits', 'subscription', 'reconciliation', 'invoice_overdue', 'stock', 'templates', 'crm',
    'einvoicing', 'notes', 'installments', 'budgeting', 'payroll', 'purchasing', 'collections',
    'warranties', 'hr', 'assets'
  ));
--> statement-breakpoint
ALTER TABLE "notification_prefs" DROP CONSTRAINT IF EXISTS ck_notification_prefs_category_values;
--> statement-breakpoint
ALTER TABLE "notification_prefs" ADD CONSTRAINT ck_notification_prefs_category_values
  CHECK ("category" IN (
    'limits', 'subscription', 'reconciliation', 'invoice_overdue', 'stock', 'templates', 'crm',
    'einvoicing', 'notes', 'installments', 'budgeting', 'payroll', 'purchasing', 'collections',
    'warranties', 'hr', 'assets'
  ));

--> statement-breakpoint
RESET ROLE;

--> statement-breakpoint
-- Schema-state marker for /health/ready (mirrors the migration manifest).
INSERT INTO erp._schema_state (key, value) VALUES ('schema_version', 112)
ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, at = now();
