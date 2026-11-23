-- PHASE-050 (Blueprint v3.0 · CR-20 — QMS) · migration 0116 · THE
-- HOLDS/RECALL/REVIEW/HAZARD CLUSTER + THE DATA-ONLY GRANTS BLOCK
-- (T-04, the plan's D-02 slot 4: batch_quality_holds — hold/release
-- with reason + disposition link · recall_registry — the drill's
-- record · quality_management_reviews — the meeting record + the
-- indicator pack · hazard_registers — HACCP hazards/CCPs/critical
-- limits/monitoring · THE DATA-ONLY grants block — the 0098/0103/0108
-- pattern).
--
--   §1 batch_quality_holds (Q-09): the INV-035/BR-101 substrate —
--     hold/release with the reason and the disposition link; THE
--     PARTIAL UNIQUE (one ACTIVE hold per batch) is the blocking
--     validation service's own index (the service is the ONLY gate,
--     D-07 — it wires into every issue/ship path at W-28); release
--     requires the disposition-linked record (the ncr link + the note,
--     both NOT NULL on the RELEASED path — the DB floor of BR-101).
--     Evidence: S/I/U, NO DELETE (the hold history is the INV-035
--     audit trail).
--   §2 recall_registry (Q-09/Q-12): the drill's RECORD (distinct from
--     the drill's live QUERY — D-14): the initiated/executed/closed
--     ladder with the frozen scope + affected-customers snapshots at
--     execution. Evidence: S/I/U, NO DELETE.
--   §3 quality_management_reviews (Q-10): the meeting record + the
--     indicator pack (NCR/CAPA/complaint/SPC status — the engines'
--     own reads frozen at the meeting, zero recomputation — D-15) +
--     decisions. Evidence: S/I/U, NO DELETE.
--   §4 hazard_registers (Q-11): the HACCP-style hazards/CCPs/critical
--     limits/monitoring — TEMPLATE-COMPOSABLE (composed by the
--     food-manufacturing template's manifest, never hardcoded
--     checklists — D-15; the tenant owns the critical-limits
--     structure). Master data: S/I/U/D.
--   §5 THE DATA-ONLY GRANTS BLOCK (the 0098/0103/0108 pattern):
--     (a) THE TEN PERMISSION KEYS (matrix §3.28; the drift 337 → 347,
--     zero-drift from the first increment — D-03): quality.view ·
--     quality.manage · quality.ncr.manage · quality.capa.manage ·
--     quality.calibration.manage · quality.spc.view ·
--     quality.complaints.manage · quality.coa.generate ·
--     quality.hold.manage · quality.recall.manage. Role grants (the
--     0103/0108 precedent): the owner template holds ALL TEN; the
--     accountant holds the ONE finance-read key (quality.view — the
--     NCR/CAPA registers feed the G-62/G-63 GL reconciliation's read
--     plane); the operational keys stay owner-only.
--     (b) THE PLAN GRANTS (the tier-4 precedent — THE DECLARED NEUTRAL
--     ZERO): business + enterprise carry the TWO FEATURE FLAGS —
--     quality · quality.spc (the phase doc's composable units, CR-36f,
--     D-04). STARTER GETS NEITHER (the QMS plane is not a starter
--     feature; zero starter keys move, nothing silent). The ten
--     permission keys are the AUTHORIZATION surface and ride ROLES
--     (§5a) — never the plans (matrix §3.28's dated note records the
--     divergence, the §3.26/§3.27 precedent).
--     (c) THE MANIFEST ENABLEMENT (D-04 — CR-36f template-composable):
--     the FOUR quality-carrying templates — food_manufacturing,
--     agriculture, healthcare, electronics — compose `quality` by
--     default; food_manufacturing + electronics additionally compose
--     `quality.spc`. THE COHERENT-CHANGE LAW (the 0098 §3 procedure):
--     the canonical templates.ts + THIS stored-registry update + the
--     docs mirrors move together in the same increment (W-24) — the
--     guarded one-field jsonb_set appends (zero transcription risk;
--     the canonical-JSON hash the effective-config layer computes is
--     order-and-whitespace blind at the object level — deterministic,
--     zero wall-clock input anywhere in the manifest).
--     (d) THE CoA TEMPLATE MARKER (the 0077 §6 additive pattern —
--     D-06's own dependency: the G-63 purpose must RESOLVE, and new
--     tenants materialize the template at onboarding): QUALITY_EXPENSE
--     (5320, the expense family). The G-63 credit leg rides the
--     EXISTING EXTERNAL_ACCRUAL marker (2137 — the 049 G-59 external
--     leg's own shape, no new marker); the G-62 write-off pair rides
--     the EXISTING INVENTORY_SHRINKAGE + per-warehouse INVENTORY
--     purposes (the 044 valuation-ledger precedent, no new markers).
--     Existing tenants map their own accounts fail-closed
--     (PURPOSE_NOT_MAPPED until then — the 0037/0077 discipline).
--
--   THE D-02 DISCLOSURE (the standing law — the WAVE'S OWN FINAL
--     EXPECTED FINGERPRINT, announced in the wave's envelope): the
--     chain 112 → 116 · ENTITY_CATALOG 328 → 340 (the four slots' +12
--     together: 0113's +2 · 0114's +3 · 0115's +3 · this migration's
--     +4) · the permissions drift 337 → 347 (the +10 keys, D-03 —
--     zero-drift from the first increment, seed = mirror) ·
--     ROUTE_PERMISSIONS 1,102 UNCHANGED (keys-seed-first: the keys
--     bind as the W-25+ API waves ship, every change dated at the
--     block — the 1,102 baseline anchor) · the two feature flags
--     (quality · quality.spc) + the template manifest enablements
--     landing with the keys.

--> statement-breakpoint
SET ROLE erp_migrate;

--> statement-breakpoint
-- ---------------------------------------------------------------------------
-- 1. batch_quality_holds (Q-09 — INV-035/BR-101's substrate).
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "batch_quality_holds" (
  "id" uuid NOT NULL,
  "tenant_id" uuid NOT NULL REFERENCES "tenants" ("id") ON DELETE RESTRICT,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "updated_at" timestamptz NOT NULL DEFAULT now(),
  "version" integer NOT NULL DEFAULT 1,
  "created_by" uuid,
  "updated_by" uuid,
  "batch_id" uuid NOT NULL,
  "reason" text NOT NULL,
  "ncr_id" uuid,
  "status" text NOT NULL DEFAULT 'ACTIVE',
  "held_at" timestamptz NOT NULL DEFAULT now(),
  "released_at" timestamptz,
  "release_note" text,
  "note" text,
  "note_ar" text,
  CONSTRAINT pk_batch_quality_holds PRIMARY KEY ("id"),
  CONSTRAINT uq_batch_quality_holds_id_tenant UNIQUE ("id", "tenant_id"),
  CONSTRAINT fk_batch_quality_holds_batch
    FOREIGN KEY ("batch_id", "tenant_id")
    REFERENCES "item_batches" ("id", "tenant_id") ON DELETE RESTRICT,
  CONSTRAINT fk_batch_quality_holds_ncr
    FOREIGN KEY ("ncr_id", "tenant_id")
    REFERENCES "ncr_records" ("id", "tenant_id") ON DELETE RESTRICT,
  CONSTRAINT ck_batch_quality_holds_status
    CHECK ("status" IN ('ACTIVE', 'RELEASED')),
  -- BR-101's floor: ACTIVE carries no release stamps; RELEASED carries
  -- exactly the release pair + THE DISPOSITION LINK (the ncr whose
  -- disposition justifies the release — release requires the
  -- disposition-linked record).
  CONSTRAINT ck_batch_quality_holds_release_shape
    CHECK (
      ("status" = 'ACTIVE' AND "released_at" IS NULL AND "release_note" IS NULL)
      OR ("status" = 'RELEASED' AND "released_at" IS NOT NULL
           AND "release_note" IS NOT NULL AND "ncr_id" IS NOT NULL)
    )
);

--> statement-breakpoint
-- THE ONE-ACTIVE-HOLD-PER-BATCH law (the blocking validation service's
-- own index — the service is the ONLY gate, D-07; this partial unique
-- keeps the gate's read single-row).
CREATE UNIQUE INDEX IF NOT EXISTS uq_batch_quality_holds_tenant_batch_active
  ON "batch_quality_holds" ("tenant_id", "batch_id")
  WHERE "status" = 'ACTIVE';
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS ix_batch_quality_holds_tenant_batch
  ON "batch_quality_holds" ("tenant_id", "batch_id", "status");

--> statement-breakpoint
-- ---------------------------------------------------------------------------
-- 2. recall_registry (Q-09/Q-12 — the drill's record; the drill's live
--    query is the W-28 service on the batch/serial ledger — D-14).
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "recall_registry" (
  "id" uuid NOT NULL,
  "tenant_id" uuid NOT NULL REFERENCES "tenants" ("id") ON DELETE RESTRICT,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "updated_at" timestamptz NOT NULL DEFAULT now(),
  "version" integer NOT NULL DEFAULT 1,
  "created_by" uuid,
  "updated_by" uuid,
  "recall_no" text NOT NULL,
  "batch_id" uuid NOT NULL,
  "reason" text NOT NULL,
  "status" text NOT NULL DEFAULT 'INITIATED',
  "initiated_at" timestamptz NOT NULL DEFAULT now(),
  "executed_at" timestamptz,
  "closed_at" timestamptz,
  "scope" jsonb,
  "affected_customers" jsonb,
  "note" text,
  "note_ar" text,
  CONSTRAINT pk_recall_registry PRIMARY KEY ("id"),
  CONSTRAINT uq_recall_registry_id_tenant UNIQUE ("id", "tenant_id"),
  CONSTRAINT uq_recall_registry_tenant_no UNIQUE ("tenant_id", "recall_no"),
  CONSTRAINT fk_recall_registry_batch
    FOREIGN KEY ("batch_id", "tenant_id")
    REFERENCES "item_batches" ("id", "tenant_id") ON DELETE RESTRICT,
  CONSTRAINT ck_recall_registry_status
    CHECK ("status" IN ('INITIATED', 'EXECUTED', 'CLOSED')),
  CONSTRAINT ck_recall_registry_scope_shape
    CHECK ("scope" IS NULL OR jsonb_typeof("scope") = 'array'),
  CONSTRAINT ck_recall_registry_customers_shape
    CHECK ("affected_customers" IS NULL OR jsonb_typeof("affected_customers") = 'array'),
  -- The ladder's stamp law: INITIATED carries no execution; EXECUTED
  -- exactly the execution stamp; CLOSED both. The frozen snapshots
  -- exist only on the executed paths (the drill's own record).
  CONSTRAINT ck_recall_registry_stamps
    CHECK (
      ("status" = 'INITIATED' AND "executed_at" IS NULL AND "closed_at" IS NULL)
      OR ("status" = 'EXECUTED' AND "executed_at" IS NOT NULL
           AND "closed_at" IS NULL)
      OR ("status" = 'CLOSED' AND "executed_at" IS NOT NULL
           AND "closed_at" IS NOT NULL)
    )
);

--> statement-breakpoint
CREATE INDEX IF NOT EXISTS ix_recall_registry_tenant_status
  ON "recall_registry" ("tenant_id", "status");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS ix_recall_registry_tenant_batch
  ON "recall_registry" ("tenant_id", "batch_id");

--> statement-breakpoint
-- ---------------------------------------------------------------------------
-- 3. quality_management_reviews (Q-10 — the meeting record + the
--    indicator pack; D-15: the engines' own reads frozen, zero
--    recomputation).
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "quality_management_reviews" (
  "id" uuid NOT NULL,
  "tenant_id" uuid NOT NULL REFERENCES "tenants" ("id") ON DELETE RESTRICT,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "updated_at" timestamptz NOT NULL DEFAULT now(),
  "version" integer NOT NULL DEFAULT 1,
  "created_by" uuid,
  "updated_by" uuid,
  "review_no" text NOT NULL,
  "title" text NOT NULL,
  "held_at" timestamptz NOT NULL,
  "attendees" jsonb NOT NULL DEFAULT '[]'::jsonb,
  "indicator_pack" jsonb NOT NULL,
  "decisions" jsonb NOT NULL DEFAULT '[]'::jsonb,
  "note" text,
  "note_ar" text,
  CONSTRAINT pk_quality_management_reviews PRIMARY KEY ("id"),
  CONSTRAINT uq_quality_management_reviews_id_tenant UNIQUE ("id", "tenant_id"),
  CONSTRAINT uq_quality_management_reviews_tenant_no UNIQUE ("tenant_id", "review_no"),
  CONSTRAINT ck_quality_management_reviews_attendees_shape
    CHECK (jsonb_typeof("attendees") = 'array'),
  CONSTRAINT ck_quality_management_reviews_indicators_shape
    CHECK (jsonb_typeof("indicator_pack") = 'object'),
  CONSTRAINT ck_quality_management_reviews_decisions_shape
    CHECK (jsonb_typeof("decisions") = 'array')
);

--> statement-breakpoint
CREATE INDEX IF NOT EXISTS ix_quality_management_reviews_tenant_held
  ON "quality_management_reviews" ("tenant_id", "held_at");

--> statement-breakpoint
-- ---------------------------------------------------------------------------
-- 4. hazard_registers (Q-11 — the HACCP-style register; the tenant owns
--    the critical-limits structure, the food-manufacturing template
--    composes the surface — D-15, never hardcoded checklists).
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "hazard_registers" (
  "id" uuid NOT NULL,
  "tenant_id" uuid NOT NULL REFERENCES "tenants" ("id") ON DELETE RESTRICT,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "updated_at" timestamptz NOT NULL DEFAULT now(),
  "version" integer NOT NULL DEFAULT 1,
  "created_by" uuid,
  "updated_by" uuid,
  "name" text NOT NULL,
  "name_ar" text,
  "hazard" text NOT NULL,
  "hazard_ar" text,
  "category" text NOT NULL,
  "process_step" text,
  "item_id" uuid,
  "is_ccp" boolean NOT NULL DEFAULT false,
  "critical_limit" text,
  "critical_limit_ar" text,
  "monitoring_procedure" text,
  "corrective_action" text,
  "is_active" boolean NOT NULL DEFAULT true,
  "note" text,
  "note_ar" text,
  CONSTRAINT pk_hazard_registers PRIMARY KEY ("id"),
  CONSTRAINT uq_hazard_registers_id_tenant UNIQUE ("id", "tenant_id"),
  CONSTRAINT uq_hazard_registers_tenant_name UNIQUE ("tenant_id", "name"),
  CONSTRAINT fk_hazard_registers_item
    FOREIGN KEY ("item_id", "tenant_id")
    REFERENCES "items" ("id", "tenant_id") ON DELETE RESTRICT,
  CONSTRAINT ck_hazard_registers_category
    CHECK ("category" IN ('BIOLOGICAL', 'CHEMICAL', 'PHYSICAL', 'ALLERGEN')),
  -- A CCP (critical control point) carries its critical limit — the
  -- HACCP floor (the monitoring/corrective texts ride the same row;
  -- the tenant owns the structure).
  CONSTRAINT ck_hazard_registers_ccp_limit
    CHECK (NOT "is_ccp" OR "critical_limit" IS NOT NULL)
);

--> statement-breakpoint
CREATE INDEX IF NOT EXISTS ix_hazard_registers_tenant_item
  ON "hazard_registers" ("tenant_id", "item_id")
  WHERE "item_id" IS NOT NULL;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS ix_hazard_registers_tenant_active
  ON "hazard_registers" ("tenant_id", "is_active");

--> statement-breakpoint
-- ---------------------------------------------------------------------------
-- 5. RLS (the A1–A10 law) + the purge path.
--> statement-breakpoint
ALTER TABLE "batch_quality_holds" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "batch_quality_holds" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
SELECT erp.apply_tenant_policy('"batch_quality_holds"');
--> statement-breakpoint
ALTER TABLE "recall_registry" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "recall_registry" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
SELECT erp.apply_tenant_policy('"recall_registry"');
--> statement-breakpoint
ALTER TABLE "quality_management_reviews" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "quality_management_reviews" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
SELECT erp.apply_tenant_policy('"quality_management_reviews"');
--> statement-breakpoint
ALTER TABLE "hazard_registers" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "hazard_registers" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
SELECT erp.apply_tenant_policy('"hazard_registers"');
--> statement-breakpoint
DO $$
DECLARE
  t text;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'batch_quality_holds', 'recall_registry',
    'quality_management_reviews', 'hazard_registers'
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
-- 6. Grants — the evidence discipline (holds/recalls/reviews) vs the
--    master-data hazard registers (the tenant's own structure).
--> statement-breakpoint
REVOKE ALL ON "batch_quality_holds" FROM erp_app;
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE ON "batch_quality_holds" TO erp_app;
--> statement-breakpoint
GRANT SELECT ON "batch_quality_holds" TO erp_readonly;
--> statement-breakpoint
GRANT SELECT ON "batch_quality_holds" TO erp_definer;
--> statement-breakpoint
REVOKE ALL ON "recall_registry" FROM erp_app;
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE ON "recall_registry" TO erp_app;
--> statement-breakpoint
GRANT SELECT ON "recall_registry" TO erp_readonly;
--> statement-breakpoint
GRANT SELECT ON "recall_registry" TO erp_definer;
--> statement-breakpoint
REVOKE ALL ON "quality_management_reviews" FROM erp_app;
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE ON "quality_management_reviews" TO erp_app;
--> statement-breakpoint
GRANT SELECT ON "quality_management_reviews" TO erp_readonly;
--> statement-breakpoint
GRANT SELECT ON "quality_management_reviews" TO erp_definer;
--> statement-breakpoint
REVOKE ALL ON "hazard_registers" FROM erp_app;
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON "hazard_registers" TO erp_app;
--> statement-breakpoint
GRANT SELECT ON "hazard_registers" TO erp_readonly;
--> statement-breakpoint
GRANT SELECT ON "hazard_registers" TO erp_definer;

--> statement-breakpoint
COMMENT ON TABLE "batch_quality_holds" IS 'PHASE-050 (Q-09, T-04): the batch quality holds — one ACTIVE hold per batch (the partial unique), the blocking validation service the only gate reading it on every issue/ship path (INV-035/BR-101, server-side only); release requires the disposition-linked record (the NCR link + the note, both NOT NULL on the released path) / حجز الدفعات: حجز نشط واحد لكل دفعة، وبوابة التحقق المشتركة هي البوابة الوحيدة على كل مسار صرف أو شحن، ولا رفع للحجز إلا بسجل تصرف مرتبط';
--> statement-breakpoint
COMMENT ON TABLE "recall_registry" IS 'PHASE-050 (Q-09/Q-12, T-04): the recall drill''s RECORD (distinct from the drill''s live query on the batch/serial ledger) — the initiated/executed/closed ladder with the frozen scope and affected-customers snapshots at execution / سجل الاستدعاء: تسجيل التمرين بسلّمه ولقطات النطاق والعملاء المتأثرين عند التنفيذ';
--> statement-breakpoint
COMMENT ON TABLE "quality_management_reviews" IS 'PHASE-050 (Q-10, T-04): the quality management review record — the meeting with the indicator pack (NCR/CAPA/complaint/SPC status: the engines'' own reads frozen at the meeting, zero recomputation) and the decisions / سجلات مراجعة إدارة الجودة: الاجتماع بحزمة المؤشرات المجمدة والقرارات';
--> statement-breakpoint
COMMENT ON TABLE "hazard_registers" IS 'PHASE-050 (Q-11, T-04): the HACCP-style hazard register — hazards/CCPs/critical limits/monitoring per process step or item; the food-manufacturing template composes the surface and the tenant owns the critical-limits structure (never hardcoded checklists) / سجل المخاطر بنمط HACCP: المخاطر ونقاط التحكم الحرجة وحدودها الحرجة، والقالب الغذائي يؤلف السطح والمستأجر يملك البنية';

--> statement-breakpoint
-- ---------------------------------------------------------------------------
-- 7. THE ENTITLEMENTS KEY-SHAPE WIDENING (the 0023/0051/0111 DROP+ADD
--    pattern — the whole-module flag's own substrate repair, caught RED
--    by this wave's first DB-spec run: the business-plan materialization
--    inserts the plan's feature_keys as entitlements, and 0006's
--    ck_entitlements_feature_key_shape demands the 2–3-segment
--    module.feature shape — the bare `quality` key REFUSED (23514).
--    The additive widening keeps the standing shape and admits EXACTLY
--    the one whole-module key, mirroring the manifest schema's dated
--    PHASE-050 amendment — the same one-key exception, no wider).
--> statement-breakpoint
ALTER TABLE "entitlements" DROP CONSTRAINT IF EXISTS ck_entitlements_feature_key_shape;
--> statement-breakpoint
ALTER TABLE "entitlements" ADD CONSTRAINT ck_entitlements_feature_key_shape
  CHECK ("feature_key" ~ '^[a-z][a-z0-9_]*(\.[a-z][a-z0-9_]*){1,2}$' OR "feature_key" = 'quality');

--> statement-breakpoint
-- ---------------------------------------------------------------------------
-- 8. §5 THE DATA-ONLY GRANTS BLOCK (the 0098/0103/0108 pattern) —
--    (a) the ten permission keys + the role grants.
--> statement-breakpoint
INSERT INTO "permissions" ("key", "module", "description") VALUES
('quality.view', 'quality', 'View the quality plane: specifications, NCR/CAPA registers, calibration, complaints, COA (the finance-read plane) / عرض مستوى الجودة: المواصفات وسجلات عدم المطابقة والمعايرة والشكاوى والشهادات'),
('quality.manage', 'quality', 'Manage the quality plane''s operational configuration (specifications authoring and the module''s settings) / إدارة التشغيل لمستوى الجودة: تأليف المواصفات وإعدادات الوحدة'),
('quality.ncr.manage', 'quality', 'Manage NCR records, drive the disposition/closure lifecycle (BR-102) and fire the G-62 scrap write-off / إدارة سجلات عدم المطابقة وقرارات التصرف والإغلاق وتشغيل شطب الإتلاف G-62'),
('quality.capa.manage', 'quality', 'Manage CAPA records: root cause, actions, the effectiveness gate (BR-103) and the G-63 external cost / إدارة سجلات CAPA: الجذر والإجراءات وبوابة الفعالية والتكلفة الخارجية G-63'),
('quality.calibration.manage', 'quality', 'Manage calibration records for instrument assets and the due-date sweep''s configuration / إدارة سجلات معايرة أجهزة الأصول وإعدادات كنس تواريخ الاستحقاق'),
('quality.spc.view', 'quality', 'View the SPC charts (X-bar/R, Cp/Cpk, out-of-control flags — the quality.spc feature plane) / عرض خرائط الضبط الإحصائي ومؤشراتها'),
('quality.complaints.manage', 'quality', 'Manage the customer-complaint intake, triage and the NCR link / إدارة استقبال الشكاوى وفرزها وربطها بسجلات عدم المطابقة'),
('quality.coa.generate', 'quality', 'Generate certificates of analysis/conformity (BR-104''s tolerance gate at generation) / توليد شهادات التحليل أو المطابقة عبر بوابة التحمل'),
('quality.hold.manage', 'quality', 'Place and release batch quality holds (INV-035/BR-101 — release requires the disposition-linked record) / وضع حجز الدفعات ورفعه بموجب سجل التصرف المرتبط'),
('quality.recall.manage', 'quality', 'Manage the recall registry and execute the traceability drill (batch → where-used → customers) / إدارة سجل الاستدعاء وتنفيذ تمرين التتبع')
ON CONFLICT ("key") DO UPDATE
  SET "module" = EXCLUDED."module", "description" = EXCLUDED."description";
--> statement-breakpoint
INSERT INTO "role_permissions" ("role_id", "tenant_id", "permission_id")
SELECT r."id", NULL, p."key"
FROM "roles" r JOIN "permissions" p ON p."key" IN (
  'quality.view', 'quality.manage',
  'quality.ncr.manage', 'quality.capa.manage', 'quality.calibration.manage',
  'quality.spc.view', 'quality.complaints.manage', 'quality.coa.generate',
  'quality.hold.manage', 'quality.recall.manage'
)
WHERE r."key" = 'owner' AND r."tenant_id" IS NULL
ON CONFLICT ("role_id", "permission_id") DO NOTHING;
--> statement-breakpoint
-- The accountant's finance-read plane (the 0108 two-read-keys precedent,
-- narrowed to the module's single read key): the NCR/CAPA registers feed
-- the G-62/G-63 GL reconciliation; the operational keys stay owner-only.
INSERT INTO "role_permissions" ("role_id", "tenant_id", "permission_id")
SELECT r."id", NULL, p."key"
FROM "roles" r JOIN "permissions" p ON p."key" IN (
  'quality.view'
)
WHERE r."key" = 'accountant' AND r."tenant_id" IS NULL
ON CONFLICT ("role_id", "permission_id") DO NOTHING;

--> statement-breakpoint
-- ---------------------------------------------------------------------------
-- 9. §5(b) THE PLAN GRANTS — business + enterprise carry the two flags;
--    STARTER stays at THE DECLARED NEUTRAL ZERO (the tier-4 posture).
--> statement-breakpoint
UPDATE "plans" SET "feature_keys" = array_cat("feature_keys", ARRAY[
  'quality', 'quality.spc'
])
WHERE "key" IN ('business', 'enterprise')
  AND NOT ('quality' = ANY("feature_keys"));

--> statement-breakpoint
-- ---------------------------------------------------------------------------
-- 10. §5(c) THE MANIFEST ENABLEMENT (D-04 — CR-36f template-composable):
--    the FOUR quality-carrying templates compose `quality` by default;
--    food_manufacturing + electronics additionally compose `quality.spc`
--    (guarded surgical jsonb_set appends; the canonical templates.ts +
--    the docs mirrors move in this same W-24 increment — the
--    coherent-change law).
--> statement-breakpoint
UPDATE "industry_templates"
SET "manifest" = jsonb_set(
  "manifest", '{required_feature_keys}',
  "manifest"->'required_feature_keys' || $qms$[
    "quality", "quality.spc"
  ]$qms$::jsonb
)
WHERE "key" = 'industry.food_manufacturing'
  AND NOT ("manifest"->'required_feature_keys' ? 'quality');
--> statement-breakpoint
UPDATE "industry_templates"
SET "manifest" = jsonb_set(
  "manifest", '{required_feature_keys}',
  "manifest"->'required_feature_keys' || $qms$[
    "quality"
  ]$qms$::jsonb
)
WHERE "key" = 'industry.agriculture'
  AND NOT ("manifest"->'required_feature_keys' ? 'quality');
--> statement-breakpoint
UPDATE "industry_templates"
SET "manifest" = jsonb_set(
  "manifest", '{required_feature_keys}',
  "manifest"->'required_feature_keys' || $qms$[
    "quality"
  ]$qms$::jsonb
)
WHERE "key" = 'industry.healthcare'
  AND NOT ("manifest"->'required_feature_keys' ? 'quality');
--> statement-breakpoint
UPDATE "industry_templates"
SET "manifest" = jsonb_set(
  "manifest", '{required_feature_keys}',
  "manifest"->'required_feature_keys' || $qms$[
    "quality", "quality.spc"
  ]$qms$::jsonb
)
WHERE "key" = 'industry.electronics'
  AND NOT ("manifest"->'required_feature_keys' ? 'quality');

--> statement-breakpoint
-- ---------------------------------------------------------------------------
-- 11. §5(d) THE CoA TEMPLATE MARKER (the 0077 §6 additive pattern —
--     D-06's own dependency; existing tenants map once, fail-closed).
--     The G-63 credit leg rides the EXISTING EXTERNAL_ACCRUAL (2137);
--     the G-62 pair rides the EXISTING INVENTORY_SHRINKAGE + the
--     per-warehouse INVENTORY (the 044 valuation-ledger precedent).
--> statement-breakpoint
INSERT INTO "chart_of_accounts_template" ("code", "name", "name_ar", "type", "is_group", "parent_code", "purpose_key") VALUES
  ('5320', 'Quality expense', 'مصروف الجودة', 'EXPENSE', false, '5000', 'QUALITY_EXPENSE')
ON CONFLICT ("code") DO UPDATE
  SET "name" = EXCLUDED."name", "name_ar" = EXCLUDED."name_ar",
      "type" = EXCLUDED."type", "is_group" = EXCLUDED."is_group",
      "parent_code" = EXCLUDED."parent_code", "purpose_key" = EXCLUDED."purpose_key";

--> statement-breakpoint
RESET ROLE;

--> statement-breakpoint
-- Schema-state marker for /health/ready (mirrors the migration manifest).
INSERT INTO erp._schema_state (key, value) VALUES ('schema_version', 116)
ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, at = now();
