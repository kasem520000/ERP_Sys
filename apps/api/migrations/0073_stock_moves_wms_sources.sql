-- PHASE-044 (T-07) · migration 0073 · the stock_moves source-shape
-- extension for the WMS document family.
--
-- The 0027 closed list gains the phase's five document sources:
--
--   cycle_count            — T-07: the cycle-count variance posting (the
--                            G-13/G-14 reuse with CYCLE_COUNT_LOSS /
--                            CYCLE_COUNT_GAIN reasons; docType
--                            `cycle_count`, CC- numbering).
--   quarantine_disposition — T-08: the Q-board's dispositions (release /
--                            return-to-vendor / scrap — the scrap leg
--                            posts the G-13 shrinkage shape).
--   consignment_settlement — T-09: the consignment consumption settlement
--                            (the G-48 owner-partner leg).
--   warehouse_kit          — T-10: the kit BOM consumption + the kit
--                            receipt (the G-45 roll-up).
--   cross_dock             — T-10: the dock-side receive-and-ship bypass.
--
-- Additive-only (the 0027 replacement pattern): every existing row
-- satisfies the widened constraint.

--> statement-breakpoint
SET ROLE erp_migrate;

--> statement-breakpoint
ALTER TABLE "stock_moves" DROP CONSTRAINT IF EXISTS ck_stock_moves_source_shape;

--> statement-breakpoint
ALTER TABLE "stock_moves" ADD CONSTRAINT ck_stock_moves_source_shape CHECK ("source_type" IN (
  'manual_receipt', 'manual_issue', 'stock_adjustment', 'stock_count', 'stock_transfer',
  'opening_balance_doc', 'method_switch', 'goods_receipt', 'supplier_invoice', 'landed_cost',
  'delivery_note', 'sales_invoice', 'credit_note', 'job_card', 'production_order',
  'service_order', 'cycle_count', 'quarantine_disposition', 'consignment_settlement',
  'warehouse_kit', 'cross_dock'
));

--> statement-breakpoint
RESET ROLE;

--> statement-breakpoint
-- Schema-state marker for /health/ready (mirrors the migration manifest).
INSERT INTO erp._schema_state (key, value) VALUES ('schema_version', 73)
ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, at = now();
