-- PHASE-043 (Blueprint v3.0 · CR-13) · migration 0078 · Manufacturing II —
-- MRP & Planning (part 5: the DATA-ONLY seed — the 0071 pattern).
--
--   §1 the FOUR permission keys (287 → 291, matrix §3.20):
--        manufacturing.mrp              — run MRP + manage suggestions
--        manufacturing.mps              — manage MPS entries
--        manufacturing.planning_policies — manage item planning policies
--        manufacturing.mps.frozen_edit  — edit MPS inside the frozen fence
--      Role tiers (the 0065 precedent): owner + accountant take all four;
--      the warehouse role (the material planners' tier) takes mrp + mps —
--      NOT the policy master data and NOT the frozen-fence override; the
--      viewer role takes none (runs are operational screens — oee.read was
--      the viewer's manufacturing read surface).
--   §2 the THREE feature plan grants (the tier-4 precedent: business +
--      enterprise only — planning is not a starter feature):
--        manufacturing.mrp · manufacturing.mps · manufacturing.planning
--   §3 the lot-sizing rule definitions (M-01 — the seeded global catalog
--      from 0074): the four deterministic rules with their operand.
--   §4 the food_manufacturing manifest enablement (the 0065/0066 pattern —
--      the manufacturing template requires the planning keys).
--   §5 the default pick-strategy counterpart: nothing here — the planning
--      surface needs no default rows (the data-readiness panel handles the
--      empty state; the 0071 default-tree precedent applies to structural
--      tables only).

--> statement-breakpoint
SET ROLE erp_migrate;

--> statement-breakpoint
-- ---------------------------------------------------------------------------
-- 1. Permission keys (287 → 291, matrix §3.20).
--> statement-breakpoint
INSERT INTO "permissions" ("key", "module", "description") VALUES
('manufacturing.mrp', 'manufacturing', 'Run MRP and manage suggestions (accept / dismiss / convert) / تشغيل تخطيط الاحتياجات وإدارة الاقتراحات (قبول/رفض/تحويل)'),
('manufacturing.mps', 'manufacturing', 'Manage master production schedule entries / إدارة سطور الجدول الزمني للإنتاج الرئيسي'),
('manufacturing.planning_policies', 'manufacturing', 'Manage item planning policies (lead time, safety stock, lot sizing, time fences) / إدارة سياسات تخطيط الصنف (زمن التوريد ومخزون الأمان والتحجم والأسوار الزمنية)'),
('manufacturing.mps.frozen_edit', 'manufacturing', 'Edit MPS entries inside the frozen fence (with reason) / تعديل سطور الجدول داخل السياج المجمد (مع السبب)')
ON CONFLICT ("key") DO UPDATE
  SET "module" = EXCLUDED."module", "description" = EXCLUDED."description";
--> statement-breakpoint
INSERT INTO "role_permissions" ("role_id", "tenant_id", "permission_id")
SELECT r."id", NULL, p."key"
FROM "roles" r JOIN "permissions" p ON p."key" IN (
  'manufacturing.mrp', 'manufacturing.mps',
  'manufacturing.planning_policies', 'manufacturing.mps.frozen_edit'
)
WHERE r."key" = 'owner' AND r."tenant_id" IS NULL
ON CONFLICT ("role_id", "permission_id") DO NOTHING;
--> statement-breakpoint
INSERT INTO "role_permissions" ("role_id", "tenant_id", "permission_id")
SELECT r."id", NULL, p."key"
FROM "roles" r JOIN "permissions" p ON p."key" IN (
  'manufacturing.mrp', 'manufacturing.mps',
  'manufacturing.planning_policies', 'manufacturing.mps.frozen_edit'
)
WHERE r."key" = 'accountant' AND r."tenant_id" IS NULL
ON CONFLICT ("role_id", "permission_id") DO NOTHING;
--> statement-breakpoint
INSERT INTO "role_permissions" ("role_id", "tenant_id", "permission_id")
SELECT r."id", NULL, p."key"
FROM "roles" r JOIN "permissions" p ON p."key" IN (
  'manufacturing.mrp', 'manufacturing.mps'
)
WHERE r."key" = 'warehouse' AND r."tenant_id" IS NULL
ON CONFLICT ("role_id", "permission_id") DO NOTHING;

--> statement-breakpoint
-- ---------------------------------------------------------------------------
-- 2. Feature plan grants (the tier-4 precedent — business + enterprise).
--> statement-breakpoint
UPDATE "plans" SET "feature_keys" = array_cat("feature_keys", ARRAY[
  'manufacturing.mrp', 'manufacturing.mps', 'manufacturing.planning'
])
WHERE "key" IN ('business', 'enterprise')
  AND NOT ('manufacturing.mrp' = ANY("feature_keys"));

--> statement-breakpoint
-- ---------------------------------------------------------------------------
-- 3. Lot-sizing rule definitions (M-01 — the 0074 global catalog): the
--    four deterministic rules with their items-column operand.
--> statement-breakpoint
INSERT INTO "lot_sizing_rules" ("code", "name", "name_ar", "description", "description_ar", "param_required") VALUES
('LOT_FOR_LOT', 'Lot-for-lot', 'حسب الطلب',
 'Order exactly the net requirement of each bucket — no remainder carried (the default; zero-waste at the cost of order frequency).',
 'أمر يعادل الاحتياج الصافي لكل فترة تماماً — بلا فائض محمول (الافتراضي: صفر هدر مقابل تكرار الأوامر).',
 NULL),
('FIXED_ORDER_QTY', 'Fixed order quantity', 'كمية أمر ثابتة',
 'Order in multiples of the fixed order quantity — the first bucket''s net requirement rounds up to the next whole multiple.',
 'الأمر بمضاعفات الكمية الثابتة — يُقرَّب الاحتياج الصافي لأول فترة إلى المضاعف الكامل التالي.',
 'fixed_order_qty'),
('ORDER_MULTIPLE', 'Order multiple', 'مضاعف الأمر',
 'Like fixed order quantity but the multiple is a packaging/handling constraint (e.g. pallets of 50) — every order quantity is a whole multiple.',
 'مثل الكمية الثابتة لكن المضاعف قيد تعبئة/مناولة (مثل منصات الخمسين) — كل كمية أمر مضاعف كامل.',
 'order_multiple'),
('PERIOD_SUPPLY', 'Period supply', 'توريد فترات',
 'Cover the net requirements of a fixed number of consecutive buckets with one order — fewer orders at the cost of earlier holdings.',
 'تغطية احتياجات عدد ثابت من الفترات المتتالية بأمر واحد — أوامر أقل مقابل مخزون مبكر.',
 'period_supply_buckets')
ON CONFLICT ("code") DO UPDATE
  SET "name" = EXCLUDED."name", "name_ar" = EXCLUDED."name_ar",
      "description" = EXCLUDED."description", "description_ar" = EXCLUDED."description_ar",
      "param_required" = EXCLUDED."param_required";

--> statement-breakpoint
-- ---------------------------------------------------------------------------
-- 4. food_manufacturing manifest enablement (the 0065/0066 pattern).
--> statement-breakpoint
UPDATE "industry_templates" SET "manifest" = jsonb_set(
  "manifest", '{required_feature_keys}',
  (COALESCE("manifest" -> 'required_feature_keys', '[]'::jsonb)
    || '["manufacturing.mrp", "manufacturing.mps", "manufacturing.planning"]'::jsonb)
)
WHERE "key" = 'food_manufacturing'
  AND NOT ("manifest" -> 'required_feature_keys') @> '["manufacturing.mrp"]';

--> statement-breakpoint
RESET ROLE;

--> statement-breakpoint
-- Schema-state marker for /health/ready (mirrors the migration manifest).
INSERT INTO erp._schema_state (key, value) VALUES ('schema_version', 78)
ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, at = now();
