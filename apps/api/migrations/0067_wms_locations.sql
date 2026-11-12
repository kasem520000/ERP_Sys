-- PHASE-044 (Blueprint v3.0 · CR-14, scope extended by v3.1/CR-46) ·
-- migration 0067 · WMS & Inventory Intelligence (part 1: the location
-- substrate + bin contents + LPN + returnable packaging).
--
-- Purpose (PHASE-044 §2.1/§2.2/§2.5/§2.15): the warehouse stops being a
-- per-item quantity register and grows a real location tree:
--
--   warehouse_zones / warehouse_aisles / warehouse_racks / warehouse_bins
--     (H-07, I-01, I-02, DF-12) — zone types (PICKING / BULK / QUARANTINE /
--     DOCK / STAGE), bin barcode (tenant-unique scan target), pick
--     sequence for nearest-pick routing, capacity, mixed-batch rule, and
--     one DEFAULT bin per warehouse (the backfill landing slot — BR-073).
--   bin_contents (I-01, I-19, I-24) — the per-bin position: item / batch /
--     serial / LPN / qty / status (AVAILABLE / QUARANTINE / HOLD) with the
--     consignment owner_partner_id column (I-10/I-11/I-19 — vendor-owned
--     rows live ONLY here: never in item_stock, INV-029's exclusion set).
--   lpns (I-05) — license plates / pallets: a movable grouping key over
--     bin_contents rows (LPN-level receipt + move-by-LPN).
--   stock_moves extension — source_bin_id / target_bin_id / lpn_id
--     (nullable, additive only — the 0065 §4 precedent).
--   returnable_packaging + returnable_packaging_movements (L1-20, the
--     v3.1/CR-46 extension) — the container-type register (pallets /
--     crates / containers with their deposit per unit) + the issue /
--     return / write-off movement log; the deposit accounting posts
--     through the engine against the EXISTING DEPOSITS_RECEIVED purpose
--     (2140) + the new 4895 DEPOSIT_FORFEITURE income marker — no new
--     liability purpose is needed (the documented decision D-2 of this
--     phase).
--
-- Numbering note (the 0064/0065 pattern): the phase doc planned "≈ 0073…
-- 0081" written before implementation; PHASE-043 (MRP) has NOT run — it
-- requires THIS phase (its bin-level supply inputs) — so the honest next
-- journal slots are 0067…0071 (journal idx 67, schema_version 67 here).
-- The doc's rule/golden/invariant counters are likewise stale after the
-- 039…042 waves: BR-064…067 → BR-072…075 (039/040/041 took BR-064…067),
-- G-47…G-50 → G-43…G-46 (039 took G-35…39, 042 took G-40…42), INV-029 is
-- correct as planned (042 took INV-028). Recorded in every touched doc's
-- numbering note.
--
-- INV-022 ledger: this migration +0067…0069 tables (locations 4, contents
-- 1, LPN 1, packaging 2 here; directed ops 4 in 0068; counts/ABC/serial
-- ledger 5 in 0069; policies/jobs/kitting 5 in 0070) — ENTITY_CATALOG 239
-- → 260 with the 0071 data-only seed; ownership fields extend existing
-- stock tables additively. CoA markers: 4895 DEPOSIT_FORFEITURE here
-- (§9); 1290 QUARANTINE_INVENTORY + 2135 CONSIGNATION_PAYABLE + 4990
-- TRANSFER_PRICING_ADJUSTMENT land with 0070 (their consumers).
--
-- Grants: the location tree + LPN + the packaging register are master
-- data (SELECT/INSERT/UPDATE — lifecycles, no app-role DELETE, the 0026
-- precedent); bin_contents is a POSITION table (SELECT/INSERT/UPDATE —
-- rows move between statuses/bins but never app-delete; zero-qty rows
-- stay as the honest history floor); returnable_packaging_movements is a
-- log (SELECT/INSERT only — append-only like stock_moves).

--> statement-breakpoint
SET ROLE erp_migrate;

--> statement-breakpoint
-- ---------------------------------------------------------------------------
-- 1. warehouse_zones (§2.1): the top of the location tree. Zone type is
--    the putaway-rule vocabulary (PICKING/BULK/QUARANTINE/DOCK/STAGE);
--    one DEFAULT zone per warehouse (the backfill anchor, BR-073).
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "warehouse_zones" (
  "id" uuid NOT NULL,
  "tenant_id" uuid NOT NULL REFERENCES "tenants" ("id") ON DELETE RESTRICT,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "updated_at" timestamptz NOT NULL DEFAULT now(),
  "version" integer NOT NULL DEFAULT 1,
  "warehouse_id" uuid NOT NULL,
  "code" text NOT NULL,
  "name" text NOT NULL,
  "name_ar" text,
  "zone_type" text NOT NULL DEFAULT 'PICKING',
  "is_default" boolean NOT NULL DEFAULT false,
  "note" text,
  "created_by" uuid,
  CONSTRAINT "pk_warehouse_zones" PRIMARY KEY ("id"),
  CONSTRAINT "uq_warehouse_zones_id_tenant" UNIQUE ("id", "tenant_id"),
  CONSTRAINT "uq_warehouse_zones_tenant_wh_code" UNIQUE ("tenant_id", "warehouse_id", "code"),
  CONSTRAINT "ck_warehouse_zones_code_shape" CHECK ("code" ~ '^[A-Za-z][A-Za-z0-9_-]{1,39}$'),
  CONSTRAINT "ck_warehouse_zones_type" CHECK (
    "zone_type" IN ('PICKING', 'BULK', 'QUARANTINE', 'DOCK', 'STAGE')
  )
);

--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "ix_warehouse_zones_tenant_wh_type"
  ON "warehouse_zones" ("tenant_id", "warehouse_id", "zone_type");

--> statement-breakpoint
-- One DEFAULT zone per warehouse (the partial floor — inline UNIQUE cannot
-- carry WHERE; the index is the house pattern).
CREATE UNIQUE INDEX IF NOT EXISTS "uq_warehouse_zones_default_wh"
  ON "warehouse_zones" ("tenant_id", "warehouse_id") WHERE "is_default";

--> statement-breakpoint
ALTER TABLE "warehouse_zones"
  ADD CONSTRAINT "fk_warehouse_zones_warehouse"
  FOREIGN KEY ("warehouse_id", "tenant_id") REFERENCES "warehouses" ("id", "tenant_id") ON DELETE CASCADE;

--> statement-breakpoint
-- ---------------------------------------------------------------------------
-- 2. warehouse_aisles (§2.1): zones contain aisles.
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "warehouse_aisles" (
  "id" uuid NOT NULL,
  "tenant_id" uuid NOT NULL REFERENCES "tenants" ("id") ON DELETE RESTRICT,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "updated_at" timestamptz NOT NULL DEFAULT now(),
  "version" integer NOT NULL DEFAULT 1,
  "zone_id" uuid NOT NULL,
  "code" text NOT NULL,
  "name" text NOT NULL,
  "name_ar" text,
  "created_by" uuid,
  CONSTRAINT "pk_warehouse_aisles" PRIMARY KEY ("id"),
  CONSTRAINT "uq_warehouse_aisles_id_tenant" UNIQUE ("id", "tenant_id"),
  CONSTRAINT "uq_warehouse_aisles_tenant_zone_code" UNIQUE ("tenant_id", "zone_id", "code"),
  CONSTRAINT "ck_warehouse_aisles_code_shape" CHECK ("code" ~ '^[A-Za-z][A-Za-z0-9_-]{1,39}$')
);

--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "ix_warehouse_aisles_tenant_zone"
  ON "warehouse_aisles" ("tenant_id", "zone_id");

--> statement-breakpoint
ALTER TABLE "warehouse_aisles"
  ADD CONSTRAINT "fk_warehouse_aisles_zone"
  FOREIGN KEY ("zone_id", "tenant_id") REFERENCES "warehouse_zones" ("id", "tenant_id") ON DELETE CASCADE;

--> statement-breakpoint
-- ---------------------------------------------------------------------------
-- 3. warehouse_racks (§2.1): aisles contain racks.
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "warehouse_racks" (
  "id" uuid NOT NULL,
  "tenant_id" uuid NOT NULL REFERENCES "tenants" ("id") ON DELETE RESTRICT,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "updated_at" timestamptz NOT NULL DEFAULT now(),
  "version" integer NOT NULL DEFAULT 1,
  "aisle_id" uuid NOT NULL,
  "code" text NOT NULL,
  "name" text NOT NULL,
  "name_ar" text,
  "created_by" uuid,
  CONSTRAINT "pk_warehouse_racks" PRIMARY KEY ("id"),
  CONSTRAINT "uq_warehouse_racks_id_tenant" UNIQUE ("id", "tenant_id"),
  CONSTRAINT "uq_warehouse_racks_tenant_aisle_code" UNIQUE ("tenant_id", "aisle_id", "code"),
  CONSTRAINT "ck_warehouse_racks_code_shape" CHECK ("code" ~ '^[A-Za-z][A-Za-z0-9_-]{1,39}$')
);

--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "ix_warehouse_racks_tenant_aisle"
  ON "warehouse_racks" ("tenant_id", "aisle_id");

--> statement-breakpoint
ALTER TABLE "warehouse_racks"
  ADD CONSTRAINT "fk_warehouse_racks_aisle"
  FOREIGN KEY ("aisle_id", "tenant_id") REFERENCES "warehouse_aisles" ("id", "tenant_id") ON DELETE CASCADE;

--> statement-breakpoint
-- ---------------------------------------------------------------------------
-- 4. warehouse_bins (§2.1, I-01/I-02, DF-12): the leaf — barcode (the
--    scan target, PP-11/DF-17), pick_sequence (NEAREST routing), capacity
--    (optional soft limit), mixed-batch rule, and the DEFAULT bin flag
--    (one per warehouse — the existing-stock backfill slot, BR-073; the
--    partial UNIQUE is the floor). warehouse_id is denormalized for the
--    default-bin floor + the directed-pick queries (join cost).
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "warehouse_bins" (
  "id" uuid NOT NULL,
  "tenant_id" uuid NOT NULL REFERENCES "tenants" ("id") ON DELETE RESTRICT,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "updated_at" timestamptz NOT NULL DEFAULT now(),
  "version" integer NOT NULL DEFAULT 1,
  "warehouse_id" uuid NOT NULL,
  "rack_id" uuid NOT NULL,
  "code" text NOT NULL,
  "barcode" text NOT NULL,
  "name" text NOT NULL,
  "name_ar" text,
  "pick_sequence" integer,
  "capacity" numeric(19, 6),
  "allow_mixed_batches" boolean NOT NULL DEFAULT true,
  "is_default" boolean NOT NULL DEFAULT false,
  "note" text,
  "created_by" uuid,
  CONSTRAINT "pk_warehouse_bins" PRIMARY KEY ("id"),
  CONSTRAINT "uq_warehouse_bins_id_tenant" UNIQUE ("id", "tenant_id"),
  CONSTRAINT "uq_warehouse_bins_tenant_wh_code" UNIQUE ("tenant_id", "warehouse_id", "code"),
  CONSTRAINT "uq_warehouse_bins_tenant_barcode" UNIQUE ("tenant_id", "barcode"),
  CONSTRAINT "ck_warehouse_bins_code_shape" CHECK ("code" ~ '^[A-Za-z0-9][A-Za-z0-9_.-]{0,59}$'),
  CONSTRAINT "ck_warehouse_bins_barcode_shape" CHECK ("barcode" ~ '^[A-Za-z0-9][A-Za-z0-9_.:-]{1,79}$'),
  CONSTRAINT "ck_warehouse_bins_pick_sequence" CHECK (
    "pick_sequence" IS NULL OR ("pick_sequence" >= 1 AND "pick_sequence" <= 1000000)
  ),
  CONSTRAINT "ck_warehouse_bins_capacity" CHECK ("capacity" IS NULL OR "capacity" >= 0)
);

--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "ix_warehouse_bins_tenant_wh_seq"
  ON "warehouse_bins" ("tenant_id", "warehouse_id", "pick_sequence");

--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "ix_warehouse_bins_tenant_rack"
  ON "warehouse_bins" ("tenant_id", "rack_id");

--> statement-breakpoint
-- One DEFAULT bin per warehouse (the partial floor).
CREATE UNIQUE INDEX IF NOT EXISTS "uq_warehouse_bins_default_wh"
  ON "warehouse_bins" ("tenant_id", "warehouse_id") WHERE "is_default";

--> statement-breakpoint
ALTER TABLE "warehouse_bins"
  ADD CONSTRAINT "fk_warehouse_bins_warehouse"
  FOREIGN KEY ("warehouse_id", "tenant_id") REFERENCES "warehouses" ("id", "tenant_id") ON DELETE CASCADE;

--> statement-breakpoint
ALTER TABLE "warehouse_bins"
  ADD CONSTRAINT "fk_warehouse_bins_rack"
  FOREIGN KEY ("rack_id", "tenant_id") REFERENCES "warehouse_racks" ("id", "tenant_id") ON DELETE RESTRICT;

--> statement-breakpoint
-- ---------------------------------------------------------------------------
-- 5. lpns (§2.5, I-05): license plates / pallets — a movable grouping key
--    over bin_contents rows. ACTIVE while in motion; CLOSED when broken
--    down (contents stay in their bins); the code is the scan target.
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "lpns" (
  "id" uuid NOT NULL,
  "tenant_id" uuid NOT NULL REFERENCES "tenants" ("id") ON DELETE RESTRICT,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "updated_at" timestamptz NOT NULL DEFAULT now(),
  "version" integer NOT NULL DEFAULT 1,
  "lpn_code" text NOT NULL,
  "status" text NOT NULL DEFAULT 'ACTIVE',
  "closed_at" timestamptz,
  "note" text,
  "created_by" uuid,
  CONSTRAINT "pk_lpns" PRIMARY KEY ("id"),
  CONSTRAINT "uq_lpns_id_tenant" UNIQUE ("id", "tenant_id"),
  CONSTRAINT "uq_lpns_tenant_code" UNIQUE ("tenant_id", "lpn_code"),
  CONSTRAINT "ck_lpns_code_shape" CHECK ("lpn_code" ~ '^[A-Za-z0-9][A-Za-z0-9_.:-]{1,59}$'),
  CONSTRAINT "ck_lpns_status" CHECK ("status" IN ('ACTIVE', 'CLOSED')),
  -- CLOSED carries its timestamp (the state-evidence floor).
  CONSTRAINT "ck_lpns_state_evidence" CHECK (
    ("status" = 'ACTIVE' AND "closed_at" IS NULL) OR
    ("status" = 'CLOSED' AND "closed_at" IS NOT NULL)
  )
);

--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "ix_lpns_tenant_status" ON "lpns" ("tenant_id", "status");

--> statement-breakpoint
-- ---------------------------------------------------------------------------
-- 6. bin_contents (§2.2, I-01/I-19/I-24): the per-bin position — one row
--    per (bin, item, batch, serial, LPN, owner, status) slot. item_stock
--    remains the VALUATION authority (INV-010 untouched); INV-029 makes
--    Σ(tenant-owned rows) = item_stock per (warehouse, item) at all times
--    — same-transaction writes, the nightly reconciliation job, blocking
--    mismatches. Consignment rows (owner_partner_id set) are the EXCLUDED
--    set: never in item_stock, valuation, or ATP (BR-076).
--
--    NULLS NOT DISTINCT (PG15+) makes the slot unique with NULL batch /
--    serial / LPN / owner — the honest composite floor.
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "bin_contents" (
  "id" uuid NOT NULL,
  "tenant_id" uuid NOT NULL REFERENCES "tenants" ("id") ON DELETE RESTRICT,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "updated_at" timestamptz NOT NULL DEFAULT now(),
  "version" integer NOT NULL DEFAULT 1,
  "bin_id" uuid NOT NULL,
  "warehouse_id" uuid NOT NULL,
  "item_id" uuid NOT NULL,
  "batch_id" uuid,
  "serial_id" uuid,
  "lpn_id" uuid,
  "owner_partner_id" uuid,
  "status" text NOT NULL DEFAULT 'AVAILABLE',
  "qty" numeric(19, 6) NOT NULL,
  "uom_id" uuid,
  "received_at" timestamptz NOT NULL DEFAULT now(),
  "note" text,
  "created_by" uuid,
  CONSTRAINT "pk_bin_contents" PRIMARY KEY ("id"),
  CONSTRAINT "uq_bin_contents_id_tenant" UNIQUE ("id", "tenant_id"),
  CONSTRAINT "uq_bin_contents_slot" UNIQUE NULLS NOT DISTINCT
    ("tenant_id", "bin_id", "item_id", "batch_id", "serial_id", "lpn_id", "owner_partner_id", "status"),
  CONSTRAINT "ck_bin_contents_status" CHECK ("status" IN ('AVAILABLE', 'QUARANTINE', 'HOLD')),
  CONSTRAINT "ck_bin_contents_qty" CHECK ("qty" >= 0)
);

--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "ix_bin_contents_tenant_bin"
  ON "bin_contents" ("tenant_id", "bin_id");

--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "ix_bin_contents_tenant_item_status"
  ON "bin_contents" ("tenant_id", "item_id", "status");

--> statement-breakpoint
-- The INV-029 probe index: per (warehouse, item) folds over tenant-owned
-- rows (owner_partner_id IS NULL) drive the reconciliation job.
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "ix_bin_contents_tenant_wh_item_owner"
  ON "bin_contents" ("tenant_id", "warehouse_id", "item_id", "owner_partner_id");

--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "ix_bin_contents_tenant_batch"
  ON "bin_contents" ("tenant_id", "batch_id");

--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "ix_bin_contents_tenant_serial"
  ON "bin_contents" ("tenant_id", "serial_id");

--> statement-breakpoint
-- The FEFO/FIFO directed-pick index (status AVAILABLE, earliest first).
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "ix_bin_contents_pick_fefo"
  ON "bin_contents" ("tenant_id", "item_id", "status", "received_at");

--> statement-breakpoint
ALTER TABLE "bin_contents"
  ADD CONSTRAINT "fk_bin_contents_bin"
  FOREIGN KEY ("bin_id", "tenant_id") REFERENCES "warehouse_bins" ("id", "tenant_id") ON DELETE RESTRICT;

--> statement-breakpoint
ALTER TABLE "bin_contents"
  ADD CONSTRAINT "fk_bin_contents_warehouse"
  FOREIGN KEY ("warehouse_id", "tenant_id") REFERENCES "warehouses" ("id", "tenant_id") ON DELETE RESTRICT;

--> statement-breakpoint
ALTER TABLE "bin_contents"
  ADD CONSTRAINT "fk_bin_contents_item"
  FOREIGN KEY ("item_id", "tenant_id") REFERENCES "items" ("id", "tenant_id") ON DELETE RESTRICT;

--> statement-breakpoint
ALTER TABLE "bin_contents"
  ADD CONSTRAINT "fk_bin_contents_batch"
  FOREIGN KEY ("batch_id", "tenant_id") REFERENCES "item_batches" ("id", "tenant_id") ON DELETE RESTRICT;

--> statement-breakpoint
ALTER TABLE "bin_contents"
  ADD CONSTRAINT "fk_bin_contents_serial"
  FOREIGN KEY ("serial_id", "tenant_id") REFERENCES "item_serials" ("id", "tenant_id") ON DELETE RESTRICT;

--> statement-breakpoint
ALTER TABLE "bin_contents"
  ADD CONSTRAINT "fk_bin_contents_lpn"
  FOREIGN KEY ("lpn_id", "tenant_id") REFERENCES "lpns" ("id", "tenant_id") ON DELETE RESTRICT;

--> statement-breakpoint
ALTER TABLE "bin_contents"
  ADD CONSTRAINT "fk_bin_contents_owner_partner"
  FOREIGN KEY ("owner_partner_id", "tenant_id") REFERENCES "partners" ("id", "tenant_id") ON DELETE RESTRICT;

--> statement-breakpoint
-- ---------------------------------------------------------------------------
-- 7. stock_moves extension (§2.2): source/target bin + LPN references —
--    additive nullable columns (the 0065 §4 precedent; existing rows keep
--    NULL = the pre-WMS history floor).
--> statement-breakpoint
ALTER TABLE "stock_moves"
  ADD COLUMN IF NOT EXISTS "source_bin_id" uuid,
  ADD COLUMN IF NOT EXISTS "target_bin_id" uuid,
  ADD COLUMN IF NOT EXISTS "lpn_id" uuid;

--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "ix_stock_moves_tenant_source_bin"
  ON "stock_moves" ("tenant_id", "source_bin_id");

--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "ix_stock_moves_tenant_target_bin"
  ON "stock_moves" ("tenant_id", "target_bin_id");

--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "ix_stock_moves_tenant_lpn"
  ON "stock_moves" ("tenant_id", "lpn_id");

--> statement-breakpoint
ALTER TABLE "stock_moves"
  ADD CONSTRAINT "fk_stock_moves_source_bin"
  FOREIGN KEY ("source_bin_id", "tenant_id") REFERENCES "warehouse_bins" ("id", "tenant_id") ON DELETE RESTRICT;

--> statement-breakpoint
ALTER TABLE "stock_moves"
  ADD CONSTRAINT "fk_stock_moves_target_bin"
  FOREIGN KEY ("target_bin_id", "tenant_id") REFERENCES "warehouse_bins" ("id", "tenant_id") ON DELETE RESTRICT;

--> statement-breakpoint
ALTER TABLE "stock_moves"
  ADD CONSTRAINT "fk_stock_moves_lpn"
  FOREIGN KEY ("lpn_id", "tenant_id") REFERENCES "lpns" ("id", "tenant_id") ON DELETE RESTRICT;

--> statement-breakpoint
-- ---------------------------------------------------------------------------
-- 8. returnable_packaging (§2.15, L1-20 — v3.1/CR-46): the container-TYPE
--    register — pallets/crates/containers as tracked asset-items with a
--    deposit per unit (the balance report folds per customer × type).
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "returnable_packaging" (
  "id" uuid NOT NULL,
  "tenant_id" uuid NOT NULL REFERENCES "tenants" ("id") ON DELETE RESTRICT,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "updated_at" timestamptz NOT NULL DEFAULT now(),
  "version" integer NOT NULL DEFAULT 1,
  "code" text NOT NULL,
  "packaging_type" text NOT NULL,
  "name" text NOT NULL,
  "name_ar" text,
  "deposit_amount" numeric(19, 4) NOT NULL DEFAULT 0,
  "item_id" uuid,
  "status" text NOT NULL DEFAULT 'ACTIVE',
  "note" text,
  "created_by" uuid,
  CONSTRAINT "pk_returnable_packaging" PRIMARY KEY ("id"),
  CONSTRAINT "uq_returnable_packaging_id_tenant" UNIQUE ("id", "tenant_id"),
  CONSTRAINT "uq_returnable_packaging_tenant_code" UNIQUE ("tenant_id", "code"),
  CONSTRAINT "ck_returnable_packaging_code_shape" CHECK ("code" ~ '^[A-Za-z][A-Za-z0-9_-]{1,39}$'),
  CONSTRAINT "ck_returnable_packaging_type" CHECK (
    "packaging_type" IN ('PALLET', 'CRATE', 'CONTAINER', 'OTHER')
  ),
  CONSTRAINT "ck_returnable_packaging_deposit" CHECK ("deposit_amount" >= 0),
  CONSTRAINT "ck_returnable_packaging_status" CHECK ("status" IN ('ACTIVE', 'RETIRED'))
);

--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "ix_returnable_packaging_tenant_status"
  ON "returnable_packaging" ("tenant_id", "status");

--> statement-breakpoint
ALTER TABLE "returnable_packaging"
  ADD CONSTRAINT "fk_returnable_packaging_item"
  FOREIGN KEY ("item_id", "tenant_id") REFERENCES "items" ("id", "tenant_id") ON DELETE SET NULL;

--> statement-breakpoint
-- ---------------------------------------------------------------------------
-- 9. returnable_packaging_movements (§2.15, L1-20): the append-only issue /
--    return / write-off log. Issue posts the deposit liability
--    (DR AR/cash · CR DEPOSITS_RECEIVED — the EXISTING 2140 purpose, D-2);
--    return releases it; damage/non-return writes it off against the new
--    4895 DEPOSIT_FORFEITURE marker below.
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "returnable_packaging_movements" (
  "id" uuid NOT NULL,
  "tenant_id" uuid NOT NULL REFERENCES "tenants" ("id") ON DELETE RESTRICT,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "packaging_id" uuid NOT NULL,
  "kind" text NOT NULL,
  "qty" integer NOT NULL,
  "deposit_per_unit" numeric(19, 4) NOT NULL DEFAULT 0,
  "partner_id" uuid,
  "delivery_id" uuid,
  "receipt_id" uuid,
  "journal_id" uuid,
  "moved_at" date NOT NULL,
  "note" text,
  "created_by" uuid,
  CONSTRAINT "pk_returnable_packaging_movements" PRIMARY KEY ("id"),
  CONSTRAINT "uq_returnable_packaging_movements_id_tenant" UNIQUE ("id", "tenant_id"),
  CONSTRAINT "ck_returnable_packaging_movements_kind" CHECK (
    "kind" IN ('ISSUE', 'RETURN', 'WRITE_OFF')
  ),
  CONSTRAINT "ck_returnable_packaging_movements_qty" CHECK ("qty" > 0),
  CONSTRAINT "ck_returnable_packaging_movements_deposit" CHECK ("deposit_per_unit" >= 0)
);

--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "ix_returnable_packaging_movements_tenant_packaging"
  ON "returnable_packaging_movements" ("tenant_id", "packaging_id");

--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "ix_returnable_packaging_movements_tenant_partner"
  ON "returnable_packaging_movements" ("tenant_id", "partner_id");

--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "ix_returnable_packaging_movements_tenant_delivery"
  ON "returnable_packaging_movements" ("tenant_id", "delivery_id");

--> statement-breakpoint
ALTER TABLE "returnable_packaging_movements"
  ADD CONSTRAINT "fk_returnable_packaging_movements_packaging"
  FOREIGN KEY ("packaging_id", "tenant_id") REFERENCES "returnable_packaging" ("id", "tenant_id") ON DELETE RESTRICT;

--> statement-breakpoint
ALTER TABLE "returnable_packaging_movements"
  ADD CONSTRAINT "fk_returnable_packaging_movements_partner"
  FOREIGN KEY ("partner_id", "tenant_id") REFERENCES "partners" ("id", "tenant_id") ON DELETE RESTRICT;

--> statement-breakpoint
-- ---------------------------------------------------------------------------
-- 10. CoA template marker (the 0026/0065 additive pattern): 4895
--     DEPOSIT_FORFEITURE — the income leg of a damaged / non-returned
--     packaging deposit write-off. The liability leg reuses the EXISTING
--     DEPOSITS_RECEIVED purpose (2140, seeded 0008) — no new liability
--     purpose this phase (D-2).
--> statement-breakpoint
INSERT INTO "chart_of_accounts_template" ("code", "name", "name_ar", "type", "is_group", "parent_code", "purpose_key") VALUES
  ('4895', 'Deposit forfeiture (returnable packaging)', 'استرداد مخصص العبوات المرتجعة (إيراد)', 'REVENUE', false, '4000', 'DEPOSIT_FORFEITURE')
ON CONFLICT ("code") DO UPDATE
  SET "name" = EXCLUDED."name", "name_ar" = EXCLUDED."name_ar",
      "type" = EXCLUDED."type", "is_group" = EXCLUDED."is_group",
      "parent_code" = EXCLUDED."parent_code", "purpose_key" = EXCLUDED."purpose_key";

--> statement-breakpoint
-- ---------------------------------------------------------------------------
-- 11. RLS — the house triple (apply_tenant_policy + the purge path) for
--     the six new tables.
--> statement-breakpoint
ALTER TABLE "warehouse_zones" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "warehouse_zones" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
SELECT erp.apply_tenant_policy('"warehouse_zones"');
--> statement-breakpoint
ALTER TABLE "warehouse_aisles" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "warehouse_aisles" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
SELECT erp.apply_tenant_policy('"warehouse_aisles"');
--> statement-breakpoint
ALTER TABLE "warehouse_racks" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "warehouse_racks" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
SELECT erp.apply_tenant_policy('"warehouse_racks"');
--> statement-breakpoint
ALTER TABLE "warehouse_bins" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "warehouse_bins" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
SELECT erp.apply_tenant_policy('"warehouse_bins"');
--> statement-breakpoint
ALTER TABLE "lpns" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "lpns" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
SELECT erp.apply_tenant_policy('"lpns"');
--> statement-breakpoint
ALTER TABLE "bin_contents" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "bin_contents" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
SELECT erp.apply_tenant_policy('"bin_contents"');
--> statement-breakpoint
ALTER TABLE "returnable_packaging" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "returnable_packaging" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
SELECT erp.apply_tenant_policy('"returnable_packaging"');
--> statement-breakpoint
ALTER TABLE "returnable_packaging_movements" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "returnable_packaging_movements" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
SELECT erp.apply_tenant_policy('"returnable_packaging_movements"');
--> statement-breakpoint
DO $$
DECLARE
  t text;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'warehouse_zones', 'warehouse_aisles', 'warehouse_racks', 'warehouse_bins',
    'lpns', 'bin_contents', 'returnable_packaging', 'returnable_packaging_movements'
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
-- 12. Grants.
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE ON "warehouse_zones" TO erp_app;
--> statement-breakpoint
GRANT SELECT ON "warehouse_zones" TO erp_readonly;
--> statement-breakpoint
GRANT SELECT ON "warehouse_zones" TO erp_definer;
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE ON "warehouse_aisles" TO erp_app;
--> statement-breakpoint
GRANT SELECT ON "warehouse_aisles" TO erp_readonly;
--> statement-breakpoint
GRANT SELECT ON "warehouse_aisles" TO erp_definer;
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE ON "warehouse_racks" TO erp_app;
--> statement-breakpoint
GRANT SELECT ON "warehouse_racks" TO erp_readonly;
--> statement-breakpoint
GRANT SELECT ON "warehouse_racks" TO erp_definer;
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE ON "warehouse_bins" TO erp_app;
--> statement-breakpoint
GRANT SELECT ON "warehouse_bins" TO erp_readonly;
--> statement-breakpoint
GRANT SELECT ON "warehouse_bins" TO erp_definer;
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE ON "lpns" TO erp_app;
--> statement-breakpoint
GRANT SELECT ON "lpns" TO erp_readonly;
--> statement-breakpoint
GRANT SELECT ON "lpns" TO erp_definer;
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE ON "bin_contents" TO erp_app;
--> statement-breakpoint
GRANT SELECT ON "bin_contents" TO erp_readonly;
--> statement-breakpoint
GRANT SELECT ON "bin_contents" TO erp_definer;
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE ON "returnable_packaging" TO erp_app;
--> statement-breakpoint
GRANT SELECT ON "returnable_packaging" TO erp_readonly;
--> statement-breakpoint
GRANT SELECT ON "returnable_packaging" TO erp_definer;
--> statement-breakpoint
-- Append-only log: no app-role UPDATE (the stock_moves discipline).
--> statement-breakpoint
GRANT SELECT, INSERT ON "returnable_packaging_movements" TO erp_app;
--> statement-breakpoint
GRANT SELECT ON "returnable_packaging_movements" TO erp_readonly;
--> statement-breakpoint
GRANT SELECT ON "returnable_packaging_movements" TO erp_definer;

--> statement-breakpoint
RESET ROLE;

--> statement-breakpoint
-- Schema-state marker for /health/ready (mirrors the migration manifest).
INSERT INTO erp._schema_state (key, value) VALUES ('schema_version', 67)
ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, at = now();
