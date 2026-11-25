-- PHASE-051 (W-38 — T-11, dated 2026-11-25) · migration 0126 · THE
-- STOCK-MOVES SOURCE WIDENING the bonded engine's writers demand (the
-- 0117/0123 additive-slot precedent's own class, ordered WITH the
-- writers — the 0099/0111/0117/0118/0123 same-increment law: the
-- constraint and its writers land together, never after).
--
--   THE CLOSED-DOMAIN REFUSAL (the honest catch, disclosed at the
--     claim sites — the 0117 story VERBATIM): the bonded engine's
--     moves ride the REAL movement core (D-08's own law — the in-bond
--     transfer's two legs + the deposit's custodial receipt + the
--     release's physical legs, ALL sourced `bonded_move`), and the
--     closed ck_stock_moves_source_shape — the standing twenty-four
--     members of 0117's union — refused the first insert BY NAME,
--     exactly as the floor demands. The step-1 engine commit declared
--     «NO migration this wave» prematurely; this slot is the repair,
--     the DB spec's own first RED (the same honest-catch shape the
--     W-37 customs spec disclosed at its claim sites — the battery
--     keeps no standing red).
--
--   THE SHARED-SCOPE UNION LAW (the owner's W-17 acceptance, standing
--     from W-18/W-19): the widened list is the UNION of every member
--     every migration has EVER defined — the twenty-four of 0117 +
--     'bonded_move' here = TWENTY-FIVE — never a single migration's
--     list (the G-48 lesson); EXACTLY the one new source, no wider.
--
--   THE D-02 DISCLOSURE (the standing law — the wave's own final
--     expected fingerprint): the chain 125 → 126 · ENTITY_CATALOG 354
--     (ZERO table delta — this migration adds no tables, no views) ·
--     the permissions drift 357 unchanged (the W-38 routes bind the
--     EXISTING 0122-seeded trade.bonded.manage / trade.drawback.manage
--     keys; no new key) · ROUTE_PERMISSIONS 1,199 + 13 = 1,212 (the
--     W-38 dated delta at the block — the keys-seed-first FIFTH trade
--     binding wave).
--
--   Ledger-free by design: zero journal rules, zero invariants, zero
--   account purposes, zero plan grants (the bonded gate rides the
--   EXISTING `trade` feature flag — 0122 §5c), zero manifest updates
--   (the three trade-carrying templates already compose the flag).

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
  'warehouse_kit', 'cross_dock', 'contract_mfg', 'maintenance_work_order', 'ncr_record',
  'bonded_move'
));

--> statement-breakpoint
RESET ROLE;

--> statement-breakpoint
-- Schema-state marker for /health/ready (mirrors the migration manifest).
INSERT INTO erp._schema_state (key, value) VALUES ('schema_version', 126)
ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, at = now();
