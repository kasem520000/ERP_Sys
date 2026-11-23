-- PHASE-050 (Blueprint v3.0 · CR-20 — QMS) · migration 0115 · THE
-- CALIBRATION/SUPPLIER-SCORES/COA CLUSTER (T-03, the plan's D-02 slot
-- 3: calibration_records — the instrument AS an asset (D-08), standard
-- used, result, due date · supplier_quality_scores — the rolling fold ·
-- coa_documents — the generated certificate incl. the conformity type).
--
--   §1 calibration_records (Q-03): the 049 handoff verbatim (D-08) —
--     the instrument is an ASSET on the 049 surfaces: the composite FK
--     binds the asset card and the service-history timeline; the due
--     date is the quality-calibration-due sweep's own anchor (the
--     0111 expiry-sweep pattern extends to it at W-26 — 30/7/0, the
--     structural dedupe, the typed settings surface; the sweep joins
--     the isolate set the wave it ships). The external calibration
--     cost carries the G-63 stamp (journal_entry_id gated to
--     external_cost > 0 — DR QUALITY_EXPENSE · CR EXTERNAL_ACCRUAL,
--     D-06). Evidence discipline: S/I/U, NO DELETE (the calibration
--     history is the instrument's own record).
--   §2 supplier_quality_scores (Q-06): the rolling fold — one row per
--     (tenant, supplier, period start) built from NCRs (SUPPLIER
--     source), rejections and delivery performance; the documented
--     feed contract to the 038 scorecards (D-13: the consumer reads,
--     never re-computes). Rebuildable derived data: grants S/I/U/D.
--   §3 coa_documents (Q-07): the generated certificate — COA (analysis)
--     or COC (conformity) — carrying the FROZEN parameter snapshot
--     (BR-104's gate is at generation: every parameter within
--     tolerance or carrying an accepted-deviation NCR reference; the
--     refusal names the parameter and both figures — the W-27 service)
--     and the source inspection link. Evidence: S/I/U, NO DELETE (a
--     issued certificate is immutable history — the print law's own
--     frozen input).
--
--   THE D-02 DISCLOSURE (the standing law): the chain 114 → 115 ·
--     ENTITY_CATALOG 332 → 335 (this migration's +3) · the drift 337
--     unchanged (0116's data page) · ROUTE_PERMISSIONS 1,102 unchanged
--     (keys-seed-first).
--
--   The QUALITY_EXPENSE CoA template marker is 0116's data page (D-06's
--     own dependency, the 0077 §6 pattern — with the migration that
--     first posts it, not the table that first references it).

--> statement-breakpoint
SET ROLE erp_migrate;

--> statement-breakpoint
-- ---------------------------------------------------------------------------
-- 1. calibration_records (Q-03 — the instrument-asset binding, D-08).
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "calibration_records" (
  "id" uuid NOT NULL,
  "tenant_id" uuid NOT NULL REFERENCES "tenants" ("id") ON DELETE RESTRICT,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "updated_at" timestamptz NOT NULL DEFAULT now(),
  "version" integer NOT NULL DEFAULT 1,
  "created_by" uuid,
  "updated_by" uuid,
  "calibration_no" text NOT NULL,
  "asset_id" uuid NOT NULL,
  "standard_used" text NOT NULL,
  "result" text NOT NULL,
  "calibrated_at" timestamptz NOT NULL,
  "due_date" date NOT NULL,
  "provider_id" uuid,
  "certificate_ref" text,
  "external_cost" numeric(19, 4) NOT NULL DEFAULT 0,
  "journal_entry_id" uuid,
  "note" text,
  "note_ar" text,
  CONSTRAINT pk_calibration_records PRIMARY KEY ("id"),
  CONSTRAINT uq_calibration_records_id_tenant UNIQUE ("id", "tenant_id"),
  CONSTRAINT uq_calibration_records_tenant_no UNIQUE ("tenant_id", "calibration_no"),
  CONSTRAINT fk_calibration_records_asset
    FOREIGN KEY ("asset_id", "tenant_id")
    REFERENCES "assets" ("id", "tenant_id") ON DELETE RESTRICT,
  CONSTRAINT fk_calibration_records_provider
    FOREIGN KEY ("provider_id", "tenant_id")
    REFERENCES "partners" ("id", "tenant_id") ON DELETE RESTRICT,
  CONSTRAINT fk_calibration_records_journal
    FOREIGN KEY ("journal_entry_id", "tenant_id")
    REFERENCES "journal_entries" ("id", "tenant_id") ON DELETE RESTRICT,
  CONSTRAINT ck_calibration_records_result
    CHECK ("result" IN ('PASS', 'FAIL', 'ADJUSTED')),
  CONSTRAINT ck_calibration_records_standard_length
    CHECK (length("standard_used") BETWEEN 1 AND 120),
  CONSTRAINT ck_calibration_records_certificate_ref_length
    CHECK ("certificate_ref" IS NULL OR length("certificate_ref") BETWEEN 1 AND 120),
  CONSTRAINT ck_calibration_records_external_cost
    CHECK ("external_cost" >= 0),
  -- The due date strictly follows the calibration act (the UTC-pinned
  -- comparison — a CHECK never reads the session timezone).
  CONSTRAINT ck_calibration_records_due_after
    CHECK ("due_date" > ("calibrated_at" AT TIME ZONE 'UTC')::date),
  -- The G-63 stamp (the 0107 journal-gate precedent): the external
  -- calibration cost posts exactly once through the REAL engine (W-26:
  -- DR QUALITY_EXPENSE · CR EXTERNAL_ACCRUAL — D-06); a zero-cost
  -- (in-house) calibration carries no entry.
  CONSTRAINT ck_calibration_records_journal_gated
    CHECK (
      "journal_entry_id" IS NULL
      OR ("external_cost" > 0 AND "result" IN ('PASS', 'FAIL', 'ADJUSTED'))
    )
);

--> statement-breakpoint
CREATE INDEX IF NOT EXISTS ix_calibration_records_tenant_asset
  ON "calibration_records" ("tenant_id", "asset_id", "calibrated_at");
--> statement-breakpoint
-- The sweep's own anchor (W-26's quality-calibration-due job reads this).
CREATE INDEX IF NOT EXISTS ix_calibration_records_tenant_due
  ON "calibration_records" ("tenant_id", "due_date");

--> statement-breakpoint
-- ---------------------------------------------------------------------------
-- 2. supplier_quality_scores (Q-06 — the rolling fold; the 038 feed
--    contract's own rows: the scorecard consumer READS, never
--    re-computes — D-13).
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "supplier_quality_scores" (
  "id" uuid NOT NULL,
  "tenant_id" uuid NOT NULL REFERENCES "tenants" ("id") ON DELETE RESTRICT,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "updated_at" timestamptz NOT NULL DEFAULT now(),
  "version" integer NOT NULL DEFAULT 1,
  "created_by" uuid,
  "updated_by" uuid,
  "partner_id" uuid NOT NULL,
  "period_start" date NOT NULL,
  "ncr_count" integer NOT NULL DEFAULT 0,
  "rejection_count" integer NOT NULL DEFAULT 0,
  "on_time_deliveries" integer NOT NULL DEFAULT 0,
  "total_deliveries" integer NOT NULL DEFAULT 0,
  "score" numeric(5, 2) NOT NULL,
  "computed_at" timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT pk_supplier_quality_scores PRIMARY KEY ("id"),
  CONSTRAINT uq_supplier_quality_scores_id_tenant UNIQUE ("id", "tenant_id"),
  CONSTRAINT uq_supplier_quality_scores_tenant_partner_period
    UNIQUE ("tenant_id", "partner_id", "period_start"),
  CONSTRAINT fk_supplier_quality_scores_partner
    FOREIGN KEY ("partner_id", "tenant_id")
    REFERENCES "partners" ("id", "tenant_id") ON DELETE RESTRICT,
  CONSTRAINT ck_supplier_quality_scores_counts
    CHECK (
      "ncr_count" >= 0 AND "rejection_count" >= 0
      AND "on_time_deliveries" >= 0 AND "total_deliveries" >= 0
      AND "total_deliveries" >= "on_time_deliveries"
    ),
  CONSTRAINT ck_supplier_quality_scores_score
    CHECK ("score" >= 0 AND "score" <= 100)
);

--> statement-breakpoint
CREATE INDEX IF NOT EXISTS ix_supplier_quality_scores_tenant_period
  ON "supplier_quality_scores" ("tenant_id", "period_start");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS ix_supplier_quality_scores_tenant_partner
  ON "supplier_quality_scores" ("tenant_id", "partner_id");

--> statement-breakpoint
-- ---------------------------------------------------------------------------
-- 3. coa_documents (Q-07 — the generated certificate + the frozen
--    parameter snapshot; BR-104's gate is the W-27 generation service's).
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "coa_documents" (
  "id" uuid NOT NULL,
  "tenant_id" uuid NOT NULL REFERENCES "tenants" ("id") ON DELETE RESTRICT,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "updated_at" timestamptz NOT NULL DEFAULT now(),
  "version" integer NOT NULL DEFAULT 1,
  "created_by" uuid,
  "updated_by" uuid,
  "doc_no" text NOT NULL,
  "doc_type" text NOT NULL,
  "item_id" uuid NOT NULL,
  "batch_id" uuid,
  "inspection_id" uuid,
  "parameters" jsonb NOT NULL,
  "issued_at" timestamptz NOT NULL,
  "issued_by" uuid,
  "note" text,
  "note_ar" text,
  CONSTRAINT pk_coa_documents PRIMARY KEY ("id"),
  CONSTRAINT uq_coa_documents_id_tenant UNIQUE ("id", "tenant_id"),
  CONSTRAINT uq_coa_documents_tenant_no UNIQUE ("tenant_id", "doc_no"),
  CONSTRAINT fk_coa_documents_item
    FOREIGN KEY ("item_id", "tenant_id")
    REFERENCES "items" ("id", "tenant_id") ON DELETE RESTRICT,
  CONSTRAINT fk_coa_documents_batch
    FOREIGN KEY ("batch_id", "tenant_id")
    REFERENCES "item_batches" ("id", "tenant_id") ON DELETE RESTRICT,
  CONSTRAINT fk_coa_documents_inspection
    FOREIGN KEY ("inspection_id", "tenant_id")
    REFERENCES "inspections" ("id", "tenant_id") ON DELETE RESTRICT,
  CONSTRAINT ck_coa_documents_type
    CHECK ("doc_type" IN ('COA', 'COC')),
  -- The frozen snapshot (BR-104's own record): the array of the item's
  -- parameters as generated — each entry the parameter/target/tolerance
  -- band/measured value/within flag (+ the accepted-deviation NCR
  -- reference where one was consumed). The certificate print reads this
  -- array VERBATIM (the W-13 print law: never recomputed).
  CONSTRAINT ck_coa_documents_parameters_shape
    CHECK (jsonb_typeof("parameters") = 'array')
);

--> statement-breakpoint
CREATE INDEX IF NOT EXISTS ix_coa_documents_tenant_item
  ON "coa_documents" ("tenant_id", "item_id", "issued_at");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS ix_coa_documents_tenant_batch
  ON "coa_documents" ("tenant_id", "batch_id")
  WHERE "batch_id" IS NOT NULL;

--> statement-breakpoint
-- ---------------------------------------------------------------------------
-- 4. RLS (the A1–A10 law) + the purge path.
--> statement-breakpoint
ALTER TABLE "calibration_records" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "calibration_records" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
SELECT erp.apply_tenant_policy('"calibration_records"');
--> statement-breakpoint
ALTER TABLE "supplier_quality_scores" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "supplier_quality_scores" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
SELECT erp.apply_tenant_policy('"supplier_quality_scores"');
--> statement-breakpoint
ALTER TABLE "coa_documents" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "coa_documents" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
SELECT erp.apply_tenant_policy('"coa_documents"');
--> statement-breakpoint
DO $$
DECLARE
  t text;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'calibration_records', 'supplier_quality_scores', 'coa_documents'
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
-- 5. Grants — the evidence discipline (calibration history, issued
--    certificates) vs the rebuildable fold (supplier scores).
--> statement-breakpoint
REVOKE ALL ON "calibration_records" FROM erp_app;
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE ON "calibration_records" TO erp_app;
--> statement-breakpoint
GRANT SELECT ON "calibration_records" TO erp_readonly;
--> statement-breakpoint
GRANT SELECT ON "calibration_records" TO erp_definer;
--> statement-breakpoint
REVOKE ALL ON "supplier_quality_scores" FROM erp_app;
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON "supplier_quality_scores" TO erp_app;
--> statement-breakpoint
GRANT SELECT ON "supplier_quality_scores" TO erp_readonly;
--> statement-breakpoint
GRANT SELECT ON "supplier_quality_scores" TO erp_definer;
--> statement-breakpoint
REVOKE ALL ON "coa_documents" FROM erp_app;
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE ON "coa_documents" TO erp_app;
--> statement-breakpoint
GRANT SELECT ON "coa_documents" TO erp_readonly;
--> statement-breakpoint
GRANT SELECT ON "coa_documents" TO erp_definer;

--> statement-breakpoint
COMMENT ON TABLE "calibration_records" IS 'PHASE-050 (Q-03, T-03): the calibration register — the instrument IS an asset (the 049 handoff: the asset card + the service-history timeline), the standard used, the result PASS/FAIL/ADJUSTED, and the due date (the quality-calibration-due sweep''s own anchor); the external cost posts the G-63 quality expense exactly once / سجل المعايرة: الجهاز أصلٌ في سجل 049، وتاريخ الاستحقاق مرساة كنس المعايرة، والتكلفة الخارجية تُرحّل G-63 مرة واحدة';
--> statement-breakpoint
COMMENT ON TABLE "supplier_quality_scores" IS 'PHASE-050 (Q-06, T-03): the supplier quality rolling fold — one row per supplier per period built from NCRs (SUPPLIER source), rejections and delivery performance; the 038 scorecards READ these rows through the documented feed contract, never re-compute / درجات جودة الموردين: صف لكل مورد وفترة، وبطاقات 038 تقرأها عبر عقد التغذية الموثق ولا تعيد الحساب';
--> statement-breakpoint
COMMENT ON TABLE "coa_documents" IS 'PHASE-050 (Q-07, T-03): the generated certificate of analysis (COA) or conformity (COC) — the frozen parameter snapshot (BR-104''s gate at generation: every parameter within tolerance or carrying an accepted-deviation NCR reference), the source inspection link, and the bilingual print reading this array VERBATIM / شهادة التحليل أو المطابقة: لقطة المعاملات المجمدة عند التوليد والطباعة تقرأها حرفيًا';

--> statement-breakpoint
RESET ROLE;

--> statement-breakpoint
-- Schema-state marker for /health/ready (mirrors the migration manifest).
INSERT INTO erp._schema_state (key, value) VALUES ('schema_version', 115)
ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, at = now();
