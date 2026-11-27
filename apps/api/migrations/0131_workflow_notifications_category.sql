-- PHASE-052 (W-44 — T-03 + T-07's bus half, dated 2026-11-27) ·
-- migration 0131 · THE NOTIFICATIONS-CATEGORY WIDENING (the declared
-- additive slot, ordered WITH THE WRITER — the 0117/0118/0123
-- same-increment law: the constraint and its writer land together,
-- never after; the master plan §2's own declared slot: «0131
-- workflow_notifications_category.sql — LANDS IN W-44 WITH THE
-- WRITER»).
--
--   §1 THE WIDENING: the workflow engine's assignee-notification
--     writer ships in THIS wave (the chain's step-assignment inbox
--     records — the `workflow` category, D-10's own notification
--     surface), and its records carry category 'workflow' — a member
--     the closed notifications/notification_prefs CHECK domains do
--     not carry (the nineteen-member union of 0123).
--
--   THE SHARED-SCOPE UNION LAW (the owner's W-17 acceptance, standing
--     from W-18/W-19): the widened list is the UNION of every member
--     every migration has EVER defined — the nineteen of 0123 +
--     'workflow' here = TWENTY — never a single migration's list (the
--     G-48 lesson); the cmms-schema spec's notifications-category arm
--     (the standing proof) enumerates the members and asserts the
--     LIVE constraint equals that union — its dated enumeration
--     updates in THIS same increment (the arm's own design: the new
--     member goes RED there first, named, then the enumeration
--     carries it).
--
--   THE D-02 DISCLOSURE (the standing law — the wave's own final
--     expected fingerprint): the chain 130 → 131 · ENTITY_CATALOG 360
--     (ZERO table delta — this migration adds no tables, no views) ·
--     the permissions drift 366 unchanged (the engine's routes and
--     the inbox surface bind the EXISTING 0130-seeded workflow.* keys
--     — no new key) · ROUTE_PERMISSIONS 1,215 standing (the 0130 §1
--     keys-seed-first precedent: the service waves bind the seeded
--     keys, the routes land with their own controllers in the W-47+
--     deep-link/inbox waves — the W-44 engine core is exercised at
--     the service layer, zero new routes).
--
--   Ledger-free by design (red line §6.3: the workflow engine GATES
--     documents, it never posts — zero journal rules, zero invariants,
--     zero account purposes, zero plan grants; the five feature flags
--     ride the 0130 §5 grants; zero manifest updates).

--> statement-breakpoint
SET ROLE erp_migrate;

--> statement-breakpoint
ALTER TABLE "notifications" DROP CONSTRAINT IF EXISTS ck_notifications_category_values;
--> statement-breakpoint
ALTER TABLE "notifications" ADD CONSTRAINT ck_notifications_category_values
  CHECK ("category" IN (
    'limits', 'subscription', 'reconciliation', 'invoice_overdue', 'stock', 'templates', 'crm',
    'einvoicing', 'notes', 'installments', 'budgeting', 'payroll', 'purchasing', 'collections',
    'warranties', 'hr', 'assets', 'quality', 'trade', 'workflow'
  ));
--> statement-breakpoint
ALTER TABLE "notification_prefs" DROP CONSTRAINT IF EXISTS ck_notification_prefs_category_values;
--> statement-breakpoint
ALTER TABLE "notification_prefs" ADD CONSTRAINT ck_notification_prefs_category_values
  CHECK ("category" IN (
    'limits', 'subscription', 'reconciliation', 'invoice_overdue', 'stock', 'templates', 'crm',
    'einvoicing', 'notes', 'installments', 'budgeting', 'payroll', 'purchasing', 'collections',
    'warranties', 'hr', 'assets', 'quality', 'trade', 'workflow'
  ));

--> statement-breakpoint
RESET ROLE;

--> statement-breakpoint
-- Schema-state marker for /health/ready (mirrors the migration manifest).
INSERT INTO erp._schema_state (key, value) VALUES ('schema_version', 131)
ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, at = now();
