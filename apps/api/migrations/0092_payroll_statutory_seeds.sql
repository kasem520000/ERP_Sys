-- PHASE-046 (Blueprint v3.0 · CR-16) · migration 0092 · HR Payroll
-- Compliance (part 4: the DATA-ONLY seed — the 0078/0086 pattern).
--
--   §1 the THREE permission keys (matrix §3.24):
--        payroll.statutory        — manage the statutory row-sets + the export
--        payroll.eosb             — manage the EOSB tiers + run the true-up views
--        payroll.statutory.verify — the BR-085 verification act (owner-only:
--                                   the act unblocks legal postings; SoD —
--                                   the verifier ≠ the row's last editor)
--      Role tiers: owner + accountant + payroll_officer take the management
--      keys; payroll.statutory.verify is owner-only (the SoD law, D-10).
--   §2 the TWO feature plan grants (the tier-4 precedent: business +
--      enterprise only — the 0043/0086 pattern): payroll.statutory ·
--      payroll.eosb. The entitlements note documents the market/jurisdiction
--      dimension: the plan tier grants the CAPABILITY; the jurisdiction's
--      verified profile set decides whether it posts.
--   §3 THE CANONICAL STATUTORY MATERIALIZATION (D-11) for EVERY existing
--      tenant — the rates are jurisdiction facts, so they MATERIALIZE per
--      tenant (idempotent on the (tenant, jurisdiction, code) unique; the
--      tenant-creation provisioning step materializes the same set for NEW
--      tenants — one canonical source: statutory-canonical.ts):
--        SA · GOSI-PENSION  VERIFIED — employee 9.0000% / employer 9.0000%,
--             wage base 1,500…45,000, CITIZEN, contributory = basic + HOUSING
--        SA · GOSI-SANED    VERIFIED — 0.7500% / 0.7500%, base 1,500…15,000,
--             CITIZEN (the dual-cap law — a single row could not express it)
--        SA · GOSI-OH       VERIFIED — 0.0000% / 2.0000%, base 1,500…45,000,
--             ALL (the OWNER'S CORRECTED ROW: the occupational-hazards arm
--             covers Saudis AND non-Saudis — employer-only 2%; the Saudi
--             employer total is 11.75% = 9% + 0.75% + 2%, the employee
--             9.75%; the non-Saudi arm is OH-only)
--        → NO KSA PIT rows (no employee PIT in KSA — the honest no-bracket
--          state: a jurisdiction without VERIFIED brackets computes zero PIT)
--        SA · EOSB tiers    VERIFIED — 0–5 years → 15 days/year; > 5 → 30
--                            days/year (the per-year tier fold; 7 years ×
--                            eosBase 9,000 → 5×15 + 2×30 = 135 days →
--                            40,500.0000)
--        AE/EG/JO · one placeholder row per family (contribution profile +
--          PIT bracket + EOSB tier) at 0-rate, status REQUIRES_VERIFICATION,
--          the explicit no-fabrication note — the rows EXIST to surface the
--          jurisdiction's blocked state (BR-085's typed refusal), NEVER a
--          guessed rate; the official schedules are the owner's open item
--          in the statutory verification register.
--
--   The verification records carry the honest provenance: the owner's
--   approval dispatch (2026-11-16) confirmed the corrected schedule and the
--   expected OH cap (45,000); published implementations of the schedule
--   corroborate the structure (the Social Insurance Law, Royal Decree
--   M/33, as amended — the contributory-wage cap 45,000 per Part 1
--   Art. 8(2); SANED's 15,000 ceiling per the plan's dual-cap basis);
--   gosi.gov.sa itself was UNREACHABLE from the delivery sandbox (the
--   fetch attempts are recorded in the verification register) — the
--   official-table citations are the register's open item for the owner's
--   at-review confirmation. Any correction lands as a seed edit BEFORE
--   the gates, never after (the plan §7(c) law).

--> statement-breakpoint
SET ROLE erp_migrate;

--> statement-breakpoint
-- ---------------------------------------------------------------------------
-- 1. Permission keys (the three, matrix §3.24).
--> statement-breakpoint
INSERT INTO "permissions" ("key", "module", "description") VALUES
('payroll.statutory', 'payroll', 'Manage statutory contribution profiles, PIT brackets, and the remittance export / إدارة ملفات المساهمات القانونية وشرائح الضريبة وتصدير الترحيلات'),
('payroll.eosb', 'payroll', 'Manage EOSB tiers and view the entitlement/provision reconciliation / إدارة طبقات نهاية الخدمة وعرض مطابقة المخصص'),
('payroll.statutory.verify', 'payroll', 'Verify a statutory row (the BR-085 gate — owner-only, SoD-bound) / اعتماد صف قانوني (بوابة التحقق — للمالك فقط مع فصل المهام)')
ON CONFLICT ("key") DO UPDATE
  SET "module" = EXCLUDED."module", "description" = EXCLUDED."description";
--> statement-breakpoint
INSERT INTO "role_permissions" ("role_id", "tenant_id", "permission_id")
SELECT r."id", NULL, p."key"
FROM "roles" r JOIN "permissions" p ON p."key" IN (
  'payroll.statutory', 'payroll.eosb'
)
WHERE r."key" = 'owner' AND r."tenant_id" IS NULL
ON CONFLICT ("role_id", "permission_id") DO NOTHING;
--> statement-breakpoint
INSERT INTO "role_permissions" ("role_id", "tenant_id", "permission_id")
SELECT r."id", NULL, p."key"
FROM "roles" r JOIN "permissions" p ON p."key" IN (
  'payroll.statutory', 'payroll.eosb'
)
WHERE r."key" = 'accountant' AND r."tenant_id" IS NULL
ON CONFLICT ("role_id", "permission_id") DO NOTHING;
--> statement-breakpoint
INSERT INTO "role_permissions" ("role_id", "tenant_id", "permission_id")
SELECT r."id", NULL, p."key"
FROM "roles" r JOIN "permissions" p ON p."key" IN (
  'payroll.statutory', 'payroll.eosb'
)
WHERE r."key" = 'payroll_officer' AND r."tenant_id" IS NULL
ON CONFLICT ("role_id", "permission_id") DO NOTHING;
--> statement-breakpoint
INSERT INTO "role_permissions" ("role_id", "tenant_id", "permission_id")
SELECT r."id", NULL, p."key"
FROM "roles" r JOIN "permissions" p ON p."key" IN (
  'payroll.statutory.verify'
)
WHERE r."key" = 'owner' AND r."tenant_id" IS NULL
ON CONFLICT ("role_id", "permission_id") DO NOTHING;

--> statement-breakpoint
-- ---------------------------------------------------------------------------
-- 2. Feature plan grants (the tier-4 precedent — business + enterprise).
--> statement-breakpoint
UPDATE "plans" SET "feature_keys" = array_cat("feature_keys", ARRAY[
  'payroll.statutory', 'payroll.eosb'
])
WHERE "key" IN ('business', 'enterprise')
  AND NOT ('payroll.statutory' = ANY("feature_keys"));

--> statement-breakpoint
-- ---------------------------------------------------------------------------
-- 3. The canonical statutory materialization — every existing tenant.
--> statement-breakpoint
-- 3a. GOSI-PENSION (the corrected schedule's citizen pension arm).
INSERT INTO "statutory_contribution_profiles"
  ("id", "tenant_id", "jurisdiction_code", "code", "name", "name_ar",
   "employee_rate", "employer_rate", "base_min", "base_max",
   "contributory_keys", "applies_to", "effective_from", "status",
   "source_name", "source_ref", "verified_at", "review_note")
SELECT gen_random_uuid(), t."id", 'SA', 'GOSI-PENSION',
  'GOSI Pension (Annuities)', 'التأمينات الاجتماعية — المعاشات',
  9.0000, 9.0000, 1500.0000, 45000.0000,
  '["HOUSING"]'::jsonb, 'CITIZEN', DATE '2020-01-01', 'VERIFIED',
  'GOSI official contribution schedule — the Social Insurance Law (Royal Decree M/33, as amended)',
  'The owner''s PHASE-046 approval dispatch (2026-11-16): the Saudi split employer 11.75% (9% pension + 0.75% SANED + 2% OH) / employee 9.75%; corroborated by published implementations of the schedule (the contributory-wage cap 45,000 per the Law Part 1 Art. 8(2))',
  now(),
  'The dual-cap law''s pension arm. gosi.gov.sa unreachable from the delivery sandbox — the official-table citation is the verification register''s open item; any correction lands as a seed edit before the gates.'
FROM "tenants" t
ON CONFLICT ("tenant_id", "jurisdiction_code", "code") DO NOTHING;
--> statement-breakpoint
-- 3b. GOSI-SANED (the unemployment arm — its own 15,000 ceiling).
INSERT INTO "statutory_contribution_profiles"
  ("id", "tenant_id", "jurisdiction_code", "code", "name", "name_ar",
   "employee_rate", "employer_rate", "base_min", "base_max",
   "contributory_keys", "applies_to", "effective_from", "status",
   "source_name", "source_ref", "verified_at", "review_note")
SELECT gen_random_uuid(), t."id", 'SA', 'GOSI-SANED',
  'GOSI SANED (Unemployment)', 'ساند — التأمين ضد التعطل',
  0.7500, 0.7500, 1500.0000, 15000.0000,
  '["HOUSING"]'::jsonb, 'CITIZEN', DATE '2020-01-01', 'VERIFIED',
  'GOSI official contribution schedule — the Social Insurance Law (Royal Decree M/33, as amended)',
  'The owner''s PHASE-046 approval dispatch (2026-11-16): SANED 0.75% each side, Saudis only; the 15,000 ceiling per the plan''s dual-cap basis (D-01)',
  now(),
  'The dual-cap law''s SANED arm — the reason the schedule is a ROW-SET. gosi.gov.sa unreachable from the delivery sandbox — the official-table citation is the verification register''s open item.'
FROM "tenants" t
ON CONFLICT ("tenant_id", "jurisdiction_code", "code") DO NOTHING;
--> statement-breakpoint
-- 3c. GOSI-OH — THE OWNER'S CORRECTED ROW: applies to ALL (Saudis and
--     non-Saudis), employer-only 2%.
INSERT INTO "statutory_contribution_profiles"
  ("id", "tenant_id", "jurisdiction_code", "code", "name", "name_ar",
   "employee_rate", "employer_rate", "base_min", "base_max",
   "contributory_keys", "applies_to", "effective_from", "status",
   "source_name", "source_ref", "verified_at", "review_note")
SELECT gen_random_uuid(), t."id", 'SA', 'GOSI-OH',
  'GOSI Occupational Hazards', 'التأمين ضد الأخطار المهنية',
  0.0000, 2.0000, 1500.0000, 45000.0000,
  '["HOUSING"]'::jsonb, 'ALL', DATE '2020-01-01', 'VERIFIED',
  'GOSI official contribution schedule — the Social Insurance Law (Royal Decree M/33, as amended)',
  'The owner''s PHASE-046 approval dispatch (2026-11-16), verbatim: "the GOSI-OH row applies to ALL: employee share zero, employer share 2%" — the non-Saudi arm is OH-only; the Saudi employer total 11.75% includes this 2%',
  now(),
  'The OH wage cap pinned at 45,000 (the owner''s expected value; corroborated by published implementations — the same contributory-wage ceiling as the pension arm per the Law Part 1 Art. 8(2)). gosi.gov.sa unreachable from the delivery sandbox — the official-table citation is the verification register''s open item.'
FROM "tenants" t
ON CONFLICT ("tenant_id", "jurisdiction_code", "code") DO NOTHING;
--> statement-breakpoint
-- 3d. The KSA EOSB tiers (the labor-law award — the per-year fold).
INSERT INTO "eosb_rules"
  ("id", "tenant_id", "jurisdiction_code", "from_years", "to_years",
   "days_per_year", "contract_type", "effective_from", "status",
   "source_name", "source_ref", "verified_at", "review_note")
SELECT gen_random_uuid(), t."id", 'SA', 0.00, 5.00, 15.00,
  NULL, DATE '2020-01-01', 'VERIFIED',
  'Saudi Labor Law (Royal Decree M/51, as amended) — the end-of-service award',
  'The phase doc''s own worked shape: half a month''s wage per year for the first five years, a full month thereafter',
  now(),
  'The first tier of the per-year fold (0–5 years × 15 days). The official-text citation is the verification register''s open item.'
FROM "tenants" t
ON CONFLICT DO NOTHING;
--> statement-breakpoint
INSERT INTO "eosb_rules"
  ("id", "tenant_id", "jurisdiction_code", "from_years", "to_years",
   "days_per_year", "contract_type", "effective_from", "status",
   "source_name", "source_ref", "verified_at", "review_note")
SELECT gen_random_uuid(), t."id", 'SA', 5.00, NULL, 30.00,
  NULL, DATE '2020-01-01', 'VERIFIED',
  'Saudi Labor Law (Royal Decree M/51, as amended) — the end-of-service award',
  'The phase doc''s own worked shape: a full month''s wage per year beyond the fifth year (the second tier of the fold: > 5 years × 30 days)',
  now(),
  'The open-top tier. The official-text citation is the verification register''s open item.'
FROM "tenants" t
ON CONFLICT DO NOTHING;
--> statement-breakpoint
-- 3e. The AE/EG/JO placeholders — the blocked-state surface (no fabricated
--     rates: 0-rate rows that BR-085 refuses until the tenant enters the
--     official figures and verifies them).
INSERT INTO "statutory_contribution_profiles"
  ("id", "tenant_id", "jurisdiction_code", "code", "name", "name_ar",
   "employee_rate", "employer_rate", "base_min", "base_max",
   "contributory_keys", "applies_to", "effective_from", "status", "review_note")
SELECT gen_random_uuid(), t."id", j.code, 'SOCIAL-INSURANCE',
  'Social insurance (' || j.label || ') — pending official verification',
  'التأمينات الاجتماعية — بانتظار التحقق الرسمي',
  0.0000, 0.0000, NULL, NULL,
  '[]'::jsonb, 'ALL', DATE '2020-01-01', 'REQUIRES_VERIFICATION',
  'No rate seeded — the jurisdiction''s official schedule is the owner''s open item (the statutory verification register). The row exists to surface the blocked state, never a guessed rate (BR-085/BR-055).'
FROM "tenants" t
CROSS JOIN (VALUES
  ('AE', 'UAE'),
  ('EG', 'Egypt'),
  ('JO', 'Jordan')
) AS j(code, label)
ON CONFLICT ("tenant_id", "jurisdiction_code", "code") DO NOTHING;
--> statement-breakpoint
INSERT INTO "payroll_tax_brackets"
  ("id", "tenant_id", "jurisdiction_code", "code", "floor", "ceiling",
   "rate", "sort", "personal_allowance_default", "per_dependent_allowance",
   "effective_from", "status", "review_note")
SELECT gen_random_uuid(), t."id", j.code, 'PIT-STANDARD', 0.0000, NULL,
  0.0000, 1, 0.0000, 0.0000,
  DATE '2020-01-01', 'REQUIRES_VERIFICATION',
  'No bracket seeded — the jurisdiction''s official PIT schedule is the owner''s open item (the statutory verification register). The row exists to surface the blocked state, never a guessed rate (BR-085/BR-055).'
FROM "tenants" t
CROSS JOIN (VALUES
  ('AE', 'UAE'),
  ('EG', 'Egypt'),
  ('JO', 'Jordan')
) AS j(code, label)
ON CONFLICT ("tenant_id", "jurisdiction_code", "code", "effective_from", "sort") DO NOTHING;
--> statement-breakpoint
INSERT INTO "eosb_rules"
  ("id", "tenant_id", "jurisdiction_code", "from_years", "to_years",
   "days_per_year", "contract_type", "effective_from", "status", "review_note")
SELECT gen_random_uuid(), t."id", j.code, 0.00, NULL, 0.00,
  NULL, DATE '2020-01-01', 'REQUIRES_VERIFICATION',
  'No tier seeded — the jurisdiction''s official end-of-service schedule is the owner''s open item (the statutory verification register). The row exists to surface the blocked state, never a guessed rate (BR-085/BR-055).'
FROM "tenants" t
CROSS JOIN (VALUES
  ('AE', 'UAE'),
  ('EG', 'Egypt'),
  ('JO', 'Jordan')
) AS j(code, label)
ON CONFLICT DO NOTHING;

--> statement-breakpoint
RESET ROLE;

--> statement-breakpoint
-- Schema-state marker for /health/ready (mirrors the migration manifest).
INSERT INTO erp._schema_state (key, value) VALUES ('schema_version', 92)
ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, at = now();
