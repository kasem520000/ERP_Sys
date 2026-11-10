-- PHASE-010 · migration 0014 · inventory core cluster
--
-- Purpose (PHASE-010 §2, §4; TABLES/trade-inventory.md §inventory; ERD/trade-inventory.md):
-- - warehouses: stock locations under a branch (PHASE-004 registry); the
--   optional inventory_account_id override realizes G-15's "branches map
--   inventory accounts" (NULL ⇒ the tenant's active INVENTORY purpose).
-- - item_warehouse_settings: per-item-per-warehouse reorder/min defaults
--   (BR-019 alerting substrate; the in-app surface lands PHASE-015) +
--   last_reorder_alerted_at for the once-per-window job dedupe.
-- - stock_moves: the append-only stock ledger 🔒 (INV-010/INV-018
--   substrate). Written ONLY by inventory services inside the posting
--   transaction. Append-only by grants (SELECT/INSERT — no UPDATE/DELETE
--   for erp_app at all) + the erp.stock_moves_guard() BEFORE UPDATE/DELETE
--   trigger, mirroring cash_movements (PHASE-008 §6 pattern). qty is
--   ALWAYS positive; direction carries the sign. value_amount is the exact
--   journal money quantum (numeric(19,4)) — the INV-010 check compares
--   Σ signed value_amount per GL inventory account vs the account balance
--   with zero tolerance. The batch_id/serial_id FKs land in 0015 (the
--   tracking tables ship there — expand step after item_batches/
--   item_serials exist).
-- - stock_layers: FIFO cost layers created at receipt, consumed
--   oldest-first; fully-consumed rows remain at remaining_qty = 0 so
--   "Σ layer qty = on-hand" holds over ALL rows exactly (property-tested).
-- - item_stock: the transactionally-maintained read model (qty + WAC
--   avg_cost at 6-decimal internal precision, ADR-0009/DATABASE_CONVENTIONS
--   §4). Never eventually-consistent: every writer updates it inside the
--   movement transaction.
-- - stock_transfers + stock_transfer_lines: DRAFT → IN_TRANSIT → POSTED
--   two-leg documents (BR-016; G-15). Dispatch writes the OUT leg at the
--   source's current valuation, receive writes the IN leg carrying the
--   SAME cost; a journal exists only when source/destination resolve
--   distinct GL accounts (policy-none case asserts explicitly).
-- - stock_adjustments: reason-coded direct adjustment documents (DRAFT →
--   POSTED; G-13 loss / G-14 gain purpose lines, explicit counter account
--   for reason OTHER). Doc-reality note (report §reconciliation): the
--   phase §4 table list undercounts this table the same way PHASE-008's
--   undercounted treasury_allocations — the §4 API surface
--   (`/inventory/adjustments` + `/post`) and the G-13/G-14 golden source
--   `stock_adjustment:post` require durable draft documents; it ships here
--   and is added to ENTITY_CATALOG in-phase (the sync rule).
-- - stock_reservations: the soft MVP seam (availability netting ONLY —
--   never a hard allocation lock); hard/soft policies + the entitlement
--   feature surface land PHASE-015.
-- - opening_balance_docs.status widens DRAFT-only → (DRAFT, POSTED):
--   the PHASE-006 zero-posting boundary was explicitly "until PHASE-010
--   posts the stock leg" (G-16) — the inventory module flips stock drafts
--   to POSTED as it creates their layers/moves/journal.
--
-- Doc-reality reconciliation (completion report): the phase document's T1
-- names these files 0010_inventory_*.sql; 0010–0013 already exist (the same
-- drift the PHASE-007/008/009 reports recorded) — they ship as 0014/0015.

--> statement-breakpoint
SET ROLE erp_migrate;

--> statement-breakpoint
-- Warehouses (PHASE-010 §2.1): tenant-scoped stock locations under a
-- branch. inventory_account_id NULL = the tenant's active INVENTORY
-- purpose account (fail-closed PURPOSE_NOT_MAPPED when unmapped — same
-- resolution the posting engine applies to purpose lines). Deactivation
-- blocks new documents; history is preserved forever (stock_moves FK is
-- RESTRICT anyway).
CREATE TABLE IF NOT EXISTS "warehouses" (
  "id" uuid NOT NULL,
  "tenant_id" uuid NOT NULL REFERENCES "tenants" ("id") ON DELETE RESTRICT,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "updated_at" timestamptz NOT NULL DEFAULT now(),
  "version" integer NOT NULL DEFAULT 1,
  "created_by" uuid,
  "branch_id" uuid NOT NULL,
  "code" text NOT NULL,
  "name" text NOT NULL,
  "name_ar" text,
  "inventory_account_id" uuid,
  "is_active" boolean NOT NULL DEFAULT true,
  "deactivated_at" timestamptz,
  "deactivated_by" uuid,
  "note" text,
  CONSTRAINT pk_warehouses PRIMARY KEY ("id"),
  CONSTRAINT uq_warehouses_id_tenant UNIQUE ("id", "tenant_id"),
  CONSTRAINT uq_warehouses_tenant_code UNIQUE ("tenant_id", "code"),
  CONSTRAINT uq_warehouses_tenant_name UNIQUE ("tenant_id", "name"),
  CONSTRAINT fk_warehouses_branch FOREIGN KEY ("branch_id", "tenant_id")
    REFERENCES "branches" ("id", "tenant_id") ON DELETE RESTRICT,
  CONSTRAINT fk_warehouses_inventory_account FOREIGN KEY ("inventory_account_id", "tenant_id")
    REFERENCES "accounts" ("id", "tenant_id") ON DELETE RESTRICT,
  CONSTRAINT ck_warehouses_code_shape CHECK ("code" ~ '^[A-Za-z0-9_-]{1,20}$'),
  CONSTRAINT ck_warehouses_name_length CHECK (length("name") BETWEEN 1 AND 120),
  CONSTRAINT ck_warehouses_name_ar_length CHECK ("name_ar" IS NULL OR length("name_ar") BETWEEN 1 AND 160),
  CONSTRAINT ck_warehouses_deactivated_shape CHECK (
    ("is_active" = false) = ("deactivated_at" IS NOT NULL)
  ),
  CONSTRAINT ck_warehouses_note_length CHECK ("note" IS NULL OR length("note") BETWEEN 1 AND 500)
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS ix_warehouses_tenant_branch ON "warehouses" ("tenant_id", "branch_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS ix_warehouses_tenant_active ON "warehouses" ("tenant_id", "is_active");

--> statement-breakpoint
-- Per-item-per-warehouse settings (PHASE-010 §2.2/§2.14): reorder_level +
-- min_qty defaults consumed by the nightly job (BR-019 — alert, never
-- autopilot) and the availability service. last_reorder_alerted_at is the
-- job's once-per-window dedupe stamp.
CREATE TABLE IF NOT EXISTS "item_warehouse_settings" (
  "id" uuid NOT NULL,
  "tenant_id" uuid NOT NULL REFERENCES "tenants" ("id") ON DELETE RESTRICT,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "updated_at" timestamptz NOT NULL DEFAULT now(),
  "version" integer NOT NULL DEFAULT 1,
  "created_by" uuid,
  "item_id" uuid NOT NULL,
  "warehouse_id" uuid NOT NULL,
  "reorder_level" numeric(19, 6) NOT NULL DEFAULT 0,
  "min_qty" numeric(19, 6) NOT NULL DEFAULT 0,
  "last_reorder_alerted_at" timestamptz,
  CONSTRAINT pk_item_warehouse_settings PRIMARY KEY ("id"),
  CONSTRAINT uq_item_warehouse_settings_id_tenant UNIQUE ("id", "tenant_id"),
  CONSTRAINT uq_item_warehouse_settings_tenant_item_wh UNIQUE ("tenant_id", "item_id", "warehouse_id"),
  CONSTRAINT fk_item_warehouse_settings_item FOREIGN KEY ("item_id", "tenant_id")
    REFERENCES "items" ("id", "tenant_id") ON DELETE RESTRICT,
  CONSTRAINT fk_item_warehouse_settings_warehouse FOREIGN KEY ("warehouse_id", "tenant_id")
    REFERENCES "warehouses" ("id", "tenant_id") ON DELETE RESTRICT,
  CONSTRAINT ck_item_warehouse_settings_reorder CHECK ("reorder_level" >= 0),
  CONSTRAINT ck_item_warehouse_settings_min CHECK ("min_qty" >= 0)
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS ix_item_warehouse_settings_tenant_wh
  ON "item_warehouse_settings" ("tenant_id", "warehouse_id");

--> statement-breakpoint
-- Stock movements (PHASE-010 §2.3; INV-010/INV-017/INV-018): immutable
-- IN/OUT rows written only by inventory services in the SAME transaction
-- as the journal posting (or, for the policy-none transfer case, with the
-- documented no-journal semantics). qty > 0 always; direction carries the
-- sign. unit_cost is 6-decimal internal precision; value_amount is the
-- exact 4-decimal journal quantum. posted_journal_id links the economic
-- effect (NULL only for same-account transfer legs — asserted by the
-- reconciliation job's construction). moved_at is the entry date: every
-- journal's entry_date equals its moves' moved_at, so period locking
-- (INV-011) and the ledger agree.
CREATE TABLE IF NOT EXISTS "stock_moves" (
  "id" uuid NOT NULL,
  "tenant_id" uuid NOT NULL REFERENCES "tenants" ("id") ON DELETE RESTRICT,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "item_id" uuid NOT NULL,
  "warehouse_id" uuid NOT NULL,
  "direction" text NOT NULL,
  "move_kind" text NOT NULL,
  "qty" numeric(19, 6) NOT NULL,
  "unit_cost" numeric(19, 6) NOT NULL,
  "value_amount" numeric(19, 4) NOT NULL,
  "batch_id" uuid,
  "serial_id" uuid,
  "source_type" text NOT NULL,
  "source_id" uuid NOT NULL,
  "moved_at" date NOT NULL,
  "reason" text,
  "memo" text,
  "memo_ar" text,
  "posted_journal_id" uuid,
  CONSTRAINT pk_stock_moves PRIMARY KEY ("id"),
  CONSTRAINT uq_stock_moves_id_tenant UNIQUE ("id", "tenant_id"),
  CONSTRAINT fk_stock_moves_item FOREIGN KEY ("item_id", "tenant_id")
    REFERENCES "items" ("id", "tenant_id") ON DELETE RESTRICT,
  CONSTRAINT fk_stock_moves_warehouse FOREIGN KEY ("warehouse_id", "tenant_id")
    REFERENCES "warehouses" ("id", "tenant_id") ON DELETE RESTRICT,
  CONSTRAINT fk_stock_moves_journal FOREIGN KEY ("posted_journal_id", "tenant_id")
    REFERENCES "journal_entries" ("id", "tenant_id") ON DELETE RESTRICT,
  CONSTRAINT ck_stock_moves_direction_values CHECK ("direction" IN ('IN', 'OUT')),
  CONSTRAINT ck_stock_moves_kind_values CHECK (
    "move_kind" IN ('receipt', 'issue', 'transfer_in', 'transfer_out', 'adjust')
  ),
  CONSTRAINT ck_stock_moves_qty_positive CHECK ("qty" > 0),
  CONSTRAINT ck_stock_moves_unit_cost_nonnegative CHECK ("unit_cost" >= 0),
  CONSTRAINT ck_stock_moves_value_positive CHECK ("value_amount" > 0),
  CONSTRAINT ck_stock_moves_source_shape CHECK ("source_type" IN (
    'manual_receipt', 'manual_issue', 'stock_adjustment', 'stock_count',
    'stock_transfer', 'opening_balance_doc', 'method_switch'
  )),
  CONSTRAINT ck_stock_moves_memo_length CHECK ("memo" IS NULL OR length("memo") BETWEEN 1 AND 500),
  CONSTRAINT ck_stock_moves_memo_ar_length CHECK ("memo_ar" IS NULL OR length("memo_ar") BETWEEN 1 AND 500)
);
--> statement-breakpoint
-- The highest-volume table in the platform: the mandated tenant-first
-- composite (PHASE-010 §6) + per-warehouse + per-source lookups.
CREATE INDEX IF NOT EXISTS ix_stock_moves_tenant_item_wh_date
  ON "stock_moves" ("tenant_id", "item_id", "warehouse_id", "moved_at");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS ix_stock_moves_tenant_wh_date
  ON "stock_moves" ("tenant_id", "warehouse_id", "moved_at");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS ix_stock_moves_tenant_source
  ON "stock_moves" ("tenant_id", "source_type", "source_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS ix_stock_moves_tenant_journal
  ON "stock_moves" ("tenant_id", "posted_journal_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS ix_stock_moves_tenant_batch
  ON "stock_moves" ("tenant_id", "batch_id") WHERE "batch_id" IS NOT NULL;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS ix_stock_moves_tenant_serial
  ON "stock_moves" ("tenant_id", "serial_id") WHERE "serial_id" IS NOT NULL;

--> statement-breakpoint
-- FIFO cost layers (PHASE-010 §2.5): created at receipt with the receipt
-- move's unit cost; consumed oldest-first on issue. Fully-consumed rows
-- STAY at remaining_qty = 0 (historical trace) so "Σ layer qty = on-hand"
-- holds over all rows exactly — the property suite asserts it.
-- source_move_id is NULL only for method-switch re-based layers (INV-017:
-- the switch re-bases the substrate at book value — a synthetic move there
-- would double-count the INV-010 money trail).
CREATE TABLE IF NOT EXISTS "stock_layers" (
  "id" uuid NOT NULL,
  "tenant_id" uuid NOT NULL REFERENCES "tenants" ("id") ON DELETE RESTRICT,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "updated_at" timestamptz NOT NULL DEFAULT now(),
  "item_id" uuid NOT NULL,
  "warehouse_id" uuid NOT NULL,
  "remaining_qty" numeric(19, 6) NOT NULL,
  "unit_cost" numeric(19, 6) NOT NULL,
  "source_move_id" uuid,
  "received_at" date NOT NULL,
  CONSTRAINT pk_stock_layers PRIMARY KEY ("id"),
  CONSTRAINT uq_stock_layers_id_tenant UNIQUE ("id", "tenant_id"),
  CONSTRAINT fk_stock_layers_item FOREIGN KEY ("item_id", "tenant_id")
    REFERENCES "items" ("id", "tenant_id") ON DELETE RESTRICT,
  CONSTRAINT fk_stock_layers_warehouse FOREIGN KEY ("warehouse_id", "tenant_id")
    REFERENCES "warehouses" ("id", "tenant_id") ON DELETE RESTRICT,
  CONSTRAINT fk_stock_layers_move FOREIGN KEY ("source_move_id", "tenant_id")
    REFERENCES "stock_moves" ("id", "tenant_id") ON DELETE RESTRICT,
  CONSTRAINT ck_stock_layers_remaining_nonnegative CHECK ("remaining_qty" >= 0),
  CONSTRAINT ck_stock_layers_unit_cost_nonnegative CHECK ("unit_cost" >= 0)
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS uq_stock_layers_source_move
  ON "stock_layers" ("tenant_id", "source_move_id") WHERE "source_move_id" IS NOT NULL;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS ix_stock_layers_tenant_item_wh_received
  ON "stock_layers" ("tenant_id", "item_id", "warehouse_id", "received_at", "created_at")
  WHERE "remaining_qty" > 0;

--> statement-breakpoint
-- On-hand read model (PHASE-010 §2.4/§6): maintained transactionally by
-- every movement writer (never eventually-consistent). qty may go
-- negative ONLY under the explicit tenant policy (BR-013); avg_cost is
-- the WAC state at 6-decimal internal precision (0 for FIFO items —
-- their valuation is Σ layer qty × cost).
CREATE TABLE IF NOT EXISTS "item_stock" (
  "id" uuid NOT NULL,
  "tenant_id" uuid NOT NULL REFERENCES "tenants" ("id") ON DELETE RESTRICT,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "updated_at" timestamptz NOT NULL DEFAULT now(),
  "version" integer NOT NULL DEFAULT 1,
  "item_id" uuid NOT NULL,
  "warehouse_id" uuid NOT NULL,
  "qty" numeric(19, 6) NOT NULL DEFAULT 0,
  "avg_cost" numeric(19, 6) NOT NULL DEFAULT 0,
  CONSTRAINT pk_item_stock PRIMARY KEY ("id"),
  CONSTRAINT uq_item_stock_id_tenant UNIQUE ("id", "tenant_id"),
  CONSTRAINT uq_item_stock_tenant_item_wh UNIQUE ("tenant_id", "item_id", "warehouse_id"),
  CONSTRAINT fk_item_stock_item FOREIGN KEY ("item_id", "tenant_id")
    REFERENCES "items" ("id", "tenant_id") ON DELETE RESTRICT,
  CONSTRAINT fk_item_stock_warehouse FOREIGN KEY ("warehouse_id", "tenant_id")
    REFERENCES "warehouses" ("id", "tenant_id") ON DELETE RESTRICT,
  CONSTRAINT ck_item_stock_avg_cost_nonnegative CHECK ("avg_cost" >= 0)
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS ix_item_stock_tenant_wh ON "item_stock" ("tenant_id", "warehouse_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS ix_item_stock_tenant_negative
  ON "item_stock" ("tenant_id", "item_id") WHERE "qty" < 0;

--> statement-breakpoint
-- Stock transfers (PHASE-010 §2.9; BR-016; DOCUMENT_LIFECYCLE §3):
-- DRAFT → IN_TRANSIT → POSTED (CANCELLED from DRAFT). Dispatch writes the
-- OUT leg at the source's current valuation; receive writes the IN leg
-- at the SAME cost (value conservation across warehouses). The journal
-- exists only when source/destination resolve distinct GL accounts (G-15
-- + the policy-none case); IN_TRANSIT stock is visible but never
-- sellable/reservable (the availability service nets it out).
CREATE TABLE IF NOT EXISTS "stock_transfers" (
  "id" uuid NOT NULL,
  "tenant_id" uuid NOT NULL REFERENCES "tenants" ("id") ON DELETE RESTRICT,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "updated_at" timestamptz NOT NULL DEFAULT now(),
  "version" integer NOT NULL DEFAULT 1,
  "created_by" uuid,
  "transfer_no" text,
  "from_warehouse_id" uuid NOT NULL,
  "to_warehouse_id" uuid NOT NULL,
  "status" text NOT NULL DEFAULT 'DRAFT',
  "dispatch_date" date,
  "dispatched_by" uuid,
  "receive_date" date,
  "received_by" uuid,
  "posted_journal_id" uuid,
  "note" text,
  "note_ar" text,
  CONSTRAINT pk_stock_transfers PRIMARY KEY ("id"),
  CONSTRAINT uq_stock_transfers_id_tenant UNIQUE ("id", "tenant_id"),
  CONSTRAINT uq_stock_transfers_tenant_no UNIQUE ("tenant_id", "transfer_no"),
  CONSTRAINT fk_stock_transfers_from FOREIGN KEY ("from_warehouse_id", "tenant_id")
    REFERENCES "warehouses" ("id", "tenant_id") ON DELETE RESTRICT,
  CONSTRAINT fk_stock_transfers_to FOREIGN KEY ("to_warehouse_id", "tenant_id")
    REFERENCES "warehouses" ("id", "tenant_id") ON DELETE RESTRICT,
  CONSTRAINT fk_stock_transfers_journal FOREIGN KEY ("posted_journal_id", "tenant_id")
    REFERENCES "journal_entries" ("id", "tenant_id") ON DELETE RESTRICT,
  CONSTRAINT ck_stock_transfers_status_values CHECK ("status" IN ('DRAFT', 'IN_TRANSIT', 'POSTED', 'CANCELLED')),
  CONSTRAINT ck_stock_transfers_distinct_wh CHECK ("from_warehouse_id" <> "to_warehouse_id"),
  CONSTRAINT ck_stock_transfers_transit_shape CHECK (
    ("status" IN ('IN_TRANSIT', 'POSTED')) = ("dispatch_date" IS NOT NULL AND "dispatched_by" IS NOT NULL)
  ),
  CONSTRAINT ck_stock_transfers_posted_shape CHECK (
    ("status" = 'POSTED') = ("receive_date" IS NOT NULL AND "received_by" IS NOT NULL)
  ),
  CONSTRAINT ck_stock_transfers_note_length CHECK ("note" IS NULL OR length("note") BETWEEN 1 AND 500)
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS ix_stock_transfers_tenant_status
  ON "stock_transfers" ("tenant_id", "status", "created_at");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS ix_stock_transfers_tenant_from
  ON "stock_transfers" ("tenant_id", "from_warehouse_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS ix_stock_transfers_tenant_to
  ON "stock_transfers" ("tenant_id", "to_warehouse_id");

--> statement-breakpoint
-- Transfer lines: one line per item per transfer (uq), qty in the item's
-- base UoM. batch binding happens at dispatch (FEFO across the item's
-- live batches when batch-tracked and no explicit batch supplied).
CREATE TABLE IF NOT EXISTS "stock_transfer_lines" (
  "id" uuid NOT NULL,
  "tenant_id" uuid NOT NULL REFERENCES "tenants" ("id") ON DELETE RESTRICT,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "updated_at" timestamptz NOT NULL DEFAULT now(),
  "transfer_id" uuid NOT NULL,
  "line_no" integer NOT NULL,
  "item_id" uuid NOT NULL,
  "qty" numeric(19, 6) NOT NULL,
  CONSTRAINT pk_stock_transfer_lines PRIMARY KEY ("id"),
  CONSTRAINT uq_stock_transfer_lines_id_tenant UNIQUE ("id", "tenant_id"),
  CONSTRAINT uq_stock_transfer_lines_no UNIQUE ("transfer_id", "line_no"),
  CONSTRAINT uq_stock_transfer_lines_item UNIQUE ("tenant_id", "transfer_id", "item_id"),
  CONSTRAINT fk_stock_transfer_lines_transfer FOREIGN KEY ("transfer_id", "tenant_id")
    REFERENCES "stock_transfers" ("id", "tenant_id") ON DELETE CASCADE,
  CONSTRAINT fk_stock_transfer_lines_item FOREIGN KEY ("item_id", "tenant_id")
    REFERENCES "items" ("id", "tenant_id") ON DELETE RESTRICT,
  CONSTRAINT ck_stock_transfer_lines_qty_positive CHECK ("qty" > 0),
  CONSTRAINT ck_stock_transfer_lines_line_no CHECK ("line_no" >= 1)
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS ix_stock_transfer_lines_tenant_transfer
  ON "stock_transfer_lines" ("tenant_id", "transfer_id", "line_no");

--> statement-breakpoint
-- Manual stock adjustments (PHASE-010 §2.17 + §4 API /adjustments+/post;
-- G-13/G-14): reason-coded direct stock documents. delta_qty is SIGNED
-- (positive = gain/IN leg, negative = loss/OUT leg); unit_cost is the
-- optional at-cost override for gains (defaults to current valuation);
-- counter_account_id is REQUIRED for reason OTHER (validated postable —
-- the service never invents the economic counterparty). Approval
-- tolerance flows live on counts (BR-015); manual adjustments are
-- permission-gated (inventory.adjustments.post is a risky, audited key).
CREATE TABLE IF NOT EXISTS "stock_adjustments" (
  "id" uuid NOT NULL,
  "tenant_id" uuid NOT NULL REFERENCES "tenants" ("id") ON DELETE RESTRICT,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "updated_at" timestamptz NOT NULL DEFAULT now(),
  "version" integer NOT NULL DEFAULT 1,
  "created_by" uuid,
  "adjustment_no" text,
  "warehouse_id" uuid NOT NULL,
  "item_id" uuid NOT NULL,
  "reason" text NOT NULL,
  "delta_qty" numeric(19, 6) NOT NULL,
  "unit_cost" numeric(19, 6),
  "counter_account_id" uuid,
  "status" text NOT NULL DEFAULT 'DRAFT',
  "posting_date" date,
  "posted_by" uuid,
  "posted_at" timestamptz,
  "posted_journal_id" uuid,
  "note" text,
  "note_ar" text,
  CONSTRAINT pk_stock_adjustments PRIMARY KEY ("id"),
  CONSTRAINT uq_stock_adjustments_id_tenant UNIQUE ("id", "tenant_id"),
  CONSTRAINT uq_stock_adjustments_tenant_no UNIQUE ("tenant_id", "adjustment_no"),
  CONSTRAINT fk_stock_adjustments_warehouse FOREIGN KEY ("warehouse_id", "tenant_id")
    REFERENCES "warehouses" ("id", "tenant_id") ON DELETE RESTRICT,
  CONSTRAINT fk_stock_adjustments_item FOREIGN KEY ("item_id", "tenant_id")
    REFERENCES "items" ("id", "tenant_id") ON DELETE RESTRICT,
  CONSTRAINT fk_stock_adjustments_counter_account FOREIGN KEY ("counter_account_id", "tenant_id")
    REFERENCES "accounts" ("id", "tenant_id") ON DELETE RESTRICT,
  CONSTRAINT fk_stock_adjustments_journal FOREIGN KEY ("posted_journal_id", "tenant_id")
    REFERENCES "journal_entries" ("id", "tenant_id") ON DELETE RESTRICT,
  CONSTRAINT ck_stock_adjustments_reason_values CHECK ("reason" IN (
    'DAMAGE', 'EXPIRED', 'COUNT_LOSS', 'COUNT_GAIN', 'OTHER'
  )),
  CONSTRAINT ck_stock_adjustments_status_values CHECK ("status" IN ('DRAFT', 'POSTED', 'CANCELLED')),
  CONSTRAINT ck_stock_adjustments_delta_nonzero CHECK ("delta_qty" <> 0),
  CONSTRAINT ck_stock_adjustments_unit_cost_shape CHECK ("unit_cost" IS NULL OR "unit_cost" >= 0),
  CONSTRAINT ck_stock_adjustments_posted_shape CHECK (
    ("status" = 'POSTED') = ("posting_date" IS NOT NULL AND "posted_by" IS NOT NULL
      AND "posted_at" IS NOT NULL AND "posted_journal_id" IS NOT NULL)
  ),
  CONSTRAINT ck_stock_adjustments_other_requires_counter CHECK (
    ("reason" = 'OTHER') = ("counter_account_id" IS NOT NULL)
  ),
  CONSTRAINT ck_stock_adjustments_note_length CHECK ("note" IS NULL OR length("note") BETWEEN 1 AND 500)
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS ix_stock_adjustments_tenant_status
  ON "stock_adjustments" ("tenant_id", "status", "created_at");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS ix_stock_adjustments_tenant_wh
  ON "stock_adjustments" ("tenant_id", "warehouse_id");

--> statement-breakpoint
-- Soft reservations (PHASE-010 §2.13): the availability-netting seam.
-- holder_type MANUAL at this phase (SALES_ORDER rides PHASE-012; hard
-- policies + the entitlement key surface land PHASE-015). Expired rows
-- stop netting immediately (expires_at <= now() is ignored by the
-- availability service); the sweep flips them to RELEASED.
CREATE TABLE IF NOT EXISTS "stock_reservations" (
  "id" uuid NOT NULL,
  "tenant_id" uuid NOT NULL REFERENCES "tenants" ("id") ON DELETE RESTRICT,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "updated_at" timestamptz NOT NULL DEFAULT now(),
  "version" integer NOT NULL DEFAULT 1,
  "created_by" uuid,
  "item_id" uuid NOT NULL,
  "warehouse_id" uuid NOT NULL,
  "qty" numeric(19, 6) NOT NULL,
  "holder_type" text NOT NULL,
  "holder_id" uuid,
  "expires_at" timestamptz,
  "status" text NOT NULL DEFAULT 'ACTIVE',
  "released_at" timestamptz,
  "released_by" uuid,
  "consumed_at" timestamptz,
  "note" text,
  CONSTRAINT pk_stock_reservations PRIMARY KEY ("id"),
  CONSTRAINT uq_stock_reservations_id_tenant UNIQUE ("id", "tenant_id"),
  CONSTRAINT fk_stock_reservations_item FOREIGN KEY ("item_id", "tenant_id")
    REFERENCES "items" ("id", "tenant_id") ON DELETE RESTRICT,
  CONSTRAINT fk_stock_reservations_warehouse FOREIGN KEY ("warehouse_id", "tenant_id")
    REFERENCES "warehouses" ("id", "tenant_id") ON DELETE RESTRICT,
  CONSTRAINT ck_stock_reservations_holder_values CHECK ("holder_type" IN ('MANUAL', 'SALES_ORDER')),
  CONSTRAINT ck_stock_reservations_status_values CHECK ("status" IN ('ACTIVE', 'RELEASED', 'CONSUMED')),
  CONSTRAINT ck_stock_reservations_qty_positive CHECK ("qty" > 0),
  CONSTRAINT ck_stock_reservations_released_shape CHECK (
    ("status" IN ('RELEASED', 'CONSUMED')) = (("released_at" IS NOT NULL) OR ("consumed_at" IS NOT NULL))
  ),
  CONSTRAINT ck_stock_reservations_note_length CHECK ("note" IS NULL OR length("note") BETWEEN 1 AND 300)
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS ix_stock_reservations_netting
  ON "stock_reservations" ("tenant_id", "item_id", "warehouse_id", "status");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS ix_stock_reservations_expiry_sweep
  ON "stock_reservations" ("tenant_id", "expires_at") WHERE "status" = 'ACTIVE';

--> statement-breakpoint
-- opening_balance_docs.status widening (PHASE-006 zero-posting boundary
-- lift for the STOCK kind — G-16's stock leg posts through PHASE-010's
-- opening-stock service; PARTNER/ACCOUNT drafts already flip at
-- PHASE-007's opening-balance posting).
ALTER TABLE "opening_balance_docs" DROP CONSTRAINT IF EXISTS ck_obd_status_draft_only;
--> statement-breakpoint
ALTER TABLE "opening_balance_docs" ADD CONSTRAINT ck_obd_status_values
  CHECK ("status" IN ('DRAFT', 'POSTED'));

--> statement-breakpoint
-- RLS (TENANT_ISOLATION §2): standard macro on every new tenant-owned table.
SELECT erp.apply_tenant_policy('"warehouses"');
--> statement-breakpoint
SELECT erp.apply_tenant_policy('"item_warehouse_settings"');
--> statement-breakpoint
SELECT erp.apply_tenant_policy('"stock_moves"');
--> statement-breakpoint
SELECT erp.apply_tenant_policy('"stock_layers"');
--> statement-breakpoint
SELECT erp.apply_tenant_policy('"item_stock"');
--> statement-breakpoint
SELECT erp.apply_tenant_policy('"stock_transfers"');
--> statement-breakpoint
SELECT erp.apply_tenant_policy('"stock_transfer_lines"');
--> statement-breakpoint
SELECT erp.apply_tenant_policy('"stock_adjustments"');
--> statement-breakpoint
SELECT erp.apply_tenant_policy('"stock_reservations"');

--> statement-breakpoint
-- Grants. stock_moves is append-only 🔒: SELECT/INSERT only for erp_app
-- (no UPDATE, no DELETE — A4 proves the denial) plus the guard trigger
-- below (defense in depth, §6). Everything else: SELECT/INSERT/UPDATE
-- (lifecycle states); posted rows are immutable by service + shape CHECKs.
REVOKE ALL ON "warehouses", "item_warehouse_settings", "stock_moves",
  "stock_layers", "item_stock", "stock_transfers", "stock_transfer_lines",
  "stock_adjustments", "stock_reservations" FROM erp_app;
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE ON "warehouses" TO erp_app;
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE ON "item_warehouse_settings" TO erp_app;
--> statement-breakpoint
GRANT SELECT, INSERT ON "stock_moves" TO erp_app;
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE ON "stock_layers" TO erp_app;
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE ON "item_stock" TO erp_app;
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE ON "stock_transfers" TO erp_app;
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE ON "stock_transfer_lines" TO erp_app;
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE ON "stock_adjustments" TO erp_app;
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE ON "stock_reservations" TO erp_app;
--> statement-breakpoint
GRANT SELECT ON "warehouses", "item_warehouse_settings", "stock_moves",
  "stock_layers", "item_stock", "stock_transfers", "stock_transfer_lines",
  "stock_adjustments", "stock_reservations" TO erp_readonly;

--> statement-breakpoint
-- Definer read surface (support-access read-all proxy composition, as prior phases).
RESET ROLE;
--> statement-breakpoint
GRANT SELECT ON "warehouses", "item_warehouse_settings", "stock_moves",
  "stock_layers", "item_stock", "stock_transfers", "stock_transfer_lines",
  "stock_adjustments", "stock_reservations" TO erp_definer;
--> statement-breakpoint
SET ROLE erp_migrate;

--> statement-breakpoint
-- Append-only guard for stock_moves (§6 security: grant + trigger, so even
-- repository misuse cannot rewrite stock history). Mirrors cash_movements.
CREATE OR REPLACE FUNCTION erp.stock_moves_guard() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'stock_moves are append-only (INV-010): % on row % is forbidden',
    TG_OP, OLD.id;
END;
$$ LANGUAGE plpgsql;
--> statement-breakpoint
DROP TRIGGER IF EXISTS trg_stock_moves_guard ON "stock_moves";
--> statement-breakpoint
CREATE TRIGGER trg_stock_moves_guard
  BEFORE UPDATE OR DELETE ON "stock_moves"
  FOR EACH ROW EXECUTE FUNCTION erp.stock_moves_guard();
--> statement-breakpoint
COMMENT ON FUNCTION erp.stock_moves_guard() IS
  'PHASE-010 INV-010: stock_moves are immutable (INSERT-only; the guard fires as defense in depth beyond the missing UPDATE/DELETE grants).';

--> statement-breakpoint
-- Template correction (matrix §3.5): the viewer template holds exactly the
-- viewer-tier inventory view keys — inventory.stock.view + inventory.moves.
-- view. The 0005 baseline pre-granted inventory.transfers.view and
-- inventory.counts.view (matrix rows 3.5: warehouse, owner only — transfers
-- and counts carry in-transit/approval semantics a read-only viewer never
-- exercises); PHASE-010's route surface makes the drift observable, so the
-- module migration realigns the system template with the matrix exactly.
DELETE FROM "role_permissions" rp
USING "roles" r
WHERE rp."role_id" = r."id"
  AND r."key" = 'viewer' AND r."tenant_id" IS NULL
  AND rp."permission_id" IN ('inventory.transfers.view', 'inventory.counts.view');

--> statement-breakpoint
-- Schema-state marker for /health/ready (mirrors the migration manifest).
INSERT INTO erp._schema_state (key, value) VALUES ('schema_version', 14)
ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, at = now();

--> statement-breakpoint
RESET ROLE;
