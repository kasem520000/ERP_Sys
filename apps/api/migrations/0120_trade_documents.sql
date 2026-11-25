-- PHASE-051 (Blueprint v3.0 · CR-21 — Foreign Trade & Logistics) ·
-- migration 0120 · THE TRADE DOCUMENTS CLUSTER (T-02, the approved
-- master plan's D-02 slot 2: incoterms — code, AR/EN names, the
-- carriage/insurance/duty ownership matrix as registry DATA, the 2020
-- seed · bills_of_lading — the multimodal doc types, carrier, ports,
-- container refs, the shipment link · packing_lists — the shipment/
-- receipt link, the line-level pack shapes · certificates_of_origin —
-- the chamber-format bilingual print's own frozen snapshot, the
-- shipment link; the certificate of CONFORMITY rides the same table as
-- a document type — the 050 COA one-table-two-types law).
--
--   §1 incoterms (L-03, D-10/D-16): the tenant-extensible registry —
--     one row per (tenant, code) with the AR/EN names and THE
--     OWNERSHIP MATRIX AS REGISTRY DATA (five booleans: carriage ·
--     insurance · export clearance · import clearance · import duty —
--     the seller side of each dimension; the risk-hint matrix at
--     selection time renders from the row's own data, never code).
--     THE SEED: the 2020 set lands in 0122 §6 (per existing tenant,
--     the 0098 migration-plane pattern) with the documented accuracy
--     disclaimer on every starter row — the tenant owns the final
--     classification (D-16, the BR-055 family). Master data: grants
--     S/I/U/D (the tenant's own registry).
--   §2 bills_of_lading (L-04/L-13, D-14): the transport document —
--     the multimodal doc types (sea/air/road/rail + combined
--     transport), the carrier, the load/discharge ports, the container
--     refs, and THE SHIPMENT LINK (the declared interpretation,
--     recorded here at the claim site: the fourteen-table budget has
--     NO separate shipments table — the B/L IS the shipment's anchor,
--     its carriage contract the shipment's identity; the tracking
--     events (0122) link bill_of_lading_id NOT NULL, and the
--     commercial links purchase_order_id (the import leg) /
--     delivery_note_id (the export leg) keep the acceptance #8 chain
--     navigable: PO → LC/collection → transport documents →
--     declaration → receipt → landed cost). The shipment_status
--     column is the tracking fold's driven surface (W-36's pure
--     module, the monotone ladder — an event never regresses a
--     document's status). Evidence: S/I/U, NO DELETE.
--   §3 packing_lists (L-05, D-14): the shipment/receipt link + the
--     line-level pack shapes (a jsonb array — the 050 CAPA actions
--     precedent: the fourteen-table budget has no child table; each
--     entry the pack's own shape: description/quantity/packages/
--     gross/net weight), with the fold-driven shipment_status mirror.
--     Evidence: S/I/U, NO DELETE.
--   §4 certificates_of_origin (L-09/L-10, D-13): the chamber-format
--     bilingual certificate — ORIGIN and CONFORMITY ride the same
--     table as a doc type (the 050 coa_documents one-table-two-types
--     law); THE FROZEN SNAPSHOT (jsonb, NOT NULL): the print's own
--     data frozen at issuance — a later declaration PATCH never moves
--     a stored certificate (the 050 COA frozen-snapshot law verbatim,
--     the W-39 print surface renders it VERBATIM through the bi()
--     builder EXCLUSIVELY). The declaration link lands at 0121 §6 as
--     an additive column (customs_declarations does not exist yet at
--     this slot — the 0067/0070 additive pattern). Evidence: S/I/U,
--     NO DELETE (an issued certificate is immutable history).
--
--   THE D-02 DISCLOSURE (the standing law): the chain 119 → 120 ·
--     ENTITY_CATALOG 344 → 348 (this migration's +4) → 354 at 0122 ·
--     the permissions drift 347 unchanged here · ROUTE_PERMISSIONS
--     1,159 unchanged (keys-seed-first).
--
--   Ledger-free by design (the certificates/transport documents are
--     non-ledger documents — the 050 note-20 pattern; D-13's print is
--     W-39's web wave).

--> statement-breakpoint
SET ROLE erp_migrate;

--> statement-breakpoint
-- ---------------------------------------------------------------------------
-- 1. incoterms (L-03 — the tenant-extensible registry; the matrix as
--    registry DATA).
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "incoterms" (
  "id" uuid NOT NULL,
  "tenant_id" uuid NOT NULL REFERENCES "tenants" ("id") ON DELETE RESTRICT,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "updated_at" timestamptz NOT NULL DEFAULT now(),
  "version" integer NOT NULL DEFAULT 1,
  "created_by" uuid,
  "updated_by" uuid,
  "code" text NOT NULL,
  "name" text NOT NULL,
  "name_ar" text NOT NULL,
  "carriage_by_seller" boolean NOT NULL,
  "insurance_by_seller" boolean NOT NULL,
  "export_clearance_by_seller" boolean NOT NULL,
  "import_clearance_by_seller" boolean NOT NULL,
  "import_duty_by_seller" boolean NOT NULL,
  "is_active" boolean NOT NULL DEFAULT true,
  "note" text,
  "note_ar" text,
  CONSTRAINT pk_incoterms PRIMARY KEY ("id"),
  CONSTRAINT uq_incoterms_id_tenant UNIQUE ("id", "tenant_id"),
  CONSTRAINT uq_incoterms_tenant_code UNIQUE ("tenant_id", "code"),
  CONSTRAINT ck_incoterms_code
    CHECK ("code" ~ '^[A-Z0-9]{2,8}$'),
  CONSTRAINT ck_incoterms_names
    CHECK ("name" ~ '.{2,120}' AND "name_ar" ~ '.{2,120}')
);

--> statement-breakpoint
CREATE INDEX IF NOT EXISTS ix_incoterms_tenant_active
  ON "incoterms" ("tenant_id", "is_active", "code");

--> statement-breakpoint
-- ---------------------------------------------------------------------------
-- 2. bills_of_lading (L-04/L-13, D-14 — the multimodal transport
--    document; the shipment's own anchor).
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "bills_of_lading" (
  "id" uuid NOT NULL,
  "tenant_id" uuid NOT NULL REFERENCES "tenants" ("id") ON DELETE RESTRICT,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "updated_at" timestamptz NOT NULL DEFAULT now(),
  "version" integer NOT NULL DEFAULT 1,
  "created_by" uuid,
  "updated_by" uuid,
  "bl_no" text NOT NULL,
  "doc_type" text NOT NULL,
  "carrier_name" text NOT NULL,
  "port_of_loading" text,
  "port_of_discharge" text,
  "container_refs" jsonb,
  "purchase_order_id" uuid,
  "delivery_note_id" uuid,
  "shipment_status" text NOT NULL DEFAULT 'BOOKED',
  "issued_at" timestamptz NOT NULL DEFAULT now(),
  "note" text,
  "note_ar" text,
  CONSTRAINT pk_bills_of_lading PRIMARY KEY ("id"),
  CONSTRAINT uq_bills_of_lading_id_tenant UNIQUE ("id", "tenant_id"),
  CONSTRAINT uq_bills_of_lading_tenant_no UNIQUE ("tenant_id", "bl_no"),
  CONSTRAINT fk_bills_of_lading_po
    FOREIGN KEY ("purchase_order_id", "tenant_id")
    REFERENCES "purchase_orders" ("id", "tenant_id") ON DELETE RESTRICT,
  CONSTRAINT fk_bills_of_lading_delivery_note
    FOREIGN KEY ("delivery_note_id", "tenant_id")
    REFERENCES "delivery_notes" ("id", "tenant_id") ON DELETE RESTRICT,
  CONSTRAINT ck_bills_of_lading_doc_type
    CHECK ("doc_type" IN ('SEA', 'AIR', 'ROAD', 'RAIL', 'MULTIMODAL')),
  -- THE FOLD'S DRIVEN SURFACE (D-14): the monotone milestone ladder —
  -- an event never regresses this status (the W-36 pure module owns
  -- the transitions; the floor keeps the vocabulary).
  CONSTRAINT ck_bills_of_lading_shipment_status
    CHECK (
      "shipment_status" IN ('BOOKED', 'DEPARTED', 'ARRIVED', 'CLEARED', 'DELIVERED')
    ),
  CONSTRAINT ck_bills_of_lading_container_refs_shape
    CHECK ("container_refs" IS NULL OR jsonb_typeof("container_refs") = 'array')
);

--> statement-breakpoint
CREATE INDEX IF NOT EXISTS ix_bills_of_lading_tenant_status
  ON "bills_of_lading" ("tenant_id", "shipment_status", "issued_at");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS ix_bills_of_lading_tenant_po
  ON "bills_of_lading" ("tenant_id", "purchase_order_id")
  WHERE "purchase_order_id" IS NOT NULL;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS ix_bills_of_lading_tenant_dn
  ON "bills_of_lading" ("tenant_id", "delivery_note_id")
  WHERE "delivery_note_id" IS NOT NULL;

--> statement-breakpoint
-- ---------------------------------------------------------------------------
-- 3. packing_lists (L-05 — the shipment/receipt link + the line-level
--    pack shapes).
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "packing_lists" (
  "id" uuid NOT NULL,
  "tenant_id" uuid NOT NULL REFERENCES "tenants" ("id") ON DELETE RESTRICT,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "updated_at" timestamptz NOT NULL DEFAULT now(),
  "version" integer NOT NULL DEFAULT 1,
  "created_by" uuid,
  "updated_by" uuid,
  "pl_no" text NOT NULL,
  "bill_of_lading_id" uuid,
  "receipt_id" uuid,
  "lines" jsonb NOT NULL DEFAULT '[]'::jsonb,
  "shipment_status" text NOT NULL DEFAULT 'BOOKED',
  "issued_at" timestamptz NOT NULL DEFAULT now(),
  "note" text,
  "note_ar" text,
  CONSTRAINT pk_packing_lists PRIMARY KEY ("id"),
  CONSTRAINT uq_packing_lists_id_tenant UNIQUE ("id", "tenant_id"),
  CONSTRAINT uq_packing_lists_tenant_no UNIQUE ("tenant_id", "pl_no"),
  CONSTRAINT fk_packing_lists_bl
    FOREIGN KEY ("bill_of_lading_id", "tenant_id")
    REFERENCES "bills_of_lading" ("id", "tenant_id") ON DELETE RESTRICT,
  CONSTRAINT fk_packing_lists_receipt
    FOREIGN KEY ("receipt_id", "tenant_id")
    REFERENCES "goods_receipts" ("id", "tenant_id") ON DELETE RESTRICT,
  CONSTRAINT ck_packing_lists_lines_shape
    CHECK (jsonb_typeof("lines") = 'array'),
  CONSTRAINT ck_packing_lists_shipment_status
    CHECK (
      "shipment_status" IN ('BOOKED', 'DEPARTED', 'ARRIVED', 'CLEARED', 'DELIVERED')
    )
);

--> statement-breakpoint
CREATE INDEX IF NOT EXISTS ix_packing_lists_tenant_bl
  ON "packing_lists" ("tenant_id", "bill_of_lading_id")
  WHERE "bill_of_lading_id" IS NOT NULL;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS ix_packing_lists_tenant_receipt
  ON "packing_lists" ("tenant_id", "receipt_id")
  WHERE "receipt_id" IS NOT NULL;

--> statement-breakpoint
-- ---------------------------------------------------------------------------
-- 4. certificates_of_origin (L-09/L-10, D-13 — the frozen chamber-
--    format bilingual snapshot; ORIGIN + CONFORMITY one table).
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "certificates_of_origin" (
  "id" uuid NOT NULL,
  "tenant_id" uuid NOT NULL REFERENCES "tenants" ("id") ON DELETE RESTRICT,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "updated_at" timestamptz NOT NULL DEFAULT now(),
  "version" integer NOT NULL DEFAULT 1,
  "created_by" uuid,
  "updated_by" uuid,
  "certificate_no" text NOT NULL,
  "cert_type" text NOT NULL,
  "bill_of_lading_id" uuid,
  "snapshot" jsonb NOT NULL,
  "issued_at" timestamptz NOT NULL DEFAULT now(),
  "issued_by" uuid,
  "note" text,
  "note_ar" text,
  CONSTRAINT pk_certificates_of_origin PRIMARY KEY ("id"),
  CONSTRAINT uq_certificates_of_origin_id_tenant UNIQUE ("id", "tenant_id"),
  CONSTRAINT uq_certificates_of_origin_tenant_no UNIQUE ("tenant_id", "certificate_no"),
  CONSTRAINT fk_certificates_of_origin_bl
    FOREIGN KEY ("bill_of_lading_id", "tenant_id")
    REFERENCES "bills_of_lading" ("id", "tenant_id") ON DELETE RESTRICT,
  -- THE 050 ONE-TABLE-TWO-TYPES LAW (the coa_documents precedent): the
  -- certificate of origin and the certificate of conformity ride the
  -- same table as a document type.
  CONSTRAINT ck_certificates_of_origin_type
    CHECK ("cert_type" IN ('ORIGIN', 'CONFORMITY')),
  -- THE FROZEN SNAPSHOT (D-13 — the 050 COA law verbatim): the
  -- chamber-format bilingual print's own data frozen at issuance — an
  -- object, never a scalar; a later declaration PATCH never moves a
  -- stored certificate.
  CONSTRAINT ck_certificates_of_origin_snapshot_shape
    CHECK (jsonb_typeof("snapshot") = 'object')
);

--> statement-breakpoint
CREATE INDEX IF NOT EXISTS ix_certificates_of_origin_tenant_issued
  ON "certificates_of_origin" ("tenant_id", "issued_at");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS ix_certificates_of_origin_tenant_bl
  ON "certificates_of_origin" ("tenant_id", "bill_of_lading_id")
  WHERE "bill_of_lading_id" IS NOT NULL;

--> statement-breakpoint
-- ---------------------------------------------------------------------------
-- 5. RLS — the A1–A10 family over the four tables.
--> statement-breakpoint
ALTER TABLE "incoterms" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "incoterms" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
SELECT erp.apply_tenant_policy('"incoterms"');
--> statement-breakpoint
ALTER TABLE "bills_of_lading" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "bills_of_lading" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
SELECT erp.apply_tenant_policy('"bills_of_lading"');
--> statement-breakpoint
ALTER TABLE "packing_lists" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "packing_lists" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
SELECT erp.apply_tenant_policy('"packing_lists"');
--> statement-breakpoint
ALTER TABLE "certificates_of_origin" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "certificates_of_origin" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
SELECT erp.apply_tenant_policy('"certificates_of_origin"');
--> statement-breakpoint
DO $$
DECLARE
  t text;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'incoterms', 'bills_of_lading', 'packing_lists', 'certificates_of_origin'
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
-- 6. Grants — the master-data registry vs the evidence discipline.
--> statement-breakpoint
REVOKE ALL ON "incoterms" FROM erp_app;
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON "incoterms" TO erp_app;
--> statement-breakpoint
GRANT SELECT ON "incoterms" TO erp_readonly;
--> statement-breakpoint
GRANT SELECT ON "incoterms" TO erp_definer;
--> statement-breakpoint
REVOKE ALL ON "bills_of_lading" FROM erp_app;
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE ON "bills_of_lading" TO erp_app;
--> statement-breakpoint
GRANT SELECT ON "bills_of_lading" TO erp_readonly;
--> statement-breakpoint
GRANT SELECT ON "bills_of_lading" TO erp_definer;
--> statement-breakpoint
REVOKE ALL ON "packing_lists" FROM erp_app;
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE ON "packing_lists" TO erp_app;
--> statement-breakpoint
GRANT SELECT ON "packing_lists" TO erp_readonly;
--> statement-breakpoint
GRANT SELECT ON "packing_lists" TO erp_definer;
--> statement-breakpoint
REVOKE ALL ON "certificates_of_origin" FROM erp_app;
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE ON "certificates_of_origin" TO erp_app;
--> statement-breakpoint
GRANT SELECT ON "certificates_of_origin" TO erp_readonly;
--> statement-breakpoint
GRANT SELECT ON "certificates_of_origin" TO erp_definer;

--> statement-breakpoint
COMMENT ON TABLE "incoterms" IS 'PHASE-051 (L-03, T-02, D-10/D-16): the tenant-extensible Incoterms registry — the ownership matrix as registry data (carriage/insurance/clearance/duty), the 2020 seed with the accuracy disclaimer (the tenant owns the final classification) / سجل شروط التجارة: مصفوفة الملكية بيانات في السجل ومجموعة 2020 مع إقرار الدقة';
--> statement-breakpoint
COMMENT ON TABLE "bills_of_lading" IS 'PHASE-051 (L-04/L-13, T-02, D-14): the multimodal transport document — the shipment''s own anchor (the B/L''s carriage contract is the shipment''s identity; the tracking events link it), the fold-driven shipment status / بوليصة الشحن متعددة الوسائط: مرتكز الشحنة وسطح الحالة الذي يحرّكه الطيّ';
--> statement-breakpoint
COMMENT ON TABLE "packing_lists" IS 'PHASE-051 (L-05, T-02): the packing lists — the shipment/receipt link with the line-level pack shapes / قوائم التعبئة: ربط الشحنة والاستلام وأشكال التعبئة سطراً سطراً';
--> statement-breakpoint
COMMENT ON TABLE "certificates_of_origin" IS 'PHASE-051 (L-09/L-10, T-02, D-13): the chamber-format bilingual certificates — origin and conformity one table, the frozen snapshot the print renders VERBATIM / شهادات المنشأ والمطابقة: لقطة مجمدة يطبعها خط الطباعة حرفياً';

--> statement-breakpoint
RESET ROLE;

--> statement-breakpoint
-- Schema-state marker for /health/ready (mirrors the migration manifest).
INSERT INTO erp._schema_state (key, value) VALUES ('schema_version', 120)
ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, at = now();
