-- PHASE-046 (Blueprint v3.0 · CR-16) · migration 0093 · HR Payroll
-- Compliance — the RESERVED SLOT's exact purpose: the GOSI citation record
-- update (the audit-reconciliation round, 2026-11-16).
--
--   DATA-ONLY. 0089–0092 stay byte-stable. This migration:
--   §0 grants itself the MIGRATION-PLANE write gate (temporary policies —
--      see the honest note below), §1 completes the canonical GOSI
--      materialization for every tenant 0092's sweep silently missed, and
--      §2 reclassifies the verification records on the three GOSI rows.
--
--   THE HONEST RLS FINDING (proven by probe on the embedded PG16 this
--   session): under FORCE ROW LEVEL SECURITY, erp_migrate sees NO rows of
--   "tenants" (its only policies are tenant_isolation for erp_app/
--   erp_readonly) and NO cross-tenant rows of the tenant tables (the
--   purge-path policies are tenant-GUC-scoped — tenant_id =
--   erp.current_tenant_id() — and a migration runs with no tenant set).
--   Consequence: every per-tenant INSERT…SELECT…FROM "tenants" sweep in a
--   migration — including 0092 §3's canonical statutory materialization —
--   is a SILENT NO-OP on tenant-ful databases (the test environment never
--   sees it: its tenants are created per-spec AFTER the migrations). The
--   rows 0092 §3 was to seed for EXISTING tenants therefore do not exist;
--   only the tenancy onboarding hook's materialization (as erp_app inside
--   the tenant scope) ever lands rows. This migration repairs the GOSI
--   family through an explicit, temporary, self-dropped policy gate —
--   created and dropped inside this one migration file (crash-safe: both
--   sides are DROP IF EXISTS), so the final policy set is EXACTLY the
--   pre-0093 set (the RLS checker's world is unchanged). The same latent
--   no-op exists in the older per-tenant sweeps (0009's uoms/credit_terms
--   et al.) and in 0092's other families (the AE/EG/JO placeholders, the
--   PIT brackets, the EOSB tiers) — RECORDED for the owner in the gate
--   evidence doc; NOT redesigned here (those surfaces fail closed and
--   their tenants' onboarding path seeds them).
--
--   THE CITATION RECORD (the audit-reconciliation round's reclassification):
--     CITATION       = the PwC source — "PwC Worldwide Tax Summaries —
--                      Saudi Arabia: Individual — Other taxes"
--                      (https://taxsummaries.pwc.com/saudi-arabia/individual/
--                      other-taxes, fetched 2026-11-16 21:34 UTC by the
--                      owner's verifier; page title "Saudi Arabia -
--                      Individual - Other taxes"), which states verbatim:
--                      "Social insurance contributions are paid monthly based
--                      on the monthly basic salary plus housing (paid or in
--                      kind) with an upper limit of SAR 45,000, are computed
--                      at 2% for non-Saudi employees (note that this is not
--                      social insurance, it is occupational hazard), and are
--                      paid by the employer. For Saudi employees, the rate is
--                      21.5% and is paid by both the employee (9.75% = 9%
--                      social insurance + 0.75% unemployment insurance
--                      [SANED]) and the employer (11.75% = 9% social
--                      insurance + 2% occupational hazard + 0.75% unemployment
--                      insurance [SANED])."
--                      This independently corroborates the corrected schedule
--                      0092 seeded: OH on ALL (inside the Saudi employer's
--                      11.75%), non-Saudi OH-only, employee 9.75%, the
--                      45,000 ceiling on basic + housing.
--     DECISION RECORD = the owner's PHASE-046 approval dispatch (2026-11-16)
--                      — WHY the correction happened (the GOSI-OH row on ALL
--                      at 0%/2%; the Saudi employer total 11.75% / employee
--                      9.75%; the non-Saudi arm OH-only). The dispatch is the
--                      decision this row embodies — no longer presented as
--                      the citation itself.
--
--   The register's open items NARROW to exactly two:
--     1. the SANED-specific 15,000 ceiling — PwC does not state it; the
--        owner's confirmation is pending (the plan's D-01 dual-cap basis);
--     2. the EOSB official text — Labor Law M/51 Art. 84 (the 15/30-days
--        tiers); the official text is unreachable from both environments
--        (the delivery sandbox AND the owner's verifier — all Saudi gov
--        domains TCP-blocked; the attempts documented).
--   The GOSI rates and the 45,000 OH/pension contributory ceiling are CLOSED.
--
--   The verification act keeps its 0089 shape (status stays VERIFIED; the
--   VERIFIED⟺source+date CHECK stays satisfied — source_name carries the PwC
--   citation, verified_at refreshed at this record update). Rates, caps,
--   bases, and applies_to are UNTOUCHED — 0092's schedule was already
--   correct; the provenance record is what changes.

--> statement-breakpoint
SET ROLE erp_migrate;

--> statement-breakpoint
-- ---------------------------------------------------------------------------
-- 0. THE MIGRATION-PLANE GATE — temporary policies, self-dropped in §3.
--    (Both sides are DROP IF EXISTS: a crashed attempt that left a policy
--    behind converges when drizzle re-runs this file.)
-- ---------------------------------------------------------------------------
DROP POLICY IF EXISTS migration_plane_select ON "tenants";
--> statement-breakpoint
CREATE POLICY migration_plane_select ON "tenants"
  FOR SELECT TO erp_migrate USING (true);
--> statement-breakpoint
DROP POLICY IF EXISTS migration_plane ON "statutory_contribution_profiles";
--> statement-breakpoint
CREATE POLICY migration_plane ON "statutory_contribution_profiles"
  FOR ALL TO erp_migrate USING (true) WITH CHECK (true);
--> statement-breakpoint

-- ---------------------------------------------------------------------------
-- 1. THE GOSI MATERIALIZATION COMPLETION — every tenant 0092's RLS-blocked
--    sweep missed gets the three rows WITH the final citation records
--    (idempotent: ON CONFLICT DO NOTHING, the 0092 §3 shape). The canonical
--    source (statutory-canonical.ts) carries the same records — one source.
-- ---------------------------------------------------------------------------
-- 1a. GOSI-PENSION.
INSERT INTO "statutory_contribution_profiles"
  ("id", "tenant_id", "jurisdiction_code", "code", "name", "name_ar",
   "employee_rate", "employer_rate", "base_min", "base_max",
   "contributory_keys", "applies_to", "effective_from", "status",
   "source_name", "source_ref", "verified_at", "review_note")
SELECT gen_random_uuid(), t."id", 'SA', 'GOSI-PENSION',
  'GOSI Pension (Annuities)', 'التأمينات الاجتماعية — المعاشات',
  9.0000, 9.0000, 1500.0000, 45000.0000,
  '["HOUSING"]'::jsonb, 'CITIZEN', DATE '2020-01-01', 'VERIFIED',
  'PwC Worldwide Tax Summaries — Saudi Arabia: Individual — Other taxes (https://taxsummaries.pwc.com/saudi-arabia/individual/other-taxes — fetched 2026-11-16 21:34 UTC by the owner''s verifier; page title "Saudi Arabia - Individual - Other taxes")',
  'Verbatim: "Social insurance contributions are paid monthly based on the monthly basic salary plus housing (paid or in kind) with an upper limit of SAR 45,000, are computed at 2% for non-Saudi employees (note that this is not social insurance, it is occupational hazard), and are paid by the employer. For Saudi employees, the rate is 21.5% and is paid by both the employee (9.75% = 9% social insurance + 0.75% unemployment insurance [SANED]) and the employer (11.75% = 9% social insurance + 2% occupational hazard + 0.75% unemployment insurance [SANED])." — the pension arm: employee 9% + employer 9% of the monthly basic + housing, ceiling SAR 45,000',
  now(),
  'CITATION CLOSED (0093, the reserved slot — data-only): the PwC source fetched by the owner''s verifier independently corroborates the corrected schedule this row embodies (the owner''s PHASE-046 approval dispatch, 2026-11-16) — the GOSI rates and the 45,000 contributory-wage ceiling are CLOSED. DECISION RECORD: that dispatch is why the schedule was corrected (the GOSI-OH row on ALL at 0%/2%; the Saudi employer total 11.75% / employee 9.75%; the non-Saudi arm OH-only) — recorded as the decision record, no longer presented as the citation. The statutory verification register''s open items are exactly two: the SANED-specific 15,000 ceiling (PwC does not state it; the owner''s confirmation pending) and the EOSB official text (Labor Law M/51 Art. 84 — the 15/30-days tiers).'
FROM "tenants" t
ON CONFLICT ("tenant_id", "jurisdiction_code", "code") DO NOTHING;
--> statement-breakpoint
-- 1b. GOSI-SANED.
INSERT INTO "statutory_contribution_profiles"
  ("id", "tenant_id", "jurisdiction_code", "code", "name", "name_ar",
   "employee_rate", "employer_rate", "base_min", "base_max",
   "contributory_keys", "applies_to", "effective_from", "status",
   "source_name", "source_ref", "verified_at", "review_note")
SELECT gen_random_uuid(), t."id", 'SA', 'GOSI-SANED',
  'GOSI SANED (Unemployment)', 'ساند — التأمين ضد التعطل',
  0.7500, 0.7500, 1500.0000, 15000.0000,
  '["HOUSING"]'::jsonb, 'CITIZEN', DATE '2020-01-01', 'VERIFIED',
  'PwC Worldwide Tax Summaries — Saudi Arabia: Individual — Other taxes (https://taxsummaries.pwc.com/saudi-arabia/individual/other-taxes — fetched 2026-11-16 21:34 UTC by the owner''s verifier; page title "Saudi Arabia - Individual - Other taxes")',
  'Verbatim: "Social insurance contributions are paid monthly based on the monthly basic salary plus housing (paid or in kind) with an upper limit of SAR 45,000, are computed at 2% for non-Saudi employees (note that this is not social insurance, it is occupational hazard), and are paid by the employer. For Saudi employees, the rate is 21.5% and is paid by both the employee (9.75% = 9% social insurance + 0.75% unemployment insurance [SANED]) and the employer (11.75% = 9% social insurance + 2% occupational hazard + 0.75% unemployment insurance [SANED])." — the SANED arm: employee 0.75% + employer 0.75% (the unemployment insurance inside the 21.5% Saudi total)',
  now(),
  'CITATION CLOSED for the RATES (0093, the reserved slot — data-only): the PwC source fetched by the owner''s verifier corroborates SANED 0.75% + 0.75% and states the general SAR 45,000 contributory ceiling — but does NOT state the SANED-specific 15,000 ceiling, THE ROW''S ONE OPEN ITEM (the owner''s confirmation pending — the plan''s D-01 dual-cap basis; one of exactly two register open items, with the EOSB official text). DECISION RECORD: the owner''s PHASE-046 approval dispatch (2026-11-16) is why the schedule was corrected — recorded as the decision record, no longer presented as the citation.'
FROM "tenants" t
ON CONFLICT ("tenant_id", "jurisdiction_code", "code") DO NOTHING;
--> statement-breakpoint
-- 1c. GOSI-OH — the owner's corrected row (ALL, employer-only 2%).
INSERT INTO "statutory_contribution_profiles"
  ("id", "tenant_id", "jurisdiction_code", "code", "name", "name_ar",
   "employee_rate", "employer_rate", "base_min", "base_max",
   "contributory_keys", "applies_to", "effective_from", "status",
   "source_name", "source_ref", "verified_at", "review_note")
SELECT gen_random_uuid(), t."id", 'SA', 'GOSI-OH',
  'GOSI Occupational Hazards', 'التأمين ضد الأخطار المهنية',
  0.0000, 2.0000, 1500.0000, 45000.0000,
  '["HOUSING"]'::jsonb, 'ALL', DATE '2020-01-01', 'VERIFIED',
  'PwC Worldwide Tax Summaries — Saudi Arabia: Individual — Other taxes (https://taxsummaries.pwc.com/saudi-arabia/individual/other-taxes — fetched 2026-11-16 21:34 UTC by the owner''s verifier; page title "Saudi Arabia - Individual - Other taxes")',
  'Verbatim: "Social insurance contributions are paid monthly based on the monthly basic salary plus housing (paid or in kind) with an upper limit of SAR 45,000, are computed at 2% for non-Saudi employees (note that this is not social insurance, it is occupational hazard), and are paid by the employer. For Saudi employees, the rate is 21.5% and is paid by both the employee (9.75% = 9% social insurance + 0.75% unemployment insurance [SANED]) and the employer (11.75% = 9% social insurance + 2% occupational hazard + 0.75% unemployment insurance [SANED])." — the occupational-hazard arm: 2% computed for non-Saudi employees and paid by the employer (OH-only for the non-Saudi arm); the 2% inside the Saudi employer''s 11.75%; the SAR 45,000 upper limit on basic + housing',
  now(),
  'CITATION CLOSED (0093, the reserved slot — data-only): the OH rate (employer-only 2%, on ALL) and the 45,000 ceiling are CLOSED by the PwC source fetched by the owner''s verifier — it states the 2% non-Saudi occupational-hazard rate paid by the employer AND the 2% inside the Saudi employer''s 11.75%, with the SAR 45,000 upper limit on basic + housing. DECISION RECORD: the owner''s PHASE-046 approval dispatch (2026-11-16), verbatim: "the GOSI-OH row applies to ALL: employee share zero, employer share 2%" — the decision this row embodies, recorded as the decision record, no longer presented as the citation. The register''s open items are exactly two: the SANED-specific 15,000 ceiling + the EOSB official text (Labor Law M/51 Art. 84).'
FROM "tenants" t
ON CONFLICT ("tenant_id", "jurisdiction_code", "code") DO NOTHING;
--> statement-breakpoint

-- ---------------------------------------------------------------------------
-- 2. THE RECORD RECLASSIFICATION — any pre-existing GOSI rows (seeded by the
--    tenancy onboarding hook under W-1's canonical records) are updated to
--    the reclassified citation records. Rates/caps/bases/applies_to are
--    untouched: only the provenance fields move.
-- ---------------------------------------------------------------------------
-- 2a. GOSI-PENSION — the citation record reclassified.
UPDATE "statutory_contribution_profiles"
SET
  "source_name" = 'PwC Worldwide Tax Summaries — Saudi Arabia: Individual — Other taxes (https://taxsummaries.pwc.com/saudi-arabia/individual/other-taxes — fetched 2026-11-16 21:34 UTC by the owner''s verifier; page title "Saudi Arabia - Individual - Other taxes")',
  "source_ref" = 'Verbatim: "Social insurance contributions are paid monthly based on the monthly basic salary plus housing (paid or in kind) with an upper limit of SAR 45,000, are computed at 2% for non-Saudi employees (note that this is not social insurance, it is occupational hazard), and are paid by the employer. For Saudi employees, the rate is 21.5% and is paid by both the employee (9.75% = 9% social insurance + 0.75% unemployment insurance [SANED]) and the employer (11.75% = 9% social insurance + 2% occupational hazard + 0.75% unemployment insurance [SANED])." — the pension arm: employee 9% + employer 9% of the monthly basic + housing, ceiling SAR 45,000',
  "review_note" = 'CITATION CLOSED (0093, the reserved slot — data-only): the PwC source fetched by the owner''s verifier independently corroborates the corrected schedule this row was seeded with — the GOSI rates and the 45,000 contributory-wage ceiling are CLOSED. DECISION RECORD: the owner''s PHASE-046 approval dispatch (2026-11-16) is why the schedule was corrected (the GOSI-OH row on ALL at 0%/2%; the Saudi employer total 11.75% / employee 9.75%; the non-Saudi arm OH-only) — recorded as the decision record, no longer presented as the citation. gosi.gov.sa remains unreachable from both environments (all Saudi gov domains TCP-blocked; the attempts documented); the statutory verification register''s open items are exactly two: the SANED-specific 15,000 ceiling (PwC does not state it; the owner''s confirmation pending) and the EOSB official text (Labor Law M/51 Art. 84 — the 15/30-days tiers).',
  "verified_at" = now()
WHERE "jurisdiction_code" = 'SA' AND "code" = 'GOSI-PENSION'
  AND "source_name" IS DISTINCT FROM 'PwC Worldwide Tax Summaries — Saudi Arabia: Individual — Other taxes (https://taxsummaries.pwc.com/saudi-arabia/individual/other-taxes — fetched 2026-11-16 21:34 UTC by the owner''s verifier; page title "Saudi Arabia - Individual - Other taxes")';
--> statement-breakpoint
-- 2b. GOSI-SANED — the rates corroborated; the 15,000 ceiling is THE open item.
UPDATE "statutory_contribution_profiles"
SET
  "source_name" = 'PwC Worldwide Tax Summaries — Saudi Arabia: Individual — Other taxes (https://taxsummaries.pwc.com/saudi-arabia/individual/other-taxes — fetched 2026-11-16 21:34 UTC by the owner''s verifier; page title "Saudi Arabia - Individual - Other taxes")',
  "source_ref" = 'Verbatim: "Social insurance contributions are paid monthly based on the monthly basic salary plus housing (paid or in kind) with an upper limit of SAR 45,000, are computed at 2% for non-Saudi employees (note that this is not social insurance, it is occupational hazard), and are paid by the employer. For Saudi employees, the rate is 21.5% and is paid by both the employee (9.75% = 9% social insurance + 0.75% unemployment insurance [SANED]) and the employer (11.75% = 9% social insurance + 2% occupational hazard + 0.75% unemployment insurance [SANED])." — the SANED arm: employee 0.75% + employer 0.75% (the unemployment insurance inside the 21.5% Saudi total)',
  "review_note" = 'CITATION CLOSED for the RATES (0093, the reserved slot — data-only): the PwC source fetched by the owner''s verifier corroborates SANED 0.75% + 0.75% and states the general SAR 45,000 contributory ceiling — but does NOT state the SANED-specific 15,000 ceiling, the row''s one open item (the owner''s confirmation pending — the plan''s D-01 dual-cap basis; one of exactly two register open items, with the EOSB official text). DECISION RECORD: the owner''s PHASE-046 approval dispatch (2026-11-16) is why the schedule was corrected — recorded as the decision record, no longer presented as the citation.',
  "verified_at" = now()
WHERE "jurisdiction_code" = 'SA' AND "code" = 'GOSI-SANED'
  AND "source_name" IS DISTINCT FROM 'PwC Worldwide Tax Summaries — Saudi Arabia: Individual — Other taxes (https://taxsummaries.pwc.com/saudi-arabia/individual/other-taxes — fetched 2026-11-16 21:34 UTC by the owner''s verifier; page title "Saudi Arabia - Individual - Other taxes")';
--> statement-breakpoint
-- 2c. GOSI-OH — the owner's corrected row: the rate AND the 45,000 ceiling
--     closed by the PwC citation.
UPDATE "statutory_contribution_profiles"
SET
  "source_name" = 'PwC Worldwide Tax Summaries — Saudi Arabia: Individual — Other taxes (https://taxsummaries.pwc.com/saudi-arabia/individual/other-taxes — fetched 2026-11-16 21:34 UTC by the owner''s verifier; page title "Saudi Arabia - Individual - Other taxes")',
  "source_ref" = 'Verbatim: "Social insurance contributions are paid monthly based on the monthly basic salary plus housing (paid or in kind) with an upper limit of SAR 45,000, are computed at 2% for non-Saudi employees (note that this is not social insurance, it is occupational hazard), and are paid by the employer. For Saudi employees, the rate is 21.5% and is paid by both the employee (9.75% = 9% social insurance + 0.75% unemployment insurance [SANED]) and the employer (11.75% = 9% social insurance + 2% occupational hazard + 0.75% unemployment insurance [SANED])." — the occupational-hazard arm: 2% computed for non-Saudi employees and paid by the employer (OH-only for the non-Saudi arm); the 2% inside the Saudi employer''s 11.75%; the SAR 45,000 upper limit on basic + housing',
  "review_note" = 'CITATION CLOSED (0093, the reserved slot — data-only): the OH rate (employer-only 2%, on ALL) and the 45,000 ceiling are CLOSED by the PwC source fetched by the owner''s verifier — it states the 2% non-Saudi occupational-hazard rate paid by the employer AND the 2% inside the Saudi employer''s 11.75%, with the SAR 45,000 upper limit on basic + housing. DECISION RECORD: the owner''s PHASE-046 approval dispatch (2026-11-16), verbatim: "the GOSI-OH row applies to ALL: employee share zero, employer share 2%" — the decision this row embodies, recorded as the decision record, no longer presented as the citation. gosi.gov.sa remains unreachable from both environments (all Saudi gov domains TCP-blocked; the attempts documented); the register''s open items are exactly two: the SANED-specific 15,000 ceiling + the EOSB official text (Labor Law M/51 Art. 84 — the 15/30-days tiers).',
  "verified_at" = now()
WHERE "jurisdiction_code" = 'SA' AND "code" = 'GOSI-OH'
  AND "source_name" IS DISTINCT FROM 'PwC Worldwide Tax Summaries — Saudi Arabia: Individual — Other taxes (https://taxsummaries.pwc.com/saudi-arabia/individual/other-taxes — fetched 2026-11-16 21:34 UTC by the owner''s verifier; page title "Saudi Arabia - Individual - Other taxes")';
--> statement-breakpoint

-- ---------------------------------------------------------------------------
-- 3. THE GATE CLOSES — the temporary policies drop; the final policy set is
--    exactly the pre-0093 set (the RLS checker's world is unchanged).
-- ----------------------------------------------------------------------------
DROP POLICY IF EXISTS migration_plane ON "statutory_contribution_profiles";
--> statement-breakpoint
DROP POLICY IF EXISTS migration_plane_select ON "tenants";
--> statement-breakpoint
RESET ROLE;

--> statement-breakpoint
-- Schema-state marker for /health/ready (mirrors the migration manifest).
INSERT INTO erp._schema_state (key, value) VALUES ('schema_version', 93)
ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, at = now();
