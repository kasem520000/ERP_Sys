-- PHASE-049 (Blueprint v3.0 · CR-19, extended by v3.2/CR-50) · migration
-- 0106 · CMMS — Asset Maintenance (part 2: the meters + the readings
-- log + the spare-parts BOM + the signed tags — T-02, the plan §2's
-- honest slot).
--
--   asset_meters (D-07 — FA-F-05): type HOURS/KM/PRODUCTION/CUSTOM,
--     unit, the last-reading snapshot (last_value — recomputed to the
--     max: a back-dated-but-higher reading is LEGAL and moves it,
--     D-07's effective-date semantics), and THE ODOMETER DESIGNATION
--     (is_odometer — the R-10 fleet-light binding: ONE KM-type meter
--     per asset carries it, the partial unique's law).
--   asset_meter_readings (D-07 — FA-F-05): value, effective date,
--     source MANUAL/JOB/IMPORT — the readings LOG that drives METER
--     triggers and the usage views (the views derive from the log,
--     never a stored sum — the BR-089 zero-residue spirit). JOB
--     readings carry their work-order link (the technician's entry —
--     the XOR gate). THE MONOTONIC LAW (a reading below the meter's
--     current snapshot is refused, the typed error carrying both
--     values) is the W-18 service's; the DB floor keeps value >= 0.
--     Evidence discipline: NO delete (the log is the usage truth).
--   asset_spares (D-05 — FA-F-04, BR-099): the spare-parts BOM per
--     asset — the item-master FK (the phase doc's own drift
--     mitigation: discontinued items refuse at BOM save, the W-18
--     service's typed law) + qty per service. Master data with DELETE
--     granted (the 0103 subcontractor_agreements precedent — the typed
--     service guards own the lifecycle).
--   asset_tags (D-09 — FA-F-06): the signed codes — unguessable
--     (256-bit entropy, the capability-token precedent), unique per
--     tenant, created/printed stamps. The scan surface resolves the
--     code to the asset card through the standard auth + RLS stack (a
--     foreign tenant's scan is a typed 404; an unsigned/forged code
--     refuses at the signature, never at a lookup — W-19's API). The
--     signature itself is computed over the code (the platform's
--     existing HMAC capability) — the W-19 print sheet's law.
--
--   PLUS THE ADDITIVE FK: maintenance_plans.meter_id → asset_meters
--     (0105's own recorded note — the 0100/0104 additive precedent,
--     never a forward reference).

--> statement-breakpoint
SET ROLE erp_migrate;

--> statement-breakpoint
-- ---------------------------------------------------------------------------
-- 1. asset_meters (the register + the snapshot + the odometer binding).
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "asset_meters" (
  "id" uuid NOT NULL,
  "tenant_id" uuid NOT NULL REFERENCES "tenants" ("id") ON DELETE RESTRICT,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "updated_at" timestamptz NOT NULL DEFAULT now(),
  "version" integer NOT NULL DEFAULT 1,
  "created_by" uuid,
  "updated_by" uuid,
  "asset_id" uuid NOT NULL,
  "name" text NOT NULL,
  "name_ar" text,
  "type" text NOT NULL,
  "unit" text NOT NULL,
  "is_odometer" boolean NOT NULL DEFAULT false,
  "last_value" numeric(19, 6) NOT NULL DEFAULT 0,
  "last_reading_at" timestamptz,
  "note" text,
  "note_ar" text,
  CONSTRAINT pk_asset_meters PRIMARY KEY ("id"),
  CONSTRAINT uq_asset_meters_id_tenant UNIQUE ("id", "tenant_id"),
  CONSTRAINT uq_asset_meters_tenant_asset_name UNIQUE ("tenant_id", "asset_id", "name"),
  CONSTRAINT fk_asset_meters_asset
    FOREIGN KEY ("asset_id", "tenant_id")
    REFERENCES "assets" ("id", "tenant_id") ON DELETE RESTRICT,
  CONSTRAINT ck_asset_meters_type
    CHECK ("type" IN ('HOURS', 'KM', 'PRODUCTION', 'CUSTOM')),
  CONSTRAINT ck_asset_meters_unit
    CHECK (char_length("unit") >= 1 AND char_length("unit") <= 16),
  CONSTRAINT ck_asset_meters_last_value
    CHECK ("last_value" >= 0),
  -- The odometer designation is the KM-type meter's (R-10's binding —
  -- the fleet register reads THE odometer meter of a vehicle-class
  -- asset; never a hours/production/custom odometer).
  CONSTRAINT ck_asset_meters_odometer_gated
    CHECK ("is_odometer" = false OR "type" = 'KM')
);

--> statement-breakpoint
CREATE INDEX IF NOT EXISTS ix_asset_meters_tenant_asset
  ON "asset_meters" ("tenant_id", "asset_id");
--> statement-breakpoint
-- R-10: ONE odometer designation per asset.
CREATE UNIQUE INDEX IF NOT EXISTS uq_asset_meters_tenant_asset_odometer
  ON "asset_meters" ("tenant_id", "asset_id")
  WHERE "is_odometer";

--> statement-breakpoint
-- ---------------------------------------------------------------------------
-- 2. The additive FK from 0105 (the plans' chosen meter — the recorded
--    note honored).
--> statement-breakpoint
ALTER TABLE "maintenance_plans"
  ADD CONSTRAINT fk_maintenance_plans_meter
  FOREIGN KEY ("meter_id", "tenant_id")
  REFERENCES "asset_meters" ("id", "tenant_id") ON DELETE RESTRICT;

--> statement-breakpoint
-- ---------------------------------------------------------------------------
-- 3. asset_meter_readings (the log — the monotonic law's input).
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "asset_meter_readings" (
  "id" uuid NOT NULL,
  "tenant_id" uuid NOT NULL REFERENCES "tenants" ("id") ON DELETE RESTRICT,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "updated_at" timestamptz NOT NULL DEFAULT now(),
  "version" integer NOT NULL DEFAULT 1,
  "created_by" uuid,
  "updated_by" uuid,
  "meter_id" uuid NOT NULL,
  "value" numeric(19, 6) NOT NULL,
  "effective_date" date NOT NULL,
  "source" text NOT NULL DEFAULT 'MANUAL',
  "work_order_id" uuid,
  "note" text,
  "note_ar" text,
  CONSTRAINT pk_asset_meter_readings PRIMARY KEY ("id"),
  CONSTRAINT uq_asset_meter_readings_id_tenant UNIQUE ("id", "tenant_id"),
  CONSTRAINT fk_asset_meter_readings_meter
    FOREIGN KEY ("meter_id", "tenant_id")
    REFERENCES "asset_meters" ("id", "tenant_id") ON DELETE RESTRICT,
  CONSTRAINT fk_asset_meter_readings_work_order
    FOREIGN KEY ("work_order_id", "tenant_id")
    REFERENCES "maintenance_work_orders" ("id", "tenant_id") ON DELETE RESTRICT,
  CONSTRAINT ck_asset_meter_readings_value
    CHECK ("value" >= 0),
  CONSTRAINT ck_asset_meter_readings_source
    CHECK ("source" IN ('MANUAL', 'JOB', 'IMPORT')),
  -- The JOB-source law (D-07): JOB readings arrive from completed work
  -- orders (the technician's entry) — the link exists exactly then.
  CONSTRAINT ck_asset_meter_readings_job_link
    CHECK (("source" = 'JOB') = ("work_order_id" IS NOT NULL))
);

--> statement-breakpoint
CREATE INDEX IF NOT EXISTS ix_asset_meter_readings_tenant_meter
  ON "asset_meter_readings" ("tenant_id", "meter_id", "effective_date");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS ix_asset_meter_readings_tenant_work_order
  ON "asset_meter_readings" ("tenant_id", "work_order_id")
  WHERE "work_order_id" IS NOT NULL;

--> statement-breakpoint
-- ---------------------------------------------------------------------------
-- 4. asset_spares (the BOM — the parts leg's source).
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "asset_spares" (
  "id" uuid NOT NULL,
  "tenant_id" uuid NOT NULL REFERENCES "tenants" ("id") ON DELETE RESTRICT,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "updated_at" timestamptz NOT NULL DEFAULT now(),
  "version" integer NOT NULL DEFAULT 1,
  "created_by" uuid,
  "updated_by" uuid,
  "asset_id" uuid NOT NULL,
  "item_id" uuid NOT NULL,
  "qty" numeric(19, 6) NOT NULL,
  "note" text,
  "note_ar" text,
  CONSTRAINT pk_asset_spares PRIMARY KEY ("id"),
  CONSTRAINT uq_asset_spares_id_tenant UNIQUE ("id", "tenant_id"),
  CONSTRAINT uq_asset_spares_tenant_asset_item UNIQUE ("tenant_id", "asset_id", "item_id"),
  CONSTRAINT fk_asset_spares_asset
    FOREIGN KEY ("asset_id", "tenant_id")
    REFERENCES "assets" ("id", "tenant_id") ON DELETE RESTRICT,
  CONSTRAINT fk_asset_spares_item
    FOREIGN KEY ("item_id", "tenant_id")
    REFERENCES "items" ("id", "tenant_id") ON DELETE RESTRICT,
  CONSTRAINT ck_asset_spares_qty
    CHECK ("qty" > 0)
);

--> statement-breakpoint
CREATE INDEX IF NOT EXISTS ix_asset_spares_tenant_asset
  ON "asset_spares" ("tenant_id", "asset_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS ix_asset_spares_tenant_item
  ON "asset_spares" ("tenant_id", "item_id");

--> statement-breakpoint
-- ---------------------------------------------------------------------------
-- 5. asset_tags (the signed codes — the scan surface's substrate).
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "asset_tags" (
  "id" uuid NOT NULL,
  "tenant_id" uuid NOT NULL REFERENCES "tenants" ("id") ON DELETE RESTRICT,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "updated_at" timestamptz NOT NULL DEFAULT now(),
  "version" integer NOT NULL DEFAULT 1,
  "created_by" uuid,
  "updated_by" uuid,
  "asset_id" uuid NOT NULL,
  "code" text NOT NULL,
  "printed_at" timestamptz,
  "note" text,
  "note_ar" text,
  CONSTRAINT pk_asset_tags PRIMARY KEY ("id"),
  CONSTRAINT uq_asset_tags_id_tenant UNIQUE ("id", "tenant_id"),
  CONSTRAINT uq_asset_tags_tenant_code UNIQUE ("tenant_id", "code"),
  CONSTRAINT fk_asset_tags_asset
    FOREIGN KEY ("asset_id", "tenant_id")
    REFERENCES "assets" ("id", "tenant_id") ON DELETE RESTRICT,
  -- The code shape's generous floor (the signed token's own shape is
  -- W-19's D-09 — payload + HMAC; the floor keeps the column honest
  -- without guessing the token grammar).
  CONSTRAINT ck_asset_tags_code
    CHECK (char_length("code") >= 16 AND char_length("code") <= 512)
);

--> statement-breakpoint
CREATE INDEX IF NOT EXISTS ix_asset_tags_tenant_asset
  ON "asset_tags" ("tenant_id", "asset_id");

--> statement-breakpoint
-- ---------------------------------------------------------------------------
-- 6. RLS (the A1–A10 law) + the purge path.
--> statement-breakpoint
ALTER TABLE "asset_meters" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "asset_meters" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
SELECT erp.apply_tenant_policy('"asset_meters"');
--> statement-breakpoint
ALTER TABLE "asset_meter_readings" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "asset_meter_readings" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
SELECT erp.apply_tenant_policy('"asset_meter_readings"');
--> statement-breakpoint
ALTER TABLE "asset_spares" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "asset_spares" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
SELECT erp.apply_tenant_policy('"asset_spares"');
--> statement-breakpoint
ALTER TABLE "asset_tags" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "asset_tags" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
SELECT erp.apply_tenant_policy('"asset_tags"');
--> statement-breakpoint
DO $$
DECLARE
  t text;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'asset_meters', 'asset_meter_readings', 'asset_spares', 'asset_tags'
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
-- 7. Grants — master data vs the evidence discipline.
--> statement-breakpoint
REVOKE ALL ON "asset_meters" FROM erp_app;
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON "asset_meters" TO erp_app;
--> statement-breakpoint
GRANT SELECT ON "asset_meters" TO erp_readonly;
--> statement-breakpoint
GRANT SELECT ON "asset_meters" TO erp_definer;
--> statement-breakpoint
REVOKE ALL ON "asset_meter_readings" FROM erp_app;
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE ON "asset_meter_readings" TO erp_app;
--> statement-breakpoint
GRANT SELECT ON "asset_meter_readings" TO erp_readonly;
--> statement-breakpoint
GRANT SELECT ON "asset_meter_readings" TO erp_definer;
--> statement-breakpoint
REVOKE ALL ON "asset_spares" FROM erp_app;
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON "asset_spares" TO erp_app;
--> statement-breakpoint
GRANT SELECT ON "asset_spares" TO erp_readonly;
--> statement-breakpoint
GRANT SELECT ON "asset_spares" TO erp_definer;
--> statement-breakpoint
REVOKE ALL ON "asset_tags" FROM erp_app;
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON "asset_tags" TO erp_app;
--> statement-breakpoint
GRANT SELECT ON "asset_tags" TO erp_readonly;
--> statement-breakpoint
GRANT SELECT ON "asset_tags" TO erp_definer;

--> statement-breakpoint
COMMENT ON TABLE "asset_meters" IS 'PHASE-049 (D-07 — FA-F-05): asset meters — HOURS/KM/PRODUCTION/CUSTOM with the last-reading snapshot (recomputed to the max) and the R-10 odometer designation (ONE KM-type meter per asset) / عدادات الأصل: ساعات/كم/إنتاج/مخصص مع لقطة آخر قراءة وتعيين عداد المسافة للأصل';
--> statement-breakpoint
COMMENT ON TABLE "asset_meter_readings" IS 'PHASE-049 (D-07): the readings log — value, effective date, source MANUAL/JOB/IMPORT (JOB carries its work-order link); the usage views derive from the log, never a stored sum / سجل قراءات العدادات: القيمة والتاريخ الفعلي والمصدر — مشاهدات الاستخدام تُشتق من السجل لا من مجموع مخزّن';
--> statement-breakpoint
COMMENT ON TABLE "asset_spares" IS 'PHASE-049 (D-05 — BR-099): the spare-parts BOM per asset — the item-master FK (discontinued items refuse at BOM save); work-order parts lines draw from it and post as an inventory issue (G-60) / قائمة قطع الغيار لكل أصل مرتبطة ببطاقة الصنف — استهلاكها صرف مخزوني عبر G-60';
--> statement-breakpoint
COMMENT ON TABLE "asset_tags" IS 'PHASE-049 (D-09 — FA-F-06): the unguessable signed tag codes — unique per tenant, created/printed stamps; the scan resolves through the standard auth + RLS stack (a foreign tenant 404s; a forged code refuses at the signature) / رموز البطاقات الموقعة غير القابلة للتخمين — المسح يمر عبر المصادقة وعزل المستأجرين';

--> statement-breakpoint
RESET ROLE;

--> statement-breakpoint
-- Schema-state marker for /health/ready (mirrors the migration manifest).
INSERT INTO erp._schema_state (key, value) VALUES ('schema_version', 106)
ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, at = now();
