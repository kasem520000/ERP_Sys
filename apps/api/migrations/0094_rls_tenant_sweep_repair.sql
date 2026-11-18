-- PHASE-046 (Blueprint v3.0 · CR-16) · migration 0094 · the W-7 CLOSURE
-- WAVE — THE RLS LATENT NO-OP CLASS REPAIR (the owner's §1a.6 ruling,
-- 2026-11-16: the audit-fix wave's honest finding ruled a CLASS, not an
-- incident — "a general repair migration 0094 ships in the W-7 closure
-- wave — one file, the 0093 pattern … sweeping EVERY affected family …
-- closing the class; NO per-family drip").
--
--   THE CLASS (the 0093 finding, proven by probe on embedded PG16): under
--   FORCE ROW LEVEL SECURITY (0001 line 185 — "tenants" has been FORCE'd
--   from the very first migration) erp_migrate sees NO rows of "tenants"
--   (its only policy, tenant_isolation, is TO erp_app/erp_readonly and
--   tenant-GUC-scoped) and NO cross-tenant rows of the tenant tables (the
--   apply_tenant_policy macro: ENABLE + FORCE + tenant_isolation for
--   erp_app/erp_readonly — 0002). A migration runs with no tenant set, so
--   every per-tenant INSERT…SELECT…FROM "tenants" sweep executing as
--   erp_migrate selects ZERO source rows and silently inserts NOTHING on
--   tenant-ful databases. The test environment never sees it (its tenants
--   are created per-spec AFTER the migrations); the tenancy onboarding
--   path (as erp_app inside the tenant scope) is the only writer that
--   ever lands these rows — so tenants that existed BEFORE the sweep's
--   migration never received the seed.
--
--   THE OWNER'S §1a.6 BINDING REQUIREMENTS — all honored:
--   (a) FIRST the exhaustive inventory: every migration 0001…0093 scanned
--       for the FROM-"tenants" sweep pattern — THE INVENTORY BELOW;
--   (b) idempotent re-materialization with ON CONFLICT DO NOTHING against
--       the CANONICAL current shapes (one source: statutory-canonical.ts —
--       D-11's law; the 0093 citation records for GOSI, which this file
--       does NOT repeat — 0093 already repaired that family);
--   (c) the 0093 pre-state verification script pattern, end-to-end against
--       the realistic pre-states, its output kept as evidence
--       (audit-evidence/phase046-w7/m0094-prestate-verification.log);
--   (d) journal/manifest/spec pins to 94, the chain re-proven FROM ZERO;
--       genuinely-ambiguous families EXCLUDED and listed, never guessed.
--
--   ─────────────────────────────────────────────────────────────────────
--   THE EXHAUSTIVE INVENTORY — every INSERT…SELECT…FROM "tenants" site in
--   0001…0093 (the scan: 29 sites in five files; 0093's four are its own
--   already-delivered repair):
--
--   AFFECTED — THE SILENT NO-OP CLASS, REPAIRED HERE:
--   · 0009 §"per-tenant seeds" — 14 sites, all as erp_migrate:
--       uoms ×8 (PCS, KG, G, L, BOX, CTN, M, HR — is_system, the natural
--       key (tenant_id, code)), credit_terms ×4 (NET-7/15/30/60), and the
--       universal uom_conversions pair KG↔G (factors 1000 / 0.001; their
--       correlated subselects read the uoms rows the same sweep was to
--       seed) → §1 below. THE REAL HARM: tenants that predate 0009 never
--       received the master-data basics — the onboarding instantiator
--       (tenancy.store.seedMasterDataBasics) seeds them ONLY at tenant
--       creation, so an existing tenant has no path to them except this
--       repair.
--   · 0092 §3 — 8 sites, all as erp_migrate: the GOSI ×3 (REPAIRED by
--       0093 — NOT repeated here) + the FIVE REMAINING FAMILIES, repaired
--       in §2 below: the KSA EOSB tiers ×2 (0–5 years × 15 days/year;
--       > 5 years × 30 days/year), the AE/EG/JO SOCIAL-INSURANCE
--       placeholder profiles, the AE/EG/JO PIT-STANDARD placeholder
--       brackets, and the AE/EG/JO EOSB placeholder tiers.
--
--   EXAMINED — NOT AFFECTED (the reasons):
--   · 0063 erp.tenant_kind — NOT a sweep: a SECURITY DEFINER reader
--     function created as erp_definer (NOLOGIN BYPASSRLS, 0003's role);
--     a runtime surface whose SELECT executes as the definer and sees the
--     row. No migration-plane data ever rides it.
--   · 0064 notification_preferences — the one sweep in the chain that
--     runs `SET ROLE erp_definer` (NOLOGIN BYPASSRLS) before its
--     INSERT…SELECT…FROM "tenants": RLS is bypassed BY DESIGN (the house
--     pattern for exactly this shape — the one-shot seed with a scoped
--     INSERT grant, revoked immediately after); the seed LANDS.
--   · 0092 §1/§2 (the permission keys, the role grants, the plan grants)
--     — not FROM-tenants sweeps: "roles" is read through its template_seed
--     policy (erp_migrate sees tenant_id IS NULL template rows — the
--     WHERE clause targets exactly those), "permissions" carries no RLS,
--     "plans" carries plan_seed TO erp_migrate USING (true) WITH CHECK
--     (true). All landed.
--   · 0093's own four sites — the already-delivered GOSI repair (its own
--     file, its own gate, its own evidence); this file does not repeat it.
--
--   DISCOVERED — THE SAME LATENT CLASS, OUTSIDE THE RULED FROM-"tenants"
--   PATTERN — EXCLUDED, FLAGGED FOR THE OWNER, NEVER GUESSED:
--   · 0071 §5 (the default warehouse location tree — DEFAULT zone → A1 →
--     R1 → the DEFAULT bin + the FIFO pick strategy): per-tenant
--     INSERT…SELECT reading FROM "warehouses" — a tenant-scoped FORCE-RLS
--     table, so the same silent no-op shape exists for warehouses that
--     predate 0071 on tenant-ful databases. EXCLUDED from this repair
--     because: (a) the owner's §1a.6 ruling enumerates the FROM-"tenants"
--     class + 0092's remaining families — the warehouses sweep is
--     neither (its source table is "warehouses", not "tenants");
--     (b) the runtime canonical seeder exists and is the D-5 design —
--     wms-store.ensureDefaultBin materializes the DEFAULT zone/aisle/
--     rack/bin "on the first bin-aware write — the exact shape the
--     migration seeded for existing warehouses" — so the surface
--     self-heals wherever it is used; (c) repairing beyond the ruled
--     scope would be a guess about the owner's intent. If the owner
--     rules it in, a 0095-class repair sweeps it in one statement.
--     [RULED 2026-11-18 (the owner's W-9 verification dispatch): NO
--     REPAIR — the flagged item CLOSES as ruled-no-action. The pick-
--     strategy arm rides upsertPickStrategyRow, structurally idempotent
--     on the tenant+warehouse unique — verified by the owner, who read
--     the migration and the runtime paths (ensureDefaultBin recreates
--     the exact migration shape, pinned across the inventory DB suite
--     incl. the race and conflict specs; a 0094-style re-materialization
--     would add no capability and risks conflicting with the lazy
--     floors).]
--
--   THE CANONICAL-SHAPE NOTE (honest, dated 2026-11-17): 0092 §3e's
--   placeholder profile names embedded the jurisdiction LABEL
--   ('UAE'/'Egypt'/'Jordan'); the canonical ONE SOURCE (statutory-
--   canonical.ts — D-11's "one source, auditable, never a second
--   hand-typed copy") uses the jurisdiction CODE ('AE'/'EG'/'JO'), and
--   the KSA EOSB review notes carry the TS wording. 0092's sweep never
--   landed a single row anywhere (the RLS no-op — the very class this
--   migration repairs), so NO existing row carries the 0092 text shape;
--   per the ruling's "CANONICAL current shapes", §2 below materializes
--   EXACTLY the statutory-canonical.ts shapes (the same rows every
--   post-0092 tenant already carries from the onboarding path). The
--   drift is disclosed here, never silently resolved.
--
--   THE MECHANISM (the 0093 pattern): an explicit, temporary,
--   self-dropped MIGRATION-PLANE POLICY GATE — created and dropped inside
--   this one migration file (crash-safe: both sides DROP IF EXISTS, a
--   crashed attempt that left a policy behind converges when drizzle
--   re-runs this file), so the FINAL policy set is EXACTLY the pre-0094
--   set (the RLS checker's world is unchanged). DATA-ONLY: 0089–0093 stay
--   byte-stable; no schema, no constraint, no policy survives the file.
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
DROP POLICY IF EXISTS migration_plane ON "uoms";
--> statement-breakpoint
CREATE POLICY migration_plane ON "uoms"
  FOR ALL TO erp_migrate USING (true) WITH CHECK (true);
--> statement-breakpoint
DROP POLICY IF EXISTS migration_plane ON "credit_terms";
--> statement-breakpoint
CREATE POLICY migration_plane ON "credit_terms"
  FOR ALL TO erp_migrate USING (true) WITH CHECK (true);
--> statement-breakpoint
DROP POLICY IF EXISTS migration_plane ON "uom_conversions";
--> statement-breakpoint
CREATE POLICY migration_plane ON "uom_conversions"
  FOR ALL TO erp_migrate USING (true) WITH CHECK (true);
--> statement-breakpoint
DROP POLICY IF EXISTS migration_plane ON "statutory_contribution_profiles";
--> statement-breakpoint
CREATE POLICY migration_plane ON "statutory_contribution_profiles"
  FOR ALL TO erp_migrate USING (true) WITH CHECK (true);
--> statement-breakpoint
DROP POLICY IF EXISTS migration_plane ON "payroll_tax_brackets";
--> statement-breakpoint
CREATE POLICY migration_plane ON "payroll_tax_brackets"
  FOR ALL TO erp_migrate USING (true) WITH CHECK (true);
--> statement-breakpoint
DROP POLICY IF EXISTS migration_plane ON "eosb_rules";
--> statement-breakpoint
CREATE POLICY migration_plane ON "eosb_rules"
  FOR ALL TO erp_migrate USING (true) WITH CHECK (true);
--> statement-breakpoint

-- ---------------------------------------------------------------------------
-- 1. THE 0009 MASTER-DATA RE-MATERIALIZATION — every tenant the 0009
--    sweep silently missed gets the canonical basics (the 0009 statements
--    verbatim — the same set the onboarding instantiator seeds for NEW
--    tenants: 8 common units, the universal kg↔g pair, NET-7/15/30/60;
--    idempotent by natural key).
-- ---------------------------------------------------------------------------
-- 1a. uoms (8) — tenant-extendable, is_system, the natural key
--     (tenant_id, code).
INSERT INTO "uoms" ("id", "tenant_id", "code", "name", "name_ar", "is_system")
SELECT gen_random_uuid(), t."id", 'PCS', 'Piece', 'قطعة', true
FROM "tenants" t WHERE t."deleted_at" IS NULL
ON CONFLICT ("tenant_id", "code") DO NOTHING;
--> statement-breakpoint
INSERT INTO "uoms" ("id", "tenant_id", "code", "name", "name_ar", "is_system")
SELECT gen_random_uuid(), t."id", 'KG', 'Kilogram', 'كيلوجرام', true
FROM "tenants" t WHERE t."deleted_at" IS NULL
ON CONFLICT ("tenant_id", "code") DO NOTHING;
--> statement-breakpoint
INSERT INTO "uoms" ("id", "tenant_id", "code", "name", "name_ar", "is_system")
SELECT gen_random_uuid(), t."id", 'G', 'Gram', 'جرام', true
FROM "tenants" t WHERE t."deleted_at" IS NULL
ON CONFLICT ("tenant_id", "code") DO NOTHING;
--> statement-breakpoint
INSERT INTO "uoms" ("id", "tenant_id", "code", "name", "name_ar", "is_system")
SELECT gen_random_uuid(), t."id", 'L', 'Liter', 'لتر', true
FROM "tenants" t WHERE t."deleted_at" IS NULL
ON CONFLICT ("tenant_id", "code") DO NOTHING;
--> statement-breakpoint
INSERT INTO "uoms" ("id", "tenant_id", "code", "name", "name_ar", "is_system")
SELECT gen_random_uuid(), t."id", 'BOX', 'Box', 'صندوق', true
FROM "tenants" t WHERE t."deleted_at" IS NULL
ON CONFLICT ("tenant_id", "code") DO NOTHING;
--> statement-breakpoint
INSERT INTO "uoms" ("id", "tenant_id", "code", "name", "name_ar", "is_system")
SELECT gen_random_uuid(), t."id", 'CTN', 'Carton', 'كرتونة', true
FROM "tenants" t WHERE t."deleted_at" IS NULL
ON CONFLICT ("tenant_id", "code") DO NOTHING;
--> statement-breakpoint
INSERT INTO "uoms" ("id", "tenant_id", "code", "name", "name_ar", "is_system")
SELECT gen_random_uuid(), t."id", 'M', 'Meter', 'متر', true
FROM "tenants" t WHERE t."deleted_at" IS NULL
ON CONFLICT ("tenant_id", "code") DO NOTHING;
--> statement-breakpoint
INSERT INTO "uoms" ("id", "tenant_id", "code", "name", "name_ar", "is_system")
SELECT gen_random_uuid(), t."id", 'HR', 'Hour', 'ساعة', true
FROM "tenants" t WHERE t."deleted_at" IS NULL
ON CONFLICT ("tenant_id", "code") DO NOTHING;
--> statement-breakpoint
-- 1b. credit_terms (4) — the natural key (tenant_id, code).
INSERT INTO "credit_terms" ("id", "tenant_id", "code", "name", "name_ar", "days", "is_system")
SELECT gen_random_uuid(), t."id", 'NET-7', 'Net 7 days', 'صافي 7 أيام', 7, true
FROM "tenants" t WHERE t."deleted_at" IS NULL
ON CONFLICT ("tenant_id", "code") DO NOTHING;
--> statement-breakpoint
INSERT INTO "credit_terms" ("id", "tenant_id", "code", "name", "name_ar", "days", "is_system")
SELECT gen_random_uuid(), t."id", 'NET-15', 'Net 15 days', 'صافي 15 يومًا', 15, true
FROM "tenants" t WHERE t."deleted_at" IS NULL
ON CONFLICT ("tenant_id", "code") DO NOTHING;
--> statement-breakpoint
INSERT INTO "credit_terms" ("id", "tenant_id", "code", "name", "name_ar", "days", "is_system")
SELECT gen_random_uuid(), t."id", 'NET-30', 'Net 30 days', 'صافي 30 يومًا', 30, true
FROM "tenants" t WHERE t."deleted_at" IS NULL
ON CONFLICT ("tenant_id", "code") DO NOTHING;
--> statement-breakpoint
INSERT INTO "credit_terms" ("id", "tenant_id", "code", "name", "name_ar", "days", "is_system")
SELECT gen_random_uuid(), t."id", 'NET-60', 'Net 60 days', 'صافي 60 يومًا', 60, true
FROM "tenants" t WHERE t."deleted_at" IS NULL
ON CONFLICT ("tenant_id", "code") DO NOTHING;
--> statement-breakpoint
-- 1c. uom_conversions (2) — the universal metric pair only (kg↔g; factors
--     exact at 6-dp; box/carton factors stay tenant-specific by design).
--     The correlated subselects read the uoms rows §1a just materialized
--     (visible through the migration-plane policy).
INSERT INTO "uom_conversions" ("id", "tenant_id", "from_uom_id", "to_uom_id", "factor")
SELECT gen_random_uuid(), t."id",
  (SELECT "id" FROM "uoms" u WHERE u."tenant_id" = t."id" AND u."code" = 'KG'),
  (SELECT "id" FROM "uoms" u WHERE u."tenant_id" = t."id" AND u."code" = 'G'), 1000
FROM "tenants" t WHERE t."deleted_at" IS NULL
ON CONFLICT ("tenant_id", "from_uom_id", "to_uom_id") DO NOTHING;
--> statement-breakpoint
INSERT INTO "uom_conversions" ("id", "tenant_id", "from_uom_id", "to_uom_id", "factor")
SELECT gen_random_uuid(), t."id",
  (SELECT "id" FROM "uoms" u WHERE u."tenant_id" = t."id" AND u."code" = 'G'),
  (SELECT "id" FROM "uoms" u WHERE u."tenant_id" = t."id" AND u."code" = 'KG'), 0.001
FROM "tenants" t WHERE t."deleted_at" IS NULL
ON CONFLICT ("tenant_id", "from_uom_id", "to_uom_id") DO NOTHING;
--> statement-breakpoint

-- ---------------------------------------------------------------------------
-- 2. THE 0092 REMAINING-FAMILIES RE-MATERIALIZATION — the canonical
--    current shapes (statutory-canonical.ts, the ONE source; the same rows
--    every post-0092 tenant carries from the onboarding path). The GOSI
--    family is NOT repeated — 0093 already repaired it with the final
--    citation records.
-- ---------------------------------------------------------------------------
-- 2a. The KSA EOSB tiers (the labor-law award — the per-year fold).
INSERT INTO "eosb_rules"
  ("id", "tenant_id", "jurisdiction_code", "from_years", "to_years",
   "days_per_year", "contract_type", "effective_from", "status",
   "source_name", "source_ref", "verified_at", "review_note")
SELECT gen_random_uuid(), t."id", 'SA', 0.00, 5.00, 15.00,
  NULL, DATE '2020-01-01', 'VERIFIED',
  'Saudi Labor Law (Royal Decree M/51, as amended) — the end-of-service award',
  'The phase doc''s own worked shape: half a month''s wage per year for the first five years, a full month thereafter (the per-year tier fold)',
  now(),
  'The first tier of the per-year fold (0–5 years × 15 days).'
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
  'The phase doc''s own worked shape: half a month''s wage per year for the first five years, a full month thereafter (the per-year tier fold)',
  now(),
  'The open-top tier (> 5 years × 30 days — 7 years → 5×15 + 2×30 = 135 days).'
FROM "tenants" t
ON CONFLICT DO NOTHING;
--> statement-breakpoint
-- 2b. The AE/EG/JO placeholder profiles — the blocked-state surface (no
--     fabricated rates: 0-rate rows that BR-085 refuses until the tenant
--     enters the official figures and verifies them). The names use the
--     jurisdiction CODE per the canonical one-source (statutory-
--     canonical.ts) — see THE CANONICAL-SHAPE NOTE in the header.
INSERT INTO "statutory_contribution_profiles"
  ("id", "tenant_id", "jurisdiction_code", "code", "name", "name_ar",
   "employee_rate", "employer_rate", "base_min", "base_max",
   "contributory_keys", "applies_to", "effective_from", "status", "review_note")
SELECT gen_random_uuid(), t."id", j.code, 'SOCIAL-INSURANCE',
  'Social insurance (' || j.code || ') — pending official verification',
  'التأمينات الاجتماعية — بانتظار التحقق الرسمي',
  0.0000, 0.0000, NULL, NULL,
  '[]'::jsonb, 'ALL', DATE '2020-01-01', 'REQUIRES_VERIFICATION',
  'No rate seeded — the jurisdiction''s official schedule is the owner''s open item (the statutory verification register). The row exists to surface the blocked state, never a guessed rate (BR-085/BR-055).'
FROM "tenants" t
CROSS JOIN (VALUES
  ('AE'),
  ('EG'),
  ('JO')
) AS j(code)
ON CONFLICT ("tenant_id", "jurisdiction_code", "code") DO NOTHING;
--> statement-breakpoint
-- 2c. The AE/EG/JO placeholder PIT bracket sets.
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
  ('AE'),
  ('EG'),
  ('JO')
) AS j(code)
ON CONFLICT ("tenant_id", "jurisdiction_code", "code", "effective_from", "sort") DO NOTHING;
--> statement-breakpoint
-- 2d. The AE/EG/JO placeholder EOSB tiers.
INSERT INTO "eosb_rules"
  ("id", "tenant_id", "jurisdiction_code", "from_years", "to_years",
   "days_per_year", "contract_type", "effective_from", "status", "review_note")
SELECT gen_random_uuid(), t."id", j.code, 0.00, NULL, 0.00,
  NULL, DATE '2020-01-01', 'REQUIRES_VERIFICATION',
  'No tier seeded — the jurisdiction''s official end-of-service schedule is the owner''s open item (the statutory verification register). The row exists to surface the blocked state, never a guessed rate (BR-085/BR-055).'
FROM "tenants" t
CROSS JOIN (VALUES
  ('AE'),
  ('EG'),
  ('JO')
) AS j(code)
ON CONFLICT DO NOTHING;
--> statement-breakpoint

-- ---------------------------------------------------------------------------
-- 3. THE GATE CLOSES — the temporary policies drop; the final policy set
--    is exactly the pre-0094 set (the RLS checker's world is unchanged).
-- ---------------------------------------------------------------------------
DROP POLICY IF EXISTS migration_plane ON "eosb_rules";
--> statement-breakpoint
DROP POLICY IF EXISTS migration_plane ON "payroll_tax_brackets";
--> statement-breakpoint
DROP POLICY IF EXISTS migration_plane ON "statutory_contribution_profiles";
--> statement-breakpoint
DROP POLICY IF EXISTS migration_plane ON "uom_conversions";
--> statement-breakpoint
DROP POLICY IF EXISTS migration_plane ON "credit_terms";
--> statement-breakpoint
DROP POLICY IF EXISTS migration_plane ON "uoms";
--> statement-breakpoint
DROP POLICY IF EXISTS migration_plane_select ON "tenants";
--> statement-breakpoint
RESET ROLE;

--> statement-breakpoint
-- Schema-state marker for /health/ready (mirrors the migration manifest).
INSERT INTO erp._schema_state (key, value) VALUES ('schema_version', 94)
ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, at = now();
