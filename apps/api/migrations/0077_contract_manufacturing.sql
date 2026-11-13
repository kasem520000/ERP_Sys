-- PHASE-043 (Blueprint v3.0 · CR-13) · migration 0077 · Manufacturing II —
-- MRP & Planning (part 4: the contract manufacturing / tolling flow).
--
-- Purpose (PHASE-043 §2.8, M-21): the tolling round trip —
--
--   contract_mfg_orders — a tolling order against a processor partner:
--     material issue to the processor (stock-at-processor tracking through
--     the TOLLING_MATERIALS subledger), the conversion-service purchase
--     order created through the PHASE-038 path (no duplicated
--     document-creation logic), and the return with yield/scrap settlement.
--   contract_mfg_moves — the stock-at-processor ledger: one row per
--     ISSUE_TO_PROCESSOR / RETURN_FINISHED / RETURN_MATERIAL / YIELD_LOSS
--     leg with its stock move + journal; the settlement invariant is
--     Σ issue = Σ return + Σ yield per order (balances to zero on full
--     return — acceptance criterion 7, G-48).
--
-- CoA template markers (the 0026/0065/0070 additive pattern): 1420
-- TOLLING_MATERIALS (the stock-at-processor asset), 2136
-- TOLLING_CONVERSION_PAYABLE (the conversion-fee accrual cleared by the
-- fee PO's supplier invoice through AP), 5126 TOLLING_YIELD_LOSS (the
-- explicit yield-loss expense). Existing tenants map once — fail-closed
-- PURPOSE_NOT_MAPPED until then (the DR-016-02 precedent).
--
-- stock_moves.source_type gains 'contract_mfg' (the 0073 replacement
-- pattern, additive-only).

--> statement-breakpoint
SET ROLE erp_migrate;

--> statement-breakpoint
-- ---------------------------------------------------------------------------
-- 1. contract_mfg_orders (§2.8, M-21). TLG-{YYYY}-{SEQ:5} at issue (the
--    production_orders PRD pattern — DRAFT rows carry no number).
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "contract_mfg_orders" (
  "id" uuid NOT NULL,
  "tenant_id" uuid NOT NULL REFERENCES "tenants" ("id") ON DELETE RESTRICT,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "updated_at" timestamptz NOT NULL DEFAULT now(),
  "version" integer NOT NULL DEFAULT 1,
  "tolling_no" text,
  "processor_partner_id" uuid NOT NULL,
  "item_id" uuid NOT NULL,
  "bom_id" uuid NOT NULL,
  "warehouse_id" uuid NOT NULL,
  "planned_qty" numeric(19, 6) NOT NULL,
  "uom_id" uuid NOT NULL,
  "status" text NOT NULL DEFAULT 'DRAFT',
  "fee_po_id" uuid,
  "conversion_fee" numeric(19, 6),
  "expected_return_date" date,
  "note" text,
  "note_ar" text,
  "issued_at" timestamptz,
  "returned_at" timestamptz,
  "settled_at" timestamptz,
  "cancelled_at" timestamptz,
  "cancel_reason" text,
  "created_by" uuid,
  CONSTRAINT "pk_contract_mfg_orders" PRIMARY KEY ("id"),
  CONSTRAINT "uq_contract_mfg_orders_id_tenant" UNIQUE ("id", "tenant_id"),
  CONSTRAINT "uq_contract_mfg_orders_tenant_no" UNIQUE ("tenant_id", "tolling_no")
    DEFERRABLE INITIALLY DEFERRED,
  CONSTRAINT "ck_contract_mfg_orders_status" CHECK ("status" IN ('DRAFT', 'ISSUED', 'RETURNED', 'SETTLED', 'CANCELLED')),
  CONSTRAINT "ck_contract_mfg_orders_qty" CHECK ("planned_qty" > 0),
  CONSTRAINT "ck_contract_mfg_orders_fee" CHECK ("conversion_fee" IS NULL OR "conversion_fee" >= 0),
  CONSTRAINT "ck_contract_mfg_orders_issued_shape" CHECK (
    ("status" = 'DRAFT') OR ("issued_at" IS NOT NULL AND "tolling_no" IS NOT NULL)
  ),
  CONSTRAINT "ck_contract_mfg_orders_fee_shape" CHECK (
    "fee_po_id" IS NULL OR ("conversion_fee" IS NOT NULL AND "status" <> 'DRAFT')
  ),
  CONSTRAINT "fk_contract_mfg_orders_partner" FOREIGN KEY ("processor_partner_id", "tenant_id")
    REFERENCES "partners" ("id", "tenant_id") ON DELETE RESTRICT,
  CONSTRAINT "fk_contract_mfg_orders_item" FOREIGN KEY ("item_id", "tenant_id")
    REFERENCES "items" ("id", "tenant_id") ON DELETE RESTRICT,
  CONSTRAINT "fk_contract_mfg_orders_bom" FOREIGN KEY ("bom_id", "tenant_id")
    REFERENCES "bills_of_materials" ("id", "tenant_id") ON DELETE RESTRICT,
  CONSTRAINT "fk_contract_mfg_orders_warehouse" FOREIGN KEY ("warehouse_id", "tenant_id")
    REFERENCES "warehouses" ("id", "tenant_id") ON DELETE RESTRICT,
  CONSTRAINT "fk_contract_mfg_orders_uom" FOREIGN KEY ("uom_id", "tenant_id")
    REFERENCES "uoms" ("id", "tenant_id") ON DELETE RESTRICT,
  CONSTRAINT "fk_contract_mfg_orders_fee_po" FOREIGN KEY ("fee_po_id", "tenant_id")
    REFERENCES "purchase_orders" ("id", "tenant_id") ON DELETE RESTRICT
);

--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "ix_contract_mfg_orders_tenant_status"
  ON "contract_mfg_orders" ("tenant_id", "status");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "ix_contract_mfg_orders_tenant_no"
  ON "contract_mfg_orders" ("tenant_id", "tolling_no")
  WHERE "tolling_no" IS NOT NULL;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "ix_contract_mfg_orders_partner"
  ON "contract_mfg_orders" ("tenant_id", "processor_partner_id");

--> statement-breakpoint
-- ---------------------------------------------------------------------------
-- 2. contract_mfg_moves (§2.8): the stock-at-processor ledger — one row
--    per leg; RETURN_FINISHED carries the produced batch, YIELD_LOSS
--    carries the explicit settlement (never silent scrap).
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "contract_mfg_moves" (
  "id" uuid NOT NULL,
  "tenant_id" uuid NOT NULL REFERENCES "tenants" ("id") ON DELETE RESTRICT,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "updated_at" timestamptz NOT NULL DEFAULT now(),
  "version" integer NOT NULL DEFAULT 1,
  "order_id" uuid NOT NULL,
  "move_kind" text NOT NULL,
  "item_id" uuid NOT NULL,
  "qty" numeric(19, 6) NOT NULL,
  "unit_cost" numeric(19, 6),
  "value_amount" numeric(19, 4),
  "batch_id" uuid,
  "stock_move_id" uuid,
  "journal_id" uuid,
  "moved_at" timestamptz NOT NULL DEFAULT now(),
  "note" text,
  "created_by" uuid,
  CONSTRAINT "pk_contract_mfg_moves" PRIMARY KEY ("id"),
  CONSTRAINT "uq_contract_mfg_moves_id_tenant" UNIQUE ("id", "tenant_id"),
  CONSTRAINT "ck_contract_mfg_moves_kind" CHECK ("move_kind" IN (
    'ISSUE_TO_PROCESSOR', 'RETURN_FINISHED', 'RETURN_MATERIAL', 'YIELD_LOSS'
  )),
  CONSTRAINT "ck_contract_mfg_moves_qty" CHECK ("qty" > 0),
  CONSTRAINT "fk_contract_mfg_moves_order" FOREIGN KEY ("order_id", "tenant_id")
    REFERENCES "contract_mfg_orders" ("id", "tenant_id") ON DELETE RESTRICT,
  CONSTRAINT "fk_contract_mfg_moves_item" FOREIGN KEY ("item_id", "tenant_id")
    REFERENCES "items" ("id", "tenant_id") ON DELETE RESTRICT,
  CONSTRAINT "fk_contract_mfg_moves_batch" FOREIGN KEY ("batch_id", "tenant_id")
    REFERENCES "item_batches" ("id", "tenant_id") ON DELETE RESTRICT,
  CONSTRAINT "fk_contract_mfg_moves_stock_move" FOREIGN KEY ("stock_move_id", "tenant_id")
    REFERENCES "stock_moves" ("id", "tenant_id") ON DELETE RESTRICT
);

--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "ix_contract_mfg_moves_order"
  ON "contract_mfg_moves" ("tenant_id", "order_id", "move_kind");

--> statement-breakpoint
-- ---------------------------------------------------------------------------
-- 3. stock_moves.source_type gains 'contract_mfg' (the 0073 replacement
--    pattern, additive-only).
--> statement-breakpoint
ALTER TABLE "stock_moves" DROP CONSTRAINT IF EXISTS ck_stock_moves_source_shape;
--> statement-breakpoint
ALTER TABLE "stock_moves" ADD CONSTRAINT ck_stock_moves_source_shape CHECK ("source_type" IN (
  'manual_receipt', 'manual_issue', 'stock_adjustment', 'stock_count', 'stock_transfer',
  'opening_balance_doc', 'method_switch', 'goods_receipt', 'supplier_invoice', 'landed_cost',
  'delivery_note', 'sales_invoice', 'credit_note', 'job_card', 'production_order',
  'service_order', 'cycle_count', 'quarantine_disposition', 'consignment_settlement',
  'warehouse_kit', 'cross_dock', 'contract_mfg'
));

--> statement-breakpoint
-- ---------------------------------------------------------------------------
-- 4. RLS — the house triple.
--> statement-breakpoint
ALTER TABLE "contract_mfg_orders" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "contract_mfg_orders" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
SELECT erp.apply_tenant_policy('"contract_mfg_orders"');
--> statement-breakpoint
ALTER TABLE "contract_mfg_moves" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "contract_mfg_moves" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
SELECT erp.apply_tenant_policy('"contract_mfg_moves"');
--> statement-breakpoint
DO $$
DECLARE
  t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['contract_mfg_orders', 'contract_mfg_moves'] LOOP
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
-- 5. Grants.
--> statement-breakpoint
REVOKE ALL ON "contract_mfg_orders" FROM erp_app;
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE ON "contract_mfg_orders" TO erp_app;
--> statement-breakpoint
GRANT SELECT ON "contract_mfg_orders" TO erp_readonly;
--> statement-breakpoint
GRANT SELECT ON "contract_mfg_orders" TO erp_definer;
--> statement-breakpoint
REVOKE ALL ON "contract_mfg_moves" FROM erp_app;
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE ON "contract_mfg_moves" TO erp_app;
--> statement-breakpoint
GRANT SELECT ON "contract_mfg_moves" TO erp_readonly;
--> statement-breakpoint
GRANT SELECT ON "contract_mfg_moves" TO erp_definer;

--> statement-breakpoint
-- ---------------------------------------------------------------------------
-- 6. CoA template markers (the 0026 additive pattern): the tolling
--    purposes — existing tenants map once (fail-closed
--    PURPOSE_NOT_MAPPED until then). Parents follow the 0070 precedent
--    (1290 → 1100, 2135 → 2100, 5125 → 5000).
--> statement-breakpoint
INSERT INTO "chart_of_accounts_template" ("code", "name", "name_ar", "type", "is_group", "parent_code", "purpose_key") VALUES
  ('1420', 'Tolling materials at processor', 'مواد التصنيع التعاقدي لدى المعالج', 'ASSET', false, '1100', 'TOLLING_MATERIALS'),
  ('2136', 'Tolling conversion payable', 'مستحقات خدمة التحويل التعاقدي', 'LIABILITY', false, '2100', 'TOLLING_CONVERSION_PAYABLE'),
  ('5126', 'Tolling yield loss', 'هدر التصنيع التعاقدي', 'EXPENSE', false, '5000', 'TOLLING_YIELD_LOSS')
ON CONFLICT ("code") DO UPDATE
  SET "name" = EXCLUDED."name", "name_ar" = EXCLUDED."name_ar",
      "type" = EXCLUDED."type", "is_group" = EXCLUDED."is_group",
      "parent_code" = EXCLUDED."parent_code", "purpose_key" = EXCLUDED."purpose_key";

--> statement-breakpoint
COMMENT ON TABLE "contract_mfg_orders" IS 'PHASE-043 (M-21): contract manufacturing (tolling) orders — material issue to processor, conversion-service PO through the 038 path, return with yield settlement (G-48) / أوامر التصنيع التعاقدي: صرف المواد للمعالج وأمر شراء خدمة التحويل والرد بتسوية الهدر';
--> statement-breakpoint
COMMENT ON TABLE "contract_mfg_moves" IS 'PHASE-043 (M-21): the stock-at-processor ledger — Σ issue = Σ return + Σ yield at settlement / سجل المخزون لدى المعالج: المُصرف يساوي المردود والمهدر عند التسوية';

--> statement-breakpoint
RESET ROLE;

--> statement-breakpoint
-- Schema-state marker for /health/ready (mirrors the migration manifest).
INSERT INTO erp._schema_state (key, value) VALUES ('schema_version', 77)
ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, at = now();
