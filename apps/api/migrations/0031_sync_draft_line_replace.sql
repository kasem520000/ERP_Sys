-- PHASE-020 · migration 0031 · draft line-replace grant (sync update_draft)
--
-- Purpose (MASTER-PLAN §7 — CONFLICT_RESOLUTION §2 OWNER_DEVICE_WINS row;
-- SYNC_PROTOCOL §6.2 "update_draft commands are aggregate snapshots, not
-- line patches"): the sync draft-update handler replaces a DRAFT invoice's
-- lines wholesale (DELETE + re-INSERT by line_no). Migration 0018 granted
-- erp_app SELECT/INSERT/UPDATE on sales_invoice_lines — the online sales
-- module never deletes lines (its drafts are append-only), so no DELETE
-- grant existed. The sync path is a legitimate line-replacing writer:
-- the handler rejects any invoice whose status is not DRAFT (fail-closed
-- before any write), and OWNER_DEVICE_WINS guarantees a single writer,
-- so posted/approved document lines are unreachable by construction.
--
-- Additive grant only — no data, no RLS, no schema change.
--> statement-breakpoint
SET ROLE erp_migrate;

--> statement-breakpoint
-- ---------------------------------------------------------------------------
-- The sync update_draft aggregate replacement (0018's grant gap).
--> statement-breakpoint
GRANT DELETE ON "sales_invoice_lines" TO erp_app;
--> statement-breakpoint
RESET ROLE;

--> statement-breakpoint
-- Schema-state marker for /health/ready (mirrors the migration manifest).
INSERT INTO erp._schema_state (key, value) VALUES ('schema_version', 31)
ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, at = now();
