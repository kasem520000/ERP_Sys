-- PHASE-044 (Blueprint v3.0 · CR-14) · migration 0069 · WMS & Inventory
-- Intelligence (part 3: cycle counting + ABC + the serial-movement ledger).
--
-- Purpose (PHASE-044 §2.6/§2.7/§2.12, I-08/I-09/I-20/I-16/I-18):
--
--   cycle_count_schedules — ABC-frequency-based count schedules: per-class
--     day intervals + the variance approval threshold (BR-075) + blind
--     counting; the schedule run generates count documents.
--   cycle_count_documents + cycle_count_lines — the generated (or manual)
--     count documents: DRAFT → COUNTED → VARIANCE_REVIEW → POSTED, lines
--     per (item, bin) with the frozen system-qty snapshot, recount notes,
--     and the value impact; variances post through the EXISTING adjustment
--     shapes (G-13/G-14) with CYCLE_COUNT_LOSS / CYCLE_COUNT_GAIN reasons
--     — the G-13/G-14 reuse note (JOURNAL_RULES §7).
--   abc_classifications — computed from consumption value + velocity over
--     a lookback window; the latest row per item is the floor
--     (is_latest partial unique); drives count frequency + slotting hints.
--   serial_movements — the append-only per-serial ledger (the audit's
--     "serials without movements" gap closed): one row per serial per
--     movement event with document + bin references (T-11's completeness
--     property: every stock movement touching a serialized item appends
--     EXACTLY one row).
--
-- Grants: schedules/classifications are master data; documents/lines are
-- document rows; serial_movements is an append-only ledger (SELECT/INSERT
-- only — the stock_moves discipline).

--> statement-breakpoint
SET ROLE erp_migrate;

--> statement-breakpoint
-- ---------------------------------------------------------------------------
-- 1. cycle_count_schedules (§2.6, I-08/I-20): per-warehouse ABC frequency.
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "cycle_count_schedules" (
  "id" uuid NOT NULL,
  "tenant_id" uuid NOT NULL REFERENCES "tenants" ("id") ON DELETE RESTRICT,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "updated_at" timestamptz NOT NULL DEFAULT now(),
  "version" integer NOT NULL DEFAULT 1,
  "warehouse_id" uuid NOT NULL,
  "name" text NOT NULL,
  "class_a_days" integer NOT NULL DEFAULT 30,
  "class_b_days" integer NOT NULL DEFAULT 90,
  "class_c_days" integer NOT NULL DEFAULT 180,
  "approval_threshold" numeric(19, 4) NOT NULL DEFAULT 0,
  "blind" boolean NOT NULL DEFAULT false,
  "is_active" boolean NOT NULL DEFAULT true,
  "last_run_at" timestamptz,
  "note" text,
  "created_by" uuid,
  CONSTRAINT "pk_cycle_count_schedules" PRIMARY KEY ("id"),
  CONSTRAINT "uq_cycle_count_schedules_id_tenant" UNIQUE ("id", "tenant_id"),
  CONSTRAINT "uq_cycle_count_schedules_tenant_wh_name" UNIQUE ("tenant_id", "warehouse_id", "name"),
  CONSTRAINT "ck_cycle_count_schedules_days" CHECK (
    "class_a_days" >= 1 AND "class_b_days" >= 1 AND "class_c_days" >= 1
      AND "class_a_days" <= "class_b_days" AND "class_b_days" <= "class_c_days"
  ),
  CONSTRAINT "ck_cycle_count_schedules_threshold" CHECK ("approval_threshold" >= 0)
);

--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "ix_cycle_count_schedules_tenant_wh_active"
  ON "cycle_count_schedules" ("tenant_id", "warehouse_id", "is_active");

--> statement-breakpoint
ALTER TABLE "cycle_count_schedules"
  ADD CONSTRAINT "fk_cycle_count_schedules_warehouse"
  FOREIGN KEY ("warehouse_id", "tenant_id") REFERENCES "warehouses" ("id", "tenant_id") ON DELETE CASCADE;

--> statement-breakpoint
-- ---------------------------------------------------------------------------
-- 2. cycle_count_documents (§2.6): the count session (the stock_counts
--    shape, bin-aware). count_no (CC-) lands at POST (the stock_counts
--    numbering discipline); the supervisor flag records BR-075's
--    over-threshold approval.
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "cycle_count_documents" (
  "id" uuid NOT NULL,
  "tenant_id" uuid NOT NULL REFERENCES "tenants" ("id") ON DELETE RESTRICT,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "updated_at" timestamptz NOT NULL DEFAULT now(),
  "version" integer NOT NULL DEFAULT 1,
  "count_no" text,
  "schedule_id" uuid,
  "warehouse_id" uuid NOT NULL,
  "status" text NOT NULL DEFAULT 'DRAFT',
  "snapshot_at" timestamptz NOT NULL,
  "count_date" date,
  "blind" boolean NOT NULL DEFAULT false,
  "variance_loss_value" numeric(19, 4),
  "variance_gain_value" numeric(19, 4),
  "supervisor_override" boolean NOT NULL DEFAULT false,
  "counted_by" uuid,
  "approved_by" uuid,
  "posted_journal_id" uuid,
  "note" text,
  "note_ar" text,
  "created_by" uuid,
  CONSTRAINT "pk_cycle_count_documents" PRIMARY KEY ("id"),
  CONSTRAINT "uq_cycle_count_documents_id_tenant" UNIQUE ("id", "tenant_id"),
  CONSTRAINT "uq_cycle_count_documents_tenant_count_no" UNIQUE ("tenant_id", "count_no"),
  CONSTRAINT "ck_cycle_count_documents_status" CHECK (
    "status" IN ('DRAFT', 'COUNTED', 'VARIANCE_REVIEW', 'POSTED', 'CANCELLED')
  ),
  -- POSTED carries its evidence (number + journal + stamps).
  CONSTRAINT "ck_cycle_count_documents_state_evidence" CHECK (
    ("status" = 'POSTED') = ("count_no" IS NOT NULL AND "count_date" IS NOT NULL)
  )
);

--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "ix_cycle_count_documents_tenant_wh_status"
  ON "cycle_count_documents" ("tenant_id", "warehouse_id", "status");

--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "ix_cycle_count_documents_tenant_schedule"
  ON "cycle_count_documents" ("tenant_id", "schedule_id");

--> statement-breakpoint
ALTER TABLE "cycle_count_documents"
  ADD CONSTRAINT "fk_cycle_count_documents_schedule"
  FOREIGN KEY ("schedule_id", "tenant_id") REFERENCES "cycle_count_schedules" ("id", "tenant_id") ON DELETE SET NULL;

--> statement-breakpoint
ALTER TABLE "cycle_count_documents"
  ADD CONSTRAINT "fk_cycle_count_documents_warehouse"
  FOREIGN KEY ("warehouse_id", "tenant_id") REFERENCES "warehouses" ("id", "tenant_id") ON DELETE RESTRICT;

--> statement-breakpoint
-- ---------------------------------------------------------------------------
-- 3. cycle_count_lines (§2.6): per (item, bin) — the system qty snapshot
--    frozen at session create; the reason stamps the posting leg.
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "cycle_count_lines" (
  "id" uuid NOT NULL,
  "tenant_id" uuid NOT NULL REFERENCES "tenants" ("id") ON DELETE RESTRICT,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "updated_at" timestamptz NOT NULL DEFAULT now(),
  "version" integer NOT NULL DEFAULT 1,
  "document_id" uuid NOT NULL,
  "line_no" integer NOT NULL,
  "item_id" uuid NOT NULL,
  "bin_id" uuid,
  "batch_id" uuid,
  "system_qty" numeric(19, 6) NOT NULL,
  "counted_qty" numeric(19, 6),
  "recounted" boolean NOT NULL DEFAULT false,
  "recount_note" text,
  "value_impact" numeric(19, 4),
  "reason" text,
  "created_by" uuid,
  CONSTRAINT "pk_cycle_count_lines" PRIMARY KEY ("id"),
  CONSTRAINT "uq_cycle_count_lines_id_tenant" UNIQUE ("id", "tenant_id"),
  CONSTRAINT "uq_cycle_count_lines_doc_line" UNIQUE ("tenant_id", "document_id", "line_no"),
  CONSTRAINT "ck_cycle_count_lines_line_no" CHECK ("line_no" >= 1),
  CONSTRAINT "ck_cycle_count_lines_qty" CHECK (
    "system_qty" >= 0 AND ("counted_qty" IS NULL OR "counted_qty" >= 0)
  )
);

--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "ix_cycle_count_lines_tenant_doc"
  ON "cycle_count_lines" ("tenant_id", "document_id");

--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "ix_cycle_count_lines_tenant_item"
  ON "cycle_count_lines" ("tenant_id", "item_id");

--> statement-breakpoint
ALTER TABLE "cycle_count_lines"
  ADD CONSTRAINT "fk_cycle_count_lines_document"
  FOREIGN KEY ("document_id", "tenant_id") REFERENCES "cycle_count_documents" ("id", "tenant_id") ON DELETE CASCADE;

--> statement-breakpoint
ALTER TABLE "cycle_count_lines"
  ADD CONSTRAINT "fk_cycle_count_lines_item"
  FOREIGN KEY ("item_id", "tenant_id") REFERENCES "items" ("id", "tenant_id") ON DELETE RESTRICT;

--> statement-breakpoint
ALTER TABLE "cycle_count_lines"
  ADD CONSTRAINT "fk_cycle_count_lines_bin"
  FOREIGN KEY ("bin_id", "tenant_id") REFERENCES "warehouse_bins" ("id", "tenant_id") ON DELETE RESTRICT;

--> statement-breakpoint
ALTER TABLE "cycle_count_lines"
  ADD CONSTRAINT "fk_cycle_count_lines_batch"
  FOREIGN KEY ("batch_id", "tenant_id") REFERENCES "item_batches" ("id", "tenant_id") ON DELETE RESTRICT;

--> statement-breakpoint
-- ---------------------------------------------------------------------------
-- 4. abc_classifications (§2.7, I-09): computed per item from the
--    consumption value + velocity over a lookback window; is_latest is
--    the one-row floor (a recompute demotes the previous latest).
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "abc_classifications" (
  "id" uuid NOT NULL,
  "tenant_id" uuid NOT NULL REFERENCES "tenants" ("id") ON DELETE RESTRICT,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "updated_at" timestamptz NOT NULL DEFAULT now(),
  "version" integer NOT NULL DEFAULT 1,
  "item_id" uuid NOT NULL,
  "computed_at" timestamptz NOT NULL,
  "window_days" integer NOT NULL,
  "class" text NOT NULL,
  "consumption_value" numeric(19, 4) NOT NULL DEFAULT 0,
  "total_qty_out" numeric(19, 6) NOT NULL DEFAULT 0,
  "velocity" numeric(19, 6) NOT NULL DEFAULT 0,
  "rank_no" integer NOT NULL,
  "is_latest" boolean NOT NULL DEFAULT true,
  "created_by" uuid,
  CONSTRAINT "pk_abc_classifications" PRIMARY KEY ("id"),
  CONSTRAINT "uq_abc_classifications_id_tenant" UNIQUE ("id", "tenant_id"),
  CONSTRAINT "ck_abc_classifications_class" CHECK ("class" IN ('A', 'B', 'C')),
  CONSTRAINT "ck_abc_classifications_window" CHECK ("window_days" >= 1),
  CONSTRAINT "ck_abc_classifications_rank" CHECK ("rank_no" >= 1),
  CONSTRAINT "ck_abc_classifications_amounts" CHECK (
    "consumption_value" >= 0 AND "total_qty_out" >= 0 AND "velocity" >= 0
  )
);

--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "ix_abc_classifications_tenant_latest"
  ON "abc_classifications" ("tenant_id", "is_latest", "class");

--> statement-breakpoint
-- One LATEST classification per item (the partial floor).
CREATE UNIQUE INDEX IF NOT EXISTS "uq_abc_classifications_latest_item"
  ON "abc_classifications" ("tenant_id", "item_id") WHERE "is_latest";

--> statement-breakpoint
ALTER TABLE "abc_classifications"
  ADD CONSTRAINT "fk_abc_classifications_item"
  FOREIGN KEY ("item_id", "tenant_id") REFERENCES "items" ("id", "tenant_id") ON DELETE CASCADE;

--> statement-breakpoint
-- ---------------------------------------------------------------------------
-- 5. serial_movements (§2.12, I-16/I-18): the append-only per-serial
--    ledger — one row per serial per movement event, with the document
--    references + the bin endpoints. No updated_at (INSERT-only floor,
--    the stock_moves discipline).
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "serial_movements" (
  "id" uuid NOT NULL,
  "tenant_id" uuid NOT NULL REFERENCES "tenants" ("id") ON DELETE RESTRICT,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "serial_id" uuid NOT NULL,
  "event" text NOT NULL,
  "move_id" uuid,
  "source_type" text NOT NULL,
  "source_id" uuid NOT NULL,
  "from_bin_id" uuid,
  "to_bin_id" uuid,
  "moved_at" timestamptz NOT NULL,
  "note" text,
  "created_by" uuid,
  CONSTRAINT "pk_serial_movements" PRIMARY KEY ("id"),
  CONSTRAINT "uq_serial_movements_id_tenant" UNIQUE ("id", "tenant_id"),
  CONSTRAINT "ck_serial_movements_event" CHECK (
    "event" IN (
      'RECEIVE', 'PUTAWAY', 'PICK', 'TRANSFER_OUT', 'TRANSFER_IN',
      'ADJUST_OUT', 'ADJUST_IN', 'RETURN', 'QUARANTINE', 'RELEASE',
      'SCRAP', 'CONSIGNMENT_IN', 'CONSIGNMENT_OUT', 'KIT_IN', 'KIT_OUT',
      'SETTLE'
    )
  )
);

--> statement-breakpoint
-- The ledger walk (OA-06 budget): newest-first per serial.
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "ix_serial_movements_tenant_serial_time"
  ON "serial_movements" ("tenant_id", "serial_id", "moved_at" DESC);

--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "ix_serial_movements_tenant_source"
  ON "serial_movements" ("tenant_id", "source_type", "source_id");

--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "ix_serial_movements_tenant_move"
  ON "serial_movements" ("tenant_id", "move_id");

--> statement-breakpoint
ALTER TABLE "serial_movements"
  ADD CONSTRAINT "fk_serial_movements_serial"
  FOREIGN KEY ("serial_id", "tenant_id") REFERENCES "item_serials" ("id", "tenant_id") ON DELETE RESTRICT;

--> statement-breakpoint
ALTER TABLE "serial_movements"
  ADD CONSTRAINT "fk_serial_movements_move"
  FOREIGN KEY ("move_id", "tenant_id") REFERENCES "stock_moves" ("id", "tenant_id") ON DELETE RESTRICT;

--> statement-breakpoint
ALTER TABLE "serial_movements"
  ADD CONSTRAINT "fk_serial_movements_from_bin"
  FOREIGN KEY ("from_bin_id", "tenant_id") REFERENCES "warehouse_bins" ("id", "tenant_id") ON DELETE RESTRICT;

--> statement-breakpoint
ALTER TABLE "serial_movements"
  ADD CONSTRAINT "fk_serial_movements_to_bin"
  FOREIGN KEY ("to_bin_id", "tenant_id") REFERENCES "warehouse_bins" ("id", "tenant_id") ON DELETE RESTRICT;

--> statement-breakpoint
-- ---------------------------------------------------------------------------
-- 6. RLS — the house triple for the five new tables.
--> statement-breakpoint
ALTER TABLE "cycle_count_schedules" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "cycle_count_schedules" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
SELECT erp.apply_tenant_policy('"cycle_count_schedules"');
--> statement-breakpoint
ALTER TABLE "cycle_count_documents" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "cycle_count_documents" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
SELECT erp.apply_tenant_policy('"cycle_count_documents"');
--> statement-breakpoint
ALTER TABLE "cycle_count_lines" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "cycle_count_lines" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
SELECT erp.apply_tenant_policy('"cycle_count_lines"');
--> statement-breakpoint
ALTER TABLE "abc_classifications" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "abc_classifications" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
SELECT erp.apply_tenant_policy('"abc_classifications"');
--> statement-breakpoint
ALTER TABLE "serial_movements" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "serial_movements" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
SELECT erp.apply_tenant_policy('"serial_movements"');
--> statement-breakpoint
DO $$
DECLARE
  t text;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'cycle_count_schedules', 'cycle_count_documents', 'cycle_count_lines',
    'abc_classifications', 'serial_movements'
  ] LOOP
    EXECUTE format('DROP POLICY IF EXISTS purge_path_delete ON public.%I', t);
    EXECUTE format('DROP POLICY IF EXISTS purge_path_update ON public.%I', t);
    EXECUTE format(
      'CREATE POLICY purge_path_delete ON public.%I FOR DELETE TO erp_migrate '
        || 'USING (tenant_id = erp.current_tenant_id())', t);
    EXECUTE format(
      'CREATE POLICY purge_path_update ON public.%I FOR UPDATE TO erp_migrate '
        || 'USING (tenant_id = erp.current_tenant_id()) WITH CHECK (true)', t);
  END LOOP;
END $$;

--> statement-breakpoint
-- ---------------------------------------------------------------------------
-- 7. Grants.
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE ON "cycle_count_schedules" TO erp_app;
--> statement-breakpoint
GRANT SELECT ON "cycle_count_schedules" TO erp_readonly;
--> statement-breakpoint
GRANT SELECT ON "cycle_count_schedules" TO erp_definer;
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE ON "cycle_count_documents" TO erp_app;
--> statement-breakpoint
GRANT SELECT ON "cycle_count_documents" TO erp_readonly;
--> statement-breakpoint
GRANT SELECT ON "cycle_count_documents" TO erp_definer;
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE ON "cycle_count_lines" TO erp_app;
--> statement-breakpoint
GRANT SELECT ON "cycle_count_lines" TO erp_readonly;
--> statement-breakpoint
GRANT SELECT ON "cycle_count_lines" TO erp_definer;
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE ON "abc_classifications" TO erp_app;
--> statement-breakpoint
GRANT SELECT ON "abc_classifications" TO erp_readonly;
--> statement-breakpoint
GRANT SELECT ON "abc_classifications" TO erp_definer;
--> statement-breakpoint
-- Append-only ledger: no app-role UPDATE (the stock_moves discipline).
--> statement-breakpoint
GRANT SELECT, INSERT ON "serial_movements" TO erp_app;
--> statement-breakpoint
GRANT SELECT ON "serial_movements" TO erp_readonly;
--> statement-breakpoint
GRANT SELECT ON "serial_movements" TO erp_definer;

--> statement-breakpoint
RESET ROLE;

--> statement-breakpoint
-- Schema-state marker for /health/ready (mirrors the migration manifest).
INSERT INTO erp._schema_state (key, value) VALUES ('schema_version', 69)
ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, at = now();
