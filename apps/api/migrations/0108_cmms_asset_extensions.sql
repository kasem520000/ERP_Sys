-- PHASE-049 (Blueprint v3.0 · CR-19, extended by v3.2/CR-50) · migration
-- 0108 · CMMS — Asset Maintenance (part 4: THE ALTER on the frozen
-- substrate + THE DATA-ONLY GRANTS BLOCK — T-04, the 0098/0103
-- pattern; 0105–0107 stay byte-stable).
--
--   THE ALTER on "assets" (D-01 — the frozen-substrate law: the 044
--   register keeps its shape and every existing column/index; the
--   column family lands additively, the 0100/0104 precedent):
--     warranty_expiry · insurance_expiry · license_expiry ·
--     inspection_expiry (the four date registers — the sweep's 30/7/0
--     windows, W-19; inspection is the R-10 fleet-light fourth, used
--     where a tenant tracks it) + cost_center_id (the grouping FK —
--     riding the EXISTING cost_centers tree, never a new dimension) +
--     parent_asset_id (the component link — components carry their own
--     meters and spares and roll up into the parent's service history;
--     the self-reference DB floor here, the full cycle guard at write
--     time the W-17 service's — the 047 org-tree precedent).
--
--   §1 THE TEN PERMISSION KEYS (matrix §3.27; catalog 326 → 336 — the
--     phase doc's exact list): assets.maintenance.view / .manage /
--     .plan · assets.meters.view / .record · assets.spares.manage ·
--     assets.transfer.view / .approve · assets.tags.manage ·
--     assets.expiry.view. Role grants (the 0103 precedent): the owner
--     template holds ALL TEN; the accountant holds the TWO finance-read
--     keys (maintenance.view — the cost collectors feed INV-034's GL
--     reconciliation; expiry.view — the renewal registers) — the
--     finance side's read plane over the asset substrate; the
--     operational keys (plan/meters/spares/transfer/tags) stay
--     owner-only — maintenance operations are tenant-granted beyond
--     the baseline.
--   §2 THE PLAN GRANTS (the tier-4 precedent — THE DECLARED NEUTRAL
--     ZERO): business + enterprise carry the TWO FEATURE FLAGS —
--     assets.maintenance · assets.transfer (the phase doc's composable
--     units, the §3 schema's single-segment module.feature shape).
--     STARTER GETS NEITHER — the declared neutral zero (the tier-4
--     posture verbatim: the CMMS plane is not a starter feature; zero
--     starter keys move, nothing silent). The ten permission keys are
--     the AUTHORIZATION surface and ride ROLES (§1) — never the plans
--     (matrix §3.27's dated note records the divergence, the §3.26
--     precedent).
--   §3 THE MANIFEST ENABLEMENT (D-11/D-16 — CR-36f template-composable):
--     the FOUR CMMS-carrying templates — automotive (the workshop
--     template), rental_logistics, healthcare, food_manufacturing —
--     compose the two flags by default (the phase doc's instruction).
--     THE COHERENT-CHANGE LAW (the 0098 §3 procedure): the canonical
--     templates.ts + THIS stored-registry update + the docs mirrors
--     move together in the same increment (W-16) — the guarded
--     one-field jsonb_set appends (zero transcription risk; the
--     canonical-JSON hash the effective-config layer computes is
--     order-and-whitespace blind — deterministic, zero wall-clock
--     input anywhere in the manifest).
--   §4 THE CoA TEMPLATE MARKERS (the 0077 §6 additive pattern — D-04's
--     own dependency: the G-59/G-61 purposes must RESOLVE, and new
--     tenants materialize the template at onboarding): MAINTENANCE_
--     EXPENSE (5310, the expense family) · LABOR_CLEARING (2138, the
--     accrued-liabilities family — the technician labor cost's GL
--     holding account until payroll clears it; the payroll tables
--     READ-ONLY, D-03) · EXTERNAL_ACCRUAL (2137, the accrued-liabilities
--     family — the supplier bill's own posting supersedes the accrual
--     leg when it lands, the 038 pattern). Existing tenants map their
--     own accounts fail-closed (PURPOSE_NOT_MAPPED until then — the
--     0037/0077 discipline). The parts leg rides the EXISTING INVENTORY
--     purpose (1140) — no new marker. G-61 rides the EXISTING per-
--     branch FIXED_ASSET mapping — no new marker.
--
--   Zero new tables (ENTITY_CATALOG 318 → 326 is 0105–0107's +8; this
--   migration's catalog delta is ZERO — the column family extends the
--   existing assets row).

--> statement-breakpoint
SET ROLE erp_migrate;

--> statement-breakpoint
-- ---------------------------------------------------------------------------
-- 1. The column family on the frozen substrate.
--> statement-breakpoint
ALTER TABLE "assets" ADD COLUMN IF NOT EXISTS "warranty_expiry" date;
--> statement-breakpoint
ALTER TABLE "assets" ADD COLUMN IF NOT EXISTS "insurance_expiry" date;
--> statement-breakpoint
ALTER TABLE "assets" ADD COLUMN IF NOT EXISTS "license_expiry" date;
--> statement-breakpoint
ALTER TABLE "assets" ADD COLUMN IF NOT EXISTS "inspection_expiry" date;
--> statement-breakpoint
ALTER TABLE "assets" ADD COLUMN IF NOT EXISTS "cost_center_id" uuid;
--> statement-breakpoint
ALTER TABLE "assets" ADD COLUMN IF NOT EXISTS "parent_asset_id" uuid;
--> statement-breakpoint
ALTER TABLE "assets"
  ADD CONSTRAINT fk_assets_cost_center
  FOREIGN KEY ("cost_center_id", "tenant_id")
  REFERENCES "cost_centers" ("id", "tenant_id") ON DELETE RESTRICT;
--> statement-breakpoint
ALTER TABLE "assets"
  ADD CONSTRAINT fk_assets_parent_asset
  FOREIGN KEY ("parent_asset_id", "tenant_id")
  REFERENCES "assets" ("id", "tenant_id") ON DELETE RESTRICT;
--> statement-breakpoint
-- The self-reference floor (the full ancestor-cycle guard is the W-17
-- service's write-time law — the 047 org-tree detectCycle precedent).
ALTER TABLE "assets"
  ADD CONSTRAINT ck_assets_parent_not_self
  CHECK ("parent_asset_id" IS NULL OR "parent_asset_id" <> "id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS ix_assets_tenant_cost_center
  ON "assets" ("tenant_id", "cost_center_id")
  WHERE "cost_center_id" IS NOT NULL;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS ix_assets_tenant_parent
  ON "assets" ("tenant_id", "parent_asset_id")
  WHERE "parent_asset_id" IS NOT NULL;

--> statement-breakpoint
COMMENT ON COLUMN "assets"."warranty_expiry" IS 'PHASE-049 (D-10): the warranty expiry register — the 30/7/0 sweep''s first class / سجل انتهاء الضمان';
--> statement-breakpoint
COMMENT ON COLUMN "assets"."insurance_expiry" IS 'PHASE-049 (D-10): the insurance expiry register — the 30/7/0 sweep''s second class / سجل انتهاء التأمين';
--> statement-breakpoint
COMMENT ON COLUMN "assets"."license_expiry" IS 'PHASE-049 (D-10): the license expiry register — the 30/7/0 sweep''s third class / سجل انتهاء الترخيص';
--> statement-breakpoint
COMMENT ON COLUMN "assets"."inspection_expiry" IS 'PHASE-049 (D-10/R-10): the inspection expiry register — the fleet-light fourth class, used where a tenant tracks it / سجل انتهاء الفحص — فئة أسطول النقل حيث يتتبعها المستأجر';
--> statement-breakpoint
COMMENT ON COLUMN "assets"."cost_center_id" IS 'PHASE-049 (D-01): the cost-center grouping — rides the EXISTING cost_centers tree, never a new dimension / التجميع حسب مركز التكلفة على الشجرة القائمة';
--> statement-breakpoint
COMMENT ON COLUMN "assets"."parent_asset_id" IS 'PHASE-049 (D-01): the component link — components carry their own meters and spares and roll up into the parent''s service history (self-reference floored here; ancestor cycles refused at write time) / رابط المكوّن — للمكونات عداداتها وقطعها وتُجمع في تاريخ الأصل الأب';

--> statement-breakpoint
-- ---------------------------------------------------------------------------
-- 2. §1 THE TEN PERMISSION KEYS + the role grants.
--> statement-breakpoint
INSERT INTO "permissions" ("key", "module", "description") VALUES
('assets.maintenance.view', 'assets', 'View maintenance work orders, their status machine and cost collectors / عرض أوامر الصيانة وحالاتها ومجمعات تكاليفها'),
('assets.maintenance.manage', 'assets', 'Manage work orders and drive the status machine (REQUESTED→…→COMPLETED) / إدارة أوامر الصيانة وتشغيل حالاتها'),
('assets.maintenance.plan', 'assets', 'Manage preventive plans and their checklists (BR-097/BR-098) / إدارة خطط الصيانة الوقائية وقوائم فحصها'),
('assets.meters.view', 'assets', 'View asset meters and the readings log / عرض عدادات الأصل وسجل القراءات'),
('assets.meters.record', 'assets', 'Record meter readings (MANUAL/JOB/IMPORT sources) / تسجيل قراءات العدادات'),
('assets.spares.manage', 'assets', 'Manage the per-asset spare-parts BOM (BR-099) / إدارة قائمة قطع الغيار لكل أصل'),
('assets.transfer.view', 'assets', 'View asset transfers and their approval ladder / عرض نقل الأصول وسلم موافقتها'),
('assets.transfer.approve', 'assets', 'Approve asset transfers (the G-61 gate — the NBV reclassification) / اعتماد نقل الأصول (بوابة G-61)'),
('assets.tags.manage', 'assets', 'Manage signed asset tags and their print sheets / إدارة بطاقات الأصول الموقعة وصفحات طباعتها'),
('assets.expiry.view', 'assets', 'View the warranty/insurance/license/inspection expiry registers / عرض سجلات انتهاء الضمان والتأمين والترخيص والفحص')
ON CONFLICT ("key") DO UPDATE
  SET "module" = EXCLUDED."module", "description" = EXCLUDED."description";
--> statement-breakpoint
INSERT INTO "role_permissions" ("role_id", "tenant_id", "permission_id")
SELECT r."id", NULL, p."key"
FROM "roles" r JOIN "permissions" p ON p."key" IN (
  'assets.maintenance.view', 'assets.maintenance.manage', 'assets.maintenance.plan',
  'assets.meters.view', 'assets.meters.record',
  'assets.spares.manage',
  'assets.transfer.view', 'assets.transfer.approve',
  'assets.tags.manage',
  'assets.expiry.view'
)
WHERE r."key" = 'owner' AND r."tenant_id" IS NULL
ON CONFLICT ("role_id", "permission_id") DO NOTHING;
--> statement-breakpoint
-- The accountant's finance-read plane (the two VIEW keys: the cost
-- collectors feed INV-034's GL reconciliation; the expiry registers are
-- the renewal liability) — the operational keys stay owner-only.
INSERT INTO "role_permissions" ("role_id", "tenant_id", "permission_id")
SELECT r."id", NULL, p."key"
FROM "roles" r JOIN "permissions" p ON p."key" IN (
  'assets.maintenance.view', 'assets.expiry.view'
)
WHERE r."key" = 'accountant' AND r."tenant_id" IS NULL
ON CONFLICT ("role_id", "permission_id") DO NOTHING;

--> statement-breakpoint
-- ---------------------------------------------------------------------------
-- 3. §2 THE PLAN GRANTS — business + enterprise carry the two flags;
--    STARTER stays at the DECLARED NEUTRAL ZERO (the tier-4 posture).
--> statement-breakpoint
UPDATE "plans" SET "feature_keys" = array_cat("feature_keys", ARRAY[
  'assets.maintenance', 'assets.transfer'
])
WHERE "key" IN ('business', 'enterprise')
  AND NOT ('assets.maintenance' = ANY("feature_keys"));

--> statement-breakpoint
-- ---------------------------------------------------------------------------
-- 4. §3 THE MANIFEST ENABLEMENT (D-11/D-16) — the FOUR CMMS-carrying
--    templates compose the two flags by default (guarded surgical
--    jsonb_set appends; the canonical templates.ts + the docs mirrors
--    move in this same W-16 increment — the coherent-change law).
--> statement-breakpoint
UPDATE "industry_templates"
SET "manifest" = jsonb_set(
  "manifest", '{required_feature_keys}',
  "manifest"->'required_feature_keys' || $cmms$[
    "assets.maintenance", "assets.transfer"
  ]$cmms$::jsonb
)
WHERE "key" = 'industry.automotive'
  AND NOT ("manifest"->'required_feature_keys' ? 'assets.maintenance');
--> statement-breakpoint
UPDATE "industry_templates"
SET "manifest" = jsonb_set(
  "manifest", '{required_feature_keys}',
  "manifest"->'required_feature_keys' || $cmms$[
    "assets.maintenance", "assets.transfer"
  ]$cmms$::jsonb
)
WHERE "key" = 'industry.rental_logistics'
  AND NOT ("manifest"->'required_feature_keys' ? 'assets.maintenance');
--> statement-breakpoint
UPDATE "industry_templates"
SET "manifest" = jsonb_set(
  "manifest", '{required_feature_keys}',
  "manifest"->'required_feature_keys' || $cmms$[
    "assets.maintenance", "assets.transfer"
  ]$cmms$::jsonb
)
WHERE "key" = 'industry.healthcare'
  AND NOT ("manifest"->'required_feature_keys' ? 'assets.maintenance');
--> statement-breakpoint
UPDATE "industry_templates"
SET "manifest" = jsonb_set(
  "manifest", '{required_feature_keys}',
  "manifest"->'required_feature_keys' || $cmms$[
    "assets.maintenance", "assets.transfer"
  ]$cmms$::jsonb
)
WHERE "key" = 'industry.food_manufacturing'
  AND NOT ("manifest"->'required_feature_keys' ? 'assets.maintenance');

--> statement-breakpoint
-- ---------------------------------------------------------------------------
-- 5. §4 THE CoA TEMPLATE MARKERS (the 0077 §6 additive pattern — D-04's
--    own dependency; existing tenants map once, fail-closed).
--> statement-breakpoint
INSERT INTO "chart_of_accounts_template" ("code", "name", "name_ar", "type", "is_group", "parent_code", "purpose_key") VALUES
  ('5310', 'Maintenance expense', 'مصروف الصيانة', 'EXPENSE', false, '5000', 'MAINTENANCE_EXPENSE'),
  ('2138', 'Labor clearing', 'تسوية أجور الصيانة', 'LIABILITY', false, '2100', 'LABOR_CLEARING'),
  ('2137', 'Accrued external services', 'خدمات خارجية مستحقة', 'LIABILITY', false, '2100', 'EXTERNAL_ACCRUAL')
ON CONFLICT ("code") DO UPDATE
  SET "name" = EXCLUDED."name", "name_ar" = EXCLUDED."name_ar",
      "type" = EXCLUDED."type", "is_group" = EXCLUDED."is_group",
      "parent_code" = EXCLUDED."parent_code", "purpose_key" = EXCLUDED."purpose_key";

--> statement-breakpoint
RESET ROLE;

--> statement-breakpoint
-- Schema-state marker for /health/ready (mirrors the migration manifest).
INSERT INTO erp._schema_state (key, value) VALUES ('schema_version', 108)
ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, at = now();
