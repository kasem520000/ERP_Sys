-- PHASE-049 (W-17, dated 2026-11-21) · migration 0110 · THE STOCK-MOVES
-- SOURCE-SHAPE REPAIR — the honest catch of the wave's own first full
-- DB-suite run: 0109's DROP+ADD of ck_stock_moves_source_shape rebuilt
-- the domain list from 0073's shape and MISSED 'contract_mfg' (added by
-- 0077 §3 — the tolling pair's stock_moves source). The G-48 tolling
-- golden caught it in the load envelope (chunk-b-rest's first run, TWO
-- RED arms — the preserved log
-- audit-evidence/phase049-w17/db-chunk-b-rest-first-red.log; the
-- regression-protocol law's exact shape: the RED log kept verbatim, the
-- fix dated at the site, the green re-run after).
--
-- 0109 is PUBLISHED (pushed at the wave's step-2 checkpoint — the
-- constants law: no touching any published migration), so the repair is
-- THIS additive slot: the constraint re-added with the COMPLETE domain —
-- 0077's full list + 'maintenance_work_order' (0109's own addition,
-- kept). The journal 109 → 110; the catalog stays 328 (no tables).
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
  'warehouse_kit', 'cross_dock', 'contract_mfg', 'maintenance_work_order'
));

--> statement-breakpoint
RESET ROLE;

--> statement-breakpoint
-- Schema-state marker for /health/ready (mirrors the migration manifest).
INSERT INTO erp._schema_state (key, value) VALUES ('schema_version', 110)
ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, at = now();
