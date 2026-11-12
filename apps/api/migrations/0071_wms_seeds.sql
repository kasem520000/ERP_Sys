-- PHASE-044 (Blueprint v3.0 · CR-14) · migration 0071 · WMS & Inventory
-- Intelligence (part 5: the DATA-ONLY seed).
--
-- Contents:
--   §1 the EIGHT permission keys (matrix §3.21; zero-drift 279 → 287)
--   §2 role grants (owner/accountant: all; warehouse: the operational
--      seven; viewer: the read pair — the 0065 tier precedent)
--   §3 feature plan grants: business + enterprise carry the eight keys
--      (the 0066 §8 precedent)
--   §4 the distribution-bearing manifest enablement (CR-36 (f)):
--      industry.distribution + industry.wholesale required_feature_keys
--      gain the eight keys (jsonb array append — canonical order = the
--      trailing block; the contracts copy + the docs mirrors move with
--      this seed, the 039 re-pin procedure)
--   §5 the default location tree per EXISTING warehouse (BR-073's
--      backfill anchor: one DEFAULT zone/aisle/rack/bin + a default FIFO
--      pick strategy per warehouse; warehouses created after this
--      migration get theirs lazily from the location service — the
--      documented D-5)
--
-- Numbering note: the phase doc's planned "≈ 0073…0081" predates the
-- 039…042 waves never consuming these slots — 0067…0071 are the honest
-- next journal entries (PHASE-043 has NOT run; it requires THIS phase).

--> statement-breakpoint
SET ROLE erp_migrate;

--> statement-breakpoint
-- ---------------------------------------------------------------------------
-- 1. Permission seed (matrix §3.21; zero-drift 279 → 287): the EIGHT keys.
--> statement-breakpoint
INSERT INTO "permissions" ("key", "module", "description") VALUES
('inventory.wms.locations', 'inventory', 'Manage the WMS location tree (zones/aisles/racks/bins, barcodes, pick sequence) / إدارة شجرة مواقع المستودع (مناطق/ممرات/أرفف/صناديق بباركود وتسلسل انتقاء)'),
('inventory.wms.putaway', 'inventory', 'Execute directed putaway (suggested tasks, bin-label print, scan confirm) / تنفيذ التخزين الموجّه (المهام المقترحة وطبع بطاقة الصندوق والتأكيد بالمسح)'),
('inventory.wms.picking', 'inventory', 'Execute directed picking (waves, strategies FIFO/FEFO/NEAREST, cluster + scan) / تنفيذ الانتقاء الموجّه (الموجات واستراتيجيات FIFO/FEFO/الأقرب والعنقودي بالمسح)'),
('inventory.cycle_counts', 'inventory', 'Manage cycle-count schedules, documents, and variance approvals / إدارة جداول الجرد الدوري ومستنداته واعتماد فروقاته'),
('inventory.abc', 'inventory', 'Read ABC classifications and recompute schedules / قراءة تصنيفات ABC وإعادة احتسابها'),
('inventory.tracking.serial_ledger', 'inventory', 'Read the serial-movement ledger / قراءة دفتر حركة الأرقام التسلسلية'),
('inventory.quarantine', 'inventory', 'Manage the quarantine/HOLD board and dispositions / إدارة لوحة الفحص/التعليق وقراراتها'),
('inventory.tracking.consignment', 'inventory', 'Manage consignment/VMI stock (receive, settle) / إدارة مخزون الأمانة (استلام وتسوية)')
ON CONFLICT ("key") DO UPDATE
  SET "module" = EXCLUDED."module", "description" = EXCLUDED."description";

--> statement-breakpoint
-- 2a. owner + accountant: all eight.
--> statement-breakpoint
INSERT INTO "role_permissions" ("role_id", "tenant_id", "permission_id")
SELECT r."id", NULL, p."key"
FROM "roles" r JOIN "permissions" p ON p."key" IN (
  'inventory.wms.locations', 'inventory.wms.putaway', 'inventory.wms.picking',
  'inventory.cycle_counts', 'inventory.abc', 'inventory.tracking.serial_ledger',
  'inventory.quarantine', 'inventory.tracking.consignment'
)
WHERE r."key" = 'owner' AND r."tenant_id" IS NULL
ON CONFLICT ("role_id", "permission_id") DO NOTHING;

--> statement-breakpoint
INSERT INTO "role_permissions" ("role_id", "tenant_id", "permission_id")
SELECT r."id", NULL, p."key"
FROM "roles" r JOIN "permissions" p ON p."key" IN (
  'inventory.wms.locations', 'inventory.wms.putaway', 'inventory.wms.picking',
  'inventory.cycle_counts', 'inventory.abc', 'inventory.tracking.serial_ledger',
  'inventory.quarantine', 'inventory.tracking.consignment'
)
WHERE r."key" = 'accountant' AND r."tenant_id" IS NULL
ON CONFLICT ("role_id", "permission_id") DO NOTHING;

--> statement-breakpoint
-- 2b. warehouse: the operational seven (abc stays the analysis tier).
--> statement-breakpoint
INSERT INTO "role_permissions" ("role_id", "tenant_id", "permission_id")
SELECT r."id", NULL, p."key"
FROM "roles" r JOIN "permissions" p ON p."key" IN (
  'inventory.wms.locations', 'inventory.wms.putaway', 'inventory.wms.picking',
  'inventory.cycle_counts', 'inventory.tracking.serial_ledger',
  'inventory.quarantine', 'inventory.tracking.consignment'
)
WHERE r."key" = 'warehouse' AND r."tenant_id" IS NULL
ON CONFLICT ("role_id", "permission_id") DO NOTHING;

--> statement-breakpoint
-- 2c. viewer: the read pair (the 042 oee.read precedent).
--> statement-breakpoint
INSERT INTO "role_permissions" ("role_id", "tenant_id", "permission_id")
SELECT r."id", NULL, p."key"
FROM "roles" r JOIN "permissions" p ON p."key" IN (
  'inventory.abc', 'inventory.tracking.serial_ledger'
)
WHERE r."key" = 'viewer' AND r."tenant_id" IS NULL
ON CONFLICT ("role_id", "permission_id") DO NOTHING;

--> statement-breakpoint
-- ---------------------------------------------------------------------------
-- 3. Feature plan grants (the 0066 §8 precedent): the EIGHT WMS keys join
--    business + enterprise (starter excluded).
--> statement-breakpoint
UPDATE "plans" SET "feature_keys" = array_cat("feature_keys",
  ARRAY['inventory.wms', 'inventory.putaway', 'inventory.picking',
        'inventory.cycle_counts', 'inventory.abc',
        'inventory.serial_ledger', 'inventory.quarantine',
        'inventory.consignment'])
WHERE "key" IN ('business', 'enterprise')
  AND NOT ('inventory.wms' = ANY("feature_keys"));

--> statement-breakpoint
-- ---------------------------------------------------------------------------
-- 4. Distribution-bearing manifest enablement (CR-36 (f)): the two
--    distribution-bearing templates (industry.distribution +
--    industry.wholesale) require the eight keys by default — the jsonb
--    array APPEND keeps the canonical trailing-block order; the contracts
--    copy + the docs mirrors move with this seed (the hash pins re-pinned
--    per the 039 procedure).
--> statement-breakpoint
UPDATE "industry_templates"
SET "manifest" = jsonb_set("manifest", '{required_feature_keys}',
  ("manifest"->'required_feature_keys') ||
  '["inventory.wms", "inventory.putaway", "inventory.picking", "inventory.cycle_counts", "inventory.abc", "inventory.serial_ledger", "inventory.quarantine", "inventory.consignment"]'::jsonb)
WHERE "key" IN ('industry.distribution', 'industry.wholesale');

--> statement-breakpoint
-- ---------------------------------------------------------------------------
-- 5. The default location tree per EXISTING warehouse (BR-073's backfill
--    anchor): DEFAULT zone (PICKING) → aisle A1 → rack R1 → the DEFAULT
--    bin (barcode BIN-<WH>-DEFAULT, pick_sequence 1, is_default) + the
--    default FIFO pick strategy. Idempotent under re-run (the ON CONFLICT
--    DO NOTHING floors stop the cascade). Warehouses created later get
--    theirs lazily from the location service (D-5).
--> statement-breakpoint
WITH new_zones AS (
  INSERT INTO "warehouse_zones" ("id", "tenant_id", "warehouse_id", "code", "name", "name_ar", "zone_type", "is_default")
  SELECT gen_random_uuid(), w."tenant_id", w."id", 'DEFAULT', 'Default zone', 'المنطقة الافتراضية', 'PICKING', true
  FROM "warehouses" w
  ON CONFLICT DO NOTHING
  RETURNING "id", "tenant_id", "warehouse_id"
), new_aisles AS (
  INSERT INTO "warehouse_aisles" ("id", "tenant_id", "zone_id", "code", "name", "name_ar")
  SELECT gen_random_uuid(), z."tenant_id", z."id", 'A1', 'Default aisle', 'الممر الافتراضي'
  FROM new_zones z
  ON CONFLICT DO NOTHING
  RETURNING "id", "tenant_id", "zone_id"
), new_racks AS (
  INSERT INTO "warehouse_racks" ("id", "tenant_id", "aisle_id", "code", "name", "name_ar")
  SELECT gen_random_uuid(), a."tenant_id", a."id", 'R1', 'Default rack', 'الرف الافتراضي'
  FROM new_aisles a
  ON CONFLICT DO NOTHING
  RETURNING "id", "tenant_id", "aisle_id"
)
INSERT INTO "warehouse_bins" ("id", "tenant_id", "warehouse_id", "rack_id", "code", "barcode", "name", "name_ar", "pick_sequence", "is_default")
SELECT gen_random_uuid(), rk."tenant_id", zn."warehouse_id", rk."id", 'DEFAULT',
       'BIN-' || upper(w."code") || '-DEFAULT', 'Default bin', 'الصندوق الافتراضي', 1, true
FROM new_racks rk
JOIN new_aisles al ON al."id" = rk."aisle_id" AND al."tenant_id" = rk."tenant_id"
JOIN new_zones zn ON zn."id" = al."zone_id" AND zn."tenant_id" = al."tenant_id"
JOIN "warehouses" w ON w."id" = zn."warehouse_id" AND w."tenant_id" = zn."tenant_id"
ON CONFLICT DO NOTHING;

--> statement-breakpoint
INSERT INTO "pick_strategies" ("id", "tenant_id", "warehouse_id", "method", "allow_partial")
SELECT gen_random_uuid(), w."tenant_id", w."id", 'FIFO', true
FROM "warehouses" w
ON CONFLICT DO NOTHING;

--> statement-breakpoint
RESET ROLE;

--> statement-breakpoint
-- Schema-state marker for /health/ready (mirrors the migration manifest).
INSERT INTO erp._schema_state (key, value) VALUES ('schema_version', 71)
ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, at = now();
