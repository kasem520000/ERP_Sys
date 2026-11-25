-- PHASE-051 (Blueprint v3.0 · CR-21 — Foreign Trade & Logistics) ·
-- migration 0122 · THE SHIPMENTS TABLE + THE DATA-ONLY GRANTS BLOCK +
-- THE INCOTERMS/HS STARTER SEEDS (T-04, the approved master plan's
-- D-02 slot 4: shipment_tracking_events — the carrier milestone log
-- per shipment: booked → departed → arrived → cleared → delivered, the
-- document links it drives + the 0098/0103/0108/0116 grants pattern +
-- the Incoterms-2020/HS starter seeds with the accuracy disclaimer).
--
--   §1 shipment_tracking_events (L-11, D-14): the carrier milestone
--     log per shipment — one row per event, anchored on the bill of
--     lading (the declared interpretation of 0120 §2: the B/L IS the
--     shipment's identity; bill_of_lading_id NOT NULL), the milestone
--     vocabulary at the floor, and the OPTIONAL declaration link (the
--     customs leg the event drives — the fold applies to the linked
--     B/L + the packing lists under it + the event's linked
--     declaration). THE MONOTONE LADDER is W-36's pure module with
--     its property tests (an event never regresses a document's
--     status; the unknown-event typed refusal); this table is only
--     the append-only log. Evidence: S/I/U, NO DELETE.
--   §2 THE ENTITLEMENTS KEY-SHAPE WIDENING (the 0116 §7 precedent's
--     own class, applied in advance this time — the 050 W-24 honest
--     catch's lesson): the business-plan materialization inserts the
--     plan's feature_keys as entitlements, and 0006's
--     ck_entitlements_feature_key_shape admits exactly one whole-
--     module key (quality, the 050 amendment) — the bare `trade` key
--     would refuse the ENTIRE provisioning path. The additive
--     DROP+ADD widening (the 0023/0051/0111 pattern) admits EXACTLY
--     the one additional whole-module key, mirroring the manifest
--     schema's dated PHASE-051 amendment in packages/contracts
--     (INDUSTRY_FEATURE_KEY_PATTERN: every cataloged module keeps
--     module.feature; exactly TWO additional strings match — quality
--     and trade — no wider).
--   §3 THE TEN PERMISSION KEYS + the role grants (matrix §3.29; the
--     drift 347 → 357 — zero-drift from the first increment, seed =
--     mirror): the owner template holds all ten; the accountant the
--     ONE finance-read key (trade.view — the G-64/G-65 GL
--     reconciliation's read plane; the operational keys stay
--     owner-only).
--   §4 THE PLAN GRANTS (the tier-4 precedent — THE DECLARED NEUTRAL
--     ZERO): business + enterprise carry the THREE FEATURE FLAGS —
--     trade · trade.lc · trade.customs (the phase doc's composable
--     units, CR-36f, D-04). STARTER GETS NONE (foreign trade is not a
--     starter feature; zero starter keys move, nothing silent).
--   §5 THE MANIFEST ENABLEMENT (D-04 — CR-36f template-composable):
--     the THREE trade-carrying templates — wholesale,
--     distribution, electronics — compose all three flags by
--     default. THE COHERENT-CHANGE LAW (the 0098 §3 procedure): the
--     canonical templates.ts + THIS stored-registry update + the docs
--     mirrors move together in the same increment (W-33) — the
--     guarded one-field jsonb_set appends (zero transcription risk).
--   §6 THE SEEDS — the Incoterms-2020 set (11 rules) + the HS starter
--     set (14 chapter-level headings), tenant-extensible DATA for
--     every EXISTING tenant through the 0098 §4 migration-plane gate
--     (created + self-dropped in this file; crash-safe both sides;
--     the final policy set is EXACTLY the pre-0122 set). THE ACCURACY
--     DISCLAIMER (D-16, the BR-055 family — the owner's «البذور
--     بإقرار الدقة» order): every starter row carries it — the
--     tenant owns the final classification; a missing HS code is
--     MISSING, never invented; NO duty rates anywhere on the seeds
--     (the rates live on the declaration lines as tenant DATA, the
--     phase doc §7's own mitigation). New tenants: the W-35 registry
--     wave's onboarding materialization (one source, both paths —
--     the 0098 competency-scale precedent's own shape).
--   §7 THE TWO CoA TEMPLATE MARKERS (the 0077 §6 additive pattern —
--     D-05/D-06's own dependencies: the G-64 DR leg and the G-65/G-66
--     CR leg must RESOLVE, and new tenants map once, fail-closed):
--     LC_MARGIN_DEPOSIT (1180 — the margin deposit asset, G-64's DR
--     leg at issuance, reversed at retirement) · CUSTOMS_DUTY_PAYABLE
--     (2145 — the customs duty payable, G-65's CR leg in the
--     landed-cost allocation AND G-66's CR leg at the bonded release
--     — the same liability, the plan's own law). Both existing-tenant
--     mappings land at the engine waves (fail-closed until mapped).
--
--   THE D-02 DISCLOSURE (the standing law — this provision's final
--     expected fingerprint, the wave's envelope): the chain 121 → 122
--     · ENTITY_CATALOG 353 → 354 (this migration's +1; the four
--     slots' +14 together: 340 → 354) · the permissions drift 347 →
--     357 (the +10 keys, D-03 — zero-drift from the first increment)
--     · ROUTE_PERMISSIONS 1,159 → 1,159 UNCHANGED (keys-seed-first,
--     the 0116 §1 precedent — zero routes before the W-34+ service
--     waves; the matrix's dated note records it).
--
--   Ledger-free by design (D-09's sweep is W-34's; G-64/G-65/G-66
--     post through the REAL engine at W-34/W-37/W-38 — the canon
--     rows are W-42's).

--> statement-breakpoint
SET ROLE erp_migrate;

--> statement-breakpoint
-- ---------------------------------------------------------------------------
-- 1. shipment_tracking_events (L-11, D-14 — the carrier milestone log
--    per shipment, anchored on the B/L).
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "shipment_tracking_events" (
  "id" uuid NOT NULL,
  "tenant_id" uuid NOT NULL REFERENCES "tenants" ("id") ON DELETE RESTRICT,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "updated_at" timestamptz NOT NULL DEFAULT now(),
  "version" integer NOT NULL DEFAULT 1,
  "created_by" uuid,
  "updated_by" uuid,
  "bill_of_lading_id" uuid NOT NULL,
  "declaration_id" uuid,
  "milestone" text NOT NULL,
  "event_at" timestamptz NOT NULL,
  "carrier_ref" text,
  "location" text,
  "note" text,
  "note_ar" text,
  CONSTRAINT pk_shipment_tracking_events PRIMARY KEY ("id"),
  CONSTRAINT uq_shipment_tracking_events_id_tenant UNIQUE ("id", "tenant_id"),
  CONSTRAINT fk_shipment_tracking_events_bl
    FOREIGN KEY ("bill_of_lading_id", "tenant_id")
    REFERENCES "bills_of_lading" ("id", "tenant_id") ON DELETE RESTRICT,
  CONSTRAINT fk_shipment_tracking_events_declaration
    FOREIGN KEY ("declaration_id", "tenant_id")
    REFERENCES "customs_declarations" ("id", "tenant_id") ON DELETE RESTRICT,
  -- THE MILESTONE VOCABULARY (the carrier ladder — booked → departed →
  -- arrived → cleared → delivered; the monotone law itself is W-36's
  -- pure fold with its property tests, this floor keeps the words).
  CONSTRAINT ck_shipment_tracking_events_milestone
    CHECK ("milestone" IN ('BOOKED', 'DEPARTED', 'ARRIVED', 'CLEARED', 'DELIVERED'))
);

--> statement-breakpoint
CREATE INDEX IF NOT EXISTS ix_shipment_tracking_events_tenant_bl
  ON "shipment_tracking_events" ("tenant_id", "bill_of_lading_id", "event_at");
--> statement-breakpoint
-- OA-06's own anchor (the W-41 budgets probe the tracking-events
-- statement's stable plan: the tenant+BL index-driven law).
CREATE INDEX IF NOT EXISTS ix_shipment_tracking_events_tenant_declaration
  ON "shipment_tracking_events" ("tenant_id", "declaration_id")
  WHERE "declaration_id" IS NOT NULL;

--> statement-breakpoint
-- ---------------------------------------------------------------------------
-- 2. RLS — the A1–A10 family over the table.
--> statement-breakpoint
ALTER TABLE "shipment_tracking_events" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "shipment_tracking_events" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
SELECT erp.apply_tenant_policy('"shipment_tracking_events"');
--> statement-breakpoint
DO $$
DECLARE
  t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['shipment_tracking_events'] LOOP
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
-- 3. Grants — the evidence discipline (the tracking log is append-only
--    history).
--> statement-breakpoint
REVOKE ALL ON "shipment_tracking_events" FROM erp_app;
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE ON "shipment_tracking_events" TO erp_app;
--> statement-breakpoint
GRANT SELECT ON "shipment_tracking_events" TO erp_readonly;
--> statement-breakpoint
GRANT SELECT ON "shipment_tracking_events" TO erp_definer;

--> statement-breakpoint
COMMENT ON TABLE "shipment_tracking_events" IS 'PHASE-051 (L-11, T-04, D-14): the carrier milestone log per shipment (anchored on the bill of lading — the shipment''s identity) — the append-only event store the tracking fold reads (the monotone ladder, the document-status drive) / سجل أحداث تتبع الشحنة: الوقائع اللوجستية التي يقرؤها طيّ الحالة';
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS ix_shipment_tracking_events_tenant_event_at
  ON "shipment_tracking_events" ("tenant_id", "event_at");

--> statement-breakpoint
-- ---------------------------------------------------------------------------
-- 4. THE ENTITLEMENTS KEY-SHAPE WIDENING (the 0116 §7 additive pattern,
--    the 050 W-24 honest catch's class applied in advance — the bare
--    `trade` plan key would otherwise 23514 the provisioning path).
--> statement-breakpoint
ALTER TABLE "entitlements" DROP CONSTRAINT IF EXISTS ck_entitlements_feature_key_shape;
--> statement-breakpoint
ALTER TABLE "entitlements" ADD CONSTRAINT ck_entitlements_feature_key_shape
  CHECK (
    "feature_key" ~ '^[a-z][a-z0-9_]*(\.[a-z][a-z0-9_]*){1,2}$'
    OR "feature_key" IN ('quality', 'trade')
  );

--> statement-breakpoint
-- ---------------------------------------------------------------------------
-- 5. THE DATA-ONLY GRANTS BLOCK (the 0098/0103/0108/0116 pattern) —
--    (a) the ten permission keys + the role grants.
--> statement-breakpoint
INSERT INTO "permissions" ("key", "module", "description") VALUES
('trade.view', 'trade', 'View the trade plane: the LC/collections registers, declarations, transport documents, certificates, tracking (the finance-read plane) / عرض مستوى التجارة: الاعتمادات والتحصيل والإقرارات والمستندات والتتبع'),
('trade.lc.view', 'trade', 'View the letters of credit register with amendments and the documents checklist / عرض سجل الاعتمادات المستندية وتعديلاتها وقائمة مستنداتها'),
('trade.lc.manage', 'trade', 'Manage the LC lifecycle: issue, amend, the documents checklist, retire — firing the G-64 margin/retirement postings / إدارة دورة الاعتماد وإصداره وتعديله وتسويته وتشغيل قيود G-64'),
('trade.collections.manage', 'trade', 'Manage the documentary collections (D/P and D/A) with the settlement linkage / إدارة التحصيل المستندي وربط التسوية'),
('trade.customs.view', 'trade', 'View the customs declarations register with the lines and the duty figures / عرض سجل الإقرارات الجمركية وسطورها وأرقام الرسوم'),
('trade.customs.manage', 'trade', 'Manage the declarations and lines — the duty computation into the landed costs (G-65, INV-036) / إدارة الإقرارات وحساب الرسوم في التكاليف الأرضية'),
('trade.shipments.view', 'trade', 'View the transport documents and the shipment tracking board / عرض مستندات النقل ولوحة تتبع الشحنات'),
('trade.shipments.manage', 'trade', 'Manage the bills of lading, packing lists, certificates and the tracking events / إدارة بوالص الشحن وقوائم التعبئة والشهادات وأحداث التتبع'),
('trade.bonded.manage', 'trade', 'Manage the bonded warehouse moves — the in-bond transfers and the releases (G-66/BR-107) / إدارة حركات المستودع الجمركي والإفراج'),
('trade.drawback.manage', 'trade', 'Manage the duty drawback claims (BR-108''s export-evidence gate) / إدارة طلبات استرداد الرسوم')
ON CONFLICT ("key") DO UPDATE
  SET "module" = EXCLUDED."module", "description" = EXCLUDED."description";
--> statement-breakpoint
INSERT INTO "role_permissions" ("role_id", "tenant_id", "permission_id")
SELECT r."id", NULL, p."key"
FROM "roles" r JOIN "permissions" p ON p."key" IN (
  'trade.view', 'trade.lc.view', 'trade.lc.manage', 'trade.collections.manage',
  'trade.customs.view', 'trade.customs.manage', 'trade.shipments.view',
  'trade.shipments.manage', 'trade.bonded.manage', 'trade.drawback.manage'
)
WHERE r."key" = 'owner' AND r."tenant_id" IS NULL
ON CONFLICT ("role_id", "permission_id") DO NOTHING;
--> statement-breakpoint
-- The accountant's finance-read plane (the 0116 single-read-key
-- precedent): the LC and declaration registers feed the G-64/G-65 GL
-- reconciliation's read plane; the operational keys stay owner-only.
INSERT INTO "role_permissions" ("role_id", "tenant_id", "permission_id")
SELECT r."id", NULL, p."key"
FROM "roles" r JOIN "permissions" p ON p."key" IN (
  'trade.view'
)
WHERE r."key" = 'accountant' AND r."tenant_id" IS NULL
ON CONFLICT ("role_id", "permission_id") DO NOTHING;

--> statement-breakpoint
-- ---------------------------------------------------------------------------
-- 6. §5(b) THE PLAN GRANTS — business + enterprise carry the three
--    flags; STARTER stays at THE DECLARED NEUTRAL ZERO.
--> statement-breakpoint
UPDATE "plans" SET "feature_keys" = array_cat("feature_keys", ARRAY[
  'trade', 'trade.lc', 'trade.customs'
])
WHERE "key" IN ('business', 'enterprise')
  AND NOT ('trade' = ANY("feature_keys"));

--> statement-breakpoint
-- ---------------------------------------------------------------------------
-- 7. §5(c) THE MANIFEST ENABLEMENT (D-04 — CR-36f template-composable):
--    the THREE trade-carrying templates compose all three flags by
--    default (guarded surgical jsonb_set appends; the canonical
--    templates.ts + the docs mirrors move in this same W-33
--    increment — the coherent-change law).
--> statement-breakpoint
UPDATE "industry_templates"
SET "manifest" = jsonb_set(
  "manifest", '{required_feature_keys}',
  "manifest"->'required_feature_keys' || $trade$[
    "trade", "trade.lc", "trade.customs"
  ]$trade$::jsonb
)
WHERE "key" = 'industry.wholesale'
  AND NOT ("manifest"->'required_feature_keys' ? 'trade');
--> statement-breakpoint
UPDATE "industry_templates"
SET "manifest" = jsonb_set(
  "manifest", '{required_feature_keys}',
  "manifest"->'required_feature_keys' || $trade$[
    "trade", "trade.lc", "trade.customs"
  ]$trade$::jsonb
)
WHERE "key" = 'industry.distribution'
  AND NOT ("manifest"->'required_feature_keys' ? 'trade');
--> statement-breakpoint
UPDATE "industry_templates"
SET "manifest" = jsonb_set(
  "manifest", '{required_feature_keys}',
  "manifest"->'required_feature_keys' || $trade$[
    "trade", "trade.lc", "trade.customs"
  ]$trade$::jsonb
)
WHERE "key" = 'industry.electronics'
  AND NOT ("manifest"->'required_feature_keys' ? 'trade');

--> statement-breakpoint
-- ---------------------------------------------------------------------------
-- 8. §7 THE TWO CoA TEMPLATE MARKERS (the 0077 §6 additive pattern —
--     D-05/D-06's own dependencies; existing tenants map once at the
--     engine waves, fail-closed until then):
--     · LC_MARGIN_DEPOSIT (1180, under 1150 Other current assets) —
--       G-64's DR leg at issuance (reversed at retirement against the
--       tenant's chosen bank account — the landed-cost charge-account
--       discipline's own shape);
--     · CUSTOMS_DUTY_PAYABLE (2145, under 2100 Current liabilities) —
--       G-65's CR leg in the landed-cost allocation AND G-66's CR leg
--       at the bonded release (the same liability both rungs — the
--       plan's own law, D-06/D-08).
--> statement-breakpoint
INSERT INTO "chart_of_accounts_template" ("code", "name", "name_ar", "type", "is_group", "parent_code", "purpose_key") VALUES
  ('1180', 'LC margin deposit', 'هامش الاعتماد المستندي', 'ASSET', false, '1150', 'LC_MARGIN_DEPOSIT'),
  ('2145', 'Customs duty payable', 'الرسوم الجمركية المستحقة', 'LIABILITY', false, '2100', 'CUSTOMS_DUTY_PAYABLE')
ON CONFLICT ("code") DO UPDATE
  SET "name" = EXCLUDED."name", "name_ar" = EXCLUDED."name_ar",
      "type" = EXCLUDED."type", "is_group" = EXCLUDED."is_group",
      "parent_code" = EXCLUDED."parent_code", "purpose_key" = EXCLUDED."purpose_key";

--> statement-breakpoint
-- ---------------------------------------------------------------------------
-- 9. §6 THE SEEDS — the Incoterms-2020 set + the HS starter set, for
--    every EXISTING tenant through the 0098 §4 migration-plane gate
--    (created + self-dropped here; crash-safe both sides; the final
--    policy set is EXACTLY the pre-0122 set). THE ACCURACY DISCLAIMER
--    rides every starter row (D-16 — «البذور بإقرار الدقة»: the
--    tenant owns the final classification; a missing HS code is
--    MISSING, never invented; NO duty rates on the seeds — the rates
--    live on the declaration lines as tenant DATA). New tenants: the
--    W-35 registry wave's onboarding materialization (one source, both
--    paths).
--> statement-breakpoint
DROP POLICY IF EXISTS migration_plane_select ON "tenants";
--> statement-breakpoint
CREATE POLICY migration_plane_select ON "tenants"
  FOR SELECT TO erp_migrate USING (true);
--> statement-breakpoint
DROP POLICY IF EXISTS migration_plane_insert ON "incoterms";
--> statement-breakpoint
DROP POLICY IF EXISTS migration_plane_insert ON "hs_code_registry";
--> statement-breakpoint
-- The 0094 gate shape (FOR ALL + USING + WITH CHECK, both true — the
-- proven shape under INSERT … SELECT … ON CONFLICT).
CREATE POLICY migration_plane_insert ON "incoterms"
  FOR ALL TO erp_migrate USING (true) WITH CHECK (true);
--> statement-breakpoint
CREATE POLICY migration_plane_insert ON "hs_code_registry"
  FOR ALL TO erp_migrate USING (true) WITH CHECK (true);
--> statement-breakpoint
-- THE INCOTERMS-2020 SET (11 rules — the ICC 2020 edition's own
-- ownership matrix as registry DATA: carriage · insurance · export
-- clearance · import clearance · import duty, the seller side; the
-- disclaimer on every row).
INSERT INTO "incoterms"
  ("id", "tenant_id", "code", "name", "name_ar",
   "carriage_by_seller", "insurance_by_seller",
   "export_clearance_by_seller", "import_clearance_by_seller",
   "import_duty_by_seller", "note")
SELECT gen_random_uuid(), t."id", s."code", s."name", s."name_ar",
       s."carriage", s."insurance", s."export_clearance",
       s."import_clearance", s."import_duty", s."disclaimer"
FROM "tenants" t
CROSS JOIN (VALUES
  ('EXW', 'Ex Works', 'تسليم المصنع',
    false, false, false, false, false,
    'STARTER SET (Incoterms 2020) — the tenant owns the final applicability; verify against the contract and jurisdiction before use / مجموعة استهلالية (إنكوترمز 2020) — التحقق من الملاءمة النهائية مسؤولية المستأجر'),
  ('FCA', 'Free Carrier', 'تسليم للناقل',
    false, false, true, false, false,
    'STARTER SET (Incoterms 2020) — the tenant owns the final applicability; verify against the contract and jurisdiction before use / مجموعة استهلالية (إنكوترمز 2020) — التحقق من الملاءمة النهائية مسؤولية المستأجر'),
  ('FAS', 'Free Alongside Ship', 'تسليم بجانب السفينة',
    false, false, true, false, false,
    'STARTER SET (Incoterms 2020) — the tenant owns the final applicability; verify against the contract and jurisdiction before use / مجموعة استهلالية (إنكوترمز 2020) — التحقق من الملاءمة النهائية مسؤولية المستأجر'),
  ('FOB', 'Free on Board', 'تسليم على متن السفينة',
    false, false, true, false, false,
    'STARTER SET (Incoterms 2020) — the tenant owns the final applicability; verify against the contract and jurisdiction before use / مجموعة استهلالية (إنكوترمز 2020) — التحقق من الملاءمة النهائية مسؤولية المستأجر'),
  ('CFR', 'Cost and Freight', 'التكلفة والنولون',
    true, false, true, false, false,
    'STARTER SET (Incoterms 2020) — the tenant owns the final applicability; verify against the contract and jurisdiction before use / مجموعة استهلالية (إنكوترمز 2020) — التحقق من الملاءمة النهائية مسؤولية المستأجر'),
  ('CIF', 'Cost, Insurance and Freight', 'التكلفة والتأمين والنولون',
    true, true, true, false, false,
    'STARTER SET (Incoterms 2020) — the tenant owns the final applicability; verify against the contract and jurisdiction before use / مجموعة استهلالية (إنكوترمز 2020) — التحقق من الملاءمة النهائية مسؤولية المستأجر'),
  ('CPT', 'Carriage Paid To', 'النولون مدفوع إلى',
    true, false, true, false, false,
    'STARTER SET (Incoterms 2020) — the tenant owns the final applicability; verify against the contract and jurisdiction before use / مجموعة استهلالية (إنكوترمز 2020) — التحقق من الملاءمة النهائية مسؤولية المستأجر'),
  ('CIP', 'Carriage and Insurance Paid To', 'النولون والتأمين مدفوعان إلى',
    true, true, true, false, false,
    'STARTER SET (Incoterms 2020) — the tenant owns the final applicability; verify against the contract and jurisdiction before use / مجموعة استهلالية (إنكوترمز 2020) — التحقق من الملاءمة النهائية مسؤولية المستأجر'),
  ('DPU', 'Delivered at Place Unloaded', 'التسليم مع التفريغ مدفوعة',
    true, false, true, false, false,
    'STARTER SET (Incoterms 2020) — the tenant owns the final applicability; verify against the contract and jurisdiction before use / مجموعة استهلالية (إنكوترمز 2020) — التحقق من الملاءمة النهائية مسؤولية المستأجر'),
  ('DAP', 'Delivered at Place', 'التسليم في المكان',
    true, false, true, false, false,
    'STARTER SET (Incoterms 2020) — the tenant owns the final applicability; verify against the contract and jurisdiction before use / مجموعة استهلالية (إنكوترمز 2020) — التحقق من الملاءمة النهائية مسؤولية المستأجر'),
  ('DDP', 'Delivered Duty Paid', 'التسليم الرسوم مدفوعة',
    true, false, true, true, true,
    'STARTER SET (Incoterms 2020) — the tenant owns the final applicability; verify against the contract and jurisdiction before use / مجموعة استهلالية (إنكوترمز 2020) — التحقق من الملاءمة النهائية مسؤولية المستأجر')
) AS s("code", "name", "name_ar", "carriage", "insurance",
       "export_clearance", "import_clearance", "import_duty", "disclaimer")
ON CONFLICT ("tenant_id", "code") DO NOTHING;
--> statement-breakpoint
-- THE HS STARTER SET (14 chapter-level headings of the international
-- Harmonized System — stable public scaffolding, the classification's
-- own top level; the disclaimer on every row; NO duty rates, ever).
INSERT INTO "hs_code_registry"
  ("id", "tenant_id", "hs_code", "name", "name_ar", "note")
SELECT gen_random_uuid(), t."id", s."hs_code", s."name", s."name_ar",
       'STARTER SET (HS chapter level) — REQUIRES_VERIFICATION: the tenant owns the final classification (HS edition and jurisdiction); a missing code is MISSING, never invented / مجموعة استهلالية (مستوى الفصول) — التصنيف النهائي مسؤولية المستأجر'
FROM "tenants" t
CROSS JOIN (VALUES
  ('03', 'Fish, crustaceans, molluscs, aquatic invertebrates', 'الأسماك والقشريات والرخويات واللافقاريات المائية'),
  ('08', 'Edible fruit and nuts; citrus peel', 'الفواكه والمكسرات الصالحة للأكل وقشور الحمضيات'),
  ('10', 'Cereals', 'الحبوب'),
  ('27', 'Mineral fuels, mineral oils and products', 'الوقود المعدني والزيوت المعدنية ومنتجاتها'),
  ('30', 'Pharmaceutical products', 'المنتجات الصيدلانية'),
  ('39', 'Plastics and articles thereof', 'اللدائن ومنتجاتها'),
  ('40', 'Rubber and articles thereof', 'المطاط ومنتجاته'),
  ('52', 'Cotton', 'القطن'),
  ('61', 'Apparel, knitted or crocheted', 'الملابس المحبوكة أو المزركشة'),
  ('62', 'Apparel, not knitted or crocheted', 'الملابس غير المحبوكة'),
  ('72', 'Iron and steel', 'الحديد والفولاذ'),
  ('84', 'Machinery and mechanical appliances', 'الآلات والأجهزة الميكانيكية'),
  ('85', 'Electrical machinery and equipment', 'الآلات والأجهزة الكهربائية'),
  ('87', 'Vehicles other than railway rolling stock', 'المركبات عدا عربات السكك الحديدية')
) AS s("hs_code", "name", "name_ar")
ON CONFLICT ("tenant_id", "hs_code") DO NOTHING;
--> statement-breakpoint
DROP POLICY IF EXISTS migration_plane_insert ON "incoterms";
--> statement-breakpoint
DROP POLICY IF EXISTS migration_plane_insert ON "hs_code_registry";
--> statement-breakpoint
DROP POLICY IF EXISTS migration_plane_select ON "tenants";

--> statement-breakpoint
RESET ROLE;

--> statement-breakpoint
-- Schema-state marker for /health/ready (mirrors the migration manifest).
INSERT INTO erp._schema_state (key, value) VALUES ('schema_version', 122)
ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, at = now();
