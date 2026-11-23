-- PHASE-050 (Blueprint v3.0 · CR-20 — QMS, Quality Management System) ·
-- migration 0113 · THE SPECIFICATIONS + SPC MEASUREMENTS CLUSTER (T-01,
-- the plan's D-02 slot 1: quality_specifications per item + parameter
-- rows, target, UCL/LCL · spc_measurements per-parameter samples —
-- D-12: the measurements draw from the specifications' parameters, no
-- parallel parameter source).
--
--   §1 quality_specifications (Q-05): one row per (tenant, item,
--     parameter) — the target value with the tolerance band UCL/LCL.
--     THE NO-FABRICATION LAW at the floor (red line 5, the BR-055
--     family): UCL/LCL are NULLABLE — an unset tolerance is
--     UNTOLERATED, never a fabricated limit; the BR-104 gate reads
--     exactly what is set. The band, when both ends are set, is a real
--     band (UCL > LCL — a point band is refused here, a one-sided band
--     is legal: only UCL or only LCL). Master data (grants S/I/U/D —
--     the 0105 maintenance_plans precedent: the typed service guards
--     own the lifecycle, the COA/SPC readers' FK RESTRICT protects the
--     rows with history).
--   §2 spc_measurements (Q-04): the per-parameter samples feeding the
--     computed X-bar/R charts, Cp/Cpk and the out-of-control flags
--     (D-12: the PURE module first with property tests — W-27's unit
--     law; this table is only the sample store). Evidence discipline:
--     grants S/I/U, NO DELETE (the 0106 asset_meter_readings precedent
--     — the measurements are the chart's history); the optional batch
--     link carries the sample's provenance on the existing batch
--     ledger (composite FK, RESTRICT).
--
--   THE D-02 DISCLOSURE (the standing law — this provision's final
--     expected fingerprint, announced in its own wave's envelope):
--     the chain 112 → 113 · ENTITY_CATALOG 328 → 329 (this migration's
--     +1) → 340 at 0116 (the four slots' +12 together) · the
--     permissions drift 337 unchanged here (the +10 keys are 0116's
--     data page) · ROUTE_PERMISSIONS 1,102 unchanged (keys-seed-first,
--     the 0108 §1 precedent — zero routes before the W-25+ service
--     waves).
--
--   Ledger-free by design (D-05/D-06 are W-25/W-26's service waves;
--     G-62/G-63 post through the REAL engine with registered source
--     keys — the canon rows are W-32's; this migration creates no
--     journal surface).

--> statement-breakpoint
SET ROLE erp_migrate;

--> statement-breakpoint
-- ---------------------------------------------------------------------------
-- 1. quality_specifications (Q-05 — the per-item parameter register).
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "quality_specifications" (
  "id" uuid NOT NULL,
  "tenant_id" uuid NOT NULL REFERENCES "tenants" ("id") ON DELETE RESTRICT,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "updated_at" timestamptz NOT NULL DEFAULT now(),
  "version" integer NOT NULL DEFAULT 1,
  "created_by" uuid,
  "updated_by" uuid,
  "item_id" uuid NOT NULL,
  "parameter" text NOT NULL,
  "parameter_ar" text,
  "unit" text,
  "target_value" numeric(19, 6) NOT NULL,
  "ucl" numeric(19, 6),
  "lcl" numeric(19, 6),
  "is_active" boolean NOT NULL DEFAULT true,
  "note" text,
  "note_ar" text,
  CONSTRAINT pk_quality_specifications PRIMARY KEY ("id"),
  CONSTRAINT uq_quality_specifications_id_tenant UNIQUE ("id", "tenant_id"),
  CONSTRAINT uq_quality_specifications_tenant_item_parameter
    UNIQUE ("tenant_id", "item_id", "parameter"),
  CONSTRAINT fk_quality_specifications_item
    FOREIGN KEY ("item_id", "tenant_id")
    REFERENCES "items" ("id", "tenant_id") ON DELETE RESTRICT,
  CONSTRAINT ck_quality_specifications_parameter_length
    CHECK (length("parameter") BETWEEN 1 AND 120),
  CONSTRAINT ck_quality_specifications_unit_length
    CHECK ("unit" IS NULL OR length("unit") BETWEEN 1 AND 16),
  -- THE NO-FABRICATION FLOOR (red line 5): both tolerance ends NULLABLE
  -- — an unset tolerance is UNTOLERATED, never a fabricated limit; a
  -- one-sided band (only UCL or only LCL) is legal; when both are set
  -- the band is real (UCL > LCL — a point band is refused).
  CONSTRAINT ck_quality_specifications_band
    CHECK ("ucl" IS NULL OR "lcl" IS NULL OR "ucl" > "lcl")
);

--> statement-breakpoint
CREATE INDEX IF NOT EXISTS ix_quality_specifications_tenant_item
  ON "quality_specifications" ("tenant_id", "item_id", "is_active");

--> statement-breakpoint
-- ---------------------------------------------------------------------------
-- 2. spc_measurements (Q-04 — the per-parameter sample store; the PURE
--    SPC module + its property tests are W-27's — D-12's unit-first law).
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "spc_measurements" (
  "id" uuid NOT NULL,
  "tenant_id" uuid NOT NULL REFERENCES "tenants" ("id") ON DELETE RESTRICT,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "updated_at" timestamptz NOT NULL DEFAULT now(),
  "version" integer NOT NULL DEFAULT 1,
  "created_by" uuid,
  "updated_by" uuid,
  "spec_id" uuid NOT NULL,
  "value" numeric(19, 6) NOT NULL,
  "sampled_at" timestamptz NOT NULL,
  "source" text NOT NULL DEFAULT 'MANUAL',
  "batch_id" uuid,
  "note" text,
  CONSTRAINT pk_spc_measurements PRIMARY KEY ("id"),
  CONSTRAINT uq_spc_measurements_id_tenant UNIQUE ("id", "tenant_id"),
  CONSTRAINT fk_spc_measurements_spec
    FOREIGN KEY ("spec_id", "tenant_id")
    REFERENCES "quality_specifications" ("id", "tenant_id") ON DELETE RESTRICT,
  CONSTRAINT fk_spc_measurements_batch
    FOREIGN KEY ("batch_id", "tenant_id")
    REFERENCES "item_batches" ("id", "tenant_id") ON DELETE RESTRICT,
  CONSTRAINT ck_spc_measurements_source
    CHECK ("source" IN ('MANUAL', 'PRODUCTION', 'INSPECTION'))
);

--> statement-breakpoint
CREATE INDEX IF NOT EXISTS ix_spc_measurements_tenant_spec_sampled
  ON "spc_measurements" ("tenant_id", "spec_id", "sampled_at");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS ix_spc_measurements_tenant_batch
  ON "spc_measurements" ("tenant_id", "batch_id")
  WHERE "batch_id" IS NOT NULL;

--> statement-breakpoint
-- ---------------------------------------------------------------------------
-- 3. RLS (the A1–A10 law) + the purge path.
--> statement-breakpoint
ALTER TABLE "quality_specifications" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "quality_specifications" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
SELECT erp.apply_tenant_policy('"quality_specifications"');
--> statement-breakpoint
ALTER TABLE "spc_measurements" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "spc_measurements" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
SELECT erp.apply_tenant_policy('"spc_measurements"');
--> statement-breakpoint
DO $$
DECLARE
  t text;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'quality_specifications', 'spc_measurements'
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
-- 4. Grants — master data vs the evidence discipline.
--> statement-breakpoint
REVOKE ALL ON "quality_specifications" FROM erp_app;
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON "quality_specifications" TO erp_app;
--> statement-breakpoint
GRANT SELECT ON "quality_specifications" TO erp_readonly;
--> statement-breakpoint
GRANT SELECT ON "quality_specifications" TO erp_definer;
--> statement-breakpoint
REVOKE ALL ON "spc_measurements" FROM erp_app;
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE ON "spc_measurements" TO erp_app;
--> statement-breakpoint
GRANT SELECT ON "spc_measurements" TO erp_readonly;
--> statement-breakpoint
GRANT SELECT ON "spc_measurements" TO erp_definer;

--> statement-breakpoint
COMMENT ON TABLE "quality_specifications" IS 'PHASE-050 (Q-05, T-01): the per-item quality specifications — one row per (tenant, item, parameter) with the target value and the UCL/LCL tolerance band (an unset tolerance is UNTOLERATED, never a fabricated limit; a one-sided band is legal); they feed the inspection-line mapping, the SPC charts and the COA generation / مواصفات الجودة لكل صنف: صف لكل معامل بقيمة الهدف وحدود التحمل العليا والدنيا';
--> statement-breakpoint
COMMENT ON TABLE "spc_measurements" IS 'PHASE-050 (Q-04, T-01): the per-parameter SPC samples — the computed X-bar/R charts, Cp/Cpk and the out-of-control flags draw from these rows through the PURE module (D-12: the parameters come from the specifications, no parallel source); evidence discipline: no DELETE / قياسات SPC لكل معامل: عينات الخرائط المحسوبة بلا حذف — سجل الإثبات';
--> statement-breakpoint
COMMENT ON COLUMN "quality_specifications"."ucl" IS 'PHASE-050 (red line 5): the upper control limit — NULLABLE by law: an unset tolerance is UNTOLERATED, never a fabricated limit / الحد الأعلى للتحمل — عدم الضبط يعني عدم القبول، لا حدًّا مُختلقًا';
--> statement-breakpoint
COMMENT ON COLUMN "quality_specifications"."lcl" IS 'PHASE-050 (red line 5): the lower control limit — NULLABLE by law (see ucl) / الحد الأدنى للتحمل — عدم الضبط يعني عدم القبول، لا حدًّا مُختلقًا';

--> statement-breakpoint
RESET ROLE;

--> statement-breakpoint
-- Schema-state marker for /health/ready (mirrors the migration manifest).
INSERT INTO erp._schema_state (key, value) VALUES ('schema_version', 113)
ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, at = now();
