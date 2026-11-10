-- PHASE-019 · migration 0028 · service-order reservation holders
--
-- Purpose (the T48 deviation, recorded in agent-ctx/T48-7-service-orders.md):
-- migration 0027 created `service_orders` mirroring job_cards byte-close and
-- widened `stock_moves.source_type` with 'service_order', but MISSED the
-- equivalent reservation-holder widening — `stock_reservations.holder_type`
-- still carries 0025's CHECK ('MANUAL', 'SALES_ORDER', 'JOB_CARD'), so a
-- `reserve`-mode service-order approval (holderType "SERVICE_ORDER", the
-- MASTER-PLAN §7 binding requirement) would violate the constraint. Job
-- cards' 'JOB_CARD' holder arrived through 0025's own widening in the same
-- migration that created job_cards; 0027 shipped without its counterpart.
--
-- This migration re-issues the holder CHECK with 'SERVICE_ORDER' added (the
-- exact 0025 DROP + ADD pattern). It cannot be folded into 0027 retroactively
-- — 0027 is applied in every existing database and editing an applied
-- migration file desyncs drizzle's journal. The class of gap is the T44
-- precedent (manual_journal_lines.project_id missed by §10's first draft and
-- folded into 0027 "this time"); here the fold window had already closed, so
-- the honest close is this dedicated widening. Additive only — no data, no
-- RLS (holder values widen on an existing table whose policy is unchanged),
-- no new grants (the column rides its existing table-level grants).
--> statement-breakpoint
SET ROLE erp_migrate;

--> statement-breakpoint
-- ---------------------------------------------------------------------------
-- Reservation holders gain SERVICE_ORDER (the 0025 JOB_CARD precedent).
--> statement-breakpoint
ALTER TABLE "stock_reservations" DROP CONSTRAINT IF EXISTS ck_stock_reservations_holder_values;
--> statement-breakpoint
ALTER TABLE "stock_reservations" ADD CONSTRAINT ck_stock_reservations_holder_values
  CHECK ("holder_type" IN ('MANUAL', 'SALES_ORDER', 'JOB_CARD', 'SERVICE_ORDER'));
--> statement-breakpoint
RESET ROLE;

--> statement-breakpoint
-- Schema-state marker for /health/ready (mirrors the migration manifest).
INSERT INTO erp._schema_state (key, value) VALUES ('schema_version', 28)
ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, at = now();
