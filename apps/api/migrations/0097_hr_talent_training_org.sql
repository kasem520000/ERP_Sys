-- PHASE-047 (Blueprint v3.0 · CR-17) · migration 0097 · HR Growth —
-- Talent & Performance (part 3: the training/org/documents cluster, T-03).
--
--   training_programs (T-08) — the catalog: internal/external, the
--     provider, and the cost (numeric(19,4) — ADR-0009's money law; a
--     training budget figure is money-adjacent data, never binary
--     float). Master data incl. DELETE (the typed service guards own
--     the RETIRED lifecycle).
--   training_enrollments (T-08) — the per-(program, employee) record:
--     the status ladder, the attendance + completion percentages, the
--     result. Evidence discipline: no DELETE (WITHDRAWN is the soft
--     path — the leave_requests precedent).
--   certifications (T-08/T-09) — the employee certification register:
--     the issuer, the issue/expiry dates (the hr.certification-expiry
--     sweep's probe, D-06), the certificate number. Evidence
--     discipline: no DELETE (renewal is the UPDATE; the register is the
--     compliance record).
--   org_units (T-08, D-09) — the org tree: the materialized path (the
--     cycle-safe move law's substrate — every write validates no cycle
--     via the pure detectCycle, W-3) + the parent link. Master data
--     incl. DELETE.
--   positions (T-08, D-09) — the bilingual titled slots: the grade, the
--     org-unit attachment, and reports_to (the same cycle guard).
--     Master data incl. DELETE.
--   employee_documents (T-09, HR-10) — the document register: the kind
--     (PASSPORT/IQAMA/VISA/CONTRACT/CERTIFICATE/OTHER), the number
--     (PII — registered in the PII inventory per amendment A-4, never
--     in exports), the issue/expiry dates (the hr.document-expiry
--     sweep's probe). Operational data incl. DELETE (replacement is a
--     normal HR operation; the audit trail lives in audit_events).
--
--   §5 THE EMPLOYEE EXTENSIONS (the plan's D-01/D-02 — the frozen
--   substrate's documented extensions, never payroll writes):
--     employees.position_id — nullable uuid → positions, ON DELETE SET
--       NULL (an employee without a position stays valid — the userId
--       bridge's precedent);
--     employees.probation_end — nullable date, FAIL-OPEN (amendment A-1:
--       NULL = not tracked, the sweep skips NULLs, no alert ever
--       fabricated — the alert-input mirror of nationality's
--       fail-closed; registered in the PII inventory in the same
--       increment).
--     vacancies.position_id's FK — added here (positions now exists; the
--       0096 header's promise), ON DELETE SET NULL (a closed position
--       never blocks the vacancy record).
--
-- Ledger-free by design (D-05).
--
-- Grants: programs/org_units/positions/documents = incl. DELETE;
-- enrollments/certifications = the evidence discipline (no DELETE).

--> statement-breakpoint
SET ROLE erp_migrate;

--> statement-breakpoint
-- ---------------------------------------------------------------------------
-- 1. training_programs + training_enrollments.
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "training_programs" (
  "id" uuid NOT NULL,
  "tenant_id" uuid NOT NULL REFERENCES "tenants" ("id") ON DELETE RESTRICT,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "updated_at" timestamptz NOT NULL DEFAULT now(),
  "version" integer NOT NULL DEFAULT 1,
  "created_by" uuid,
  "updated_by" uuid,
  "code" text NOT NULL,
  "name" text NOT NULL,
  "name_ar" text,
  "kind" text NOT NULL,
  "provider" text,
  "cost" numeric(19, 4),
  "status" text NOT NULL DEFAULT 'ACTIVE',
  "notes" text,
  CONSTRAINT pk_training_programs PRIMARY KEY ("id"),
  CONSTRAINT uq_training_programs_id_tenant UNIQUE ("id", "tenant_id"),
  CONSTRAINT uq_training_programs_tenant_code UNIQUE ("tenant_id", "code"),
  CONSTRAINT ck_training_programs_kind CHECK ("kind" IN ('INTERNAL', 'EXTERNAL')),
  -- ADR-0009: the money law (a training budget figure is money-adjacent
  -- data — exact numeric, never binary float, never negative).
  CONSTRAINT ck_training_programs_cost CHECK ("cost" IS NULL OR "cost" >= 0),
  CONSTRAINT ck_training_programs_status CHECK ("status" IN ('ACTIVE', 'RETIRED'))
);

--> statement-breakpoint
CREATE INDEX IF NOT EXISTS ix_training_programs_tenant_status
  ON "training_programs" ("tenant_id", "status");

--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "training_enrollments" (
  "id" uuid NOT NULL,
  "tenant_id" uuid NOT NULL REFERENCES "tenants" ("id") ON DELETE RESTRICT,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "updated_at" timestamptz NOT NULL DEFAULT now(),
  "version" integer NOT NULL DEFAULT 1,
  "created_by" uuid,
  "updated_by" uuid,
  "program_id" uuid NOT NULL,
  "employee_id" uuid NOT NULL,
  "status" text NOT NULL DEFAULT 'ENROLLED',
  "attendance_pct" numeric(5, 2),
  "completion_pct" numeric(5, 2),
  "result" text,
  "completed_at" timestamptz,
  "notes" text,
  CONSTRAINT pk_training_enrollments PRIMARY KEY ("id"),
  CONSTRAINT uq_training_enrollments_id_tenant UNIQUE ("id", "tenant_id"),
  CONSTRAINT uq_training_enrollments_program_employee
    UNIQUE ("tenant_id", "program_id", "employee_id"),
  -- RESTRICT (never CASCADE): the programs carry DELETE, the enrollment
  -- rows are the record — the FK refuses the parent's deletion while
  -- records exist.
  CONSTRAINT fk_training_enrollments_program
    FOREIGN KEY ("program_id", "tenant_id")
    REFERENCES "training_programs" ("id", "tenant_id") ON DELETE RESTRICT,
  CONSTRAINT fk_training_enrollments_employee
    FOREIGN KEY ("employee_id", "tenant_id")
    REFERENCES "employees" ("id", "tenant_id") ON DELETE CASCADE,
  CONSTRAINT ck_training_enrollments_status
    CHECK ("status" IN ('ENROLLED', 'IN_PROGRESS', 'COMPLETED', 'WITHDRAWN')),
  CONSTRAINT ck_training_enrollments_attendance
    CHECK ("attendance_pct" IS NULL OR ("attendance_pct" >= 0 AND "attendance_pct" <= 100)),
  CONSTRAINT ck_training_enrollments_completion
    CHECK ("completion_pct" IS NULL OR ("completion_pct" >= 0 AND "completion_pct" <= 100)),
  CONSTRAINT ck_training_enrollments_result
    CHECK ("result" IS NULL OR "result" IN ('PENDING', 'PASSED', 'FAILED'))
);

--> statement-breakpoint
CREATE INDEX IF NOT EXISTS ix_training_enrollments_tenant_employee
  ON "training_enrollments" ("tenant_id", "employee_id", "status");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS ix_training_enrollments_tenant_program
  ON "training_enrollments" ("tenant_id", "program_id");

--> statement-breakpoint
-- ---------------------------------------------------------------------------
-- 2. certifications (the register + the expiry sweep's probe).
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "certifications" (
  "id" uuid NOT NULL,
  "tenant_id" uuid NOT NULL REFERENCES "tenants" ("id") ON DELETE RESTRICT,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "updated_at" timestamptz NOT NULL DEFAULT now(),
  "version" integer NOT NULL DEFAULT 1,
  "created_by" uuid,
  "updated_by" uuid,
  "employee_id" uuid NOT NULL,
  "name" text NOT NULL,
  "name_ar" text,
  "issuer" text NOT NULL,
  "issue_date" date NOT NULL,
  "expiry_date" date,
  "certificate_number" text,
  "notes" text,
  CONSTRAINT pk_certifications PRIMARY KEY ("id"),
  CONSTRAINT uq_certifications_id_tenant UNIQUE ("id", "tenant_id"),
  CONSTRAINT fk_certifications_employee
    FOREIGN KEY ("employee_id", "tenant_id")
    REFERENCES "employees" ("id", "tenant_id") ON DELETE CASCADE,
  CONSTRAINT ck_certifications_window
    CHECK ("expiry_date" IS NULL OR "expiry_date" > "issue_date")
);

--> statement-breakpoint
CREATE INDEX IF NOT EXISTS ix_certifications_tenant_employee
  ON "certifications" ("tenant_id", "employee_id");
--> statement-breakpoint
-- The sweep probe's index: the per-tenant expiry walk (D-06 — the
-- hr.certification-expiry 30/7/0 windows).
CREATE INDEX IF NOT EXISTS ix_certifications_tenant_expiry
  ON "certifications" ("tenant_id", "expiry_date");

--> statement-breakpoint
-- ---------------------------------------------------------------------------
-- 3. org_units + positions (the cycle-safe tree, D-09).
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "org_units" (
  "id" uuid NOT NULL,
  "tenant_id" uuid NOT NULL REFERENCES "tenants" ("id") ON DELETE RESTRICT,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "updated_at" timestamptz NOT NULL DEFAULT now(),
  "version" integer NOT NULL DEFAULT 1,
  "created_by" uuid,
  "updated_by" uuid,
  "code" text NOT NULL,
  "name" text NOT NULL,
  "name_ar" text,
  "parent_id" uuid,
  "path" text NOT NULL,
  "active" boolean NOT NULL DEFAULT true,
  CONSTRAINT pk_org_units PRIMARY KEY ("id"),
  CONSTRAINT uq_org_units_id_tenant UNIQUE ("id", "tenant_id"),
  CONSTRAINT uq_org_units_tenant_code UNIQUE ("tenant_id", "code"),
  -- RESTRICT (never CASCADE) + the materialized path: the cycle-safe
  -- move law (D-09) validates at write time via the pure detectCycle
  -- (W-3); the FK refuses deleting a parent with children.
  CONSTRAINT fk_org_units_parent
    FOREIGN KEY ("parent_id") REFERENCES "org_units" ("id") ON DELETE RESTRICT,
  CONSTRAINT ck_org_units_not_self
    CHECK ("parent_id" IS NULL OR "parent_id" <> "id")
);

--> statement-breakpoint
CREATE INDEX IF NOT EXISTS ix_org_units_tenant_parent
  ON "org_units" ("tenant_id", "parent_id");

--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "positions" (
  "id" uuid NOT NULL,
  "tenant_id" uuid NOT NULL REFERENCES "tenants" ("id") ON DELETE RESTRICT,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "updated_at" timestamptz NOT NULL DEFAULT now(),
  "version" integer NOT NULL DEFAULT 1,
  "created_by" uuid,
  "updated_by" uuid,
  "code" text NOT NULL,
  "title" text NOT NULL,
  "title_ar" text,
  "grade" text,
  "org_unit_id" uuid,
  "reports_to" uuid,
  "status" text NOT NULL DEFAULT 'ACTIVE',
  CONSTRAINT pk_positions PRIMARY KEY ("id"),
  CONSTRAINT uq_positions_id_tenant UNIQUE ("id", "tenant_id"),
  CONSTRAINT uq_positions_tenant_code UNIQUE ("tenant_id", "code"),
  CONSTRAINT fk_positions_org_unit
    FOREIGN KEY ("org_unit_id", "tenant_id")
    REFERENCES "org_units" ("id", "tenant_id") ON DELETE RESTRICT,
  -- reports_to: the same cycle guard as org_units' parent (D-09 — the
  -- pure detectCycle at write time, W-3).
  CONSTRAINT fk_positions_reports_to
    FOREIGN KEY ("reports_to") REFERENCES "positions" ("id") ON DELETE RESTRICT,
  CONSTRAINT ck_positions_not_self
    CHECK ("reports_to" IS NULL OR "reports_to" <> "id"),
  CONSTRAINT ck_positions_status CHECK ("status" IN ('ACTIVE', 'RETIRED'))
);

--> statement-breakpoint
CREATE INDEX IF NOT EXISTS ix_positions_tenant_org_unit
  ON "positions" ("tenant_id", "org_unit_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS ix_positions_tenant_reports_to
  ON "positions" ("tenant_id", "reports_to");

--> statement-breakpoint
-- ---------------------------------------------------------------------------
-- 4. employee_documents (the register, HR-10 — the Gulf compliance
--    exposure converted to a scheduled alert product).
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "employee_documents" (
  "id" uuid NOT NULL,
  "tenant_id" uuid NOT NULL REFERENCES "tenants" ("id") ON DELETE RESTRICT,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "updated_at" timestamptz NOT NULL DEFAULT now(),
  "version" integer NOT NULL DEFAULT 1,
  "created_by" uuid,
  "updated_by" uuid,
  "employee_id" uuid NOT NULL,
  "kind" text NOT NULL,
  "number" text,
  "issued_on" date,
  "expires_on" date,
  "notes" text,
  CONSTRAINT pk_employee_documents PRIMARY KEY ("id"),
  CONSTRAINT uq_employee_documents_id_tenant UNIQUE ("id", "tenant_id"),
  CONSTRAINT fk_employee_documents_employee
    FOREIGN KEY ("employee_id", "tenant_id")
    REFERENCES "employees" ("id", "tenant_id") ON DELETE CASCADE,
  CONSTRAINT ck_employee_documents_kind
    CHECK ("kind" IN ('PASSPORT', 'IQAMA', 'VISA', 'CONTRACT', 'CERTIFICATE', 'OTHER')),
  CONSTRAINT ck_employee_documents_window
    CHECK ("expires_on" IS NULL OR "issued_on" IS NULL OR "expires_on" > "issued_on")
);

--> statement-breakpoint
CREATE INDEX IF NOT EXISTS ix_employee_documents_tenant_employee
  ON "employee_documents" ("tenant_id", "employee_id", "kind");
--> statement-breakpoint
-- The sweep probe's index: the per-tenant expiry walk (D-06 — the
-- hr.document-expiry 30/7/0 windows, BR-091's dedupe key).
CREATE INDEX IF NOT EXISTS ix_employee_documents_tenant_expiry
  ON "employee_documents" ("tenant_id", "expires_on");

--> statement-breakpoint
-- ---------------------------------------------------------------------------
-- 5. THE EMPLOYEE EXTENSIONS (D-01/D-02 — the frozen substrate's
--    documented extensions; never a payroll write) + the 0096 FK promise.
--> statement-breakpoint
ALTER TABLE "employees" ADD COLUMN IF NOT EXISTS "position_id" uuid;
--> statement-breakpoint
ALTER TABLE "employees" ADD COLUMN IF NOT EXISTS "probation_end" date;
--> statement-breakpoint
ALTER TABLE "employees" DROP CONSTRAINT IF EXISTS fk_employees_position;
--> statement-breakpoint
ALTER TABLE "employees"
  ADD CONSTRAINT fk_employees_position
    FOREIGN KEY ("position_id") REFERENCES "positions" ("id") ON DELETE SET NULL;
--> statement-breakpoint
COMMENT ON COLUMN "employees"."position_id" IS
  'PHASE-047 D-01 (the plan-approved documented extension): the org-structure slot — nullable, ON DELETE SET NULL (an employee without a position stays valid, the userId bridge''s precedent). The talent layer attaches to the frozen employees substrate; payroll NEVER writes this column (the 029/046 run machinery is frozen substrate law).';
--> statement-breakpoint
COMMENT ON COLUMN "employees"."probation_end" IS
  'PHASE-047 D-02 + amendment A-1 (the owner-approved addition, 2026-11-18): the probation end date — nullable date, FAIL-OPEN (NULL = not tracked; the hr.probation-end sweep skips NULLs, no alert ever fabricated — the alert-input mirror of nationality''s fail-closed pricing law). Registered in the PII inventory in the same increment (the 046 nationality D-02 pattern).';

--> statement-breakpoint
ALTER TABLE "vacancies" DROP CONSTRAINT IF EXISTS fk_vacancies_position;
--> statement-breakpoint
ALTER TABLE "vacancies"
  ADD CONSTRAINT fk_vacancies_position
    FOREIGN KEY ("position_id") REFERENCES "positions" ("id") ON DELETE SET NULL;

--> statement-breakpoint
-- ---------------------------------------------------------------------------
-- 6. RLS — the house triple.
--> statement-breakpoint
ALTER TABLE "training_programs" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "training_programs" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
SELECT erp.apply_tenant_policy('"training_programs"');
--> statement-breakpoint
ALTER TABLE "training_enrollments" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "training_enrollments" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
SELECT erp.apply_tenant_policy('"training_enrollments"');
--> statement-breakpoint
ALTER TABLE "certifications" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "certifications" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
SELECT erp.apply_tenant_policy('"certifications"');
--> statement-breakpoint
ALTER TABLE "org_units" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "org_units" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
SELECT erp.apply_tenant_policy('"org_units"');
--> statement-breakpoint
ALTER TABLE "positions" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "positions" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
SELECT erp.apply_tenant_policy('"positions"');
--> statement-breakpoint
ALTER TABLE "employee_documents" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "employee_documents" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
SELECT erp.apply_tenant_policy('"employee_documents"');
--> statement-breakpoint
DO $$
DECLARE
  t text;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'training_programs', 'training_enrollments', 'certifications',
    'org_units', 'positions', 'employee_documents'
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
-- 7. Grants — the master/evidence/operational split.
--> statement-breakpoint
REVOKE ALL ON "training_programs" FROM erp_app;
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON "training_programs" TO erp_app;
--> statement-breakpoint
GRANT SELECT ON "training_programs" TO erp_readonly;
--> statement-breakpoint
GRANT SELECT ON "training_programs" TO erp_definer;
--> statement-breakpoint
REVOKE ALL ON "training_enrollments" FROM erp_app;
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE ON "training_enrollments" TO erp_app;
--> statement-breakpoint
GRANT SELECT ON "training_enrollments" TO erp_readonly;
--> statement-breakpoint
GRANT SELECT ON "training_enrollments" TO erp_definer;
--> statement-breakpoint
REVOKE ALL ON "certifications" FROM erp_app;
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE ON "certifications" TO erp_app;
--> statement-breakpoint
GRANT SELECT ON "certifications" TO erp_readonly;
--> statement-breakpoint
GRANT SELECT ON "certifications" TO erp_definer;
--> statement-breakpoint
REVOKE ALL ON "org_units" FROM erp_app;
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON "org_units" TO erp_app;
--> statement-breakpoint
GRANT SELECT ON "org_units" TO erp_readonly;
--> statement-breakpoint
GRANT SELECT ON "org_units" TO erp_definer;
--> statement-breakpoint
REVOKE ALL ON "positions" FROM erp_app;
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON "positions" TO erp_app;
--> statement-breakpoint
GRANT SELECT ON "positions" TO erp_readonly;
--> statement-breakpoint
GRANT SELECT ON "positions" TO erp_definer;
--> statement-breakpoint
REVOKE ALL ON "employee_documents" FROM erp_app;
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON "employee_documents" TO erp_app;
--> statement-breakpoint
GRANT SELECT ON "employee_documents" TO erp_readonly;
--> statement-breakpoint
GRANT SELECT ON "employee_documents" TO erp_definer;

--> statement-breakpoint
RESET ROLE;

--> statement-breakpoint
-- Schema-state marker for /health/ready (mirrors the migration manifest).
INSERT INTO erp._schema_state (key, value) VALUES ('schema_version', 97)
ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, at = now();
