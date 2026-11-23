-- PHASE-050 (W-25 — T-06, dated 2026-11-23) · migration 0117 · THE
-- STOCK-MOVES SOURCE WIDENING FOR G-62's WRITE-OFF — the honest catch of
-- the wave's own first DB run (the 0109/0110 precedent, the G-48
-- class): D-05's scrap write-off sources its moves `ncr_record` through
-- the REAL WMS path (planIssue/applyIssue — the G-60 discipline), but
-- ck_stock_moves_source_shape is a CLOSED domain and its standing
-- twenty-four members (0110's own list) do not include it — the
-- write-off's first insert was refused BY NAME, exactly as the floor
-- demands. 0110 is PUBLISHED (the constants law: no touching any
-- published migration), so the widening is THIS additive slot: the
-- constraint re-added with the COMPLETE domain — the standing list +
-- 'ncr_record' (EXACTLY the one new source; no wider). The journal
-- 116 → 117; the catalog stays 340 (no tables).
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
  'warehouse_kit', 'cross_dock', 'contract_mfg', 'maintenance_work_order', 'ncr_record'
));

--> statement-breakpoint
RESET ROLE;

--> statement-breakpoint
-- Schema-state marker for /health/ready (mirrors the migration manifest).
INSERT INTO erp._schema_state (key, value) VALUES ('schema_version', 117)
ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, at = now();
