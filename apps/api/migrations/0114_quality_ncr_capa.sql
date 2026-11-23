-- PHASE-050 (Blueprint v3.0 · CR-20 — QMS) · migration 0114 · THE
-- NCR/CAPA/COMPLAINTS CLUSTER (T-02, the plan's D-02 slot 2:
-- ncr_records — source INSPECTION/PRODUCTION/COMPLAINT/SUPPLIER,
-- severity, affected qty, disposition REWORK/SCRAP/ACCEPT/
-- RETURN_TO_SUPPLIER · capa_records — root cause, actions with
-- owners/dates, effectiveness · complaints — channel, severity,
-- item/batch ref, NCR link).
--
--   §1 ncr_records (Q-01): the non-conformance register with the
--     BR-102 closure gate AT THE FLOOR (no NCR closes without a
--     disposition — the status/disposition/stamps XOR law, the 0105
--     work-order stamp-law shape) and the G-62 write-off stamp
--     (journal_entry_id exists ONLY on the SCRAP disposition path —
--     the 0107 transfer-journal-gate precedent; the posting itself is
--     W-25's through the REAL engine on the purpose-mapped pair, D-05:
--     DR INVENTORY_SHRINKAGE · CR the per-warehouse INVENTORY at the
--     affected quantity's own value — the 044 valuation-ledger
--     precedent; fail-closed PURPOSE_NOT_MAPPED until the tenant maps;
--     INV-013 single-use source key ncr_record/disposition). The
--     affected-quantity floor (> 0) is here; the ≤-on-hand floor is
--     the W-25 service's typed refusal (the batch's live stock is a
--     read, never a DB constraint). REWORK/ACCEPT/RETURN_TO_SUPPLIER
--     carry NO GL entry (D-05's recorded honest shape). Evidence
--     discipline: grants S/I/U, NO DELETE (the 0105 orders precedent —
--     the NCR history is the quality spine).
--   §2 capa_records (Q-02): root cause, the actions array with owners
--     and dates (jsonb — the twelve-table budget has no capa_actions
--     child; the BR-103 gate reads the array's open actions at the
--     service, the DB floor requires the effectiveness record on the
--     CLOSED path), and the G-63 external-cost stamp
--     (journal_entry_id gated to external_cost > 0 — the posting is
--     W-26's: DR QUALITY_EXPENSE · CR EXTERNAL_ACCRUAL, D-06 — the
--     049 G-59 external leg's own shape; the source keys differ from a
--     maintenance work order's external leg BY CONSTRUCTION).
--   §3 complaints (Q-08): the customer-complaint intake (channel,
--     severity, item/batch ref) with the NCR link (composite FK) and
--     the resolved-shape floor (resolution + resolved_at together on
--     the RESOLVED/CLOSED paths — the stamp law's shape).
--
--   THE D-02 DISCLOSURE (the standing law): the chain 113 → 114 ·
--     ENTITY_CATALOG 329 → 332 (this migration's +3) · the drift 337
--     unchanged (0116's data page) · ROUTE_PERMISSIONS 1,102 unchanged
--     (keys-seed-first).
--
--   Ledger-free at the table level by design: the G-62/G-63 stamps'
--     journal_entry_id columns land here gated (the DB floor), the
--     postings + the canon rows are the W-25/W-26/W-32 waves'.

--> statement-breakpoint
SET ROLE erp_migrate;

--> statement-breakpoint
-- ---------------------------------------------------------------------------
-- 1. ncr_records (Q-01 — the non-conformance register, BR-102's floor).
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "ncr_records" (
  "id" uuid NOT NULL,
  "tenant_id" uuid NOT NULL REFERENCES "tenants" ("id") ON DELETE RESTRICT,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "updated_at" timestamptz NOT NULL DEFAULT now(),
  "version" integer NOT NULL DEFAULT 1,
  "created_by" uuid,
  "updated_by" uuid,
  "ncr_no" text NOT NULL,
  "source" text NOT NULL,
  "severity" text NOT NULL DEFAULT 'MEDIUM',
  "item_id" uuid NOT NULL,
  "batch_id" uuid,
  "inspection_id" uuid,
  "partner_id" uuid,
  "problem" text NOT NULL,
  "problem_ar" text,
  "affected_qty" numeric(19, 6) NOT NULL,
  "status" text NOT NULL DEFAULT 'OPEN',
  "disposition" text,
  "disposition_at" timestamptz,
  "closed_at" timestamptz,
  "journal_entry_id" uuid,
  "note" text,
  "note_ar" text,
  CONSTRAINT pk_ncr_records PRIMARY KEY ("id"),
  CONSTRAINT uq_ncr_records_id_tenant UNIQUE ("id", "tenant_id"),
  CONSTRAINT uq_ncr_records_tenant_no UNIQUE ("tenant_id", "ncr_no"),
  CONSTRAINT fk_ncr_records_item
    FOREIGN KEY ("item_id", "tenant_id")
    REFERENCES "items" ("id", "tenant_id") ON DELETE RESTRICT,
  CONSTRAINT fk_ncr_records_batch
    FOREIGN KEY ("batch_id", "tenant_id")
    REFERENCES "item_batches" ("id", "tenant_id") ON DELETE RESTRICT,
  CONSTRAINT fk_ncr_records_inspection
    FOREIGN KEY ("inspection_id", "tenant_id")
    REFERENCES "inspections" ("id", "tenant_id") ON DELETE RESTRICT,
  CONSTRAINT fk_ncr_records_partner
    FOREIGN KEY ("partner_id", "tenant_id")
    REFERENCES "partners" ("id", "tenant_id") ON DELETE RESTRICT,
  CONSTRAINT fk_ncr_records_journal
    FOREIGN KEY ("journal_entry_id", "tenant_id")
    REFERENCES "journal_entries" ("id", "tenant_id") ON DELETE RESTRICT,
  CONSTRAINT ck_ncr_records_source
    CHECK ("source" IN ('INSPECTION', 'PRODUCTION', 'COMPLAINT', 'SUPPLIER')),
  CONSTRAINT ck_ncr_records_severity
    CHECK ("severity" IN ('LOW', 'MEDIUM', 'HIGH', 'CRITICAL')),
  CONSTRAINT ck_ncr_records_disposition
    CHECK ("disposition" IS NULL OR "disposition" IN ('REWORK', 'SCRAP', 'ACCEPT', 'RETURN_TO_SUPPLIER')),
  CONSTRAINT ck_ncr_records_status
    CHECK ("status" IN ('OPEN', 'DISPOSITIONED', 'CLOSED')),
  CONSTRAINT ck_ncr_records_affected_qty
    CHECK ("affected_qty" > 0),
  -- The source shape (the 0026 inspections target-shape precedent): an
  -- INSPECTION-sourced NCR carries its inspection; a SUPPLIER-sourced
  -- NCR carries its supplier partner; a COMPLAINT-sourced NCR carries
  -- the complaining customer (the complaints row links back through
  -- its own ncr_id). PRODUCTION carries the batch when known.
  CONSTRAINT ck_ncr_records_source_shape
    CHECK (
      ("source" <> 'INSPECTION' OR "inspection_id" IS NOT NULL)
      AND ("source" NOT IN ('SUPPLIER', 'COMPLAINT') OR "partner_id" IS NOT NULL)
    ),
  -- BR-102's floor (the 0105 stamp-law shape): OPEN carries no
  -- disposition and no stamps; DISPOSITIONED exactly the disposition
  -- pair; CLOSED both pairs. No closure without a disposition — the
  -- typed refusal's DB floor (the service names the record).
  CONSTRAINT ck_ncr_records_disposition_gate
    CHECK (
      ("status" = 'OPEN' AND "disposition" IS NULL AND "disposition_at" IS NULL
         AND "closed_at" IS NULL)
      OR ("status" = 'DISPOSITIONED' AND "disposition" IS NOT NULL
           AND "disposition_at" IS NOT NULL AND "closed_at" IS NULL)
      OR ("status" = 'CLOSED' AND "disposition" IS NOT NULL
           AND "disposition_at" IS NOT NULL AND "closed_at" IS NOT NULL)
    ),
  -- The G-62 stamp exists only on the SCRAP disposition path (the 0107
  -- journal-gate precedent): the write-off posts exactly once at the
  -- disposition act through the REAL engine (W-25); every other
  -- disposition carries NO GL entry (D-05's recorded honest shape).
  CONSTRAINT ck_ncr_records_journal_gated
    CHECK (
      "journal_entry_id" IS NULL
      OR ("disposition" = 'SCRAP' AND "status" IN ('DISPOSITIONED', 'CLOSED'))
    )
);

--> statement-breakpoint
CREATE INDEX IF NOT EXISTS ix_ncr_records_tenant_status
  ON "ncr_records" ("tenant_id", "status");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS ix_ncr_records_tenant_item
  ON "ncr_records" ("tenant_id", "item_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS ix_ncr_records_tenant_batch
  ON "ncr_records" ("tenant_id", "batch_id")
  WHERE "batch_id" IS NOT NULL;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS ix_ncr_records_tenant_partner
  ON "ncr_records" ("tenant_id", "partner_id")
  WHERE "partner_id" IS NOT NULL;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS ix_ncr_records_tenant_source
  ON "ncr_records" ("tenant_id", "source");

--> statement-breakpoint
-- ---------------------------------------------------------------------------
-- 2. capa_records (Q-02 — the corrective/preventive action register,
--    BR-103's floor + the G-63 cost stamp).
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "capa_records" (
  "id" uuid NOT NULL,
  "tenant_id" uuid NOT NULL REFERENCES "tenants" ("id") ON DELETE RESTRICT,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "updated_at" timestamptz NOT NULL DEFAULT now(),
  "version" integer NOT NULL DEFAULT 1,
  "created_by" uuid,
  "updated_by" uuid,
  "capa_no" text NOT NULL,
  "ncr_id" uuid,
  "title" text NOT NULL,
  "owner_employee_id" uuid,
  "root_cause" text,
  "root_cause_at" timestamptz,
  "actions" jsonb NOT NULL DEFAULT '[]'::jsonb,
  "due_date" date,
  "status" text NOT NULL DEFAULT 'OPEN',
  "effectiveness" jsonb,
  "external_cost" numeric(19, 4) NOT NULL DEFAULT 0,
  "journal_entry_id" uuid,
  "closed_at" timestamptz,
  "note" text,
  "note_ar" text,
  CONSTRAINT pk_capa_records PRIMARY KEY ("id"),
  CONSTRAINT uq_capa_records_id_tenant UNIQUE ("id", "tenant_id"),
  CONSTRAINT uq_capa_records_tenant_no UNIQUE ("tenant_id", "capa_no"),
  CONSTRAINT fk_capa_records_ncr
    FOREIGN KEY ("ncr_id", "tenant_id")
    REFERENCES "ncr_records" ("id", "tenant_id") ON DELETE RESTRICT,
  CONSTRAINT fk_capa_records_owner
    FOREIGN KEY ("owner_employee_id", "tenant_id")
    REFERENCES "employees" ("id", "tenant_id") ON DELETE RESTRICT,
  CONSTRAINT fk_capa_records_journal
    FOREIGN KEY ("journal_entry_id", "tenant_id")
    REFERENCES "journal_entries" ("id", "tenant_id") ON DELETE RESTRICT,
  CONSTRAINT ck_capa_records_status
    CHECK ("status" IN ('OPEN', 'IN_PROGRESS', 'CLOSED')),
  CONSTRAINT ck_capa_records_external_cost
    CHECK ("external_cost" >= 0),
  CONSTRAINT ck_capa_records_actions_shape
    CHECK (jsonb_typeof("actions") = 'array'),
  CONSTRAINT ck_capa_records_effectiveness_shape
    CHECK ("effectiveness" IS NULL OR jsonb_typeof("effectiveness") = 'object'),
  -- BR-103's floor: a CAPA never closes without the effectiveness
  -- record (the due-date-passed half of the gate is the W-26 service's
  -- typed refusal — it reads the actions' open due dates, a
  -- CURRENT_DATE comparison never a DB constraint).
  CONSTRAINT ck_capa_records_close_gate
    CHECK (
      ("status" <> 'CLOSED' AND "closed_at" IS NULL)
      OR ("status" = 'CLOSED' AND "effectiveness" IS NOT NULL
           AND "closed_at" IS NOT NULL)
    ),
  -- The G-63 stamp (the 0107 journal-gate precedent): the external
  -- service cost posts exactly once through the REAL engine (W-26:
  -- DR QUALITY_EXPENSE · CR EXTERNAL_ACCRUAL — D-06, the 049 G-59
  -- external leg's own shape); a zero-cost CAPA carries no entry.
  CONSTRAINT ck_capa_records_journal_gated
    CHECK (
      "journal_entry_id" IS NULL
      OR ("external_cost" > 0 AND "status" IN ('IN_PROGRESS', 'CLOSED'))
    )
);

--> statement-breakpoint
CREATE INDEX IF NOT EXISTS ix_capa_records_tenant_status
  ON "capa_records" ("tenant_id", "status");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS ix_capa_records_tenant_ncr
  ON "capa_records" ("tenant_id", "ncr_id")
  WHERE "ncr_id" IS NOT NULL;

--> statement-breakpoint
-- ---------------------------------------------------------------------------
-- 3. complaints (Q-08 — the customer-complaint intake with the NCR link).
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "complaints" (
  "id" uuid NOT NULL,
  "tenant_id" uuid NOT NULL REFERENCES "tenants" ("id") ON DELETE RESTRICT,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "updated_at" timestamptz NOT NULL DEFAULT now(),
  "version" integer NOT NULL DEFAULT 1,
  "created_by" uuid,
  "updated_by" uuid,
  "complaint_no" text NOT NULL,
  "channel" text NOT NULL,
  "severity" text NOT NULL DEFAULT 'MEDIUM',
  "customer_id" uuid NOT NULL,
  "item_id" uuid,
  "batch_id" uuid,
  "ncr_id" uuid,
  "subject" text NOT NULL,
  "details" text,
  "details_ar" text,
  "status" text NOT NULL DEFAULT 'NEW',
  "resolution" text,
  "resolved_at" timestamptz,
  "note" text,
  "note_ar" text,
  CONSTRAINT pk_complaints PRIMARY KEY ("id"),
  CONSTRAINT uq_complaints_id_tenant UNIQUE ("id", "tenant_id"),
  CONSTRAINT uq_complaints_tenant_no UNIQUE ("tenant_id", "complaint_no"),
  CONSTRAINT fk_complaints_customer
    FOREIGN KEY ("customer_id", "tenant_id")
    REFERENCES "partners" ("id", "tenant_id") ON DELETE RESTRICT,
  CONSTRAINT fk_complaints_item
    FOREIGN KEY ("item_id", "tenant_id")
    REFERENCES "items" ("id", "tenant_id") ON DELETE RESTRICT,
  CONSTRAINT fk_complaints_batch
    FOREIGN KEY ("batch_id", "tenant_id")
    REFERENCES "item_batches" ("id", "tenant_id") ON DELETE RESTRICT,
  CONSTRAINT fk_complaints_ncr
    FOREIGN KEY ("ncr_id", "tenant_id")
    REFERENCES "ncr_records" ("id", "tenant_id") ON DELETE RESTRICT,
  CONSTRAINT ck_complaints_channel
    CHECK ("channel" IN ('PHONE', 'EMAIL', 'WALK_IN', 'PORTAL', 'SOCIAL', 'OTHER')),
  CONSTRAINT ck_complaints_severity
    CHECK ("severity" IN ('LOW', 'MEDIUM', 'HIGH', 'CRITICAL')),
  CONSTRAINT ck_complaints_status
    CHECK ("status" IN ('NEW', 'TRIAGED', 'IN_PROGRESS', 'RESOLVED', 'CLOSED')),
  -- The resolved shape (the stamp law's shape): the RESOLVED/CLOSED
  -- paths carry exactly the resolution pair, never one without the other.
  CONSTRAINT ck_complaints_resolved_shape
    CHECK (
      ("status" NOT IN ('RESOLVED', 'CLOSED') AND "resolution" IS NULL
         AND "resolved_at" IS NULL)
      OR ("status" IN ('RESOLVED', 'CLOSED') AND "resolution" IS NOT NULL
           AND "resolved_at" IS NOT NULL)
    )
);

--> statement-breakpoint
CREATE INDEX IF NOT EXISTS ix_complaints_tenant_status
  ON "complaints" ("tenant_id", "status");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS ix_complaints_tenant_customer
  ON "complaints" ("tenant_id", "customer_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS ix_complaints_tenant_ncr
  ON "complaints" ("tenant_id", "ncr_id")
  WHERE "ncr_id" IS NOT NULL;

--> statement-breakpoint
-- ---------------------------------------------------------------------------
-- 4. RLS (the A1–A10 law) + the purge path.
--> statement-breakpoint
ALTER TABLE "ncr_records" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "ncr_records" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
SELECT erp.apply_tenant_policy('"ncr_records"');
--> statement-breakpoint
ALTER TABLE "capa_records" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "capa_records" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
SELECT erp.apply_tenant_policy('"capa_records"');
--> statement-breakpoint
ALTER TABLE "complaints" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "complaints" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
SELECT erp.apply_tenant_policy('"complaints"');
--> statement-breakpoint
DO $$
DECLARE
  t text;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'ncr_records', 'capa_records', 'complaints'
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
-- 5. Grants — the evidence discipline: S/I/U, NO DELETE (the NCR/CAPA/
--    complaint histories are the quality spine; the D-19 A5 split
--    asserts the no-DELETE grant by design).
--> statement-breakpoint
REVOKE ALL ON "ncr_records" FROM erp_app;
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE ON "ncr_records" TO erp_app;
--> statement-breakpoint
GRANT SELECT ON "ncr_records" TO erp_readonly;
--> statement-breakpoint
GRANT SELECT ON "ncr_records" TO erp_definer;
--> statement-breakpoint
REVOKE ALL ON "capa_records" FROM erp_app;
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE ON "capa_records" TO erp_app;
--> statement-breakpoint
GRANT SELECT ON "capa_records" TO erp_readonly;
--> statement-breakpoint
GRANT SELECT ON "capa_records" TO erp_definer;
--> statement-breakpoint
REVOKE ALL ON "complaints" FROM erp_app;
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE ON "complaints" TO erp_app;
--> statement-breakpoint
GRANT SELECT ON "complaints" TO erp_readonly;
--> statement-breakpoint
GRANT SELECT ON "complaints" TO erp_definer;

--> statement-breakpoint
COMMENT ON TABLE "ncr_records" IS 'PHASE-050 (Q-01, T-02): the non-conformance register — source INSPECTION/PRODUCTION/COMPLAINT/SUPPLIER, severity, affected quantity, disposition REWORK/SCRAP/ACCEPT/RETURN_TO_SUPPLIER; BR-102''s floor: no closure without a disposition (the status/disposition XOR law); the SCRAP disposition posts the G-62 inventory write-off exactly once through the REAL engine (the stamp exists only on that path) / سجل حالات عدم المطابقة: لا إغلاق بلا قرار تصرف، وتصرف الإتلاف يرحّل شطب المخزون G-62 مرة واحدة عبر المحرك';
--> statement-breakpoint
COMMENT ON TABLE "capa_records" IS 'PHASE-050 (Q-02, T-02): the corrective/preventive action register — root cause, the actions array with owners and dates, and the effectiveness record BR-103 requires before closure; the external service cost posts the G-63 quality expense exactly once (DR QUALITY_EXPENSE · CR EXTERNAL_ACCRUAL, the stamp only with a cost) / سجل الإجراءات التصحيحية والوقائية: لا إغلاق قبل تسجيل التحقق من الفعالية، والتكلفة الخارجية تُرحّل G-63 مرة واحدة';
--> statement-breakpoint
COMMENT ON TABLE "complaints" IS 'PHASE-050 (Q-08, T-02): the customer-complaint intake — channel, severity, item/batch reference, the NCR link, and the resolution pair stamped together on the resolved paths / استقبال شكاوى العملاء: القناة والشدة ومرجع الصنف أو الدفعة وربط NCR مع قرار المعالجة';

--> statement-breakpoint
RESET ROLE;

--> statement-breakpoint
-- Schema-state marker for /health/ready (mirrors the migration manifest).
INSERT INTO erp._schema_state (key, value) VALUES ('schema_version', 114)
ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, at = now();
