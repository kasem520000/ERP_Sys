-- PHASE-034 · migration 0041 · multi-entity consolidation (ED-10, stage 11)
--
-- Purpose (PHASE-034 §4 Design Impact + ADR-0018 + DR-006 option A): the
-- consolidation module lands as the FINAL roadmap phase — a legal entity =
-- a tenant (unchanged, ADR-0005); consolidation groups as CONFIGURATION in
-- the module (not a tenancy change); elimination entries as balanced
-- journals posted via the posting engine into the PARENT tenant's
-- consolidation books (source_type CONSOLIDATION_ELIMINATION, golden G-32,
-- reversal-only per BR-056); consolidation runs as read-only aggregations
-- over member books through the ONE audited platform-plane reader — the
-- only sanctioned cross-tenant reader in the platform — with ZERO
-- cross-tenant writes (the reader role holds SELECT-only grants; write
-- attempts fail at the DB grant level); FX translation with dated stored
-- rates (INV-008) per the OQ-V2-2 decision record (DR-P34-FX-1 amending
-- DR-006 §4: CLOSING_RATE default, explicit per-group
-- fx_translation_method); members required to have CLOSED fiscal periods
-- (BR-056 — the reader function itself re-verifies before returning a
-- row, defense in depth on top of the service pre-check).
--
-- Four register §C tables (all tenant-owned + RLS via the house macro +
-- composite tenant FKs + hot indexes; NONE marked append-only 🔒 in the
-- register — eliminations are DRAFT→POSTED documents whose immutable
-- posted state is engine-owned, and snapshots are guarded by trigger):
--   consolidation_groups  — owner_tenant_id, name/name_ar, base_currency,
--                           fx_translation_method (OQ-V2-2), status
--   group_entities        — group_id, member_tenant_id,
--                           ownership_percent numeric(7,4), include_from,
--                           status (ADR-0018 §1: configuration, not tenancy)
--   elimination_entries   — group_id, fiscal_period_id, description,
--                           status DRAFT/POSTED, journal_entry_ids; DRAFT
--                           body authored over member-pair lines (jsonb),
--                           official elimination_no assigned at POST
--                           (numbering service, INV-021)
--   consolidation_runs    — group_id, fiscal_period_id, status
--                           QUEUED/RUNNING/COMPLETED/FAILED
--                           (consolidation_run_status §9 enum as CHECK),
--                           immutable+versioned snapshot jsonb (ADR-0017:
--                           a derived artifact, never a second ledger)
--
-- The §9 enum (consolidation_run_status) is a CHECK constraint per the
-- DATA_DICTIONARY enum registry (the 0037 five-enum precedent).
--
-- The platform-plane reader grant (ADR-0018 §3 — the ONLY grant of its
-- kind in the platform):
--   * role erp_consolidation_reader — NOLOGIN (disabled-by-default: it
--     cannot authenticate; enabling LOGIN is the reviewed ops
--     configuration) + BYPASSRLS (the 0003 erp_definer precedent: FORCE
--     RLS binds even the table owner, so a controlled escape hatch MUST
--     live on a bypass role — the RLS policy set itself stays
--     byte-identical, no member policy is touched, the canary is green);
--   * SELECT-only grants on the member GL read models (journal_entries,
--     journal_lines, accounts, account_purposes, fiscal_periods) + the
--     consolidation tables for membership validation — NO
--     INSERT/UPDATE/DELETE ANYWHERE: write attempts through the role fail
--     at the DB grant level;
--   * ONE SECURITY DEFINER reader function
--     erp.consolidation_read_member_gl(group, member, period) — the
--     per-query acquisition of the grant: it validates ACTIVE membership
--     + include_from + the member's CLOSED period (BR-056) and returns
--     the posted journal-line account aggregates for exactly that member
--     and period. EXECUTE granted to erp_app only (REVOKEd from PUBLIC);
--     the SERVICE writes the audit row in the same UoW as every call
--     (read-audit completeness: audit rows == reads).
--
-- Permission seeds (AUTHORIZATION_MATRIX §3.15 — 5 keys; drift checker
-- requires matrix ↔ seed parity; ALSO seeded in-phase into
-- 0004_permissions_seed.sql per the 0037/0038 idempotent two-site
-- precedent): consolidation.groups.manage, consolidation.eliminations.create,
-- consolidation.eliminations.post (approval-gated, SoD creator ≠ approver —
-- §4 row, service-enforced + audited), consolidation.runs.execute (audited),
-- consolidation.reports.view.
--
-- Plan grants (FEATURE_CATALOG §19 protocol step 3): the five
-- consolidation.* feature keys join business + enterprise (the tier-4
-- financial-depth precedent — fixed assets 0037, notes/installments 0038);
-- starter does NOT get them.
--
-- CoA template (§11): the v2.0 CONSOLIDATION_ADJUSTMENT purpose (CHART_OF
-- ACCOUNTS §2 row — used only in the parent's consolidation books) gains
-- template account 3220 (EQUITY leaf under 3000, the 3210 revaluation
-- precedent), so provisioned parents resolve the purpose from day one;
-- intercompany elimination lines ride the EXISTING AR_CONTROL / AP_CONTROL
-- purposes (G-32 — no new purpose keys; tenants map intercompany-specific
-- accounts via account_purposes per the fail-closed PURPOSE_NOT_MAPPED
-- rule).
--
-- No migrations touch existing tables (purely additive; expand-compatible
-- per MIGRATION_STRATEGY; the RLS policy snapshot is byte-identical
-- before/after — the isolation suite + canary prove it).

--> statement-breakpoint
-- The platform-plane reader role, created while still the bootstrap
-- superuser (CREATE ROLE needs CREATEROLE — the 0003 erp_definer
-- precedent). Provisioned environments that run migrations as
-- erp_migrate directly must create the role in the ops bootstrap (same
-- envelope as role passwords) AND `GRANT erp_consolidation_reader TO
-- erp_migrate` so the §8b SET ROLE below stays permitted — the migration
-- fails closed otherwise, never silently degrades.
DO $reader_role$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'erp_consolidation_reader') THEN
    CREATE ROLE erp_consolidation_reader NOLOGIN BYPASSRLS;
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_auth_members m
      JOIN pg_roles g ON g.oid = m.roleid
      JOIN pg_roles u ON u.oid = m.member
     WHERE g.rolname = 'erp_consolidation_reader' AND u.rolname = 'erp_migrate'
  ) THEN
    GRANT erp_consolidation_reader TO erp_migrate;
  END IF;
END
$reader_role$;

--> statement-breakpoint
SET ROLE erp_migrate;

--> statement-breakpoint
-- ---------------------------------------------------------------------------
-- 1. consolidation_groups (T4): the group as configuration in the owner
--    tenant's plane (ADR-0018 §1 — a legal entity = a tenant, unchanged).
--    base_currency is the GROUP's reporting currency (the consolidated
--    statements' currency — typically the owner's base currency but an
--    explicit choice); fx_translation_method carries the OQ-V2-2 decision
--    (DR-P34-FX-1: CLOSING_RATE default, TEMPORARY the bounded
--    alternative); status ACTIVE/ARCHIVED (archived groups are read-only
--    history — no new runs, no new eliminations).
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "consolidation_groups" (
  "id" uuid NOT NULL,
  "tenant_id" uuid NOT NULL REFERENCES "tenants" ("id") ON DELETE RESTRICT,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "updated_at" timestamptz NOT NULL DEFAULT now(),
  "version" integer NOT NULL DEFAULT 1,
  "created_by" uuid,
  "name" text NOT NULL,
  "name_ar" text NOT NULL,
  "base_currency" varchar(3) NOT NULL,
  "fx_translation_method" text NOT NULL DEFAULT 'CLOSING_RATE',
  "status" text NOT NULL DEFAULT 'ACTIVE',
  "note" text,
  "note_ar" text,
  CONSTRAINT pk_consolidation_groups PRIMARY KEY ("id"),
  CONSTRAINT uq_consolidation_groups_id_tenant UNIQUE ("id", "tenant_id"),
  CONSTRAINT uq_consolidation_groups_tenant_name UNIQUE ("tenant_id", "name"),
  CONSTRAINT ck_consolidation_groups_currency CHECK ("base_currency" ~ '^[A-Z]{3}$'),
  CONSTRAINT ck_consolidation_groups_fx_method CHECK ("fx_translation_method" IN
    ('CLOSING_RATE', 'TEMPORARY')),
  CONSTRAINT ck_consolidation_groups_status CHECK ("status" IN ('ACTIVE', 'ARCHIVED')),
  CONSTRAINT ck_consolidation_groups_name_len CHECK (length("name") BETWEEN 1 AND 200
    AND length("name_ar") BETWEEN 1 AND 200)
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS ix_consolidation_groups_tenant_status
  ON "consolidation_groups" ("tenant_id", "status");
--> statement-breakpoint
COMMENT ON TABLE "consolidation_groups" IS
  'PHASE-034 T4: consolidation groups — configuration in the owner tenant plane (ADR-0018 §1: a legal entity = a tenant, group membership is NOT a tenancy change). base_currency = the group reporting currency; fx_translation_method = the OQ-V2-2 decision (DR-P34-FX-1: CLOSING_RATE default, TEMPORARY bounded to the PHASE-034 surface); ownership_percent on group_entities is disclosure/minority-interest presentation only (DR-006 — no waterfall automation promised).';

--> statement-breakpoint
-- ---------------------------------------------------------------------------
-- 2. group_entities (T4): membership. tenant_id is the OWNER tenant (the
--    row lives in the owner plane — one RLS universe); member_tenant_id
--    references tenants WITHOUT a tenant_id composite (deliberately: the
--    member is a DIFFERENT tenant by design — this is the configuration
--    edge ADR-0018 sanctions; every READ through it is audited via the
--    reader function, and the plan-table audit columns record who
--    maintained what). ownership_percent numeric(7,4) (DATA_DICTIONARY §6)
--    recorded for disclosure; include_from bounds the member consolidated
--    periods (NULL = from the beginning).
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "group_entities" (
  "id" uuid NOT NULL,
  "tenant_id" uuid NOT NULL REFERENCES "tenants" ("id") ON DELETE RESTRICT,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "updated_at" timestamptz NOT NULL DEFAULT now(),
  "version" integer NOT NULL DEFAULT 1,
  "created_by" uuid,
  "group_id" uuid NOT NULL,
  "member_tenant_id" uuid NOT NULL REFERENCES "tenants" ("id") ON DELETE RESTRICT,
  "ownership_percent" numeric(7,4) NOT NULL DEFAULT 100,
  "include_from" date,
  "status" text NOT NULL DEFAULT 'ACTIVE',
  "note" text,
  "note_ar" text,
  CONSTRAINT pk_group_entities PRIMARY KEY ("id"),
  CONSTRAINT uq_group_entities_id_tenant UNIQUE ("id", "tenant_id"),
  CONSTRAINT uq_group_entities_group_member UNIQUE ("group_id", "member_tenant_id"),
  CONSTRAINT fk_group_entities_group FOREIGN KEY ("group_id", "tenant_id")
    REFERENCES "consolidation_groups" ("id", "tenant_id") ON DELETE RESTRICT,
  CONSTRAINT ck_group_entities_ownership CHECK ("ownership_percent" > 0
    AND "ownership_percent" <= 100),
  CONSTRAINT ck_group_entities_status CHECK ("status" IN ('ACTIVE', 'REMOVED'))
);
--> statement-breakpoint
-- Hot path: the run pre-check + reader membership validation.
CREATE INDEX IF NOT EXISTS ix_group_entities_tenant_group
  ON "group_entities" ("tenant_id", "group_id", "status");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS ix_group_entities_member
  ON "group_entities" ("member_tenant_id", "status");
--> statement-breakpoint
COMMENT ON TABLE "group_entities" IS
  'PHASE-034 T4: group membership — the configuration edge ADR-0018 sanctions (member_tenant_id deliberately NOT composite: the member is another tenant BY DESIGN). ownership_percent numeric(7,4) for disclosure/minority-interest presentation only (DR-006); include_from bounds consolidated periods (NULL = from inception); the owner is itself typically a member. REMOVED members stay as history (INV-015 posture: deactivation, not deletion).';

--> statement-breakpoint
-- ---------------------------------------------------------------------------
-- 3. elimination_entries (T5): DRAFT → POSTED documents. The DRAFT body is
--    authored over member-pair lines (jsonb — the manual authoring surface;
--    the automatic matching engine is OUT OF SCOPE per the phase plan) with
--    the live balanced DR/CR preview; POST pushes the lines through
--    PostingEngine.post (source_type CONSOLIDATION_ELIMINATION) into the
--    PARENT tenant's consolidation books ONLY. Posted rows are immutable
--    (INV-003); corrections are reversal-only counter-entries (BR-056) — a
--    NEW DRAFT→POSTED pair linked through reversal_of. journal_entry_ids
--    accumulates the post + reversal entry ids (engine-owned chain,
--    INV-006). Official elimination_no assigned at POST (numbering service,
--    INV-021, docType consolidation_elimination, EL-{YYYY}-{SEQ:6}).
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "elimination_entries" (
  "id" uuid NOT NULL,
  "tenant_id" uuid NOT NULL REFERENCES "tenants" ("id") ON DELETE RESTRICT,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "updated_at" timestamptz NOT NULL DEFAULT now(),
  "version" integer NOT NULL DEFAULT 1,
  "created_by" uuid,
  "group_id" uuid NOT NULL,
  "fiscal_period_id" uuid NOT NULL,
  "elimination_no" text,
  "kind" text NOT NULL DEFAULT 'INTERCOMPANY',
  "description" text NOT NULL,
  "member_a_tenant_id" uuid,
  "member_b_tenant_id" uuid,
  "lines" jsonb NOT NULL DEFAULT '[]'::jsonb,
  "status" text NOT NULL DEFAULT 'DRAFT',
  "approved_by" uuid,
  "approved_at" timestamptz,
  "posted_at" timestamptz,
  "posted_by" uuid,
  "journal_entry_ids" jsonb NOT NULL DEFAULT '[]'::jsonb,
  "reversal_of" uuid,
  "note" text,
  "note_ar" text,
  CONSTRAINT pk_elimination_entries PRIMARY KEY ("id"),
  CONSTRAINT uq_elimination_entries_id_tenant UNIQUE ("id", "tenant_id"),
  CONSTRAINT fk_elimination_entries_group FOREIGN KEY ("group_id", "tenant_id")
    REFERENCES "consolidation_groups" ("id", "tenant_id") ON DELETE RESTRICT,
  CONSTRAINT fk_elimination_entries_period FOREIGN KEY ("fiscal_period_id", "tenant_id")
    REFERENCES "fiscal_periods" ("id", "tenant_id") ON DELETE RESTRICT,
  CONSTRAINT fk_elimination_entries_reversal_of FOREIGN KEY ("reversal_of", "tenant_id")
    REFERENCES "elimination_entries" ("id", "tenant_id") ON DELETE RESTRICT,
  CONSTRAINT ck_elimination_entries_kind CHECK ("kind" IN ('INTERCOMPANY', 'INVESTMENT_EQUITY')),
  CONSTRAINT ck_elimination_entries_status_values CHECK ("status" IN ('DRAFT', 'POSTED')),
  CONSTRAINT ck_elimination_entries_description CHECK (length("description") BETWEEN 1 AND 500)
);
--> statement-breakpoint
-- Partial unique index: one official elimination_no per tenant, NULL while DRAFT.
CREATE UNIQUE INDEX IF NOT EXISTS uq_elimination_entries_tenant_no
  ON "elimination_entries" ("tenant_id", "elimination_no")
  WHERE "elimination_no" IS NOT NULL;
--> statement-breakpoint
-- Hot index (the phase §4 shape): (tenant, group, fiscal period).
CREATE INDEX IF NOT EXISTS ix_elimination_entries_tenant_group_period
  ON "elimination_entries" ("tenant_id", "group_id", "fiscal_period_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS ix_elimination_entries_tenant_status
  ON "elimination_entries" ("tenant_id", "status");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS ix_elimination_entries_reversal_of
  ON "elimination_entries" ("tenant_id", "reversal_of");
--> statement-breakpoint
COMMENT ON TABLE "elimination_entries" IS
  'PHASE-034 T5: elimination documents — DRAFT over member-pair lines (jsonb manual authoring; suggestions from member AR/AP subledgers are human-confirmed) → POST via PostingEngine.post (source CONSOLIDATION_ELIMINATION, G-32 intercompany: DR AP_CONTROL entity B · CR AR_CONTROL entity A; investment/equity lines through the CONSOLIDATION_ADJUSTMENT purpose) into the PARENT consolidation books ONLY — zero rows in any member ledger. Posted = immutable (INV-003); reversal-only counter-entries (BR-056) as new DRAFT→POSTED pairs (reversal_of). SoD: approved_by ≠ created_by before post (§4).';

--> statement-breakpoint
-- ---------------------------------------------------------------------------
-- 4. consolidation_runs (T6): QUEUED → RUNNING → COMPLETED/FAILED as
--    bounded pg-boss jobs (ADR-0008). snapshot is the immutable, versioned
--    output (member statement extracts in group currency at dated stored
--    rates + the frozen elimination set) — a DERIVED artifact (ADR-0017:
--    never a second ledger; statements read snapshots, never live member
--    books). Re-runs are NEW rows (old snapshots never mutate); FAILED
--    runs leave no partial snapshot (NULL). The guard trigger (§5 below)
--    makes COMPLETED snapshots rewrite-proof at the DB level.
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "consolidation_runs" (
  "id" uuid NOT NULL,
  "tenant_id" uuid NOT NULL REFERENCES "tenants" ("id") ON DELETE RESTRICT,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "updated_at" timestamptz NOT NULL DEFAULT now(),
  "version" integer NOT NULL DEFAULT 1,
  "created_by" uuid,
  "group_id" uuid NOT NULL,
  "fiscal_period_id" uuid NOT NULL,
  "status" text NOT NULL DEFAULT 'QUEUED',
  "snapshot_version" integer NOT NULL DEFAULT 1,
  "snapshot" jsonb,
  "job_id" text,
  "started_at" timestamptz,
  "completed_at" timestamptz,
  "error_code" text,
  "error_detail" jsonb,
  "note" text,
  CONSTRAINT pk_consolidation_runs PRIMARY KEY ("id"),
  CONSTRAINT uq_consolidation_runs_id_tenant UNIQUE ("id", "tenant_id"),
  CONSTRAINT fk_consolidation_runs_group FOREIGN KEY ("group_id", "tenant_id")
    REFERENCES "consolidation_groups" ("id", "tenant_id") ON DELETE RESTRICT,
  CONSTRAINT fk_consolidation_runs_period FOREIGN KEY ("fiscal_period_id", "tenant_id")
    REFERENCES "fiscal_periods" ("id", "tenant_id") ON DELETE RESTRICT,
  CONSTRAINT ck_consolidation_runs_status_values CHECK ("status" IN
    ('QUEUED', 'RUNNING', 'COMPLETED', 'FAILED')),
  CONSTRAINT ck_consolidation_runs_snapshot_shape CHECK (
    ("status" = 'COMPLETED' AND "snapshot" IS NOT NULL AND "snapshot_version" >= 1)
    OR ("status" <> 'COMPLETED' AND "snapshot" IS NULL)),
  CONSTRAINT ck_consolidation_runs_error_shape CHECK (
    ("status" = 'FAILED' AND "error_code" IS NOT NULL)
    OR ("status" <> 'FAILED' AND "error_code" IS NULL))
);
--> statement-breakpoint
-- Hot indexes: (tenant, group, fiscal period) per the phase §4 shape + the
-- statement render lookup (the LATEST completed run for a period).
CREATE INDEX IF NOT EXISTS ix_consolidation_runs_tenant_group_period
  ON "consolidation_runs" ("tenant_id", "group_id", "fiscal_period_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS ix_consolidation_runs_tenant_status
  ON "consolidation_runs" ("tenant_id", "status");
--> statement-breakpoint
COMMENT ON TABLE "consolidation_runs" IS
  'PHASE-034 T6: consolidation runs — read-only aggregations over member books through the ONE audited platform-plane reader (ADR-0018 §3). BR-056 pre-check at creation (typed MEMBER_PERIOD_OPEN rejection — never a warning). QUEUED→RUNNING→COMPLETED/FAILED as bounded pg-boss jobs; snapshot jsonb = immutable versioned derived artifact (ADR-0017 — member extracts at dated stored rates INV-008 + frozen elimination set); re-run = NEW row; FAILED leaves no partial snapshot (CHECK-enforced); the guard trigger makes COMPLETED snapshots rewrite-proof.';

--> statement-breakpoint
-- ---------------------------------------------------------------------------
-- 5. Snapshot immutability guard (the 0036/0037 trigger discipline — the
--    register marks none of the four tables 🔒 append-only, but a COMPLETED
--    run snapshot is history: UPDATE of the identity/snapshot columns on a
--    COMPLETED row is prohibited for everyone (purge_mode aside); only the
--    lifecycle columns (status transition INTO COMPLETED, completed_at,
--    job_id) may change, and only along the state machine. Snapshots never
--    mutate in place — re-consolidation is always a NEW run.
--> statement-breakpoint
CREATE OR REPLACE FUNCTION erp.consolidation_runs_guard() RETURNS trigger AS $$
BEGIN
  IF TG_OP = 'UPDATE' AND OLD.status = 'COMPLETED' THEN
    IF NEW.snapshot IS DISTINCT FROM OLD.snapshot
       OR NEW.snapshot_version IS DISTINCT FROM OLD.snapshot_version
       OR NEW.group_id IS DISTINCT FROM OLD.group_id
       OR NEW.fiscal_period_id IS DISTINCT FROM OLD.fiscal_period_id
       OR NEW.tenant_id IS DISTINCT FROM OLD.tenant_id THEN
      IF current_setting('erp.purge_mode', true) = 'on' THEN
        RETURN NEW; -- the offboarding purge path only (migration-scope tooling)
      END IF;
      RAISE EXCEPTION 'consolidation_runs snapshots are immutable: a completed run''s identity/snapshot columns cannot change (re-run instead)';
    END IF;
    IF NEW.status <> 'COMPLETED' THEN
      RAISE EXCEPTION 'consolidation_runs: a COMPLETED run cannot leave COMPLETED';
    END IF;
  END IF;
  RETURN NEW;
END
$$ LANGUAGE plpgsql;
--> statement-breakpoint
DROP TRIGGER IF EXISTS trg_consolidation_runs_guard ON "consolidation_runs";
--> statement-breakpoint
CREATE TRIGGER trg_consolidation_runs_guard
  BEFORE UPDATE ON "consolidation_runs"
  FOR EACH ROW EXECUTE FUNCTION erp.consolidation_runs_guard();

--> statement-breakpoint
-- ---------------------------------------------------------------------------
-- 6. RLS (TENANT_ISOLATION §2): the house macro on every tenant-owned
--    table. The four tables live in the OWNER tenant's plane — one RLS
--    universe per group (member tenants never see them; the member READ
--    path is the audited reader function only).
--> statement-breakpoint
SELECT erp.apply_tenant_policy('"consolidation_groups"');
--> statement-breakpoint
SELECT erp.apply_tenant_policy('"group_entities"');
--> statement-breakpoint
SELECT erp.apply_tenant_policy('"elimination_entries"');
--> statement-breakpoint
SELECT erp.apply_tenant_policy('"consolidation_runs"');

--> statement-breakpoint
-- ---------------------------------------------------------------------------
-- 6b. Purge path (the 0036 discipline): every new tenant table gains the
--     erp_migrate DELETE/UPDATE policies confined to the GUC-named tenant.
--> statement-breakpoint
DO $$
DECLARE
  t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['consolidation_groups', 'group_entities',
                           'elimination_entries', 'consolidation_runs']
  LOOP
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
-- 7. Grants (per-table shapes):
--  - consolidation_groups / group_entities: INSERT/UPDATE/SELECT — the
--    maintenance surface (deactivation is the delete; REMOVED members stay
--    as history);
--  - elimination_entries: INSERT/UPDATE/SELECT (DRAFT→POSTED lifecycle),
--    no DELETE (documents);
--  - consolidation_runs: INSERT/UPDATE/SELECT (lifecycle state machine;
--    snapshot immutability owned by the guard trigger).
--> statement-breakpoint
REVOKE ALL ON "consolidation_groups", "group_entities", "elimination_entries",
  "consolidation_runs" FROM erp_app;
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE ON "consolidation_groups" TO erp_app;
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE ON "group_entities" TO erp_app;
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE ON "elimination_entries" TO erp_app;
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE ON "consolidation_runs" TO erp_app;
--> statement-breakpoint
GRANT SELECT ON "consolidation_groups", "group_entities", "elimination_entries",
  "consolidation_runs" TO erp_readonly;
--> statement-breakpoint
GRANT SELECT ON "consolidation_groups", "group_entities", "elimination_entries",
  "consolidation_runs" TO erp_definer;

--> statement-breakpoint
-- ---------------------------------------------------------------------------
-- 8. THE PLATFORM-PLANE READER GRANT (ADR-0018 §3 — the only grant of its
--    kind in the platform; reviewed with the isolation suite at every
--    release; widened ONLY by a new ADR).
--
--    Role erp_consolidation_reader: NOLOGIN (disabled-by-default — it
--    cannot authenticate; enabling LOGIN is the reviewed ops
--    configuration) + BYPASSRLS (the 0003 erp_definer precedent — FORCE
--    RLS binds even the table owner, so the controlled escape hatch must
--    live on a bypass role; the RLS POLICY SET itself stays byte-identical:
--    no member policy is touched, no policy is added — the canary stays
--    green). SELECT-only table grants — the role holds NO
--    INSERT/UPDATE/DELETE anywhere in the database: write attempts through
--    it fail at the DB grant level and surface in the isolation suite.
--    (The role itself was created at the migration head — CREATE ROLE needs
--    the bootstrap/CREATEROLE context, the 0003 erp_definer envelope.)
--> statement-breakpoint
RESET ROLE;
--> statement-breakpoint
GRANT USAGE ON SCHEMA public TO erp_consolidation_reader;
--> statement-breakpoint
GRANT USAGE ON SCHEMA erp TO erp_consolidation_reader;
--> statement-breakpoint
-- SELECT-only on the member GL read models (the reader function family's
-- universe: GL aggregates + fiscal periods + the AR/AP subledger pairing
-- legs) + the consolidation configuration tables (membership validation).
-- This list IS the grant's scope — the T2 test hook asserts it matches
-- exactly. (FX rates resolve from the OWNER tenant's own exchange_rates
-- through the ordinary tenant-scoped path — NOT through the reader: the
-- owner reads its own table, RLS applies as everywhere.)
GRANT SELECT ON "journal_entries", "journal_lines", "accounts", "account_purposes",
  "fiscal_periods", "partner_subledger_entries", "partners" TO erp_consolidation_reader;
--> statement-breakpoint
GRANT SELECT ON "consolidation_groups", "group_entities", "elimination_entries",
  "consolidation_runs" TO erp_consolidation_reader;
--> statement-breakpoint
-- No INSERT/UPDATE/DELETE is EVER granted to erp_consolidation_reader (the
-- zero-cross-tenant-writes DB-level half of INV-026; the audit half is the
-- service's read-audit row in the same UoW as every call).

--> statement-breakpoint
-- ---------------------------------------------------------------------------
-- 8b. The reader function (the per-query acquisition of the grant — the
--     ONLY cross-tenant read path in the platform). STABLE SECURITY
--     DEFINER, owned by erp_consolidation_reader (bypass role ownership —
--     the 0003 projection precedent). It re-validates EVERYTHING before
--     returning one row: ACTIVE group, ACTIVE membership, include_from
--     window, and the member's closed period for the requested period
--     (BR-056 — SOFT_CLOSED/LOCKED both count as closed; OPEN never does;
--     defense in depth: the service pre-check rejects run creation, the
--     function re-verifies at read time). Wrong inputs raise typed
--     exceptions (the service maps them); EXECUTE granted to erp_app only.
--     Aggregates the member's POSTED journal lines by account (document
--     currency breakdown + the member-base net) — the statement-extract
--     substrate the run translates at dated stored rates (INV-008).
--> statement-breakpoint
SET ROLE erp_consolidation_reader;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION erp.consolidation_read_member_gl(
  p_group_id uuid,
  p_member_tenant_id uuid,
  p_fiscal_period_id uuid
)
RETURNS TABLE (
  "account_code" text,
  "account_name" text,
  "account_name_ar" text,
  "account_type" text,
  "purpose_key" text,
  "currency" varchar,
  "debit_total" numeric,
  "credit_total" numeric,
  "base_debit_total" numeric,
  "base_credit_total" numeric,
  "line_count" bigint
)
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public, erp
AS $$
  SELECT
    a.code AS account_code,
    a.name AS account_name,
    a.name_ar AS account_name_ar,
    a.type AS account_type,
    ap.purpose_key,
    je.currency_code AS currency,
    COALESCE(SUM(CASE WHEN jl.direction = 'DEBIT' THEN jl.amount ELSE 0 END), 0) AS debit_total,
    COALESCE(SUM(CASE WHEN jl.direction = 'CREDIT' THEN jl.amount ELSE 0 END), 0) AS credit_total,
    COALESCE(SUM(CASE WHEN jl.direction = 'DEBIT' THEN jl.base_amount ELSE 0 END), 0) AS base_debit_total,
    COALESCE(SUM(CASE WHEN jl.direction = 'CREDIT' THEN jl.base_amount ELSE 0 END), 0) AS base_credit_total,
    COUNT(jl.id) AS line_count
  FROM fiscal_periods fp
  JOIN group_entities ge ON ge.group_id = p_group_id
    AND ge.member_tenant_id = p_member_tenant_id
    AND ge.status = 'ACTIVE'
    AND (ge.include_from IS NULL OR ge.include_from <= fp.end_date)
  JOIN consolidation_groups cg ON cg.id = ge.group_id
    AND cg.tenant_id = ge.tenant_id
    AND cg.status = 'ACTIVE'
  JOIN journal_entries je ON je.tenant_id = p_member_tenant_id
    AND je.fiscal_period_id = p_fiscal_period_id
    AND je.status = 'POSTED'
    -- The member STATUTORY books are what consolidates: consolidation-source
    -- rows are the PARENT's consolidation books (eliminations) — they enter
    -- the consolidated view through the run's separate elimination-effects
    -- read, never through the member extracts (no double-count: for the
    -- non-owner members this filter is a no-op — eliminations never post
    -- outside the parent, INV-026/G-32's zero-rows guarantee).
    AND je.source_type <> 'consolidation_elimination'
  JOIN journal_lines jl ON jl.journal_entry_id = je.id
    AND jl.tenant_id = p_member_tenant_id
  JOIN accounts a ON a.id = jl.account_id
    AND a.tenant_id = p_member_tenant_id
  LEFT JOIN account_purposes ap ON ap.account_id = a.id
    AND ap.tenant_id = p_member_tenant_id
    AND ap.active_to IS NULL
  WHERE fp.id = p_fiscal_period_id
    AND fp.tenant_id = p_member_tenant_id
    AND fp.status IN ('SOFT_CLOSED', 'LOCKED')  -- BR-056: OPEN never consolidates
  GROUP BY a.code, a.name, a.name_ar, a.type, ap.purpose_key, je.currency_code
  ORDER BY a.code, je.currency_code
$$;
--> statement-breakpoint
REVOKE EXECUTE ON FUNCTION erp.consolidation_read_member_gl(uuid, uuid, uuid) FROM PUBLIC;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION erp.consolidation_read_member_gl(uuid, uuid, uuid) TO erp_app;
--> statement-breakpoint
-- The reader's period-lookup leg (the SAME SECURITY DEFINER envelope, the
-- SAME membership validation — the reader service's second and only other
-- SQL surface): the MEMBER's fiscal periods intersecting a date window.
-- This is the BR-056 pre-check substrate — mapping the OWNER's run period
-- onto each member's own fiscal calendar (a member's period ids are its
-- own; the pre-check resolves the covering period per member, then the
-- main function reads THAT period). Read-only like the main leg.
CREATE OR REPLACE FUNCTION erp.consolidation_member_periods(
  p_group_id uuid,
  p_member_tenant_id uuid,
  p_window_start date,
  p_window_end date
)
RETURNS TABLE (
  "period_id" uuid,
  "period_name" text,
  "start_date" date,
  "end_date" date,
  "status" text
)
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public, erp
AS $$
  SELECT fp.id AS period_id, fp.name AS period_name,
    fp.start_date, fp.end_date, fp.status
  FROM group_entities ge
  JOIN consolidation_groups cg ON cg.id = ge.group_id
    AND cg.tenant_id = ge.tenant_id
    AND cg.status = 'ACTIVE'
  JOIN fiscal_periods fp ON fp.tenant_id = ge.member_tenant_id
    AND fp.start_date <= p_window_end
    AND fp.end_date >= p_window_start
  WHERE ge.group_id = p_group_id
    AND ge.member_tenant_id = p_member_tenant_id
    AND ge.status = 'ACTIVE'
  ORDER BY fp.start_date
$$;
--> statement-breakpoint
REVOKE EXECUTE ON FUNCTION erp.consolidation_member_periods(uuid, uuid, date, date) FROM PUBLIC;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION erp.consolidation_member_periods(uuid, uuid, date, date) TO erp_app;
--> statement-breakpoint
-- The reader's intercompany suggestion leg (the THIRD and last SQL surface
-- of the reader service — the §2.2 authoring workspace's "surface suggests
-- intercompany pairings from the members' AR/AP subledgers; matching is
-- human-confirmed"): per-partner open balances of ONE member as-of. Same
-- SECURITY DEFINER envelope + membership validation; SELECT-only like the
-- other legs (partner_subledger_entries + partners join the grant scope —
-- both journal-linked GL read models; still no write grant anywhere).
CREATE OR REPLACE FUNCTION erp.consolidation_read_member_ar_ap(
  p_group_id uuid,
  p_member_tenant_id uuid,
  p_as_of date
)
RETURNS TABLE (
  "partner_id" uuid,
  "partner_code" text,
  "partner_name" text,
  "partner_name_ar" text,
  "ar_balance" numeric,
  "ap_balance" numeric
)
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public, erp
AS $$
  SELECT
    pse.partner_id,
    p.code AS partner_code,
    p.name AS partner_name,
    p.name_ar AS partner_name_ar,
    COALESCE(SUM(CASE WHEN pse.direction = 'DEBIT' THEN pse.base_amount ELSE -pse.base_amount END), 0) AS ar_balance,
    COALESCE(SUM(CASE WHEN pse.direction = 'CREDIT' THEN pse.base_amount ELSE -pse.base_amount END), 0) AS ap_balance
  FROM group_entities ge
  JOIN consolidation_groups cg ON cg.id = ge.group_id
    AND cg.tenant_id = ge.tenant_id
    AND cg.status = 'ACTIVE'
  JOIN partner_subledger_entries pse ON pse.tenant_id = ge.member_tenant_id
    AND pse.entry_date <= p_as_of
  JOIN partners p ON p.id = pse.partner_id
    AND p.tenant_id = ge.member_tenant_id
  WHERE ge.group_id = p_group_id
    AND ge.member_tenant_id = p_member_tenant_id
    AND ge.status = 'ACTIVE'
    AND (ge.include_from IS NULL OR ge.include_from <= p_as_of)
  GROUP BY pse.partner_id, p.code, p.name, p.name_ar
  HAVING COALESCE(SUM(pse.base_amount), 0) <> 0
  ORDER BY p.code
$$;
--> statement-breakpoint
REVOKE EXECUTE ON FUNCTION erp.consolidation_read_member_ar_ap(uuid, uuid, date) FROM PUBLIC;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION erp.consolidation_read_member_ar_ap(uuid, uuid, date) TO erp_app;
--> statement-breakpoint
RESET ROLE;

--> statement-breakpoint
-- Back to the migration role for the seed sections (the 0003 tail pattern).
SET ROLE erp_migrate;

--> statement-breakpoint
-- ---------------------------------------------------------------------------
-- 9. CoA template (§11): the CONSOLIDATION_ADJUSTMENT purpose gains its
--    template account — 3220 (EQUITY leaf under 3000, the 3210
--    revaluation-reserve precedent; used ONLY in the parent's consolidation
--    books per CHART_OF_ACCOUNTS §2). Intercompany elimination lines ride
--    the EXISTING AR_CONTROL / AP_CONTROL purposes (G-32 — zero new
--    purpose keys for them).
--> statement-breakpoint
INSERT INTO "chart_of_accounts_template" ("code", "name", "name_ar", "type", "is_group", "parent_code", "purpose_key") VALUES
  ('3220', 'Consolidation adjustments', 'تسويات التوحيد', 'EQUITY', false, '3000', 'CONSOLIDATION_ADJUSTMENT')
ON CONFLICT ("code") DO UPDATE
  SET "name" = EXCLUDED."name", "name_ar" = EXCLUDED."name_ar",
      "type" = EXCLUDED."type", "is_group" = EXCLUDED."is_group",
      "parent_code" = EXCLUDED."parent_code", "purpose_key" = EXCLUDED."purpose_key";

--> statement-breakpoint
-- ---------------------------------------------------------------------------
-- 10. Permission seeds (AUTHORIZATION_MATRIX §3.15 — 5 keys; the drift
--     checker requires matrix ↔ seed parity; ALSO seeded in-phase into
--     0004_permissions_seed.sql per the 0037/0038 idempotent two-site
--     precedent). The owner template cross-join re-runs idempotently.
--> statement-breakpoint
INSERT INTO "permissions" ("key", "module", "description") VALUES
('consolidation.groups.manage', 'consolidation', 'Maintain groups and member entities (ownership %, include-from) / إدارة مجموعات التوحيد والشركات التابعة'),
('consolidation.eliminations.create', 'consolidation', 'Draft elimination entries / إعداد قيود الاستبعاد'),
('consolidation.eliminations.post', 'consolidation', 'Post eliminations to the consolidation books (G-32) / ترحيل قيود الاستبعاد (دفاتر التوحيد)'),
('consolidation.runs.execute', 'consolidation', 'Execute a consolidation run — read-only over member books, zero cross-tenant writes (ADR-0018, INV-026) / تنفيذ التوحيد (قراءة فقط)'),
('consolidation.reports.view', 'consolidation', 'View/run consolidated statement keys (REPORT_CATALOG §10) / تشغيل التقارير الموحدة')
ON CONFLICT ("key") DO UPDATE
  SET "module" = EXCLUDED."module", "description" = EXCLUDED."description";

--> statement-breakpoint
-- Owner template: every tenant-plane key (idempotent cross-join).
INSERT INTO "role_permissions" ("role_id", "tenant_id", "permission_id")
SELECT r."id", NULL, p."key"
FROM "roles" r CROSS JOIN "permissions" p
WHERE r."key" = 'owner' AND r."tenant_id" IS NULL
  AND p."key" NOT LIKE 'platform.%'
  AND p."key" <> 'identity.mfa.manage'
ON CONFLICT ("role_id", "permission_id") DO NOTHING;
--> statement-breakpoint
-- Accountant: the operational set (everything except eliminations.post —
-- owner-only per §3.15's risky row; SoD creator ≠ approver on post).
INSERT INTO "role_permissions" ("role_id", "tenant_id", "permission_id")
SELECT r."id", NULL, p."key"
FROM "roles" r JOIN "permissions" p ON p."key" IN (
  'consolidation.groups.manage', 'consolidation.eliminations.create',
  'consolidation.runs.execute', 'consolidation.reports.view'
)
WHERE r."key" = 'accountant' AND r."tenant_id" IS NULL
ON CONFLICT ("role_id", "permission_id") DO NOTHING;
--> statement-breakpoint
-- Viewer: the read tier (consolidated statements are viewer-visible).
INSERT INTO "role_permissions" ("role_id", "tenant_id", "permission_id")
SELECT r."id", NULL, p."key"
FROM "roles" r JOIN "permissions" p ON p."key" IN (
  'consolidation.reports.view'
)
WHERE r."key" = 'viewer' AND r."tenant_id" IS NULL
ON CONFLICT ("role_id", "permission_id") DO NOTHING;

--> statement-breakpoint
-- ---------------------------------------------------------------------------
-- 11. Plan grants (FEATURE_CATALOG §19 protocol step 3): the five
--     consolidation.* feature keys join business + enterprise (the tier-4
--     financial-depth precedent — fixed assets 0037, notes/installments
--     0038); starter does NOT get them. Idempotent array_cat.
--> statement-breakpoint
UPDATE "plans" SET "feature_keys" = array_cat("feature_keys",
  ARRAY['consolidation.groups', 'consolidation.eliminations',
        'consolidation.runs', 'consolidation.fx_translation',
        'consolidation.reports'])
WHERE "key" IN ('business', 'enterprise')
  AND NOT ('consolidation.groups' = ANY("feature_keys"));

--> statement-breakpoint
RESET ROLE;

--> statement-breakpoint
-- Schema-state marker for /health/ready (mirrors the migration manifest).
INSERT INTO erp._schema_state (key, value) VALUES ('schema_version', 41)
ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, at = now();
