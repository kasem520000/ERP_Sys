-- PHASE-043 (Blueprint v3.0 · CR-13) · migration 0079 · Manufacturing II —
-- MRP & Planning (part 6: the transfer conversion link — the acceptance
-- criterion 3 completion).
--
-- Purpose: 0076 wired the bidirectional suggestion→document link for the
-- PURCHASE_ORDER and PRODUCTION_ORDER conversions (purchase_orders.
-- mrp_suggestion_id + production_orders.mrp_suggestion_id). The TRANSFER
-- conversion was left document-side-blind — acceptance criterion 3 says
-- EVERY converted document carries the bidirectional link. This small
-- additive migration closes it: stock_transfers.mrp_suggestion_id, the
-- same FK shape as the 0076 pair.
--
-- Additive-only; NULL by default; no backfill (existing transfers predate
-- the planning surface and carry no suggestion).

--> statement-breakpoint
SET ROLE erp_migrate;

--> statement-breakpoint
-- ---------------------------------------------------------------------------
-- 1. stock_transfers.mrp_suggestion_id (the TRANSFER leg of the
--    bidirectional conversion link — acceptance criterion 3).
--> statement-breakpoint
ALTER TABLE "stock_transfers" ADD COLUMN IF NOT EXISTS "mrp_suggestion_id" uuid;
--> statement-breakpoint
ALTER TABLE "stock_transfers" DROP CONSTRAINT IF EXISTS fk_stock_transfers_mrp_suggestion;
--> statement-breakpoint
ALTER TABLE "stock_transfers" ADD CONSTRAINT fk_stock_transfers_mrp_suggestion
  FOREIGN KEY ("mrp_suggestion_id", "tenant_id")
  REFERENCES "mrp_suggestions" ("id", "tenant_id") ON DELETE RESTRICT;

--> statement-breakpoint
RESET ROLE;

--> statement-breakpoint
-- Schema-state marker for /health/ready (mirrors the migration manifest).
INSERT INTO erp._schema_state (key, value) VALUES ('schema_version', 79)
ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, at = now();
