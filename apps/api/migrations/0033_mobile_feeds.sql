-- PHASE-022 · migration 0033 · mobile feeds (DR-P22-05 / DR-P22-05a)
--
-- Purpose (PHASE-022 MASTER-PLAN §0 golden constants + §1 DR-P22-05): the
-- 022 feed activation — FEED_GROUPS.field (van_stocks / routes /
-- settlement_templates / statements) + FEED_GROUPS.personal (statements /
-- sales_invoices / receipts / notifications, partner-scoped server-side).
-- The feeds ride the EXISTING 020 change_log machinery (the pull-time
-- catch-up writer + the seq cursor serve; no triggers, no new feed tables),
-- so the only schema object the activation needs is the personal device's
-- linked partner:
--
--   devices.linked_partner_id (nullable uuid)
--
-- devices stays service-mediated (PHASE-003 §4: no tenant_id, no RLS), so a
-- cross-plane FK into the RLS'd partners table is impossible by design —
-- the column is a plain uuid, validated by the registration surface (the
-- owning service reads partners under the tenant GUC) and consumed
-- server-side by the pull path's partner-scope filter (LOCAL_DATABASE §1.1
-- rule 2: a tampered personal device cannot pull other partners' rows).
-- NULL = no linkage (a personal device without linkage pulls an empty
-- partner scope — fail closed, never an unscoped serve).
--
-- No business-schema change: van_stocks / routes / rep_settlements (the
-- settlement_templates source) / receipts / notifications keep their
-- PHASE-012/017 shapes verbatim; statements are computed per-partner at
-- pull time (the permissions-snapshot pattern) over the existing AR
-- subledger. No data change, no RLS change, no new feed tables.
--> statement-breakpoint
SET ROLE erp_migrate;

--> statement-breakpoint
-- The personal-account device's linked partner (022 pull scoping).
ALTER TABLE "devices" ADD COLUMN IF NOT EXISTS "linked_partner_id" uuid;
--> statement-breakpoint
RESET ROLE;

--> statement-breakpoint
-- Schema-state marker for /health/ready (mirrors the migration manifest).
INSERT INTO erp._schema_state (key, value) VALUES ('schema_version', 33)
ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, at = now();
