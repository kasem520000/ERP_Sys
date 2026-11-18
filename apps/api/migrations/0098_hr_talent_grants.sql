-- PHASE-047 (Blueprint v3.0 · CR-17) · migration 0098 · HR Growth —
-- Talent & Performance (part 4: the grants + seeds, T-04 — DATA-ONLY;
-- 0095–0097 stay byte-stable).
--
--   §1 THE TWELVE PERMISSION KEYS (matrix §3.25; catalog 300 → 312):
--     hr.performance.view / .manage / .review — the cycle family
--     hr.recruitment.view / .manage / .interview — the pipeline family
--     hr.training.view / .manage — the training family
--     hr.org.view / .manage — the org family
--     hr.documents.manage — the document register (cross-cutting)
--     hr.competency.manage — the framework (cross-cutting)
--   Role grants (the §3.23/§3.24 precedent): the owner template holds
--   ALL TWELVE; the accountant holds the four VIEW keys (the finance
--   side's read plane over the employee substrate); NO other system
--   role — talent management is tenant-granted beyond the baseline
--   (the payroll.statutory.verify owner-only precedent's spirit).
--   §2 THE PLAN GRANTS (the tier-4 precedent): business + enterprise
--   carry the FOUR FEATURE FLAGS — hr.performance · hr.recruitment ·
--   hr.training · hr.org (the phase doc's composable units, the §3
--   schema's single-segment module.feature shape). The twelve permission
--   keys are the AUTHORIZATION surface and ride ROLES (§1) — never the
--   plans; the flags gate the capability (the nav/screens/feature
--   planes), the roles grant the authority (matrix §3.25's dated note
--   records the divergence from 045/046, where one key did both jobs).
--   §3 THE MANIFEST ENABLEMENT (D-10 — CR-36f template-composable): the
--   four people-carrying templates — professional_services, healthcare,
--   education, food_manufacturing — compose the four flags by default
--   (the phase doc's instruction). THE COHERENT-CHANGE LAW (the 0088/
--   0066 §9 procedure): the canonical templates.ts + THIS stored-registry
--   update + the docs mirrors move together in the same increment (W-1).
--   Unlike 0088 (a two-field change that re-embedded the whole manifest),
--   this is a ONE-FIELD append — a surgical jsonb_set concat, zero
--   transcription risk, and the canonical-JSON hash the effective-config
--   layer computes is order-and-whitespace blind (determinism, §1
--   principle 2).
--   §4 THE COMPETENCY SCALE SEED (red line 5's ONE shipped default):
--   the 1–5 AR/EN scale rows for EVERY existing tenant — through the
--   0093 migration-plane gate (the honest RLS finding: under FORCE RLS
--   erp_migrate sees no tenants; a bare FROM-"tenants" sweep is a
--   silent no-op — the gate is created + self-dropped in this one
--   file, crash-safe on both sides, the final policy set EXACTLY the
--   pre-0098 set). New tenants materialize the same rows at onboarding
--   (the materializeCanonicalCompetencyScale hook — the
--   materializeCanonicalStatutorySet precedent; one source, both
--   paths). The scale is tenant-configurable DATA (BR-055): the
--   descriptors are the documented default, never a compliance fact.
--
--   Ledger-free by design (D-05): zero journal rules, zero invariants,
--   zero account purposes.

--> statement-breakpoint
SET ROLE erp_migrate;

--> statement-breakpoint
-- ---------------------------------------------------------------------------
-- 1. Permission keys (the twelve, matrix §3.25) + role grants.
--> statement-breakpoint
INSERT INTO "permissions" ("key", "module", "description") VALUES
('hr.performance.view', 'hr', 'View performance cycles, reviews, and aggregated 360 results / عرض دورات التقييم والمراجعات ونتائج 360 المجمّعة'),
('hr.performance.manage', 'hr', 'Manage performance cycles and calibration / إدارة دورات التقييم والمعايرة'),
('hr.performance.review', 'hr', 'Submit and edit own review inputs / تقديم وتحرير مدخلات التقييم الخاصة'),
('hr.recruitment.view', 'hr', 'View vacancies and the applicant pipeline / عرض الشواغر ومسار المتقدمين'),
('hr.recruitment.manage', 'hr', 'Manage vacancies and applicant stages / إدارة الشواغر ومراحل المتقدمين'),
('hr.recruitment.interview', 'hr', 'Record interview scorecards as a panelist / تسجيل بطاقات تقييم المقابلات كعضو لجنة'),
('hr.training.view', 'hr', 'View training programs, enrollments, and certifications / عرض برامج التدريب والتسجيلات والشهادات'),
('hr.training.manage', 'hr', 'Manage training programs and enrollments / إدارة برامج التدريب والتسجيلات'),
('hr.org.view', 'hr', 'View the org structure and positions / عرض الهيكل التنظيمي والوظائف'),
('hr.org.manage', 'hr', 'Manage org units and positions (cycle-safe moves) / إدارة الوحدات التنظيمية والوظائف (نقل آمن من الحلقات)'),
('hr.documents.manage', 'hr', 'Manage the employee document register / إدارة سجل وثائق الموظفين'),
('hr.competency.manage', 'hr', 'Manage the competency framework and scale descriptors / إدارة إطار الكفاءات ووصف المقياس')
ON CONFLICT ("key") DO UPDATE
  SET "module" = EXCLUDED."module", "description" = EXCLUDED."description";
--> statement-breakpoint
INSERT INTO "role_permissions" ("role_id", "tenant_id", "permission_id")
SELECT r."id", NULL, p."key"
FROM "roles" r JOIN "permissions" p ON p."key" IN (
  'hr.performance.view', 'hr.performance.manage', 'hr.performance.review',
  'hr.recruitment.view', 'hr.recruitment.manage', 'hr.recruitment.interview',
  'hr.training.view', 'hr.training.manage',
  'hr.org.view', 'hr.org.manage',
  'hr.documents.manage', 'hr.competency.manage'
)
WHERE r."key" = 'owner' AND r."tenant_id" IS NULL
ON CONFLICT ("role_id", "permission_id") DO NOTHING;
--> statement-breakpoint
INSERT INTO "role_permissions" ("role_id", "tenant_id", "permission_id")
SELECT r."id", NULL, p."key"
FROM "roles" r JOIN "permissions" p ON p."key" IN (
  'hr.performance.view', 'hr.recruitment.view', 'hr.training.view', 'hr.org.view'
)
WHERE r."key" = 'accountant' AND r."tenant_id" IS NULL
ON CONFLICT ("role_id", "permission_id") DO NOTHING;

--> statement-breakpoint
-- ---------------------------------------------------------------------------
-- 2. Feature plan grants (the tier-4 precedent — business + enterprise
--    carry the FOUR FEATURE FLAGS; the permission keys ride roles, §1).
--> statement-breakpoint
UPDATE "plans" SET "feature_keys" = array_cat("feature_keys", ARRAY[
  'hr.performance', 'hr.recruitment', 'hr.training', 'hr.org'
])
WHERE "key" IN ('business', 'enterprise')
  AND NOT ('hr.performance' = ANY("feature_keys"));

--> statement-breakpoint
-- ---------------------------------------------------------------------------
-- 3. THE MANIFEST ENABLEMENT (D-10) — the four people-carrying templates
--    compose the four feature flags by default. Surgical one-field
--    appends (guarded idempotent): the canonical templates.ts + the docs
--    mirrors move in the same W-1 increment (the coherent-change law).
--> statement-breakpoint
UPDATE "industry_templates"
SET "manifest" = jsonb_set(
  "manifest", '{required_feature_keys}',
  "manifest"->'required_feature_keys' || $talent$[
    "hr.performance", "hr.recruitment", "hr.training", "hr.org"
  ]$talent$::jsonb
)
WHERE "key" = 'industry.professional_services'
  AND NOT ("manifest"->'required_feature_keys' ? 'hr.performance');
--> statement-breakpoint
UPDATE "industry_templates"
SET "manifest" = jsonb_set(
  "manifest", '{required_feature_keys}',
  "manifest"->'required_feature_keys' || $talent$[
    "hr.performance", "hr.recruitment", "hr.training", "hr.org"
  ]$talent$::jsonb
)
WHERE "key" = 'industry.healthcare'
  AND NOT ("manifest"->'required_feature_keys' ? 'hr.performance');
--> statement-breakpoint
UPDATE "industry_templates"
SET "manifest" = jsonb_set(
  "manifest", '{required_feature_keys}',
  "manifest"->'required_feature_keys' || $talent$[
    "hr.performance", "hr.recruitment", "hr.training", "hr.org"
  ]$talent$::jsonb
)
WHERE "key" = 'industry.education'
  AND NOT ("manifest"->'required_feature_keys' ? 'hr.performance');
--> statement-breakpoint
UPDATE "industry_templates"
SET "manifest" = jsonb_set(
  "manifest", '{required_feature_keys}',
  "manifest"->'required_feature_keys' || $talent$[
    "hr.performance", "hr.recruitment", "hr.training", "hr.org"
  ]$talent$::jsonb
)
WHERE "key" = 'industry.food_manufacturing'
  AND NOT ("manifest"->'required_feature_keys' ? 'hr.performance');

--> statement-breakpoint
-- ---------------------------------------------------------------------------
-- 4. THE COMPETENCY SCALE SEED — the 1–5 AR/EN default for every EXISTING
--    tenant, through the 0093 migration-plane gate (created + self-dropped
--    in this file; crash-safe both sides; the final policy set is EXACTLY
--    the pre-0098 set). New tenants: the onboarding hook's
--    materializeCanonicalCompetencyScale (one source, both paths).
--> statement-breakpoint
DROP POLICY IF EXISTS migration_plane_select ON "tenants";
--> statement-breakpoint
CREATE POLICY migration_plane_select ON "tenants"
  FOR SELECT TO erp_migrate USING (true);
--> statement-breakpoint
DROP POLICY IF EXISTS migration_plane_insert ON "competency_levels";
--> statement-breakpoint
-- The 0094 gate shape (FOR ALL + USING + WITH CHECK, both true): the
-- narrower FOR INSERT variant fails PG16's RLS check under this sweep's
-- INSERT … SELECT … ON CONFLICT shape (reproduced in the W-1 scratch
-- probe — FOR INSERT: "new row violates row-level security policy";
-- FOR ALL: green) — the proven shape governs.
CREATE POLICY migration_plane_insert ON "competency_levels"
  FOR ALL TO erp_migrate USING (true) WITH CHECK (true);
--> statement-breakpoint
INSERT INTO "competency_levels"
  ("id", "tenant_id", "level", "name", "name_ar", "descriptor", "descriptor_ar")
SELECT gen_random_uuid(), t."id", s."level", s."name", s."name_ar",
       s."descriptor", s."descriptor_ar"
FROM "tenants" t
CROSS JOIN (VALUES
  (1, 'Beginner', 'مبتدئ',
   'Initial familiarity with the competency — performs simple tasks with structured guidance.',
   'إلمام مبدئي بالكفاءة — يؤدي المهام البسيطة بإرشاد منظم.'),
  (2, 'Developing', 'في طور التطور',
   'Applies the competency in routine situations — needs support on non-routine cases.',
   'يطبّق الكفاءة في المواقف الاعتيادية — يحتاج دعماً في الحالات غير الاعتيادية.'),
  (3, 'Proficient', 'متمكن',
   'Applies the competency independently across normal scope — a reliable performer.',
   'يطبّق الكفاءة باستقلال في النطاق المعتاد — مؤدٍّ موثوق.'),
  (4, 'Advanced', 'متقدم',
   'Handles complex and non-routine cases — coaches others on the competency.',
   'يتعامل مع الحالات المعقدة وغير الاعتيادية — يوجّه الآخرين في الكفاءة.'),
  (5, 'Expert', 'خبير',
   'The reference point: shapes practice, resolves the hardest cases, grows the capability in others.',
   'نقطة المرجع: يطوّر الممارسة ويحل أصعب الحالات وينمّي القدرة لدى الآخرين.')
) AS s("level", "name", "name_ar", "descriptor", "descriptor_ar")
ON CONFLICT ("tenant_id", "level") DO NOTHING;
--> statement-breakpoint
DROP POLICY IF EXISTS migration_plane_insert ON "competency_levels";
--> statement-breakpoint
DROP POLICY IF EXISTS migration_plane_select ON "tenants";

--> statement-breakpoint
RESET ROLE;

--> statement-breakpoint
-- Schema-state marker for /health/ready (mirrors the migration manifest).
INSERT INTO erp._schema_state (key, value) VALUES ('schema_version', 98)
ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, at = now();
